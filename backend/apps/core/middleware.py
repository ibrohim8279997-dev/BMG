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
