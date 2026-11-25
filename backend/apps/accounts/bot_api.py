"""Internal API for the separately deployed Telegram bot (bot/). The bot registers people inside Telegram:
contact (phone proven by Telegram) -> role -> consents -> account, then hands out one-time sign-in links.
Every call must carry X-Bot-Secret == BOT_API_SECRET. Staff accounts are never created or signed in here."""
import hashlib
import hmac
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.utils import throttle

from .models import BotLoginToken, TelegramLink, User
from .phone import normalize_phone


def _h(token):
    return hashlib.sha256(token.encode()).hexdigest()


def _tg_id(v):
    return int(v) if str(v).lstrip('-').isdigit() and len(str(v)) <= 20 else None


def _lang(v):
    return v if v in ('uz', 'ru', 'en') else 'ru'


class BotView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = []

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        expected = settings.BOT_API_SECRET
        got = request.headers.get('X-Bot-Secret', '')
        # the secret can re-link any phone to a Telegram id, so the bot API is also limited to the bot's own host
        allowed = settings.BOT_API_ALLOWED_IPS
        if allowed and request.META.get('REMOTE_ADDR') not in allowed:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied()
        if not expected or not hmac.compare_digest(got, expected):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied()

    @staticmethod
    def user_for(tid):
        return User.objects.filter(telegram_id=tid).first()


def mask_phone(phone):
    p = str(phone or '')
    return (p[:4] + ' ** *** ' + p[-4:-2] + ' ' + p[-2:]) if len(p) >= 9 else ''


def login_url(user, lang):
    token = secrets.token_urlsafe(32)
    BotLoginToken.objects.create(user=user, token_hash=_h(token),
                                 expires_at=timezone.now() + timedelta(seconds=settings.BOT_LOGIN_TTL_SECONDS))
    return f'{settings.SITE_URL}/{lang}/login/tg?token={token}'


class BotLinkView(BotView):
    """Contact shared with the bot. Links phone <-> Telegram. Tells the bot whether an account already exists."""

    @transaction.atomic
    def post(self, request):
        tid, chat = _tg_id(request.data.get('telegram_id')), _tg_id(request.data.get('chat_id'))
        phone = normalize_phone(request.data.get('phone', ''))
        if not (tid and chat and phone):
            return Response({'error': 'invalid_request'}, status=400)
        TelegramLink.objects.filter(telegram_id=tid).exclude(phone=phone).delete()
        TelegramLink.objects.update_or_create(phone=phone, defaults={'telegram_id': tid, 'chat_id': chat})
        user = User.objects.filter(phone=phone).first()
        if user and user.telegram_id != tid and not User.objects.filter(telegram_id=tid).exclude(pk=user.pk).exists():
            user.telegram_id = tid
            user.save(update_fields=['telegram_id'])
        return Response({'registered': bool(user), 'is_staff': bool(user and user.is_staff)})


class BotRegisterView(BotView):
    @transaction.atomic
    def post(self, request):
        from .views import create_user
        tid = _tg_id(request.data.get('telegram_id'))
        link = TelegramLink.objects.filter(telegram_id=tid).first() if tid else None
        if not link:
            return Response({'error': 'telegram_not_linked'}, status=409)
        if User.objects.filter(phone=link.phone).exists() or self.user_for(tid):
            return Response({'error': 'invalid_state'}, status=409)       # already registered: use /login
        if request.data.get('role') not in ('client', 'seller'):
            return Response({'error': 'registration_required'}, status=422)
        if not (request.data.get('accept_privacy') is True and request.data.get('accept_terms') is True):
            return Response({'error': 'consent_required'}, status=422)
        user = create_user(request, None, username=f'u{link.phone[1:]}', phone=link.phone, telegram_id=tid)
        return Response({'ok': True, 'login_url': login_url(user, _lang(request.data.get('language')))}, status=201)


class BotLoginLinkView(BotView):
    def post(self, request):
        tid = _tg_id(request.data.get('telegram_id'))
        user = self.user_for(tid) if tid else None
        if not user:
            return Response({'error': 'registration_required'}, status=404)
        if user.is_staff:
            return Response({'error': 'use_admin_login'}, status=403)
        if not user.is_active:
            return Response({'error': 'inactive'}, status=403)
        return Response({'login_url': login_url(user, _lang(request.data.get('language') or user.language))})


class BotTokenLoginView(APIView):
    """Browser side: exchange the one-time link token for a session."""
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [throttle('login_verify')]

    @method_decorator(csrf_protect)
    @transaction.atomic
    def post(self, request):
        from .views import finish_login
        token = str(request.data.get('token', ''))
        t = BotLoginToken.objects.select_for_update().filter(token_hash=_h(token)).first() if 20 <= len(token) <= 100 else None
        if not t or t.used or t.expires_at < timezone.now():
            return Response({'error': 'invalid_code'}, status=400)
        if request.data.get('preview') is True:
            # The link is not bound to the browser that asked for it, so someone else's link could sign a victim into
            # the sender's account. The page first shows whose account this is and signs in only after a click.
            return Response({'account': mask_phone(t.user.phone) or t.user.email[:2] + '***'})
        t.used = True
        t.save(update_fields=['used'])
        return finish_login(request, t.user)
