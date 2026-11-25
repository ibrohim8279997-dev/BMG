from decimal import Decimal, InvalidOperation
from types import SimpleNamespace

from django.shortcuts import get_object_or_404
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsClient
from apps.core.utils import throttle

from .models import ObjectRequest
from .service import ROOF_TYPES, ZONES, NormsUnavailable, calculate


def obj_payload(o):
    return {'id': o.id, 'type': o.type, 'area': str(o.area), 'floors': o.floors, 'rooms': o.rooms, 'city': o.city,
            'length': str(o.length) if o.length else None, 'width': str(o.width) if o.width else None,
            'floor_height': str(o.floor_height) if o.floor_height else None, 'roof_type': o.roof_type, 'roof_pitch': o.roof_pitch}


def parse_object(d):
    """Validate object parameters shared by the saved-object and the guest preview paths. Returns a dict or None."""
    if not isinstance(d, dict):
        return None
    try:
        area, floors, rooms = Decimal(str(d.get('area'))), int(d.get('floors', 1)), int(d.get('rooms', 1))
    except (InvalidOperation, TypeError, ValueError):
        return None
    city = str(d.get('city', '')).strip()[:80]
    if d.get('type') not in ('apartment', 'house', 'complex') or not city or not area.is_finite() \
            or not Decimal('5') <= area <= Decimal('1000000') or not 1 <= floors <= 100 or not 0 <= rooms <= 1000:
        return None
    out = {'type': d['type'], 'area': area, 'floors': floors, 'rooms': rooms, 'city': city}
    geo = parse_geometry(d)
    if geo is False:
        return None
    if geo:
        out.update(geo)
        out['area'] = (geo['length'] * geo['width'] * floors).quantize(Decimal('0.01'))   # total floor area follows the dimensions
        if not Decimal('5') <= out['area'] <= Decimal('1000000'):
            return None
    return out


def parse_geometry(d):
    """Optional length/width/floor_height/roof_type/roof_pitch. None = not given, False = given but invalid."""
    if d.get('length') in (None, '') and d.get('width') in (None, ''):
        return None
    try:
        length, width = Decimal(str(d.get('length'))), Decimal(str(d.get('width')))
        height = Decimal(str(d.get('floor_height') or '2.8'))
        pitch = int(d.get('roof_pitch') or 30)
    except (InvalidOperation, TypeError, ValueError):
        return False
    roof = str(d.get('roof_type') or 'gable')
    if not (length.is_finite() and width.is_finite() and height.is_finite()) or roof not in ROOF_TYPES \
            or not Decimal('2') <= length <= Decimal('300') or not Decimal('2') <= width <= Decimal('300') \
            or not Decimal('2') <= height <= Decimal('6') or not 5 <= pitch <= 70:
        return False
    return {'length': length.quantize(Decimal('0.01')), 'width': width.quantize(Decimal('0.01')),
            'floor_height': height.quantize(Decimal('0.01')), 'roof_type': roof, 'roof_pitch': pitch}


class Objects(APIView):
    permission_classes = [IsClient]

    def get(self, request):
        return Response([obj_payload(o) for o in request.user.objects_requested.order_by('-id')[:50]])

    def post(self, request):
        p = parse_object(request.data)
        if p is None:
            return Response({'error': 'invalid_request'}, status=400)
        return Response(obj_payload(ObjectRequest.objects.create(user=request.user, **p)), status=201)


class CalculatePreview(APIView):
    """Stateless estimate for guests: nothing is saved, same calculator service as saved objects."""
    permission_classes = [AllowAny]
    throttle_classes = [throttle('calc_preview')]

    def post(self, request):
        p = parse_object(request.data)
        zones = request.data.get('zones') if isinstance(request.data, dict) else None
        zones = list(ZONES) if zones is None else zones
        if p is None or not isinstance(zones, list) or not zones or not set(zones) <= set(ZONES):
            return Response({'error': 'invalid_request'}, status=400)
        user = request.user if request.user.is_authenticated else None
        try:
            return Response(calculate(SimpleNamespace(**p), list(dict.fromkeys(zones)), user))
        except NormsUnavailable:
            return Response({'error': 'norms_unavailable'}, status=503)


class Calculate(APIView):
    permission_classes = [IsClient]
    throttle_classes = [throttle('ai')]

    def post(self, request, pk):
        obj = get_object_or_404(ObjectRequest, pk=pk, user=request.user)   # only own objects
        zones = request.data.get('zones') or list(ZONES)
        if not isinstance(zones, list) or len(zones) > len(ZONES) * 4 or not all(isinstance(z, str) for z in zones) \
                or not set(zones) <= set(ZONES):
            return Response({'error': 'invalid_request'}, status=400)
        try:   # duplicates removed: each zone is calculated once (a long list must not multiply the DB work)
            return Response(calculate(obj, list(dict.fromkeys(zones)), request.user))
        except NormsUnavailable:
            return Response({'error': 'norms_unavailable'}, status=503)
