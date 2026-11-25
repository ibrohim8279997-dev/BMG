from datetime import timedelta

from django.conf import settings
from django.contrib.auth import login, logout
from django.db import transaction
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import log as audit
from apps.core.utils import client_ip, throttle

from . import captcha, google, telegram
from .models import TelegramLink, User
from .phone import normalize_phone
from .services import LoginError, issue_code, peek_valid_code, verify_code


def user_payload(u):
    seller = getattr(u, 'seller', None)
    return {'id': u.id, 'phone': u.phone, 'role': u.role, 'language': u.language,
            'is_staff': u.is_staff, 'seller_status': seller.status if seller else None}


def _lang(request):
    return request.data.get('language') if request.data.get('language') in ('uz', 'ru', 'en') else 'ru'


def registration_blocked(request, ip):
    """Role + consents + per-IP limit; checked BEFORE a code is consumed. Returns a Response or None."""
    if request.data.get('role') not in ('client', 'seller'):
        return Response({'error': 'registration_required'}, status=422)
    if not (request.data.get('accept_privacy') is True and request.data.get('accept_terms') is True):
        return Response({'error': 'consent_required'}, status=422)
    since = timezone.now() - timedelta(days=1)
    if User.objects.filter(registration_ip=ip, date_joined__gte=since).count() >= settings.MAX_NEW_ACCOUNTS_PER_IP_PER_DAY:
        return Response({'error': 'too_many_registrations'}, status=429)
    if not captcha.verify(request.data.get('captcha'), ip):
        return Response({'error': 'captcha_required'}, status=422)
    return None


def create_user(request, ip, **fields):
    now = timezone.now()
    role = request.data.get('role')
    user = User.objects.create(role=role, registration_ip=ip, language=_lang(request),
                               accepted_privacy_at=now, accepted_terms_at=now, **fields)
    user.set_unusable_password()
    user.save(update_fields=['password'])
    if role == 'seller':
        from apps.sellers.models import Seller
        Seller.objects.create(user=user, company_name=str(request.data.get('company_name', ''))[:200])
    return user


def finish_login(request, user):
    if user.is_staff:
        return Response({'error': 'use_admin_login'}, status=403)
    if not user.is_active:
        return Response({'error': 'inactive'}, status=403)
    request.session.cycle_key()
    login(request, user, backend='django.contrib.auth.backends.ModelBackend')
    return Response(user_payload(user))


class CsrfView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    @method_decorator(ensure_csrf_cookie)
    def get(self, request):
        return Response({'csrf': get_token(request)})


class RequestCodeView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [throttle('login_code')]

    @method_decorator(csrf_protect)
    def post(self, request):
        phone = normalize_phone(request.data.get('phone', ''))
        if not phone:
            return Response({'error': 'invalid_phone'}, status=400)
        if not TelegramLink.objects.filter(phone=phone).exists():
            bot = settings.TELEGRAM_BOT_USERNAME
            if settings.DEBUG and not settings.TELEGRAM_BOT_TOKEN:
                pass  # dev mode: allow unlinked phone, code returned below
            else:
                return Response({'error': 'telegram_not_linked',
                                 'bot_url': f'https://t.me/{bot}' if bot else ''}, status=409)
        try:
            code = issue_code(phone, client_ip(request))
        except LoginError:
            return Response({'error': 'too_many_requests'}, status=429)
        sent = telegram.send_login_code(phone, code)
        data = {'ok': True, 'ttl': settings.LOGIN_CODE_TTL_SECONDS}
        if settings.DEBUG and not settings.TELEGRAM_BOT_TOKEN and not sent:
            data['dev_code'] = code  # DEV ONLY: no bot token configured
        return Response(data)


class VerifyView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [throttle('login_verify')]

    @method_decorator(csrf_protect)
    @transaction.atomic
    def post(self, request):
        phone = normalize_phone(request.data.get('phone', ''))
        code = str(request.data.get('code', ''))
        if not phone or not code:
            return Response({'error': 'invalid_request'}, status=400)
        user = User.objects.filter(phone=phone).first()
        ip = client_ip(request)
        if user is None:
            # registration needs role + consents (+ captcha); check BEFORE consuming the code
            if not peek_valid_code(phone):
                return Response({'error': 'invalid_code'}, status=400)
            bad = registration_blocked(request, ip)
            if bad:
                return bad
        if not verify_code(phone, code):
            return Response({'error': 'invalid_code'}, status=400)
        if user is None:
            link = TelegramLink.objects.filter(phone=phone).first()
            user = create_user(request, ip, username=f'u{phone[1:]}', phone=phone,
                               telegram_id=link.telegram_id if link else None)
        return finish_login(request, user)


class ProvidersView(APIView):
    """Which sign-in methods are on. The Google button is shown only when a client id is configured."""
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        bot = settings.TELEGRAM_BOT_USERNAME
        return Response({'google_client_id': settings.GOOGLE_CLIENT_ID, 'captcha_site_key': settings.TURNSTILE_SITE_KEY,
                         'telegram_bot_url': f'https://t.me/{bot}' if bot and settings.BOT_API_SECRET else ''})


class GoogleLoginView(APIView):
    """Sign in (or register) with a Google ID token. Accounts are matched ONLY by Google's stable id,
    never by e-mail, so a Google account can't take over a phone/Telegram account. Staff must use /admin."""
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [throttle('login_verify')]

    @method_decorator(csrf_protect)
    @transaction.atomic
    def post(self, request):
        info = google.verify_id_token(str(request.data.get('credential', '')))
        if info is None:
            return Response({'error': 'invalid_code'}, status=400)
        user = User.objects.filter(google_sub=info['sub']).first()
        if user is None:
            ip = client_ip(request)
            bad = registration_blocked(request, ip)
            if bad:
                return bad
            user = create_user(request, ip, username=f'g{info["sub"]}', google_sub=info['sub'], email=info['email'])
        return finish_login(request, user)


class WebhookView(APIView):
    """Telegram bot webhook. Protected by secret header + secret path."""
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = []

    def post(self, request, secret):
        import hmac
        expected = settings.TELEGRAM_WEBHOOK_SECRET
        got = request.headers.get('X-Telegram-Bot-Api-Secret-Token', '')
        if not expected or not hmac.compare_digest(secret, expected) or not hmac.compare_digest(got, expected):
            return Response(status=403)
        telegram.handle_update(request.data if isinstance(request.data, dict) else {})
        return Response({'ok': True})


class LogoutView(APIView):
    def post(self, request):
        logout(request)
        return Response({'ok': True})


class MeView(APIView):
    def get(self, request):
        return Response(user_payload(request.user))

    def patch(self, request):
        lang = request.data.get('language')
        if lang in ('uz', 'ru', 'en'):
            request.user.language = lang
            request.user.save(update_fields=['language'])
        return Response(user_payload(request.user))
