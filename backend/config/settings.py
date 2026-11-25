"""BMG settings. Everything environment-specific comes from env variables."""
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent
env = environ.Env()
environ.Env.read_env(BASE_DIR / '.env')

SECRET_KEY = env('DJANGO_SECRET_KEY', default='dev-insecure-key')
DEBUG = env.bool('DJANGO_DEBUG', default=False)
ALLOWED_HOSTS = env.list('DJANGO_ALLOWED_HOSTS', default=['localhost', '127.0.0.1', 'testserver'])
if not DEBUG and SECRET_KEY == 'dev-insecure-key':
    raise RuntimeError('Set DJANGO_SECRET_KEY in production')

INSTALLED_APPS = [
    'django.contrib.admin', 'django.contrib.auth', 'django.contrib.contenttypes',
    'django.contrib.sessions', 'django.contrib.messages', 'django.contrib.staticfiles',
    'rest_framework',
    'apps.core', 'apps.accounts', 'apps.audit', 'apps.uploads', 'apps.sellers',
    'apps.catalog', 'apps.ai', 'apps.calculator', 'apps.payments', 'apps.orders',
    'apps.support',
    'apps.accounting', 'apps.crm', 'apps.adminpanel',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.locale.LocaleMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'apps.core.middleware.SecurityHeadersMiddleware',
]

ROOT_URLCONF = 'config.urls'
TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates', 'DIRS': [], 'APP_DIRS': True,
    'OPTIONS': {'context_processors': [
        'django.template.context_processors.request',
        'django.contrib.auth.context_processors.auth',
        'django.contrib.messages.context_processors.messages']},
}]
WSGI_APPLICATION = 'config.wsgi.application'

# SQLite by default; PostgreSQL via DATABASE_URL=postgres://...
DATABASES = {'default': env.db('DATABASE_URL', default=f'sqlite:///{BASE_DIR / "db.sqlite3"}')}
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

AUTH_USER_MODEL = 'accounts.User'
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 12}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
]

LANGUAGE_CODE = 'ru'
LANGUAGES = [('uz', 'Oʻzbekcha'), ('ru', 'Русский'), ('en', 'English')]
TIME_ZONE = 'Asia/Tashkent'
USE_I18N = True
USE_TZ = True
STATIC_URL = 'static/'

# --- sessions / CSRF / cookies (browser reaches API same-origin via the Next.js proxy)
SESSION_COOKIE_AGE = 60 * 60 * 24 * 14
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_SECURE = env.bool('COOKIE_SECURE', default=not DEBUG)
CSRF_COOKIE_SECURE = SESSION_COOKIE_SECURE
CSRF_COOKIE_SAMESITE = 'Lax'
CSRF_TRUSTED_ORIGINS = env.list('CSRF_TRUSTED_ORIGINS', default=['http://localhost:3000'] if DEBUG else [])
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'same-origin'
X_FRAME_OPTIONS = 'DENY'
SECURE_SSL_REDIRECT = env.bool('SSL_REDIRECT', default=False)
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SECURE_HSTS_SECONDS = 0 if DEBUG else 31536000
DATA_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024

# --- DRF
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': ['rest_framework.authentication.SessionAuthentication'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_RENDERER_CLASSES': ['rest_framework.renderers.JSONRenderer'],
    'DEFAULT_PARSER_CLASSES': ['rest_framework.parsers.JSONParser', 'rest_framework.parsers.MultiPartParser',
                               'rest_framework.parsers.FormParser'],
    'DEFAULT_THROTTLE_CLASSES': ['rest_framework.throttling.AnonRateThrottle',
                                 'rest_framework.throttling.UserRateThrottle'],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '120/min', 'user': '300/min', 'login_code': '10/hour', 'login_verify': '30/hour',
        'ai': '20/min', 'calc_preview': '30/min', 'apply': '10/hour', 'admin_login': '10/hour', 'reveal': '30/hour', 'upload': '30/hour', 'card': '60/hour',
        'crm_read': env('CRM_READ_RATE', default='120/min'),
    },
    'NUM_PROXIES': env.int('NUM_PROXIES', default=0),  # number of reverse proxies in front
}
CACHES = {'default': {'BACKEND': env('CACHE_BACKEND', default='django.core.cache.backends.locmem.LocMemCache'),
                      'LOCATION': env('CACHE_LOCATION', default='bmg')}}

# --- Telegram (login only)
TELEGRAM_BOT_TOKEN = env('TELEGRAM_BOT_TOKEN', default='')
TELEGRAM_BOT_USERNAME = env('TELEGRAM_BOT_USERNAME', default='')
TELEGRAM_WEBHOOK_SECRET = env('TELEGRAM_WEBHOOK_SECRET', default='')
# Separate bot service (bot/) talks to /api/v1/bot/* with this shared secret; empty = bot API off
BOT_API_SECRET = env('BOT_API_SECRET', default='')
BOT_LOGIN_TTL_SECONDS = env.int('BOT_LOGIN_TTL_SECONDS', default=300)
# --- Google sign-in (off unless a client id is set)
GOOGLE_CLIENT_ID = env('GOOGLE_CLIENT_ID', default='')
# --- E-mail login (code sent by e-mail; console backend in dev)
EMAIL_BACKEND = env('EMAIL_BACKEND', default='django.core.mail.backends.console.EmailBackend' if DEBUG
                    else 'django.core.mail.backends.smtp.EmailBackend')
EMAIL_HOST = env('EMAIL_HOST', default='')
EMAIL_PORT = env.int('EMAIL_PORT', default=587)
EMAIL_HOST_USER = env('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = env('EMAIL_HOST_PASSWORD', default='')
EMAIL_USE_TLS = env.bool('EMAIL_USE_TLS', default=True)
DEFAULT_FROM_EMAIL = env('DEFAULT_FROM_EMAIL', default='BMG <no-reply@bmg.uz>')
EMAIL_TIMEOUT = 10
# --- Captcha on registration (Cloudflare Turnstile); off unless both keys are set. Bot sign-ups don't need it.
TURNSTILE_SITE_KEY = env('TURNSTILE_SITE_KEY', default='')
TURNSTILE_SECRET_KEY = env('TURNSTILE_SECRET_KEY', default='')
LOGIN_CODE_TTL_SECONDS = env.int('LOGIN_CODE_TTL_SECONDS', default=150)
LOGIN_CODE_MAX_ATTEMPTS = env.int('LOGIN_CODE_MAX_ATTEMPTS', default=5)
MAX_NEW_ACCOUNTS_PER_IP_PER_DAY = env.int('MAX_NEW_ACCOUNTS_PER_IP_PER_DAY', default=5)

# --- Click (keys only from env)
CLICK_SERVICE_ID = env('CLICK_SERVICE_ID', default='')
CLICK_MERCHANT_ID = env('CLICK_MERCHANT_ID', default='')
CLICK_MERCHANT_USER_ID = env('CLICK_MERCHANT_USER_ID', default='')
CLICK_SECRET_KEY = env('CLICK_SECRET_KEY', default='')
CLICK_ALLOWED_IPS = env.list('CLICK_ALLOWED_IPS', default=[])  # required in production
SITE_URL = env('SITE_URL', default='http://localhost:3000')

# --- Nexio CRM integration (keys only from env). Push: order events -> CRM; pull: read-only API for the CRM.
CRM_BASE_URL = env('CRM_BASE_URL', default='')               # https://crm.example.uz (empty = nothing is sent)
CRM_API_KEY = env('CRM_API_KEY', default='')                 # nxk_... created in the CRM, scope crm.write
CRM_WEBHOOK_SECRET = env('CRM_WEBHOOK_SECRET', default='')   # HMAC-SHA256 signing secret
CRM_HTTP_TIMEOUT = env.float('CRM_HTTP_TIMEOUT', default=15)
BMG_CRM_READ_KEY = env('BMG_CRM_READ_KEY', default='')       # the CRM's read-only key for /api/crm/v1 (empty = off)
CRM_READ_ALLOWED_IPS = env.list('CRM_READ_ALLOWED_IPS', default=[])   # empty = any IP (the key is still required)
CRM_READ_REQUIRE_HTTPS = env.bool('CRM_READ_REQUIRE_HTTPS', default=True)

# --- Admin panel
ADMIN_ALLOWED_IPS = env.list('ADMIN_ALLOWED_IPS', default=[])  # empty = deny (allow all only in DEBUG)
ADMIN_SESSION_SECONDS = env.int('ADMIN_SESSION_SECONDS', default=7200)

# --- AI providers (keys from env; any subset may be configured)
AI_PROVIDERS = env.list('AI_PROVIDERS', default=['claude', 'openai', 'gemini', 'grok', 'groq'])
AI_KEYS = {
    'claude': env('ANTHROPIC_API_KEY', default=''), 'openai': env('OPENAI_API_KEY', default=''),
    'gemini': env('GEMINI_API_KEY', default=''), 'grok': env('XAI_API_KEY', default=''),
    'groq': env('GROQ_API_KEY', default=''),
}
AI_MODELS = {
    'claude': env('CLAUDE_MODEL', default='claude-sonnet-5-5'),
    'openai': env('OPENAI_MODEL', default='gpt-4.1'),
    'gemini': env('GEMINI_MODEL', default='gemini-2.5-flash'),
    'grok': env('GROK_MODEL', default='grok-3'),
    'groq': env('GROQ_MODEL', default='llama-3.3-70b-versatile'),
}
AI_WEB_SEARCH = env.bool('AI_WEB_SEARCH', default=True)

# --- Private file storage: OUTSIDE the web root, never served directly
PRIVATE_MEDIA_ROOT = Path(env('PRIVATE_MEDIA_ROOT', default=str(BASE_DIR.parent / 'private_media')))
if 'test' in __import__('sys').argv:   # tests must never write into the project tree
    import tempfile
    PRIVATE_MEDIA_ROOT = Path(tempfile.mkdtemp(prefix='bmg-test-media-'))

# --- Logging: payments get their own file
LOG_DIR = Path(env('LOG_DIR', default=str(BASE_DIR / 'logs')))
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOGGING = {
    'version': 1, 'disable_existing_loggers': False,
    'formatters': {'std': {'format': '%(asctime)s %(levelname)s %(name)s %(message)s'}},
    'handlers': {
        'console': {'class': 'logging.StreamHandler', 'formatter': 'std'},
        'payments': {'class': 'logging.FileHandler', 'filename': str(LOG_DIR / 'payments.log'), 'formatter': 'std'},
    },
    'loggers': {'bmg.payments': {'handlers': ['payments', 'console'], 'level': 'INFO', 'propagate': False},
                'bmg.crm': {'handlers': ['console'], 'level': 'INFO', 'propagate': False}},
    'root': {'handlers': ['console'], 'level': 'WARNING'},
}
