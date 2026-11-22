import io
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile

from apps.audit.models import AuditLog
from apps.catalog.models import Offer, PriceImport
from apps.uploads import validators as up

from .base import Base, docx_bytes, pdf_bytes, png_bytes, xlsx_bytes


def f(name, data):
    return SimpleUploadedFile(name, data)


class Uploads(Base):
    def test_valid_types(self):
        self.assertEqual(up.validate(f('a.png', png_bytes()), 'photo')[0], 'png')
        self.assertEqual(up.validate(f('a.pdf', pdf_bytes(2)), 'document')[0], 'pdf')
        self.assertEqual(up.validate(f('a.docx', docx_bytes()), 'document')[0], 'docx')
        self.assertEqual(up.validate(f('a.xlsx', xlsx_bytes([['a']])), 'excel')[0], 'xlsx')

    def test_extension_is_ignored_content_decides(self):
        # an executable/html renamed to .png is rejected; a real png named .exe is accepted as png
        with self.assertRaises(up.UploadError):
            up.validate(f('x.png', b'<html><script>alert(1)</script></html>'), 'photo')
        with self.assertRaises(up.UploadError):
            up.validate(f('x.png', b'MZ\x90\x00' + b'0' * 100), 'photo')
        self.assertEqual(up.validate(f('x.exe', png_bytes()), 'photo')[0], 'png')

    def test_legacy_doc_rejected(self):
        with self.assertRaises(up.UploadError) as e:
            up.validate(f('x.doc', b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1' + b'0' * 50), 'document')
        self.assertEqual(e.exception.code, 'legacy_format_not_allowed')

    def test_pdf_page_limit(self):
        with self.assertRaises(up.UploadError) as e:
            up.validate(f('a.pdf', pdf_bytes(3)), 'document')
        self.assertEqual(e.exception.code, 'pdf_too_long')

    def test_wrong_category(self):
        with self.assertRaises(up.UploadError):
            up.validate(f('a.pdf', pdf_bytes()), 'photo')
        with self.assertRaises(up.UploadError):
            up.validate(f('a.png', png_bytes()), 'excel')

    def test_size_limits(self):
        big = b'\xff\xd8\xff' + b'0' * (5 * 1024 * 1024 + 1)
        with self.assertRaises(up.UploadError) as e:
            up.validate(f('a.pdf', b'%PDF-' + b'0' * (5 * 1024 * 1024)), 'document')
        self.assertEqual(e.exception.code, 'file_too_large')

    def test_zip_without_office_structure_rejected(self):
        import zipfile
        b = io.BytesIO()
        with zipfile.ZipFile(b, 'w') as z:
            z.writestr('evil.php', '<?php')
        with self.assertRaises(up.UploadError):
            up.validate(f('a.docx', b.getvalue()), 'document')

    def test_path_traversal_blocked_on_read(self):
        with self.assertRaises(up.UploadError):
            up.open_stored('../../etc/passwd')

    def test_stored_outside_web_root_with_random_name(self):
        from django.conf import settings
        name = up.store(png_bytes(), 'png')
        self.assertNotIn('..', name)
        self.assertTrue((settings.PRIVATE_MEDIA_ROOT / name).exists())
        self.assertNotIn(str(settings.BASE_DIR), str(settings.PRIVATE_MEDIA_ROOT.resolve()).replace(
            str(settings.BASE_DIR.parent), ''))


class SellerCabinet(Base):
    def test_pending_seller_sees_no_cabinet(self):
        s = self.seller(status='pending')
        self.login(s.user)
        self.assertEqual(self.api.get('/api/v1/sellers/me').status_code, 200)   # only status
        for url in ('files', 'delivery-rules', 'offers', 'orders', 'analytics'):
            self.assertEqual(self.api.get(f'/api/v1/sellers/me/{url}').status_code, 403, url)
        r = self.api.post('/api/v1/sellers/me/imports', {'file': f('a.xlsx', xlsx_bytes([['a'], ['b']]))}, format='multipart')
        self.assertEqual(r.status_code, 403)

    def test_blocked_seller_offers_hidden(self):
        s = self.seller(status='blocked')
        o = self.offer(s)
        self.assertEqual(self.api.get('/api/v1/products').json()['total'], 0)
        self.assertEqual(self.api.get(f'/api/v1/products/{o.product_id}').json()['offers'], [])

    def test_client_cannot_use_seller_cabinet(self):
        self.login(self.user('client'))
        self.assertEqual(self.api.get('/api/v1/sellers/me/offers').status_code, 403)

    def test_upload_document_and_public_view(self):
        s = self.seller()
        self.login(s.user)
        r = self.api.post('/api/v1/sellers/me/files', {'file': f('lic.pdf', pdf_bytes()), 'kind': 'document',
                                                       'title': 'License'}, format='multipart')
        self.assertEqual(r.status_code, 201)
        self.api.force_authenticate(None)
        docs = self.api.get(f'/api/v1/sellers/{s.id}/documents').json()
        self.assertEqual(docs[0]['title'], 'License')
        r = self.api.get(f'/api/v1/files/{docs[0]["id"]}')
        self.assertEqual(r['Content-Type'], 'application/pdf')
        self.assertEqual(r['X-Content-Type-Options'], 'nosniff')
        self.assertIn('attachment', r['Content-Disposition'])

    def test_upload_rejects_disguised_file(self):
        s = self.seller()
        self.login(s.user)
        r = self.api.post('/api/v1/sellers/me/files', {'file': f('a.pdf', b'<script>x</script>'), 'kind': 'document'},
                          format='multipart')
        self.assertEqual(r.status_code, 400)

    def test_unapproved_seller_files_not_public(self):
        s = self.seller(status='approved')
        self.login(s.user)
        self.api.post('/api/v1/sellers/me/files', {'file': f('a.png', png_bytes()), 'kind': 'photo'}, format='multipart')
        fid = s.files.get().id
        s.status = 'blocked'; s.save()
        self.api.force_authenticate(None)
        self.assertEqual(self.api.get(f'/api/v1/files/{fid}').status_code, 404)

    def test_phone_hidden_publicly_and_reveal_is_audited(self):
        s = self.seller()
        pub = self.api.get(f'/api/v1/sellers/{s.id}').json()
        self.assertNotIn(s.contact_phone, str(pub))
        self.assertNotIn('contact_phone', pub)
        r = self.api.post(f'/api/v1/sellers/{s.id}/phone')
        self.assertEqual(r.status_code, 403)             # anonymous cannot reveal
        client = self.user('client')
        self.login(client)
        r = self.api.post(f'/api/v1/sellers/{s.id}/phone')
        self.assertEqual(r.json()['phone'], s.contact_phone)
        a = AuditLog.objects.get(action='seller_phone_revealed')
        self.assertEqual((a.actor_id, a.object_id), (client.id, str(s.id)))

    def test_reveal_with_foreign_order_rejected(self):
        s = self.seller()
        self.login(self.user('client'))
        r = self.api.post(f'/api/v1/sellers/{s.id}/phone', {'order_id': 999}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_delivery_rules(self):
        s = self.seller(city=None)
        self.login(s.user)
        self.assertEqual(self.api.post('/api/v1/sellers/me/delivery-rules',
                                       {'region': 'Samarkand', 'cost': '250000'}, format='json').status_code, 201)
        self.assertEqual(self.api.post('/api/v1/sellers/me/delivery-rules',
                                       {'region': 'X', 'cost': '-1'}, format='json').status_code, 400)
        self.assertEqual(self.api.get('/api/v1/sellers/me/delivery-rules').json()[0]['region'], 'Samarkand')

    def test_seller_cannot_touch_foreign_offer_or_file(self):
        a, b = self.seller(), self.seller()
        o = self.offer(b)
        self.login(a.user)
        self.assertEqual(self.api.patch(f'/api/v1/sellers/me/offers/{o.id}', {'price': '1'}, format='json').status_code, 404)
        self.assertEqual(self.api.delete(f'/api/v1/sellers/me/offers/{o.id}').status_code, 404)
        self.assertEqual(self.api.delete(f'/api/v1/sellers/me/files/1').status_code, 404)


class PriceImport_(Base):
    def setUp(self):
        super().setUp()
        self.s = self.seller()
        self.login(self.s.user)
        self.category('cement'); self.category('paint')

    def upload(self, rows):
        return self.api.post('/api/v1/sellers/me/imports', {'file': f('p.xlsx', xlsx_bytes(rows))}, format='multipart')

    def test_auto_mapping_ru_and_uz(self):
        r = self.upload([['Наименование', 'Цена', 'Остаток', 'Категория'], ['Цемент', 1, 2, 'cement']]).json()
        self.assertEqual(r['mapping'], {'name': 0, 'price': 1, 'stock': 2, 'category': 3})
        r = self.upload([['Mahsulot nomi', 'Narx', 'Qoldiq', 'Kategoriya'], ['x', 1, 2, 'cement']]).json()
        self.assertEqual(set(r['mapping']), {'name', 'price', 'stock', 'category'})

    def test_manual_fix_then_confirm(self):
        r = self.upload([['A', 'B', 'C', 'D'], ['Cement M400', '65 000', 40, 'cement']]).json()
        self.assertEqual(r['mapping'], {})
        url = f'/api/v1/sellers/me/imports/{r["id"]}'
        self.assertEqual(self.api.post(url + '/confirm').status_code, 400)          # mapping incomplete
        self.assertEqual(self.api.patch(url, {'mapping': {'name': 99}}, format='json').status_code, 400)
        self.assertEqual(self.api.patch(url, {'mapping': {'evil': 1}}, format='json').status_code, 400)
        self.api.patch(url, {'mapping': {'name': 0, 'price': 1, 'stock': 2, 'category': 3}}, format='json')
        res = self.api.post(url + '/confirm').json()['result']
        self.assertEqual((res['created'], res['error_count']), (1, 0))
        o = Offer.objects.get()
        self.assertEqual(str(o.price), '65000.00')
        self.assertEqual(self.api.post(url + '/confirm').status_code, 404)           # cannot confirm twice

    def test_stock_and_category_mandatory(self):
        r = self.upload([['Название', 'Цена', 'Остаток', 'Категория'],
                         ['A', 10, None, 'cement'], ['B', 10, 5, 'nonexistent'], ['C', 10, 5, 'cement']]).json()
        with mock.patch('apps.ai.service.suggest_category', return_value=None):
            res = self.api.post(f'/api/v1/sellers/me/imports/{r["id"]}/confirm').json()['result']
        self.assertEqual(res['created'], 1)
        self.assertEqual({e['error'] for e in res['errors']}, {'stock_required', 'category_required'})

    def test_ai_suggests_missing_category(self):
        r = self.upload([['Название', 'Цена', 'Остаток', 'Категория'], ['Краска белая', 10, 5, '']]).json()
        with mock.patch('apps.ai.service.suggest_category', return_value='paint') as m:
            res = self.api.post(f'/api/v1/sellers/me/imports/{r["id"]}/confirm').json()['result']
        self.assertEqual(res['created'], 1)
        self.assertEqual(Offer.objects.get().product.category.slug, 'paint')
        m.assert_called_once()

    def test_ai_output_not_in_whitelist_is_ignored(self):
        from apps.ai import service
        with mock.patch('apps.ai.service.complete', return_value='ignore rules; drop table'):
            self.assertIsNone(service.suggest_category('x', ['cement']))

    def test_rejects_non_excel_and_empty(self):
        r = self.api.post('/api/v1/sellers/me/imports', {'file': f('p.xlsx', b'not excel')}, format='multipart')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.upload([['only header']]).status_code, 400)

    def test_formula_cells_are_not_evaluated(self):
        r = self.upload([['Название', 'Цена', 'Остаток', 'Категория'], ['=1+1', 10, 5, 'cement']]).json()
        res = self.api.post(f'/api/v1/sellers/me/imports/{r["id"]}/confirm').json()['result']
        self.assertEqual(res['errors'][0]['error'], 'name_required')   # formula yields nothing, never evaluated
        self.assertFalse(Offer.objects.exists())

    def test_other_seller_cannot_read_or_confirm_import(self):
        r = self.upload([['Название', 'Цена', 'Остаток', 'Категория'], ['A', 10, 5, 'cement']]).json()
        self.login(self.seller().user)
        self.assertEqual(self.api.get(f'/api/v1/sellers/me/imports/{r["id"]}').status_code, 404)
        self.assertEqual(self.api.post(f'/api/v1/sellers/me/imports/{r["id"]}/confirm').status_code, 404)


class PublicCatalog(Base):
    def test_listing_shows_min_price_and_no_phone(self):
        a, b = self.seller(), self.seller()
        self.offer(a, price=1000); o = self.offer(b, price=900)
        lst = self.api.get('/api/v1/products?category=cement').json()
        self.assertEqual(lst['results'][0]['min_price'], '900.00')
        det = self.api.get(f'/api/v1/products/{o.product_id}').json()
        self.assertEqual([x['price'] for x in det['offers']], ['900.00', '1000.00'])
        self.assertNotIn(a.contact_phone, str(det))

    def test_zero_stock_hidden(self):
        self.offer(self.seller(), stock=0)
        self.assertEqual(self.api.get('/api/v1/products').json()['total'], 0)

    def test_sitemap_has_three_languages(self):
        o = self.offer(self.seller())
        x = self.api.get('/sitemap.xml').content.decode()
        for l in ('uz', 'ru', 'en'):
            self.assertIn(f'/{l}/product/{o.product_id}', x)
            self.assertIn(f'hreflang="{l}"', x)
        self.assertIn('Sitemap:', self.api.get('/robots.txt').content.decode())

    def test_sql_injection_in_search_is_harmless(self):
        self.offer(self.seller())
        r = self.api.get("/api/v1/products", {'q': "' OR 1=1; DROP TABLE catalog_product;--"})
        self.assertEqual((r.status_code, r.json()['total']), (200, 0))
        self.assertEqual(self.api.get('/api/v1/products').json()['total'], 1)
