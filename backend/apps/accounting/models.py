from django.conf import settings
from django.db import models


class Invoice(models.Model):
    """BMG's service invoice to a seller for the commission of one calendar month.
    The commission is treated as VAT-INCLUSIVE (the seller never pays more than the agreed %): vat = gross x r / (100 + r).
    Whether that is how the tax office wants it is an open question for the accountant (see README).
    BMG never files anything itself: staff send it through SoliqOnline / an operator by hand and record the reference."""

    class Status(models.TextChoices):
        DRAFT = 'draft'
        ISSUED = 'issued'            # numbered, final
        SENT = 'sent_to_tax'         # staff confirmed it was submitted (reference stored)
        VOID = 'void'

    seller = models.ForeignKey('sellers.Seller', on_delete=models.PROTECT, related_name='invoices')
    period = models.DateField()                                   # first day of the month
    number = models.CharField(max_length=20, blank=True, db_index=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT, db_index=True)
    gross = models.DecimalField(max_digits=16, decimal_places=2)  # commission incl. VAT
    vat_rate = models.DecimalField(max_digits=5, decimal_places=2)
    vat_amount = models.DecimalField(max_digits=16, decimal_places=2)
    net = models.DecimalField(max_digits=16, decimal_places=2)
    lines = models.JSONField(default=list)                        # [{order_id, commission}]
    tax_ref = models.CharField(max_length=80, blank=True)         # SoliqOnline / operator reference, entered by staff
    created_at = models.DateTimeField(auto_now_add=True)
    issued_at = models.DateTimeField(null=True, blank=True)
    issued_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')

    class Meta:
        unique_together = [('seller', 'period')]
        ordering = ['-period', 'seller_id']
