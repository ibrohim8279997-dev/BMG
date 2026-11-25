import re
import smtplib
from unittest import mock

from django.core import mail
from django.test import override_settings

from apps.accounts import emailcheck
from apps.accounts.models import User

from .base import Base


def _dns(mx=True, a=True):
    def fake(domain, rtype):
        return mx if rtype == 'MX' else a
    return mock.patch.object(emailcheck, '_has_record', side_effect=fake)


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class EmailLoginTests(Base):
    def req(self, email):
        return self.api.post('/api/v1/auth/email/request-code', {'email': email}, format='json')

    def code(self):
        return re.search(r'code: (\d{6})', mail.outbox[-1].body).group(1)

    def test_nonexistent_domain_is_rejected(self):
        with _dns(mx=False, a=False):
            r = self.req('nobody@no-such-domain-xyz.uz')
        self.assertEqual((r.status_code, r.data['error']), (404, 'email_not_found'))
        self.assertEqual(len(mail.outbox), 0)

    def test_bad_syntax(self):
        self.assertEqual(self.req('not-an-email').data['error'], 'invalid_email')

    def test_dns_down_does_not_block(self):
        with mock.patch.object(emailcheck, '_has_record', return_value=None):
            self.assertEqual(self.req('a@example.com').status_code, 200)

    def test_smtp_refusal_means_no_such_mailbox(self):
        with _dns(), mock.patch('apps.accounts.email_login.send_mail', side_effect=smtplib.SMTPRecipientsRefused({})):
            r = self.req('ghost@example.com')
        self.assertEqual(r.data['error'], 'email_not_found')

    def test_register_then_login(self):
        with _dns():
            self.assertEqual(self.req('Ali@Example.com').status_code, 200)
        code = self.code()
        # new account: role + consent required, and the code must NOT be consumed by the failed attempt
        r = self.api.post('/api/v1/auth/email/verify', {'email': 'ali@example.com', 'code': code}, format='json')
        self.assertEqual(r.data['error'], 'registration_required')
        r = self.api.post('/api/v1/auth/email/verify', {'email': 'ali@example.com', 'code': code, 'role': 'client',
                          'accept_privacy': True, 'accept_terms': True}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        u = User.objects.get(email='ali@example.com')
        self.assertEqual(u.role, 'client')
        self.assertEqual(self.api.get('/api/v1/me').data['id'], u.id)
        # second login: existing account, no registration fields needed; old code can't be reused
        self.api.post('/api/v1/auth/logout')
        r = self.api.post('/api/v1/auth/email/verify', {'email': 'ali@example.com', 'code': code}, format='json')
        self.assertEqual(r.data['error'], 'invalid_code')
        with _dns():
            self.req('ali@example.com')
        r = self.api.post('/api/v1/auth/email/verify', {'email': 'ali@example.com', 'code': self.code()}, format='json')
        self.assertEqual((r.status_code, r.data['id']), (200, u.id))

    def test_wrong_code_and_attempt_limit(self):
        with _dns():
            self.req('b@example.com')
        for _ in range(5):
            self.assertEqual(self.api.post('/api/v1/auth/email/verify', {'email': 'b@example.com', 'code': '000000', 'role': 'client',
                                            'accept_privacy': True, 'accept_terms': True}, format='json').data['error'], 'invalid_code')
        r = self.api.post('/api/v1/auth/email/verify', {'email': 'b@example.com', 'code': self.code(), 'role': 'client',
                          'accept_privacy': True, 'accept_terms': True}, format='json')
        self.assertEqual(r.data['error'], 'invalid_code')   # attempts exhausted

    def test_staff_email_cannot_use_this_login(self):
        User.objects.create(username='boss', email='boss@example.com', is_staff=True)
        with _dns():
            self.req('boss@example.com')
        r = self.api.post('/api/v1/auth/email/verify', {'email': 'boss@example.com', 'code': self.code()}, format='json')
        self.assertEqual(r.data['error'], 'use_admin_login')

    def test_request_limit_per_email(self):
        with _dns():
            for _ in range(5):
                self.assertEqual(self.req('c@example.com').status_code, 200)
            self.assertEqual(self.req('c@example.com').status_code, 429)


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
                   TURNSTILE_SITE_KEY='site', TURNSTILE_SECRET_KEY='secret')
class CaptchaTests(Base):
    def _register(self, captcha=None):
        with _dns():
            self.api.post('/api/v1/auth/email/request-code', {'email': 'n@example.com'}, format='json')
        code = re.search(r'code: (\d{6})', mail.outbox[-1].body).group(1)
        body = {'email': 'n@example.com', 'code': code, 'role': 'client', 'accept_privacy': True, 'accept_terms': True}
        if captcha:
            body['captcha'] = captcha
        return self.api.post('/api/v1/auth/email/verify', body, format='json')

    def test_registration_needs_captcha_when_enabled(self):
        self.assertEqual(self._register().data['error'], 'captcha_required')
        self.assertFalse(User.objects.exists())

    def test_bad_captcha_rejected_good_accepted(self):
        resp = mock.Mock()
        resp.json.return_value = {'success': False}
        with mock.patch('apps.accounts.captcha.requests.post', return_value=resp):
            self.assertEqual(self._register('tok').data['error'], 'captcha_required')
        resp.json.return_value = {'success': True}
        with mock.patch('apps.accounts.captcha.requests.post', return_value=resp) as p:
            self.assertEqual(self._register('tok').status_code, 200)
        self.assertEqual(p.call_args.kwargs['data']['secret'], 'secret')

    def test_existing_user_login_needs_no_captcha(self):
        User.objects.create(username='x', email='n@example.com', role='client')
        with _dns():
            self.api.post('/api/v1/auth/email/request-code', {'email': 'n@example.com'}, format='json')
        code = re.search(r'code: (\d{6})', mail.outbox[-1].body).group(1)
        self.assertEqual(self.api.post('/api/v1/auth/email/verify', {'email': 'n@example.com', 'code': code}, format='json').status_code, 200)

    def test_providers_expose_site_key_only(self):
        d = self.api.get('/api/v1/auth/providers').json()
        self.assertEqual(d['captcha_site_key'], 'site')
        self.assertNotIn('secret', str(d))
