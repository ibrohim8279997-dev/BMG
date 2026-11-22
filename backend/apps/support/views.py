from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.utils import throttle
from apps.orders.models import Order
from apps.sellers.models import Seller

from .models import Complaint


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
