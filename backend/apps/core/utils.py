from rest_framework.throttling import SimpleRateThrottle


def client_ip(request):
    """IP honouring DRF NUM_PROXIES (so X-Forwarded-For can't be spoofed freely)."""
    from rest_framework.settings import api_settings
    n = api_settings.NUM_PROXIES
    xff = request.META.get('HTTP_X_FORWARDED_FOR')
    if n and xff:
        parts = [p.strip() for p in xff.split(',')]
        return parts[-n] if len(parts) >= n else parts[0]
    return request.META.get('REMOTE_ADDR')


class ScopedIPThrottle(SimpleRateThrottle):
    scope = 'anon'

    def get_cache_key(self, request, view):
        ident = request.user.pk if getattr(request, 'user', None) and request.user.is_authenticated \
            else client_ip(request)
        return self.cache_format % {'scope': self.scope, 'ident': ident}


def throttle(scope_name):
    return type(f'Throttle_{scope_name}', (ScopedIPThrottle,), {'scope': scope_name})
