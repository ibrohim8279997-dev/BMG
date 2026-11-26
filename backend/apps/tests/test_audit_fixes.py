"""Regression tests for the fixes from the 25.11.2026 security audit (findings are numbered as in the report)."""
from decimal import Decimal
from unittest import mock

import pyotp
from django.core.cache import cache
from django.test import override_settings

from apps.accounts.models import BackupCode, TotpDevice, User
from apps.adminpanel.views import legacy_hash_code
from apps.ai import service as ai
from apps.ai.models import AIUsage
from apps.audit.models import AuditLog
from apps.catalog import ai_import
from apps.core.models import Setting
from apps.core.utils import client_ip
from apps.sellers.models import Seller

from .base import Base


def setting(**kw):
    for k, v in kw.items():
        Setting.objects.update_or_create(key=k, defaults={'value': v})


class ForwardedHeaders(Base):          # 4, 21
    def meta(self, path='/api/v1/config', **extra):
        from django.test import RequestFactory

        from apps.core.middleware import TrustedProxyMiddleware
        seen = {}
        mw = TrustedProxyMiddleware(lambda r: seen.setdefault('r', r))
        mw(RequestFactory().get(path, **extra))
        return seen['r']

    @override_settings(TRUSTED_PROXY_IPS=['127.0.0.1'])
    def test_untrusted_peer_cannot_pick_ip_or_claim_https(self):
        r = self.meta(REMOTE_ADDR='203.0.113.9', HTTP_X_FORWARDED_FOR='10.0.0.1', HTTP_X_FORWARDED_PROTO='https')
        self.assertNotIn('HTTP_X_FORWARDED_FOR', r.META)
        self.assertNotIn('HTTP_X_FORWARDED_PROTO', r.META)
        with override_settings(REST_FRAMEWORK={'NUM_PROXIES': 1}):
            from rest_framework.settings import api_settings
            api_settings.reload()
            try:
                self.assertEqual(client_ip(r), '203.0.113.9')
            finally:
                api_settings.reload()

    @override_settings(TRUSTED_PROXY_IPS=['127.0.0.1'])
    def test_trusted_proxy_headers_are_kept(self):
        r = self.meta(REMOTE_ADDR='127.0.0.1', HTTP_X_FORWARDED_FOR='198.51.100.7')
        self.assertEqual(r.META['HTTP_X_FORWARDED_FOR'], '198.51.100.7')


class BotApi(Base):                     # 13, 25
    @override_settings(BOT_API_SECRET='s' * 32, BOT_API_ALLOWED_IPS=['127.0.0.1'])
    def test_bot_api_only_from_the_bot_host(self):
        body = {'telegram_id': 1, 'chat_id': 1, 'phone': '+998901112233'}
        h = {'HTTP_X_BOT_SECRET': 's' * 32}
        self.assertEqual(self.api.post('/api/v1/bot/link', body, format='json', REMOTE_ADDR='203.0.113.5', **h).status_code, 403)
        self.assertEqual(self.api.post('/api/v1/bot/link', body, format='json', REMOTE_ADDR='127.0.0.1', **h).status_code, 200)

    def test_link_preview_shows_account_and_does_not_sign_in(self):
        from apps.accounts.bot_api import login_url
        u = self.user()
        token = login_url(u, 'ru').split('token=')[1]
        r = self.api.post('/api/v1/auth/bot-token', {'token': token, 'preview': True}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data['account'].endswith(u.phone[-2:]))
        self.assertNotIn(u.phone, r.data['account'])                  # masked
        self.assertNotIn('_auth_user_id', self.api.session.keys())   # the preview did not sign anyone in
        self.assertEqual(self.api.post('/api/v1/auth/bot-token', {'token': token}, format='json').data['id'], u.id)


@override_settings(ADMIN_ALLOWED_IPS=['10.0.0.1', '10.0.0.2'])
class AdminLoginHardening(Base):        # 19
    PW = 'correct-horse-battery-1'

    def setUp(self):
        super().setUp()
        self.boss = User.objects.create_superuser('boss', password=self.PW, role='staff')
        self.secret = pyotp.random_base32()
        TotpDevice.objects.create(user=self.boss, secret=self.secret)

    def login(self, ip='10.0.0.1', **extra):
        return self.api.post('/admin-api/login', {'username': 'boss', 'password': self.PW, **extra}, format='json',
                             REMOTE_ADDR=ip)

    def test_failures_from_one_ip_do_not_lock_out_another(self):
        for _ in range(5):
            self.login(otp='000000')
        self.assertEqual(self.login(otp=pyotp.TOTP(self.secret).now()).status_code, 429)   # this IP is locked
        self.assertEqual(self.login(ip='10.0.0.2', otp=pyotp.TOTP(self.secret).now()).status_code, 200)
        self.assertEqual(AuditLog.objects.filter(action='admin_login_failed').first().ip, '10.0.0.1')

    def test_backup_codes_are_long_keyed_and_legacy_still_work(self):
        from apps.adminpanel.views import new_backup_codes
        codes = new_backup_codes(self.boss)
        self.assertTrue(all(len(c) >= 16 for c in codes))
        self.assertNotIn(legacy_hash_code(codes[0]), BackupCode.objects.values_list('code_hash', flat=True))
        self.assertEqual(self.login(backup_code=codes[0]).status_code, 200)
        self.api.logout()
        BackupCode.objects.create(user=self.boss, code_hash=legacy_hash_code('abcd1234'))   # issued before the change
        self.assertEqual(self.login(backup_code='abcd1234').status_code, 200)


class SellerSide(Base):                 # 7, 8, 15, 16
    def test_requisites_locked_after_approval_and_changes_audited(self):
        s = self.seller()
        self.login(s.user)
        r = self.api.patch('/api/v1/sellers/me', {'inn': '123456789', 'bank_account': '2' * 20, 'bank_mfo': '00014'},
                           format='json')
        self.assertEqual(r.status_code, 200)                                  # empty fields may be filled once
        r = self.api.patch('/api/v1/sellers/me', {'bank_account': '3' * 20}, format='json')
        self.assertEqual((r.status_code, r.data['error']), (400, 'requisites_locked'))
        r = self.api.patch('/api/v1/sellers/me', {'company_name': 'BMG Official'}, format='json')
        self.assertEqual(r.data['error'], 'requisites_locked')
        self.assertEqual(self.api.patch('/api/v1/sellers/me', {'description': 'x' * 50}, format='json').status_code, 200)
        self.assertTrue(AuditLog.objects.filter(action='seller_profile_changed', object_id=str(s.id)).exists())

    def test_company_name_is_capped_and_inn_unique(self):
        a, b = self.seller(status='pending'), self.seller(status='pending')
        Seller.objects.filter(pk=a.pk).update(inn='123456789')
        self.login(b.user)
        self.assertEqual(self.api.patch('/api/v1/sellers/me', {'inn': '123456789'}, format='json').data['error'], 'inn_taken')
        self.api.patch('/api/v1/sellers/me', {'company_name': 'x' * 3000}, format='json')
        b.refresh_from_db()
        self.assertEqual(len(b.company_name), 200)

    def test_delivery_cost_is_capped(self):
        s = self.seller()
        self.login(s.user)
        setting(delivery_cost_max=100000)
        r = self.api.post('/api/v1/sellers/me/delivery-rules', {'region': 'Samarkand', 'cost': '100001'}, format='json')
        self.assertEqual(r.data['error'], 'delivery_cost_too_high')
        for bad in ('Infinity', 'NaN', '-1'):
            self.assertEqual(self.api.post('/api/v1/sellers/me/delivery-rules', {'region': 'S', 'cost': bad},
                                           format='json').status_code, 400)
        self.assertEqual(self.api.post('/api/v1/sellers/me/delivery-rules', {'region': 'Samarkand', 'cost': '50000'},
                                       format='json').status_code, 201)

    def test_phone_reveal_clients_only_no_login_phone_daily_cap(self):
        s = self.seller()
        self.login(self.user('seller'))
        self.assertEqual(self.api.post(f'/api/v1/sellers/{s.id}/phone').status_code, 403)
        c = self.user()
        self.login(c)
        self.assertEqual(self.api.post(f'/api/v1/sellers/{s.id}/phone', {'order_id': 'abc'}, format='json').status_code, 400)
        Seller.objects.filter(pk=s.pk).update(contact_phone='')
        self.assertEqual(self.api.post(f'/api/v1/sellers/{s.id}/phone').status_code, 404)   # never the login phone
        Seller.objects.filter(pk=s.pk).update(contact_phone='+998711112233')
        setting(phone_reveals_per_day=2)
        codes = [self.api.post(f'/api/v1/sellers/{s.id}/phone').status_code for _ in range(3)]
        self.assertEqual(codes, [200, 200, 429])

    def test_import_inn_match_needs_confirmed_contract(self):
        s = self.seller()
        Seller.objects.filter(pk=s.pk).update(inn='123456789', contract_status='pending')
        rows = [['ИНН 123456789'], ['name', 'price']]
        with mock.patch('apps.ai.service.complete', side_effect=ai.AIUnavailable()):
            self.assertIsNone(ai_import.detect_seller(rows, 1, 'x.xlsx', {})['seller_id'])
            Seller.objects.filter(pk=s.pk).update(contract_status='confirmed')
            self.assertEqual(ai_import.detect_seller(rows, 1, 'x.xlsx', {}), {'seller_id': s.id, 'by': 'inn'})
            Seller.objects.filter(pk=s.pk).update(status='pending')               # not approved: never suggested
            self.assertIsNone(ai_import.detect_seller(rows, 1, 'x.xlsx', {})['seller_id'])


class Limits(Base):                     # 10, 11, 23
    def test_ai_daily_quota_per_user(self):
        u = self.user()
        setting(ai_daily_calls_per_user=2)
        AIUsage.objects.bulk_create([AIUsage(provider='claude', kind='ask_client', user=u) for _ in range(2)])
        with self.assertRaises(ai.AIQuotaExceeded):
            ai.complete('s', 'p', 'ask_client', user=u)
        self.assertTrue(issubclass(ai.AIQuotaExceeded, ai.AIUnavailable))   # callers degrade as for "no AI"

    def test_calculate_rejects_long_zone_lists_and_dedupes(self):
        from apps.calculator.models import ObjectRequest
        c = self.user()
        self.login(c)
        o = ObjectRequest.objects.create(user=c, type='house', area=Decimal(100), floors=1, rooms=3, city='Tashkent')
        r = self.api.post(f'/api/v1/objects/{o.id}/calculate', {'zones': ['walls'] * 1000}, format='json')
        self.assertEqual(r.status_code, 400)
        with mock.patch('apps.calculator.views.calculate', return_value={'lines': []}) as calc:
            self.api.post(f'/api/v1/objects/{o.id}/calculate', {'zones': ['walls', 'walls', 'floor']}, format='json')
        self.assertEqual(calc.call_args[0][1], ['walls', 'floor'])

    def test_offer_infinity_and_overflow_are_400(self):
        s = self.seller()
        o = self.offer(s)
        self.login(s.user)
        for bad in ({'price': 'Infinity'}, {'stock': '1e20'}, {'price': '1e15'}):
            self.assertEqual(self.api.patch(f'/api/v1/sellers/me/offers/{o.id}', bad, format='json').status_code, 400)

    def test_crm_cursor_that_is_not_an_object_is_400(self):
        import base64
        from apps.crm.api import BadParam, decode_cursor
        with self.assertRaises(BadParam):
            decode_cursor(base64.urlsafe_b64encode(b'[1, 2]').decode())


class CsvGuard(Base):                   # 22
    def test_tab_and_cr_prefixed_values_are_neutralised(self):
        from apps.accounting.exports import safe as safe_xlsx
        from apps.adminpanel.reports import safe
        for f in (safe, safe_xlsx):
            self.assertEqual(f('\t=HYPERLINK("x")'), '\'\t=HYPERLINK("x")')
            self.assertEqual(f('\r=1+1'), "'\r=1+1")
            self.assertEqual(f('  =1+1'), "'  =1+1")
            self.assertEqual(f('ACME'), 'ACME')
        self.assertEqual(safe_xlsx('-5000'), '-5000')
