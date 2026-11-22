import getpass

import pyotp
from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth.password_validation import validate_password

from apps.accounts.models import TotpDevice, User
from apps.adminpanel.views import new_backup_codes


class Command(BaseCommand):
    help = 'Create a superadmin with authenticator-app 2FA and backup codes.'

    def add_arguments(self, parser):
        parser.add_argument('username')

    def handle(self, *a, username, **o):
        if User.objects.filter(username=username).exists():
            raise CommandError('exists')
        pw = getpass.getpass('Password (12+ chars): ')
        validate_password(pw)
        u = User.objects.create_superuser(username=username, password=pw, role='staff')
        secret = pyotp.random_base32()
        TotpDevice.objects.create(user=u, secret=secret)
        self.stdout.write('Add to your authenticator app:\n' + pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name='BMG'))
        self.stdout.write('Backup codes (store safely, shown once):\n' + '\n'.join(new_backup_codes(u)))
