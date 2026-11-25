"""BMG Telegram bot, deployed separately from the site. Long polling, no inbound port needed.
Registers people inside Telegram: language -> share own contact -> role (-> company) -> accept policies -> account,
then sends a one-time sign-in link. /login gives a fresh link. Login codes requested on the site still arrive here
(the site sends them with the same bot token).
Talks to the BMG backend only through /api/v1/bot/* with X-Bot-Secret. Needs: requests."""
import logging
import os
import time

import requests

log = logging.getLogger('bmg.bot')

T = {
    'choose_lang': 'Tilni tanlang / Выберите язык / Choose language',
    'share': {'uz': 'Ro‘yxatdan o‘tish yoki kirish uchun telefon raqamingizni ulashing 👇',
              'ru': 'Чтобы зарегистрироваться или войти, поделитесь своим номером 👇',
              'en': 'To sign up or log in, share your phone number 👇'},
    'share_btn': {'uz': '📱 Raqamni ulashish', 'ru': '📱 Поделиться номером', 'en': '📱 Share my number'},
    'not_own': {'uz': '❌ Faqat o‘z raqamingizni ulashing.', 'ru': '❌ Поделитесь только своим номером.',
                'en': '❌ Share your own contact only.'},
    'role': {'uz': 'Siz kimsiz?', 'ru': 'Кто вы?', 'en': 'Who are you?'},
    'client': {'uz': '🏠 Mijoz', 'ru': '🏠 Покупатель', 'en': '🏠 Client'},
    'seller': {'uz': '🏪 Sotuvchi', 'ru': '🏪 Продавец', 'en': '🏪 Seller'},
    'company': {'uz': 'Kompaniya nomini yozing:', 'ru': 'Напишите название компании:', 'en': 'Type your company name:'},
    'consent': {'uz': 'Davom etish uchun hujjatlar bilan tanishing va rozilik bering:\n{privacy}\n{terms}',
                'ru': 'Чтобы продолжить, ознакомьтесь с документами и подтвердите согласие:\n{privacy}\n{terms}',
                'en': 'To continue, read and accept the documents:\n{privacy}\n{terms}'},
    'accept': {'uz': '✅ Roziman', 'ru': '✅ Принимаю', 'en': '✅ I accept'},
    'done': {'uz': '🎉 Ro‘yxatdan o‘tdingiz! Saytga kirish havolasi (5 daqiqa, bir marta):',
             'ru': '🎉 Вы зарегистрированы! Ссылка для входа на сайт (5 минут, один раз):',
             'en': '🎉 You are registered! Sign-in link (5 minutes, single use):'},
    'login': {'uz': 'Saytga kirish havolasi (5 daqiqa, bir marta):', 'ru': 'Ссылка для входа (5 минут, один раз):',
              'en': 'Sign-in link (5 minutes, single use):'},
    'open': {'uz': '🔐 Saytga kirish', 'ru': '🔐 Войти на сайт', 'en': '🔐 Open the site'},
    'staff': {'uz': 'Xodimlar /admin orqali kiradi.', 'ru': 'Сотрудники входят через /admin.', 'en': 'Staff use /admin.'},
    'need_start': {'uz': 'Avval /start bosing.', 'ru': 'Сначала нажмите /start.', 'en': 'Press /start first.'},
    'error': {'uz': 'Xatolik, keyinroq urinib ko‘ring.', 'ru': 'Ошибка, попробуйте позже.', 'en': 'Error, try again later.'},
}


def tx(key, lang, **kw):
    v = T[key]
    v = v if isinstance(v, str) else v.get(lang, v['ru'])
    return v.format(**kw) if kw else v


class Bot:
    def __init__(self, token, backend_url, secret, site_url, session=None):
        self.api = f'https://api.telegram.org/bot{token}/'
        self.backend, self.secret, self.site = backend_url.rstrip('/'), secret, site_url.rstrip('/')
        self.http = session or requests.Session()
        self.state = {}      # chat_id -> {'lang', 'step', 'role', 'company'}; lost on restart -> user presses /start

    # --- transport
    def tg(self, method, **payload):
        try:
            return self.http.post(self.api + method, json=payload, timeout=40).json()
        except (requests.RequestException, ValueError):
            log.warning('telegram %s failed', method)   # never log the URL: it holds the token
            return {}

    def be(self, path, **payload):
        try:
            r = self.http.post(f'{self.backend}/api/v1/bot/{path}', json=payload,
                               headers={'X-Bot-Secret': self.secret}, timeout=15)
            return r.status_code, r.json()
        except (requests.RequestException, ValueError):
            log.warning('backend %s failed', path)
            return 0, {}

    def say(self, chat, text, markup=None):
        p = {'chat_id': chat, 'text': text, 'disable_web_page_preview': True}
        if markup:
            p['reply_markup'] = markup
        self.tg('sendMessage', **p)

    def send_link(self, chat, lang, key, url):
        # Telegram accepts URL buttons only for public https links; otherwise send the link as text
        markup = {'inline_keyboard': [[{'text': tx('open', lang), 'url': url}]]} if url.startswith('https://') else None
        self.say(chat, f'{tx(key, lang)}\n{url}', markup)

    # --- flow
    def handle(self, upd):
        if 'callback_query' in upd:
            return self.on_button(upd['callback_query'])
        msg = upd.get('message') or {}
        chat = (msg.get('chat') or {})
        if not msg or chat.get('type') != 'private':
            return
        cid, sender, text = chat['id'], msg.get('from') or {}, (msg.get('text') or '').strip()
        st = self.state.setdefault(cid, {'lang': None, 'step': 'lang'})
        lang = st['lang'] or 'ru'
        if text.startswith('/start'):
            self.state[cid] = {'lang': None, 'step': 'lang'}
            return self.say(cid, T['choose_lang'], {'inline_keyboard': [[
                {'text': "🇺🇿 O'zbekcha", 'callback_data': 'lang:uz'}, {'text': '🇷🇺 Русский', 'callback_data': 'lang:ru'},
                {'text': '🇬🇧 English', 'callback_data': 'lang:en'}]]})
        if text.startswith('/login'):
            code, d = self.be('login-link', telegram_id=sender.get('id'), language=st['lang'])
            if code == 200:
                return self.send_link(cid, lang, 'login', d['login_url'])
            return self.say(cid, tx('staff' if d.get('error') == 'use_admin_login' else 'need_start', lang))
        if msg.get('contact'):
            return self.on_contact(cid, sender, msg['contact'], st)
        if st['step'] == 'company' and text:
            st['company'] = text[:200]
            return self.ask_consent(cid, st)
        self.say(cid, tx('need_start', lang))

    def on_contact(self, cid, sender, contact, st):
        lang = st['lang'] or 'ru'
        if contact.get('user_id') != sender.get('id'):        # someone else's contact
            return self.say(cid, tx('not_own', lang))
        code, d = self.be('link', telegram_id=sender['id'], chat_id=cid, phone=contact.get('phone_number', ''))
        if code != 200:
            return self.say(cid, tx('error', lang))
        self.say(cid, '✅', {'remove_keyboard': True})
        if d.get('is_staff'):
            return self.say(cid, tx('staff', lang))
        if d.get('registered'):
            st['step'] = 'done'
            code, d = self.be('login-link', telegram_id=sender['id'], language=lang)
            return self.send_link(cid, lang, 'login', d['login_url']) if code == 200 else self.say(cid, tx('error', lang))
        st['step'] = 'role'
        self.say(cid, tx('role', lang), {'inline_keyboard': [[
            {'text': tx('client', lang), 'callback_data': 'role:client'},
            {'text': tx('seller', lang), 'callback_data': 'role:seller'}]]})

    def ask_consent(self, cid, st):
        lang = st['lang'] or 'ru'
        st['step'] = 'consent'
        self.say(cid, tx('consent', lang, privacy=f'{self.site}/{lang}/legal/privacy', terms=f'{self.site}/{lang}/legal/terms'),
                 {'inline_keyboard': [[{'text': tx('accept', lang), 'callback_data': 'accept'}]]})

    def on_button(self, q):
        self.tg('answerCallbackQuery', callback_query_id=q.get('id'))
        cid = ((q.get('message') or {}).get('chat') or {}).get('id')
        uid, data = (q.get('from') or {}).get('id'), q.get('data', '')
        if not cid:
            return
        st = self.state.setdefault(cid, {'lang': None, 'step': 'lang'})
        if data.startswith('lang:') and data[5:] in ('uz', 'ru', 'en'):
            st.update(lang=data[5:], step='contact')
            lang = st['lang']
            return self.say(cid, tx('share', lang), {'keyboard': [[{'text': tx('share_btn', lang), 'request_contact': True}]],
                                                     'resize_keyboard': True, 'one_time_keyboard': True})
        lang = st['lang'] or 'ru'
        if data.startswith('role:') and st['step'] == 'role' and data[5:] in ('client', 'seller'):
            st['role'] = data[5:]
            if st['role'] == 'seller':
                st['step'] = 'company'
                return self.say(cid, tx('company', lang))
            return self.ask_consent(cid, st)
        if data == 'accept' and st['step'] == 'consent':
            code, d = self.be('register', telegram_id=uid, role=st.get('role'), company_name=st.get('company', ''),
                              language=lang, accept_privacy=True, accept_terms=True)
            if code == 201:
                st['step'] = 'done'
                return self.send_link(cid, lang, 'done', d['login_url'])
            if d.get('error') == 'invalid_state':          # registered meanwhile: just give a login link
                code, d = self.be('login-link', telegram_id=uid, language=lang)
                if code == 200:
                    return self.send_link(cid, lang, 'login', d['login_url'])
            return self.say(cid, tx('error', lang))
        self.say(cid, tx('need_start', lang))

    def run(self):
        self.tg('deleteWebhook')      # polling and a webhook can't both be active
        offset = 0
        while True:
            r = self.tg('getUpdates', offset=offset, timeout=30, allowed_updates=['message', 'callback_query'])
            for upd in r.get('result', []) if r.get('ok') else []:
                offset = upd['update_id'] + 1
                try:
                    self.handle(upd)
                except Exception:
                    log.exception('update failed')
            if not r.get('ok'):
                time.sleep(3)


def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s %(message)s')
    env = {k: os.environ.get(k, '') for k in ('TELEGRAM_BOT_TOKEN', 'BACKEND_URL', 'BOT_API_SECRET', 'SITE_URL')}
    missing = [k for k, v in env.items() if not v]
    if missing:
        raise SystemExit(f'missing env: {", ".join(missing)}')
    Bot(env['TELEGRAM_BOT_TOKEN'], env['BACKEND_URL'], env['BOT_API_SECRET'], env['SITE_URL']).run()


if __name__ == '__main__':
    main()
