from decimal import Decimal, InvalidOperation

from django.db.models import Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.catalog.models import Offer
from apps.core.permissions import IsClient
from apps.sellers.views import IsApprovedSeller

from . import services as svc
from .services import m
from .models import CartItem, Order, OrderItem, PayoutRequest, SellerLedger


def order_payload(o, items=None):
    items = o.items.all() if items is None else items
    return {'id': o.id, 'status': o.status, 'city': o.city, 'payment_mode': o.payment_mode,
            'goods_total': str(o.goods_total), 'delivery_total': str(o.delivery_total), 'total': str(o.total),
            'prepayment': str(o.prepayment), 'amount_due_online': str(o.amount_due_online),
            'amount_paid': str(o.amount_paid), 'created_at': o.created_at,
            'items': [{'id': i.id, 'name': i.product_name, 'qty': str(i.qty), 'unit_price': str(i.unit_price),
                       'seller_id': i.seller_id, 'fulfilled': i.fulfilled} for i in items]}


class Cart(APIView):
    permission_classes = [IsClient]

    def get(self, request):
        items = request.user.cart.select_related('offer__product', 'offer__seller')
        return Response([{'id': c.id, 'offer_id': c.offer_id, 'name': c.offer.product.name, 'qty': str(c.qty),
                          'unit_price': str(c.offer.price), 'seller': c.offer.seller.company_name,
                          'available': c.offer.active and c.offer.stock >= c.qty} for c in items])

    def post(self, request):
        try:
            qty = Decimal(str(request.data.get('qty')))
        except InvalidOperation:
            return Response({'error': 'invalid_request'}, status=400)
        offer = Offer.objects.filter(pk=request.data.get('offer_id') if str(request.data.get('offer_id')).isdigit() else 0,
                                     active=True, seller__status='approved').first()
        if offer is None or not qty.is_finite() or qty <= 0 or qty > offer.stock:
            return Response({'error': 'invalid_request'}, status=400)
        CartItem.objects.update_or_create(user=request.user, offer=offer, defaults={'qty': qty})
        return Response(status=201)


class CartItemView(APIView):
    permission_classes = [IsClient]

    def delete(self, request, pk):
        get_object_or_404(CartItem, pk=pk, user=request.user).delete()
        return Response(status=204)


class Orders(APIView):
    permission_classes = [IsClient]

    def get(self, request):
        return Response([order_payload(o) for o in request.user.orders.prefetch_related('items').order_by('-id')[:50]])

    def post(self, request):
        city = str(request.data.get('city', '')).strip()[:80]
        if not city:
            return Response({'error': 'invalid_request'}, status=400)
        try:
            o = svc.create_order(request.user, city, request.data.get('payment_mode', 'full'))
        except svc.OrderError as e:
            return Response({'error': e.code}, status=400)
        return Response(order_payload(o), status=201)


class OrderDetail(APIView):
    permission_classes = [IsClient]

    def get(self, request, pk):
        return Response(order_payload(get_object_or_404(Order, pk=pk, client=request.user)))


class PayOrder(APIView):
    permission_classes = [IsClient]

    def post(self, request, pk):
        get_object_or_404(Order, pk=pk, client=request.user)
        try:
            o = svc.pay_order(request.user, pk)
        except svc.OrderError as e:
            return Response({'error': e.code}, status=402 if e.code == 'insufficient_funds' else 400)
        return Response(order_payload(o))


# ---- seller side (own data only)

class SellerOrders(APIView):
    permission_classes = [IsApprovedSeller]

    def get(self, request):
        seller = request.user.seller
        order_ids = OrderItem.objects.filter(seller=seller, order__status__in=['paid', 'completed']) \
            .values_list('order_id', flat=True).distinct()
        out = []
        for o in Order.objects.filter(id__in=order_ids).order_by('-id')[:100]:
            items = [i for i in o.items.all() if i.seller_id == seller.id]   # only this seller's lines
            out.append({'id': o.id, 'status': o.status, 'city': o.city, 'payment_mode': o.payment_mode,
                        'items': [{'id': i.id, 'name': i.product_name, 'qty': str(i.qty),
                                   'unit_price': str(i.unit_price), 'fulfilled': i.fulfilled} for i in items]})
        return Response(out)


class SellerFulfill(APIView):
    permission_classes = [IsApprovedSeller]

    def post(self, request, pk):
        if not OrderItem.objects.filter(order_id=pk, seller=request.user.seller).exists():
            return Response(status=404)
        try:
            svc.fulfill(pk, request.user.seller)
        except svc.OrderError as e:
            return Response({'error': e.code}, status=400)
        return Response({'ok': True})


def balance(seller):
    total = SellerLedger.objects.filter(seller=seller).aggregate(s=Sum('amount'))['s'] or Decimal('0')
    pending = PayoutRequest.objects.filter(seller=seller, status='requested').aggregate(s=Sum('amount'))['s'] or Decimal('0')
    return total, pending


class SellerAnalytics(APIView):
    """Internal analytics only; not tax reporting. Margin only when cost prices were provided."""
    permission_classes = [IsApprovedSeller]

    def get(self, request):
        seller = request.user.seller
        items = list(OrderItem.objects.filter(seller=seller, order__status__in=['paid', 'completed'])
                     .select_related('order'))
        revenue = sum((i.line_total for i in items), Decimal('0'))
        data = {'orders': len({i.order_id for i in items}), 'revenue': str(revenue),
                'commission': str(sum((i.commission_amount for i in items), Decimal('0'))), 'top': []}
        by = {}
        for i in items:
            by[i.product_name] = by.get(i.product_name, Decimal('0')) + i.line_total
        data['top'] = [{'name': k, 'revenue': str(v)} for k, v in sorted(by.items(), key=lambda x: -x[1])[:10]]
        with_cost = [i for i in items if i.cost_price is not None]
        if with_cost:   # margin appears only when cost price is known
            data['margin'] = m(sum((i.line_total - i.cost_price * i.qty for i in with_cost), Decimal('0')))
            data['margin_covers_revenue'] = m(sum((i.line_total for i in with_cost), Decimal('0')))
        bal, pending = balance(seller)
        data['payable_balance'] = m(bal - pending)
        data['disclaimer'] = 'internal'
        return Response(data)


class SellerPayout(APIView):
    permission_classes = [IsApprovedSeller]

    def post(self, request):
        bal, pending = balance(request.user.seller)
        avail = bal - pending
        try:
            amount = Decimal(str(request.data.get('amount')))
        except InvalidOperation:
            return Response({'error': 'invalid_request'}, status=400)
        if not amount.is_finite() or amount <= 0 or amount > avail:
            return Response({'error': 'insufficient_funds'}, status=400)
        PayoutRequest.objects.create(seller=request.user.seller, amount=amount)
        return Response(status=201)
