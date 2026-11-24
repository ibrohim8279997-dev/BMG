from decimal import Decimal

from django.conf import settings
from django.db import models


class CommissionLevel(models.Model):
    name = models.CharField(max_length=60, unique=True)
    percent = models.DecimalField(max_digits=5, decimal_places=2)  # reference: 5-10%


class Seller(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        APPROVED = 'approved', 'Approved'
        BLOCKED = 'blocked', 'Blocked'

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='seller')
    company_name = models.CharField(max_length=200, blank=True)
    description = models.TextField(blank=True)
    contact_phone = models.CharField(max_length=20, blank=True)   # hidden; revealed on click (audited)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING, db_index=True)
    commission_level = models.ForeignKey(CommissionLevel, null=True, blank=True, on_delete=models.SET_NULL)
    commission_override = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    rating = models.DecimalField(max_digits=3, decimal_places=2, default=Decimal('0'))
    identity_verified = models.BooleanField(default=False)
    approved_at = models.DateTimeField(null=True, blank=True)   # staff confirmed this seller is genuinely BMG's
    created_at = models.DateTimeField(auto_now_add=True)

    def commission_percent(self):
        from apps.core.models import Setting
        if self.commission_override is not None:
            return self.commission_override
        if self.commission_level_id:
            return self.commission_level.percent
        return Decimal(str(Setting.get('default_commission_percent')))

    def recompute_rating(self):
        """Average of visible reviews; with no reviews the staff-set rating stays."""
        from django.db.models import Avg
        avg = self.reviews.filter(hidden=False).aggregate(a=Avg('rating'))['a']
        if avg is not None:
            self.rating = Decimal(str(avg)).quantize(Decimal('0.01'))
            self.save(update_fields=['rating'])

    @property
    def is_approved(self):
        return self.status == self.Status.APPROVED


class SellerFile(models.Model):
    class Kind(models.TextChoices):
        DOCUMENT = 'document', 'Document'   # licenses etc., public via "view documents"
        PHOTO = 'photo', 'Photo'

    seller = models.ForeignKey(Seller, on_delete=models.CASCADE, related_name='files')
    kind = models.CharField(max_length=10, choices=Kind.choices)
    title = models.CharField(max_length=120, blank=True)
    stored_name = models.CharField(max_length=80)
    file_type = models.CharField(max_length=8)
    size = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)


class DeliveryRule(models.Model):
    seller = models.ForeignKey(Seller, on_delete=models.CASCADE, related_name='delivery_rules')
    region = models.CharField(max_length=80)           # city/region name, normalized lower in matching
    cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    restrictions = models.CharField(max_length=300, blank=True)

    class Meta:
        unique_together = [('seller', 'region')]


class SellerApplication(models.Model):
    """"Become a seller" request from the public form. Staff review it; approving it is a record, the account is still
    created by the person signing in (accounts keep their own role/registration flow)."""
    class Status(models.TextChoices):
        NEW = 'new', 'New'
        IN_PROGRESS = 'in_progress', 'In progress'
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'

    company_name = models.CharField(max_length=200)
    contact_name = models.CharField(max_length=120)
    phone = models.CharField(max_length=20)
    email = models.EmailField(blank=True)
    category = models.CharField(max_length=120)
    comment = models.TextField(max_length=2000, blank=True)
    privacy_accepted_at = models.DateTimeField()
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.NEW, db_index=True)
    language = models.CharField(max_length=2, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
