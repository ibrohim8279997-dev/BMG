"""Superadmin: tax accounting package (invoices, VAT) behind a switch, and the financial model."""
from datetime import date, timedelta
from decimal import Decimal

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response

from apps.accounting import services as acc
from apps.accounting.models import Invoice
from apps.audit.models import log as audit
from apps.core.models import Setting
from apps.orders.models import Order, Refund

from .views import AdminBase


def parse_month(raw):
    try:
        y, m = str(raw).split('-')
        return date(int(y), int(m), 1)
    except (ValueError, TypeError):
        return None


class TaxBase(AdminBase):
    """Whole package is off until the superadmin switches it on in settings."""
    required_perm = 'finance'

    def initial(self, request, *a, **kw):
        super().initial(request, *a, **kw)
        if not Setting.get('tax_accounting_enabled'):
            from rest_framework.exceptions import NotFound
            raise NotFound()


def inv_payload(i):
    return {'id': i.id, 'seller_id': i.seller_id, 'seller': i.seller.company_name, 'period': i.period, 'number': i.number,
            'status': i.status, 'gross': str(i.gross), 'vat_rate': str(i.vat_rate), 'vat_amount': str(i.vat_amount),
            'net': str(i.net), 'orders': len(i.lines), 'tax_ref': i.tax_ref, 'issued_at': i.issued_at}


class Invoices(TaxBase):
    def get(self, request):
        qs = Invoice.objects.select_related('seller')
        period = parse_month(request.query_params.get('month'))
        if period:
            qs = qs.filter(period=period)
        return Response([inv_payload(i) for i in qs[:300]])


class InvoiceGenerate(TaxBase):
    def post(self, request):
        period = parse_month(request.data.get('month'))
        if period is None or period >= timezone.now().date().replace(day=1):
            return Response({'error': 'invalid_request'}, status=400)    # only closed months
        n = acc.generate_month(period)
        audit(request, 'invoices_generated', object_type='period', object_id=period.isoformat(), created=n)
        return Response({'created': n})


class InvoiceAction(TaxBase):
    def post(self, request, pk, action):
        inv = get_object_or_404(Invoice, pk=pk)
        if action == 'issue':
            try:
                inv = acc.issue(pk, request.user)
            except ValueError:
                return Response({'error': 'invalid_state'}, status=400)
        elif action == 'sent':
            ref = str(request.data.get('tax_ref', '')).strip()[:80]
            if inv.status != Invoice.Status.ISSUED or not ref:
                return Response({'error': 'invalid_state' if ref else 'invalid_request'}, status=400)
            inv.status, inv.tax_ref = Invoice.Status.SENT, ref
            inv.save(update_fields=['status', 'tax_ref'])
        elif action == 'void':
            if inv.status not in (Invoice.Status.DRAFT, Invoice.Status.ISSUED):
                return Response({'error': 'invalid_state'}, status=400)
            inv.status = Invoice.Status.VOID
            inv.save(update_fields=['status'])
        else:
            return Response(status=404)
        audit(request, f'invoice_{action}', object_type='invoice', object_id=inv.id, number=inv.number)
        return Response(inv_payload(inv))


class VatReport(TaxBase):
    def get(self, request):
        period = parse_month(request.query_params.get('month'))
        if period is None:
            return Response({'error': 'invalid_request'}, status=400)
        return Response(acc.vat_report(period))


# ---- financial model: inputs are the owner's assumptions, defaults come from real data

INPUTS = {   # name: (min, max)
    'orders_per_day': (0, 100000), 'avg_basket': (0, 10**10), 'growth_pct': (-50, 200), 'commission_pct': (0, 30),
    'cash_share_pct': (0, 100), 'prepayment_pct': (0, 100), 'refund_rate_pct': (0, 100), 'vat_pct': (0, 30),
    'fixed_costs_month': (0, 10**11), 'variable_cost_per_order': (0, 10**9), 'marketing_month': (0, 10**11),
    'ai_cost_month': (0, 10**10), 'opening_cash': (-10**12, 10**12), 'months': (1, 36),
}


def model_defaults():
    since = timezone.now() - timedelta(days=30)
    done = Order.objects.filter(status__in=['paid', 'completed'])
    recent = done.filter(created_at__gte=since)
    n_all = done.count()
    goods = sum((o.goods_total for o in done), Decimal('0'))
    online = done.filter(payment_mode='full')
    online_goods = sum((o.goods_total for o in online), Decimal('0'))
    comm = sum((o.commission_total for o in online), Decimal('0'))
    paid_refunds = Refund.objects.count()
    return {
        'orders_per_day': round(recent.count() / 30, 2),
        'avg_basket': float(goods / n_all) if n_all else 0,
        'growth_pct': 0,
        'commission_pct': float(comm / online_goods * 100) if online_goods else float(Setting.get('default_commission_percent')),
        'cash_share_pct': round(done.filter(payment_mode='cash').count() / n_all * 100, 1) if n_all else 0,
        'prepayment_pct': float(Setting.get('prepayment_cash_percent')),
        'refund_rate_pct': round(paid_refunds / n_all * 100, 1) if n_all else 0,
        'vat_pct': float(Setting.get('vat_rate')) if Setting.get('tax_accounting_enabled') else 0,
        'fixed_costs_month': 0, 'variable_cost_per_order': 0, 'marketing_month': 0, 'ai_cost_month': 0,
        'opening_cash': 0, 'months': 12, 'based_on_orders': n_all,
    }


def project(inp):
    """Monthly projection. Revenue = commission on online orders + prepayment on cash orders; the VAT part of revenue is
    removed when vat_pct > 0; refunds lose the fee. All of it is a model of the owner's assumptions, not accounting."""
    rows, cash, peak_need, be, total_rev, total_profit = [], inp['opening_cash'], inp['opening_cash'], None, 0.0, 0.0
    for m in range(int(inp['months'])):
        orders = inp['orders_per_day'] * 30 * (1 + inp['growth_pct'] / 100) ** m
        cash_orders = orders * inp['cash_share_pct'] / 100
        online_orders = orders - cash_orders
        revenue = online_orders * inp['avg_basket'] * inp['commission_pct'] / 100 \
            + cash_orders * inp['avg_basket'] * inp['prepayment_pct'] / 100
        vat = revenue * inp['vat_pct'] / (100 + inp['vat_pct'])
        refunds = (revenue - vat) * inp['refund_rate_pct'] / 100
        costs = inp['fixed_costs_month'] + inp['marketing_month'] + inp['ai_cost_month'] + inp['variable_cost_per_order'] * orders
        profit = revenue - vat - refunds - costs
        cash += profit
        peak_need = min(peak_need, cash)
        be = m + 1 if be is None and profit >= 0 else be
        total_rev += revenue
        total_profit += profit
        rows.append({'month': m + 1, 'orders': round(orders, 1), 'gmv': round(orders * inp['avg_basket'], 2),
                     'revenue': round(revenue, 2), 'vat': round(vat, 2), 'refunds': round(refunds, 2),
                     'costs': round(costs, 2), 'profit': round(profit, 2), 'cash': round(cash, 2)})
    return {'rows': rows, 'summary': {
        'total_revenue': round(total_rev, 2), 'total_profit': round(total_profit, 2), 'break_even_month': be,
        'lowest_cash': round(peak_need, 2), 'funding_needed': round(max(0.0, inp['opening_cash'] - peak_need), 2)}}


class FinancialModel(AdminBase):
    required_perm = 'finance'

    def get(self, request):
        return Response(model_defaults())

    def post(self, request):
        base = model_defaults()
        inp = {}
        for k, (lo, hi) in INPUTS.items():
            v = request.data.get(k, base[k])
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi or v != v:
                return Response({'error': 'invalid_request', 'field': k}, status=400)
            inp[k] = float(v)
        return Response(project(inp))
