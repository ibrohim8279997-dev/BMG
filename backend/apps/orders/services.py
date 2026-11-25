from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.db.models import F, Sum
from django.utils import timezone

from apps.accounting import deals
from apps.catalog.models import Offer
from apps.crm import events as crm
from apps.core.models import Setting
from apps.payments import wallet

from .models import CartItem, Order, OrderItem, Refund, SellerLedger

CENT = Decimal('0.01')


def m(d):
    return str(q(d))


def q(d):
    return Decimal(d).quantize(CENT, rounding=ROUND_HALF_UP)


class OrderError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def expire_unpaid(now=None):
    """Unpaid orders reserve stock; after `order_payment_ttl_minutes` they are cancelled and the stock returns.
    Called lazily before every new order and by `manage.py expire_unpaid_orders` (cron)."""
    ttl = int(Setting.get('order_payment_ttl_minutes') or 0)
    if ttl <= 0:
        return 0
    cutoff = (now or timezone.now()) - timedelta(minutes=ttl)
    n = 0
    for pk in list(Order.objects.filter(status='pending_payment', created_at__lt=cutoff).values_list('pk', flat=True)[:500]):
        n += cancel_unpaid(pk, reason='payment_timeout')
    return n


@transaction.atomic
def cancel_unpaid(order_id, user=None, reason='client_cancelled'):
    """Cancel a pending_payment order and return its stock. Returns 1 if cancelled, 0 if it was not pending."""
    qs = Order.objects.select_for_update().filter(pk=order_id)
    if user is not None:
        qs = qs.filter(client=user)
    order = qs.first()
    if order is None or order.status != 'pending_payment':
        return 0
    for i in order.items.all():
        if i.offer_id:
            Offer.objects.filter(pk=i.offer_id).update(stock=F('stock') + i.qty)
    order.status, order.cancelled_at, order.cancel_reason = 'cancelled', timezone.now(), reason
    order.save(update_fields=['status', 'cancelled_at', 'cancel_reason'])
    return 1


@transaction.atomic
def create_order(user, city, mode, buyer=None):
    """Everything (prices, stock, delivery, fee) is computed here from the database, never from the client.
    buyer: {'type': 'individual'|'legal', 'inn', 'name'} - requisites for the seller's invoice (legal entities)."""
    if mode not in ('full', 'cash'):
        raise OrderError('invalid_request')
    buyer = buyer or {}
    btype = buyer.get('type') or 'individual'
    binn, bname = str(buyer.get('inn') or '').strip(), str(buyer.get('name') or '').strip()[:200]
    if btype not in ('individual', 'legal') or (btype == 'legal' and not (len(binn) == 9 and binn.isdigit() and bname)):
        raise OrderError('invalid_buyer')
    if btype == 'individual':
        binn = bname = ''
    expire_unpaid()
    cap = int(Setting.get('max_open_unpaid_orders') or 0)
    if cap and Order.objects.filter(client=user, status='pending_payment').count() >= cap:
        raise OrderError('too_many_unpaid_orders')
    cart = list(CartItem.objects.filter(user=user).order_by('offer_id'))
    if not cart:
        raise OrderError('cart_empty')
    offers = {o.id: o for o in Offer.objects.select_for_update().filter(id__in=[c.offer_id for c in cart])
              .select_related('seller', 'product')}
    city_l = city.strip().lower()
    items, goods, delivery_by_seller = [], Decimal('0'), {}
    for c in cart:
        o = offers[c.offer_id]
        # no orders for a seller whose agency contract BMG has not confirmed
        if not o.active or o.seller.status != 'approved' or not o.seller.contract_ok or o.stock < c.qty or c.qty <= 0:
            raise OrderError('offer_unavailable')
        if o.seller_id not in delivery_by_seller:
            rule = next((r for r in o.seller.delivery_rules.all() if r.region.strip().lower() == city_l), None)
            if rule is None:
                raise OrderError('no_delivery_to_city')
            delivery_by_seller[o.seller_id] = (rule.cost, True)
        first = delivery_by_seller[o.seller_id][1]
        dcost = delivery_by_seller[o.seller_id][0] if first else Decimal('0')
        delivery_by_seller[o.seller_id] = (delivery_by_seller[o.seller_id][0], False)
        pct = o.seller.commission_percent()
        line = q(o.price * c.qty)
        goods += line
        items.append(dict(offer=o, seller=o.seller, product_name=o.product.name, qty=c.qty, unit_price=o.price,
                          cost_price=o.cost_price, commission_percent=pct,
                          commission_amount=q(line * pct / 100), delivery_cost=dcost))
    delivery = sum((v[0] for v in delivery_by_seller.values()), Decimal('0'))
    total = q(goods + delivery)
    pct = Decimal(str(Setting.get('prepayment_percent' if mode == 'full' else 'prepayment_cash_percent')))
    min_sum = Decimal(str(Setting.get('prepayment_min_order_sum')))
    prepay = q(total * pct / 100) if total >= min_sum else q(0)
    due = total if mode == 'full' else prepay
    order = Order.objects.create(
        client=user, city=city, payment_mode=mode, goods_total=q(goods), delivery_total=q(delivery), total=total,
        prepayment=prepay, amount_due_online=due, commission_total=sum((i['commission_amount'] for i in items), Decimal('0')),
        status='pending_payment' if due > 0 else 'paid', buyer_type=btype, buyer_inn=binn, buyer_name=bname,
        paid_at=None if due > 0 else timezone.now())
    for i in items:
        o = i['offer']
        o.stock -= i['qty']
        o.save(update_fields=['stock'])
        OrderItem.objects.create(order=order, **i)
    CartItem.objects.filter(user=user).delete()
    if order.status == 'paid':
        deals.create_deals(order)
        crm.emit(order, 'order.created')     # nothing to pay online: the order is placed (confirmed) right away
    return order


@transaction.atomic
def pay_order(user, order_id):
    order = Order.objects.select_for_update().get(pk=order_id, client=user)
    if order.status != 'pending_payment':
        raise OrderError('invalid_state')
    try:
        wallet.change(user, -order.amount_due_online, 'order_payment', order_id=order.id)
    except wallet.InsufficientFunds:
        raise OrderError('insufficient_funds')
    order.amount_paid = order.amount_due_online
    order.status = 'paid'
    order.paid_at = timezone.now()
    order.save(update_fields=['amount_paid', 'status', 'paid_at'])
    deals.create_deals(order)      # amounts are fixed now, with the settings in force today
    crm.emit(order, 'order.created')   # placed = paid; the CRM opens the deal
    crm.emit(order, 'order.paid')
    return order


def seller_gross(order, seller):
    items = [i for i in order.items.all() if i.seller_id == seller.id]
    return sum((i.line_total + i.delivery_cost for i in items), Decimal('0')), \
        sum((i.commission_amount for i in items), Decimal('0')), items


def locked_balance(seller_id):
    """Lock the seller row (serialises every payout path), then return (ledger total, pending requests).
    Must be called inside a transaction."""
    from apps.sellers.models import Seller
    Seller.objects.select_for_update().only('pk').get(pk=seller_id)
    total = SellerLedger.objects.filter(seller_id=seller_id).aggregate(s=Sum('amount'))['s'] or Decimal('0')
    from .models import PayoutRequest
    pending = PayoutRequest.objects.filter(seller_id=seller_id, status='requested').aggregate(s=Sum('amount'))['s'] \
        or Decimal('0')
    return total, pending


@transaction.atomic
def release_payable(order_id, seller_id):
    """Credit the seller's payable for a delivered online order. Only called after the client confirmed receipt or
    staff confirmed the deal - never on the seller's own word. Idempotent (OrderItem.credited)."""
    order = Order.objects.select_for_update().get(pk=order_id)
    if order.payment_mode != 'full' or order.status not in ('paid', 'completed'):
        return None
    items = [i for i in order.items.all() if i.seller_id == seller_id]
    if not items or not all(i.fulfilled for i in items) or any(i.credited for i in items):
        return None
    seller = items[0].seller
    deal = deals.deal_for(order, seller)
    gross = sum((i.line_total + i.delivery_cost for i in items), Decimal('0'))
    commission = sum((i.commission_amount for i in items), Decimal('0'))
    payable = Decimal(deal.payout) if deal else q(gross - commission)   # the deal's fixed payout (VAT included)
    entry = SellerLedger.objects.create(seller=seller, kind='sale', amount=payable, order=order)
    for i in items:
        i.credited = True
        i.save(update_fields=['credited'])
    return entry


@transaction.atomic
def confirm_receipt(order_id, user):
    """The client confirms that the delivered goods were received: releases each delivered seller's payable."""
    order = Order.objects.select_for_update().get(pk=order_id, client=user)
    if order.status not in ('paid', 'completed'):
        raise OrderError('invalid_state')
    sellers = {i.seller_id for i in order.items.all() if i.fulfilled}
    if not sellers:
        raise OrderError('not_delivered')
    for s_id in sorted(sellers):
        release_payable(order.id, s_id)
    return order


@transaction.atomic
def fulfill(order_id, seller):
    """Seller marks own items delivered. Online orders: the payable is credited only after the client confirms
    receipt or staff confirm the deal (release_payable). Cash orders book the cash commission."""
    order = Order.objects.select_for_update().get(pk=order_id)
    if order.status != 'paid':
        raise OrderError('invalid_state')
    gross, commission, items = seller_gross(order, seller)
    if not items:
        raise OrderError('not_found')
    for i in items:
        i.fulfilled = True
        i.save(update_fields=['fulfilled'])
    deals.mark_delivered(order, seller)
    if order.payment_mode == 'cash' and not any(i.credited for i in items):
        # cash goes straight to the seller; BMG's cash commission (a setting, 0 by default) becomes the seller's debt,
        # netted from future online payouts. Delivery is never commissioned.
        pct = Decimal(str(Setting.get('cash_commission_percent')))
        fee = q(sum((i.line_total for i in items), Decimal('0')) * pct / 100)
        if fee > 0:
            SellerLedger.objects.create(seller=seller, kind='cash_comm', amount=-fee, order=order)
        for i in items:
            i.credited = True
            i.save(update_fields=['credited'])
    if all(i.fulfilled for i in order.items.all()):
        order.status = 'completed'
        order.completed_at = timezone.now()
        order.save(update_fields=['status', 'completed_at'])
        crm.emit(order, 'order.completed')
    else:
        crm.emit(order, 'order.updated')     # one of several sellers delivered
    return order


def add_business_days(start: date, n: int) -> date:
    d = start
    while n:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d


@transaction.atomic
def refund_order(order_id, fault, staff_user):
    """client fault: prepayment stays with BMG; seller fault: full refund, reclaimed from seller;
    BMG fault: full refund, due in 3 business days (+1 spare)."""
    order = Order.objects.select_for_update().get(pk=order_id)
    if fault not in ('client', 'seller', 'bmg') or order.status in ('pending_payment', 'cancelled') \
            or order.refunds.exists() or order.amount_paid <= 0:
        raise OrderError('invalid_state')
    if fault == 'client' and order.status == 'completed':
        raise OrderError('invalid_state')
    paid = order.amount_paid
    amount = max(Decimal('0'), paid - min(order.prepayment, paid)) if fault == 'client' else paid
    due = reserve = None
    if fault == 'bmg':
        today = date.today()
        due, reserve = add_business_days(today, 3), add_business_days(today, 4)
    if fault == 'seller':
        for s_id in sorted({i.seller_id for i in order.items.all()}):
            # claw back exactly what was credited to this seller for this order (the deal payout), not the gross
            credited = SellerLedger.objects.filter(seller_id=s_id, order=order, kind='sale') \
                .aggregate(s=Sum('amount'))['s'] or Decimal('0')
            if credited > 0:
                SellerLedger.objects.create(seller_id=s_id, kind='reversal', amount=-q(credited), order=order)
    if amount > 0:
        wallet.change(order.client, amount, 'refund', order_id=order.id, ref=fault)
    if not any(i.fulfilled for i in order.items.all()):
        for i in order.items.select_related('offer'):
            if i.offer_id:
                Offer.objects.filter(pk=i.offer_id).update(stock=F('stock') + i.qty)
    order.status = 'cancelled'
    order.cancelled_at = timezone.now()
    order.cancel_reason = f'{fault}_fault'
    order.save(update_fields=['status', 'cancelled_at', 'cancel_reason'])
    deals.refund(order, staff_user)    # storno for every posted document, nothing deleted
    refund = Refund.objects.create(order=order, fault=fault, amount=amount, due_by=due, reserve_until=reserve,
                                   processed_by=staff_user)
    if amount > 0:
        crm.emit(order, 'order.refunded')
    crm.emit(order, 'order.cancelled')   # closes the CRM deal
    return refund

