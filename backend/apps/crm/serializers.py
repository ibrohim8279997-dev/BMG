"""One order format for both the webhook `data` and the pull API. Money: JSON numbers, 2 decimals, UZS.

total = subtotal - discount_total + delivery_fee. Seller prices already include VAT (vat_included: true);
vat_amount / vat_total are the VAT inside those prices for sellers that are VAT payers, delivery included."""
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings

from apps.core.models import Setting

CENT = Decimal('0.01')


def q(v):
    return Decimal(v or 0).quantize(CENT, rounding=ROUND_HALF_UP)


def num(v):
    return float(q(v))


def iso(dt):
    return dt.isoformat() if dt else None


def vat_inside(amount, rate):
    return q(Decimal(amount) * Decimal(rate) / (100 + Decimal(rate))) if rate else q(0)


def seller_vat_rates(order, items):
    """VAT rate per seller: fixed in the deal once paid; before that, the seller's current status."""
    rates = {d.seller_id: Decimal(d.seller_vat_rate) for d in order.deals.all()}
    default = Decimal(str(Setting.get('vat_rate')))
    for i in items:
        rates.setdefault(i.seller_id, default if i.seller.vat_payer else Decimal('0'))
    return rates


def order_status(order, refunded):
    if order.status == 'cancelled' and refunded > 0:
        return 'refunded'
    return order.status


def serialize_order(order):
    from apps.payments.models import LedgerEntry
    items = list(order.items.select_related('seller', 'offer__product').order_by('id'))
    refunds = list(order.refunds.order_by('id'))
    rates = seller_vat_rates(order, items)
    out_items, vat_total = [], Decimal('0')
    for i in items:
        rate = rates.get(i.seller_id, Decimal('0'))
        line = i.line_total
        vat = vat_inside(line, rate)
        vat_total += vat + vat_inside(i.delivery_cost, rate)
        out_items.append({
            'sku': f'offer-{i.offer_id}' if i.offer_id else None,
            'product_id': i.offer.product_id if i.offer_id else None,
            'seller_id': str(i.seller_id), 'name': i.product_name, 'qty': float(i.qty),
            'unit': (i.offer.product.unit if i.offer_id else '') or 'pcs',
            'unit_price': num(i.unit_price), 'discount': 0.0, 'vat_rate': float(rate), 'vat_amount': num(vat),
            'total': num(line), 'commission_rate': float(i.commission_percent), 'commission_amount': num(i.commission_amount),
        })
    sellers, seen = [], set()
    for i in items:
        if i.seller_id not in seen:
            seen.add(i.seller_id)
            sellers.append({'id': str(i.seller_id), 'name': i.seller.company_name, 'inn': i.seller.inn or None})
    refunded = sum((r.amount for r in refunds), Decimal('0'))
    cash_part = q(order.total - order.amount_due_online) if order.payment_mode == 'cash' else q(0)
    paid = q(order.amount_paid) + (cash_part if order.status == 'completed' else 0)
    if refunded > 0:
        pstatus = 'refunded' if refunded >= paid else 'partially_refunded'
    else:
        pstatus = 'unpaid' if paid <= 0 else 'paid' if paid >= order.total else 'partial'
    entry = LedgerEntry.objects.filter(order_id=order.id, kind='order_payment').order_by('id').first()
    goods = q(order.goods_total)
    c = order.client
    legal = order.buyer_type == 'legal'
    return {
        'external_order_id': order.external_id,
        'order_number': order.number,
        'status': order_status(order, refunded),
        'created_at': iso(order.created_at), 'updated_at': iso(order.updated_at),
        'completed_at': iso(order.completed_at), 'cancelled_at': iso(order.cancelled_at),
        'cancel_reason': order.cancel_reason or None,
        'customer': {
            'id': str(c.id), 'type': order.buyer_type,
            'name': order.buyer_name if legal else (c.get_full_name() or None),
            'phone': c.phone or None, 'email': c.email or None,
            'telegram': str(c.telegram_id) if c.telegram_id else None,
            'company_name': order.buyer_name if legal else None, 'inn': order.buyer_inn if legal else None,
        },
        'seller': sellers[0] if len(sellers) == 1 else None,
        'sellers': sellers,
        'items': out_items,
        'subtotal': num(goods), 'discount_total': 0.0, 'delivery_fee': num(order.delivery_total),
        'vat_total': num(vat_total), 'vat_included': True, 'total': num(order.total), 'currency': 'UZS',
        'payment': {
            'method': 'cash' if order.payment_mode == 'cash' else 'click',
            'mode': order.payment_mode,               # full: everything online; cash: prepayment online, rest in cash
            'status': pstatus, 'paid_amount': num(paid), 'online_amount': num(order.amount_paid),
            'cash_amount': num(cash_part), 'prepayment': num(order.prepayment),
            'paid_at': iso(order.paid_at), 'transaction_id': f'wallet:{entry.id}' if entry else None,
        },
        'refunds': [{'refund_id': f'rf_{r.id}', 'amount': num(r.amount), 'reason': f'{r.fault}_fault',
                     'created_at': iso(r.created_at),
                     'items': [x['sku'] for x in out_items]} for r in refunds],   # BMG refunds always cover the whole order
        'marketplace_commission': {
            'amount': num(order.commission_total),
            'rate': float(q(order.commission_total * 100 / goods)) if goods else 0.0},
        'delivery': {'method': 'seller', 'address': order.city, 'region': order.city, 'courier': None,
                     'tracking_number': None, 'delivered_at': iso(order.completed_at)},
        'manager_comment': None,
        'source_url': f'{settings.SITE_URL}/ru/admin#orders',
    }


def serialize_payment(e, ext_ids):
    return {'payment_id': f'wallet:{e.id}', 'external_order_id': ext_ids.get(e.order_id), 'amount': num(-e.amount),
            'currency': 'UZS', 'method': 'wallet', 'status': 'paid', 'paid_at': iso(e.created_at)}


def serialize_refund(r):
    return {'refund_id': f'rf_{r.id}', 'external_order_id': r.order.external_id, 'amount': num(r.amount),
            'reason': f'{r.fault}_fault', 'created_at': iso(r.created_at),
            'due_by': r.due_by.isoformat() if r.due_by else None, 'currency': 'UZS'}


def serialize_settlement(s):
    return {'settlement_id': f'sl_{s.id}', 'seller': {'id': str(s.seller_id), 'name': s.seller.company_name,
                                                      'inn': s.seller.inn or None},
            'kind': s.kind, 'amount': num(s.amount), 'currency': 'UZS',
            'external_order_id': s.order.external_id if s.order_id else None, 'created_at': iso(s.created_at)}
