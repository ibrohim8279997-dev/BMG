"""Sign-in / registration by e-mail. A one-time code is mailed to the address; entering it proves the mailbox is
the person's. Non-existent addresses (bad syntax, domain with no mail server, SMTP refusal) are rejected with
`email_not_found`. Accounts are matched by verified e-mail only; staff must use /admin."""
import hashlib
import hmac
import logging
import secrets
import smtplib
from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.utils import client_ip, throttle

from .emailcheck import domain_can_receive_mail, normalize_email
from .models import EmailLoginCode, User

log = logging.getLogger(__name__)
MAX_PER_HOUR_EMAIL, MAX_PER_HOUR_IP = 5, 20


def _hash(code):
    return hmac.new(settings.SECRET_KEY.encode(), code.encode(), hashlib.sha256).hexdigest()


def _live(email):
    return EmailLoginCode.objects.filter(email=email, used=False).order_by('-created_at').first()


def peek_valid(email):
    o = _live(email)
    return bool(o and o.expires_at >= timezone.now() and o.attempts < settings.LOGIN_CODE_MAX_ATTEMPTS)


def verify(email, code):
    o = _live(email)
    if not o or o.expires_at < timezone.now() or o.attempts >= settings.LOGIN_CODE_MAX_ATTEMPTS:
        return False
    o.attempts += 1
    ok = hmac.compare_digest(o.code_hash, _hash(code))
    if ok:
        o.used = True
    o.save(update_fields=['attempts', 'used'])
    return ok


class EmailRequestCodeView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [throttle('login_code')]

    @method_decorator(csrf_protect)
    def post(self, request):
        email = normalize_email(request.data.get('email'))
        if not email:
            return Response({'error': 'invalid_email'}, status=400)
        if domain_can_receive_mail(email) is False:
            return Response({'error': 'email_not_found'}, status=404)
        ip = client_ip(request)
        recent = EmailLoginCode.objects.filter(created_at__gte=timezone.now() - timedelta(hours=1))
        if recent.filter(email=email).count() >= MAX_PER_HOUR_EMAIL or (ip and recent.filter(ip=ip).count() >= MAX_PER_HOUR_IP):
            return Response({'error': 'too_many_requests'}, status=429)
        code = f'{secrets.randbelow(10**6):06d}'
        try:
            send_mail('BMG: ' + code,
                      f'BMG login code: {code}\nValid {settings.LOGIN_CODE_TTL_SECONDS // 60 + 1} min. '
                      'Nobody from BMG will ask for this code.\n\n'
                      f'BMG kirish kodi: {code}\nКод для входа в BMG: {code}',
                      settings.DEFAULT_FROM_EMAIL, [email], fail_silently=False)
        except smtplib.SMTPRecipientsRefused:
            return Response({'error': 'email_not_found'}, status=404)   # the mail server says this mailbox doesn't exist
        except Exception:
            log.exception('login e-mail failed')
            return Response({'error': 'server_error'}, status=502)
        EmailLoginCode.objects.create(email=email, code_hash=_hash(code), ip=ip,
                                      expires_at=timezone.now() + timedelta(seconds=settings.LOGIN_CODE_TTL_SECONDS))
        return Response({'ok': True, 'ttl': settings.LOGIN_CODE_TTL_SECONDS})


class EmailVerifyView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [throttle('login_verify')]

    @method_decorator(csrf_protect)
    @transaction.atomic
    def post(self, request):
        from .views import create_user, finish_login, registration_blocked
        email = normalize_email(request.data.get('email'))
        code = str(request.data.get('code', ''))
        if not email or not code:
            return Response({'error': 'invalid_request'}, status=400)
        user = User.objects.filter(email__iexact=email, is_staff=False).first()
        if user is None and User.objects.filter(email__iexact=email).exists():
            return Response({'error': 'use_admin_login'}, status=403)
        ip = client_ip(request)
        if user is None:
            if not peek_valid(email):
                return Response({'error': 'invalid_code'}, status=400)
            bad = registration_blocked(request, ip)
            if bad:
                return bad
        if not verify(email, code):
            return Response({'error': 'invalid_code'}, status=400)
        if user is None:
            user = create_user(request, ip, username=f'e{hashlib.sha1(email.encode()).hexdigest()[:20]}', email=email)
        return finish_login(request, user)
