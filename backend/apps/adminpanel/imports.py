"""Staff: import a seller's own goods database from Excel. AI determines the columns and which seller the file belongs
to; whatever it could not determine is asked in the UI. After import AI looks for a photo of every product."""
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.response import Response

from apps.audit.models import log as audit
from apps.catalog import import_flow
from apps.catalog.models import PriceImport
from apps.core.utils import throttle
from apps.sellers.models import Seller

from .views import AdminBase


def choosable():
    return Seller.objects.exclude(status='blocked')


def _err(e):
    return Response({'error': e.code}, status=e.status)


def staff_imports():
    return PriceImport.objects.filter(created_by__is_staff=True)


class Imports(AdminBase):
    required_perm = 'catalog'

    def get_throttles(self):
        return [throttle('upload')()] if self.request.method == 'POST' else []

    def get(self, request):
        return Response({
            'sellers': [{'id': s.id, 'company_name': s.company_name, 'status': s.status}
                        for s in choosable().order_by('company_name', 'id')[:500]],
            'recent': [{'id': i.id, 'file_name': i.file_name, 'status': i.status, 'created_at': i.created_at,
                        'seller': i.seller.company_name if i.seller_id else None}
                       for i in staff_imports().select_related('seller').order_by('-id')[:20]]})

    def post(self, request):
        try:
            imp, rows = import_flow.create(request.FILES.get('file'), request.user, detect=True)
        except import_flow.FlowError as e:
            return _err(e)
        audit(request, 'seller_import_uploaded', object_type='price_import', object_id=imp.id,
              seller=imp.seller_id, seller_by=(imp.ai.get('seller') or {}).get('by'))
        return Response(import_flow.payload(imp, rows), status=201)


class ImportDetail(AdminBase):
    required_perm = 'catalog'

    def get(self, request, pk):
        imp = get_object_or_404(staff_imports(), pk=pk)
        return Response(import_flow.payload(imp, import_flow.rows_of(imp)))

    def patch(self, request, pk):
        imp = get_object_or_404(staff_imports(), pk=pk, status='draft')
        data = {k: v for k, v in request.data.items() if k in ('mapping', 'header_row', 'seller_id')}
        if not data:
            return Response({'error': 'invalid_request'}, status=400)
        try:
            rows = import_flow.patch(imp, data, sellers=choosable())
        except import_flow.FlowError as e:
            return _err(e)
        return Response(import_flow.payload(imp, rows or import_flow.rows_of(imp)))


class ImportConfirm(AdminBase):
    required_perm = 'catalog'

    @transaction.atomic
    def post(self, request, pk):
        imp = get_object_or_404(staff_imports().select_for_update(), pk=pk, status='draft')
        try:
            import_flow.confirm(imp, request.user)
        except import_flow.FlowError as e:
            return _err(e)
        audit(request, 'seller_import_confirmed', object_type='price_import', object_id=imp.id, seller=imp.seller_id,
              created=imp.result['created'], updated=imp.result['updated'])
        return Response(import_flow.payload(imp))


class ImportImages(AdminBase):
    required_perm = 'catalog'

    def post(self, request, pk):
        try:
            imp = import_flow.image_step(staff_imports(), pk, request.user)
        except import_flow.FlowError as e:
            return _err(e)
        return Response(import_flow.payload(imp))
