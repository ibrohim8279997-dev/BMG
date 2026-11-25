"""Deploy checks (`python manage.py check --deploy`): flag production settings that silently weaken protection."""
from django.conf import settings
from django.core.checks import Warning, register


@register(deploy=True)
def production_settings(app_configs, **kwargs):
    out = []
    if 'locmem' in settings.CACHES['default']['BACKEND'].lower():
        out.append(Warning('Rate limits use a per-process memory cache; with several workers they can be bypassed.',
                           hint='Set CACHE_BACKEND=django.core.cache.backends.redis.RedisCache and '
                                'CACHE_LOCATION=redis://127.0.0.1:6379/1', id='bmg.W001'))
    if not (settings.TURNSTILE_SITE_KEY and settings.TURNSTILE_SECRET_KEY):
        out.append(Warning('Registration captcha is off (only the per-IP limit protects sign-ups).',
                           hint='Set TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY.', id='bmg.W002'))
    if not settings.CLICK_ALLOWED_IPS:
        out.append(Warning('CLICK_ALLOWED_IPS is empty: every Click callback will be refused.', id='bmg.W003'))
    return out
