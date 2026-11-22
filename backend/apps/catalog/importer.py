import io
import re
from decimal import Decimal, InvalidOperation

from openpyxl import load_workbook

from apps.ai import service as ai

from .models import Category, Offer, Product, name_key

MAX_ROWS = 20000
MAX_COLS = 40
MAX_AI_CALLS = 100

SYNONYMS = {
    'name': ['название', 'наименование', 'товар', 'nomi', 'nom', 'mahsulot', 'name', 'product', 'title'],
    'price': ['цена', 'стоимость', 'narx', 'price', 'cost per'],
    'stock': ['остаток', 'наличие', 'количество', 'кол-во', 'qoldiq', 'miqdor', 'stock', 'qty', 'quantity'],
    'category': ['категория', 'группа', 'kategoriya', 'toifa', 'category', 'group'],
    'unit': ['ед', 'единица', "o'lchov", 'o‘lchov', 'birlik', 'unit', 'uom'],
    'cost_price': ['себестоимость', 'закуп', 'tannarx', 'cost', 'purchase'],
}


def read_rows(data: bytes):
    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)  # never evaluates formulas
    ws = wb.active
    rows = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i > MAX_ROWS:
            break
        rows.append([c for c in row[:MAX_COLS]])
    wb.close()
    while rows and not any(c not in (None, '') for c in rows[0]):
        rows.pop(0)
    return rows


def suggest_mapping(headers):
    mapping = {}
    norm = [str(h or '').strip().lower() for h in headers]
    for field, words in SYNONYMS.items():
        for idx, h in enumerate(norm):
            if idx in mapping.values():
                continue
            if h and any(w in h for w in words):
                mapping[field] = idx
                break
    return mapping


def to_decimal(v):
    if v is None or v == '':
        return None
    if isinstance(v, (int, float, Decimal)):
        d = Decimal(str(v))
    else:
        s = re.sub(r'[\s ]', '', str(v)).replace(',', '.')
        try:
            d = Decimal(s)
        except InvalidOperation:
            return None
    return d if d.is_finite() else None


def find_category(value, cats):
    v = str(value or '').strip().lower()
    if not v:
        return None
    return cats.get(v)


def category_index():
    idx = {}
    for c in Category.objects.all():
        for key in (c.slug, c.name_uz, c.name_ru, c.name_en):
            idx[key.lower()] = c
    return idx


def process(imp, data, user):
    """Create/update offers from a confirmed mapping. Returns result dict."""
    rows = read_rows(data)
    m = imp.mapping
    cats = category_index()
    slugs = list(Category.objects.values_list('slug', flat=True))
    by_slug = {c.slug: c for c in cats.values()}
    created = updated = ai_used = 0
    errors = []

    def cell(r, f):
        i = m.get(f)
        return r[i] if i is not None and i < len(r) else None

    for n, r in enumerate(rows[1:], start=2):
        if not any(c not in (None, '') for c in r):
            continue
        name = str(cell(r, 'name') or '').strip()[:200]
        price, stock = to_decimal(cell(r, 'price')), to_decimal(cell(r, 'stock'))
        if not name:
            errors.append({'row': n, 'error': 'name_required'}); continue
        if price is None or price <= 0:
            errors.append({'row': n, 'error': 'price_invalid'}); continue
        if stock is None or stock < 0:
            errors.append({'row': n, 'error': 'stock_required'}); continue   # stock is mandatory
        cat = find_category(cell(r, 'category'), cats)
        if cat is None:
            if cell(r, 'category') in (None, '') and ai_used < MAX_AI_CALLS:
                ai_used += 1
                slug = ai.suggest_category(name, slugs, user=user)
                cat = by_slug.get(slug) if slug else None
            if cat is None:
                errors.append({'row': n, 'error': 'category_required'}); continue
        cost = to_decimal(cell(r, 'cost_price'))
        product, _ = Product.objects.get_or_create(
            category=cat, name_key=name_key(name),
            defaults={'name': name, 'unit': str(cell(r, 'unit') or '')[:20]})
        _, was_created = Offer.objects.update_or_create(
            product=product, seller=imp.seller,
            defaults={'price': price, 'stock': stock, 'cost_price': cost if cost and cost > 0 else None, 'active': True})
        created += was_created
        updated += not was_created
    return {'created': created, 'updated': updated, 'errors': errors[:200], 'error_count': len(errors)}
