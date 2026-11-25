"""Personal data (phones, INN, e-mail) is masked before anything reaches logs or the admin panel."""
import re

PHONE = re.compile(r'\+?998[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}')
EMAIL = re.compile(r'([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})')
INN = re.compile(r'(?<!\d)\d{9}(?!\d)')
KEY = re.compile(r'nxk_[A-Za-z0-9_\-]+')


def mask(text, limit=2000):
    s = str(text or '')[:limit * 2]
    s = KEY.sub('nxk_***', s)
    s = PHONE.sub(lambda m: m.group(0)[:4] + '*****' + re.sub(r'\D', '', m.group(0))[-4:], s)
    s = EMAIL.sub(r'\1***@\2', s)
    s = INN.sub(lambda m: '*****' + m.group(0)[-4:], s)
    return s[:limit]


def mask_secret(v):
    v = str(v or '')
    return '' if not v else ('*' * 8 + v[-4:] if len(v) > 8 else '********')
