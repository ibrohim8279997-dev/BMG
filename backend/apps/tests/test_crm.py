"""Nexio CRM integration: signature, outbox + retries, per-order ordering, pull API pagination and auth."""
import hashlib
import hmac
import json
from datetime import timedelta
from decimal import Decimal
from unittest import mock

import pyotp
import requests
from django.db import transaction
from django.test import override_settings
from django.utils import timezone

from apps.accounts.models import TotpDevice, User
from apps.crm import events, sender
from apps.crm.mask import mask
from apps.crm.models import CrmEvent
from apps.orders import services as osvc
from apps.orders.models import CartItem, Order
from apps.payments import wallet

from .base import Base
from .test_admin_calc_ai import PW

CRM = dict(CRM_BASE_URL='https://crm.test', CRM_API_KEY='nxk_testkey123456', CRM_WEBHOOK_SECRET='s3cret')
READ = dict(BMG_CRM_READ_KEY='read-key-0123456789', CRM_READ_ALLOWED_IPS=[], CRM_READ_REQUIRE_HTTPS=False)


def resp(code, text='{}', headers=None):
    r = mock.Mock(status_code=code, text=text)
    r.headers = headers or {}
    return r


class CrmBase(Base):
    def setUp(self):
        super().setUp()
        self.s = self.seller(delivery=1000)
        self.o = self.offer(self.s, price=10000, stock=500)
        self.c = self.user()
        self.c.email = 'buyer@example.com'
        self.c.save()

    def new_order(self, mode='full', qty=2):
        CartItem.objects.create(user=self.c, offer=self.o, qty=Decimal(qty))
        return osvc.create_order(self.c, 'Tashkent', mode)

    def paid_order(self, **kw):
        o = self.new_order(**kw)
        wallet.change(self.c, Decimal('1000000'), 'topup')
        return osvc.pay_order(self.c, o.id)

    def due_now(self):
        CrmEvent.objects.update(next_attempt_at=timezone.now() - timedelta(seconds=1))


@override_settings(**CRM)
class Outbox(CrmBase):
    def test_lifecycle_events_versions_and_full_snapshot(self):
        o = self.new_order()
        self.assertEqual(CrmEvent.objects.count(), 0)         # not placed yet: waiting for payment
        o = self.paid_order()
        osvc.fulfill(o.id, self.s)
        osvc.refund_order(o.id, 'seller', None)
        evs = list(CrmEvent.objects.filter(order=o).order_by('order_version'))
        self.assertEqual([(e.event_type, e.order_version) for e in evs],
                         [('order.created', 1), ('order.paid', 2), ('order.completed', 3),
                          ('order.refunded', 4), ('order.cancelled', 5)])
        body = json.loads(evs[0].body)
        self.assertTrue(body['event_id'].startswith('evt_'))
        self.assertEqual(body['event_id'], evs[0].event_id)
        d = body['data']
        self.assertEqual(d['external_order_id'], Order.objects.get(pk=o.id).external_id)
        self.assertEqual(d['customer']['phone'], self.c.phone)
        self.assertEqual(d['subtotal'], 20000.0)
        self.assertEqual(d['delivery_fee'], 1000.0)
        self.assertEqual(d['total'], d['subtotal'] - d['discount_total'] + d['delivery_fee'])
        self.assertEqual(d['payment']['status'], 'paid')
        self.assertTrue(d['vat_included'])
        self.assertEqual(d['seller']['id'], str(self.s.id))
        last = json.loads(evs[-1].body)['data']
        self.assertEqual(last['status'], 'refunded')
        self.assertEqual(last['cancel_reason'], 'seller_fault')
        self.assertEqual(last['refunds'][0]['amount'], 21000.0)
        self.assertEqual(Order.objects.get(pk=o.id).version, 5)

    def test_external_id_is_unique_and_never_changes(self):
        a, b = self.paid_order(), self.paid_order()
        ext = Order.objects.get(pk=a.id).external_id
        self.assertNotEqual(ext, Order.objects.get(pk=b.id).external_id)
        osvc.fulfill(a.id, self.s)
        self.assertEqual(Order.objects.get(pk=a.id).external_id, ext)

    def test_event_rolls_back_with_the_order(self):
        o = self.new_order()
        wallet.change(self.c, Decimal('1000000'), 'topup')
        with self.assertRaises(RuntimeError):
            with transaction.atomic():
                osvc.pay_order(self.c, o.id)
                raise RuntimeError('boom')
        self.assertEqual(CrmEvent.objects.count(), 0)
        self.assertEqual(Order.objects.get(pk=o.id).status, 'pending_payment')

    def test_emit_outside_transaction_is_refused(self):
        o = self.new_order()
        with mock.patch('apps.crm.events.transaction.get_connection') as gc:
            gc.return_value.in_atomic_block = False
            with self.assertRaises(RuntimeError):
                events.emit(o, 'order.updated')


@override_settings(**CRM)
class Signature(CrmBase):
    def test_signature_is_hmac_of_timestamp_dot_raw_body(self):
        body = b'{"a":1}'
        want = 'sha256=' + hmac.new(b's3cret', b'1700000000.' + body, hashlib.sha256).hexdigest()
        self.assertEqual(sender.sign('s3cret', 1700000000, body), want)

    def test_request_headers_and_body_match_what_is_signed(self):
        self.paid_order()
        with mock.patch('apps.crm.sender.requests.post', return_value=resp(200)) as p:
            sender.process_due()
        url = p.call_args_list[0].args[0]
        kw = p.call_args_list[0].kwargs
        self.assertEqual(url, 'https://crm.test/api/v1/integrations/bmg/events')
        h, body = kw['headers'], kw['data']
        self.assertEqual(h['Authorization'], 'Bearer nxk_testkey123456')
        self.assertEqual(h['Content-Type'], 'application/json')
        self.assertEqual(h['X-BMG-Signature'], sender.sign('s3cret', h['X-BMG-Timestamp'], body))
        self.assertEqual(body, CrmEvent.objects.get(order_version=1).body.encode())
        self.assertFalse(kw['allow_redirects'])

    @override_settings(CRM_BASE_URL='http://crm.test', DEBUG=False)
    def test_plain_http_is_refused(self):
        self.paid_order()
        with mock.patch('apps.crm.sender.requests.post') as p:
            sender.process_due()
        p.assert_not_called()
        self.assertEqual(CrmEvent.objects.get(order_version=1).status, 'failed')

    @override_settings(CRM_BASE_URL='')
    def test_not_configured_sends_nothing_but_keeps_the_queue(self):
        self.paid_order()
        with mock.patch('apps.crm.sender.requests.post') as p:
            self.assertEqual(sender.process_due(), 0)
        p.assert_not_called()
        self.assertEqual(CrmEvent.objects.filter(status='pending').count(), 2)


@override_settings(**CRM)
class Retries(CrmBase):
    def one(self, response):
        """Send only the first event of a fresh paid order."""
        o = self.paid_order()
        e = CrmEvent.objects.get(order=o, order_version=1)
        CrmEvent.objects.exclude(pk=e.pk).update(next_attempt_at=timezone.now() + timedelta(days=9))
        kw = {'side_effect': response} if isinstance(response, Exception) else {'return_value': response}
        with mock.patch('apps.crm.sender.requests.post', **kw):
            sender.process_due()
        e.refresh_from_db()
        return e

    def test_2xx_and_409_are_delivered(self):
        self.assertEqual(self.one(resp(202)).status, 'delivered')
        e = self.one(resp(409, '{"error":"duplicate"}'))
        self.assertEqual(e.status, 'delivered')
        self.assertIsNotNone(e.delivered_at)

    def test_5xx_and_timeout_retry_with_schedule(self):
        before = timezone.now()
        e = self.one(resp(503))
        self.assertEqual((e.status, e.attempts), ('pending', 1))
        self.assertTrue(timedelta(seconds=53) <= e.next_attempt_at - before <= timedelta(seconds=67))
        e = self.one(requests.Timeout('read timed out'))
        self.assertEqual(e.status, 'pending')
        self.assertIn('Timeout', e.last_error)

    def test_429_honours_retry_after(self):
        before = timezone.now()
        e = self.one(resp(429, headers={'Retry-After': '600'}))
        self.assertEqual(e.status, 'pending')
        self.assertGreaterEqual(e.next_attempt_at - before, timedelta(seconds=599))

    def test_client_errors_fail_at_once_and_log_masked_body(self):
        for code in (400, 401, 403, 422):
            e = self.one(resp(code, '{"error":"bad phone +998901234567 inn 123456789"}'))
            self.assertEqual((e.status, e.attempts, e.last_status_code), ('failed', 1, code))
            self.assertNotIn('901234567', e.last_error)
            self.assertNotIn('123456789', e.last_error)

    def test_backoff_sequence_then_failed(self):
        self.paid_order()
        e = CrmEvent.objects.get(order_version=1)
        delays = []
        with mock.patch('apps.crm.sender.requests.post', return_value=resp(500)), \
                mock.patch('apps.crm.sender.random.uniform', return_value=1.0):
            for _ in range(7):
                CrmEvent.objects.filter(pk=e.pk).update(next_attempt_at=timezone.now())
                t0 = timezone.now()
                sender.process_due()
                e.refresh_from_db()
                if e.status == 'pending':
                    delays.append(round((e.next_attempt_at - t0).total_seconds()))
        self.assertEqual(delays, [60, 300, 900, 3600, 21600, 86400])
        self.assertEqual((e.status, e.attempts), ('failed', 7))

    def test_not_due_is_not_sent_and_resend_requeues(self):
        e = self.one(resp(500))
        with mock.patch('apps.crm.sender.requests.post') as p:
            sender.process_due()
        p.assert_not_called()                                   # retry is 1 minute away
        e.status = 'failed'
        e.save()
        sender.resend(e)
        e.refresh_from_db()
        self.assertEqual((e.status, e.attempts), ('pending', 0))

    def test_claimed_row_is_not_sent_twice(self):
        self.paid_order()
        CrmEvent.objects.update(locked_until=timezone.now() + timedelta(minutes=1))
        with mock.patch('apps.crm.sender.requests.post') as p:
            sender.process_due()
        p.assert_not_called()


@override_settings(**CRM)
class Ordering(CrmBase):
    def test_events_of_one_order_go_out_by_version(self):
        o = self.paid_order()
        osvc.fulfill(o.id, self.s)                             # versions 1, 2, 3
        sent = []

        def fake(url, data, **kw):
            sent.append(json.loads(data)['order_version'])
            return resp(500) if sent == [1] else resp(200)
        with mock.patch('apps.crm.sender.requests.post', side_effect=fake):
            sender.process_due()                              # v1 fails -> v2, v3 must wait
            self.assertEqual(sent, [1])
            self.assertTrue(sender.blocked(CrmEvent.objects.get(order_version=2)))
            self.due_now()
            sender.process_due()
        self.assertEqual(sent, [1, 1, 2, 3])
        self.assertEqual(CrmEvent.objects.filter(status='delivered').count(), 3)

    def test_failed_event_blocks_later_versions_of_same_order_only(self):
        a = self.paid_order()
        b = self.paid_order()
        sent = []

        def fake(url, data, **kw):
            d = json.loads(data)
            sent.append((d['data']['order_number'], d['order_version']))
            return resp(422) if d['data']['order_number'] == a.number else resp(200)
        with mock.patch('apps.crm.sender.requests.post', side_effect=fake):
            sender.process_due()
        self.assertEqual(sent, [(a.number, 1), (b.number, 1), (b.number, 2)])


@override_settings(**READ)
class PullApi(CrmBase):
    def get(self, url, key='read-key-0123456789', **kw):
        h = {'HTTP_AUTHORIZATION': f'Bearer {key}'} if key else {}
        return self.api.get(url, **h, **kw)

    def test_auth_required(self):
        self.assertEqual(self.get('/api/crm/v1/orders', key=None).status_code, 401)
        self.assertEqual(self.get('/api/crm/v1/orders', key='wrong').status_code, 401)
        self.assertEqual(self.get('/api/crm/v1/orders').status_code, 200)
        with override_settings(BMG_CRM_READ_KEY=''):
            self.assertEqual(self.get('/api/crm/v1/orders', key='').status_code, 401)
        self.login(self.c)                                     # a site session is not enough
        self.assertEqual(self.get('/api/crm/v1/orders', key=None).status_code, 401)

    @override_settings(CRM_READ_ALLOWED_IPS=['10.9.9.9'])
    def test_ip_allowlist(self):
        self.assertEqual(self.get('/api/crm/v1/orders').status_code, 401)
        self.assertEqual(self.get('/api/crm/v1/orders', REMOTE_ADDR='10.9.9.9').status_code, 200)

    @override_settings(CRM_READ_REQUIRE_HTTPS=True, DEBUG=False)
    def test_https_required(self):
        self.assertEqual(self.get('/api/crm/v1/orders').status_code, 401)
        self.assertEqual(self.get('/api/crm/v1/orders', secure=True).status_code, 200)

    def test_pagination_by_updated_at_with_cursor(self):
        ids = [self.paid_order().id for _ in range(5)]
        base = timezone.now() - timedelta(hours=1)
        for n, i in enumerate(ids):                            # two orders share one timestamp (tie on id)
            Order.objects.filter(pk=i).update(updated_at=base + timedelta(minutes=min(n, 3)))
        seen, cursor, pages = [], None, 0
        while True:
            r = self.get('/api/crm/v1/orders?limit=2' + (f'&cursor={cursor}' if cursor else ''))
            self.assertEqual(r.status_code, 200)
            j = r.json()
            seen += [d['order_number'] for d in j['data']]
            pages += 1
            cursor = j['next_cursor']
            if not cursor:
                break
        self.assertEqual(pages, 3)
        self.assertEqual(seen, [Order.objects.get(pk=i).number for i in ids])
        since = (base + timedelta(minutes=3)).isoformat().replace('+00:00', 'Z')
        r = self.get('/api/crm/v1/orders', data={'updated_since': since}).json()
        self.assertEqual(len(r['data']), 2)
        self.assertIsNone(r['next_cursor'])

    def test_same_format_as_webhook_and_detail(self):
        with override_settings(**CRM):
            o = self.paid_order()
        ext = Order.objects.get(pk=o.id).external_id
        r = self.get(f'/api/crm/v1/orders/{ext}')
        self.assertEqual(r.status_code, 200)
        hook = json.loads(CrmEvent.objects.filter(order=o).order_by('-order_version').first().body)['data']
        self.assertEqual(set(r.json()), set(hook))
        self.assertEqual(r.json()['total'], hook['total'])
        self.assertEqual(self.get('/api/crm/v1/orders/ord_nope').status_code, 404)

    def test_bad_params(self):
        for q in ('cursor=%%%', 'limit=0', 'limit=abc', 'updated_since=yesterday'):
            r = self.get(f'/api/crm/v1/orders?{q}')
            self.assertEqual(r.status_code, 400, q)
        self.assertEqual(self.get('/api/crm/v1/reports/daily?date=2026-13-01').status_code, 400)

    def test_payments_refunds_settlements_pages(self):
        orders = [self.paid_order() for _ in range(3)]
        osvc.fulfill(orders[0].id, self.s)
        osvc.refund_order(orders[1].id, 'bmg', None)
        today = timezone.localdate().isoformat()
        p1 = self.get(f'/api/crm/v1/payments?from={today}&to={today}&limit=2').json()
        p2 = self.get(f'/api/crm/v1/payments?limit=2&cursor={p1["next_cursor"]}').json()
        self.assertEqual(len(p1['data']) + len(p2['data']), 3)
        self.assertIsNone(p2['next_cursor'])
        self.assertEqual(p1['data'][0]['amount'], 21000.0)
        self.assertEqual(p1['data'][0]['external_order_id'], Order.objects.get(pk=orders[0].id).external_id)
        rf = self.get(f'/api/crm/v1/refunds?from={today}').json()['data']
        self.assertEqual([x['reason'] for x in rf], ['bmg_fault'])
        st = self.get('/api/crm/v1/settlements').json()['data']
        self.assertEqual(st[0]['kind'], 'sale')
        tomorrow = (timezone.localdate() + timedelta(days=1)).isoformat()
        self.assertEqual(self.get(f'/api/crm/v1/payments?from={tomorrow}').json()['data'], [])

    def test_daily_report(self):
        a, b = self.paid_order(), self.paid_order()
        osvc.fulfill(a.id, self.s)
        osvc.refund_order(b.id, 'bmg', None)
        r = self.get(f'/api/crm/v1/reports/daily?date={timezone.localdate().isoformat()}').json()
        self.assertEqual(r['orders_count'], 2)
        self.assertEqual(r['orders_total'], 42000.0)
        self.assertEqual(r['revenue_received'], 42000.0)
        self.assertEqual(r['refunds_total'], 21000.0)
        self.assertEqual(r['orders_completed'], 1)
        self.assertEqual(r['orders_cancelled'], 1)
        self.assertEqual(r['commission_total'], 1200.0)        # 3% of 20000, twice
        self.assertEqual(r['by_payment_method'], {'click': {'orders': 2, 'total': 42000.0}})

    def test_rate_limit_has_retry_after(self):
        from apps.crm.api import CrmThrottle
        with mock.patch.object(CrmThrottle, 'THROTTLE_RATES', {'crm_read': '3/min'}):
            codes = [self.get('/api/crm/v1/orders', key='wrong').status_code for _ in range(4)]
            self.assertEqual(codes[:3], [401, 401, 401])          # wrong keys count too
            r = self.get('/api/crm/v1/orders')
        self.assertEqual(r.status_code, 429)
        self.assertIn('Retry-After', r)


class Masking(Base):
    def test_mask(self):
        s = mask('call +998 90 123 45 67 or 998901234567, inn 123456789, a.user@mail.uz, key nxk_abcDEF123')
        for leak in ('123 45', '901234567', '123456789', 'a.user', 'abcDEF'):
            self.assertNotIn(leak, s)
        self.assertIn('4567', s)


@override_settings(ADMIN_ALLOWED_IPS=['10.0.0.1'], **CRM)
class AdminCrm(CrmBase):
    def admin(self):
        u = User.objects.create_user('crmadmin', password=PW, is_staff=True, is_superuser=True, role='staff')
        sec = pyotp.random_base32()
        TotpDevice.objects.create(user=u, secret=sec)
        self.api.post('/admin-api/login', {'username': u.username, 'password': PW, 'otp': pyotp.TOTP(sec).now()},
                      format='json', REMOTE_ADDR='10.0.0.1')

    def test_overview_test_event_and_resend(self):
        self.paid_order()
        self.admin()
        r = self.api.get('/admin-api/crm', REMOTE_ADDR='10.0.0.1').json()
        self.assertEqual(r['config']['api_key'], '********3456')          # never the full key
        self.assertNotIn('s3cret', json.dumps(r))
        self.assertEqual(r['counts']['pending'], 2)
        self.assertEqual(len(r['events']), 2)
        with mock.patch('apps.crm.sender.requests.post', return_value=resp(200)) as p:
            t = self.api.post('/admin-api/crm/test', {}, format='json', REMOTE_ADDR='10.0.0.1').json()
        self.assertEqual(t['status'], 'delivered')
        self.assertTrue(json.loads(p.call_args.kwargs['data'])['data']['test'])
        e = CrmEvent.objects.filter(is_test=False).first()
        e.status = 'failed'
        e.save()
        r = self.api.post(f'/admin-api/crm/events/{e.id}/resend', {}, format='json', REMOTE_ADDR='10.0.0.1')
        self.assertEqual(r.json()['status'], 'pending')

    def test_requires_admin(self):
        self.login(self.c)
        self.assertEqual(self.api.get('/admin-api/crm').status_code, 403)
