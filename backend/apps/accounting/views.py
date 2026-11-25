"""Seller side: the seller sees only its own invoice data (for its e-invoice to the client) and confirms it.
It never sees BMG's tax accounting."""
from django.shortcuts import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import log as audit
from apps.sellers.views import IsApprovedSeller

from . import documents as docs
from .models import Document


def payload(d):
    return {'id': d.id, 'number': d.number, 'date': d.date, 'status': d.status, 'order_id': d.payload.get('order_id'),
            'client': d.payload.get('client'), 'lines': d.payload.get('lines'), 'goods': d.payload.get('goods'),
            'delivery': d.payload.get('delivery'), 'base': d.base, 'vat_rate': str(d.vat_rate), 'vat': d.vat,
            'total': d.total, 'confirmed_at': d.seller_confirmed_at}


class SellerInvoices(APIView):
    permission_classes = [IsApprovedSeller]

    def get(self, request):
        qs = Document.objects.filter(kind=Document.Kind.SELLER_INVOICE, seller=request.user.seller)
        return Response([payload(d) for d in qs[:200]])


class SellerInvoiceConfirm(APIView):
    permission_classes = [IsApprovedSeller]

    def post(self, request, pk):
        d = get_object_or_404(Document, pk=pk, kind=Document.Kind.SELLER_INVOICE, seller=request.user.seller)
        try:
            docs.seller_confirm(d, request.user.seller)
        except docs.DocumentMismatch as e:
            return Response({'error': 'document_mismatch', 'problems': e.problems}, status=400)
        audit(request, 'seller_invoice_confirmed', object_type='document', object_id=d.id, number=d.number,
              before={'status': 'draft'}, after={'status': 'posted'})
        return Response(payload(d))
