"""Superadmin "CRM integration": configuration status (keys live in .env and are only shown masked),
test event, the last 100 deliveries, manual resend. Access: the 'settings' permission. Every action is audited."""
from django.conf import settings
from django.db.models import Count
from django.shortcuts import get_object_or_404
from rest_framework.response import Response

from apps.audit.models import log as audit
from apps.crm import events, sender
from apps.crm.mask import mask_secret
from apps.crm.models import CrmEvent

from .views import AdminBase


class CrmBase(AdminBase):
    required_perm = 'settings'


def event_payload(e):
    return {'id': e.id, 'event_id': e.event_id, 'event_type': e.event_type, 'order_id': e.order_id,
            'order_version': e.order_version, 'is_test': e.is_test, 'status': e.status, 'attempts': e.attempts,
            'next_attempt_at': e.next_attempt_at if e.status == 'pending' else None, 'last_status_code': e.last_status_code,
            'last_error': e.last_error, 'last_attempt_at': e.last_attempt_at, 'delivered_at': e.delivered_at,
            'created_at': e.created_at, 'blocked': e.status == 'pending' and sender.blocked(e)}


class Overview(CrmBase):
    def get(self, request):
        counts = dict(CrmEvent.objects.values_list('status').annotate(n=Count('id')).values_list('status', 'n'))
        return Response({
            'config': {'base_url': settings.CRM_BASE_URL, 'endpoint': sender.endpoint() if settings.CRM_BASE_URL else '',
                       'api_key': mask_secret(settings.CRM_API_KEY), 'secret_set': bool(settings.CRM_WEBHOOK_SECRET),
                       'read_key_set': bool(settings.BMG_CRM_READ_KEY), 'read_ips': settings.CRM_READ_ALLOWED_IPS,
                       'configured': sender.configured(),
                       'https': settings.CRM_BASE_URL.startswith('https://')},
            'counts': {s: counts.get(s, 0) for s in CrmEvent.Status.values},
            'events': [event_payload(e) for e in CrmEvent.objects.order_by('-id')[:100]],
        })


class TestEvent(CrmBase):
    def post(self, request):
        if not sender.configured():
            return Response({'error': 'crm_not_configured'}, status=400)
        e = events.test_event()
        CrmEvent.objects.filter(pk=e.pk).update(locked_until=None)
        e = sender.attempt(e)            # sent right now so the result shows on the button
        audit(request, 'crm_test_event', object_type='crm_event', object_id=e.id, code=e.last_status_code,
              status=e.status)
        return Response(event_payload(e))


class Resend(CrmBase):
    def post(self, request, pk):
        e = get_object_or_404(CrmEvent, pk=pk)
        if e.status == CrmEvent.Status.DELIVERED:
            return Response({'error': 'invalid_state'}, status=400)
        e = sender.resend(e)
        audit(request, 'crm_event_resend', object_type='crm_event', object_id=e.id, order_id=e.order_id)
        return Response(event_payload(e))
