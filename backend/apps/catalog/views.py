from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Count, Min, OuterRef, Q, Subquery
from django.shortcuts import get_object_or_404
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.utils import throttle
from apps.sellers.views import IsApprovedSeller
from apps.uploads import validators as up

from . import importer
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
        qs = Product.objects.filter(offers__in=live_offers()).distinct()
        slug = request.query_params.get('category')
        if slug:
            qs = qs.filter(Q(category__slug=slug) | Q(category__parent__slug=slug))
        q = request.query_params.get('q', '').strip()
        if q:
            qs = qs.filter(name__icontains=q[:100])
        qs = qs.annotate(min_price=Min('offers__price', filter=Q(offers__active=True, offers__stock__gt=0,
                                                                   offers__seller__status='approved')),
                         n=Count('offers', filter=Q(offers__active=True, offers__stock__gt=0,
                                                     offers__seller__status='approved')),
                         best_offer=Subquery(live_offers().filter(product=OuterRef('pk')).order_by('price')
                                             .values('id')[:1]))
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
             'min_price': f'{Decimal(p.min_price):.2f}', 'offers': p.n,
             'best_offer_id': p.best_offer} for p in items]})


class ProductDetail(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, pk):
        p = get_object_or_404(Product.objects.select_related('category'), pk=pk)
        lang = lang_of(request)
        offers = live_offers().filter(product=p).select_related('seller').order_by('price')
        return Response({
            'id': p.id, 'name': p.name, 'unit': p.unit,
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
        f = request.FILES.get('file')
        if f is None:
            return Response({'error': 'invalid_request'}, status=400)
        try:
            kind, data = up.validate(f, 'excel')
            rows = importer.read_rows(data)
        except up.UploadError as e:
            return Response({'error': e.code}, status=400)
        except Exception:
            return Response({'error': 'invalid_file'}, status=400)
        if len(rows) < 2:
            return Response({'error': 'empty_file'}, status=400)
        headers = [str(h or '') for h in rows[0]]
        imp = PriceImport.objects.create(seller=request.user.seller, stored_name=up.store(data, kind),
                                         headers=headers, mapping=importer.suggest_mapping(headers))
        return Response(import_payload(imp, rows), status=201)


def import_payload(imp, rows=None):
    d = {'id': imp.id, 'status': imp.status, 'headers': imp.headers, 'mapping': imp.mapping,
         'required': ['name', 'price', 'stock'], 'result': imp.result}
    if rows is not None:
        d['preview'] = [[str(c)[:80] if c is not None else '' for c in r] for r in rows[1:11]]
    return d


class ImportDetail(APIView):
    permission_classes = [IsApprovedSeller]

    def get(self, request, pk):
        imp = get_object_or_404(PriceImport, pk=pk, seller=request.user.seller)
        rows = importer.read_rows(up.open_stored(imp.stored_name))
        return Response(import_payload(imp, rows))

    def patch(self, request, pk):
        imp = get_object_or_404(PriceImport, pk=pk, seller=request.user.seller, status='draft')
        m = request.data.get('mapping')
        if not isinstance(m, dict):
            return Response({'error': 'invalid_request'}, status=400)
        clean = {}
        for k, v in m.items():
            if k not in importer.SYNONYMS:
                return Response({'error': 'invalid_request'}, status=400)
            if v in (None, ''):
                continue
            if not isinstance(v, int) or not 0 <= v < len(imp.headers):
                return Response({'error': 'invalid_request'}, status=400)
            clean[k] = v
        imp.mapping = clean
        imp.save(update_fields=['mapping'])
        return Response(import_payload(imp))


class ImportConfirm(APIView):
    permission_classes = [IsApprovedSeller]

    @transaction.atomic
    def post(self, request, pk):
        imp = get_object_or_404(PriceImport.objects.select_for_update(), pk=pk,
                                seller=request.user.seller, status='draft')
        if any(f not in imp.mapping for f in ('name', 'price', 'stock')):
            return Response({'error': 'mapping_incomplete'}, status=400)
        imp.result = importer.process(imp, up.open_stored(imp.stored_name), request.user)
        imp.status = 'confirmed'
        imp.save(update_fields=['result', 'status'])
        return Response(import_payload(imp))


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
                    if d < 0 or (f == 'price' and d <= 0):
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
