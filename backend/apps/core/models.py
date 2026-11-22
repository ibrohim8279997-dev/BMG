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
        'seller_identity_check': False,     # off by default
    }

    @classmethod
    def get(cls, key):
        row = cls.objects.filter(key=key).first()
        return row.value if row else cls.DEFAULTS[key]
