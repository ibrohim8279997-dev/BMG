import hashlib
import hmac
import logging
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import transaction
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.utils import client_ip

from . import wallet
from .models import ClickEvent, TopUp

plog = logging.getLogger('bmg.payments')

OK, SIGN_FAILED, BAD_AMOUNT, NO_ACTION, ALREADY_PAID, NO_USER, NO_TRANS, UPDATE_FAILED, BAD_REQUEST, CANCELLED = \
    0, -1, -2, -3, -4, -5, -6, -7, -8, -9
NOTES = {OK: 'Success', SIGN_FAILED: 'SIGN CHECK FAILED!', BAD_AMOUNT: 'Incorrect parameter amount',
         NO_ACTION: 'Action not found', ALREADY_PAID: 'Already paid', NO_USER: 'User does not exist',
         NO_TRANS: 'Transaction does not exist', UPDATE_FAILED: 'Failed to update user',
         BAD_REQUEST: 'Error in request from click', CANCELLED: 'Transaction cancelled'}


def pay_url(topup):
    from urllib.parse import urlencode
    q = urlencode({'service_id': settings.CLICK_SERVICE_ID, 'merchant_id': settings.CLICK_MERCHANT_ID,
                   'amount': f'{topup.amount:.2f}', 'transaction_param': topup.id,
                   'return_url': f'{settings.SITE_URL}/wallet'})
    return f'https://my.click.uz/services/pay?{q}'


def make_sign(p, action):
    parts = [p.get('click_trans_id', ''), p.get('service_id', ''), settings.CLICK_SECRET_KEY,
             p.get('merchant_trans_id', '')]
    if action == 1:
        parts.append(p.get('merchant_prepare_id', ''))
    parts += [p.get('amount', ''), p.get('action', ''), p.get('sign_time', '')]
    return hashlib.md5(''.join(str(x) for x in parts).encode()).hexdigest()


def ip_ok(request):
    allowed = settings.CLICK_ALLOWED_IPS
    if not allowed:
        return settings.DEBUG
    return client_ip(request) in allowed


class ClickCallback(APIView):
    """Click Shop API: action 0 = prepare, action 1 = complete. No session auth; trust is IP + signature."""
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = []

    def post(self, request):
        p = {k: str(v) for k, v in request.data.items()}
        result = self.handle(request, p)
        code = result['error']
        plog.info('click action=%s trans=%s merchant=%s ip=%s result=%s', p.get('action'),
                  p.get('click_trans_id'), p.get('merchant_trans_id'), client_ip(request), code)
        try:
            ClickEvent.objects.create(
                action=int(p['action']) if p.get('action', '').lstrip('-').isdigit() else None,
                click_trans_id=int(p['click_trans_id']) if p.get('click_trans_id', '').isdigit() else None,
                merchant_trans_id=p.get('merchant_trans_id', '')[:40], ip=client_ip(request), result=code,
                raw={k: v[:200] for k, v in p.items() if k != 'sign_string'})
        except Exception:
            plog.exception('click event log failed')
        return Response({'click_trans_id': p.get('click_trans_id'), 'merchant_trans_id': p.get('merchant_trans_id'),
                         **result, 'error_note': NOTES.get(code, '')})

    @transaction.atomic
    def handle(self, request, p):
        if not ip_ok(request):
            return {'error': BAD_REQUEST}
        if not settings.CLICK_SECRET_KEY:
            return {'error': SIGN_FAILED}
        try:
            action = int(p.get('action', ''))
        except ValueError:
            return {'error': BAD_REQUEST}
        if action not in (0, 1):
            return {'error': NO_ACTION}
        required = ['click_trans_id', 'service_id', 'merchant_trans_id', 'amount', 'sign_time', 'sign_string']
        if action == 1:
            required.append('merchant_prepare_id')
        if any(k not in p for k in required):
            return {'error': BAD_REQUEST}
        if not hmac.compare_digest(make_sign(p, action), p['sign_string']) or p['service_id'] != settings.CLICK_SERVICE_ID:
            return {'error': SIGN_FAILED}
        if not p['merchant_trans_id'].isdigit() or not p['click_trans_id'].isdigit():
            return {'error': BAD_REQUEST}
        topup = TopUp.objects.select_for_update().filter(pk=int(p['merchant_trans_id'])).first()
        if topup is None:
            return {'error': NO_TRANS}
        try:
            amount = Decimal(p['amount'])
        except InvalidOperation:
            return {'error': BAD_REQUEST}
        if amount != topup.amount:          # amount is taken from OUR database, never from the browser
            return {'error': BAD_AMOUNT}
        trans_id = int(p['click_trans_id'])
        if topup.status == 'paid':
            return {'error': ALREADY_PAID}  # replay protection
        if topup.status == 'cancelled':
            return {'error': CANCELLED}
        if topup.click_trans_id not in (None, trans_id):
            return {'error': BAD_REQUEST}
        if action == 0:
            if TopUp.objects.filter(click_trans_id=trans_id).exclude(pk=topup.pk).exists():
                return {'error': ALREADY_PAID}
            topup.click_trans_id = trans_id
            topup.save(update_fields=['click_trans_id'])
            return {'error': OK, 'merchant_prepare_id': topup.id}
        # complete
        if topup.click_trans_id != trans_id or p['merchant_prepare_id'] != str(topup.id):
            return {'error': NO_TRANS}
        if p.get('error', '0').lstrip('-').isdigit() and int(p.get('error', '0')) < 0:
            topup.status = 'cancelled'
            topup.save(update_fields=['status'])
            return {'error': CANCELLED}
        wallet.change(topup.user, topup.amount, 'topup', ref=f'click:{trans_id}')
        topup.status = 'paid'
        topup.save(update_fields=['status'])
        return {'error': OK, 'merchant_confirm_id': topup.id}
