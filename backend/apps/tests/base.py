import io
import zipfile
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.models import Category, Offer, Product, name_key
from apps.sellers.models import DeliveryRule, Seller


class Base(TestCase):
    def setUp(self):
        cache.clear()
        self.api = APIClient()
        self._n = 0

    def user(self, role='client', phone=None):
        self._n += 1
        phone = phone or f'+99890{self._n:07d}'
        return User.objects.create(username=f'u{phone[1:]}', phone=phone, role=role)

    def seller(self, status='approved', city='Tashkent', delivery=100):
        u = self.user('seller')
        s = Seller.objects.create(user=u, company_name=f'Co{u.id}', status=status, contact_phone=u.phone,
                                  contract_status='confirmed')
        if city:
            DeliveryRule.objects.create(seller=s, region=city, cost=Decimal(delivery))
        return s

    def category(self, slug='cement'):
        c, _ = Category.objects.get_or_create(slug=slug, defaults=dict(name_uz=slug, name_ru=slug, name_en=slug))
        return c

    def offer(self, seller, price=1000, stock=100, cat='cement', name='Cement', cost=None):
        p, _ = Product.objects.get_or_create(category=self.category(cat), name_key=name_key(name),
                                             defaults=dict(name=name, unit='bag'))
        return Offer.objects.create(product=p, seller=seller, price=Decimal(price), stock=Decimal(stock),
                                    cost_price=Decimal(cost) if cost else None)

    def login(self, user):
        self.api.force_authenticate(user)  # authentication bypass for feature tests only


def xlsx_bytes(rows):
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    b = io.BytesIO()
    wb.save(b)
    return b.getvalue()


def docx_bytes():
    b = io.BytesIO()
    with zipfile.ZipFile(b, 'w') as z:
        z.writestr('word/document.xml', '<w:document/>')
        z.writestr('[Content_Types].xml', '<Types/>')
    return b.getvalue()


def png_bytes():
    from PIL import Image
    b = io.BytesIO()
    Image.new('RGB', (4, 4)).save(b, 'PNG')
    return b.getvalue()


def pdf_bytes(pages=1):
    from pypdf import PdfWriter
    w = PdfWriter()
    for _ in range(pages):
        w.add_blank_page(100, 100)
    b = io.BytesIO()
    w.write(b)
    return b.getvalue()
