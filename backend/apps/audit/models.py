from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    """Who did what and when. Append-only by convention (no update/delete API)."""
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='+')
    action = models.CharField(max_length=60, db_index=True)   # e.g. seller_phone_revealed
    object_type = models.CharField(max_length=40, blank=True)
    object_id = models.CharField(max_length=40, blank=True)
    order_id = models.BigIntegerField(null=True, blank=True)
    meta = models.JSONField(default=dict, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at', '-id']


def log(request_or_none, action, actor=None, object_type='', object_id='', order_id=None, **meta):
    from apps.core.utils import client_ip
    ip = client_ip(request_or_none) if request_or_none is not None else None
    if actor is None and request_or_none is not None and request_or_none.user.is_authenticated:
        actor = request_or_none.user
    return AuditLog.objects.create(actor=actor, action=action, object_type=object_type,
                                   object_id=str(object_id), order_id=order_id, meta=meta, ip=ip)
