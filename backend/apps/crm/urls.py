from django.urls import path

from . import api

urlpatterns = [
    path('orders', api.Orders.as_view()),
    path('orders/<str:external_id>', api.OrderDetail.as_view()),
    path('payments', api.Payments.as_view()),
    path('refunds', api.Refunds.as_view()),
    path('settlements', api.Settlements.as_view()),
    path('reports/daily', api.DailyReport.as_view()),
]
