from django.urls import path

from . import cards, views
from .click import ClickCallback

urlpatterns = [
    path('wallet', views.WalletView.as_view()),
    path('wallet/topup', views.TopUpView.as_view()),
    path('payments/cards', cards.CardListView.as_view()),
    path('payments/cards/<int:pk>', cards.CardDetailView.as_view()),
    path('payments/cards/<int:pk>/verify', cards.CardVerifyView.as_view()),
    path('payments/cards/<int:pk>/topup', cards.CardTopUpView.as_view()),
    path('payments/cards/<int:pk>/pay-order', cards.CardPayOrderView.as_view()),
    path('payments/click', ClickCallback.as_view()),
]
