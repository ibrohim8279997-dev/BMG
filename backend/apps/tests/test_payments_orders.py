from decimal import Decimal
from unittest import mock

from django.test import override_settings

from apps.audit.models import AuditLog
from apps.core.models import Setting
from apps.orders.models import CartItem, Order, SellerLedger
from apps.orders import services as osvc
from apps.payments import wallet
from apps.payments.click import make_sign
from apps.payments.models import ClickEvent, LedgerEntry, TopUp, Wallet

from .base import Base

CLICK = dict(CLICK_SERVICE_ID='777', CLICK_SECRET_KEY='topsecret', CLICK_ALLOWED_IPS=['203.0.113.5'])


def signed(p, action):
    p = {k: str(v) for k, v in p.items()}
    p['action'] = str(action)
    p['sign_string'] = make_sign(p, action)
    return p


@override_settings(**CLICK)
class ClickTests(Base):
    def setUp(self):
        super().setUp()
        self.client_user = self.user()
        self.t = TopUp.objects.create(user=self.client_user, amount=Decimal('100000.00'))

    def post(self, p, ip='203.0.113.5'):
        return self.api.post('/api/v1/payments/click', p, format='multipart', REMOTE_ADDR=ip).json()

    def base(self, **kw):
        d = dict(click_trans_id=1001, service_id='777', merchant_trans_id=self.t.id, amount='100000.00',
                 sign_time='2026-11-22 10:00:00')
        d.update(kw)
        return d

    def prepare(self, **kw):
        return self.post(signed(self.base(**kw), 0))

    def complete(self, **kw):
        return self.post(signed(self.base(merchant_prepare_id=self.t.id, error=0, **kw), 1))

    def balance(self):
        return Wallet.objects.get(user=self.client_user).balance

    def test_happy_path(self):
        self.assertEqual(self.prepare()['error'], 0)
        self.assertEqual(self.complete()['error'], 0)
        self.assertEqual(self.balance(), Decimal('100000.00'))

    def test_replay_does_not_credit_twice(self):
        self.prepare(); self.complete()
        self.assertEqual(self.complete()['error'], -4)
        self.assertEqual(self.prepare()['error'], -4)
        self.assertEqual(self.prepare(click_trans_id=2002)['error'], -4)
        self.assertEqual(self.balance(), Decimal('100000.00'))
        self.assertEqual(LedgerEntry.objects.filter(kind='topup').count(), 1)

    def test_bad_signature_rejected(self):
        p = signed(self.base(), 0)
        p['sign_string'] = 'a' * 32
        self.assertEqual(self.post(p)['error'], -1)
        p = signed(self.base(), 0); p['amount'] = '1.00'    # tampered after signing
        self.assertEqual(self.post(p)['error'], -1)

    def test_amount_comes_from_database(self):
        # attacker signs a different amount correctly (e.g. leaked key scenario is out of scope) -> still rejected
        self.assertEqual(self.prepare(amount='1.00')['error'], -2)
        self.assertEqual(self.balance() if Wallet.objects.exists() else 0, 0)

    def test_ip_allowlist(self):
        self.assertEqual(self.post(signed(self.base(), 0), ip='198.51.100.9')['error'], -8)

    @override_settings(CLICK_ALLOWED_IPS=[], DEBUG=False)
    def test_no_allowlist_in_production_denies_all(self):
        self.assertEqual(self.post(signed(self.base(), 0))['error'], -8)

    @override_settings(CLICK_SECRET_KEY='')
    def test_missing_secret_denies(self):
        self.assertEqual(self.prepare()['error'], -1)

    def test_wrong_service_id(self):
        self.assertEqual(self.prepare(service_id='999')['error'], -1)

    def test_unknown_transaction(self):
        self.assertEqual(self.prepare(merchant_trans_id=9999)['error'], -6)
        self.assertEqual(self.post(signed(self.base(merchant_trans_id='1 OR 1=1'), 0))['error'], -8)

    def test_complete_without_prepare(self):
        self.assertEqual(self.complete()['error'], -6)
        self.assertFalse(Wallet.objects.filter(balance__gt=0).exists())

    def test_cancelled_by_click(self):
        self.prepare()
        r = self.post(signed(self.base(merchant_prepare_id=self.t.id, error=-5017), 1))
        self.assertEqual(r['error'], -9)
        self.assertEqual(self.complete()['error'], -9)

    def test_other_click_trans_id_cannot_complete(self):
        self.prepare()
        self.assertEqual(self.complete(click_trans_id=555)['error'], -8)

    def test_malformed_request(self):
        self.assertEqual(self.post({'action': '1'})['error'], -8)
        self.assertEqual(self.post({'action': 'x'})['error'], -8)
        self.assertEqual(self.post(signed(self.base(), 5))['error'], -3)

    def test_events_logged_separately(self):
        self.prepare()
        self.assertEqual(ClickEvent.objects.count(), 1)
        self.assertNotIn('sign_string', ClickEvent.objects.get().raw)

    def test_topup_validation_and_url(self):
        self.login(self.client_user)
        for bad in ('abc', '-5', '500', '1000.555', '999999999999'):
            self.assertEqual(self.api.post('/api/v1/wallet/topup', {'amount': bad}, format='json').status_code, 400, bad)
        r = self.api.post('/api/v1/wallet/topup', {'amount': '50000'}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertIn('my.click.uz', r.json()['pay_url'])
        self.assertNotIn('topsecret', r.json()['pay_url'])


class WalletTests(Base):
    def test_never_negative(self):
        u = self.user()
        with self.assertRaises(wallet.InsufficientFunds):
            wallet.change(u, Decimal('-1'), 'x')
        wallet.change(u, Decimal('10'), 'topup')
        wallet.change(u, Decimal('-10'), 'order_payment')
        self.assertEqual(Wallet.objects.get(user=u).balance, 0)
        self.assertEqual(LedgerEntry.objects.count(), 2)


class OrderFlow(Base):
    def setUp(self):
        super().setUp()
        self.s = self.seller(delivery=1000)
        self.o = self.offer(self.s, price=10000, stock=50, cost=6000)
        self.c = self.user()
        self.login(self.c)

    def cart(self, qty=10, offer=None):
        return self.api.post('/api/v1/cart', {'offer_id': (offer or self.o).id, 'qty': qty}, format='json')

    def order(self, mode='full', city='Tashkent'):
        return self.api.post('/api/v1/orders', {'city': city, 'payment_mode': mode}, format='json')

    def fund(self, amount):
        wallet.change(self.c, Decimal(amount), 'topup')

    def test_totals_prepayment_commission_computed_server_side(self):
        self.cart(10)
        r = self.order().json()
        self.assertEqual(r['goods_total'], '100000.00')
        self.assertEqual(r['delivery_total'], '1000.00')
        self.assertEqual(r['total'], '101000.00')
        self.assertEqual(r['prepayment'], '5050.00')              # 5% of order
        self.assertEqual(Order.objects.get().commission_total, Decimal('3000.00'))    # 3% default agent fee, goods only
        self.o.refresh_from_db()
        self.assertEqual(self.o.stock, 40)

    def test_client_cannot_inject_prices(self):
        self.cart(1)
        r = self.api.post('/api/v1/orders', {'city': 'Tashkent', 'payment_mode': 'full', 'total': '1',
                                             'goods_total': '1', 'prepayment': '0'}, format='json').json()
        self.assertEqual(r['total'], '11000.00')

    def test_cash_mode_pays_only_prepayment(self):
        self.cart(10)
        r = self.order('cash').json()
        self.assertEqual(r['amount_due_online'], '5050.00')

    def test_min_order_threshold_set_by_superadmin(self):
        Setting.objects.create(key='prepayment_min_order_sum', value=500000)
        self.cart(10)
        r = self.order('cash').json()
        self.assertEqual((r['prepayment'], r['status']), ('0.00', 'paid'))   # nothing to pay online

    def test_prepayment_percent_configurable(self):
        Setting.objects.create(key='prepayment_percent', value=10)
        self.cart(10)
        self.assertEqual(self.order().json()['prepayment'], '10100.00')

    def test_insufficient_funds_then_pay(self):
        self.cart(10)
        oid = self.order().json()['id']
        self.assertEqual(self.api.post(f'/api/v1/orders/{oid}/pay').status_code, 402)
        self.fund('200000')
        self.assertEqual(self.api.post(f'/api/v1/orders/{oid}/pay').json()['status'], 'paid')
        self.assertEqual(Wallet.objects.get(user=self.c).balance, Decimal('99000'))
        self.assertEqual(self.api.post(f'/api/v1/orders/{oid}/pay').status_code, 400)   # no double pay

    def test_stock_and_delivery_validation(self):
        self.assertEqual(self.cart(999).status_code, 400)                  # more than stock
        self.cart(1)
        self.assertEqual(self.order(city='Nukus').json()['error'], 'no_delivery_to_city')
        self.assertEqual(self.api.post('/api/v1/orders', {'city': 'Tashkent', 'payment_mode': 'x'}, format='json').status_code, 400)

    def test_no_oversell(self):
        self.cart(40)
        self.order()
        other = self.user(); self.login(other)
        self.assertEqual(self.api.post('/api/v1/cart', {'offer_id': self.o.id, 'qty': 20}, format='json').status_code, 400)

    def test_cannot_add_unapproved_seller_offer(self):
        p = self.seller(status='pending')
        self.assertEqual(self.cart(1, self.offer(p, name='X')).status_code, 400)

    def test_orders_isolated_between_clients(self):
        self.cart(1); oid = self.order().json()['id']
        evil = self.user(); self.login(evil)
        self.assertEqual(self.api.get(f'/api/v1/orders/{oid}').status_code, 404)
        self.assertEqual(self.api.post(f'/api/v1/orders/{oid}/pay').status_code, 404)
        self.assertEqual(self.api.get('/api/v1/orders').json(), [])

    def test_seller_sees_only_own_lines_and_cannot_fulfill_foreign(self):
        s2 = self.seller(delivery=0); o2 = self.offer(s2, price=500, name='Other')
        self.cart(1); self.cart(1, o2)
        oid = self.order().json()['id']
        self.fund('1000000'); self.api.post(f'/api/v1/orders/{oid}/pay')
        self.login(self.s.user)
        lines = self.api.get('/api/v1/sellers/me/orders').json()[0]['items']
        self.assertEqual([l['name'] for l in lines], ['Cement'])
        outsider = self.seller(); self.login(outsider.user)
        self.assertEqual(self.api.get('/api/v1/sellers/me/orders').json(), [])
        self.assertEqual(self.api.post(f'/api/v1/sellers/me/orders/{oid}/fulfill').status_code, 404)
        self.assertEqual(self.api.get(f'/api/v1/orders/{oid}').status_code, 403)   # seller is not a client

    def paid_order(self, qty=10):
        self.login(self.c)
        self.cart(qty); oid = self.order().json()['id']
        self.fund('1000000'); self.api.post(f'/api/v1/orders/{oid}/pay')
        return oid

    def test_fulfill_credits_payable_and_analytics_margin(self):
        oid = self.paid_order()
        self.login(self.s.user)
        self.assertEqual(self.api.post(f'/api/v1/sellers/me/orders/{oid}/fulfill').status_code, 200)
        self.assertEqual(Order.objects.get().status, 'completed')
        self.assertEqual(SellerLedger.objects.get().amount, Decimal('98000.00'))   # 100000 + 1000 - 3000
        a = self.api.get('/api/v1/sellers/me/analytics').json()
        self.assertEqual((a['revenue'], a['margin'], a['payable_balance']), ('100000.00', '40000.00', '98000.00'))

    def test_analytics_without_cost_has_no_margin(self):
        s = self.seller(); o = self.offer(s, name='NoCost')
        self.login(self.c); self.cart(1, o); oid = self.order().json()['id']
        self.fund('100000'); self.api.post(f'/api/v1/orders/{oid}/pay')
        self.login(s.user)
        self.assertNotIn('margin', self.api.get('/api/v1/sellers/me/analytics').json())

    def test_payout_request_limits(self):
        oid = self.paid_order()
        self.login(self.s.user)
        self.api.post(f'/api/v1/sellers/me/orders/{oid}/fulfill')
        self.assertEqual(self.api.post('/api/v1/sellers/me/payouts', {'amount': '999999'}, format='json').status_code, 400)
        # bank details are required first (they go into the bank payment registry)
        self.assertEqual(self.api.post('/api/v1/sellers/me/payouts', {'amount': '98000'}, format='json').data['error'],
                         'bank_details_required')
        self.assertEqual(self.api.patch('/api/v1/sellers/me', {'bank_account': '123'}, format='json').status_code, 400)
        self.assertEqual(self.api.patch('/api/v1/sellers/me', {'inn': '123456789', 'bank_account': '2020 8000 0000 0000 0001',
                                        'bank_mfo': '00014', 'bank_name': '=HYPERLINK()'}, format='json').status_code, 200)
        self.assertEqual(self.api.post('/api/v1/sellers/me/payouts', {'amount': '98000'}, format='json').status_code, 201)
        self.assertEqual(self.api.post('/api/v1/sellers/me/payouts', {'amount': '1'}, format='json').status_code, 400)
        staff = self.user('staff')
        staff.is_staff = staff.is_superuser = True
        staff.save()
        self.login(staff)
        from apps.adminpanel.reports import EXPORTS
        header, rows = EXPORTS['payout-registry']
        row = dict(zip(header, list(rows())[0]))
        self.assertEqual((row['inn'], row['bank_account'], row['amount']), ('123456789', '20208000000000000001', Decimal('98000')))

    # ---- refunds
    def staff(self):
        return self.user('staff')

    def test_refund_client_fault_keeps_prepayment(self):
        oid = self.paid_order()
        before = Wallet.objects.get(user=self.c).balance
        r = osvc.refund_order(oid, 'client', self.staff())
        self.assertEqual(r.amount, Decimal('95950.00'))            # 101000 - 5050 prepayment
        self.assertEqual(Wallet.objects.get(user=self.c).balance, before + Decimal('95950.00'))
        self.o.refresh_from_db(); self.assertEqual(self.o.stock, 50)    # stock returned
        with self.assertRaises(osvc.OrderError):
            osvc.refund_order(oid, 'client', self.staff())          # only once

    def test_refund_client_fault_cash_mode_refunds_nothing(self):
        self.cart(10); oid = self.order('cash').json()['id']
        self.fund('10000'); self.api.post(f'/api/v1/orders/{oid}/pay')
        r = osvc.refund_order(oid, 'client', self.staff())
        self.assertEqual(r.amount, 0)

    def test_refund_seller_fault_full_and_clawback(self):
        oid = self.paid_order()
        self.login(self.s.user); self.api.post(f'/api/v1/sellers/me/orders/{oid}/fulfill')
        r = osvc.refund_order(oid, 'seller', self.staff())
        self.assertEqual(r.amount, Decimal('101000.00'))                      # everything, incl. prepayment
        from django.db.models import Sum
        self.assertEqual(SellerLedger.objects.filter(seller=self.s).aggregate(s=Sum('amount'))['s'], Decimal('-3000.00'))

    def test_client_fault_not_allowed_after_completion(self):
        oid = self.paid_order()
        self.login(self.s.user); self.api.post(f'/api/v1/sellers/me/orders/{oid}/fulfill')
        with self.assertRaises(osvc.OrderError):
            osvc.refund_order(oid, 'client', self.staff())

    def test_refund_bmg_fault_deadline_3_business_days_plus_1(self):
        from datetime import date
        oid = self.paid_order()
        with mock.patch('apps.orders.services.date') as d:
            d.today.return_value = date(2026, 11, 20)     # Friday
            r = osvc.refund_order(oid, 'bmg', self.staff())
        self.assertEqual(r.due_by, date(2026, 11, 25))    # Tue
        self.assertEqual(r.reserve_until, date(2026, 11, 26))
        self.assertEqual(r.amount, Decimal('101000.00'))

    def test_refund_unpaid_order_rejected(self):
        self.cart(1); oid = self.order().json()['id']
        with self.assertRaises(osvc.OrderError):
            osvc.refund_order(oid, 'bmg', self.staff())


class CashCommissionTests(Base):
    def _cash_order(self, pct):
        from apps.core.models import Setting
        from apps.orders import services as svc
        from apps.orders.models import CartItem
        if pct is not None:
            Setting.objects.update_or_create(key='cash_commission_percent', defaults={'value': pct})
        s = self.seller()
        o = self.offer(s, price=10000)
        c = self.user()
        CartItem.objects.create(user=c, offer=o, qty=Decimal(3))
        order = svc.create_order(c, 'Tashkent', 'cash')
        from apps.payments import wallet
        wallet.change(c, order.amount_due_online, 'topup')
        svc.pay_order(c, order.id)
        svc.fulfill(order.id, s)
        return s, order

    def test_default_zero_books_nothing(self):
        from apps.orders.models import SellerLedger
        s, _ = self._cash_order(None)
        self.assertFalse(SellerLedger.objects.filter(seller=s).exists())

    def test_cash_commission_becomes_seller_debt_and_revenue(self):
        from apps.adminpanel.reports import bmg_revenue
        from apps.orders.models import SellerLedger
        s, order = self._cash_order(4)
        e = SellerLedger.objects.get(seller=s)
        self.assertEqual((e.kind, e.amount), ('cash_comm', Decimal('-1200.00')))   # 4% of 30000 goods, not delivery
        order.refresh_from_db()
        self.assertEqual(bmg_revenue(order), order.prepayment + Decimal('1200'))
