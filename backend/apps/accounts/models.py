from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        CLIENT = 'client', 'Client'
        SELLER = 'seller', 'Seller'
        STAFF = 'staff', 'Staff'

    telegram_id = models.BigIntegerField(null=True, blank=True, unique=True)
    google_sub = models.CharField(max_length=40, null=True, blank=True, unique=True)   # Google account id (login only)
    phone = models.CharField(max_length=20, blank=True, db_index=True)
    role = models.CharField(max_length=10, choices=Role.choices, blank=True)
    language = models.CharField(max_length=2, default='ru')
    accepted_privacy_at = models.DateTimeField(null=True, blank=True)
    accepted_terms_at = models.DateTimeField(null=True, blank=True)
    registration_ip = models.GenericIPAddressField(null=True, blank=True)

    def has_staff_perm(self, codename):
        if not (self.is_active and self.is_staff):
            return False
        if self.is_superuser:
            return True
        m = getattr(self, 'staff', None)
        return bool(m and codename in m.role.permissions)


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


class TelegramLink(models.Model):
    """Phone <-> Telegram chat, created when the user shares their own contact with the bot."""
    phone = models.CharField(max_length=20, unique=True)
    telegram_id = models.BigIntegerField(unique=True)
    chat_id = models.BigIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)


class TotpDevice(models.Model):
    """Authenticator-app secret for staff (2FA, not SMS)."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='totp')
    secret = models.CharField(max_length=64)
    last_used_step = models.BigIntegerField(default=0)  # blocks OTP replay


class BackupCode(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='backup_codes')
    code_hash = models.CharField(max_length=64)
    used = models.BooleanField(default=False)


class EmailLoginCode(models.Model):
    """One-time e-mail login code (stored hashed). Proves the person controls the mailbox."""
    email = models.EmailField(db_index=True)
    code_hash = models.CharField(max_length=64)
    ip = models.GenericIPAddressField(null=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    used = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()


class BotLoginToken(models.Model):
    """One-time sign-in link the Telegram bot gives a user (stored hashed, 5 min, single use)."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='+')
    token_hash = models.CharField(max_length=64, unique=True)
    used = models.BooleanField(default=False)
    expires_at = models.DateTimeField()
