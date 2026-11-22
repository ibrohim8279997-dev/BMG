from django.urls import path

from .views import Complaints

urlpatterns = [path('complaints', Complaints.as_view())]
