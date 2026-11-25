from decimal import Decimal
from unittest import mock

from django.test import override_settings

from apps.payments import click_card
from apps.payments.models import SavedCard, TopUp, Wallet

from .base import Base

CLICK = dict(CLICK_SERVICE_ID='111', CLICK_MERCHANT_USER_ID='222', CLICK_SECRET_KEY='s3cret')


class FakeClick:
    """Stands in for api.click.uz; records calls so we can assert the card number never leaves the request."""
    def __init__(self, fail=None):
        self.calls, self.fail = [], fail or {}

    def __call__(self, method, url, json=None, headers=None, timeout=None):
        self.calls.append((method, url, json, headers))
        op = url.rsplit('/', 1)[-1] if method != 'DELETE' else 'delete'
        r = mock.Mock()
        if op in self.fail:
            r.json.return_value = {'error_code': self.fail[op]}
        else:
            r.json.return_value = {'request': {'error_code': 0, 'card_token': 'TOK-1', 'phone_number': '99890***4567'},
                                   'verify': {'error_code': 0, 'card_number': '8600 **** **** 1234'},
                                   'payment': {'error_code': 0, 'payment_id': 777}}.get(op, {'error_code': 0})
        return r


@override_settings(**CLICK)
class CardTests(Base):
    def setUp(self):
        super().setUp()
        self.u = self.user()
        self.login(self.u)

    def add(self, fake):
        with mock.patch('apps.payments.click_card.requests.request', fake):
            r = self.api.post('/api/v1/payments/cards', {'card_number': '8600 1234 5678 1234', 'expire_date': '03/29'}, format='json')
            self.assertEqual(r.status_code, 201, r.data)
            v = self.api.post(f'/api/v1/payments/cards/{r.data["id"]}/verify', {'sms_code': '123456'}, format='json')
        return r, v

    def test_save_card_stores_only_token_and_mask(self):
        fake = FakeClick()
        r, v = self.add(fake)
        self.assertEqual(r.data['phone_hint'], '99890***4567')
        self.assertEqual((v.status_code, v.data['masked'], v.data['verified']), (200, '8600 **** **** 1234', True))
        c = SavedCard.objects.get()
        self.assertEqual(c.token, 'TOK-1')
        self.assertNotIn('5678', c.masked)
        method, url, body, headers = fake.calls[0]
        self.assertTrue(url.endswith('/card_token/request'))
        self.assertEqual((body['card_number'], body['expire_date'], body['service_id']), ('8600123456781234', '0329', 111))
        uid, digest, ts = headers['Auth'].split(':')
        import hashlib
        self.assertEqual((uid, digest), ('222', hashlib.sha1((ts + 's3cret').encode()).hexdigest()))
        listed = self.api.get('/api/v1/payments/cards').data
        self.assertTrue(listed['enabled'])
        self.assertNotIn('token', listed['cards'][0])

    def test_wrong_sms_code(self):
        fake = FakeClick(fail={'verify': -5017})
        with mock.patch('apps.payments.click_card.requests.request', fake):
            r = self.api.post('/api/v1/payments/cards', {'card_number': '8600123456781234', 'expire_date': '0329'}, format='json')
            v = self.api.post(f'/api/v1/payments/cards/{r.data["id"]}/verify', {'sms_code': '000000'}, format='json')
        self.assertEqual(v.data['error'], 'invalid_code')
        self.assertFalse(SavedCard.objects.get().verified)
        self.assertEqual(self.api.get('/api/v1/payments/cards').data['cards'], [])

    def test_invalid_card_input(self):
        for body in ({'card_number': '1234', 'expire_date': '0329'}, {'card_number': '8600123456781234', 'expire_date': '1329'}):
            self.assertEqual(self.api.post('/api/v1/payments/cards', body, format='json').data['error'], 'card_invalid')

    def test_topup_charges_card_and_credits_wallet(self):
        fake = FakeClick()
        r, _ = self.add(fake)
        with mock.patch('apps.payments.click_card.requests.request', fake):
            t = self.api.post(f'/api/v1/payments/cards/{r.data["id"]}/topup', {'amount': '50000'}, format='json')
        self.assertEqual((t.status_code, t.data['balance']), (200, '50000.00'))
        self.assertEqual(fake.calls[-1][2]['amount'], 50000.0)
        self.assertEqual(TopUp.objects.get().status, 'paid')

    def test_declined_charge_does_not_credit(self):
        fake = FakeClick()
        r, _ = self.add(fake)
        fake.fail = {'payment': -5017}
        with mock.patch('apps.payments.click_card.requests.request', fake):
            t = self.api.post(f'/api/v1/payments/cards/{r.data["id"]}/topup', {'amount': '50000'}, format='json')
        self.assertEqual(t.data['error'], 'card_error')
        self.assertFalse(Wallet.objects.filter(user=self.u, balance__gt=0).exists())
        self.assertEqual(TopUp.objects.get().status, 'pending')

    def test_other_users_card_is_invisible(self):
        r, _ = self.add(FakeClick())
        self.login(self.user())
        self.assertEqual(self.api.post(f'/api/v1/payments/cards/{r.data["id"]}/topup', {'amount': '5000'}, format='json').status_code, 404)
        self.assertEqual(self.api.delete(f'/api/v1/payments/cards/{r.data["id"]}').status_code, 404)

    def test_pay_order_charges_only_shortfall(self):
        fake = FakeClick()
        r, _ = self.add(fake)
        s = self.seller()
        self.offer(s, price=10000)
        from apps.catalog.models import Offer
        self.api.post('/api/v1/cart', {'offer_id': Offer.objects.get().id, 'qty': 2}, format='json')
        o = self.api.post('/api/v1/orders', {'city': 'Tashkent', 'payment_mode': 'full'}, format='json').data
        from apps.payments import wallet
        wallet.change(self.u, Decimal('5000'), 'topup')
        with mock.patch('apps.payments.click_card.requests.request', fake):
            p = self.api.post(f'/api/v1/payments/cards/{r.data["id"]}/pay-order', {'order_id': o['id']}, format='json')
        self.assertEqual(p.status_code, 200, p.data)
        due = Decimal(o['amount_due_online'])
        self.assertEqual(Decimal(str(fake.calls[-1][2]['amount'])), due - 5000)
        self.assertEqual(Wallet.objects.get(user=self.u).balance, 0)

    def test_disabled_without_keys(self):
        with override_settings(CLICK_SECRET_KEY=''):
            r = self.api.post('/api/v1/payments/cards', {'card_number': '8600123456781234', 'expire_date': '0329'}, format='json')
        self.assertEqual((r.status_code, r.data['error']), (503, 'payments_unavailable'))

    def test_delete(self):
        fake = FakeClick()
        r, _ = self.add(fake)
        with mock.patch('apps.payments.click_card.requests.request', fake):
            self.assertEqual(self.api.delete(f'/api/v1/payments/cards/{r.data["id"]}').status_code, 200)
        self.assertEqual(fake.calls[-1][0], 'DELETE')
        self.assertFalse(SavedCard.objects.exists())
