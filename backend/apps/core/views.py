from datetime import date

from django.http import HttpResponse
from django.conf import settings
from django.shortcuts import get_object_or_404
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.catalog.models import Category, Product

from .models import LegalDocument

LANGS = ('uz', 'ru', 'en')


class LegalView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, slug):
        today = date.today()
        d = LegalDocument.objects.filter(slug=slug, effective_from__lte=today).order_by('-version').first()
        if d is None:
            return Response(status=404)
        lang = request.query_params.get('lang')
        lang = lang if lang in LANGS else 'ru'
        return Response({'slug': d.slug, 'version': d.version, 'effective_from': d.effective_from,
                         'title': getattr(d, f'title_{lang}'), 'body': getattr(d, f'body_{lang}')})


def esc(s):
    return str(s).replace('&', '&amp;').replace('<', '&lt;')


def sitemap(request):
    """All public pages in 3 languages with hreflang alternates."""
    base = settings.SITE_URL.rstrip('/')
    paths = ['', '/catalog', '/calculator']
    paths += [f'/catalog/{c.slug}' for c in Category.objects.all()]
    from apps.catalog.views import live_offers
    paths += [f'/product/{pid}' for pid in live_offers().values_list('product_id', flat=True).distinct()]
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">']
    for p in paths:
        for l in LANGS:
            out.append(f'<url><loc>{esc(f"{base}/{l}{p}")}</loc>')
            for l2 in LANGS:
                out.append(f'<xhtml:link rel="alternate" hreflang="{l2}" href="{esc(f"{base}/{l2}{p}")}"/>')
            out.append('</url>')
    out.append('</urlset>')
    return HttpResponse('\n'.join(out), content_type='application/xml')


def robots(request):
    base = settings.SITE_URL.rstrip('/')
    return HttpResponse(f'User-agent: *\nDisallow: /api/\nDisallow: /admin\nSitemap: {base}/sitemap.xml\n',
                        content_type='text/plain')
