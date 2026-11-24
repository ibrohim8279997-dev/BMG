"""Google sign-in: verifies the ID token with Google's tokeninfo endpoint (Google checks signature and expiry),
then we check audience, issuer and verified e-mail ourselves. Off unless GOOGLE_CLIENT_ID is configured."""
import requests
from django.conf import settings

TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo'


def verify_id_token(token: str):
    """Return {'sub', 'email', 'name'} for a valid token issued for OUR client id, else None."""
    if not settings.GOOGLE_CLIENT_ID or not token or len(token) > 4096:
        return None
    try:
        r = requests.get(TOKENINFO, params={'id_token': token}, timeout=5)
        if r.status_code != 200:
            return None
        d = r.json()
    except (requests.RequestException, ValueError):
        return None
    if d.get('aud') != settings.GOOGLE_CLIENT_ID or d.get('iss') not in ('accounts.google.com', 'https://accounts.google.com'):
        return None
    if str(d.get('email_verified')).lower() != 'true' or not d.get('sub'):
        return None
    return {'sub': str(d['sub'])[:40], 'email': str(d.get('email', ''))[:254], 'name': str(d.get('name', ''))[:150]}
