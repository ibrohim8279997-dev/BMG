import hashlib
import hmac
import time
from decimal import Decimal, InvalidOperation

import pyotp
from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.core.cache import cache
from django.db import transaction
from django.db.models import Count, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import BackupCode, StaffMembership, StaffRole, User
from apps.ai.models import AIUsage
from apps.audit.models import AuditLog
from apps.audit.models import log as audit
from apps.catalog.models import Category
from apps.calculator.models import ConsumptionNorm
from apps.core.models import LegalDocument, Setting
from apps.core.permissions import IsAdminSession, ip_allowed
from apps.core.utils import client_ip, throttle
from apps.orders import services as osvc
from apps.orders.models import Order, PayoutRequest, SellerLedger
from apps.sellers.models import CommissionLevel, Seller, SellerApplication
from apps.support.models import Complaint

MAX_FAILS = 5              # per (username, IP) in 15 min
MAX_FAILS_GLOBAL = 30      # per username from all IPs in 15 min (slows a distributed guess without letting one IP
                           # lock the superadmin out)


def hash_code(c):
    """Backup codes are stored as HMAC with the server secret: a database leak alone does not reveal them."""
    norm = c.replace('-', '').replace(' ', '').lower()
    return hmac.new(settings.SECRET_KEY.encode(), b'backup:' + norm.encode(), hashlib.sha256).hexdigest()


def legacy_hash_code(c):
    return hashlib.sha256(c.encode()).hexdigest()    # codes issued before the HMAC change (8 hex chars)


def new_backup_codes(user, n=8):
    import secrets
    user.backup_codes.all().delete()
    codes = [secrets.token_hex(8) for _ in range(n)]   # 64 random bits each
    BackupCode.objects.bulk_create([BackupCode(user=user, code_hash=hash_code(c)) for c in codes])
    return codes


def _bump(key):
    cache.add(key, 0, 900)      # the window starts at the first failure; later failures do not extend it
    try:
        return cache.incr(key)
    except ValueError:
        cache.set(key, 1, 900)
        return 1


class AdminLogin(APIView):
    """Separate staff login: password + authenticator code (or one-time backup code), allowed IPs only."""
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [throttle('admin_login')]

    @method_decorator(csrf_protect)
    @transaction.atomic
    def post(self, request):
        if not ip_allowed(request):
            return Response({'error': 'forbidden'}, status=403)
        username = str(request.data.get('username', ''))[:150]
        ip = client_ip(request) or ''
        key = f'adminfail:{username.lower()}:{ip}'
        gkey = f'adminfail:{username.lower()}'
        if (cache.get(key) or 0) >= MAX_FAILS or (cache.get(gkey) or 0) >= MAX_FAILS_GLOBAL:
            return Response({'error': 'locked'}, status=429)
        user = authenticate(request, username=username, password=str(request.data.get('password', '')))
        ok = bool(user and user.is_staff and user.is_active and hasattr(user, 'totp'))
        if ok:
            otp = str(request.data.get('otp', '')).strip()
            backup = str(request.data.get('backup_code', '')).strip()
            if otp:
                from apps.accounts.models import TotpDevice
                dev = TotpDevice.objects.select_for_update().get(pk=user.totp.pk)   # parallel replay of one code
                totp = pyotp.TOTP(dev.secret)
                step = int(time.time() // 30)
                matched = next((s for s in (step - 1, step, step + 1)
                                if s > dev.last_used_step and hmac.compare_digest(totp.at(s * 30), otp)), None)
                if matched is None:
                    ok = False
                else:
                    dev.last_used_step = matched   # a code can't be replayed
                    dev.save(update_fields=['last_used_step'])
            elif backup:
                bc = (user.backup_codes.select_for_update()
                      .filter(code_hash__in=[hash_code(backup), legacy_hash_code(backup)], used=False).first())
                if bc is None:
                    ok = False
                else:
                    bc.used = True
                    bc.save(update_fields=['used'])
            else:
                ok = False
        if not ok:
            _bump(key)
            _bump(gkey)
            audit(request, 'admin_login_failed', object_type='user', object_id=username[:40])
            return Response({'error': 'invalid_credentials'}, status=400)   # same message for every failure
        cache.delete(key)
        request.session.flush()
        login(request, user, backend='django.contrib.auth.backends.ModelBackend')
        request.session['admin_verified_at'] = time.time()
        audit(request, 'admin_login', actor=user)
        return Response({'ok': True})


class AdminBase(APIView):
    permission_classes = [IsAdminSession]


class AdminLogout(AdminBase):
    def post(self, request):
        logout(request)
        return Response({'ok': True})


class AdminMe(AdminBase):
    def get(self, request):
        u = request.user
        m = getattr(u, 'staff', None)
        return Response({'username': u.username, 'superuser': u.is_superuser,
                         'permissions': ['*'] if u.is_superuser else (m.role.permissions if m else [])})


class Sellers(AdminBase):
    required_perm = 'sellers'

    def get(self, request):
        qs = Seller.objects.select_related('user', 'commission_level').order_by('-id')
        st = request.query_params.get('status')
        if st:
            qs = qs.filter(status=st)
        return Response([{'id': s.id, 'company_name': s.company_name, 'status': s.status, 'rating': str(s.rating),
                          'commission_percent': str(s.commission_percent()),
                          'commission_override': str(s.commission_override) if s.commission_override is not None else None,
                          'level': s.commission_level.name if s.commission_level else None,
                          'documents': s.files.filter(kind='document').count(), 'created_at': s.created_at}
                         for s in qs[:200]])


class SellerDetail(AdminBase):
    required_perm = 'sellers'

    def patch(self, request, pk):
        s = get_object_or_404(Seller, pk=pk)
        d = request.data
        if 'identity_verified' in d:
            s.identity_verified = bool(d['identity_verified'])
        if 'status' in d:
            if d['status'] not in ('pending', 'approved', 'blocked'):
                return Response({'error': 'invalid_request'}, status=400)
            if d['status'] == 'approved' and Setting.get('seller_identity_check') and not s.identity_verified:
                return Response({'error': 'identity_not_verified'}, status=400)
            if d['status'] == 'approved' and s.status != 'approved':
                s.approved_at = timezone.now()
            elif d['status'] != 'approved':
                s.approved_at = None
            s.status = d['status']
        try:
            if 'commission_override' in d:
                v = d['commission_override']
                s.commission_override = None if v in (None, '') else Decimal(str(v))
                if s.commission_override is not None and not Decimal('0') <= s.commission_override <= Decimal('30'):
                    raise InvalidOperation
            if 'rating' in d:
                s.rating = Decimal(str(d['rating']))
                if not Decimal('0') <= s.rating <= Decimal('5'):
                    raise InvalidOperation
        except InvalidOperation:
            return Response({'error': 'invalid_request'}, status=400)
        if 'commission_level_id' in d:
            s.commission_level = CommissionLevel.objects.filter(pk=d['commission_level_id']).first() \
                if d['commission_level_id'] else None
        s.save()
        audit(request, 'seller_updated', object_type='seller', object_id=s.id, fields=list(d.keys()))
        return Response({'id': s.id, 'status': s.status})


class SellerPhone(AdminBase):
    required_perm = 'sellers'

    def post(self, request, pk):
        s = get_object_or_404(Seller, pk=pk)
        audit(request, 'seller_phone_revealed', object_type='seller', object_id=s.id, by_staff=True)
        return Response({'phone': s.contact_phone or s.user.phone})


class Levels(AdminBase):
    required_perm = 'sellers'

    def get(self, request):
        return Response([{'id': l.id, 'name': l.name, 'percent': str(l.percent)} for l in CommissionLevel.objects.all()])

    def post(self, request):
        try:
            p = Decimal(str(request.data.get('percent')))
            if not Decimal('0') <= p <= Decimal('30'):
                raise InvalidOperation
        except InvalidOperation:
            return Response({'error': 'invalid_request'}, status=400)
        name = str(request.data.get('name', '')).strip()[:60]
        if not name:
            return Response({'error': 'invalid_request'}, status=400)
        l, _ = CommissionLevel.objects.update_or_create(name=name, defaults={'percent': p})
        audit(request, 'commission_level_set', object_type='level', object_id=l.id, percent=str(p))
        return Response({'id': l.id}, status=201)


class Roles(AdminBase):
    required_perm = 'roles'
    ALL = ['sellers', 'roles', 'support', 'audit', 'settings', 'orders', 'refunds', 'finance', 'accounting', 'documents',
           'catalog']

    def get(self, request):
        return Response({'all_permissions': self.ALL, 'roles': [
            {'id': r.id, 'name': r.name, 'permissions': r.permissions} for r in StaffRole.objects.all()]})

    def post(self, request):
        if not request.user.is_superuser:      # roles are granted only by the superadmin
            return Response({'error': 'forbidden'}, status=403)
        perms = request.data.get('permissions', [])
        name = str(request.data.get('name', '')).strip()[:60]
        if not name or not isinstance(perms, list) or not set(perms) <= set(self.ALL):
            return Response({'error': 'invalid_request'}, status=400)
        r, _ = StaffRole.objects.update_or_create(name=name, defaults={'permissions': perms})
        audit(request, 'role_set', object_type='role', object_id=r.id)
        return Response({'id': r.id}, status=201)


class StaffUsers(AdminBase):
    """Superuser creates staff; the TOTP secret and backup codes are shown ONCE."""
    required_perm = 'roles'

    def post(self, request):
        if not request.user.is_superuser:
            return Response({'error': 'forbidden'}, status=403)
        username, password = str(request.data.get('username', '')).strip(), str(request.data.get('password', ''))
        role = StaffRole.objects.filter(pk=request.data.get('role_id')).first() \
            if str(request.data.get('role_id', '')).isdigit() else None
        if not username or role is None or User.objects.filter(username=username).exists():
            return Response({'error': 'invalid_request'}, status=400)
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError
        try:
            validate_password(password)
        except ValidationError:
            return Response({'error': 'weak_password'}, status=400)
        u = User.objects.create_user(username=username, password=password, is_staff=True, role='staff')
        StaffMembership.objects.create(user=u, role=role, granted_by=request.user)
        secret = pyotp.random_base32()
        from apps.accounts.models import TotpDevice
        TotpDevice.objects.create(user=u, secret=secret)
        codes = new_backup_codes(u)
        audit(request, 'staff_created', object_type='user', object_id=u.id, role=role.name)
        return Response({'id': u.id, 'totp_uri': pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name='BMG'),
                         'backup_codes': codes}, status=201)


class Applications(AdminBase):
    required_perm = 'sellers'

    def get(self, request):
        qs = SellerApplication.objects.order_by('-id')
        if request.query_params.get('status') in SellerApplication.Status.values:
            qs = qs.filter(status=request.query_params['status'])
        return Response([{'id': a.id, 'company_name': a.company_name, 'contact_name': a.contact_name, 'phone': a.phone,
                          'email': a.email, 'category': a.category, 'comment': a.comment, 'status': a.status,
                          'language': a.language, 'created_at': a.created_at} for a in qs[:200]])


class ApplicationDetail(AdminBase):
    required_perm = 'sellers'

    def patch(self, request, pk):
        a = get_object_or_404(SellerApplication, pk=pk)
        if request.data.get('status') not in SellerApplication.Status.values:
            return Response({'error': 'invalid_request'}, status=400)
        a.status = request.data['status']
        a.save(update_fields=['status'])
        audit(request, 'seller_application_updated', object_type='seller_application', object_id=a.id)
        return Response({'ok': True})


class Complaints(AdminBase):
    required_perm = 'support'

    def get(self, request):
        return Response([{'id': c.id, 'text': c.text, 'status': c.status, 'author_id': c.author_id,
                          'seller_id': c.seller_id, 'order_id': c.order_id, 'assignee_id': c.assignee_id,
                          'created_at': c.created_at} for c in Complaint.objects.order_by('-id')[:200]])


class ComplaintDetail(AdminBase):
    required_perm = 'support'

    def patch(self, request, pk):
        c = get_object_or_404(Complaint, pk=pk)
        if request.data.get('status') in ('new', 'in_progress', 'resolved'):
            c.status = request.data['status']
        if 'assignee_id' in request.data:
            c.assignee = User.objects.filter(pk=request.data['assignee_id'], is_staff=True).first()
        c.save()
        audit(request, 'complaint_updated', object_type='complaint', object_id=c.id)
        return Response({'ok': True})


class Audit(AdminBase):
    required_perm = 'audit'

    def get(self, request):
        qs = AuditLog.objects.select_related('actor').all()
        if request.query_params.get('action'):
            qs = qs.filter(action=request.query_params['action'])
        return Response([{'id': a.id, 'actor': a.actor.username if a.actor else None, 'actor_id': a.actor_id,
                          'action': a.action, 'object_type': a.object_type, 'object_id': a.object_id,
                          'order_id': a.order_id, 'ip': a.ip, 'created_at': a.created_at, 'meta': a.meta}
                         for a in qs[:500]])


SETTING_TYPES = {'prepayment_percent': (int, float), 'prepayment_min_order_sum': (int, float),
                 'prepayment_cash_percent': (int, float), 'cash_commission_percent': (int, float), 'seller_identity_check': (bool,),
                 'large_object_area': (int, float),
                 'bypass_check_days': (int,), 'order_payment_ttl_minutes': (int,), 'max_open_unpaid_orders': (int,),
                 'delivery_cost_max': (int, float), 'ai_daily_calls_per_user': (int,), 'ai_daily_calls_total': (int,),
                 'phone_reveals_per_day': (int,), 'support_phone': (str,), 'support_telegram': (str,), 'support_email': (str,)}


class Settings(AdminBase):
    required_perm = 'settings'

    def get(self, request):
        return Response({k: Setting.get(k) for k in SETTING_TYPES})

    def put(self, request):
        for k, v in request.data.items():
            types = SETTING_TYPES.get(k)
            if not types or not isinstance(v, types) or (types != (bool,) and isinstance(v, bool)):
                return Response({'error': 'invalid_request', 'field': k}, status=400)
            if types == (str,):
                if len(v) > 100:
                    return Response({'error': 'invalid_request', 'field': k}, status=400)
            elif types != (bool,) and not 0 <= v <= (100 if 'percent' in k or k == 'vat_rate' else 10**12):
                return Response({'error': 'invalid_request', 'field': k}, status=400)
        before = {k: Setting.get(k) for k in request.data}
        for k, v in request.data.items():
            Setting.objects.update_or_create(key=k, defaults={'value': v})
        changed = [k for k in request.data if before[k] != request.data[k]]
        audit(request, 'settings_changed', fields=list(request.data.keys()),
              before={k: before[k] for k in changed}, after={k: request.data[k] for k in changed})
        return Response({k: Setting.get(k) for k in SETTING_TYPES})


class AdminOrders(AdminBase):
    required_perm = 'orders'

    def get(self, request):
        return Response([{'id': o.id, 'status': o.status, 'client_id': o.client_id, 'total': str(o.total),
                          'amount_paid': str(o.amount_paid), 'payment_mode': o.payment_mode, 'prepayment': str(o.prepayment),
                          'created_at': o.created_at} for o in Order.objects.order_by('-id')[:200]])


class AdminRefund(AdminBase):
    required_perm = 'refunds'

    def post(self, request, pk):
        try:
            r = osvc.refund_order(pk, request.data.get('fault'), request.user)
        except Order.DoesNotExist:
            return Response(status=404)
        except osvc.OrderError as e:
            return Response({'error': e.code}, status=400)
        audit(request, 'refund_processed', object_type='order', object_id=pk, fault=r.fault, amount=str(r.amount))
        return Response({'amount': str(r.amount), 'due_by': r.due_by, 'reserve_until': r.reserve_until})


class Payouts(AdminBase):
    required_perm = 'finance'

    def get(self, request):
        return Response([{'id': p.id, 'seller_id': p.seller_id, 'amount': str(p.amount), 'status': p.status}
                         for p in PayoutRequest.objects.order_by('-id')[:200]])

    @transaction.atomic
    def post(self, request, pk):
        p = get_object_or_404(PayoutRequest.objects.select_for_update(), pk=pk, status='requested')
        action = request.data.get('action')
        if action == 'pay':
            # the payable may already have been paid deal by deal from the accounting section: never pay twice.
            # The seller row is locked so two finance staff paying different requests cannot both pass.
            total, _ = osvc.locked_balance(p.seller_id)
            if total < p.amount:
                return Response({'error': 'insufficient_funds'}, status=400)
            SellerLedger.objects.create(seller=p.seller, kind='payout', amount=-p.amount)
            p.status = 'paid'
        elif action == 'reject':
            p.status = 'rejected'
        else:
            return Response({'error': 'invalid_request'}, status=400)
        p.save(update_fields=['status'])
        audit(request, f'payout_{p.status}', object_type='payout', object_id=p.id)
        return Response({'ok': True})


class AIUsageView(AdminBase):
    required_perm = 'finance'

    def get(self, request):
        rows = AIUsage.objects.values('provider', 'kind').annotate(n=Count('id'), tin=Sum('tokens_in'),
                                                                 tout=Sum('tokens_out'))
        return Response(list(rows))


class Legal(AdminBase):
    required_perm = 'documents'

    def post(self, request):
        d = request.data
        try:
            doc = LegalDocument.objects.create(
                slug=d['slug'], version=int(d.get('version', 1)), effective_from=d['effective_from'],
                **{f'{p}_{l}': str(d[f'{p}_{l}']) for p in ('title', 'body') for l in ('uz', 'ru', 'en')})
        except (KeyError, ValueError, Exception):
            return Response({'error': 'invalid_request'}, status=400)
        audit(request, 'legal_document_created', object_type='legal', object_id=doc.id)
        return Response({'id': doc.id}, status=201)


class AdminCategories(AdminBase):
    required_perm = 'catalog'

    def post(self, request):
        d = request.data
        try:
            parent = Category.objects.filter(slug=d.get('parent')).first() if d.get('parent') else None
            c = Category.objects.create(slug=d['slug'], parent=parent, name_uz=d['name_uz'], name_ru=d['name_ru'],
                                        name_en=d['name_en'])
        except (KeyError, Exception):
            return Response({'error': 'invalid_request'}, status=400)
        return Response({'id': c.id}, status=201)


class AdminNorms(AdminBase):
    required_perm = 'catalog'

    def get(self, request):
        return Response([{'id': n.id, 'object_type': n.object_type, 'zone': n.zone, 'category': n.category.slug,
                          'per_m2': str(n.per_m2), 'unit': n.unit, 'source': n.source, 'reviewed': n.reviewed}
                         for n in ConsumptionNorm.objects.select_related('category')[:500]])

    def patch(self, request):
        n = get_object_or_404(ConsumptionNorm, pk=request.data.get('id'))
        try:
            if 'per_m2' in request.data:
                n.per_m2 = Decimal(str(request.data['per_m2']))
                if n.per_m2 <= 0:
                    raise InvalidOperation
                n.source = 'staff'
        except InvalidOperation:
            return Response({'error': 'invalid_request'}, status=400)
        if 'reviewed' in request.data:
            n.reviewed = bool(request.data['reviewed'])
        n.save()
        return Response({'ok': True})


class AdminCategoryDescribe(AdminBase):
    """AI drafts the 3-language description; it stays hidden (reviewed=False) until staff approves it."""
    required_perm = 'catalog'

    def post(self, request, slug):
        from apps.ai import service as ai
        c = get_object_or_404(Category, slug=slug)
        try:
            d = ai.describe_category({'uz': c.name_uz, 'ru': c.name_ru, 'en': c.name_en}, user=request.user)
        except ai.AIUnavailable:
            return Response({'error': 'ai_unavailable'}, status=503)
        except (ValueError, KeyError):
            return Response({'error': 'invalid_request'}, status=502)
        c.description_uz, c.description_ru, c.description_en = d['uz'], d['ru'], d['en']
        c.description_reviewed = False
        c.save()
        audit(request, 'category_described_ai', object_type='category', object_id=c.id)
        return Response({**d, 'reviewed': False})


class AdminCategoryText(AdminBase):
    """Staff reads, edits and approves the description. Only reviewed text is ever shown publicly."""
    required_perm = 'catalog'

    def get(self, request, slug):
        c = get_object_or_404(Category, slug=slug)
        return Response({'uz': c.description_uz, 'ru': c.description_ru, 'en': c.description_en,
                         'reviewed': c.description_reviewed})

    def patch(self, request, slug):
        c = get_object_or_404(Category, slug=slug)
        for l in ('uz', 'ru', 'en'):
            if l in request.data:
                setattr(c, f'description_{l}', str(request.data[l])[:1500])
                c.description_reviewed = False       # any edit needs a fresh approval
        if 'reviewed' in request.data:
            c.description_reviewed = bool(request.data['reviewed']) and bool(c.description_ru or c.description_en)
        c.save()
        audit(request, 'category_text_updated', object_type='category', object_id=c.id, reviewed=c.description_reviewed)
        return Response({'reviewed': c.description_reviewed})
