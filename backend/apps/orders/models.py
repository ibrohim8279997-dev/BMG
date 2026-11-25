from decimal import Decimal

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


def new_external_id():
    return f'ord_{uuid.uuid4().hex}'


class CartItem(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='cart')
    offer = models.ForeignKey('catalog.Offer', on_delete=models.CASCADE)
    qty = models.DecimalField(max_digits=12, decimal_places=3)

    class Meta:
        unique_together = [('user', 'offer')]


class Order(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending_payment'
        PAID = 'paid'
        COMPLETED = 'completed'
        CANCELLED = 'cancelled'

    client = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='orders')
    city = models.CharField(max_length=80)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)
    payment_mode = models.CharField(max_length=6)               # full | cash
    goods_total = models.DecimalField(max_digits=16, decimal_places=2)
    delivery_total = models.DecimalField(max_digits=16, decimal_places=2)
    total = models.DecimalField(max_digits=16, decimal_places=2)
    prepayment = models.DecimalField(max_digits=16, decimal_places=2)   # service fee, kept by BMG
    amount_due_online = models.DecimalField(max_digits=16, decimal_places=2)
    amount_paid = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal('0'))
    commission_total = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal('0'))
    buyer_type = models.CharField(max_length=10, default='individual')   # individual | legal
    buyer_inn = models.CharField(max_length=9, blank=True)               # legal entity only
    buyer_name = models.CharField(max_length=200, blank=True)            # legal entity only
    created_at = models.DateTimeField(auto_now_add=True)
    # CRM integration: the id the CRM knows the order by. Generated once, never changed or reused.
    external_id = models.CharField(max_length=40, unique=True, default=new_external_id, editable=False)
    version = models.PositiveIntegerField(default=0)                    # +1 on every change sent to the CRM
    updated_at = models.DateTimeField(default=timezone.now, db_index=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancel_reason = models.CharField(max_length=40, blank=True)

    @property
    def number(self):
        return f'BMG-{self.pk:06d}'


class OrderItem(models.Model):
    """Snapshot of price/commission/cost at purchase time."""
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name='items')
    offer = models.ForeignKey('catalog.Offer', null=True, on_delete=models.SET_NULL)
    seller = models.ForeignKey('sellers.Seller', on_delete=models.PROTECT, related_name='order_items')
    product_name = models.CharField(max_length=200)
    qty = models.DecimalField(max_digits=12, decimal_places=3)
    unit_price = models.DecimalField(max_digits=14, decimal_places=2)
    cost_price = models.DecimalField(max_digits=14, decimal_places=2, null=True)
    commission_percent = models.DecimalField(max_digits=5, decimal_places=2)
    commission_amount = models.DecimalField(max_digits=16, decimal_places=2)
    delivery_cost = models.DecimalField(max_digits=14, decimal_places=2, default=0)  # once per seller (first item)
    fulfilled = models.BooleanField(default=False)
    credited = models.BooleanField(default=False)

    @property
    def line_total(self):
        return (self.unit_price * self.qty).quantize(Decimal('0.01'))


class SellerLedger(models.Model):
    seller = models.ForeignKey('sellers.Seller', on_delete=models.PROTECT, related_name='ledger')
    kind = models.CharField(max_length=12)          # sale, reversal, payout
    amount = models.DecimalField(max_digits=16, decimal_places=2)   # signed
    order = models.ForeignKey(Order, null=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)


class PayoutRequest(models.Model):
    seller = models.ForeignKey('sellers.Seller', on_delete=models.PROTECT, related_name='payouts')
    amount = models.DecimalField(max_digits=16, decimal_places=2)
    status = models.CharField(max_length=10, default='requested')   # requested / paid / rejected
    created_at = models.DateTimeField(auto_now_add=True)


class Refund(models.Model):
    class Fault(models.TextChoices):
        CLIENT = 'client'
        SELLER = 'seller'
        BMG = 'bmg'

    order = models.ForeignKey(Order, on_delete=models.PROTECT, related_name='refunds')
    fault = models.CharField(max_length=6, choices=Fault.choices)
    amount = models.DecimalField(max_digits=16, decimal_places=2)
    due_by = models.DateField(null=True, blank=True)            # BMG fault: 3 business days
    reserve_until = models.DateField(null=True, blank=True)     # +1 spare day for the bank
    processed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
