"""Reconciliation of Click payments and wallet movements with deal amounts.
Every mismatch becomes a Discrepancy row for the accountant; nothing is corrected automatically."""
from django.db.models import Sum

from apps.orders.models import Order
from apps.payments.models import ClickEvent, LedgerEntry, TopUp

from .models import Deal, Discrepancy
from .money import to_sum


def _flag(kind, key, order=None, expected=0, actual=0, note=''):
    _, created = Discrepancy.objects.get_or_create(
        key=f'{kind}:{key}'[:60],
        defaults=dict(kind=kind, order=order, expected=expected, actual=actual, note=note[:200]))
    return int(created)


def run():
    found = 0
    # 1. every paid Click top-up: a successful 'complete' callback with the same amount, and one wallet credit
    for t in TopUp.objects.filter(status='paid', click_trans_id__isnull=False).iterator():
        amount = to_sum(t.amount)
        ok_event = ClickEvent.objects.filter(click_trans_id=t.click_trans_id, action=1, result=0).first()
        ev_amount = None
        if ok_event:
            try:
                ev_amount = to_sum(ok_event.raw.get('amount', ''))
            except (ValueError, TypeError):
                ev_amount = None
        if ev_amount != amount:
            found += _flag('click_amount_mismatch', t.id, expected=amount, actual=ev_amount or 0,
                           note=f'topup {t.id}, click {t.click_trans_id}')
        credited = LedgerEntry.objects.filter(kind='topup', ref=f'click:{t.click_trans_id}').aggregate(s=Sum('amount'))['s']
        if credited is None or to_sum(credited) != amount:
            found += _flag('wallet_credit_mismatch', t.id, expected=amount, actual=to_sum(credited or 0),
                           note=f'topup {t.id}')
    # 2. every paid order: wallet debit == amount paid == amount due == money held across its deals
    for o in Order.objects.filter(status__in=['paid', 'completed']).iterator():
        paid = to_sum(o.amount_paid)
        if paid != to_sum(o.amount_due_online):
            found += _flag('order_paid_vs_due', o.id, o, to_sum(o.amount_due_online), paid)
        debit = LedgerEntry.objects.filter(kind='order_payment', order_id=o.id).aggregate(s=Sum('amount'))['s']
        if debit is not None and to_sum(-debit) != paid:
            found += _flag('order_wallet_mismatch', o.id, o, paid, to_sum(-debit))
        held = Deal.objects.filter(order=o).aggregate(s=Sum('held'))['s']
        if held is not None and held != paid:
            found += _flag('deal_held_mismatch', o.id, o, paid, held)
    # 3. deals whose fixed payout does not add up
    for d in Deal.objects.exclude(status='refunded').iterator():
        if d.payout != d.held - d.commission - d.commission_vat or d.total != d.goods + d.delivery:
            found += _flag('deal_arithmetic', d.id, d.order, d.held - d.commission - d.commission_vat, d.payout)
    return found
