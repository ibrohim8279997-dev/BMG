from django.urls import path

from .views import Complaints, Reviews, SellerReviews

urlpatterns = [
    path('complaints', Complaints.as_view()),
    path('reviews', Reviews.as_view()),
    path('sellers/<int:pk>/reviews', SellerReviews.as_view()),
]
