"""Period summary, VAT threshold watch, document journal filters."""
from datetime import date

from django.db.models import Count, Q, Sum
from django.utils import timezone

from apps.core.models import Setting

from .models import Deal, Discrepancy, Document


def parse_date(raw):
    try:
        return date.fromisoformat(str(raw))
    except (TypeError, ValueError):
        return None


def period_from(params):
    """?from=YYYY-MM-DD&to=YYYY-MM-DD, default: the current month."""
    today = timezone.localdate()
    start = parse_date(params.get('from')) or today.replace(day=1)
    end = parse_date(params.get('to')) or today
    return (start, end) if start <= end else (end, start)


def summary(start, end, seller_id=None):
    """Turnover of deals (client money, transit), BMG commission (revenue), VAT on it, amounts due to sellers.
    Deals are counted by creation date; refunded deals are shown separately and excluded from the totals."""
    qs = Deal.objects.filter(created_at__date__gte=start, created_at__date__lte=end)
    if seller_id:
        qs = qs.filter(seller_id=seller_id)
    live = qs.exclude(status=Deal.Status.REFUNDED)
    agg = live.aggregate(n=Count('id'), turnover=Sum('total'), held=Sum('held'), commission=Sum('commission'),
                         vat=Sum('commission_vat'), payout=Sum('payout'))
    unpaid = live.filter(status__in=[Deal.Status.PAID, Deal.Status.DELIVERED, Deal.Status.CONFIRMED]) \
        .aggregate(s=Sum('payout'))['s'] or 0
    by_status = dict(qs.values_list('status').annotate(n=Count('id')))
    return {'from': start.isoformat(), 'to': end.isoformat(), 'deals': agg['n'] or 0,
            'turnover': agg['turnover'] or 0, 'held': agg['held'] or 0, 'commission': agg['commission'] or 0,
            'commission_vat': agg['vat'] or 0, 'payout_total': agg['payout'] or 0, 'payout_outstanding': unpaid,
            'refunded': qs.filter(status=Deal.Status.REFUNDED).aggregate(s=Sum('total'))['s'] or 0,
            'by_status': by_status}


def vat_threshold():
    """BMG's turnover for the general VAT regime threshold (12 000 BRV from 2026-06-01).
    Counted here as BMG's own revenue (commission) for the calendar year, since client money is transit.
    TODO (accountant): confirm how turnover is measured under the agent scheme."""
    year_start = timezone.localdate().replace(month=1, day=1)
    turnover = Deal.objects.filter(created_at__date__gte=year_start).exclude(status=Deal.Status.REFUNDED) \
        .aggregate(s=Sum('commission'))['s'] or 0
    limit = int(Setting.get('brv_value')) * int(Setting.get('vat_threshold_brv'))
    pct = round(turnover * 100 / limit, 1) if limit else 0
    return {'turnover': turnover, 'threshold': limit, 'percent': pct, 'since': year_start.isoformat(),
            'level': 'over' if pct >= 100 else 'near' if pct >= 80 else 'ok',
            'bmg_vat_payer': bool(Setting.get('bmg_vat_payer')), 'bmg_vat_from': Setting.get('bmg_vat_from')}


def journal(params):
    start, end = period_from(params)
    qs = Document.objects.select_related('seller').filter(date__gte=start, date__lte=end)
    if params.get('seller', '').isdigit():
        qs = qs.filter(seller_id=int(params['seller']))
    if params.get('status') in Document.Status.values:
        qs = qs.filter(status=params['status'])
    if params.get('kind') in Document.Kind.values:
        qs = qs.filter(kind=params['kind'])
    q = str(params.get('q', '')).strip()[:40]
    if q:
        qs = qs.filter(Q(number__icontains=q) | Q(seller__company_name__icontains=q))
    return qs


def attention():
    """What needs a human right now."""
    return {'to_confirm': Deal.objects.filter(status=Deal.Status.DELIVERED).count(),
            'to_pay_out': Deal.objects.filter(status=Deal.Status.CONFIRMED, payout__gt=0).count(),
            'seller_invoices_unconfirmed': Document.objects.filter(kind=Document.Kind.SELLER_INVOICE,
                                                                   status=Document.Status.DRAFT).count(),
            'discrepancies': Discrepancy.objects.filter(resolved=False).count()}
