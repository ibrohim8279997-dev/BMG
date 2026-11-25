"""Superadmin section "Accounting" (agent scheme). Access: superuser or a role with the 'accounting' permission.
Every change of settings, requisites and documents is written to the audit log with before/after values."""
import re
from datetime import date

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response

from apps.accounting import deals as dsvc
from apps.accounting import documents as docs
from apps.accounting import exports, reconcile
from apps.accounting import services as acc
from apps.accounting.models import Deal, Discrepancy, Document
from apps.audit.models import log as audit
from apps.core.models import Setting
from apps.sellers.models import Seller

from .views import AdminBase


class AccBase(AdminBase):
    required_perm = 'accounting'


def mismatch(e):
    return Response({'error': 'document_mismatch', 'problems': e.problems}, status=400)


def deal_payload(d):
    return {'id': d.id, 'order_id': d.order_id, 'seller_id': d.seller_id, 'seller': d.parties.get('seller', {}).get('name'),
            'status': d.status, 'payment_mode': d.payment_mode, 'goods': d.goods, 'delivery': d.delivery, 'total': d.total,
            'held': d.held, 'commission_rate': str(d.commission_rate), 'commission': d.commission,
            'vat_rate': str(d.vat_rate), 'commission_vat': d.commission_vat, 'seller_vat': d.seller_vat,
            'payout': d.payout, 'client_type': d.parties.get('client', {}).get('type'), 'created_at': d.created_at,
            'confirmed_at': d.confirmed_at, 'paid_out_at': d.paid_out_at, 'payout_ref': d.payout_ref}


def doc_payload(d, full=False):
    out = {'id': d.id, 'kind': d.kind, 'number': d.number, 'date': d.date, 'status': d.status, 'seller_id': d.seller_id,
           'seller': d.seller.company_name if d.seller else None, 'deal_id': d.deal_id, 'base': d.base,
           'vat_rate': str(d.vat_rate), 'vat': d.vat, 'total': d.total, 'period_start': d.period_start,
           'period_end': d.period_end, 'einvoice_status': d.einvoice_status, 'einvoice_ref': d.einvoice_ref,
           'reverses': d.payload.get('reverses'), 'seller_confirmed_at': d.seller_confirmed_at}
    if full:
        out['payload'] = d.payload
    return out


class Overview(AccBase):
    def get(self, request):
        start, end = acc.period_from(request.query_params)
        return Response({'summary': acc.summary(start, end), 'threshold': acc.vat_threshold(),
                         'attention': acc.attention()})


class Deals(AccBase):
    def get(self, request):
        p = request.query_params
        start, end = acc.period_from(p)
        qs = Deal.objects.filter(created_at__date__gte=start, created_at__date__lte=end)
        if p.get('status') in Deal.Status.values:
            qs = qs.filter(status=p['status'])
        if p.get('seller', '').isdigit():
            qs = qs.filter(seller_id=int(p['seller']))
        return Response([deal_payload(d) for d in qs[:500]])


class DealConfirm(AccBase):
    def post(self, request, pk):
        get_object_or_404(Deal, pk=pk)
        try:
            d = dsvc.confirm(pk, request.user)
        except dsvc.DealError as e:
            return Response({'error': e.code}, status=400)
        except docs.DocumentMismatch as e:
            return mismatch(e)
        audit(request, 'deal_confirmed', object_type='deal', object_id=d.id, order_id=d.order_id,
              before={'status': 'delivered'}, after={'status': d.status})
        return Response(deal_payload(d))


class PayOut(AccBase):
    """Human-only: the accountant transferred the money from the bank and records the payment order number."""

    def post(self, request):
        ids = request.data.get('deal_ids')
        if not isinstance(ids, list) or not ids or len(ids) > 200 or not all(isinstance(i, int) for i in ids):
            return Response({'error': 'invalid_request'}, status=400)
        try:
            reg = dsvc.mark_paid_out(ids, request.user, request.data.get('bank_ref'))
        except dsvc.DealError as e:
            return Response({'error': e.code}, status=400)
        except docs.DocumentMismatch as e:
            return mismatch(e)
        audit(request, 'payout_registry_posted', object_type='document', object_id=reg.id, number=reg.number,
              deals=ids, total=reg.total, before={'status': 'confirmed'}, after={'status': 'paid_out'})
        return Response(doc_payload(reg), status=201)


class Documents(AccBase):
    def get(self, request):
        return Response([doc_payload(d) for d in acc.journal(request.query_params)[:500]])


class DocumentDetail(AccBase):
    def get(self, request, pk):
        return Response(doc_payload(get_object_or_404(Document.objects.select_related('seller'), pk=pk), full=True))


class DocumentFile(AccBase):
    def get(self, request, pk, fmt):
        d = get_object_or_404(Document.objects.select_related('seller'), pk=pk)
        if fmt == 'pdf':
            resp = exports.document_pdf(d)
        elif fmt == 'einvoice' and d.kind in ('commission', 'seller_inv'):
            resp = exports.einvoice_json(d)
        else:
            return Response(status=404)
        audit(request, 'document_downloaded', object_type='document', object_id=d.id, format=fmt)
        return resp


class DocumentStorno(AccBase):
    def post(self, request, pk):
        d = get_object_or_404(Document, pk=pk)
        reason = str(request.data.get('reason', '')).strip()[:200]
        if not reason:
            return Response({'error': 'invalid_request'}, status=400)
        before = d.status
        try:
            s = docs.storno(d, request.user, reason)
        except docs.DocumentMismatch as e:
            return mismatch(e)
        audit(request, 'document_reversed', object_type='document', object_id=d.id, number=d.number, reason=reason,
              storno=s.number if s else None, before={'status': before}, after={'status': 'reversed'})
        return Response(doc_payload(s) if s else {'ok': True})


class DocumentEinvoice(AccBase):
    """Record what happened in the operator's cabinet after a manual upload (status + operator id)."""
    STATUSES = ('exported', 'sent', 'accepted', 'rejected')

    def post(self, request, pk):
        d = get_object_or_404(Document, pk=pk, kind__in=['commission', 'seller_inv'])
        st, ref = request.data.get('status'), str(request.data.get('ref', '')).strip()[:80]
        if st not in self.STATUSES or (st in ('sent', 'accepted') and not ref):
            return Response({'error': 'invalid_request'}, status=400)
        before = {'einvoice_status': d.einvoice_status, 'einvoice_ref': d.einvoice_ref}
        d.einvoice_status, d.einvoice_ref = st, ref or d.einvoice_ref
        d.save(update_fields=['einvoice_status', 'einvoice_ref'])
        audit(request, 'einvoice_status_set', object_type='document', object_id=d.id, before=before,
              after={'einvoice_status': d.einvoice_status, 'einvoice_ref': d.einvoice_ref})
        return Response(doc_payload(d))


class AgentAct(AccBase):
    def post(self, request):
        seller = Seller.objects.filter(pk=request.data.get('seller_id') if str(request.data.get('seller_id')).isdigit() else 0).first()
        start, end = acc.parse_date(request.data.get('from')), acc.parse_date(request.data.get('to'))
        if seller is None or not start or not end or start > end or end > timezone.localdate():
            return Response({'error': 'invalid_request'}, status=400)
        try:
            with transaction.atomic():
                d = docs.agent_act(seller, start, end, request.user)
        except docs.DocumentMismatch as e:
            return mismatch(e)
        audit(request, 'agent_act_posted', object_type='document', object_id=d.id, number=d.number, total=d.total)
        return Response(doc_payload(d), status=201)


class Export(AccBase):
    def get(self, request, fmt):
        p = request.query_params
        start, end = acc.period_from(p)
        seller = int(p['seller']) if p.get('seller', '').isdigit() else None
        s, d = acc.summary(start, end, seller), list(acc.journal(p))
        name = f'bmg-accounting-{start}-{end}'
        if fmt == 'xlsx':
            resp = exports.xlsx(s, d, name)
        elif fmt == 'pdf':
            resp = exports.summary_pdf(s, d, name)
        else:
            return Response(status=404)
        audit(request, 'accounting_exported', object_type='report', object_id=fmt, period=[str(start), str(end)])
        return resp


class Discrepancies(AccBase):
    def get(self, request):
        qs = Discrepancy.objects.all()
        if request.query_params.get('all') != '1':
            qs = qs.filter(resolved=False)
        return Response([{'id': x.id, 'kind': x.kind, 'order_id': x.order_id, 'expected': x.expected, 'actual': x.actual,
                          'note': x.note, 'resolved': x.resolved, 'resolution': x.resolution, 'created_at': x.created_at}
                         for x in qs[:500]])

    def post(self, request):
        n = reconcile.run()
        audit(request, 'reconciliation_run', object_type='reconciliation', found=n)
        return Response({'found': n})


class DiscrepancyResolve(AccBase):
    def post(self, request, pk):
        x = get_object_or_404(Discrepancy, pk=pk, resolved=False)
        text = str(request.data.get('resolution', '')).strip()[:200]
        if not text:
            return Response({'error': 'invalid_request'}, status=400)
        x.resolved, x.resolved_by, x.resolution = True, request.user, text
        x.save(update_fields=['resolved', 'resolved_by', 'resolution'])
        audit(request, 'discrepancy_resolved', object_type='discrepancy', object_id=x.id, resolution=text,
              before={'resolved': False}, after={'resolved': True})
        return Response({'ok': True})


DIGITS = {'bmg_inn': 9, 'bmg_bank_account': 20, 'bmg_bank_mfo': 5}
ACC_SETTINGS = {'default_commission_percent': 'percent', 'vat_rate': 'percent', 'bmg_vat_payer': 'bool',
                'bmg_vat_from': 'date', 'brv_value': 'int', 'vat_threshold_brv': 'int', 'einvoice_api_enabled': 'bool',
                'bmg_name': 'text', 'bmg_inn': 'text', 'bmg_address': 'text', 'bmg_bank_name': 'text',
                'bmg_bank_account': 'text', 'bmg_bank_mfo': 'text'}


def valid_setting(k, v):
    t = ACC_SETTINGS.get(k)
    if t == 'bool':
        return isinstance(v, bool)
    if t in ('percent', 'int'):
        return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and \
            (0 <= v <= 100 if t == 'percent' else isinstance(v, int) and 0 < v <= 10**9)
    if t == 'date':
        if v == '':
            return True
        try:
            date.fromisoformat(v)
            return isinstance(v, str)
        except (TypeError, ValueError):
            return False
    if t == 'text':
        return isinstance(v, str) and len(v) <= 250 and (k not in DIGITS or v == '' or re.fullmatch(rf'\d{{{DIGITS[k]}}}', v))
    return False


class AccSettings(AccBase):
    def get(self, request):
        return Response({k: Setting.get(k) for k in ACC_SETTINGS})

    def put(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        for k, v in data.items():
            if not valid_setting(k, v):
                return Response({'error': 'invalid_request', 'field': k}, status=400)
        if data.get('bmg_vat_payer') is True and not (data.get('bmg_vat_from') or Setting.get('bmg_vat_from')):
            return Response({'error': 'invalid_request', 'field': 'bmg_vat_from'}, status=400)
        before = {k: Setting.get(k) for k in data}
        for k, v in data.items():
            Setting.objects.update_or_create(key=k, defaults={'value': v})
        changed = {k for k in data if before[k] != data[k]}
        if changed:
            audit(request, 'accounting_settings_changed', object_type='settings',
                  before={k: before[k] for k in changed}, after={k: data[k] for k in changed})
        return Response({k: Setting.get(k) for k in ACC_SETTINGS})


DIGITS_S = {'inn', 'bank_account', 'bank_mfo'}
SELLER_FIELDS = {'company_name': 200, 'inn': 9, 'legal_address': 250, 'bank_name': 120, 'bank_account': 20,
                 'bank_mfo': 5, 'contract_number': 40}


def seller_req(s):
    return {'id': s.id, 'company_name': s.company_name, 'inn': s.inn, 'legal_address': s.legal_address,
            'bank_name': s.bank_name, 'bank_account': s.bank_account, 'bank_mfo': s.bank_mfo, 'vat_payer': s.vat_payer,
            'contract_number': s.contract_number, 'contract_date': s.contract_date.isoformat() if s.contract_date else '',
            'contract_status': s.contract_status, 'commission_percent': str(s.commission_percent()), 'status': s.status}


class SellerRequisites(AccBase):
    def get(self, request, pk=None):
        if pk is None:
            return Response([seller_req(s) for s in Seller.objects.select_related('commission_level').order_by('-id')[:500]])
        return Response(seller_req(get_object_or_404(Seller, pk=pk)))

    def patch(self, request, pk):
        s = get_object_or_404(Seller, pk=pk)
        d, before = request.data, seller_req(s)
        for f, n in SELLER_FIELDS.items():
            if f in d:
                v = d[f]
                if not isinstance(v, str) or len(v) > n or (f in DIGITS_S and v and not re.fullmatch(rf'\d{{{n}}}', v)):
                    return Response({'error': 'invalid_request', 'field': f}, status=400)
                setattr(s, f, v.strip())
        if 'vat_payer' in d:
            if not isinstance(d['vat_payer'], bool):
                return Response({'error': 'invalid_request', 'field': 'vat_payer'}, status=400)
            s.vat_payer = d['vat_payer']
        if 'contract_date' in d:
            s.contract_date = acc.parse_date(d['contract_date']) if d['contract_date'] else None
            if d['contract_date'] and s.contract_date is None:
                return Response({'error': 'invalid_request', 'field': 'contract_date'}, status=400)
        if 'contract_status' in d:
            st = d['contract_status']
            if st not in ('none', 'pending', 'confirmed', 'terminated'):
                return Response({'error': 'invalid_request', 'field': 'contract_status'}, status=400)
            if st == 'confirmed' and not (s.contract_number and s.contract_date and re.fullmatch(r'\d{9}', s.inn or '')):
                return Response({'error': 'contract_requisites_missing'}, status=400)
            if st == 'confirmed' and s.contract_status != 'confirmed':
                s.contract_confirmed_at = timezone.now()
            s.contract_status = st
        s.save()
        after = seller_req(s)
        changed = {k for k in after if before[k] != after[k]}
        if changed:
            audit(request, 'seller_requisites_changed', object_type='seller', object_id=s.id,
                  before={k: before[k] for k in changed}, after={k: after[k] for k in changed})
        return Response(after)

