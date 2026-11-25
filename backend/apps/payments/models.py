from decimal import Decimal

from django.conf import settings
from django.db import models


class Wallet(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='wallet')
    balance = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal('0'))   # UZS only


class LedgerEntry(models.Model):
    """Append-only record of every balance change."""
    wallet = models.ForeignKey(Wallet, on_delete=models.PROTECT, related_name='entries')
    kind = models.CharField(max_length=20)       # topup, order_payment, refund
    amount = models.DecimalField(max_digits=16, decimal_places=2)    # signed
    balance_after = models.DecimalField(max_digits=16, decimal_places=2)
    order_id = models.BigIntegerField(null=True, blank=True)
    ref = models.CharField(max_length=60, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class TopUp(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='topups')
    amount = models.DecimalField(max_digits=14, decimal_places=2)    # source of truth for Click amount check
    status = models.CharField(max_length=10, default='pending')      # pending / paid / cancelled
    click_trans_id = models.BigIntegerField(null=True, blank=True, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)


class ClickEvent(models.Model):
    """Separate payment-module audit trail of every callback received."""
    action = models.IntegerField(null=True)
    click_trans_id = models.BigIntegerField(null=True, db_index=True)
    merchant_trans_id = models.CharField(max_length=40, blank=True)
    ip = models.GenericIPAddressField(null=True)
    result = models.IntegerField()
    raw = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)


class SavedCard(models.Model):
    """A bank card tokenised by Click (Merchant API card_token). We never store or log the card number or expiry:
    only Click's token and the masked number Click returns. Charged on demand ("one-click" payment)."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='cards')
    token = models.CharField(max_length=100, unique=True)
    masked = models.CharField(max_length=24, blank=True)          # e.g. 8600 **** **** 1234
    verified = models.BooleanField(default=False)                 # true after the SMS code from Click is confirmed
    created_at = models.DateTimeField(auto_now_add=True)
