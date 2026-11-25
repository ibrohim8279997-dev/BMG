"""E-mail existence checks. Syntax first, then a DNS lookup through Google Public DNS (dns.google, DNS-over-HTTPS):
a domain with no MX (or A) record can't receive mail, so "user@no-such-domain.xyz" is rejected as not existing.
A single mailbox on a real domain can't be probed reliably (Gmail & co. refuse), so ownership is proven by the
one-time code sent to the address; an SMTP "recipient refused" at send time is also reported as not existing."""
import requests
from django.core.exceptions import ValidationError
from django.core.validators import validate_email

DOH = 'https://dns.google/resolve'


def normalize_email(raw) -> str:
    e = str(raw or '').strip().lower()
    if not e or len(e) > 254:
        return ''
    try:
        validate_email(e)
    except ValidationError:
        return ''
    return e


def _has_record(domain: str, rtype: str):
    """True/False from Google DNS; None when the lookup itself failed (then we don't block the user)."""
    try:
        r = requests.get(DOH, params={'name': domain, 'type': rtype}, timeout=4, headers={'Accept': 'application/dns-json'})
        d = r.json()
    except (requests.RequestException, ValueError):
        return None
    if d.get('Status') == 3:       # NXDOMAIN
        return False
    answers = d.get('Answer', []) or []
    if rtype == 'MX':
        # RFC 7505 "null MX" (target '.') means the domain accepts no mail
        return any(a.get('type') == 15 and str(a.get('data', '')).split()[-1:] != ['.'] for a in answers)
    return any(a.get('type') in (1, 28) for a in answers)


def domain_can_receive_mail(email: str):
    """True: has MX/A. False: certainly can't receive mail. None: DNS unreachable (unknown)."""
    domain = email.rsplit('@', 1)[-1]
    mx = _has_record(domain, 'MX')
    if mx:
        return True
    a = _has_record(domain, 'A')
    if mx is None and a is None:
        return None
    return bool(a)
