"""Bot registration: backend /bot/* API plus the real bot/bot.py flow driven against the Django test client."""
import importlib.util
from pathlib import Path
from unittest import mock

from django.conf import settings
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.models import BotLoginToken, TelegramLink, User

from .base import Base

spec = importlib.util.spec_from_file_location('bmg_bot', Path(settings.BASE_DIR).parent / 'bot' / 'bot.py')
bmg_bot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmg_bot)
SECRET = 'bot-secret-123'


class FakeSession:
    """Routes the bot's backend calls into Django's test client and records Telegram calls."""
    def __init__(self):
        self.client, self.sent = APIClient(), []

    def post(self, url, json=None, headers=None, timeout=None):
        r = mock.Mock()
        if '/api/v1/bot/' in url:
            resp = self.client.post(url[url.index('/api/v1/'):], json, format='json', HTTP_X_BOT_SECRET=(headers or {}).get('X-Bot-Secret', ''))
            r.status_code, r.json.return_value = resp.status_code, resp.json()
        else:
            self.sent.append((url.rsplit('/', 1)[-1], json))
            r.status_code, r.json.return_value = 200, {'ok': True, 'result': []}
        return r


def msg(uid, text=None, contact=None):
    m = {'chat': {'id': uid, 'type': 'private'}, 'from': {'id': uid}}
    if text:
        m['text'] = text
    if contact:
        m['contact'] = contact
    return {'message': m}


def btn(uid, data):
    return {'callback_query': {'id': 'q', 'from': {'id': uid}, 'message': {'chat': {'id': uid}}, 'data': data}}


@override_settings(BOT_API_SECRET=SECRET, SITE_URL='https://bmg.test')
class BotFlowTests(Base):
    def setUp(self):
        super().setUp()
        self.s = FakeSession()
        self.bot = bmg_bot.Bot('TKN', 'http://backend', SECRET, 'https://bmg.test', session=self.s)

    def last_text(self):
        return [p for m, p in self.s.sent if m == 'sendMessage'][-1]['text']

    def link_token(self):
        return self.last_text().rsplit('token=', 1)[1]

    def test_register_seller_in_bot_then_sign_in_with_link(self):
        uid = 5550001
        self.bot.handle(msg(uid, '/start'))
        self.bot.handle(btn(uid, 'lang:uz'))
        self.bot.handle(msg(uid, contact={'user_id': uid, 'phone_number': '+998901112233'}))
        self.assertEqual(TelegramLink.objects.get().phone, '+998901112233')
        self.bot.handle(btn(uid, 'role:seller'))
        self.bot.handle(msg(uid, 'Qurilish MCHJ'))
        self.assertIn('/uz/legal/privacy', self.last_text())
        self.bot.handle(btn(uid, 'accept'))
        u = User.objects.get(phone='+998901112233')
        self.assertEqual((u.role, u.telegram_id, u.seller.company_name, u.language), ('seller', uid, 'Qurilish MCHJ', 'uz'))
        self.assertIsNotNone(u.accepted_privacy_at)
        sent = [p for m, p in self.s.sent if m == 'sendMessage'][-1]
        self.assertEqual(sent['reply_markup']['inline_keyboard'][0][0]['url'].split('?')[0], 'https://bmg.test/uz/login/tg')
        token = self.link_token()
        web = APIClient()
        r = web.post('/api/v1/auth/bot-token', {'token': token}, format='json')
        self.assertEqual((r.status_code, r.data['id']), (200, u.id))
        self.assertEqual(web.get('/api/v1/me').data['id'], u.id)
        # single use
        self.assertEqual(APIClient().post('/api/v1/auth/bot-token', {'token': token}, format='json').data['error'], 'invalid_code')

    def test_existing_user_gets_login_link_and_login_command(self):
        u = self.user(phone='+998907778899')
        uid = 5550002
        self.bot.handle(btn(uid, 'lang:ru'))
        self.bot.handle(msg(uid, contact={'user_id': uid, 'phone_number': '998907778899'}))
        self.assertIn('token=', self.last_text())
        u.refresh_from_db()
        self.assertEqual(u.telegram_id, uid)
        self.bot.handle(msg(uid, '/login'))
        self.assertEqual(APIClient().post('/api/v1/auth/bot-token', {'token': self.link_token()}, format='json').data['id'], u.id)

    def test_foreign_contact_rejected(self):
        self.bot.handle(btn(1, 'lang:en'))
        self.bot.handle(msg(1, contact={'user_id': 2, 'phone_number': '+998901112233'}))
        self.assertFalse(TelegramLink.objects.exists())
        self.assertIn('own contact', self.last_text())

    def test_accept_without_steps_does_not_register(self):
        self.bot.handle(btn(7, 'accept'))
        self.assertFalse(User.objects.exists())

    def test_staff_never_gets_link(self):
        User.objects.create(username='st', phone='+998905554433', is_staff=True, telegram_id=9)
        self.bot.handle(btn(9, 'lang:en'))
        self.bot.handle(msg(9, contact={'user_id': 9, 'phone_number': '+998905554433'}))
        self.bot.handle(msg(9, '/login'))
        self.assertFalse(BotLoginToken.objects.exists())


@override_settings(BOT_API_SECRET=SECRET)
class BotApiSecurityTests(Base):
    def test_secret_required(self):
        body = {'telegram_id': 1, 'chat_id': 1, 'phone': '+998901112233'}
        self.assertEqual(self.api.post('/api/v1/bot/link', body, format='json').status_code, 403)
        self.assertEqual(self.api.post('/api/v1/bot/link', body, format='json', HTTP_X_BOT_SECRET='wrong').status_code, 403)
        self.assertEqual(self.api.post('/api/v1/bot/link', body, format='json', HTTP_X_BOT_SECRET=SECRET).status_code, 200)
        with override_settings(BOT_API_SECRET=''):
            self.assertEqual(self.api.post('/api/v1/bot/link', body, format='json', HTTP_X_BOT_SECRET='').status_code, 403)

    def test_register_requires_link_role_and_consent(self):
        h = {'HTTP_X_BOT_SECRET': SECRET}
        r = self.api.post('/api/v1/bot/register', {'telegram_id': 1, 'role': 'client', 'accept_privacy': True, 'accept_terms': True}, format='json', **h)
        self.assertEqual(r.data['error'], 'telegram_not_linked')
        self.api.post('/api/v1/bot/link', {'telegram_id': 1, 'chat_id': 1, 'phone': '+998901112233'}, format='json', **h)
        self.assertEqual(self.api.post('/api/v1/bot/register', {'telegram_id': 1, 'role': 'staff', 'accept_privacy': True,
                                       'accept_terms': True}, format='json', **h).data['error'], 'registration_required')
        self.assertEqual(self.api.post('/api/v1/bot/register', {'telegram_id': 1, 'role': 'client'}, format='json', **h).data['error'],
                         'consent_required')

    def test_expired_token(self):
        from datetime import timedelta
        from django.utils import timezone
        from apps.accounts.bot_api import _h
        u = self.user()
        BotLoginToken.objects.create(user=u, token_hash=_h('x' * 40), expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.api.post('/api/v1/auth/bot-token', {'token': 'x' * 40}, format='json').data['error'], 'invalid_code')
