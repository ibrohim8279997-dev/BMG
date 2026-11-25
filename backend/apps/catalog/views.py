from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.http import HttpResponse
from django.db.models import Count, Min, OuterRef, Q, Subquery
from django.shortcuts import get_object_or_404
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.utils import throttle
from apps.sellers.views import IsApprovedSeller
from apps.uploads import validators as up

from . import import_flow
from .models import Category, Offer, PriceImport, Product

LANGS = ('uz', 'ru', 'en')


def lang_of(request):
    q = request.query_params.get('lang')
    return q if q in LANGS else 'ru'


def live_offers():
    return Offer.objects.filter(active=True, stock__gt=0, seller__status='approved')


class Categories(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        lang = lang_of(request)
        counts = dict(Product.objects.filter(offers__in=live_offers()).values_list('category_id')
                      .annotate(n=Count('id', distinct=True)))
        return Response([{'slug': c.slug, 'name': c.name(lang), 'parent': c.parent.slug if c.parent else None,
                          'count': counts.get(c.id, 0),
                          'names': {'uz': c.name_uz, 'ru': c.name_ru, 'en': c.name_en}}
                         for c in Category.objects.select_related('parent')])


class CategoryDetail(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, slug):
        c = get_object_or_404(Category, slug=slug)
        lang = lang_of(request)
        return Response({'slug': c.slug, 'name': c.name(lang), 'description': c.description(lang),
                         'names': {'uz': c.name_uz, 'ru': c.name_ru, 'en': c.name_en}})


class Products(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        base = live_offers()
        city = request.query_params.get('city', '').strip()[:80]
        if city:   # offers whose seller delivers to this city (SEO price pages: "cement price Tashkent")
            base = base.filter(seller__delivery_rules__region__iexact=city)
        qs = Product.objects.filter(offers__in=base).distinct()
        slug = request.query_params.get('category')
        if slug:
            qs = qs.filter(Q(category__slug=slug) | Q(category__parent__slug=slug))
        q = request.query_params.get('q', '').strip()
        if q:
            qs = qs.filter(name__icontains=q[:100])
        live = Q(offers__in=base)
        qs = qs.annotate(min_price=Min('offers__price', filter=live), n=Count('offers', filter=live, distinct=True),
                         best_offer=Subquery(base.filter(product=OuterRef('pk')).order_by('price').values('id')[:1]))
        for key, lookup in (('price_min', 'min_price__gte'), ('price_max', 'min_price__lte')):
            raw = request.query_params.get(key)
            if raw:
                try:
                    qs = qs.filter(**{lookup: Decimal(raw)})
                except InvalidOperation:
                    return Response({'error': 'invalid_request'}, status=400)
        qs = qs.order_by({'price_asc': 'min_price', 'price_desc': '-min_price'}.get(
            request.query_params.get('sort'), 'name'), 'id')
        try:
            page = max(1, int(request.query_params.get('page', 1)))
        except ValueError:
            page = 1
        size = 24
        total = qs.count()
        items = qs.select_related('category')[(page - 1) * size: page * size]
        return Response({'total': total, 'page': page, 'page_size': size, 'results': [
            {'id': p.id, 'name': p.name, 'unit': p.unit, 'category': p.category.slug,
             'min_price': f'{Decimal(p.min_price):.2f}', 'offers': p.n, 'image': image_url(p),
             'best_offer_id': p.best_offer} for p in items]})


class ProductDetail(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, pk):
        p = get_object_or_404(Product.objects.select_related('category'), pk=pk)
        lang = lang_of(request)
        offers = live_offers().filter(product=p).select_related('seller').order_by('price')
        return Response({
            'id': p.id, 'name': p.name, 'unit': p.unit, 'image': image_url(p),
            'category': {'slug': p.category.slug, 'name': p.category.name(lang),
                         'description': p.category.description(lang)},
            'offers': [{'id': o.id, 'seller_id': o.seller_id, 'seller': o.seller.company_name,
                        'rating': str(o.seller.rating), 'price': str(o.price), 'stock': str(o.stock)}
                       for o in offers]})


# ---- seller: import & offers

class ImportCreate(APIView):
    permission_classes = [IsApprovedSeller]
    throttle_classes = [throttle('upload')]

    def post(self, request):
        try:
            imp, rows = import_flow.create(request.FILES.get('file'), request.user, seller=request.user.seller)
        except import_flow.FlowError as e:
            return Response({'error': e.code}, status=e.status)
        return Response(import_flow.payload(imp, rows), status=201)


def my_imports(request):
    return PriceImport.objects.filter(seller=request.user.seller)


class ImportDetail(APIView):
    permission_classes = [IsApprovedSeller]
    throttle_classes = [throttle('import_view')]     # every call re-reads the stored file

    def get(self, request, pk):
        imp = get_object_or_404(my_imports(request), pk=pk)
        return Response(import_flow.payload(imp, import_flow.rows_of(imp)))

    def patch(self, request, pk):
        imp = get_object_or_404(my_imports(request), pk=pk, status='draft')
        data = {k: v for k, v in request.data.items() if k in ('mapping', 'header_row')}
        if not data:
            return Response({'error': 'invalid_request'}, status=400)
        try:
            rows = import_flow.patch(imp, data)
        except import_flow.FlowError as e:
            return Response({'error': e.code}, status=e.status)
        return Response(import_flow.payload(imp, rows))


class ImportConfirm(APIView):
    permission_classes = [IsApprovedSeller]

    @transaction.atomic
    def post(self, request, pk):
        imp = get_object_or_404(my_imports(request).select_for_update(), pk=pk, status='draft')
        try:
            import_flow.confirm(imp, request.user)
        except import_flow.FlowError as e:
            return Response({'error': e.code}, status=e.status)
        return Response(import_flow.payload(imp))


class ImportImages(APIView):
    """AI looks for a photo of the next imported product; the client calls it until result.images.done."""
    permission_classes = [IsApprovedSeller]
    throttle_classes = [throttle('ai')]              # each call is an AI web search

    def post(self, request, pk):
        try:
            imp = import_flow.image_step(my_imports(request), pk, request.user)
        except import_flow.FlowError as e:
            return Response({'error': e.code}, status=e.status)
        return Response(import_flow.payload(imp))


OFFER_LIMITS = {'price': Decimal(10) ** 12, 'cost_price': Decimal(10) ** 12, 'stock': Decimal(10) ** 9}


class ProductImage(APIView):
    """Photo AI found for a product (validated image bytes from private storage)."""
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, pk):
        p = get_object_or_404(Product, pk=pk, image_status='found')
        try:
            data = up.open_stored(p.image)
        except (up.UploadError, FileNotFoundError):
            return HttpResponse(status=404)
        kind = p.image.rsplit('.', 1)[-1]
        if kind not in ('jpeg', 'png', 'webp'):
            return HttpResponse(status=404)
        resp = HttpResponse(data, content_type=up.CONTENT_TYPES[kind])
        resp['X-Content-Type-Options'] = 'nosniff'
        resp['Cache-Control'] = 'public, max-age=86400'
        resp['Content-Security-Policy'] = "default-src 'none'"
        return resp


def image_url(p):
    return f'/api/v1/products/{p.id}/image' if p.image_status == 'found' and p.image else None


def offer_payload(o):
    return {'id': o.id, 'product': o.product.name, 'category': o.product.category.slug, 'price': str(o.price),
            'stock': str(o.stock), 'cost_price': str(o.cost_price) if o.cost_price is not None else None,
            'active': o.active}


class MyOffers(APIView):
    permission_classes = [IsApprovedSeller]

    def get(self, request):
        qs = request.user.seller.offers.select_related('product__category').order_by('-updated_at')[:500]
        return Response([offer_payload(o) for o in qs])


class MyOfferDetail(APIView):
    permission_classes = [IsApprovedSeller]

    def patch(self, request, pk):
        o = get_object_or_404(Offer, pk=pk, seller=request.user.seller)   # only own offers
        try:
            for f in ('price', 'stock', 'cost_price'):
                if f in request.data:
                    v = request.data[f]
                    if v in (None, '') and f == 'cost_price':
                        o.cost_price = None
                        continue
                    d = Decimal(str(v))
                    # finite and within the column (price/cost 14,2; stock 12,3), else the save would be a 500
                    if not d.is_finite() or d < 0 or (f == 'price' and d <= 0) or d >= OFFER_LIMITS[f]:
                        raise InvalidOperation
                    setattr(o, f, d)
        except InvalidOperation:
            return Response({'error': 'invalid_request'}, status=400)
        if 'active' in request.data:
            o.active = bool(request.data['active'])
        o.save()
        return Response(offer_payload(o))

    def delete(self, request, pk):
        get_object_or_404(Offer, pk=pk, seller=request.user.seller).delete()
        return Response(status=204)


def price_pages():
    """(category slug, city) pairs that have at least one live offer deliverable to that city.
    These become the SEO landing pages ("cement price Tashkent") and sitemap entries."""
    seen = set()
    rows = live_offers().values_list('product__category__slug', 'seller__delivery_rules__region').distinct()
    for slug, region in rows:
        if region:
            seen.add((slug, region.strip()))
    return sorted(seen)


class PricePages(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        return Response([{'category': s, 'city': c} for s, c in price_pages()])
