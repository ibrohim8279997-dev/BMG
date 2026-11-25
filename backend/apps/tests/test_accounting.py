"""Agent-scheme accounting: amounts, rounding, VAT on/off, documents, storno, payouts, reconciliation, access."""
from datetime import timedelta
from decimal import Decimal

import pyotp
from django.test import override_settings
from django.utils import timezone

from apps.accounting import deals as dsvc
from apps.accounting import documents as docs
from apps.accounting import reconcile
from apps.accounting.models import Deal, Discrepancy, Document, FrozenError
from apps.accounting.money import allocate, percent_of, to_sum, vat_inside, vat_on_top
from apps.accounts.models import StaffMembership, StaffRole, TotpDevice, User
from apps.audit.models import AuditLog
from apps.core.models import Setting
from apps.orders import services as osvc
from apps.orders.models import Order, SellerLedger
from apps.payments import wallet

from .base import Base
from .test_admin_calc_ai import PW

BMG = {'bmg_name': 'BMG LLC', 'bmg_inn': '300000001', 'bmg_bank_account': '20208000000000000009', 'bmg_bank_mfo': '00014'}


def setting(**kw):
    for k, v in kw.items():
        Setting.objects.update_or_create(key=k, defaults={'value': v})


class Money(Base):
    def test_one_rounding_rule_half_up_integers(self):
        self.assertEqual([to_sum('0.5'), to_sum('1.49'), to_sum('2.5'), to_sum('-0.5')], [1, 1, 3, -1])
        self.assertEqual(percent_of(333, 3), 10)               # 9.99 -> 10
        self.assertEqual(percent_of(50, 3), 2)                 # 1.5 -> 2
        self.assertEqual(vat_on_top(1000, 12), 120)
        self.assertEqual(vat_inside(1120, 12), 120)
        self.assertIsInstance(percent_of(101, '3.33'), int)
        with self.assertRaises(TypeError):
            to_sum(1.5)                                        # no floats for money

    def test_allocation_adds_up(self):
        for total, w in ((100, [1, 1, 1]), (5050, [101000, 3]), (7, [0, 0, 5]), (0, [1, 2])):
            self.assertEqual(sum(allocate(total, w)), total)
        self.assertEqual(allocate(100, [1, 1, 1]), [34, 33, 33])

    def test_compute_without_and_with_vat(self):
        c = dsvc.compute(100000, 1000, 101000, Decimal('3'), False, False, 12)
        self.assertEqual((c['commission'], c['commission_vat'], c['payout'], c['total']), (3000, 0, 98000, 101000))
        c = dsvc.compute(100000, 1000, 101000, Decimal('3'), True, True, 12)
        self.assertEqual((c['commission'], c['commission_vat'], c['payout']), (3000, 360, 97640))
        self.assertEqual(c['seller_vat'], 10821)               # 101000 x 12 / 112 = 10821.43


class FlowBase(Base):
    def setUp(self):
        super().setUp()
        setting(**BMG)
        self.s = self.seller(delivery=1000)
        self.s.inn, self.s.bank_account, self.s.bank_mfo = '200000002', '20208000000000000001', '00014'
        self.s.contract_number, self.s.contract_date = 'A-1', timezone.localdate()
        self.s.save()
        self.offer_ = self.offer(self.s, price=10000, stock=50)
        self.c = self.user()
        self.staff = self.user('staff')

    def paid(self, qty=10, mode='full', buyer=None):
        self.login(self.c)
        self.api.post('/api/v1/cart', {'offer_id': self.offer_.id, 'qty': qty}, format='json')
        o = osvc.create_order(self.c, 'Tashkent', mode, buyer)
        wallet.change(self.c, Decimal('1000000'), 'topup')
        return osvc.pay_order(self.c, o.id)

    def delivered(self, **kw):
        o = self.paid(**kw)
        osvc.fulfill(o.id, self.s)
        return Deal.objects.get(order=o)


class Flow(FlowBase):
    def test_payment_fixes_the_deal_without_vat(self):
        d = Deal.objects.get(order=self.paid())
        self.assertEqual((d.status, d.goods, d.delivery, d.total, d.held), ('paid', 100000, 1000, 101000, 101000))
        self.assertEqual((d.commission, d.commission_vat, d.vat_rate, d.payout), (3000, 0, Decimal('0'), 98000))
        self.assertEqual(d.parties['client'], {'type': 'individual', 'inn': '', 'name': ''})
        setting(default_commission_percent=7, bmg_vat_payer=True)      # later setting changes never touch it
        d.refresh_from_db()
        self.assertEqual(d.commission, 3000)
        d.commission = 1
        with self.assertRaises(FrozenError):
            d.save()

    def test_vat_switch_with_start_date(self):
        setting(bmg_vat_payer=True, bmg_vat_from=(timezone.localdate() + timedelta(days=1)).isoformat())
        self.assertEqual(Deal.objects.get(order=self.paid()).commission_vat, 0)          # not yet in force
        setting(bmg_vat_from=timezone.localdate().isoformat())
        d = Deal.objects.get(order=self.paid())
        self.assertEqual((d.commission_vat, d.vat_rate, d.payout), (360, Decimal('12'), 101000 - 3000 - 360))
        setting(bmg_vat_payer=False)
        self.assertEqual(Deal.objects.get(order=self.paid()).commission_vat, 0)

    def test_seller_ledger_gets_the_fixed_payout(self):
        setting(bmg_vat_payer=True, bmg_vat_from='2020-01-01')
        d = self.delivered()
        self.assertEqual(d.status, 'delivered')
        self.assertFalse(SellerLedger.objects.filter(kind='sale').exists())   # the seller's own word credits nothing
        dsvc.confirm(d.id, self.staff)                                          # a human confirms delivery
        self.assertEqual(SellerLedger.objects.get(kind='sale').amount, Decimal(d.payout))

    def test_cash_mode_holds_only_the_prepayment(self):
        d = Deal.objects.get(order=self.paid(mode='cash'))
        self.assertEqual((d.held, d.commission, d.payout), (5050, 3000, 2050))

    def test_seller_without_confirmed_contract_gets_no_orders(self):
        self.s.contract_status = 'pending'
        self.s.save()
        self.login(self.c)
        self.api.post('/api/v1/cart', {'offer_id': self.offer_.id, 'qty': 1}, format='json')
        with self.assertRaises(osvc.OrderError):
            osvc.create_order(self.c, 'Tashkent', 'full')

    def test_legal_buyer_requisites(self):
        with self.assertRaises(osvc.OrderError):
            self.paid(buyer={'type': 'legal', 'inn': '12', 'name': 'X'})
        d = Deal.objects.get(order=self.paid(buyer={'type': 'legal', 'inn': '123456789', 'name': 'Qurilish LLC'}))
        self.assertEqual(d.parties['client'], {'type': 'legal', 'inn': '123456789', 'name': 'Qurilish LLC'})

    def test_confirm_issues_numbered_documents(self):
        d1, d2 = self.delivered(), self.delivered(qty=3)
        dsvc.confirm(d1.id, self.staff)
        dsvc.confirm(d2.id, self.staff)
        inv = Document.objects.filter(kind='commission').order_by('id')
        self.assertEqual([i.number for i in inv], ['KI-000001', 'KI-000002'])
        self.assertEqual((inv[0].base, inv[0].vat, inv[0].total, inv[0].status), (3000, 0, 3000, 'posted'))
        sf = Document.objects.get(kind='seller_inv', deal=d1)
        self.assertEqual((sf.status, sf.total), ('draft', 101000))
        with self.assertRaises(dsvc.DealError):
            dsvc.confirm(d1.id, self.staff)                                      # not twice

    def test_mismatch_blocks_the_document_and_the_confirmation(self):
        d = self.delivered()
        setting(bmg_inn='')
        with self.assertRaises(docs.DocumentMismatch) as e:
            dsvc.confirm(d.id, self.staff)
        self.assertIn('bmg.inn_invalid', e.exception.problems)
        d.refresh_from_db()
        self.assertEqual((d.status, Document.objects.count()), ('delivered', 0))   # rolled back as a whole
        setting(bmg_inn=BMG['bmg_inn'])
        self.s.inn = '999999999'
        self.s.save()                                                            # seller changed INN after the deal
        with self.assertRaises(docs.DocumentMismatch) as e:
            dsvc.confirm(d.id, self.staff)
        self.assertIn('seller.inn_changed_since_deal', e.exception.problems)

    def test_posted_documents_are_frozen_and_never_deleted(self):
        d = self.delivered()
        dsvc.confirm(d.id, self.staff)
        inv = Document.objects.get(kind='commission')
        inv.total = 1
        with self.assertRaises(FrozenError):
            inv.save()
        with self.assertRaises(FrozenError):
            Document.objects.get(kind='commission').delete()

    def test_refund_is_a_storno_not_a_deletion(self):
        setting(bmg_vat_payer=True, bmg_vat_from='2020-01-01')
        d = self.delivered()
        dsvc.confirm(d.id, self.staff)
        osvc.refund_order(d.order_id, 'seller', self.staff)
        d.refresh_from_db()
        self.assertEqual(d.status, 'refunded')
        inv = Document.objects.get(kind='commission')
        st = Document.objects.get(kind='storno')
        self.assertEqual((inv.status, st.reverses_id, st.base, st.vat, st.total), ('reversed', inv.id, -3000, -360, -3360))
        self.assertEqual(Document.objects.get(kind='seller_inv').status, 'reversed')   # draft just closed
        self.assertEqual(st.number, 'ST-000001')

    def test_payout_only_after_confirmation_and_by_a_human(self):
        d = self.delivered()
        with self.assertRaises(dsvc.DealError):
            dsvc.mark_paid_out([d.id], self.staff, 'PP-1')                     # not confirmed yet
        dsvc.confirm(d.id, self.staff)
        with self.assertRaises(dsvc.DealError):
            dsvc.mark_paid_out([d.id], self.staff, '')                         # bank reference is required
        reg = dsvc.mark_paid_out([d.id], self.staff, 'PP-1')
        d.refresh_from_db()
        self.assertEqual((d.status, d.payout_ref, reg.kind, reg.total), ('paid_out', 'PP-1', 'registry', 98000))
        from django.db.models import Sum
        self.assertEqual(SellerLedger.objects.filter(seller=self.s).aggregate(s=Sum('amount'))['s'], 0)

    def test_deal_cannot_be_paid_twice_via_request_and_registry(self):
        from apps.orders.models import PayoutRequest
        d = self.delivered()
        dsvc.confirm(d.id, self.staff)                                          # payable credited: 98000
        p = PayoutRequest.objects.create(seller=self.s, amount=Decimal(d.payout))
        with self.assertRaises(dsvc.DealError):                                 # pending request already claims it
            dsvc.mark_paid_out([d.id], self.staff, 'PP-2')
        p.status = 'paid'; p.save()
        SellerLedger.objects.create(seller=self.s, kind='payout', amount=-Decimal(d.payout))
        with self.assertRaises(dsvc.DealError) as e:                            # paid through the request: never again
            dsvc.mark_paid_out([d.id], self.staff, 'PP-2')
        self.assertEqual(e.exception.code, 'already_paid_out')

    def test_agent_act_per_period(self):
        for _ in range(2):
            dsvc.confirm(self.delivered(qty=1).id, self.staff)
        today = timezone.localdate()
        act = docs.agent_act(self.s, today.replace(day=1), today, self.staff)
        self.assertEqual((act.base, len(act.payload['lines'])), (600, 2))
        with self.assertRaises(docs.DocumentMismatch):
            docs.agent_act(self.s, today.replace(day=1), today, self.staff)     # period already acted

    def test_reconciliation_flags_mismatches(self):
        o = self.paid()
        self.assertEqual(reconcile.run(), 0)
        Order.objects.filter(pk=o.pk).update(amount_paid=Decimal('100'))
        self.assertGreater(reconcile.run(), 0)
        self.assertTrue(Discrepancy.objects.filter(kind='order_paid_vs_due').exists())
        n = Discrepancy.objects.count()
        reconcile.run()
        self.assertEqual(Discrepancy.objects.count(), n)                        # idempotent


@override_settings(ADMIN_ALLOWED_IPS=['10.0.0.1'])
class AdminApi(FlowBase):
    def admin(self, superuser=True, perms=()):
        u = User.objects.create_user(f'st{self._n}{len(perms)}{superuser}', password=PW, is_staff=True,
                                     is_superuser=superuser, role='staff')
        self._n += 1
        if not superuser:
            StaffMembership.objects.create(user=u, role=StaffRole.objects.create(name=f'r{u.id}', permissions=list(perms)))
        sec = pyotp.random_base32()
        TotpDevice.objects.create(user=u, secret=sec)
        self.api.force_authenticate(None)
        self.api.post('/admin-api/login', {'username': u.username, 'password': PW, 'otp': pyotp.TOTP(sec).now()},
                      format='json', REMOTE_ADDR='10.0.0.1')
        return u

    def call(self, method, url, data=None):
        return getattr(self.api, method)(url, data or {}, format='json', REMOTE_ADDR='10.0.0.1')

    def test_access_is_checked_on_the_server(self):
        self.admin(superuser=False, perms=['finance'])
        self.assertEqual(self.call('get', '/admin-api/accounting/overview').status_code, 403)
        self.assertEqual(self.call('post', '/admin-api/roles', {'name': 'x', 'permissions': ['accounting']}).status_code, 403)
        self.admin(superuser=False, perms=['accounting'])
        self.assertEqual(self.call('get', '/admin-api/accounting/overview').status_code, 200)

    def test_confirm_pay_export_flow_with_audit(self):
        d = self.delivered()
        self.admin()
        r = self.call('post', f'/admin-api/accounting/deals/{d.id}/confirm')
        self.assertEqual((r.status_code, r.json()['status']), (200, 'confirmed'))
        ov = self.call('get', '/admin-api/accounting/overview').json()
        self.assertEqual((ov['summary']['commission'], ov['summary']['turnover'], ov['attention']['to_pay_out']), (3000, 101000, 1))
        docs_ = self.call('get', '/admin-api/accounting/documents?kind=commission').json()
        self.assertEqual(len(docs_), 1)
        pdf = self.call('get', f'/admin-api/accounting/documents/{docs_[0]["id"]}/pdf')
        self.assertEqual((pdf.status_code, pdf.content[:4]), (200, b'%PDF'))
        ej = self.call('get', f'/admin-api/accounting/documents/{docs_[0]["id"]}/einvoice').json()
        self.assertEqual((ej['amounts']['total'], ej['supplier']['inn']), (3000, BMG['bmg_inn']))
        self.assertEqual(self.call('get', '/admin-api/accounting/export/xlsx').content[:2], b'PK')
        self.assertEqual(self.call('get', '/admin-api/accounting/export/pdf').content[:4], b'%PDF')
        r = self.call('post', '/admin-api/accounting/payouts', {'deal_ids': [d.id], 'bank_ref': 'PP-7'})
        self.assertEqual(r.status_code, 201)
        self.assertTrue(AuditLog.objects.filter(action='payout_registry_posted').exists())

    def test_storno_needs_a_reason(self):
        d = self.delivered()
        dsvc.confirm(d.id, self.staff)
        self.admin()
        inv = Document.objects.get(kind='commission')
        self.assertEqual(self.call('post', f'/admin-api/accounting/documents/{inv.id}/storno').status_code, 400)
        r = self.call('post', f'/admin-api/accounting/documents/{inv.id}/storno', {'reason': 'ошибка'})
        self.assertEqual((r.status_code, r.json()['number']), (200, 'ST-000001'))
        self.assertEqual(self.call('post', f'/admin-api/accounting/documents/{inv.id}/storno', {'reason': 'x'}).status_code, 400)

    def test_settings_validated_and_audited_with_before_after(self):
        self.admin()
        self.assertEqual(self.call('put', '/admin-api/accounting/settings', {'bmg_vat_payer': True, 'bmg_vat_from': ''}).status_code, 400)
        self.assertEqual(self.call('put', '/admin-api/accounting/settings', {'bmg_inn': '12'}).status_code, 400)
        self.assertEqual(self.call('put', '/admin-api/accounting/settings', {'vat_rate': 150}).status_code, 400)
        r = self.call('put', '/admin-api/accounting/settings', {'bmg_vat_payer': True, 'bmg_vat_from': '2026-06-01'})
        self.assertEqual(r.status_code, 200)
        log = AuditLog.objects.get(action='accounting_settings_changed')
        self.assertEqual((log.meta['before']['bmg_vat_payer'], log.meta['after']['bmg_vat_payer']), (False, True))

    def test_contract_confirmation_needs_requisites(self):
        self.admin()
        s = self.seller()
        self.assertEqual(self.call('patch', f'/admin-api/accounting/sellers/{s.id}', {'contract_status': 'confirmed'}).status_code, 400)
        r = self.call('patch', f'/admin-api/accounting/sellers/{s.id}', {'inn': '123456789', 'contract_number': 'A-9',
                                                                          'contract_date': '2026-11-01', 'vat_payer': True})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.call('patch', f'/admin-api/accounting/sellers/{s.id}', {'contract_status': 'confirmed'}).json()['contract_status'], 'confirmed')
        self.assertEqual(self.call('patch', f'/admin-api/accounting/sellers/{s.id}', {'inn': 'abc'}).status_code, 400)

    def test_vat_threshold_warning(self):
        setting(brv_value=1, vat_threshold_brv=3500)
        self.paid()                                     # commission 3000 of 3500 -> 85.7 %
        self.admin()
        t = self.call('get', '/admin-api/accounting/overview').json()['threshold']
        self.assertEqual((t['turnover'], t['level']), (3000, 'near'))

    def test_seller_confirms_own_invoice_data_only(self):
        d = self.delivered()
        dsvc.confirm(d.id, self.staff)
        sf = Document.objects.get(kind='seller_inv')
        other = self.seller()
        self.login(other.user)
        self.assertEqual(self.api.post(f'/api/v1/sellers/me/invoices/{sf.id}/confirm').status_code, 404)
        self.login(self.s.user)
        self.assertEqual(len(self.api.get('/api/v1/sellers/me/invoices').json()), 1)
        self.assertEqual(self.api.post(f'/api/v1/sellers/me/invoices/{sf.id}/confirm').json()['status'], 'posted')

    def test_start_page_overview_respects_permissions(self):
        self.admin(superuser=False, perms=['support'])
        ov = self.call('get', '/admin-api/overview').json()
        self.assertIn('complaints_new', ov)
        self.assertNotIn('accounting', ov)
        self.admin()
        self.assertIn('vat_threshold', self.call('get', '/admin-api/overview').json())
