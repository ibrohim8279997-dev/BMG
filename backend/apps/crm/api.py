"""Read-only API for the CRM (accounting, reconciliation): /api/crm/v1/*.

Auth: `Authorization: Bearer <BMG_CRM_READ_KEY>` (a separate read-only key; empty = API off), optional IP allowlist
(CRM_READ_ALLOWED_IPS), HTTPS only outside DEBUG. Rate limit crm_read (>= 60/min); 429 carries Retry-After."""
import base64
import hmac
import json
from datetime import datetime, time, timedelta
from decimal import Decimal

from django.conf import settings
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from apps.core.utils import client_ip
from apps.orders.models import Order, Refund, SellerLedger
from apps.payments.models import LedgerEntry

from .serializers import num, serialize_order, serialize_payment, serialize_refund, serialize_settlement


class BadParam(Exception):
    def __init__(self, field):
        self.field = field


class ReadKey(BasePermission):
    def has_permission(self, request, view):
        key = settings.BMG_CRM_READ_KEY
        auth = request.META.get('HTTP_AUTHORIZATION', '')
        if not key or not auth.startswith('Bearer '):
            return False
        if not hmac.compare_digest(auth[7:].strip().encode(), key.encode()):
            return False
        allowed = settings.CRM_READ_ALLOWED_IPS
        if allowed and client_ip(request) not in allowed:
            return False
        if settings.CRM_READ_REQUIRE_HTTPS and not settings.DEBUG and not request.is_secure():
            return False
        return True


class CrmThrottle(SimpleRateThrottle):
    scope = 'crm_read'

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': client_ip(request)}


class Base(APIView):
    authentication_classes = []
    permission_classes = [ReadKey]
    throttle_classes = [CrmThrottle]

    def check_permissions(self, request):
        super().check_throttles(request)     # the limit applies to wrong keys too (no key guessing)
        super().check_permissions(request)

    def check_throttles(self, request):
        pass

    def get_authenticate_header(self, request):
        return 'Bearer'

    def permission_denied(self, request, message=None, code=None):
        from rest_framework.exceptions import AuthenticationFailed
        raise AuthenticationFailed('invalid_key')

    def handle_exception(self, exc):
        if isinstance(exc, BadParam):
            return Response({'error': 'invalid_request', 'field': exc.field}, status=400)
        return super().handle_exception(exc)


def limit_of(p):
    try:
        n = int(p.get('limit', 100))
    except ValueError:
        raise BadParam('limit')
    if not 1 <= n <= 500:
        raise BadParam('limit')
    return n


def parse_when(v, field, end=False):
    """YYYY-MM-DD (whole day, Tashkent time) or ISO 8601 with time."""
    if not v:
        return None
    try:
        if len(v) == 10:
            d = datetime.combine(datetime.strptime(v, '%Y-%m-%d').date(), time.min)
            return timezone.make_aware(d + timedelta(days=1) if end else d)
        dt = datetime.fromisoformat(v.replace('Z', '+00:00'))
        return dt if timezone.is_aware(dt) else timezone.make_aware(dt)
    except ValueError:
        raise BadParam(field)


def encode_cursor(**kw):
    return base64.urlsafe_b64encode(json.dumps(kw, separators=(',', ':')).encode()).decode().rstrip('=')


def decode_cursor(v):
    if not v:
        return None
    try:
        c = json.loads(base64.urlsafe_b64decode(v + '=' * (-len(v) % 4)))
    except (ValueError, TypeError):
        raise BadParam('cursor')
    if not isinstance(c, dict):          # e.g. a list or a number: a 400, not a 500
        raise BadParam('cursor')
    return c


def id_page(qs, p, field='created_at'):
    """Range from/to on `field`, ascending id, cursor = last id."""
    start, end = parse_when(p.get('from'), 'from'), parse_when(p.get('to'), 'to', end=True)
    if start:
        qs = qs.filter(**{f'{field}__gte': start})
    if end:
        qs = qs.filter(**{f'{field}__lt': end})
    c = decode_cursor(p.get('cursor'))
    if c:
        if not isinstance(c.get('id'), int):
            raise BadParam('cursor')
        qs = qs.filter(id__gt=c['id'])
    n = limit_of(p)
    rows = list(qs.order_by('id')[:n + 1])
    more = len(rows) > n
    rows = rows[:n]
    return rows, encode_cursor(id=rows[-1].id) if more else None


class Orders(Base):
    def get(self, request):
        p = request.query_params
        qs = Order.objects.select_related('client')
        since = parse_when(p.get('updated_since'), 'updated_since')
        if since:
            qs = qs.filter(updated_at__gte=since)
        c = decode_cursor(p.get('cursor'))
        if c:
            try:
                ts, cid = datetime.fromisoformat(c['t']), int(c['id'])
            except (KeyError, TypeError, ValueError):
                raise BadParam('cursor')
            qs = qs.filter(Q(updated_at__gt=ts) | Q(updated_at=ts, id__gt=cid))
        n = limit_of(p)
        rows = list(qs.order_by('updated_at', 'id')[:n + 1])
        more = len(rows) > n
        rows = rows[:n]
        nxt = encode_cursor(t=rows[-1].updated_at.isoformat(), id=rows[-1].id) if more else None
        return Response({'data': [serialize_order(o) for o in rows], 'next_cursor': nxt})


class OrderDetail(Base):
    def get(self, request, external_id):
        return Response(serialize_order(get_object_or_404(Order, external_id=external_id)))


class Payments(Base):
    def get(self, request):
        rows, nxt = id_page(LedgerEntry.objects.filter(kind='order_payment', order_id__isnull=False), request.query_params)
        ext = dict(Order.objects.filter(id__in={r.order_id for r in rows}).values_list('id', 'external_id'))
        return Response({'data': [serialize_payment(r, ext) for r in rows], 'next_cursor': nxt})


class Refunds(Base):
    def get(self, request):
        rows, nxt = id_page(Refund.objects.select_related('order'), request.query_params)
        return Response({'data': [serialize_refund(r) for r in rows], 'next_cursor': nxt})


class Settlements(Base):
    """Seller ledger: sale (payable credited), reversal, cash_comm (cash commission owed), payout."""
    def get(self, request):
        rows, nxt = id_page(SellerLedger.objects.select_related('seller', 'order'), request.query_params)
        return Response({'data': [serialize_settlement(r) for r in rows], 'next_cursor': nxt})


def daily(day):
    start = timezone.make_aware(datetime.combine(day, time.min))
    end = start + timedelta(days=1)
    paid = list(Order.objects.filter(paid_at__gte=start, paid_at__lt=end).select_related('client'))
    snaps = [serialize_order(o) for o in paid]
    by_method = {}
    for s in snaps:
        m = by_method.setdefault(s['payment']['method'], {'orders': 0, 'total': Decimal('0')})
        m['orders'] += 1
        m['total'] += Decimal(str(s['total']))
    received = -sum((e.amount for e in LedgerEntry.objects.filter(kind='order_payment', created_at__gte=start,
                                                                   created_at__lt=end)), Decimal('0'))
    refunds = list(Refund.objects.filter(created_at__gte=start, created_at__lt=end))
    return {
        'date': day.isoformat(), 'currency': 'UZS', 'timezone': settings.TIME_ZONE,
        'orders_count': len(paid),                     # orders placed (paid / confirmed) that day
        'orders_total': num(sum((Decimal(str(s['total'])) for s in snaps), Decimal('0'))),
        'revenue_received': num(received),             # money received online for orders that day
        'orders_completed': Order.objects.filter(completed_at__gte=start, completed_at__lt=end).count(),
        'orders_cancelled': Order.objects.filter(cancelled_at__gte=start, cancelled_at__lt=end).count(),
        'refunds_count': len(refunds), 'refunds_total': num(sum((r.amount for r in refunds), Decimal('0'))),
        'commission_total': num(sum((o.commission_total for o in paid), Decimal('0'))),
        'vat_total': num(sum((Decimal(str(s['vat_total'])) for s in snaps), Decimal('0'))),
        'by_payment_method': {k: {'orders': v['orders'], 'total': num(v['total'])} for k, v in sorted(by_method.items())},
    }


class DailyReport(Base):
    def get(self, request):
        try:
            day = datetime.strptime(request.query_params.get('date', ''), '%Y-%m-%d').date()
        except ValueError:
            raise BadParam('date')
        return Response(daily(day))
