from django.urls import path

from . import views as v

urlpatterns = [
    path('sellers/me/invoices', v.SellerInvoices.as_view()),
    path('sellers/me/invoices/<int:pk>/confirm', v.SellerInvoiceConfirm.as_view()),
]
