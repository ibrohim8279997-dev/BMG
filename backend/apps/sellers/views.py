import re

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import log as audit
from apps.core.utils import throttle
from apps.uploads import validators as up

from .models import DeliveryRule, Seller, SellerApplication, SellerFile


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
         'photos': [f.id for f in s.files.filter(kind='photo')],
         'review_count': s.reviews.filter(hidden=False).count(),
         'verified_by_bmg': s.is_approved and s.approved_at is not None,
         'approved_at': s.approved_at}
    if private:
        d.update(status=s.status, commission_percent=str(s.commission_percent()),
                 contact_phone=s.contact_phone, inn=s.inn, bank_account=s.bank_account, bank_mfo=s.bank_mfo,
                 bank_name=s.bank_name)
    return d


BANK_FIELDS = {'inn': 9, 'bank_account': 20, 'bank_mfo': 5}   # digits required
# Identity and payout requisites. Once staff approved the seller, a filled-in value can only be changed by staff
# (admin-api accounting/sellers, audited): a hijacked seller session must not be able to redirect payouts or rename
# a verified company. Empty fields may still be filled in once.
LOCKED_AFTER_APPROVAL = ('company_name', 'inn', 'bank_account', 'bank_mfo', 'bank_name')


class MyProfile(APIView):
    permission_classes = [IsSeller]

    def get(self, request):
        return Response(profile(request.user.seller, private=True))

    def patch(self, request):
        s = request.user.seller
        before = {f: getattr(s, f) for f in LOCKED_AFTER_APPROVAL + ('description', 'contact_phone')}
        if 'company_name' in request.data:
            s.company_name = str(request.data['company_name']).strip()[:200]
        if 'description' in request.data:
            s.description = str(request.data['description'])[:2000]
        if 'contact_phone' in request.data:
            from apps.accounts.phone import normalize_phone
            ph = normalize_phone(str(request.data['contact_phone']))
            if not ph:
                return Response({'error': 'invalid_phone'}, status=400)
            s.contact_phone = ph
        for f, n in BANK_FIELDS.items():
            if f in request.data:
                v = str(request.data[f]).strip().replace(' ', '')
                if v and not (v.isdigit() and len(v) == n):
                    return Response({'error': 'invalid_request', 'field': f}, status=400)
                setattr(s, f, v)
        if 'bank_name' in request.data:
            s.bank_name = str(request.data['bank_name']).strip()[:120]
        if s.status == 'approved':
            for f in LOCKED_AFTER_APPROVAL:
                if before[f] and getattr(s, f) != before[f]:
                    return Response({'error': 'requisites_locked', 'field': f}, status=400)
        if s.inn and s.inn != before['inn'] and Seller.objects.filter(inn=s.inn).exclude(pk=s.pk).exists():
            return Response({'error': 'inn_taken', 'field': 'inn'}, status=400)
        s.save()
        changed = {f: [before[f], getattr(s, f)] for f in before if before[f] != getattr(s, f)}
        if changed:
            audit(request, 'seller_profile_changed', object_type='seller', object_id=s.id,
                  before={f: v[0] for f, v in changed.items()}, after={f: v[1] for f, v in changed.items()})
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
        if not region or not cost.is_finite() or cost < 0:
            return Response({'error': 'invalid_request'}, status=400)
        # delivery is not commissioned: an uncapped cost would let goods be listed at 0.01 and the price moved here
        from apps.core.models import Setting
        if cost > Decimal(str(Setting.get('delivery_cost_max'))):
            return Response({'error': 'delivery_cost_too_high'}, status=400)
        cost = cost.quantize(Decimal('0.01'))
        old = DeliveryRule.objects.filter(seller=request.user.seller, region=region).first()
        r, _ = DeliveryRule.objects.update_or_create(
            seller=request.user.seller, region=region,
            defaults={'cost': cost, 'restrictions': str(request.data.get('restrictions', ''))[:300]})
        audit(request, 'delivery_rule_saved', object_type='seller', object_id=request.user.seller.id, region=region,
              before=str(old.cost) if old else None, after=str(cost))
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
    """Seller's number is hidden; every reveal is written to the audit log. Clients only, with a daily cap per
    account, and only the seller's published contact number (never the personal login phone)."""
    throttle_classes = [throttle('reveal')]

    def post(self, request, pk):
        from apps.core.permissions import IsClient
        if not IsClient().has_permission(request, self):
            return Response({'error': 'forbidden'}, status=403)
        s = get_object_or_404(Seller, pk=pk, status='approved')
        order_id = request.data.get('order_id')
        if order_id not in (None, ''):
            if not str(order_id).isdigit():
                return Response({'error': 'invalid_request'}, status=400)
            from apps.orders.models import Order
            order = Order.objects.filter(pk=int(order_id), client=request.user, items__seller=s).first()
            if not order:
                return Response({'error': 'invalid_request'}, status=400)
            order_id = order.id
        if not s.contact_phone:
            return Response({'error': 'not_found'}, status=404)
        from django.core.cache import cache
        from apps.core.models import Setting
        key = f'reveals:{request.user.pk}:{timezone.localdate().isoformat()}'
        cache.add(key, 0, 86400)
        if cache.incr(key) > int(Setting.get('phone_reveals_per_day')):
            return Response({'error': 'too_many_requests'}, status=429)
        audit(request, 'seller_phone_revealed', object_type='seller', object_id=s.id,
              order_id=order_id or None, seller_user=s.user_id)
        return Response({'phone': s.contact_phone})


class SellerList(APIView):
    """Public list of approved sellers. Only what the company itself stored: no invented logos, ratings or counts."""
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        from apps.catalog.models import Offer
        lang = request.query_params.get('lang', 'ru')
        lang = lang if lang in ('uz', 'ru', 'en') else 'ru'
        q = (request.query_params.get('q') or '').strip()[:80]
        qs = Seller.objects.filter(status='approved').prefetch_related('delivery_rules').order_by('company_name', 'id')
        if q:
            qs = qs.filter(company_name__icontains=q)
        out = []
        for s in qs[:100]:
            cats = (Offer.objects.filter(seller=s, active=True)
                    .values_list(f'product__category__name_{lang}', flat=True).distinct())
            out.append({'id': s.id, 'company_name': s.company_name, 'description': s.description[:240],
                        'categories': sorted({c for c in cats if c}), 'regions': [r.region for r in s.delivery_rules.all()],
                        'verified_by_bmg': s.approved_at is not None})
        return Response(out)


class ApplicationCreate(APIView):
    """"Become a seller" form. Stored in the database for staff; nothing is faked when it fails."""
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [throttle('apply')]

    def post(self, request):
        d = request.data if isinstance(request.data, dict) else {}
        f = {k: str(d.get(k, '')).strip() for k in ('company_name', 'contact_name', 'phone', 'email', 'category', 'comment')}
        phone = re.sub(r'[\s()-]', '', f['phone'])
        errors = {}
        if not 2 <= len(f['company_name']) <= 200:
            errors['company_name'] = 'required'
        if not 2 <= len(f['contact_name']) <= 120:
            errors['contact_name'] = 'required'
        if not re.fullmatch(r'\+?\d{9,15}', phone):
            errors['phone'] = 'invalid'
        if f['email']:
            try:
                validate_email(f['email'])
            except ValidationError:
                errors['email'] = 'invalid'
        if not 2 <= len(f['category']) <= 120:
            errors['category'] = 'required'
        if len(f['comment']) > 2000:
            errors['comment'] = 'too_long'
        if d.get('accept_privacy') is not True:
            errors['accept_privacy'] = 'required'
        if errors:
            return Response({'error': 'invalid_request', 'fields': errors}, status=400)
        lang = str(d.get('language', ''))[:2]
        SellerApplication.objects.create(company_name=f['company_name'], contact_name=f['contact_name'], phone=phone,
                                         email=f['email'], category=f['category'], comment=f['comment'],
                                         privacy_accepted_at=timezone.now(),
                                         language=lang if lang in ('uz', 'ru', 'en') else '')
        return Response({'ok': True}, status=201)
