from datetime import timedelta
from unittest import mock

from django.test import Client, override_settings
from django.utils import timezone

from apps.accounts.models import TelegramLink, TelegramLoginCode, User
from apps.accounts.services import LoginError, issue_code, verify_code
from apps.accounts import telegram

from .base import Base

P = '+998901112233'


class LoginCodeService(Base):
    def test_code_works_once(self):
        c = issue_code(P, '1.1.1.1')
        self.assertTrue(verify_code(P, c))
        self.assertFalse(verify_code(P, c))

    def test_expired(self):
        c = issue_code(P, None)
        TelegramLoginCode.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertFalse(verify_code(P, c))

    @override_settings(LOGIN_CODE_MAX_ATTEMPTS=3)
    def test_attempt_limit(self):
        c = issue_code(P, None)
        for _ in range(3):
            verify_code(P, 'bad')
        self.assertFalse(verify_code(P, c))

    def test_request_limits(self):
        for _ in range(5):
            issue_code(P, None)
        with self.assertRaises(LoginError):
            issue_code(P, None)
        for i in range(20):
            issue_code(f'+99890000{i:04d}', '9.9.9.9')
        with self.assertRaises(LoginError):
            issue_code('+998909999999', '9.9.9.9')

    def test_hashed(self):
        c = issue_code(P, None)
        self.assertNotIn(c, TelegramLoginCode.objects.get().code_hash)


@override_settings(TELEGRAM_BOT_TOKEN='x', TELEGRAM_WEBHOOK_SECRET='sec', TELEGRAM_BOT_USERNAME='bmgbot')
class LoginApi(Base):
    def link(self, phone=P):
        TelegramLink.objects.create(phone=phone, telegram_id=555, chat_id=555)

    def request_code(self, phone=P):
        with mock.patch('apps.accounts.telegram.send_message') as sm:
            r = self.api.post('/api/v1/auth/request-code', {'phone': phone}, format='json')
        return r, sm

    def code_from(self, sm):
        return sm.call_args[0][1].split('\n')[0].split(': ')[1]

    def test_full_registration_flow(self):
        self.link()
        r, sm = self.request_code()
        self.assertEqual(r.status_code, 200)
        self.assertNotIn('code', r.json())
        code = self.code_from(sm)
        # no role -> registration required, code NOT consumed
        r = self.api.post('/api/v1/auth/verify', {'phone': P, 'code': code}, format='json')
        self.assertEqual((r.status_code, r.json()['error']), (422, 'registration_required'))
        r = self.api.post('/api/v1/auth/verify', {'phone': P, 'code': code, 'role': 'client'}, format='json')
        self.assertEqual(r.json()['error'], 'consent_required')
        r = self.api.post('/api/v1/auth/verify', {'phone': P, 'code': code, 'role': 'seller', 'accept_privacy': True,
                                                  'accept_terms': True, 'company_name': 'ACME'}, format='json')
        self.assertEqual(r.status_code, 200)
        u = User.objects.get(phone=P)
        self.assertEqual(u.role, 'seller')
        self.assertEqual(u.seller.status, 'pending')    # not approved by default
        self.assertIsNotNone(u.accepted_privacy_at)
        self.assertEqual(self.api.get('/api/v1/me').json()['phone'], P)

    def test_cannot_register_as_staff(self):
        self.link()
        r, sm = self.request_code()
        r = self.api.post('/api/v1/auth/verify', {'phone': P, 'code': self.code_from(sm), 'role': 'staff',
                                                  'accept_privacy': True, 'accept_terms': True}, format='json')
        self.assertEqual(r.status_code, 422)

    def test_unlinked_phone_gets_bot_link(self):
        r, sm = self.request_code()
        self.assertEqual(r.status_code, 200)                       # same answer as a linked number: no oracle
        self.assertIn('t.me/bmgbot', r.json()['bot_url'])
        self.assertFalse(sm.called)                                 # but no code is issued or sent

    def test_invalid_phone(self):
        r, _ = self.request_code('123')
        self.assertEqual(r.status_code, 400)

    def test_wrong_code_rejected(self):
        self.link()
        self.request_code()
        r = self.api.post('/api/v1/auth/verify', {'phone': P, 'code': '000000', 'role': 'client',
                                                  'accept_privacy': True, 'accept_terms': True}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertFalse(User.objects.filter(phone=P).exists())

    def test_unregistered_wrong_code_looks_like_registered(self):
        self.link()
        self.request_code()
        # no role, wrong code: invalid_code (not registration_required) - existence of the account is not revealed
        r = self.api.post('/api/v1/auth/verify', {'phone': P, 'code': '000000'}, format='json')
        self.assertEqual((r.status_code, r.json()['error']), (400, 'invalid_code'))

    @override_settings(LOGIN_FAILS_PER_IDENTIFIER_PER_DAY=3, LOGIN_CODE_MAX_ATTEMPTS=5)
    def test_failures_lock_the_number_across_fresh_codes(self):
        self.link()
        for _ in range(2):                  # two codes, failures accumulate across both
            self.request_code()
            self.api.post('/api/v1/auth/verify', {'phone': P, 'code': '000000'}, format='json')
            self.api.post('/api/v1/auth/verify', {'phone': P, 'code': '000001'}, format='json')
        r, sm = self.request_code()
        self.assertEqual(r.status_code, 429)  # locked for the day: no new code either
        self.assertFalse(verify_code(P, '000000'))

    def test_attempt_counter_cannot_be_exceeded(self):
        c = issue_code(P, None)
        for _ in range(5):
            self.assertFalse(verify_code(P, '999999' if c != '999999' else '999998'))
        self.assertFalse(verify_code(P, c))  # the 6th attempt is refused even with the right code
        self.assertEqual(TelegramLoginCode.objects.get().attempts, 5)

    def test_staff_cannot_use_client_login(self):
        User.objects.create(username='boss', phone=P, is_staff=True, role='staff')
        c = issue_code(P, None)
        r = self.api.post('/api/v1/auth/verify', {'phone': P, 'code': c}, format='json')
        self.assertEqual(r.status_code, 403)

    @override_settings(MAX_NEW_ACCOUNTS_PER_IP_PER_DAY=2)
    def test_mass_registration_limited_per_ip(self):
        codes = {}
        for i in range(3):
            ph = f'+99890111000{i}'
            codes[ph] = issue_code(ph, None)
        results = [self.api.post('/api/v1/auth/verify', {'phone': ph, 'code': c, 'role': 'client',
                                                         'accept_privacy': True, 'accept_terms': True},
                                 format='json').status_code for ph, c in codes.items()]
        self.assertEqual(results, [200, 200, 429])

    def test_csrf_enforced_on_login(self):
        c = Client(enforce_csrf_checks=True)
        r = c.post('/api/v1/auth/request-code', {'phone': P}, content_type='application/json')
        self.assertEqual(r.status_code, 403)

    def test_request_code_throttled(self):
        self.link()
        codes = []
        for _ in range(11):
            r, _ = self.request_code()
            codes.append(r.status_code)
        self.assertIn(429, codes)

    # --- webhook / bot
    def test_webhook_requires_secret(self):
        r = self.api.post('/api/v1/auth/telegram/webhook/wrong', {}, format='json',
                          HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN='sec')
        self.assertEqual(r.status_code, 403)
        r = self.api.post('/api/v1/auth/telegram/webhook/sec', {}, format='json')
        self.assertEqual(r.status_code, 403)   # header missing
        r = self.api.post('/api/v1/auth/telegram/webhook/sec', {}, format='json',
                          HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN='sec')
        self.assertEqual(r.status_code, 200)

    @mock.patch('apps.accounts.telegram.send_message')
    def test_bot_links_only_own_contact(self, sm):
        telegram.handle_update({'message': {'from': {'id': 7}, 'chat': {'id': 7, 'type': 'private'},
                                            'contact': {'phone_number': '998901112233', 'user_id': 8}}})
        self.assertFalse(TelegramLink.objects.exists())   # forwarded foreign contact rejected
        telegram.handle_update({'message': {'from': {'id': 7}, 'chat': {'id': 7, 'type': 'private'},
                                            'contact': {'phone_number': '998901112233', 'user_id': 7}}})
        self.assertEqual(TelegramLink.objects.get().phone, P)

    @mock.patch('apps.accounts.telegram.send_message')
    def test_bot_ignores_groups(self, sm):
        telegram.handle_update({'message': {'from': {'id': 7}, 'chat': {'id': -1, 'type': 'group'}, 'text': '/start'}})
        sm.assert_not_called()
