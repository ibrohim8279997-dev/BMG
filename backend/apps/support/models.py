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


class Review(models.Model):
    """One review per (order, seller), only after that seller's items were delivered."""
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='reviews')
    seller = models.ForeignKey('sellers.Seller', on_delete=models.CASCADE, related_name='reviews')
    order = models.ForeignKey('orders.Order', on_delete=models.CASCADE, related_name='reviews')
    rating = models.PositiveSmallIntegerField()                # 1..5
    text = models.TextField(max_length=1000, blank=True)
    hidden = models.BooleanField(default=False)                # moderation: hidden reviews do not count
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('order', 'seller')]
        ordering = ['-id']
