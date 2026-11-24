from django.urls import path

from . import views

urlpatterns = [
    path('csrf', views.CsrfView.as_view()),
    path('auth/request-code', views.RequestCodeView.as_view()),
    path('auth/verify', views.VerifyView.as_view()),
    path('auth/providers', views.ProvidersView.as_view()),
    path('auth/google', views.GoogleLoginView.as_view()),
    path('auth/logout', views.LogoutView.as_view()),
    path('auth/telegram/webhook/<str:secret>', views.WebhookView.as_view()),
    path('me', views.MeView.as_view()),
]
