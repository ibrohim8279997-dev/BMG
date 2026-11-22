from django.urls import path

from . import views as v

urlpatterns = [
    path('objects', v.Objects.as_view()),
    path('objects/<int:pk>/calculate', v.Calculate.as_view()),
]
