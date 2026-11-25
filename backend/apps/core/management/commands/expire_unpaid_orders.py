from django.core.management.base import BaseCommand

from apps.orders.services import expire_unpaid


class Command(BaseCommand):
    help = 'Cancel orders left unpaid longer than order_payment_ttl_minutes and return their stock (run from cron).'

    def handle(self, *args, **options):
        self.stdout.write(f'expired: {expire_unpaid()}')
