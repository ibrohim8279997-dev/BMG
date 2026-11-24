from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsClient
from apps.core.utils import throttle

from . import service


class Ask(APIView):
    throttle_classes = [throttle('ai')]

    def post(self, request):
        q = str(request.data.get('question', '')).strip()
        if not q or len(q) > 2000:
            return Response({'error': 'invalid_request'}, status=400)
        role = 'seller' if request.user.role == 'seller' else 'client'
        lang = request.data.get('lang') if request.data.get('lang') in ('uz', 'ru', 'en') else request.user.language
        try:
            answer, disclaimer = service.ask(q, role, lang, user=request.user)
        except service.AIUnavailable:
            return Response({'error': 'ai_unavailable'}, status=503)
        return Response({'answer': answer, 'disclaimer': disclaimer})


class DescribeProject(APIView):
    """Client describes the job in words (typed or dictated in the browser): AI fills the object form and picks material
    categories; prices shown come ONLY from live seller offers."""
    throttle_classes = [throttle('ai')]
    permission_classes = [IsClient]

    def post(self, request):
        text = str(request.data.get('text', '')).strip()
        if not text or len(text) > 2000:
            return Response({'error': 'invalid_request'}, status=400)
        from apps.catalog.models import Category
        from apps.catalog.views import live_offers
        cats = {c.slug: c for c in Category.objects.all()}
        try:
            res = service.parse_project(text, {s: c.name_en for s, c in cats.items()}, user=request.user)
        except service.AIUnavailable:
            return Response({'error': 'ai_unavailable'}, status=503)
        except (ValueError, KeyError):
            return Response({'error': 'invalid_request'}, status=502)
        lang = request.data.get('lang') if request.data.get('lang') in ('uz', 'ru', 'en') else request.user.language
        materials = []
        for slug in res['categories']:
            best = live_offers().filter(product__category=cats[slug]).select_related('product', 'seller') \
                .order_by('price').first()
            materials.append({'category': slug, 'name': cats[slug].name(lang), 'offer': None if best is None else {
                'offer_id': best.id, 'product_id': best.product_id, 'product': best.product.name, 'unit': best.product.unit,
                'seller': best.seller.company_name, 'price': str(best.price)}})
        return Response({'fields': res['fields'], 'zones': res['zones'], 'materials': materials})
