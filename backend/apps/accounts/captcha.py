"""Registration captcha: Cloudflare Turnstile, verified server-side. Off (always passes) unless TURNSTILE_SECRET_KEY is
set, so dev and tests work without it; the per-IP registration limit stays on either way."""
import requests
from django.conf import settings

VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'


def enabled():
    return bool(settings.TURNSTILE_SECRET_KEY and settings.TURNSTILE_SITE_KEY)


def verify(token, ip) -> bool:
    if not enabled():
        return True
    if not token or not isinstance(token, str) or len(token) > 2048:
        return False
    try:
        r = requests.post(VERIFY, data={'secret': settings.TURNSTILE_SECRET_KEY, 'response': token,
                                        **({'remoteip': ip} if ip else {})}, timeout=5)
        return r.json().get('success') is True
    except (requests.RequestException, ValueError):
        return False     # fail closed: a registration can be retried, a bot wave can't be undone
