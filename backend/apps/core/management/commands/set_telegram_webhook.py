from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.accounts import telegram


class Command(BaseCommand):
    help = 'Register the login bot webhook: python manage.py set_telegram_webhook https://your-domain'

    def add_arguments(self, parser):
        parser.add_argument('site_url')

    def handle(self, *a, site_url, **o):
        if not (settings.TELEGRAM_BOT_TOKEN and settings.TELEGRAM_WEBHOOK_SECRET):
            raise CommandError('Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in the environment first')
        url = f'{site_url.rstrip("/")}/api/v1/auth/telegram/webhook/{settings.TELEGRAM_WEBHOOK_SECRET}'
        r = telegram.call('setWebhook', url=url, secret_token=settings.TELEGRAM_WEBHOOK_SECRET,
                          allowed_updates=['message'])
        self.stdout.write(str(r))
