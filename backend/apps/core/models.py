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
        'default_commission_percent': 10,
        'large_object_area': 1000,          # m2: individual terms for big objects
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
