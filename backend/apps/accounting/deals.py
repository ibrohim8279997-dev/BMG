"""Deal lifecycle: paid -> delivered -> confirmed -> paid_out, or -> refunded (storno).

Money is fixed once, at payment, from the order snapshot and the settings in force that day."""
from datetime import date

from django.db import transaction
from django.utils import timezone

from apps.core.models import Setting

from .models import Deal
from .money import allocate, dec, percent_of, to_sum, vat_inside, vat_on_top


class DealError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def bmg_requisites():
    return {'name': Setting.get('bmg_name'), 'inn': Setting.get('bmg_inn'), 'address': Setting.get('bmg_address'),
            'bank_name': Setting.get('bmg_bank_name'), 'bank_account': Setting.get('bmg_bank_account'),
            'bank_mfo': Setting.get('bmg_bank_mfo'), 'vat_payer': bool(Setting.get('bmg_vat_payer'))}


def seller_requisites(s):
    return {'id': s.id, 'name': s.company_name, 'inn': s.inn, 'address': s.legal_address, 'bank_name': s.bank_name,
            'bank_account': s.bank_account, 'bank_mfo': s.bank_mfo, 'vat_payer': s.vat_payer,
            'contract_number': s.contract_number, 'contract_date': s.contract_date.isoformat() if s.contract_date else ''}


def client_requisites(order):
    """Individuals: no personal data on accounting documents, only the type. Legal entities: INN and name."""
    if order.buyer_type == 'legal':
        return {'type': 'legal', 'inn': order.buyer_inn, 'name': order.buyer_name}
    return {'type': 'individual', 'inn': '', 'name': ''}


def bmg_vat_applies(on: date) -> bool:
    if not Setting.get('bmg_vat_payer'):
        return False
    start = str(Setting.get('bmg_vat_from') or '')
    try:
        return on >= date.fromisoformat(start) if start else True
    except ValueError:
        return False


def compute(goods, delivery, held, rate, bmg_vat, seller_vat_payer, vat_rate):
    """Pure calculation, used by create_deals and by tests. All inputs/outputs are integers except the rates."""
    commission = percent_of(goods, rate)            # delivery is never commissioned
    commission_vat = vat_on_top(commission, vat_rate) if bmg_vat else 0
    total = goods + delivery
    return {'goods': goods, 'delivery': delivery, 'total': total, 'held': held, 'commission': commission,
            'vat_rate': dec(vat_rate) if bmg_vat else dec(0), 'commission_vat': commission_vat,
            'seller_vat_rate': dec(vat_rate) if seller_vat_payer else dec(0),
            'seller_vat': vat_inside(total, vat_rate) if seller_vat_payer else 0,
            'payout': held - commission - commission_vat}


@transaction.atomic
def create_deals(order):
    """Idempotent: one deal per seller of a paid order."""
    items = list(order.items.select_related('seller'))
    by_seller = {}
    for i in items:
        by_seller.setdefault(i.seller_id, []).append(i)
    sids = sorted(by_seller)
    totals = [to_sum(sum(i.line_total for i in by_seller[s])) + to_sum(sum(i.delivery_cost for i in by_seller[s]))
              for s in sids]
    held = allocate(to_sum(order.amount_paid), totals)
    today = timezone.localdate()
    bmg_vat = bmg_vat_applies(today)
    vat_rate = Setting.get('vat_rate')
    bmg = bmg_requisites()
    out = []
    for s_id, h in zip(sids, held):
        existing = Deal.objects.filter(order=order, seller_id=s_id).first()
        if existing:
            out.append(existing)
            continue
        rows = by_seller[s_id]
        seller = rows[0].seller
        c = compute(to_sum(sum(i.line_total for i in rows)), to_sum(sum(i.delivery_cost for i in rows)), h,
                    rows[0].commission_percent, bmg_vat, seller.vat_payer, vat_rate)
        out.append(Deal.objects.create(
            order=order, seller=seller, payment_mode=order.payment_mode, commission_rate=rows[0].commission_percent,
            bmg_vat_payer=bmg_vat, seller_vat_payer=seller.vat_payer,
            parties={'bmg': bmg, 'seller': seller_requisites(seller), 'client': client_requisites(order)}, **c))
    return out


def deal_for(order, seller):
    d = Deal.objects.select_for_update().filter(order=order, seller=seller).first()
    if d is None and order.status in ('paid', 'completed'):
        create_deals(order)
        d = Deal.objects.select_for_update().filter(order=order, seller=seller).first()
    return d


def mark_delivered(order, seller):
    d = deal_for(order, seller)
    if d and d.status == Deal.Status.PAID:
        d.status, d.delivered_at = Deal.Status.DELIVERED, timezone.now()
        d.save(update_fields=['status', 'delivered_at'])
    return d


@transaction.atomic
def confirm(deal_id, staff):
    """A human confirms delivery. The commission invoice is issued automatically, in the same transaction:
    if its requisites do not match the books the confirmation fails as a whole."""
    from . import documents
    d = Deal.objects.select_for_update().get(pk=deal_id)
    if d.status != Deal.Status.DELIVERED:
        raise DealError('invalid_state')
    d.status, d.confirmed_at, d.confirmed_by = Deal.Status.CONFIRMED, timezone.now(), staff
    d.save(update_fields=['status', 'confirmed_at', 'confirmed_by'])
    documents.commission_invoice(d, staff)
    documents.seller_invoice_data(d, staff)
    return d


@transaction.atomic
def mark_paid_out(deal_ids, staff, ref):
    """A human confirms the bank transfer to the seller(s). Creates one payout registry document."""
    from apps.orders.models import SellerLedger

    from . import documents
    ref = str(ref or '').strip()[:80]
    if not ref or not deal_ids:
        raise DealError('invalid_request')
    deals = list(Deal.objects.select_for_update().filter(pk__in=deal_ids).order_by('id'))
    if len(deals) != len(set(deal_ids)) or any(d.status != Deal.Status.CONFIRMED or d.payout <= 0 for d in deals):
        raise DealError('invalid_state')
    reg = documents.payout_registry(deals, staff, ref)
    now = timezone.now()
    for d in deals:
        d.status, d.paid_out_at, d.paid_out_by, d.payout_ref = Deal.Status.PAID_OUT, now, staff, ref
        d.save(update_fields=['status', 'paid_out_at', 'paid_out_by', 'payout_ref'])
        if d.payment_mode == 'full':     # the payable was credited to the seller ledger at delivery
            SellerLedger.objects.create(seller=d.seller, kind='payout', amount=-dec(d.payout), order=d.order)
    return reg


@transaction.atomic
def refund(order, staff):
    """Order refunded: every deal becomes 'refunded' and each posted document gets a storno. Nothing is deleted."""
    from . import documents
    for d in Deal.objects.select_for_update().filter(order=order):
        if d.status == Deal.Status.REFUNDED:
            continue
        # already paid out: the seller-fault claw-back stays in the seller ledger (orders.services.refund_order)
        for doc in d.documents.filter(status__in=['posted', 'draft']).exclude(kind='storno'):
            documents.storno(doc, staff, reason='refund')
        d.status, d.refunded_at = Deal.Status.REFUNDED, timezone.now()
        d.save(update_fields=['status', 'refunded_at'])
