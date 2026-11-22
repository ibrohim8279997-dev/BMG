"""Demo data for local development: categories, one approved seller, offers, DEMO norms.
Norms marked source=demo are placeholders; real norms are produced by AI and reviewed by staff."""
from decimal import Decimal

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


class Command(BaseCommand):
    def handle(self, *a, **o):
        cats = {}
        for slug, uz, ru, en in CATS:
            cats[slug], _ = Category.objects.get_or_create(slug=slug, defaults=dict(name_uz=uz, name_ru=ru, name_en=en))
        u, _ = User.objects.get_or_create(username='u998900000001', defaults=dict(phone='+998900000001', role='seller'))
        u.set_unusable_password(); u.save()
        s, _ = Seller.objects.get_or_create(user=u, defaults=dict(company_name='Demo Stroy', status='approved',
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
        self.stdout.write('seeded (seller +998900000001 approved)')
