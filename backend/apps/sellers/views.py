from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import log as audit
from apps.core.utils import throttle
from apps.uploads import validators as up

from .models import DeliveryRule, Seller, SellerFile


class IsSeller(BasePermission):
    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and u.role == 'seller' and hasattr(u, 'seller'))


class IsApprovedSeller(IsSeller):
    """Self-registered seller sees no cabinet and cannot list goods until approved."""

    def has_permission(self, request, view):
        return super().has_permission(request, view) and request.user.seller.is_approved


def profile(s: Seller, private=False):
    d = {'id': s.id, 'company_name': s.company_name, 'description': s.description, 'rating': str(s.rating),
         'regions': [r.region for r in s.delivery_rules.all()],
         'has_documents': s.files.filter(kind='document').exists(),
         'photos': [f.id for f in s.files.filter(kind='photo')]}
    if private:
        d.update(status=s.status, commission_percent=str(s.commission_percent()),
                 contact_phone=s.contact_phone)
    return d


class MyProfile(APIView):
    permission_classes = [IsSeller]

    def get(self, request):
        return Response(profile(request.user.seller, private=True))

    def patch(self, request):
        s = request.user.seller
        for f in ('company_name', 'description'):
            if f in request.data:
                setattr(s, f, str(request.data[f])[:2000])
        if 'contact_phone' in request.data:
            from apps.accounts.phone import normalize_phone
            ph = normalize_phone(str(request.data['contact_phone']))
            if not ph:
                return Response({'error': 'invalid_phone'}, status=400)
            s.contact_phone = ph
        s.save()
        return Response(profile(s, private=True))


class MyFiles(APIView):
    permission_classes = [IsApprovedSeller]
    throttle_classes = [throttle('upload')]

    def get(self, request):
        return Response([{'id': f.id, 'kind': f.kind, 'title': f.title, 'type': f.file_type, 'size': f.size}
                         for f in request.user.seller.files.all()])

    def post(self, request):
        f = request.FILES.get('file')
        kind = request.data.get('kind', 'document')
        if f is None or kind not in ('document', 'photo'):
            return Response({'error': 'invalid_request'}, status=400)
        try:
            ftype, data = up.validate(f, kind)
        except up.UploadError as e:
            return Response({'error': e.code}, status=400)
        obj = SellerFile.objects.create(seller=request.user.seller, kind=kind, title=str(request.data.get('title', ''))[:120],
                                        stored_name=up.store(data, ftype), file_type=ftype, size=len(data))
        return Response({'id': obj.id}, status=201)


class MyFileDelete(APIView):
    permission_classes = [IsApprovedSeller]

    def delete(self, request, pk):
        get_object_or_404(SellerFile, pk=pk, seller=request.user.seller).delete()
        return Response(status=204)


class MyDelivery(APIView):
    permission_classes = [IsApprovedSeller]

    def get(self, request):
        return Response([{'id': r.id, 'region': r.region, 'cost': str(r.cost), 'restrictions': r.restrictions}
                         for r in request.user.seller.delivery_rules.all()])

    def post(self, request):
        from decimal import Decimal, InvalidOperation
        region = str(request.data.get('region', '')).strip()[:80]
        try:
            cost = Decimal(str(request.data.get('cost', '0')))
        except InvalidOperation:
            return Response({'error': 'invalid_request'}, status=400)
        if not region or cost < 0:
            return Response({'error': 'invalid_request'}, status=400)
        r, _ = DeliveryRule.objects.update_or_create(
            seller=request.user.seller, region=region,
            defaults={'cost': cost, 'restrictions': str(request.data.get('restrictions', ''))[:300]})
        return Response({'id': r.id}, status=201)


class MyDeliveryDelete(APIView):
    permission_classes = [IsApprovedSeller]

    def delete(self, request, pk):
        get_object_or_404(DeliveryRule, pk=pk, seller=request.user.seller).delete()
        return Response(status=204)


class PublicSeller(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, pk):
        s = get_object_or_404(Seller, pk=pk, status='approved')
        return Response(profile(s))


class PublicSellerDocuments(APIView):
    """"View documents" button: public docs of an approved seller."""
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, pk):
        s = get_object_or_404(Seller, pk=pk, status='approved')
        return Response([{'id': f.id, 'title': f.title, 'type': f.file_type}
                         for f in s.files.filter(kind='document')])


class PublicFile(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, pk):
        f = get_object_or_404(SellerFile, pk=pk, seller__status='approved')
        try:
            data = up.open_stored(f.stored_name)
        except (up.UploadError, FileNotFoundError):
            return Response(status=404)
        resp = HttpResponse(data, content_type=up.CONTENT_TYPES[f.file_type])
        resp['X-Content-Type-Options'] = 'nosniff'
        disp = 'inline' if f.kind == 'photo' else 'attachment'
        resp['Content-Disposition'] = f'{disp}; filename="file-{f.id}.{f.file_type}"'
        return resp


class RevealPhone(APIView):
    """Seller's number is hidden; every reveal is written to the audit log."""
    throttle_classes = [throttle('reveal')]

    def post(self, request, pk):
        s = get_object_or_404(Seller, pk=pk, status='approved')
        order_id = request.data.get('order_id')
        if order_id:
            from apps.orders.models import Order
            order = Order.objects.filter(pk=order_id, client=request.user, items__seller=s).first()
            if not order:
                return Response({'error': 'invalid_request'}, status=400)
            order_id = order.id
        audit(request, 'seller_phone_revealed', object_type='seller', object_id=s.id,
              order_id=order_id or None, seller_user=s.user_id)
        return Response({'phone': s.contact_phone or s.user.phone})
