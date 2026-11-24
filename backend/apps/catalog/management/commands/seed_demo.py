"""Demo data for local development: categories, one approved seller, offers, DEMO norms.
Norms marked source=demo are placeholders; real norms are produced by AI and reviewed by staff."""
from decimal import Decimal

from django.utils import timezone

from django.core.management.base import BaseCommand

from apps.accounts.models import User
from apps.calculator.models import ConsumptionNorm
from apps.catalog.models import Category, Offer, Product, name_key
from apps.core.models import LegalDocument
from apps.sellers.models import DeliveryRule, Seller

CATS = [
    ('cement', 'Tsement', 'Цемент', 'Cement'), ('gasblock', 'Gazoblok', 'Газоблок', 'Aerated block'),
    ('brick', 'G‘isht', 'Кирпич', 'Brick'), ('paint', 'Bo‘yoq', 'Краска', 'Paint'),
    ('plaster', 'Suvoq', 'Штукатурка', 'Plaster'), ('tile', 'Plitka', 'Плитка', 'Tile'),
    ('roofing', 'Tom yopish', 'Кровля', 'Roofing'), ('drywall', 'Gipsokarton', 'Гипсокартон', 'Drywall'),
]

# DRAFT texts: structure only. A lawyer must review and replace them before launch.
DRAFT_DOCS = [
    ('cookies',
     {'uz': 'Cookie siyosati', 'ru': 'Политика cookie', 'en': 'Cookie policy'},
     {'uz': 'LOYIHA (yurist tekshiruvi kerak). Sayt faqat zarur cookie-lardan foydalanadi: sessiya (kirish), CSRF himoyasi va til tanlovi. Reklama va kuzatuv cookie-lari yo‘q. Mavzu tanlovi brauzerning localStorage’ida saqlanadi.',
      'ru': 'ЧЕРНОВИК (нужна проверка юриста). Сайт использует только необходимые cookie: сессия (вход), защита CSRF и выбор языка. Рекламных и отслеживающих cookie нет. Выбор темы хранится в localStorage браузера.',
      'en': 'DRAFT (needs legal review). The site uses only essential cookies: session (sign-in), CSRF protection and language choice. There are no advertising or tracking cookies. The theme choice is kept in the browser’s localStorage.'}),
    ('seller-offer',
     {'uz': 'Sotuvchilar uchun oferta', 'ru': 'Оферта для продавцов', 'en': 'Seller offer'},
     {'uz': 'LOYIHA (yurist tekshiruvi kerak). 1) Sotuvchi narx va qoldiqni o‘zi belgilaydi, BMG narx qo‘ymaydi. 2) Komissiya faqat tovar qiymatidan olinadi (foiz sotuvchi bilan kelishiladi). 3) BMG sotuvchining hujjatlarini qo‘lda tekshirib tasdiqlaydi; tasdiqlangan sotuvchi profilida "BMG tasdiqlagan" belgisi bo‘ladi. 4) BMG orqali tanishgan mijoz bilan bitimni platformadan tashqarida yopish (aylanib o‘tish) taqiqlanadi; buzilganda jarima: [summa yurist bilan belgilanadi].',
      'ru': 'ЧЕРНОВИК (нужна проверка юриста). 1) Цену и остаток задаёт продавец, BMG цены не назначает. 2) Комиссия берётся только со стоимости товаров (процент согласуется с продавцом). 3) BMG вручную проверяет документы продавца и подтверждает его; у подтверждённого продавца в профиле значок «Подтверждён BMG». 4) Запрещено закрывать сделку с клиентом, найденным через BMG, вне платформы (обход); при нарушении штраф: [сумма определяется юристом].',
      'en': 'DRAFT (needs legal review). 1) The seller sets price and stock; BMG never sets prices. 2) Commission is charged on goods value only (the rate is agreed with the seller). 3) BMG checks the seller’s documents by hand and confirms them; a confirmed seller shows a "Confirmed by BMG" badge on the profile. 4) Closing a deal with a client found through BMG outside the platform (bypass) is forbidden; penalty: [amount to be set by a lawyer].'}),
]


class Command(BaseCommand):
    def handle(self, *a, **o):
        cats = {}
        for slug, uz, ru, en in CATS:
            cats[slug], _ = Category.objects.get_or_create(slug=slug, defaults=dict(name_uz=uz, name_ru=ru, name_en=en))
        u, _ = User.objects.get_or_create(username='u998900000001', defaults=dict(phone='+998900000001', role='seller'))
        u.set_unusable_password(); u.save()
        s, _ = Seller.objects.get_or_create(user=u, defaults=dict(company_name='Demo Stroy', status='approved', approved_at=timezone.now(),
                                                                  contact_phone='+998900000001'))
        DeliveryRule.objects.get_or_create(seller=s, region='Tashkent', defaults={'cost': Decimal('150000')})
        for slug, name, unit, price in [('cement', 'Cement M400 50kg', 'bag', 62000), ('gasblock', 'Gas block 600x200x300', 'pcs', 38000),
                                        ('brick', 'Red brick M100', 'pcs', 1200), ('paint', 'Facade paint 10L', 'pcs', 420000),
                                        ('plaster', 'Gypsum plaster 30kg', 'bag', 78000), ('tile', 'Floor tile 40x40', 'm2', 95000),
                                        ('roofing', 'Metal roof tile', 'm2', 85000), ('drywall', 'Drywall 12.5mm', 'pcs', 55000)]:
            p, _ = Product.objects.get_or_create(category=cats[slug], name_key=name_key(name), defaults=dict(name=name, unit=unit))
            Offer.objects.update_or_create(product=p, seller=s, defaults=dict(price=Decimal(price), stock=Decimal('100000')))
        demo = {('house', 'walls'): [('gasblock', '0.04', 'pcs')], ('house', 'floor'): [('tile', '1.05', 'm2'), ('cement', '0.15', 'bag')],
                ('house', 'ceiling'): [('drywall', '0.35', 'pcs')], ('house', 'roof'): [('roofing', '1.1', 'm2')]}
        for (t, z), rows in demo.items():
            for slug, per, unit in rows:
                ConsumptionNorm.objects.get_or_create(object_type=t, zone=z, category=cats[slug],
                                                      defaults=dict(per_m2=Decimal(per), unit=unit, source='demo',
                                                                    note='DEMO placeholder, not verified'))
        for slug, t in [('privacy', 'Privacy policy'), ('terms', 'Terms of use')]:
            LegalDocument.objects.get_or_create(slug=slug, version=1, defaults=dict(
                title_uz=t, title_ru=t, title_en=t, body_uz='DRAFT', body_ru='DRAFT', body_en='DRAFT',
                effective_from='2026-01-01'))
        for slug, titles, bodies in DRAFT_DOCS:
            LegalDocument.objects.get_or_create(slug=slug, version=1, defaults=dict(
                effective_from='2026-01-01', **{f'title_{l}': titles[l] for l in titles},
                **{f'body_{l}': bodies[l] for l in bodies}))
        self.stdout.write('seeded (seller +998900000001 approved)')
