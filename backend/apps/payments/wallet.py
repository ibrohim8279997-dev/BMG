from decimal import Decimal

from django.db import transaction

from .models import LedgerEntry, Wallet


class InsufficientFunds(Exception):
    pass


@transaction.atomic
def change(user, amount: Decimal, kind: str, order_id=None, ref=''):
    """Atomically add (+) or subtract (-) from the wallet; balance can never go negative."""
    Wallet.objects.get_or_create(user=user)
    w = Wallet.objects.select_for_update().get(user=user)
    if w.balance + amount < 0:
        raise InsufficientFunds()
    w.balance += amount
    w.save(update_fields=['balance'])
    LedgerEntry.objects.create(wallet=w, kind=kind, amount=amount, balance_after=w.balance,
                               order_id=order_id, ref=ref)
    return w.balance
