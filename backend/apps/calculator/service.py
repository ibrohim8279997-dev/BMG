import math
from decimal import Decimal, InvalidOperation

from django.db.models import Q

from apps.ai import service as ai
from apps.catalog.models import Category, Offer
from apps.core.models import Setting

from .models import ConsumptionNorm

ZONES = ('walls', 'floor', 'ceiling', 'roof')
CEILING_HEIGHT = 2.8        # m
APARTMENT_WALL_RATIO = 2.5  # wall area / floor area, typical rule of thumb
ROOF_FACTOR = 1.25          # roof area vs footprint (slope allowance)


class NormsUnavailable(Exception):
    pass


ROOF_TYPES = ('gable', 'hip', 'mono', 'flat')
OVERHANG = 1.08             # eaves overhang allowance on roof area


def has_geometry(obj):
    return bool(getattr(obj, 'length', None) and getattr(obj, 'width', None))


def roof_area(obj):
    """Roof surface from real dimensions: footprint / cos(pitch) for sloped roofs, footprint for flat ones."""
    foot = float(obj.length) * float(obj.width)
    kind = getattr(obj, 'roof_type', '') or 'gable'
    if kind == 'flat':
        return foot * 1.03
    pitch = math.radians(min(70, max(5, int(getattr(obj, 'roof_pitch', None) or 30))))
    return foot / math.cos(pitch) * OVERHANG


def zone_area(obj, zone):
    """Geometric basis of a zone (m2). Uses the real length x width x height when the 3D designer supplied them,
    otherwise rough rules of thumb. All figures are approximations."""
    area, floors = float(obj.area), max(1, obj.floors)
    if has_geometry(obj) and obj.type != 'apartment':
        length, width = float(obj.length), float(obj.width)
        height = float(getattr(obj, 'floor_height', None) or CEILING_HEIGHT)
        if zone in ('floor', 'ceiling'):
            return length * width * floors
        if zone == 'roof':
            return roof_area(obj)
        if zone == 'walls':
            return 2 * (length + width) * height * floors
        raise ValueError(zone)
    if zone in ('floor', 'ceiling'):
        return area
    if zone == 'roof':
        return 0.0 if obj.type == 'apartment' else area / floors * ROOF_FACTOR
    if zone == 'walls':
        if obj.type == 'apartment':
            return area * APARTMENT_WALL_RATIO
        side = math.sqrt(area / floors)
        return 4 * side * CEILING_HEIGHT * floors
    raise ValueError(zone)


def ensure_norms(obj_type, zone, user=None):
    qs = ConsumptionNorm.objects.filter(object_type=obj_type, zone=zone).select_related('category')
    if qs.exists():
        return list(qs)
    cats = {c.slug: c for c in Category.objects.all()}
    prompt = (f'Object type: {obj_type}. Zone: {zone}. Using building norms and sources found online for Uzbekistan '
              f'(SNiP/ShNQ, supplier data), give APPROXIMATE material consumption per 1 m2 of this zone, including '
              f'typical waste. Use ONLY these category slugs: {", ".join(cats)}. '
              f'Reply with JSON only: [{{"category_slug": str, "per_m2": number, "unit": str, "note": str}}]')
    system = 'You are a construction estimator. Output only JSON. Figures are approximate and must be verified by a specialist.'
    try:
        data = ai.extract_json(ai.complete(system, prompt, 'norms', user=user, web=True))
    except (ai.AIUnavailable, ValueError):
        raise NormsUnavailable()
    out = []
    for item in data if isinstance(data, list) else []:
        cat = cats.get(str(item.get('category_slug', '')))
        try:
            per = Decimal(str(item.get('per_m2')))
        except (InvalidOperation, TypeError):
            continue
        if cat is None or per <= 0 or per > 1000:
            continue
        n, _ = ConsumptionNorm.objects.get_or_create(
            object_type=obj_type, zone=zone, category=cat,
            defaults={'per_m2': per, 'unit': str(item.get('unit', ''))[:20], 'note': str(item.get('note', ''))[:300],
                      'source': 'ai'})
        out.append(n)
    if not out:
        raise NormsUnavailable()
    return out


def candidate_offers(category, city):
    cat_ids = [category.id] + list(category.children.values_list('id', flat=True))
    qs = (Offer.objects.filter(active=True, stock__gt=0, seller__status='approved', product__category_id__in=cat_ids)
          .select_related('product', 'seller').order_by('price'))
    city_l = city.strip().lower()
    out = []
    for o in qs[:200]:
        rule = next((r for r in o.seller.delivery_rules.all() if r.region.strip().lower() == city_l), None)
        if rule is not None:
            out.append((o, rule.cost))
    return out


def calculate(obj, zones, user=None):
    lines, sellers_delivery = [], {}
    for zone in zones:
        area = zone_area(obj, zone)
        if area <= 0:
            continue
        for norm in ensure_norms(obj.type, zone, user):
            qty = math.ceil(area * float(norm.per_m2))
            cands = candidate_offers(norm.category, obj.city)
            options = []
            for o, dcost in cands:
                if o.stock < qty:
                    continue
                options.append({'offer_id': o.id, 'product': o.product.name, 'seller_id': o.seller_id,
                                'seller': o.seller.company_name, 'unit_price': str(o.price), 'unit': o.product.unit,
                                'line_total': str(o.price * qty), 'delivery': str(dcost),
                                'unit_mismatch': bool(norm.unit and o.product.unit and
                                                      norm.unit.lower() != o.product.unit.lower())})
            options.sort(key=lambda x: Decimal(x['line_total']))
            lines.append({'zone': zone, 'category': norm.category.slug, 'category_names': {
                              'uz': norm.category.name_uz, 'ru': norm.category.name_ru, 'en': norm.category.name_en},
                          'qty': qty, 'unit': norm.unit, 'note': norm.note, 'norm_source': norm.source,
                          'norm_reviewed': norm.reviewed, 'best': options[0] if options else None,
                          'alternatives': options[1:4]})
    total = Decimal('0')
    for ln in lines:
        b = ln['best']
        if b:
            total += Decimal(b['line_total'])
            sellers_delivery[b['seller_id']] = Decimal(b['delivery'])
    delivery = sum(sellers_delivery.values(), Decimal('0'))
    return {'lines': lines, 'goods_total': str(total), 'delivery_total': str(delivery),
            'total': str(total + delivery), 'approximate': True,
            'large_object': float(obj.area) >= float(Setting.get('large_object_area')) or obj.type == 'complex',
            'disclaimer': ai.DISCLAIMER}
