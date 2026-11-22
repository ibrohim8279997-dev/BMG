from django.conf import settings
from django.db import models


class Complaint(models.Model):
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='complaints')
    seller = models.ForeignKey('sellers.Seller', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    order = models.ForeignKey('orders.Order', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    text = models.TextField(max_length=3000)
    status = models.CharField(max_length=12, default='new')    # new / in_progress / resolved
    assignee = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                 related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
