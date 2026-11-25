"""Agent-scheme tax accounting.

BMG is the seller's agent: the client's money passes through BMG's account in transit and is NOT BMG revenue.
BMG revenue is only its commission. All amounts are whole UZS (so'm) integers; rounding lives in money.py."""
from django.conf import settings
from django.db import models


class FrozenError(Exception):
    """A posted/fixed record was about to be changed."""


class Deal(models.Model):
    """One order x one seller. The money fields are fixed when the deal is created and never change afterwards:
    a refund is a storno document plus a status, not an edit."""

    class Status(models.TextChoices):
        PAID = 'paid'                # client paid BMG (Click / wallet)
        DELIVERED = 'delivered'      # seller marked the goods delivered
        CONFIRMED = 'confirmed'      # a human at BMG confirmed delivery -> commission invoice is issued
        PAID_OUT = 'paid_out'        # a human at BMG confirmed the payout to the seller
        REFUNDED = 'refunded'        # cancelled by storno

    FROZEN = ('goods', 'delivery', 'total', 'held', 'commission_rate', 'commission', 'vat_rate', 'commission_vat',
              'seller_vat_rate', 'seller_vat', 'payout', 'bmg_vat_payer', 'seller_vat_payer', 'parties')

    order = models.ForeignKey('orders.Order', on_delete=models.PROTECT, related_name='deals')
    seller = models.ForeignKey('sellers.Seller', on_delete=models.PROTECT, related_name='deals')
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PAID, db_index=True)
    payment_mode = models.CharField(max_length=6)
    goods = models.BigIntegerField()                 # goods value, so'm
    delivery = models.BigIntegerField()
    total = models.BigIntegerField()                 # goods + delivery
    held = models.BigIntegerField()                  # client money for this seller on BMG's account (transit)
    commission_rate = models.DecimalField(max_digits=5, decimal_places=2)
    commission = models.BigIntegerField()            # BMG revenue, net of VAT
    bmg_vat_payer = models.BooleanField()
    vat_rate = models.DecimalField(max_digits=5, decimal_places=2)   # applied to commission (0 when BMG is not a payer)
    commission_vat = models.BigIntegerField()
    seller_vat_payer = models.BooleanField()
    seller_vat_rate = models.DecimalField(max_digits=5, decimal_places=2)
    seller_vat = models.BigIntegerField()            # VAT inside the goods price on the seller's invoice to the client
    payout = models.BigIntegerField()                # held - commission - commission_vat (negative: seller owes BMG)
    parties = models.JSONField(default=dict)         # requisites snapshot: bmg / seller / client
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    confirmed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    paid_out_at = models.DateTimeField(null=True, blank=True)
    paid_out_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    payout_ref = models.CharField(max_length=80, blank=True)     # bank payment order number entered by staff
    refunded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = [('order', 'seller')]
        ordering = ['-id']

    def save(self, *a, **kw):
        if self.pk:
            old = Deal.objects.filter(pk=self.pk).values(*self.FROZEN).first()
            if old and any(old[f] != getattr(self, f) for f in self.FROZEN):
                raise FrozenError('deal amounts are fixed')
        super().save(*a, **kw)


class DocSequence(models.Model):
    """Gap-tolerant, never-reused document counter per series. Allocated under a row lock."""
    series = models.CharField(max_length=10, primary_key=True)
    last = models.PositiveIntegerField(default=0)


class Document(models.Model):
    class Kind(models.TextChoices):
        COMMISSION_INVOICE = 'commission'     # BMG -> seller, for BMG's agent fee (one per confirmed deal)
        SELLER_INVOICE = 'seller_inv'         # data for the seller's e-invoice to the client (seller confirms & signs)
        AGENT_ACT = 'act'                     # act of agent services rendered, per seller per period
        PAYOUT_REGISTRY = 'registry'          # payouts to sellers, paid by a human
        STORNO = 'storno'                     # reverses a posted document

    class Status(models.TextChoices):
        DRAFT = 'draft'
        POSTED = 'posted'          # final: never edited, only reversed by storno
        REVERSED = 'reversed'      # a storno document exists for it

    SERIES = {'commission': 'KI', 'seller_inv': 'SF', 'act': 'AKT', 'registry': 'REE', 'storno': 'ST'}
    LOCKED = ('kind', 'number', 'date', 'seller_id', 'deal_id', 'base', 'vat_rate', 'vat', 'total', 'payload',
              'period_start', 'period_end', 'reverses_id')

    kind = models.CharField(max_length=10, choices=Kind.choices, db_index=True)
    number = models.CharField(max_length=24, unique=True)
    date = models.DateField(db_index=True)
    status = models.CharField(max_length=9, choices=Status.choices, default=Status.POSTED, db_index=True)
    seller = models.ForeignKey('sellers.Seller', null=True, blank=True, on_delete=models.PROTECT, related_name='acc_documents')
    deal = models.ForeignKey(Deal, null=True, blank=True, on_delete=models.PROTECT, related_name='documents')
    period_start = models.DateField(null=True, blank=True)
    period_end = models.DateField(null=True, blank=True)
    base = models.BigIntegerField(default=0)           # amount without VAT
    vat_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    vat = models.BigIntegerField(default=0)
    total = models.BigIntegerField(default=0)          # base + vat
    payload = models.JSONField(default=dict)           # parties, lines: what the printed document shows
    reverses = models.OneToOneField('self', null=True, blank=True, on_delete=models.PROTECT, related_name='storno')
    seller_confirmed_at = models.DateTimeField(null=True, blank=True)     # seller_inv: seller confirmed the data
    einvoice_status = models.CharField(max_length=12, blank=True)         # '', exported, sent, accepted, rejected
    einvoice_ref = models.CharField(max_length=80, blank=True)            # operator's id, entered by staff / API
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-date', '-id']

    def save(self, *a, **kw):
        if self.pk:
            old = Document.objects.filter(pk=self.pk).values(*self.LOCKED, 'status').first()
            if old and old['status'] != self.Status.DRAFT and any(old[f] != getattr(self, f) for f in self.LOCKED):
                raise FrozenError('posted documents are not edited; reverse them with storno')
        super().save(*a, **kw)

    def delete(self, *a, **kw):
        raise FrozenError('accounting documents are never deleted')


class Discrepancy(models.Model):
    """Click / wallet payments that do not match deal amounts. Reviewed by the accountant."""
    kind = models.CharField(max_length=24, db_index=True)   # order_underpaid, order_overpaid, topup_mismatch, ...
    key = models.CharField(max_length=60, unique=True)      # idempotency: kind + object id
    order = models.ForeignKey('orders.Order', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    expected = models.BigIntegerField(default=0)
    actual = models.BigIntegerField(default=0)
    note = models.CharField(max_length=200, blank=True)
    resolved = models.BooleanField(default=False, db_index=True)
    resolved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    resolution = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['resolved', '-id']
