import re

from django.db import models


class Category(models.Model):
    slug = models.SlugField(unique=True)
    parent = models.ForeignKey('self', null=True, blank=True, on_delete=models.CASCADE, related_name='children')
    name_uz = models.CharField(max_length=120)
    name_ru = models.CharField(max_length=120)
    name_en = models.CharField(max_length=120)
    # AI-generated, then human-reviewed (only reviewed text is shown publicly)
    description_uz = models.TextField(blank=True)
    description_ru = models.TextField(blank=True)
    description_en = models.TextField(blank=True)
    description_reviewed = models.BooleanField(default=False)

    def name(self, lang):
        return getattr(self, f'name_{lang}', self.name_ru)

    def description(self, lang):
        return getattr(self, f'description_{lang}', '') if self.description_reviewed else ''


def name_key(name: str) -> str:
    return re.sub(r'\s+', ' ', name.strip().lower())[:200]


class Product(models.Model):
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name='products')
    name = models.CharField(max_length=200)
    name_key = models.CharField(max_length=200)
    unit = models.CharField(max_length=20, blank=True)
    # photo found by AI web search, downloaded, validated and stored privately; served via /products/<id>/image
    image = models.CharField(max_length=80, blank=True)
    image_status = models.CharField(max_length=10, blank=True)   # '' not searched / found / not_found
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('category', 'name_key')]


class Offer(models.Model):
    """Price and stock come ONLY from sellers; the platform never sets prices."""
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='offers')
    seller = models.ForeignKey('sellers.Seller', on_delete=models.CASCADE, related_name='offers')
    price = models.DecimalField(max_digits=14, decimal_places=2)
    stock = models.DecimalField(max_digits=12, decimal_places=3)
    cost_price = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('product', 'seller')]


class PriceImport(models.Model):
    # null only while staff imports a seller's file and the seller is not determined yet
    seller = models.ForeignKey('sellers.Seller', null=True, blank=True, on_delete=models.CASCADE, related_name='imports')
    created_by = models.ForeignKey('accounts.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    file_name = models.CharField(max_length=200, blank=True)
    stored_name = models.CharField(max_length=80)
    header_row = models.PositiveIntegerField(default=0)   # rows above it (title, company, INN) are not goods
    headers = models.JSONField(default=list)
    ai = models.JSONField(default=dict, blank=True)       # what AI determined: mapped fields, seller detection
    mapping = models.JSONField(default=dict)        # field -> column index
    status = models.CharField(max_length=10, default='draft')   # draft / confirmed
    result = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
