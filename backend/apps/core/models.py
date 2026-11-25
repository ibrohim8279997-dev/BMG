from django.db import models


class Setting(models.Model):
    """Superadmin-editable switches/values (e.g. prepayment, min order threshold)."""
    key = models.CharField(max_length=80, primary_key=True)
    value = models.JSONField()
    updated_at = models.DateTimeField(auto_now=True)

    DEFAULTS = {
        'prepayment_percent': 5,            # % of order, kept by BMG
        'prepayment_min_order_sum': 0,      # below this -> no prepayment (UZS)
        'prepayment_cash_percent': 5,       # prepayment when rest is paid in cash
        'cash_commission_percent': 0,       # commission on goods in cash orders; seller owes it, netted from payouts
        'seller_identity_check': False,     # off by default
        'default_commission_percent': 3,    # BMG agent fee, % of the deal; a seller may have its own rate
        'order_payment_ttl_minutes': 60,    # unpaid orders are cancelled after this and their stock returns (0 = never)
        'max_open_unpaid_orders': 3,        # per client; blocks reserving a seller's whole stock with unpaid orders
        'delivery_cost_max': 5000000,       # UZS per delivery rule: delivery is not commissioned, so it is capped
        'ai_daily_calls_per_user': 300,     # AI calls per user per day (0 = no cap); staff are not capped
        'ai_daily_calls_total': 20000,      # AI calls per day for the whole platform (0 = no cap)
        'phone_reveals_per_day': 20,        # seller phone reveals per client per day
        'large_object_area': 1000,          # m2: individual terms for big objects
        'bypass_check_days': 3,             # phone revealed + order still open after N days -> flagged
        'vat_rate': 12,                     # standard VAT rate in Uzbekistan, %
        'bmg_vat_payer': False,             # off: commission without VAT; on: VAT is added on top of the commission
        'bmg_vat_from': '',                 # YYYY-MM-DD: VAT applies to deals created on/after this date
        'brv_value': 412000,                # base calculation value (BRV), UZS; update when the government changes it
        'vat_threshold_brv': 12000,         # general VAT regime threshold from 2026-06-01, in BRV
        'bmg_name': '',                     # BMG requisites printed on documents
        'bmg_inn': '',
        'bmg_address': '',
        'bmg_bank_name': '',
        'bmg_bank_account': '',
        'bmg_bank_mfo': '',
        'einvoice_api_enabled': False,      # direct e-invoice operator API: a stub until an operator is chosen
        'support_phone': '',                # BMG complaint contacts shown on seller profiles and footer
        'support_telegram': '',
        'support_email': '',
    }

    @classmethod
    def get(cls, key):
        row = cls.objects.filter(key=key).first()
        return row.value if row else cls.DEFAULTS[key]


class LegalDocument(models.Model):
    """Policies/terms, 3 languages, versioned. Edited by superadmin."""
    slug = models.SlugField(max_length=40)              # privacy, terms, seller-terms
    version = models.PositiveIntegerField(default=1)
    title_uz = models.CharField(max_length=200)
    title_ru = models.CharField(max_length=200)
    title_en = models.CharField(max_length=200)
    body_uz = models.TextField()
    body_ru = models.TextField()
    body_en = models.TextField()
    effective_from = models.DateField()

    class Meta:
        unique_together = [('slug', 'version')]
        ordering = ['slug', '-version']
