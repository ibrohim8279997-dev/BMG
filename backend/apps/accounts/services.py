import hashlib
import hmac
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db.models import F
from django.utils import timezone

from .models import TelegramLoginCode

MAX_REQUESTS_PER_HOUR_PHONE = 5
MAX_REQUESTS_PER_HOUR_IP = 20


class LoginError(Exception):
    pass


def _hash(code: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), code.encode(), hashlib.sha256).hexdigest()


# ---- shared by phone and e-mail codes
def _fail_key(ident: str) -> str:
    return 'loginfail:' + hashlib.sha256(ident.lower().encode()).hexdigest()


def identifier_locked(ident: str) -> bool:
    """Failed code checks are counted per phone/e-mail across ALL codes (a fresh code does not reset it), so rotating
    IPs and re-requesting codes cannot give unlimited guesses."""
    return (cache.get(_fail_key(ident)) or 0) >= settings.LOGIN_FAILS_PER_IDENTIFIER_PER_DAY


def _record_failure(ident: str):
    key = _fail_key(ident)
    cache.add(key, 0, 86400)
    try:
        cache.incr(key)
    except ValueError:      # expired between add and incr
        cache.set(key, 1, 86400)


def check_code(model, obj, code: str, consume: bool, ident: str) -> bool:
    """One attempt against a stored code. The attempt counter is bumped with a conditional UPDATE, so parallel requests
    cannot get more than LOGIN_CODE_MAX_ATTEMPTS guesses; `used` is set the same way (one winner)."""
    if obj is None or obj.expires_at < timezone.now() or identifier_locked(ident):
        return False
    took = model.objects.filter(pk=obj.pk, used=False, attempts__lt=settings.LOGIN_CODE_MAX_ATTEMPTS) \
        .update(attempts=F('attempts') + 1)
    if not took:
        return False
    if not hmac.compare_digest(obj.code_hash, _hash(code)):
        _record_failure(ident)
        return False
    if consume and not model.objects.filter(pk=obj.pk, used=False).update(used=True):
        return False
    return True


def issue_code(phone: str, ip: str | None) -> str:
    """Create a one-time code; enforce per-phone and per-IP request limits."""
    if identifier_locked(phone):
        raise LoginError('too_many_requests')
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


def verify_code(phone: str, code: str, consume: bool = True) -> bool:
    """consume=False: check the code (it counts as an attempt) but keep it for the registration step."""
    obj = TelegramLoginCode.objects.filter(phone=phone, used=False).order_by('-created_at').first()
    return check_code(TelegramLoginCode, obj, code, consume, phone)

