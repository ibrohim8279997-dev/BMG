"""Writing order events into the outbox. Call emit() inside the transaction that changes the order."""
import json
import uuid

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from .models import CrmEvent
from .serializers import serialize_order

TYPES = ('order.created', 'order.updated', 'order.paid', 'order.completed', 'order.cancelled', 'order.refunded')


def envelope(event_id, event_type, occurred_at, version, data):
    return json.dumps({'event_id': event_id, 'event_type': event_type,
                       'occurred_at': timezone.localtime(occurred_at).isoformat(), 'order_version': version,
                       'data': data}, ensure_ascii=False, separators=(',', ':'))


def emit(order, event_type):
    """Bump the order version and store the full order snapshot. Must run in the order's transaction:
    if the order change rolls back, the event disappears with it (outbox pattern)."""
    from apps.orders.models import Order
    if event_type not in TYPES:
        raise ValueError(event_type)
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError('crm.emit must run inside the order transaction')
    now = timezone.now()
    Order.objects.filter(pk=order.pk).update(version=F('version') + 1, updated_at=now)
    order.refresh_from_db(fields=['version', 'updated_at'])
    eid = f'evt_{uuid.uuid4()}'
    return CrmEvent.objects.create(
        event_id=eid, event_type=event_type, order=order, order_version=order.version, next_attempt_at=now,
        body=envelope(eid, event_type, now, order.version, serialize_order(order)))


def test_event():
    """A fake event for the 'send test event' button: no order, no personal data."""
    now = timezone.now()
    eid = f'evt_{uuid.uuid4()}'
    data = {'external_order_id': 'test', 'order_number': 'TEST', 'status': 'paid', 'total': 0.0, 'currency': 'UZS',
            'test': True}
    return CrmEvent.objects.create(event_id=eid, event_type='order.created', is_test=True, next_attempt_at=now,
                                   body=envelope(eid, 'order.created', now, 0, data))
