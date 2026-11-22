import hashlib
import hmac
import secrets
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from .models import TelegramLoginCode

MAX_REQUESTS_PER_HOUR_PHONE = 5
MAX_REQUESTS_PER_HOUR_IP = 20


class LoginError(Exception):
    pass


def _hash(code: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), code.encode(), hashlib.sha256).hexdigest()


def issue_code(phone: str, ip: str | None) -> str:
    """Create a one-time code; enforce per-phone and per-IP request limits."""
    since = timezone.now() - timedelta(hours=1)
    recent = TelegramLoginCode.objects.filter(created_at__gte=since)
    if recent.filter(phone=phone).count() >= MAX_REQUESTS_PER_HOUR_PHONE:
        raise LoginError('too_many_requests')
    if ip and recent.filter(ip=ip).count() >= MAX_REQUESTS_PER_HOUR_IP:
        raise LoginError('too_many_requests')
    code = f'{secrets.randbelow(10**6):06d}'
    TelegramLoginCode.objects.create(
        phone=phone, code_hash=_hash(code), ip=ip,
        expires_at=timezone.now() + timedelta(seconds=settings.LOGIN_CODE_TTL_SECONDS),
    )
    return code  # caller delivers it via the Telegram bot; never returned over the API


def verify_code(phone: str, code: str) -> bool:
    obj = (TelegramLoginCode.objects.filter(phone=phone, used=False)
           .order_by('-created_at').first())
    if not obj or obj.expires_at < timezone.now():
        return False
    if obj.attempts >= settings.LOGIN_CODE_MAX_ATTEMPTS:
        return False
    obj.attempts += 1
    ok = hmac.compare_digest(obj.code_hash, _hash(code))
    if ok:
        obj.used = True
    obj.save(update_fields=['attempts', 'used'])
    return ok
