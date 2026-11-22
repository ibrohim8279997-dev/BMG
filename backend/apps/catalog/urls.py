from django.urls import path

from . import views as v

urlpatterns = [
    path('categories', v.Categories.as_view()),
    path('categories/<slug:slug>', v.CategoryDetail.as_view()),
    path('products', v.Products.as_view()),
    path('products/<int:pk>', v.ProductDetail.as_view()),
    path('sellers/me/imports', v.ImportCreate.as_view()),
    path('sellers/me/imports/<int:pk>', v.ImportDetail.as_view()),
    path('sellers/me/imports/<int:pk>/confirm', v.ImportConfirm.as_view()),
    path('sellers/me/offers', v.MyOffers.as_view()),
    path('sellers/me/offers/<int:pk>', v.MyOfferDetail.as_view()),
]
