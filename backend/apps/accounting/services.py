from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.utils import timezone

from apps.core.models import Setting
from apps.orders.models import OrderItem

from .models import Invoice

CENT = Decimal('0.01')


def q(d):
    return Decimal(d).quantize(CENT, rounding=ROUND_HALF_UP)


def split_vat(gross, rate):
    """Commission is VAT-inclusive: returns (net, vat)."""
    gross, rate = Decimal(gross), Decimal(str(rate))
    vat = q(gross * rate / (100 + rate))
    return q(gross - vat), vat


def month_bounds(period: date):
    nxt = date(period.year + (period.month == 12), period.month % 12 + 1, 1)
    return period, nxt


@transaction.atomic
def generate_month(period: date):
    """One draft invoice per seller for COMPLETED online orders created in the month. Idempotent: an existing
    invoice for (seller, month) is never touched (so numbering and issued documents stay stable)."""
    start, end = month_bounds(period)
    rate = Decimal(str(Setting.get('vat_rate')))
    rows = OrderItem.objects.filter(order__status='completed', order__payment_mode='full', credited=True,
                                    order__created_at__date__gte=start, order__created_at__date__lt=end)
    per_seller = {}
    for i in rows.select_related('order'):
        per_seller.setdefault(i.seller_id, {}).setdefault(i.order_id, Decimal('0'))
        per_seller[i.seller_id][i.order_id] += i.commission_amount
    made = 0
    for sid, orders in per_seller.items():
        gross = q(sum(orders.values()))
        if gross <= 0 or Invoice.objects.filter(seller_id=sid, period=start).exists():
            continue
        net, vat = split_vat(gross, rate)
        Invoice.objects.create(seller_id=sid, period=start, gross=gross, vat_rate=rate, vat_amount=vat, net=net,
                               lines=[{'order_id': o, 'commission': str(q(c))} for o, c in sorted(orders.items())])
        made += 1
    return made


@transaction.atomic
def issue(invoice_id, staff):
    inv = Invoice.objects.select_for_update().get(pk=invoice_id)
    if inv.status != Invoice.Status.DRAFT:
        raise ValueError('invalid_state')
    year = inv.period.year
    last = Invoice.objects.filter(number__startswith=f'{year}-').exclude(number='').order_by('-number').first()
    n = int(last.number.split('-')[1]) + 1 if last else 1
    inv.number = f'{year}-{n:05d}'
    inv.status = Invoice.Status.ISSUED
    inv.issued_at = timezone.now()
    inv.issued_by = staff
    inv.save()
    return inv


def vat_report(period: date):
    """Output VAT for the month from ISSUED / SENT invoices (drafts are not tax documents).
    Cash-order prepayments are listed separately and NOT in the base: whether they are a taxable service is
    for the accountant to confirm."""
    from apps.orders.models import Order
    start, end = month_bounds(period)
    invs = Invoice.objects.filter(period=start, status__in=[Invoice.Status.ISSUED, Invoice.Status.SENT])
    prepay = sum((o.prepayment for o in Order.objects.filter(status='completed', payment_mode='cash',
                                                           created_at__date__gte=start, created_at__date__lt=end)), Decimal('0'))
    return {'period': start.isoformat(), 'vat_rate': str(Setting.get('vat_rate')),
            'invoices': invs.count(), 'taxable_base': str(q(sum((i.net for i in invs), Decimal('0')))),
            'output_vat': str(q(sum((i.vat_amount for i in invs), Decimal('0')))),
            'gross_commission': str(q(sum((i.gross for i in invs), Decimal('0')))),
            'drafts_not_counted': Invoice.objects.filter(period=start, status='draft').count(),
            'cash_prepayments_unclassified': str(q(prepay))}
