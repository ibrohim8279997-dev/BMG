"""Click Merchant API, card tokens: save a card once (Click sends an SMS code to the card owner), then charge it on
demand without re-entering it. All money goes to the single BMG Click account (service id from env).
Auth header per Click docs: "<merchant_user_id>:<sha1(timestamp + secret_key)>:<timestamp>".
The card number/expiry pass through to Click and are never stored or logged."""
import hashlib
import logging
import time
from decimal import Decimal

import requests
from django.conf import settings

plog = logging.getLogger('bmg.payments')
BASE = 'https://api.click.uz/v2/merchant'


class CardError(Exception):
    def __init__(self, code='card_error', click_code=None):
        super().__init__(code)
        self.code, self.click_code = code, click_code


def configured():
    return bool(settings.CLICK_SERVICE_ID and settings.CLICK_MERCHANT_USER_ID and settings.CLICK_SECRET_KEY)


def _headers():
    ts = str(int(time.time()))
    digest = hashlib.sha1((ts + settings.CLICK_SECRET_KEY).encode()).hexdigest()
    return {'Auth': f'{settings.CLICK_MERCHANT_USER_ID}:{digest}:{ts}', 'Accept': 'application/json',
            'Content-Type': 'application/json'}


def _call(method, path, payload=None, what=''):
    if not configured():
        raise CardError('payments_unavailable')
    try:
        r = requests.request(method, BASE + path, json=payload, headers=_headers(), timeout=20)
        d = r.json()
    except (requests.RequestException, ValueError):
        plog.exception('click card %s: transport error', what)   # payload is never logged
        raise CardError('payments_unavailable')
    code = d.get('error_code')
    plog.info('click card %s -> error_code=%s', what, code)
    if code != 0:
        raise CardError('card_error', code)
    return d


def _sid():
    return int(settings.CLICK_SERVICE_ID) if str(settings.CLICK_SERVICE_ID).isdigit() else settings.CLICK_SERVICE_ID


def request_token(card_number: str, expire_date: str):
    """Returns (token, phone_hint). Click then texts a code to the phone linked to the card."""
    d = _call('POST', '/card_token/request', {'service_id': _sid(), 'card_number': card_number,
                                              'expire_date': expire_date, 'temporary': 0}, 'request')
    if not d.get('card_token'):
        raise CardError('card_error')
    return str(d['card_token'])[:100], str(d.get('phone_number', ''))[:20]


def verify_token(token: str, sms_code: str) -> str:
    d = _call('POST', '/card_token/verify', {'service_id': _sid(), 'card_token': token, 'sms_code': sms_code}, 'verify')
    return str(d.get('card_number', ''))[:24]


def charge(token: str, amount, ref: str) -> str:
    amount = float(Decimal(str(amount)).quantize(Decimal('0.01')))    # Click wants a JSON number; round first
    d = _call('POST', '/card_token/payment', {'service_id': _sid(), 'card_token': token, 'amount': amount,
                                              'transaction_parameter': ref}, 'payment')
    return str(d.get('payment_id', ''))


def delete_token(token: str):
    try:
        _call('DELETE', f'/card_token/{_sid()}/{token}', None, 'delete')
    except CardError:
        pass   # local removal still happens; Click tokens can also be revoked by the card owner
