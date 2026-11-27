import json
from unittest import mock

import pyotp
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from apps.accounts.models import StaffMembership, StaffRole, TotpDevice, User
from apps.catalog import ai_import
from apps.catalog.models import Offer, PriceImport, Product
from apps.uploads import validators as up

from .base import Base, png_bytes, xlsx_bytes

PW = 'Str0ng-pass-123!'
HEAD = ['Наименование', 'Цена', 'Остаток', 'Категория']


def f(rows, name='p.xlsx'):
    return SimpleUploadedFile(name, xlsx_bytes(rows))


class SellerAiImport(Base):
    def setUp(self):
        super().setUp()
        self.s = self.seller()
        self.login(self.s.user)
        self.category('cement')

    def upload(self, rows):
        return self.api.post('/api/v1/sellers/me/imports', {'file': f(rows)}, format='multipart')

    def test_header_row_below_title_rows_is_found(self):
        r = self.upload([['Прайс-лист ООО Тест'], [], HEAD, ['Цемент', 10, 5, 'cement']]).json()
        self.assertEqual(r['header_row'], 2)          # title row and the blank row above the headers are skipped
        self.assertEqual(r['unresolved'], [])
        res = self.api.post(f'/api/v1/sellers/me/imports/{r["id"]}/confirm').json()['result']
        self.assertEqual((res['created'], res['error_count']), (1, 0))
        self.assertNotIn('product_ids', res)          # internal list is not exposed

    def test_ai_fills_only_unknown_columns_and_bad_indexes_are_dropped(self):
        answer = json.dumps({'header_row': 0, 'columns': {'name': 3, 'price': 0, 'stock': 2, 'unit': 99,
                                                          'category': 'x'}})
        with mock.patch('apps.ai.service.complete', return_value=answer):
            r = self.upload([['Товар', 'Q1', 'Q2', 'Q3'], ['Цемент', 10, 5, 'x']]).json()
        self.assertEqual(r['mapping']['name'], 0)                 # synonym wins, AI does not override
        self.assertEqual(r['mapping']['stock'], 2)                # AI filled the unknown one
        self.assertNotIn('unit', r['mapping'])                    # out of range
        self.assertNotIn('price', r['mapping'])                   # column 0 already taken
        self.assertEqual(r['unresolved'], ['price'])              # UI asks the person
        self.assertEqual(r['ai_fields'], ['stock'])

    def test_without_ai_unresolved_fields_are_listed(self):
        r = self.upload([['A', 'B', 'C'], ['x', 1, 2]]).json()
        self.assertEqual(r['unresolved'], ['name', 'price', 'stock'])
        self.assertFalse(r['ai_used'])

    def test_header_row_can_be_fixed_by_hand(self):
        r = self.upload([['junk', 'junk2'], ['Название', 'Цена'], ['a', 1]]).json()
        url = f'/api/v1/sellers/me/imports/{r["id"]}'
        self.assertEqual(self.api.patch(url, {'header_row': 9}, format='json').status_code, 400)
        r = self.api.patch(url, {'header_row': 1}, format='json').json()
        self.assertEqual(r['headers'], ['Название', 'Цена'])
        self.assertEqual(self.api.patch(url, {'seller_id': self.s.id}, format='json').status_code, 400)  # staff only

    def test_photo_search_reports_found_and_not_found(self):
        r = self.upload([HEAD, ['Цемент A', 10, 5, 'cement'], ['Цемент B', 10, 5, 'cement']]).json()
        self.api.post(f'/api/v1/sellers/me/imports/{r["id"]}/confirm')
        stored = up.store(png_bytes(), 'png')
        url = f'/api/v1/sellers/me/imports/{r["id"]}/images'
        with mock.patch('apps.catalog.ai_import.find_image', side_effect=[stored, None]) as m:
            for _ in range(5):
                res = self.api.post(url).json()['result']['images']
                if res['done']:
                    break
        self.assertEqual(m.call_count, 2)
        self.assertEqual([x['name'] for x in res['found']], ['Цемент A'])
        self.assertEqual([x['name'] for x in res['not_found']], ['Цемент B'])
        p = Product.objects.get(name='Цемент A')
        self.assertEqual(p.image_status, 'found')
        img = self.api.get(f'/api/v1/products/{p.id}/image')
        self.assertEqual((img.status_code, img['Content-Type']), (200, 'image/png'))
        self.assertEqual(self.api.get(f'/api/v1/products/{Product.objects.get(name="Цемент B").id}/image').status_code, 404)

    def test_photo_search_only_for_own_confirmed_import(self):
        r = self.upload([HEAD, ['A', 10, 5, 'cement']]).json()
        self.assertEqual(self.api.post(f'/api/v1/sellers/me/imports/{r["id"]}/images').status_code, 404)  # draft
        self.api.post(f'/api/v1/sellers/me/imports/{r["id"]}/confirm')
        self.login(self.seller().user)
        self.assertEqual(self.api.post(f'/api/v1/sellers/me/imports/{r["id"]}/images').status_code, 404)


@override_settings(ADMIN_ALLOWED_IPS=['10.0.0.1'])
class AdminSellerImport(Base):
    def setUp(self):
        super().setUp()
        self.category('cement')
        self.a = self.seller(); self.a.company_name = 'Qurilish Savdo'; self.a.inn = '301234567'; self.a.save()
        self.b = self.seller(); self.b.company_name = 'Beton Market'; self.b.save()

    def admin(self, perms=None):
        u = User.objects.create_user(f'st{self._n}', password=PW, is_staff=True, is_superuser=perms is None, role='staff')
        self._n += 1
        if perms is not None:
            StaffMembership.objects.create(user=u, role=StaffRole.objects.create(name=f'r{u.id}', permissions=perms))
        sec = pyotp.random_base32()
        TotpDevice.objects.create(user=u, secret=sec)
        self.api.post('/admin-api/login', {'username': u.username, 'password': PW, 'otp': pyotp.TOTP(sec).now()},
                      format='json', REMOTE_ADDR='10.0.0.1')

    def up(self, rows, name='p.xlsx'):
        return self.api.post('/admin-api/imports', {'file': f(rows, name)}, format='multipart', REMOTE_ADDR='10.0.0.1')

    def call(self, method, url, data=None):
        return getattr(self.api, method)(url, data or {}, format='json', REMOTE_ADDR='10.0.0.1')

    def test_seller_found_by_inn_in_file(self):
        self.admin()
        r = self.up([['Прайс', 'ИНН 301234567'], HEAD, ['Цемент', 10, 5, 'cement']]).json()
        self.assertEqual((r['seller']['id'], r['seller_by']), (self.a.id, 'inn'))
        res = self.call('post', f'/admin-api/imports/{r["id"]}/confirm').json()['result']
        self.assertEqual(res['created'], 1)
        self.assertEqual(Offer.objects.get().seller, self.a)

    def test_seller_found_by_company_name_in_file_name(self):
        self.admin()
        r = self.up([HEAD, ['Цемент', 10, 5, 'cement']], name='ООО «Beton Market» narxlar.xlsx').json()
        self.assertEqual((r['seller']['id'], r['seller_by']), (self.b.id, 'name'))

    def test_unknown_seller_is_asked_and_ai_cannot_pick_a_fake_id(self):
        self.admin()
        with mock.patch('apps.ai.service.complete', return_value='{"seller_id": 999999}'):
            r = self.up([HEAD, ['Цемент', 10, 5, 'cement']]).json()
        self.assertIsNone(r['seller'])
        url = f'/admin-api/imports/{r["id"]}'
        self.assertEqual(self.call('post', url + '/confirm').json()['error'], 'seller_required')
        self.assertEqual(self.call('patch', url, {'seller_id': 999999}).status_code, 400)
        r = self.call('patch', url, {'seller_id': self.b.id}).json()
        self.assertEqual((r['seller']['id'], r['seller_by']), (self.b.id, 'staff'))
        self.assertEqual(self.call('post', url + '/confirm').status_code, 200)
        self.assertEqual(Offer.objects.get().seller, self.b)

    def test_ai_pick_from_real_sellers_is_used(self):
        self.admin()
        with mock.patch('apps.ai.service.complete', side_effect=['{}', json.dumps({'seller_id': self.a.id})]):
            r = self.up([['Savdo Qurilish MChJ narxlari'], HEAD, ['Цемент', 10, 5, 'cement']]).json()
        self.assertEqual((r['seller']['id'], r['seller_by']), (self.a.id, 'ai'))

    def test_requires_catalog_permission_and_staff_session(self):
        self.admin(perms=['finance'])
        self.assertEqual(self.up([HEAD, ['x', 1, 1, 'cement']]).status_code, 403)
        self.admin(perms=['catalog'])
        self.assertEqual(self.up([HEAD, ['x', 1, 1, 'cement']]).status_code, 201)
        self.login(self.a.user)
        self.assertIn(self.call('get', '/admin-api/imports').status_code, (401, 403))

    def test_seller_import_not_visible_to_admin_endpoints(self):
        self.login(self.a.user)
        r = self.api.post('/api/v1/sellers/me/imports', {'file': f([HEAD, ['x', 1, 1, 'cement']])}, format='multipart').json()
        self.api.force_authenticate(None)
        self.admin()
        self.assertEqual(self.call('get', f'/admin-api/imports/{r["id"]}').status_code, 404)
        self.assertTrue(PriceImport.objects.filter(pk=r['id']).exists())


class SafeFetch(Base):
    def addr(self, ip):
        return mock.patch('socket.getaddrinfo', return_value=[(2, 1, 6, '', (ip, 443))])

    def test_only_public_https(self):
        for url in ('http://example.com/a.png', 'https://example.com:8443/a.png', 'file:///etc/passwd',
                    'https://user:pw@example.com/a.png'):
            with self.assertRaises(ai_import.FetchError):
                ai_import.safe_fetch(url)
        for ip in ('127.0.0.1', '10.1.2.3', '169.254.169.254', '::1', '192.168.0.5', '::ffff:10.0.0.1',
                   '64:ff9b::a00:1', '::127.0.0.1', '2002:7f00:1::1'):   # IPv4 hidden inside IPv6 forms
            with self.addr(ip), self.assertRaises(ai_import.FetchError):
                ai_import.safe_fetch('https://example.com/a.png')

    def test_redirect_to_internal_address_is_blocked(self):
        resp = mock.MagicMock(status=302, headers={'location': 'https://internal.local/x'})
        calls = iter([[(2, 1, 6, '', ('93.184.216.34', 443))], [(2, 1, 6, '', ('10.0.0.5', 443))]])
        with mock.patch('socket.getaddrinfo', side_effect=lambda *a, **k: next(calls)), \
                mock.patch('apps.catalog.ai_import._open', return_value=resp) as g, self.assertRaises(ai_import.FetchError):
            ai_import.safe_fetch('https://example.com/a.png')
        self.assertEqual(g.call_count, 1)

    def test_connects_to_the_validated_ip_not_a_second_lookup(self):
        resp = mock.MagicMock(status=200, headers={})
        resp.stream.return_value = [b'img']
        with self.addr('93.184.216.34') as dns, \
                mock.patch('apps.catalog.ai_import._open', return_value=resp) as g:
            self.assertEqual(ai_import.safe_fetch('https://example.com/a.png?x=1'), b'img')
        self.assertEqual(dns.call_count, 1)                       # resolved once
        g.assert_called_once_with('example.com', '/a.png?x=1', '93.184.216.34')

    def test_find_image_skips_non_images(self):
        p = Product(name='Cement', category=self.category('cement'))
        with mock.patch('apps.ai.service.complete', return_value='{"urls": ["https://a/x.png", "https://b/y.png"]}'), \
                mock.patch('apps.catalog.ai_import.safe_fetch', side_effect=[b'<html>', png_bytes()]):
            stored = ai_import.find_image(p)
        self.assertTrue(stored.endswith('.png'))
        with mock.patch('apps.ai.service.complete', return_value='{"urls": []}'):
            self.assertIsNone(ai_import.find_image(p))
