from django.conf import settings

FORWARDED = ('HTTP_X_FORWARDED_FOR', 'HTTP_X_FORWARDED_PROTO', 'HTTP_X_FORWARDED_HOST', 'HTTP_X_REAL_IP')


class TrustedProxyMiddleware:
    """Forwarding headers are honoured only when the TCP peer is a trusted proxy (TRUSTED_PROXY_IPS, the Next.js
    host). A client that reaches Django directly cannot pick its IP (rate limits, admin/Click/CRM allowlists)
    or claim HTTPS. The edge proxy in front of Next.js must overwrite these headers (config/nginx.conf)."""

    def __init__(self, get_response):
        self.get_response = get_response
        self.trusted = set(getattr(settings, 'TRUSTED_PROXY_IPS', ()))

    def __call__(self, request):
        if request.META.get('REMOTE_ADDR') not in self.trusted:
            for h in FORWARDED:
                request.META.pop(h, None)
        return self.get_response(request)


class SecurityHeadersMiddleware:
    """API-only backend: lock everything down, no inline content."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        resp = self.get_response(request)
        resp.setdefault('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
        resp.setdefault('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
        resp.setdefault('Cross-Origin-Opener-Policy', 'same-origin')
        if request.path.startswith('/api/'):
            resp.setdefault('Cache-Control', 'no-store')
        return resp
