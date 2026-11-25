"""Superadmin reports: revenue (MRR/ARR), seller quality, bypass flags, CSV exports, review moderation.
Everything is read-only aggregation over existing tables, except review moderation."""
import csv
from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework.response import Response

from apps.audit.models import AuditLog
from apps.audit.models import log as audit
from apps.core.models import Setting
from apps.orders.models import Order, OrderItem, PayoutRequest, Refund, SellerLedger
from apps.payments.models import LedgerEntry, Wallet
from apps.sellers.models import Seller, SellerApplication
from apps.support.models import Complaint, Review

from .views import AdminBase

ZERO = Decimal('0')


def bmg_revenue(o):
    """What BMG earns on a completed order: commission (online orders) or the prepayment plus any cash commission
    booked as the seller's debt (cash orders)."""
    if o.payment_mode == 'full':
        return o.commission_total
    from apps.orders.models import SellerLedger
    fee = SellerLedger.objects.filter(order=o, kind='cash_comm').aggregate(s=Sum('amount'))['s'] or ZERO
    return o.prepayment - fee


def month_start(d):
    return d.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def add_months(d, n):
    y, m = divmod(d.year * 12 + d.month - 1 + n, 12)
    return d.replace(year=y, month=m + 1)


class Revenue(AdminBase):
    """MRR/ARR and who pays what. MRR = BMG revenue of the last full calendar month; ARR = MRR x 12 (run-rate).
    Orders are bucketed by creation month (the completion date is not stored)."""
    required_perm = 'finance'

    def get(self, request):
        now = timezone.now()
        cur = month_start(now)
        first = add_months(cur, -11)
        buckets = {add_months(first, i).strftime('%Y-%m'): [ZERO, 0] for i in range(12)}
        for o in Order.objects.filter(status='completed', created_at__gte=first):
            b = buckets.get(o.created_at.strftime('%Y-%m'))
            if b is not None:
                b[0] += bmg_revenue(o)
                b[1] += 1
        series = [{'month': k, 'revenue': str(v[0]), 'orders': v[1]} for k, v in buckets.items()]
        last_full = buckets[add_months(cur, -1).strftime('%Y-%m')][0]
        prev_full = buckets[add_months(cur, -2).strftime('%Y-%m')][0]
        growth = None if prev_full == 0 else str(((last_full - prev_full) / prev_full * 100).quantize(Decimal('0.1')))
        payers = (OrderItem.objects.filter(order__status='completed', order__payment_mode='full')
                  .values('seller_id', 'seller__company_name').annotate(commission=Sum('commission_amount'),
                                                                      orders=Count('order_id', distinct=True))
                  .order_by('-commission')[:20])
        return Response({'mrr': str(last_full), 'arr': str(last_full * 12), 'mom_growth_percent': growth,
                         'current_month': str(buckets[cur.strftime('%Y-%m')][0]), 'series': series,
                         'sellers': [{'seller_id': p['seller_id'], 'company_name': p['seller__company_name'],
                                      'commission': str(p['commission']), 'orders': p['orders']} for p in payers]})


def seller_stats():
    """Per-seller quality figures; label is 'good', 'bad' or 'neutral' by simple, visible rules."""
    out = []
    for s in Seller.objects.filter(status='approved'):
        order_ids = set(OrderItem.objects.filter(seller=s).values_list('order_id', flat=True))
        orders = Order.objects.filter(id__in=order_ids).exclude(status='pending_payment')
        total = orders.count()
        completed = orders.filter(status='completed').count()
        seller_faults = Refund.objects.filter(fault='seller', order_id__in=order_ids).count()
        complaints = Complaint.objects.filter(seller=s).count()
        rate = (completed / total) if total else None
        if seller_faults >= 2 or complaints >= 3 or (total >= 3 and rate is not None and rate < 0.5):
            label = 'bad'
        elif total >= 3 and rate >= 0.8 and seller_faults == 0 and complaints == 0:
            label = 'good'
        else:
            label = 'neutral'
        out.append({'seller_id': s.id, 'company_name': s.company_name, 'rating': str(s.rating),
                    'reviews': s.reviews.filter(hidden=False).count(), 'orders': total, 'completed': completed,
                    'completion_rate': None if rate is None else round(rate, 2), 'seller_fault_refunds': seller_faults,
                    'complaints': complaints, 'label': label})
    return out


class SellerQuality(AdminBase):
    required_perm = 'sellers'

    def get(self, request):
        rows = seller_stats()
        want = request.query_params.get('label')
        if want:
            rows = [r for r in rows if r['label'] == want]
        return Response(sorted(rows, key=lambda r: ({'bad': 0, 'neutral': 1, 'good': 2}[r['label']], -r['orders'])))


def bypass_flags():
    """Phone revealed by a client, then an order with that seller that never closed: BMG should contact the seller."""
    days = int(Setting.get('bypass_check_days'))
    cutoff = timezone.now() - timedelta(days=days)
    first = {}
    for a in AuditLog.objects.filter(action='seller_phone_revealed', actor__isnull=False, actor__is_staff=False) \
            .order_by('created_at'):
        if a.object_id.isdigit():
            first.setdefault((a.actor_id, int(a.object_id)), a)
    flags = []
    for (uid, sid), a in first.items():
        orders = list(Order.objects.filter(client_id=uid, items__seller_id=sid, created_at__gte=a.created_at)
                      .distinct())
        if not orders or any(o.status == 'completed' for o in orders):
            continue
        cancelled = [o for o in orders if o.status == 'cancelled']
        stale = [o for o in orders if o.status == 'paid' and o.created_at <= cutoff]
        if cancelled or stale:
            flags.append({'client_id': uid, 'seller_id': sid, 'revealed_at': a.created_at,
                          'reason': 'order_cancelled' if cancelled else 'order_open',
                          'order_ids': [o.id for o in (cancelled or stale)]})
    return flags


class BypassFlags(AdminBase):
    required_perm = 'sellers'

    def get(self, request):
        return Response(bypass_flags())


class AdminReviews(AdminBase):
    required_perm = 'support'

    def get(self, request):
        return Response([{'id': r.id, 'seller_id': r.seller_id, 'order_id': r.order_id, 'rating': r.rating,
                          'text': r.text, 'hidden': r.hidden, 'created_at': r.created_at}
                         for r in Review.objects.all()[:200]])

    def patch(self, request, pk):
        r = get_object_or_404(Review, pk=pk)
        r.hidden = bool(request.data.get('hidden'))
        r.save(update_fields=['hidden'])
        r.seller.recompute_rating()
        audit(request, 'review_moderated', object_type='review', object_id=r.id, hidden=r.hidden)
        return Response({'ok': True})


# ---- CSV exports (finance)

def safe(v):
    """Spreadsheet formula injection guard: text that starts with = + - @ is prefixed with a quote."""
    s = '' if v is None else str(v)
    return "'" + s if s[:1] in ('=', '+', '-', '@') else s


EXPORTS = {
    'orders': (['id', 'created_at', 'status', 'client_id', 'city', 'payment_mode', 'goods_total', 'delivery_total',
                'total', 'prepayment', 'amount_paid', 'commission_total'],
               lambda: ((o.id, o.created_at, o.status, o.client_id, o.city, o.payment_mode, o.goods_total,
                         o.delivery_total, o.total, o.prepayment, o.amount_paid, o.commission_total)
                        for o in Order.objects.order_by('id').iterator())),
    'payments': (['id', 'created_at', 'user_id', 'kind', 'amount', 'balance_after', 'order_id', 'ref'],
                 lambda: ((e.id, e.created_at, e.wallet.user_id, e.kind, e.amount, e.balance_after, e.order_id, e.ref)
                          for e in LedgerEntry.objects.select_related('wallet').order_by('id').iterator())),
    'commissions': (['order_id', 'created_at', 'seller_id', 'product', 'qty', 'unit_price', 'commission_percent',
                     'commission_amount', 'order_status'],
                    lambda: ((i.order_id, i.order.created_at, i.seller_id, i.product_name, i.qty, i.unit_price,
                              i.commission_percent, i.commission_amount, i.order.status)
                             for i in OrderItem.objects.select_related('order').order_by('id').iterator())),
    'refunds': (['id', 'created_at', 'order_id', 'fault', 'amount', 'due_by', 'reserve_until'],
                lambda: ((r.id, r.created_at, r.order_id, r.fault, r.amount, r.due_by, r.reserve_until)
                         for r in Refund.objects.order_by('id').iterator())),
    'seller-ledger': (['id', 'created_at', 'seller_id', 'kind', 'amount', 'order_id'],
                      lambda: ((e.id, e.created_at, e.seller_id, e.kind, e.amount, e.order_id)
                               for e in SellerLedger.objects.order_by('id').iterator())),
    # bank payment registry: requested payouts with the seller's bank details, to pay them from the BMG account
    'payout-registry': (['payout_id', 'requested_at', 'seller_id', 'company', 'inn', 'bank_account', 'bank_mfo', 'bank_name',
                         'amount', 'purpose'],
                        lambda: ((p.id, p.created_at, p.seller_id, p.seller.company_name, p.seller.inn, p.seller.bank_account,
                                  p.seller.bank_mfo, p.seller.bank_name, p.amount, f'BMG payout #{p.id}')
                                 for p in PayoutRequest.objects.filter(status='requested').select_related('seller')
                                 .order_by('id').iterator())),
    # customer balances are a separate liability line, not mixed into revenue
    'client-balances': (['user_id', 'balance'],
                        lambda: ((w.user_id, w.balance) for w in Wallet.objects.order_by('user_id').iterator())),
}


class Export(AdminBase):
    required_perm = 'finance'

    def get(self, request, kind):
        spec = EXPORTS.get(kind)
        if spec is None:
            return Response(status=404)
        header, rows = spec
        resp = HttpResponse(content_type='text/csv; charset=utf-8')
        resp['Content-Disposition'] = f'attachment; filename="bmg-{kind}.csv"'
        resp['X-Content-Type-Options'] = 'nosniff'
        w = csv.writer(resp)
        w.writerow(header)
        for row in rows():
            w.writerow([safe(c) for c in row])
        audit(request, 'report_exported', object_type='report', object_id=kind)
        return resp


class Overview(AdminBase):
    """Start page: what needs attention, limited to what this staff member may see."""

    def get(self, request):
        u, out = request.user, {}
        if u.has_staff_perm('sellers'):
            out['applications_new'] = SellerApplication.objects.filter(status='new').count()
            out['sellers_pending'] = Seller.objects.filter(status='pending').count()
            out['contracts_unconfirmed'] = Seller.objects.filter(status='approved').exclude(contract_status='confirmed').count()
        if u.has_staff_perm('support'):
            out['complaints_new'] = Complaint.objects.filter(status='new').count()
        if u.has_staff_perm('finance'):
            out['payouts_requested'] = PayoutRequest.objects.filter(status='requested').count()
        if u.has_staff_perm('orders'):
            since = timezone.now() - timedelta(days=30)
            recent = Order.objects.filter(created_at__gte=since)
            out['orders_30d'] = recent.count()
            out['orders_paid'] = Order.objects.filter(status='paid').count()
            out['gmv_30d'] = str(recent.filter(status__in=['paid', 'completed']).aggregate(s=Sum('total'))['s'] or 0)
        if u.has_staff_perm('accounting'):
            from apps.accounting import services as acc
            out['accounting'] = acc.attention()
            out['vat_threshold'] = acc.vat_threshold()
        return Response(out)
