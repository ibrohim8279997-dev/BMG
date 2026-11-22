import re


def normalize_phone(raw: str):
    """Uzbek mobile: +998 + 9 digits. Returns None when invalid."""
    digits = re.sub(r'\D', '', raw or '')
    if len(digits) == 9:
        digits = '998' + digits
    if re.fullmatch(r'998\d{9}', digits):
        return '+' + digits
    return None
