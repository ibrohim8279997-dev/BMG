from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone

from .models import TelegramLoginCode
from .services import LoginError, issue_code, verify_code


class LoginCodeTests(TestCase):
    def test_valid_code_works_once(self):
        c = issue_code('+998901112233', '1.1.1.1')
        self.assertTrue(verify_code('+998901112233', c))
        self.assertFalse(verify_code('+998901112233', c))

    def test_wrong_code(self):
        issue_code('+998901112233', None)
        self.assertFalse(verify_code('+998901112233', '000000x'))

    def test_expired(self):
        c = issue_code('+998901112233', None)
        TelegramLoginCode.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertFalse(verify_code('+998901112233', c))

    @override_settings(LOGIN_CODE_MAX_ATTEMPTS=3)
    def test_attempt_limit_blocks_even_correct_code(self):
        c = issue_code('+998901112233', None)
        for _ in range(3):
            verify_code('+998901112233', 'bad')
        self.assertFalse(verify_code('+998901112233', c))

    def test_request_limit_per_phone(self):
        for _ in range(5):
            issue_code('+998901112233', None)
        with self.assertRaises(LoginError):
            issue_code('+998901112233', None)

    def test_request_limit_per_ip(self):
        for i in range(20):
            issue_code(f'+99890000{i:04d}', '9.9.9.9')
        with self.assertRaises(LoginError):
            issue_code('+998909999999', '9.9.9.9')

    def test_code_stored_hashed(self):
        c = issue_code('+998901112233', None)
        self.assertNotIn(c, TelegramLoginCode.objects.get().code_hash)
