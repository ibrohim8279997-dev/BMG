"""Saved-card endpoints: add (card -> Click SMS), verify, list, delete, top up the wallet, pay an order."""
import re
from decimal import Decimal, InvalidOperation

from django.db import transaction
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.utils import throttle

from . import click_card, wallet
from .models import SavedCard, TopUp

MAX_CARDS = 5


def _card_out(c):
    return {'id': c.id, 'masked': c.masked, 'verified': c.verified, 'created_at': c.created_at}


def _err(e: click_card.CardError):
    return Response({'error': e.code}, status=503 if e.code == 'payments_unavailable' else 400)


def _amount(raw):
    try:
        a = Decimal(str(raw))
    except InvalidOperation:
        return None
    if not a.is_finite() or not Decimal('1000') <= a <= Decimal('500000000') or a != a.quantize(Decimal('0.01')):
        return None
    return a


def charge_card(card, amount):
    """Charge a verified saved card and credit the wallet. The TopUp row makes it auditable and is the amount's
    source of truth; it is marked paid only after Click confirms the payment."""
    t = TopUp.objects.create(user=card.user, amount=amount)
    pid = click_card.charge(card.token, amount, f'topup-{t.id}')
    with transaction.atomic():
        t = TopUp.objects.select_for_update().get(pk=t.pk)
        if t.status != 'paid':
            wallet.change(card.user, amount, 'topup', ref=f'clickcard:{pid or t.id}'[:60])
            t.status = 'paid'
            t.save(update_fields=['status'])
    return t


class CardListView(APIView):
    throttle_classes = [throttle('card')]

    def get(self, request):
        return Response({'enabled': click_card.configured(),
                         'cards': [_card_out(c) for c in request.user.cards.filter(verified=True).order_by('-id')]})

    def post(self, request):
        number = re.sub(r'\D', '', str(request.data.get('card_number', '')))
        expire = re.sub(r'\D', '', str(request.data.get('expire_date', '')))   # MMYY
        if not 16 <= len(number) <= 19 or len(expire) != 4 or not 1 <= int(expire[:2]) <= 12:
            return Response({'error': 'card_invalid'}, status=400)
        if request.user.cards.filter(verified=True).count() >= MAX_CARDS:
            return Response({'error': 'too_many_requests'}, status=429)
        try:
            token, phone = click_card.request_token(number, expire)
        except click_card.CardError as e:
            return _err(e)
        request.user.cards.filter(verified=False).delete()          # one pending card at a time
        c = SavedCard.objects.create(user=request.user, token=token)
        return Response({'id': c.id, 'phone_hint': phone}, status=201)


class CardDetailView(APIView):
    throttle_classes = [throttle('card')]

    def delete(self, request, pk):
        c = request.user.cards.filter(pk=pk).first()
        if not c:
            return Response({'error': 'not_found'}, status=404)
        click_card.delete_token(c.token)
        c.delete()
        return Response({'ok': True})


class CardVerifyView(APIView):
    throttle_classes = [throttle('card')]

    def post(self, request, pk):
        c = request.user.cards.filter(pk=pk, verified=False).first()
        code = re.sub(r'\D', '', str(request.data.get('sms_code', '')))
        if not c:
            return Response({'error': 'not_found'}, status=404)
        if not 4 <= len(code) <= 8:
            return Response({'error': 'invalid_code'}, status=400)
        try:
            c.masked = click_card.verify_token(c.token, code)
        except click_card.CardError as e:
            return Response({'error': 'invalid_code'}, status=400) if e.code == 'card_error' else _err(e)
        c.verified = True
        c.save(update_fields=['masked', 'verified'])
        return Response(_card_out(c))


class CardTopUpView(APIView):
    throttle_classes = [throttle('card')]

    def post(self, request, pk):
        c = request.user.cards.filter(pk=pk, verified=True).first()
        if not c:
            return Response({'error': 'not_found'}, status=404)
        amount = _amount(request.data.get('amount'))
        if amount is None:
            return Response({'error': 'invalid_request'}, status=400)
        try:
            charge_card(c, amount)
        except click_card.CardError as e:
            return _err(e)
        from .models import Wallet
        return Response({'balance': str(Wallet.objects.get(user=request.user).balance)})


class CardPayOrderView(APIView):
    """One click: charge only the shortfall (amount due minus current balance) to the card, then pay the order."""
    throttle_classes = [throttle('card')]

    def post(self, request, pk):
        from apps.orders import services as osvc
        from apps.orders.models import Order
        from .models import Wallet
        c = request.user.cards.filter(pk=pk, verified=True).first()
        order = Order.objects.filter(pk=request.data.get('order_id') if str(request.data.get('order_id', '')).isdigit()
                                     else 0, client=request.user).first()
        if not c or not order:
            return Response({'error': 'not_found'}, status=404)
        if order.status != 'pending_payment':
            return Response({'error': 'invalid_state'}, status=409)
        w, _ = Wallet.objects.get_or_create(user=request.user)
        short = order.amount_due_online - w.balance
        if short > 0:
            try:
                charge_card(c, max(short, Decimal('1000')))     # Click minimum; the rest stays on the balance
            except click_card.CardError as e:
                return _err(e)
        try:
            osvc.pay_order(request.user, order.id)
        except osvc.OrderError as e:
            return Response({'error': e.code}, status=409)
        return Response({'ok': True, 'order_id': order.id})
