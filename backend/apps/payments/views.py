from decimal import Decimal, InvalidOperation

from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.utils import throttle

from .click import pay_url
from .models import TopUp, Wallet


class WalletView(APIView):
    def get(self, request):
        w, _ = Wallet.objects.get_or_create(user=request.user)
        return Response({'balance': str(w.balance), 'currency': 'UZS',
                         'entries': [{'kind': e.kind, 'amount': str(e.amount), 'order_id': e.order_id,
                                      'at': e.created_at} for e in w.entries.order_by('-id')[:50]]})


class TopUpView(APIView):
    throttle_classes = [throttle('upload')]

    def post(self, request):
        try:
            amount = Decimal(str(request.data.get('amount')))
        except InvalidOperation:
            return Response({'error': 'invalid_request'}, status=400)
        if not amount.is_finite() or not Decimal('1000') <= amount <= Decimal('500000000') \
                or amount != amount.quantize(Decimal('0.01')):
            return Response({'error': 'invalid_request'}, status=400)
        t = TopUp.objects.create(user=request.user, amount=amount)
        return Response({'topup_id': t.id, 'pay_url': pay_url(t)}, status=201)
