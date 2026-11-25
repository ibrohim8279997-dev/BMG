"""Reviews/ratings, bypass flags, revenue (MRR/ARR), seller quality, CSV exports, AI descriptions, SEO price pages."""
import json
from datetime import timedelta
from decimal import Decimal
from unittest import mock

import pyotp
from django.test import override_settings
from django.utils import timezone

from apps.accounts.models import StaffMembership, StaffRole, TotpDevice, User
from apps.adminpanel.views import new_backup_codes
from apps.ai import service as ai
from apps.audit.models import AuditLog
from apps.catalog.models import Category
from apps.core.models import Setting
from apps.orders.models import Order, OrderItem, Refund
from apps.support.models import Complaint, Review

from .base import Base
from .test_admin_calc_ai import PW


def make_order(client, seller, status='completed', mode='full', commission='100', total='1000', days_ago=0,
               fulfilled=True):
    o = Order.objects.create(client=client, city='Tashkent', status=status, payment_mode=mode,
                             goods_total=Decimal(total), delivery_total=0, total=Decimal(total),
                             prepayment=Decimal('50'), amount_due_online=Decimal(total),
                             amount_paid=Decimal(total), commission_total=Decimal(commission))
    OrderItem.objects.create(order=o, seller=seller, product_name='Cement', qty=1, unit_price=Decimal(total),
                             commission_percent=10, commission_amount=Decimal(commission), fulfilled=fulfilled)
    if days_ago:
        Order.objects.filter(pk=o.pk).update(created_at=timezone.now() - timedelta(days=days_ago))
    return o


class ReviewTests(Base):
    def setUp(self):
        super().setUp()
        self.s = self.seller()
        self.c = self.user()
        self.login(self.c)

    def post(self, o, rating=5, **kw):
        return self.api.post('/api/v1/reviews', dict(order_id=o.id, seller_id=self.s.id, rating=rating, **kw),
                             format='json')

    def test_review_after_delivery_updates_rating(self):
        o = make_order(self.c, self.s)
        self.assertEqual(self.post(o, 4, text='ok').status_code, 201)
        self.s.refresh_from_db()
        self.assertEqual(self.s.rating, Decimal('4.00'))

    def test_rating_is_the_average(self):
        for r in (5, 3):
            self.post(make_order(self.c, self.s), r)
        self.s.refresh_from_db()
        self.assertEqual(self.s.rating, Decimal('4.00'))

    def test_not_before_delivery(self):
        self.assertEqual(self.post(make_order(self.c, self.s, status='paid', fulfilled=False)).status_code, 400)

    def test_one_review_per_order_and_seller(self):
        o = make_order(self.c, self.s)
        self.assertEqual(self.post(o).status_code, 201)
        self.assertEqual(self.post(o).status_code, 400)

    def test_cannot_review_someone_elses_order(self):
        o = make_order(self.user(), self.s)
        self.assertEqual(self.post(o).status_code, 404)

    def test_cannot_review_a_seller_not_in_the_order(self):
        o = make_order(self.c, self.s)
        other = self.seller()
        r = self.api.post('/api/v1/reviews', dict(order_id=o.id, seller_id=other.id, rating=5), format='json')
        self.assertEqual(r.status_code, 400)

    def test_rating_range_and_sellers_cannot_review(self):
        o = make_order(self.c, self.s)
        for bad in (0, 6, 'x'):
            self.assertEqual(self.post(o, bad).status_code, 400)
        self.login(self.s.user)
        self.assertEqual(self.post(o).status_code, 403)

    def test_pending_list_then_empty_after_review(self):
        o = make_order(self.c, self.s)
        self.assertEqual(len(self.api.get('/api/v1/reviews').json()), 1)
        self.post(o)
        self.assertEqual(self.api.get('/api/v1/reviews').json(), [])

    def test_public_list_hides_the_author(self):
        self.post(make_order(self.c, self.s), 5, text='great')
        self.api.force_authenticate(None)
        body = self.api.get(f'/api/v1/sellers/{self.s.id}/reviews').json()
        self.assertEqual(body['count'], 1)
        self.assertNotIn('author', json.dumps(body))
        self.assertNotIn(self.c.phone, json.dumps(body))
        prof = self.api.get(f'/api/v1/sellers/{self.s.id}').json()
        self.assertEqual(prof['review_count'], 1)


@override_settings(ADMIN_ALLOWED_IPS=['10.0.0.1'])
class AdminReports(Base):
    def setUp(self):
        super().setUp()
        self.boss = User.objects.create_superuser('boss', password=PW, role='staff')
        self.secret = pyotp.random_base32()
        TotpDevice.objects.create(user=self.boss, secret=self.secret)
        r = self.api.post('/admin-api/login', {'username': 'boss', 'password': PW, 'otp': pyotp.TOTP(self.secret).now()},
                          format='json', REMOTE_ADDR='10.0.0.1')
        self.assertEqual(r.status_code, 200)
        self.s = self.seller()
        self.c = self.user()

    def get(self, url):
        return self.api.get(url, REMOTE_ADDR='10.0.0.1')

    def send(self, method, url, data=None):
        return getattr(self.api, method)(url, data or {}, format='json', REMOTE_ADDR='10.0.0.1')

    # --- revenue
    def test_mrr_arr_from_last_full_month(self):
        last_month = (timezone.now().replace(day=1) - timedelta(days=5))
        days = (timezone.now() - last_month).days
        make_order(self.c, self.s, commission='300', days_ago=days)               # online order: commission counts
        make_order(self.c, self.s, mode='cash', commission='999', days_ago=days)  # cash order: prepayment (50) counts
        make_order(self.c, self.s, status='cancelled', commission='777', days_ago=days)   # cancelled: not revenue
        d = self.get('/admin-api/analytics/revenue').json()
        self.assertEqual(Decimal(d['mrr']), Decimal('350'))
        self.assertEqual(Decimal(d['arr']), Decimal('4200'))
        self.assertEqual(len(d['series']), 12)
        self.assertEqual(Decimal(d['sellers'][0]['commission']), Decimal('300'))   # only online orders pay commission

    def test_revenue_needs_finance_permission(self):
        staff = User.objects.create_user('acc', password=PW, is_staff=True, role='staff')
        role = StaffRole.objects.create(name='support-only', permissions=['support'])
        StaffMembership.objects.create(user=staff, role=role, granted_by=self.boss)
        sec = pyotp.random_base32()
        TotpDevice.objects.create(user=staff, secret=sec)
        self.api.post('/admin-api/logout', {}, format='json', REMOTE_ADDR='10.0.0.1')
        self.api.post('/admin-api/login', {'username': 'acc', 'password': PW, 'otp': pyotp.TOTP(sec).now()},
                      format='json', REMOTE_ADDR='10.0.0.1')
        self.assertEqual(self.get('/admin-api/analytics/revenue').status_code, 403)
        self.assertEqual(self.get('/admin-api/export/orders').status_code, 403)

    # --- seller quality
    def test_seller_labels(self):
        good, bad = self.s, self.seller()
        for _ in range(3):
            make_order(self.c, good)
        for _ in range(2):
            Refund.objects.create(order=make_order(self.c, bad, status='cancelled'), fault='seller', amount=1)
        rows = {r['seller_id']: r for r in self.get('/admin-api/analytics/sellers').json()}
        self.assertEqual(rows[good.id]['label'], 'good')
        self.assertEqual(rows[bad.id]['label'], 'bad')
        self.assertEqual(rows[bad.id]['seller_fault_refunds'], 2)
        only_bad = self.get('/admin-api/analytics/sellers?label=bad').json()
        self.assertEqual([r['seller_id'] for r in only_bad], [bad.id])

    def test_many_complaints_make_a_seller_bad(self):
        for _ in range(3):
            Complaint.objects.create(author=self.c, seller=self.s, text='x')
        row = self.get('/admin-api/analytics/sellers').json()[0]
        self.assertEqual(row['label'], 'bad')

    # --- bypass
    def reveal(self, user, seller, staff=False):
        return AuditLog.objects.create(actor=user, action='seller_phone_revealed', object_type='seller',
                                       object_id=str(seller.id), meta={'by_staff': True} if staff else {})

    def test_bypass_flag_for_cancelled_order(self):
        self.reveal(self.c, self.s)
        make_order(self.c, self.s, status='cancelled')
        f = self.get('/admin-api/analytics/bypass').json()
        self.assertEqual(len(f), 1)
        self.assertEqual((f[0]['client_id'], f[0]['seller_id'], f[0]['reason']), (self.c.id, self.s.id, 'order_cancelled'))

    def test_bypass_flag_for_stale_paid_order_only_after_the_window(self):
        self.reveal(self.c, self.s)
        o = make_order(self.c, self.s, status='paid', fulfilled=False)
        self.assertEqual(self.get('/admin-api/analytics/bypass').json(), [])      # just paid: too early
        Order.objects.filter(pk=o.pk).update(created_at=timezone.now() - timedelta(days=5))
        AuditLog.objects.filter(action='seller_phone_revealed').update(created_at=timezone.now() - timedelta(days=6))
        self.assertEqual(self.get('/admin-api/analytics/bypass').json()[0]['reason'], 'order_open')

    def test_no_flag_when_the_deal_closed_or_for_staff_reveals(self):
        self.reveal(self.c, self.s)
        make_order(self.c, self.s, status='cancelled')
        make_order(self.c, self.s, status='completed')        # a closed deal clears it
        self.reveal(self.boss, self.s, staff=True)
        self.assertEqual(self.get('/admin-api/analytics/bypass').json(), [])

    def test_reveal_without_any_order_is_not_flagged(self):
        self.reveal(self.c, self.s)
        self.assertEqual(self.get('/admin-api/analytics/bypass').json(), [])

    # --- exports
    def test_csv_export_content_and_audit(self):
        make_order(self.c, self.s)
        r = self.get('/admin-api/export/orders')
        self.assertEqual(r.status_code, 200)
        self.assertIn('text/csv', r['Content-Type'])
        lines = r.content.decode().strip().splitlines()
        self.assertTrue(lines[0].startswith('id,created_at,status'))
        self.assertEqual(len(lines), 2)
        self.assertTrue(AuditLog.objects.filter(action='report_exported', object_id='orders').exists())

    def test_csv_blocks_formula_injection(self):
        from apps.adminpanel.reports import safe
        for v in ('=1+1', '+1', '-1', '@x'):
            self.assertTrue(safe(v).startswith("'"))
        self.assertEqual(safe('Cement'), 'Cement')

    def test_every_export_kind_works_and_unknown_is_404(self):
        make_order(self.c, self.s)
        from apps.adminpanel.reports import EXPORTS
        for k in EXPORTS:
            self.assertEqual(self.get(f'/admin-api/export/{k}').status_code, 200, k)
        self.assertEqual(self.get('/admin-api/export/nope').status_code, 404)

    # --- review moderation
    def test_hidden_review_does_not_count(self):
        o = make_order(self.c, self.s)
        r = Review.objects.create(author=self.c, seller=self.s, order=o, rating=1)
        self.s.recompute_rating()
        self.assertEqual(self.send('patch', f'/admin-api/reviews/{r.id}', {'hidden': True}).status_code, 200)
        self.s.refresh_from_db()
        self.assertEqual(self.s.reviews.filter(hidden=False).count(), 0)

    # --- verified badge
    def test_approval_sets_the_bmg_badge(self):
        s = self.seller(status='pending')
        self.assertFalse(self.api.get(f'/api/v1/sellers/{s.id}').status_code == 200)
        self.send('patch', f'/admin-api/sellers/{s.id}', {'status': 'approved'})
        s.refresh_from_db()
        self.assertIsNotNone(s.approved_at)
        self.assertTrue(self.api.get(f'/api/v1/sellers/{s.id}').json()['verified_by_bmg'])
        self.send('patch', f'/admin-api/sellers/{s.id}', {'status': 'blocked'})
        s.refresh_from_db()
        self.assertIsNone(s.approved_at)

    # --- support contacts
    def test_support_contacts_are_editable_and_public(self):
        r = self.send('put', '/admin-api/settings', {'support_phone': '+998 71 000 00 00', 'support_email': 'help@bmg.example'})
        self.assertEqual(r.status_code, 200, r.content)
        pub = self.api.get('/api/v1/config').json()
        self.assertEqual(pub['email'], 'help@bmg.example')
        self.assertEqual(self.send('put', '/admin-api/settings', {'support_phone': 'x' * 101}).status_code, 400)
        self.assertEqual(self.send('put', '/admin-api/settings', {'support_phone': 5}).status_code, 400)

    # --- AI category description: drafted by AI, hidden until staff approve
    def test_ai_description_stays_hidden_until_reviewed(self):
        c = self.category('cement')
        payload = json.dumps({'uz': 'uz matn', 'ru': 'ru текст', 'en': 'en text'})
        with mock.patch.object(ai, 'complete', return_value=payload):
            r = self.send('post', '/admin-api/categories/cement/describe')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.api.get('/api/v1/categories/cement?lang=ru').json()['description'], '')
        self.send('patch', '/admin-api/categories/cement', {'reviewed': True})
        self.assertEqual(self.api.get('/api/v1/categories/cement?lang=ru').json()['description'], 'ru текст')
        self.send('patch', '/admin-api/categories/cement', {'ru': 'edited'})      # an edit needs a new approval
        self.assertEqual(self.api.get('/api/v1/categories/cement?lang=ru').json()['description'], '')

    def test_ai_description_unavailable_and_garbage(self):
        self.category('cement')
        with mock.patch.object(ai, 'complete', side_effect=ai.AIUnavailable()):
            self.assertEqual(self.send('post', '/admin-api/categories/cement/describe').status_code, 503)
        with mock.patch.object(ai, 'complete', return_value='not json'):
            self.assertEqual(self.send('post', '/admin-api/categories/cement/describe').status_code, 502)
        self.assertEqual(Category.objects.get(slug='cement').description_ru, '')   # nothing invented


class SeoPricePages(Base):
    def test_city_filter_and_price_pages_and_sitemap(self):
        tash = self.seller(city='Tashkent')
        sam = self.seller(city='Samarkand')
        self.offer(tash, price=1000, cat='cement', name='Cement A')
        self.offer(sam, price=2000, cat='cement', name='Cement B')
        names = lambda q: {p['name'] for p in self.api.get(f'/api/v1/products?{q}').json()['results']}
        self.assertEqual(names('category=cement&city=Tashkent'), {'Cement A'})
        self.assertEqual(names('category=cement&city=samarkand'), {'Cement B'})      # case-insensitive
        self.assertEqual(names('category=cement'), {'Cement A', 'Cement B'})
        pages = self.api.get('/api/v1/seo/price-pages').json()
        self.assertIn({'category': 'cement', 'city': 'Tashkent'}, pages)
        sm = self.api.get('/sitemap.xml').content.decode()
        self.assertIn('/ru/prices/cement/Tashkent', sm)
        self.assertIn('hreflang="uz"', sm)

    def test_no_page_for_a_city_without_offers(self):
        s = self.seller(city='Tashkent')
        self.assertEqual(self.api.get('/api/v1/seo/price-pages').json(), [])
        self.offer(s, stock=0)
        self.assertEqual(self.api.get('/api/v1/seo/price-pages').json(), [])
