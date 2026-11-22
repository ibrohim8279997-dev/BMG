from django.urls import path

from .views import Ask

urlpatterns = [path('ai/ask', Ask.as_view())]
