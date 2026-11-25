from django.conf import settings
from django.contrib import admin
from django.urls import include, path

from apps.core import views as core

urlpatterns = [
    path('api/v1/', include('apps.accounts.urls')),
    path('api/v1/', include('apps.sellers.urls')),
    path('api/v1/', include('apps.catalog.urls')),
    path('api/v1/', include('apps.calculator.urls')),
    path('api/v1/', include('apps.ai.urls')),
    path('api/v1/', include('apps.payments.urls')),
    path('api/v1/', include('apps.orders.urls')),
    path('api/v1/', include('apps.support.urls')),
    path('api/v1/', include('apps.accounting.urls')),
    path('api/v1/legal/<slug:slug>', core.LegalView.as_view()),
    path('api/v1/config', core.PublicConfig.as_view()),
    path('api/crm/v1/', include('apps.crm.urls')),
    path('admin-api/', include('apps.adminpanel.urls')),
    path('sitemap.xml', core.sitemap),
    path('robots.txt', core.robots),
]
if settings.DEBUG:   # Django's own admin only for local development
    urlpatterns.append(path('django-admin/', admin.site.urls))
