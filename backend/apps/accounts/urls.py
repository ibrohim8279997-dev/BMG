from django.urls import path

from . import bot_api, email_login, views

urlpatterns = [
    path('csrf', views.CsrfView.as_view()),
    path('auth/request-code', views.RequestCodeView.as_view()),
    path('auth/verify', views.VerifyView.as_view()),
    path('auth/providers', views.ProvidersView.as_view()),
    path('auth/google', views.GoogleLoginView.as_view()),
    path('auth/email/request-code', email_login.EmailRequestCodeView.as_view()),
    path('auth/email/verify', email_login.EmailVerifyView.as_view()),
    path('auth/bot-token', bot_api.BotTokenLoginView.as_view()),
    path('bot/link', bot_api.BotLinkView.as_view()),
    path('bot/register', bot_api.BotRegisterView.as_view()),
    path('bot/login-link', bot_api.BotLoginLinkView.as_view()),
    path('auth/logout', views.LogoutView.as_view()),
    path('auth/telegram/webhook/<str:secret>', views.WebhookView.as_view()),
    path('me', views.MeView.as_view()),
]
