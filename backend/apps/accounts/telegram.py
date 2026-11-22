"""Telegram bot: used ONLY for login (link phone, deliver one-time codes)."""
import logging

import requests
from django.conf import settings

from .models import TelegramLink
from .phone import normalize_phone

log = logging.getLogger(__name__)
API = 'https://api.telegram.org/bot{token}/{method}'


def call(method, **payload):
    if not settings.TELEGRAM_BOT_TOKEN:
        log.warning('TELEGRAM_BOT_TOKEN not set; %s skipped', method)
        return None
    try:
        r = requests.post(API.format(token=settings.TELEGRAM_BOT_TOKEN, method=method), json=payload, timeout=10)
        return r.json()
    except requests.RequestException:
        log.exception('telegram call failed')  # never log the URL: it contains the token
        return None


def send_message(chat_id, text, reply_markup=None):
    payload = {'chat_id': chat_id, 'text': text}
    if reply_markup:
        payload['reply_markup'] = reply_markup
    return call('sendMessage', **payload)


def send_login_code(phone, code):
    link = TelegramLink.objects.filter(phone=phone).first()
    if not link:
        return False
    send_message(link.chat_id, f'BMG: {code}\n(2–3 min). Nobody from BMG will ask for this code.')
    return True


TEXTS = {
    'start': 'BMG. Нажмите кнопку, чтобы поделиться номером телефона для входа.\n'
             'Tugmani bosing va kirish uchun telefon raqamingizni ulashing.\nTap the button to share your phone for login.',
    'linked': 'OK ✅ Return to the site and request the code. / Saytga qayting va kod so‘rang. / Вернитесь на сайт и запросите код.',
    'not_own': '❌ Share your own contact only. / Faqat o‘z raqamingiz. / Только свой номер.',
}


def handle_update(update: dict):
    msg = update.get('message') or {}
    sender = msg.get('from') or {}
    chat = msg.get('chat') or {}
    if not msg or chat.get('type') != 'private':
        return
    contact = msg.get('contact')
    if contact:
        # contact.user_id must equal sender id, otherwise someone forwards another person's contact
        if contact.get('user_id') != sender.get('id'):
            send_message(chat['id'], TEXTS['not_own'])
            return
        phone = normalize_phone(contact.get('phone_number', ''))
        if not phone:
            return
        TelegramLink.objects.filter(telegram_id=sender['id']).exclude(phone=phone).delete()
        TelegramLink.objects.update_or_create(
            phone=phone, defaults={'telegram_id': sender['id'], 'chat_id': chat['id']})
        send_message(chat['id'], TEXTS['linked'], {'remove_keyboard': True})
        return
    send_message(chat['id'], TEXTS['start'], {
        'keyboard': [[{'text': '📱 Phone / Telefon / Телефон', 'request_contact': True}]],
        'resize_keyboard': True, 'one_time_keyboard': True})
