import time

from django.core.management.base import BaseCommand

from apps.crm import sender


class Command(BaseCommand):
    help = 'Send pending CRM events (outbox). Runs forever; --once sends what is due and exits (cron).'

    def add_arguments(self, parser):
        parser.add_argument('--once', action='store_true')
        parser.add_argument('--interval', type=int, default=5, help='seconds between polls')

    def handle(self, *args, once=False, interval=5, **kw):
        if not sender.configured():
            self.stderr.write('CRM_BASE_URL / CRM_API_KEY / CRM_WEBHOOK_SECRET are not set: nothing is sent')
        while True:
            n = sender.process_due()
            if once:
                self.stdout.write(f'attempts: {n}')
                return
            if n == 0:
                time.sleep(max(1, interval))
