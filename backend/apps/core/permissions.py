import time

from django.conf import settings
from rest_framework.permissions import BasePermission

from .utils import client_ip


class HasRole(BasePermission):
    role = None

    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and u.role == self.role)


class IsClient(HasRole):
    role = 'client'


def ip_allowed(request):
    allowed = settings.ADMIN_ALLOWED_IPS
    if not allowed:
        return settings.DEBUG
    return client_ip(request) in allowed


class IsAdminSession(BasePermission):
    """Staff user who passed password + TOTP recently, from an allowed IP."""
    perm = None  # permission codename required (superuser passes everything)

    def has_permission(self, request, view):
        u = request.user
        if not (u and u.is_authenticated and u.is_staff and u.is_active):
            return False
        if not ip_allowed(request):
            return False
        ts = request.session.get('admin_verified_at')
        if not ts or time.time() - ts > settings.ADMIN_SESSION_SECONDS:
            return False
        need = getattr(view, 'required_perm', None) or self.perm
        return u.has_staff_perm(need) if need else True
