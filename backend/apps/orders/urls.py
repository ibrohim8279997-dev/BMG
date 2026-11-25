from django.urls import path

from . import views as v

urlpatterns = [
    path('cart', v.Cart.as_view()),
    path('cart/<int:pk>', v.CartItemView.as_view()),
    path('orders', v.Orders.as_view()),
    path('orders/<int:pk>', v.OrderDetail.as_view()),
    path('orders/<int:pk>/pay', v.PayOrder.as_view()),
    path('orders/<int:pk>/cancel', v.CancelOrder.as_view()),
    path('orders/<int:pk>/confirm-receipt', v.ConfirmReceipt.as_view()),
    path('sellers/me/orders', v.SellerOrders.as_view()),
    path('sellers/me/orders/<int:pk>/fulfill', v.SellerFulfill.as_view()),
    path('sellers/me/analytics', v.SellerAnalytics.as_view()),
    path('sellers/me/payouts', v.SellerPayout.as_view()),
]
