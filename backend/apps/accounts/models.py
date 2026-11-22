from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        CLIENT = 'client', 'Client'
        SELLER = 'seller', 'Seller'
        STAFF = 'staff', 'Staff'

    telegram_id = models.BigIntegerField(null=True, blank=True, unique=True)
    phone = models.CharField(max_length=20, blank=True, db_index=True)
    role = models.CharField(max_length=10, choices=Role.choices, blank=True)
    language = models.CharField(max_length=2, default='ru')
    accepted_privacy_at = models.DateTimeField(null=True, blank=True)
    accepted_terms_at = models.DateTimeField(null=True, blank=True)


class StaffRole(models.Model):
    """Role created/edited by superadmin; permissions are a list of codenames."""
    name = models.CharField(max_length=60, unique=True)
    permissions = models.JSONField(default=list, blank=True)


class StaffMembership(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='staff')
    role = models.ForeignKey(StaffRole, on_delete=models.PROTECT)
    granted_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)


class TelegramLoginCode(models.Model):
    """One-time login code (stored hashed). Lives 2-3 min, limited attempts."""
    phone = models.CharField(max_length=20, db_index=True)
    code_hash = models.CharField(max_length=64)
    ip = models.GenericIPAddressField(null=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    used = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
