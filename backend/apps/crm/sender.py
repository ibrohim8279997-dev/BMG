"""Delivery of outbox events to the CRM: signing, retries, per-order ordering.

2xx or 409 -> delivered. 5xx / 429 / 408 / timeout / network error -> retry after 1m, 5m, 15m, 1h, 6h, 24h (+-10%
jitter), then failed. Other 4xx (400/401/403/404/422...) -> failed at once; a human resends from the admin panel.
Events of one order go out strictly by order_version: a later one waits while an earlier one is not delivered."""
import hashlib
import hmac
import logging
import random
import time
from datetime import timedelta

import requests
from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from .mask import mask
from .models import CrmEvent

log = logging.getLogger('bmg.crm')

RETRY_DELAYS = [60, 300, 900, 3600, 6 * 3600, 24 * 3600]
LEASE = timedelta(seconds=120)
PATH = '/api/v1/integrations/bmg/events'


def configured():
    return bool(settings.CRM_BASE_URL and settings.CRM_API_KEY and settings.CRM_WEBHOOK_SECRET)


def endpoint():
    return settings.CRM_BASE_URL.rstrip('/') + PATH


def sign(secret, timestamp, body: bytes):
    mac = hmac.new(secret.encode(), str(timestamp).encode() + b'.' + body, hashlib.sha256).hexdigest()
    return f'sha256={mac}'


def retry_delay(attempt, retry_after=None):
    """attempt: number of failed attempts so far (1-based). None = no retries left."""
    if attempt > len(RETRY_DELAYS):
        return None
    base = RETRY_DELAYS[attempt - 1]
    delay = base * random.uniform(0.9, 1.1)
    if retry_after:
        delay = max(delay, min(retry_after, 24 * 3600))
    return timedelta(seconds=delay)


def parse_retry_after(v):
    try:
        return max(0, int(str(v).strip()))
    except (TypeError, ValueError):
        return None


def post(event):
    """One HTTP attempt. Returns (status_code or None, response text or error, Retry-After header)."""
    url = endpoint()
    if not url.startswith('https://') and not settings.DEBUG:
        return None, 'refused: CRM_BASE_URL must be https (personal data)', None
    body = event.body.encode()
    ts = int(time.time())
    headers = {'Authorization': f'Bearer {settings.CRM_API_KEY}', 'X-BMG-Timestamp': str(ts),
               'X-BMG-Signature': sign(settings.CRM_WEBHOOK_SECRET, ts, body),
               'Content-Type': 'application/json', 'X-BMG-Event-Id': event.event_id}
    try:
        r = requests.post(url, data=body, headers=headers, timeout=settings.CRM_HTTP_TIMEOUT, allow_redirects=False)
    except requests.RequestException as e:
        return None, f'{type(e).__name__}: {e}', None
    return r.status_code, r.text, r.headers.get('Retry-After')


def attempt(event):
    """Send once and record the outcome. The caller holds the claim on the row."""
    code, text, retry_after = post(event)
    retry_after = parse_retry_after(retry_after)
    now = timezone.now()
    event.attempts += 1
    event.last_attempt_at = now
    event.last_status_code = code
    event.locked_until = None
    if code is not None and (200 <= code < 300 or code == 409):
        event.status = CrmEvent.Status.DELIVERED
        event.delivered_at = now
        event.last_error = '' if code != 409 else mask(text, 500)
    else:
        event.last_error = mask(text)
        retryable = code is None or code >= 500 or code in (408, 429)
        if text.startswith('refused:'):
            retryable = False
        delay = retry_delay(event.attempts, retry_after) if retryable else None
        if delay is None:
            event.status = CrmEvent.Status.FAILED
        else:
            event.next_attempt_at = now + delay
    event.save()
    log.log(logging.INFO if event.status == 'delivered' else logging.WARNING,
            'crm event=%s type=%s order_version=%s attempt=%s code=%s status=%s err=%s', event.event_id,
            event.event_type, event.order_version, event.attempts, code, event.status, event.last_error[:300])
    return event


def blocked(event):
    """An earlier version of the same order is not delivered yet."""
    if event.order_id is None:
        return False
    return CrmEvent.objects.filter(order_id=event.order_id, order_version__lt=event.order_version) \
        .exclude(status=CrmEvent.Status.DELIVERED).exists()


def claim(event, now):
    """Atomic claim, safe with several workers on any database."""
    return CrmEvent.objects.filter(pk=event.pk, status=CrmEvent.Status.PENDING) \
        .filter(Q(locked_until__isnull=True) | Q(locked_until__lt=now)) \
        .update(locked_until=now + LEASE) == 1


def process_due(limit=100):
    """Send every due event once. Returns the number of attempts made."""
    if not configured():
        return 0
    now = timezone.now()
    due = CrmEvent.objects.filter(status=CrmEvent.Status.PENDING, next_attempt_at__lte=now) \
        .filter(Q(locked_until__isnull=True) | Q(locked_until__lt=now)).order_by('order_id', 'order_version', 'id')[:limit]
    sent = 0
    for e in due:
        if blocked(e) or not claim(e, now):
            continue
        e.refresh_from_db()
        attempt(e)
        sent += 1
    return sent


def resend(event):
    """Manual resend from the admin panel: back to the queue with a fresh retry budget."""
    CrmEvent.objects.filter(pk=event.pk).update(status=CrmEvent.Status.PENDING, attempts=0, locked_until=None,
                                                next_attempt_at=timezone.now())
    event.refresh_from_db()
    return event
