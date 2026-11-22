from django.urls import path

from . import views
from .click import ClickCallback

urlpatterns = [
    path('wallet', views.WalletView.as_view()),
    path('wallet/topup', views.TopUpView.as_view()),
    path('payments/click', ClickCallback.as_view()),
]
