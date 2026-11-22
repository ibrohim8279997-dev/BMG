from django.test import TestCase
from .models import Setting


class SettingTests(TestCase):
    def test_defaults_and_override(self):
        self.assertEqual(Setting.get('prepayment_percent'), 5)
        self.assertFalse(Setting.get('seller_identity_check'))
        Setting.objects.create(key='prepayment_percent', value=7)
        self.assertEqual(Setting.get('prepayment_percent'), 7)
