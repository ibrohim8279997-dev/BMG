"""Accounting documents: numbering, building from the books, validation, storno.

A document is created only if every requisite and amount on it matches the books (the deal snapshot and the
current party data). On any mismatch nothing is created and the caller gets the list of problems."""
import re

from django.db import transaction
from django.utils import timezone

from .deals import bmg_requisites, seller_requisites
from .models import DocSequence, Document
from .money import vat_inside, vat_on_top

INN = re.compile(r'^\d{9}$')


class DocumentMismatch(Exception):
    def __init__(self, problems):
        self.problems = problems
        super().__init__('; '.join(problems))


def next_number(kind):
    """Continuous numbering per series, never reused: a cancelled document keeps its number."""
    series = Document.SERIES[kind]
    seq, _ = DocSequence.objects.select_for_update().get_or_create(series=series)
    seq.last += 1
    seq.save(update_fields=['last'])
    return f'{series}-{seq.last:06d}'


def check_party(role, p, problems):
    if not (p.get('name') or '').strip():
        problems.append(f'{role}.name_missing')
    if not INN.match(p.get('inn') or ''):
        problems.append(f'{role}.inn_invalid')


def check_seller_matches_books(deal, problems):
    """The seller on the document is the deal snapshot; it must still match the seller's current record."""
    snap, now = deal.parties.get('seller', {}), seller_requisites(deal.seller)
    for f in ('inn', 'name'):
        if (snap.get(f) or '') != (now.get(f) or ''):
            problems.append(f'seller.{f}_changed_since_deal')
    check_party('seller', snap, problems)


def check_amounts(base, rate, vat, total, problems, inside=False):
    expected = vat_inside(total, rate) if inside else vat_on_top(base, rate)
    if vat != expected:
        problems.append('vat_amount_mismatch')
    if base + vat != total:
        problems.append('total_mismatch')


def _create(kind, problems, **fields):
    if problems:
        raise DocumentMismatch(sorted(set(problems)))
    return Document.objects.create(kind=kind, number=next_number(kind), date=timezone.localdate(), **fields)


def commission_invoice(deal, staff):
    """BMG -> seller: invoice for the agent fee of one confirmed deal."""
    problems = []
    bmg = bmg_requisites()
    check_party('bmg', bmg, problems)
    check_seller_matches_books(deal, problems)
    if bool(deal.bmg_vat_payer) != (deal.vat_rate > 0):
        problems.append('vat_status_mismatch')
    base, vat = deal.commission, deal.commission_vat
    check_amounts(base, deal.vat_rate, vat, base + vat, problems)
    if deal.documents.filter(kind=Document.Kind.COMMISSION_INVOICE, status=Document.Status.POSTED).exists():
        problems.append('already_issued')
    return _create(Document.Kind.COMMISSION_INVOICE, problems, seller=deal.seller, deal=deal, base=base,
                   vat_rate=deal.vat_rate, vat=vat, total=base + vat, created_by=staff,
                   payload={'bmg': bmg, 'seller': deal.parties['seller'], 'order_id': deal.order_id,
                            'lines': [{'title': 'agent_fee', 'deal_total': deal.goods,
                                       'rate_percent': str(deal.commission_rate), 'amount': base}]})


def seller_invoice_data(deal, staff):
    """Everything the seller needs for its e-invoice to the client. Draft until the seller confirms it;
    the seller signs it in the e-invoice operator, BMG only shows it."""
    problems = []
    check_seller_matches_books(deal, problems)
    client = deal.parties.get('client', {})
    if client.get('type') == 'legal':
        check_party('client', client, problems)
    vat = deal.seller_vat
    check_amounts(deal.total - vat, deal.seller_vat_rate, vat, deal.total, problems, inside=True)
    lines = [{'name': i.product_name, 'qty': str(i.qty), 'unit_price': str(i.unit_price)}
             for i in deal.order.items.filter(seller=deal.seller)]
    return _create(Document.Kind.SELLER_INVOICE, problems, status=Document.Status.DRAFT, seller=deal.seller, deal=deal,
                   base=deal.total - vat, vat_rate=deal.seller_vat_rate, vat=vat, total=deal.total, created_by=staff,
                   payload={'seller': deal.parties['seller'], 'client': client, 'order_id': deal.order_id,
                            'goods': deal.goods, 'delivery': deal.delivery, 'lines': lines})


@transaction.atomic
def seller_confirm(doc, seller):
    if doc.kind != Document.Kind.SELLER_INVOICE or doc.seller_id != seller.id or doc.status != Document.Status.DRAFT:
        raise DocumentMismatch(['invalid_state'])
    problems = []
    check_seller_matches_books(doc.deal, problems)
    if problems:
        raise DocumentMismatch(problems)
    doc.status, doc.seller_confirmed_at = Document.Status.POSTED, timezone.now()
    doc.save(update_fields=['status', 'seller_confirmed_at'])
    return doc


@transaction.atomic
def agent_act(seller, start, end, staff):
    """Act of agent services for one seller and period: all posted commission invoices dated in the period."""
    invs = list(Document.objects.filter(kind=Document.Kind.COMMISSION_INVOICE, status=Document.Status.POSTED,
                                        seller=seller, date__gte=start, date__lte=end).order_by('id'))
    problems = []
    if not invs:
        problems.append('nothing_to_act')
    if Document.objects.filter(kind=Document.Kind.AGENT_ACT, seller=seller, status=Document.Status.POSTED,
                               period_start__lte=end, period_end__gte=start).exists():
        problems.append('period_already_acted')
    bmg = bmg_requisites()
    check_party('bmg', bmg, problems)
    check_party('seller', seller_requisites(seller), problems)
    rates = {str(i.vat_rate) for i in invs}
    if len(rates) > 1:
        problems.append('mixed_vat_rates_split_the_period')
    base, vat = sum(i.base for i in invs), sum(i.vat for i in invs)
    if any(i.vat != vat_on_top(i.base, i.vat_rate) for i in invs):
        problems.append('vat_amount_mismatch')
    return _create(Document.Kind.AGENT_ACT, problems, seller=seller, period_start=start, period_end=end, base=base,
                   vat_rate=invs[0].vat_rate if invs else 0, vat=vat, total=base + vat, created_by=staff,
                   payload={'bmg': bmg, 'seller': seller_requisites(seller),
                            'lines': [{'invoice': i.number, 'date': i.date.isoformat(), 'deal_id': i.deal_id,
                                       'base': i.base, 'vat': i.vat} for i in invs]})


def payout_registry(deals, staff, ref):
    problems = []
    lines = []
    for d in deals:
        check_seller_matches_books(d, problems)
        s = d.parties['seller']
        if not (s.get('bank_account') and s.get('bank_mfo')):
            problems.append('seller.bank_details_missing')
        if d.payout != d.held - d.commission - d.commission_vat:
            problems.append('payout_mismatch')
        lines.append({'deal_id': d.id, 'order_id': d.order_id, 'seller_id': d.seller_id, 'seller': s.get('name'),
                      'inn': s.get('inn'), 'bank_account': s.get('bank_account'), 'bank_mfo': s.get('bank_mfo'),
                      'amount': d.payout})
    total = sum(d.payout for d in deals)
    return _create(Document.Kind.PAYOUT_REGISTRY, problems, base=total, total=total, created_by=staff,
                   payload={'bank_ref': ref, 'lines': lines})


@transaction.atomic
def storno(doc, staff, reason=''):
    """Reverse a document. A posted one gets a storno document with negative amounts; a draft is just closed."""
    doc = Document.objects.select_for_update().get(pk=doc.pk)
    if doc.kind == Document.Kind.STORNO or doc.status == Document.Status.REVERSED:
        raise DocumentMismatch(['invalid_state'])
    if doc.status == Document.Status.DRAFT:
        doc.status = Document.Status.REVERSED
        doc.save(update_fields=['status'])
        return None
    if doc.kind == Document.Kind.PAYOUT_REGISTRY:
        raise DocumentMismatch(['payout_cannot_be_reversed'])    # money left the account: handled by the bank
    s = Document.objects.create(
        kind=Document.Kind.STORNO, number=next_number(Document.Kind.STORNO), date=timezone.localdate(),
        seller=doc.seller, deal=doc.deal, period_start=doc.period_start, period_end=doc.period_end,
        base=-doc.base, vat_rate=doc.vat_rate, vat=-doc.vat, total=-doc.total, reverses=doc, created_by=staff,
        payload={'reverses': doc.number, 'reverses_kind': doc.kind, 'reason': str(reason)[:200], **{
            k: v for k, v in doc.payload.items() if k in ('bmg', 'seller', 'client', 'order_id')}})
    doc.status = Document.Status.REVERSED
    doc.save(update_fields=['status'])
    return s

