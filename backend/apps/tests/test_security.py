import re
from pathlib import Path

from django.conf import settings
from django.test import Client

from apps.accounts.models import User

from .base import Base


class SecurityRegression(Base):
    def test_no_raw_sql_anywhere(self):
        pat = re.compile(r'\.raw\(|\.extra\(|connection\.cursor|RawSQL|cursor\(\)')
        hits = []
        for p in Path(settings.BASE_DIR, 'apps').rglob('*.py'):
            if 'tests' in p.parts or 'migrations' in p.parts:
                continue
            for n, line in enumerate(p.read_text().splitlines(), 1):
                if pat.search(line):
                    hits.append(f'{p}:{n}')
        self.assertEqual(hits, [])

    def test_no_secrets_hardcoded(self):
        pat = re.compile(r'(api[_-]?key|secret|token)\s*=\s*[\'"][A-Za-z0-9_\-]{20,}[\'"]', re.I)
        for p in Path(settings.BASE_DIR, 'apps').rglob('*.py'):
            if 'tests' in p.parts:
                continue
            self.assertIsNone(pat.search(p.read_text()), p)

    def test_security_headers(self):
        r = self.api.get('/api/v1/categories')
        self.assertEqual(r['X-Content-Type-Options'], 'nosniff')
        self.assertEqual(r['X-Frame-Options'], 'DENY')
        self.assertIn("default-src 'none'", r['Content-Security-Policy'])
        self.assertEqual(r['Cache-Control'], 'no-store')
        self.assertEqual(r['Referrer-Policy'], 'same-origin')

    def test_session_cookie_flags(self):
        self.assertTrue(settings.SESSION_COOKIE_HTTPONLY)
        self.assertEqual(settings.SESSION_COOKIE_SAMESITE, 'Lax')

    def test_csrf_enforced_for_authenticated_state_changes(self):
        u = self.user()
        c = Client(enforce_csrf_checks=True)
        c.force_login(u)
        r = c.post('/api/v1/wallet/topup', '{"amount": "5000"}', content_type='application/json')
        self.assertEqual(r.status_code, 403)
        r = c.post('/api/v1/auth/logout')
        self.assertEqual(r.status_code, 403)

    def test_anonymous_cannot_reach_private_endpoints(self):
        for url in ('/api/v1/me', '/api/v1/wallet', '/api/v1/orders', '/api/v1/cart', '/api/v1/objects',
                    '/api/v1/sellers/me', '/api/v1/sellers/me/offers'):
            self.assertIn(self.api.get(url).status_code, (401, 403), url)

    def test_idor_on_numeric_ids_returns_404(self):
        a, b = self.user(), self.user()
        from apps.calculator.models import ObjectRequest
        o = ObjectRequest.objects.create(user=b, type='house', area=50, floors=1, rooms=1, city='T')
        self.login(a)
        self.assertEqual(self.api.post(f'/api/v1/objects/{o.id}/calculate').status_code, 404)

    def test_payload_does_not_leak_hashes_or_secrets(self):
        u = self.user()
        self.login(u)
        body = str(self.api.get('/api/v1/me').json())
        for bad in ('password', 'secret', 'registration_ip', 'telegram_id'):
            self.assertNotIn(bad, body)

    def test_oversized_body_rejected(self):
        r = self.api.post('/api/v1/auth/request-code', {'phone': '1' * (3 * 1024 * 1024)}, format='json')
        self.assertIn(r.status_code, (400, 413))

    def test_server_error_does_not_leak_details(self):
        r = self.api.post('/api/v1/payments/click', 'not-a-form', content_type='text/plain')
        self.assertNotIn('Traceback', r.content.decode())

    def test_django_admin_not_exposed_without_debug(self):
        from django.test import override_settings
        from django.urls import clear_url_caches
        import importlib, config.urls
        with override_settings(DEBUG=False):
            importlib.reload(config.urls); clear_url_caches()
            self.assertEqual(Client().get('/django-admin/').status_code, 404)
        importlib.reload(config.urls); clear_url_caches()

    def test_prod_requires_real_secret(self):
        import subprocess, sys, os
        env = {**os.environ, 'DJANGO_DEBUG': '0', 'DJANGO_SECRET_KEY': 'dev-insecure-key'}
        env.pop('DATABASE_URL', None)
        r = subprocess.run([sys.executable, '-c', 'import os;os.environ["DJANGO_SETTINGS_MODULE"]="config.settings";'
                            'import django;from django.conf import settings;settings.SECRET_KEY'],
                           cwd=settings.BASE_DIR, env=env, capture_output=True)
        self.assertNotEqual(r.returncode, 0)


class ErrorCodeContract(Base):
    """Every API error code in the code must be listed (and translated by the frontend test)."""

    def test_error_codes_are_documented(self):
        listed = set(Path(settings.BASE_DIR, 'apps/tests/error_codes.txt').read_text().split())
        row_errors = {'name_required', 'price_invalid', 'stock_required', 'category_required'}   # import row errors
        used = set()
        for p in Path(settings.BASE_DIR, 'apps').rglob('*.py'):
            if 'tests' in p.parts or 'migrations' in p.parts:
                continue
            used |= set(re.findall(r"""['"]error['"]:\s*['"]([a-z_]+)['"]""", p.read_text()))
            used |= set(re.findall(r"""(?:OrderError|UploadError|LoginError)\(\s*['"]([a-z_]+)['"]""", p.read_text()))
        self.assertEqual(sorted(used - listed - row_errors), [])
