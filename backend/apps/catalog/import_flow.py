"""Import steps shared by the seller cabinet and the staff panel ("import a seller's own database").

upload -> AI analysis (header row, columns, seller) -> a person fixes what AI could not determine -> confirm ->
AI looks for a photo of each imported product, one product per request, and reports the ones it could not find.
"""
from django.db import transaction

from apps.uploads import validators as up

from . import ai_import, importer
from .models import PriceImport, Product

MAX_IMAGE_PRODUCTS = 300      # photo search per import (each one is a web-search AI call)


class FlowError(Exception):
    def __init__(self, code, status=400):
        self.code, self.status = code, status
        super().__init__(code)


def create(upload, user, seller=None, detect=False):
    """Validate + store the file, run the AI analysis. seller=None & detect=True: staff flow, AI finds the seller."""
    if upload is None:
        raise FlowError('invalid_request')
    try:
        kind, data = up.validate(upload, 'excel')
        rows = importer.read_rows(data)
    except up.UploadError as e:
        raise FlowError(e.code)
    except Exception:
        raise FlowError('invalid_file')
    if len(rows) < 2:
        raise FlowError('empty_file')
    a = ai_import.analyze(rows, user=user)
    if len(rows) < a['header_row'] + 2:
        raise FlowError('empty_file')
    info = {'fields': a['ai_fields'], 'used': a['ai_used'], 'seller_hint': a['seller_hint']}
    file_name = str(getattr(upload, 'name', '') or '')[:200]
    if detect and seller is None:
        found = ai_import.detect_seller(rows, a['header_row'], file_name, a['seller_hint'], user=user)
        info['seller'] = found
        if found['seller_id']:
            from apps.sellers.models import Seller
            seller = Seller.objects.get(pk=found['seller_id'])
    imp = PriceImport.objects.create(
        seller=seller, created_by=user, file_name=file_name, stored_name=up.store(data, kind),
        header_row=a['header_row'], headers=[str(h or '') for h in rows[a['header_row']]], mapping=a['mapping'], ai=info)
    return imp, rows


def rows_of(imp):
    return importer.read_rows(up.open_stored(imp.stored_name))


def payload(imp, rows=None):
    r = {k: v for k, v in (imp.result or {}).items() if k != 'product_ids'}
    d = {'id': imp.id, 'status': imp.status, 'headers': imp.headers, 'mapping': imp.mapping,
         'header_row': imp.header_row, 'required': list(ai_import.REQUIRED), 'result': r,
         'unresolved': [f for f in ai_import.REQUIRED if f not in imp.mapping],
         'ai_fields': [f for f in (imp.ai or {}).get('fields', []) if f in imp.mapping],
         'ai_used': bool((imp.ai or {}).get('used')), 'file_name': imp.file_name,
         'seller': {'id': imp.seller_id, 'company_name': imp.seller.company_name} if imp.seller_id else None,
         'seller_by': ((imp.ai or {}).get('seller') or {}).get('by') if imp.seller_id else None,
         'image_total': len((imp.result or {}).get('product_ids', [])[:MAX_IMAGE_PRODUCTS])}
    if rows is not None:
        start = imp.header_row + 1
        d['preview'] = [[str(c)[:80] if c is not None else '' for c in r] for r in rows[start:start + 10]]
    return d


def patch(imp, data, sellers=None):
    """mapping / header_row (both), seller_id (staff only: `sellers` is the queryset staff may choose from)."""
    rows = None
    if 'header_row' in data:
        hr = data['header_row']
        rows = rows_of(imp)
        if not isinstance(hr, int) or isinstance(hr, bool) or not 0 <= hr < min(len(rows) - 1, ai_import.SCAN_ROWS):
            raise FlowError('invalid_request')
        if hr != imp.header_row:
            imp.header_row, imp.headers = hr, [str(h or '') for h in rows[hr]]
            imp.mapping = importer.suggest_mapping(imp.headers)
    if 'mapping' in data:
        m = data['mapping']
        if not isinstance(m, dict):
            raise FlowError('invalid_request')
        clean = {}
        for k, v in m.items():
            if k not in importer.SYNONYMS:
                raise FlowError('invalid_request')
            if v in (None, ''):
                continue
            if not isinstance(v, int) or isinstance(v, bool) or not 0 <= v < len(imp.headers):
                raise FlowError('invalid_request')
            clean[k] = v
        imp.mapping = clean
    if 'seller_id' in data:
        if sellers is None:
            raise FlowError('invalid_request')
        s = sellers.filter(pk=data['seller_id']).first() if isinstance(data['seller_id'], int) else None
        if s is None:
            raise FlowError('invalid_request')
        imp.seller = s
        imp.ai = {**(imp.ai or {}), 'seller': {'seller_id': s.id, 'by': 'staff'}}
    imp.save()
    return rows


def confirm(imp, user):
    if imp.seller_id is None:
        raise FlowError('seller_required')
    if any(f not in imp.mapping for f in ai_import.REQUIRED):
        raise FlowError('mapping_incomplete')
    imp.result = importer.process(imp, up.open_stored(imp.stored_name), user)
    imp.result['images'] = {'found': [], 'not_found': [], 'done': False}
    imp.status = 'confirmed'
    imp.save(update_fields=['result', 'status'])


def image_step(imp_qs, pk, user):
    """Search a photo for ONE more product of a confirmed import (keeps each request short).
    Products that already have a photo, or were searched before, are skipped and reported as they are."""
    with transaction.atomic():
        imp = imp_qs.select_for_update().filter(pk=pk, status='confirmed').first()
        if imp is None:
            raise FlowError('not_found', 404)
        res = imp.result
        img = res.setdefault('images', {'found': [], 'not_found': [], 'done': False})
        seen = {x['id'] for x in img['found'] + img['not_found']}
        ids = [i for i in res.get('product_ids', [])[:MAX_IMAGE_PRODUCTS] if i not in seen]
        product = Product.objects.select_related('category').filter(pk__in=ids[:1]).first() if ids else None
        if product is None:
            img['done'] = True
            imp.save(update_fields=['result'])
            return imp
        # claim it inside the lock so two tabs do not search the same product twice
        img['not_found'].append({'id': product.id, 'name': product.name})
        imp.save(update_fields=['result'])
    if product.image_status == 'found' and product.image:
        stored = product.image
    elif product.image_status == 'not_found':
        stored = None
    else:
        stored = ai_import.find_image(product, user=user)
        product.image = stored or ''
        product.image_status = 'found' if stored else 'not_found'
        product.save(update_fields=['image', 'image_status'])
    with transaction.atomic():
        imp = imp_qs.select_for_update().get(pk=pk)
        img = imp.result['images']
        if stored:
            img['not_found'] = [x for x in img['not_found'] if x['id'] != product.id]
            img['found'].append({'id': product.id, 'name': product.name})
        left = [i for i in imp.result.get('product_ids', [])[:MAX_IMAGE_PRODUCTS]
                if i not in {x['id'] for x in img['found'] + img['not_found']}]
        img['done'] = not left
        imp.save(update_fields=['result'])
    return imp
