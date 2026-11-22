from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.db.models import F

from apps.catalog.models import Offer
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


@transaction.atomic
def create_order(user, city, mode):
    """Everything (prices, stock, delivery, fee) is computed here from the database, never from the client."""
    if mode not in ('full', 'cash'):
        raise OrderError('invalid_request')
    cart = list(CartItem.objects.filter(user=user).order_by('offer_id'))
    if not cart:
        raise OrderError('cart_empty')
    offers = {o.id: o for o in Offer.objects.select_for_update().filter(id__in=[c.offer_id for c in cart])
              .select_related('seller', 'product')}
    city_l = city.strip().lower()
    items, goods, delivery_by_seller = [], Decimal('0'), {}
    for c in cart:
        o = offers[c.offer_id]
        if not o.active or o.seller.status != 'approved' or o.stock < c.qty or c.qty <= 0:
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
        status='pending_payment' if due > 0 else 'paid')
    for i in items:
        o = i['offer']
        o.stock -= i['qty']
        o.save(update_fields=['stock'])
        OrderItem.objects.create(order=order, **i)
    CartItem.objects.filter(user=user).delete()
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
    order.save(update_fields=['amount_paid', 'status'])
    return order


def seller_gross(order, seller):
    items = [i for i in order.items.all() if i.seller_id == seller.id]
    return sum((i.line_total + i.delivery_cost for i in items), Decimal('0')), \
        sum((i.commission_amount for i in items), Decimal('0')), items


@transaction.atomic
def fulfill(order_id, seller):
    """Seller marks own items delivered. Payable is credited only for online-paid orders."""
    order = Order.objects.select_for_update().get(pk=order_id)
    if order.status != 'paid':
        raise OrderError('invalid_state')
    gross, commission, items = seller_gross(order, seller)
    if not items:
        raise OrderError('not_found')
    for i in items:
        i.fulfilled = True
        i.save(update_fields=['fulfilled'])
    if order.payment_mode == 'full' and not any(i.credited for i in items):
        SellerLedger.objects.create(seller=seller, kind='sale', amount=q(gross - commission), order=order)
        for i in items:
            i.credited = True
            i.save(update_fields=['credited'])
    if all(i.fulfilled for i in order.items.all()):
        order.status = 'completed'
        order.save(update_fields=['status'])
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
        for s_id in {i.seller_id for i in order.items.all()}:
            seller = next(i.seller for i in order.items.all() if i.seller_id == s_id)
            gross, commission, items = seller_gross(order, seller)
            if any(i.credited for i in items):   # payout already credited: claw back from future payouts
                SellerLedger.objects.create(seller=seller, kind='reversal', amount=-q(gross), order=order)
    if amount > 0:
        wallet.change(order.client, amount, 'refund', order_id=order.id, ref=fault)
    if not any(i.fulfilled for i in order.items.all()):
        for i in order.items.select_related('offer'):
            if i.offer_id:
                Offer.objects.filter(pk=i.offer_id).update(stock=F('stock') + i.qty)
    order.status = 'cancelled'
    order.save(update_fields=['status'])
    return Refund.objects.create(order=order, fault=fault, amount=amount, due_by=due, reserve_until=reserve,
                                 processed_by=staff_user)

