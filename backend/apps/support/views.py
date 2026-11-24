from django.shortcuts import get_object_or_404
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsClient
from apps.core.utils import throttle
from apps.orders.models import Order
from apps.sellers.models import Seller

from .models import Complaint, Review


class Complaints(APIView):
    throttle_classes = [throttle('upload')]

    def get(self, request):
        return Response([{'id': c.id, 'text': c.text, 'status': c.status, 'created_at': c.created_at}
                         for c in request.user.complaints.order_by('-id')[:50]])

    def post(self, request):
        text = str(request.data.get('text', '')).strip()
        if not text or len(text) > 3000:
            return Response({'error': 'invalid_request'}, status=400)
        seller = order = None
        if request.data.get('seller_id'):
            seller = Seller.objects.filter(pk=request.data['seller_id']).first() \
                if str(request.data['seller_id']).isdigit() else None
        if request.data.get('order_id'):   # only own orders can be referenced
            order = Order.objects.filter(pk=request.data['order_id'], client=request.user).first() \
                if str(request.data['order_id']).isdigit() else None
        c = Complaint.objects.create(author=request.user, text=text, seller=seller, order=order)
        return Response({'id': c.id}, status=201)


# ---- reviews: only after the seller's goods were delivered, one per order and seller

class Reviews(APIView):
    """Client: create a review (POST) or list what is still waiting for one (GET)."""
    permission_classes = [IsClient]

    def get(self, request):
        done = Review.objects.filter(author=request.user).values_list('order_id', 'seller_id')
        out = []
        for o in request.user.orders.filter(status='completed').prefetch_related('items__seller'):
            for sid, name in {(i.seller_id, i.seller.company_name) for i in o.items.all() if i.fulfilled}:
                if (o.id, sid) not in done:
                    out.append({'order_id': o.id, 'seller_id': sid, 'seller': name})
        return Response(out)

    def post(self, request):
        d = request.data
        try:
            rating, oid, sid = int(d.get('rating')), int(d.get('order_id')), int(d.get('seller_id'))
        except (TypeError, ValueError):
            return Response({'error': 'invalid_request'}, status=400)
        text = str(d.get('text', '')).strip()
        if not 1 <= rating <= 5 or len(text) > 1000:
            return Response({'error': 'invalid_request'}, status=400)
        order = Order.objects.filter(pk=oid, client=request.user).first()
        if order is None:
            return Response({'error': 'not_found'}, status=404)
        if order.status != 'completed' or not order.items.filter(seller_id=sid, fulfilled=True).exists() \
                or order.reviews.filter(seller_id=sid).exists():
            return Response({'error': 'invalid_state'}, status=400)
        seller = Seller.objects.get(pk=sid)
        r = Review.objects.create(author=request.user, seller=seller, order=order, rating=rating, text=text)
        seller.recompute_rating()
        return Response({'id': r.id, 'rating': str(seller.rating)}, status=201)


class SellerReviews(APIView):
    """Public list. The author is never shown."""
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, pk):
        s = get_object_or_404(Seller, pk=pk, status='approved')
        qs = s.reviews.filter(hidden=False)
        return Response({'rating': str(s.rating), 'count': qs.count(),
                         'results': [{'rating': r.rating, 'text': r.text, 'created_at': r.created_at} for r in qs[:50]]})
