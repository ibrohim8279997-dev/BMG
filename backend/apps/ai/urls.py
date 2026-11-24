from django.urls import path

from .views import Ask, DescribeProject

urlpatterns = [path('ai/ask', Ask.as_view()), path('ai/describe-project', DescribeProject.as_view())]
