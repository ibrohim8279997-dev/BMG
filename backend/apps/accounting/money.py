"""One rounding rule for every accounting amount in the code base.

All accounting amounts are whole UZS (so'm) stored as integers. Fractions appear only inside a calculation and are
rounded once, half-up, by `to_sum`. Nothing in this module uses float."""
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation


def dec(v) -> Decimal:
    if isinstance(v, float):
        raise TypeError('floats are not allowed for money')
    try:
        d = Decimal(str(v))
    except InvalidOperation:
        raise ValueError(f'not a number: {v!r}')
    if not d.is_finite():
        raise ValueError(f'not a number: {v!r}')
    return d


def to_sum(v) -> int:
    """Round to whole so'm, half-up (0.5 -> 1, -0.5 -> -1)."""
    return int(dec(v).quantize(Decimal('1'), rounding=ROUND_HALF_UP))


def percent_of(amount: int, rate) -> int:
    """amount x rate% , rounded once."""
    return to_sum(Decimal(int(amount)) * dec(rate) / 100)


def vat_on_top(base: int, rate) -> int:
    """VAT added on top of a net amount (BMG commission when BMG is a VAT payer)."""
    return percent_of(base, rate)


def vat_inside(gross: int, rate) -> int:
    """VAT contained in a VAT-inclusive amount (seller's goods price when the seller is a VAT payer)."""
    r = dec(rate)
    return to_sum(Decimal(int(gross)) * r / (100 + r)) if r else 0


def allocate(total: int, weights: list[int]) -> list[int]:
    """Split an integer total by weights so the parts always add up exactly (largest-remainder method)."""
    s = sum(weights)
    if s <= 0:
        return [0] * len(weights)
    raw = [Decimal(int(total)) * w / s for w in weights]
    parts = [int(x) for x in raw]          # truncation toward zero, totals are non-negative
    rest = int(total) - sum(parts)
    order = sorted(range(len(raw)), key=lambda i: (raw[i] - parts[i], -i), reverse=True)
    for i in order[:rest]:
        parts[i] += 1
    return parts
