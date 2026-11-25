"""Outbox for order events sent to the CRM (Nexio). BMG is the source of truth; the CRM only reads.

A row is written in the same DB transaction as the order change, then the worker (manage.py crm_outbox) sends it.
`body` holds the exact bytes that are signed and sent, so a retry is byte-for-byte identical."""
from django.db import models


class CrmEvent(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending'          # waiting for the first attempt or for the next retry
        DELIVERED = 'delivered'      # 2xx, or 409 duplicate
        FAILED = 'failed'            # 400/401/403/422 or retries exhausted: needs a human (resend button)

    event_id = models.CharField(max_length=60, unique=True)
    event_type = models.CharField(max_length=30)
    order = models.ForeignKey('orders.Order', null=True, blank=True, on_delete=models.PROTECT, related_name='crm_events')
    order_version = models.PositiveIntegerField(default=0)
    is_test = models.BooleanField(default=False)
    body = models.TextField()                       # JSON envelope, sent as-is
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING, db_index=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    next_attempt_at = models.DateTimeField(db_index=True)
    locked_until = models.DateTimeField(null=True, blank=True)    # a worker claimed this row until then
    last_status_code = models.IntegerField(null=True, blank=True)
    last_error = models.TextField(blank=True)       # masked, truncated response body / exception
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-id']
        constraints = [models.UniqueConstraint(fields=['order', 'order_version'], name='crm_event_order_version',
                                               condition=models.Q(order__isnull=False))]
