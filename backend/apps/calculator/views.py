from decimal import Decimal, InvalidOperation

from django.shortcuts import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsClient
from apps.core.utils import throttle

from .models import ObjectRequest
from .service import ZONES, NormsUnavailable, calculate


def obj_payload(o):
    return {'id': o.id, 'type': o.type, 'area': str(o.area), 'floors': o.floors, 'rooms': o.rooms, 'city': o.city}


class Objects(APIView):
    permission_classes = [IsClient]

    def get(self, request):
        return Response([obj_payload(o) for o in request.user.objects_requested.order_by('-id')[:50]])

    def post(self, request):
        d = request.data
        try:
            area, floors, rooms = Decimal(str(d.get('area'))), int(d.get('floors', 1)), int(d.get('rooms', 1))
        except (InvalidOperation, TypeError, ValueError):
            return Response({'error': 'invalid_request'}, status=400)
        city = str(d.get('city', '')).strip()[:80]
        if d.get('type') not in ('apartment', 'house', 'complex') or not city \
                or not Decimal('5') <= area <= Decimal('1000000') or not 1 <= floors <= 100 or not 0 <= rooms <= 1000:
            return Response({'error': 'invalid_request'}, status=400)
        o = ObjectRequest.objects.create(user=request.user, type=d['type'], area=area, floors=floors,
                                         rooms=rooms, city=city)
        return Response(obj_payload(o), status=201)


class Calculate(APIView):
    permission_classes = [IsClient]
    throttle_classes = [throttle('ai')]

    def post(self, request, pk):
        obj = get_object_or_404(ObjectRequest, pk=pk, user=request.user)   # only own objects
        zones = request.data.get('zones') or list(ZONES)
        if not isinstance(zones, list) or not set(zones) <= set(ZONES):
            return Response({'error': 'invalid_request'}, status=400)
        try:
            return Response(calculate(obj, zones, request.user))
        except NormsUnavailable:
            return Response({'error': 'norms_unavailable'}, status=503)
