from django.urls import path

from . import views as v

urlpatterns = [
    path('sellers/me', v.MyProfile.as_view()),
    path('sellers/me/files', v.MyFiles.as_view()),
    path('sellers/me/files/<int:pk>', v.MyFileDelete.as_view()),
    path('sellers/me/delivery-rules', v.MyDelivery.as_view()),
    path('sellers/me/delivery-rules/<int:pk>', v.MyDeliveryDelete.as_view()),
    path('sellers', v.SellerList.as_view()),
    path('seller-applications', v.ApplicationCreate.as_view()),
    path('sellers/<int:pk>', v.PublicSeller.as_view()),
    path('sellers/<int:pk>/documents', v.PublicSellerDocuments.as_view()),
    path('sellers/<int:pk>/phone', v.RevealPhone.as_view()),
    path('files/<int:pk>', v.PublicFile.as_view()),
]
