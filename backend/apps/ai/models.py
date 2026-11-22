from django.conf import settings
from django.db import models


class AIUsage(models.Model):
    provider = models.CharField(max_length=20)
    kind = models.CharField(max_length=30)          # ask_client, ask_seller, category, norms, describe
    tokens_in = models.PositiveIntegerField(default=0)
    tokens_out = models.PositiveIntegerField(default=0)
    ok = models.BooleanField(default=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
