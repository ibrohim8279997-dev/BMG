import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const load = (l) => JSON.parse(fs.readFileSync(`src/i18n/${l}.json`, 'utf8'));
const dicts = { ru: load('ru'), uz: load('uz'), en: load('en') };

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('all three dictionaries have identical keys', () => {
  const base = Object.keys(dicts.ru).sort();
  for (const l of ['uz', 'en']) assert.deepEqual(Object.keys(dicts[l]).sort(), base, `${l} keys differ from ru`);
});

test('no empty translations and placeholders are consistent', () => {
  for (const [l, d] of Object.entries(dicts)) for (const [k, v] of Object.entries(d)) {
    assert.ok(v.trim().length > 0, `${l}.${k} is empty`);
    const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(ph(v), ph(dicts.ru[k]), `${l}.${k} placeholders differ`);
  }
});

test('every static t("key") used in code exists', () => {
  const missing = [];
  for (const f of walk('src')) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\bt\(\s*'([^']+)'/g)) if (!(m[1] in dicts.ru)) missing.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('every dynamic t(`prefix.${x}`) has entries for known values', () => {
  const expect = {
    'account.': ['wallet', 'orders', 'complaint', 'reviews'],
    'admin.tab.': ['home', 'applications', 'sellers', 'commission', 'settings', 'complaints', 'audit', 'orders', 'payouts', 'roles', 'analytics', 'quality', 'flags', 'reviews', 'content', 'reports', 'accounting', 'model', 'crm'],
    'fault.': ['client', 'seller', 'bmg'], 'files.': ['document', 'photo'],
    'home.step': ['1.t', '1.d', '2.t', '2.d', '3.t', '3.d'],
    'import.err.': ['name_required', 'price_invalid', 'stock_required', 'category_required'],
    'import.field.': ['name', 'price', 'stock', 'category', 'unit', 'cost_price'],
    'ledger.': ['topup', 'order_payment', 'refund'], 'order.mode_': ['full', 'cash'],
    'seller.tab.': ['import', 'offers', 'delivery', 'files', 'orders', 'invoices', 'analytics', 'profile'],
    'setting.': ['prepayment_percent', 'prepayment_min_order_sum', 'prepayment_cash_percent', 'cash_commission_percent', 'seller_identity_check', 'default_commission_percent', 'large_object_area', 'bypass_check_days', 'support_phone', 'support_telegram', 'support_email'],
    'status.': ['pending_payment', 'paid', 'completed', 'cancelled'], 'type.': ['apartment', 'house', 'complex'],
    'zone.': ['walls', 'floor', 'ceiling', 'roof'],
    'admin.group.': ['main', 'people', 'money', 'accounting', 'support', 'system'],
    'admin.desc.': ['home', 'sellers', 'applications', 'commission', 'quality', 'flags', 'orders', 'payouts', 'analytics', 'reports', 'model', 'accounting', 'complaints', 'reviews', 'content', 'settings', 'roles', 'audit', 'crm'],
    'admin.perm.': ['sellers', 'roles', 'support', 'audit', 'settings', 'orders', 'refunds', 'finance', 'accounting', 'documents', 'catalog'],
    'acc.sub.': ['summary', 'deals', 'documents', 'reconcile', 'parties', 'settings'],
    'acc.deal.': ['paid', 'delivered', 'confirmed', 'paid_out', 'refunded'],
    'acc.kind.': ['commission', 'seller_inv', 'act', 'registry', 'storno'], 'acc.doc.': ['draft', 'posted', 'reversed'],
    'acc.contract.': ['none', 'pending', 'confirmed', 'terminated'],
    'acc.set.': ['default_commission_percent', 'vat_rate', 'brv_value', 'vat_threshold_brv', 'bmg_name', 'bmg_inn', 'bmg_address', 'bmg_bank_name', 'bmg_bank_account', 'bmg_bank_mfo'],
    'acc.req.': ['company_name', 'inn', 'legal_address', 'bank_name', 'bank_account', 'bank_mfo', 'contract_number'],
    'crm.status.': ['pending', 'delivered', 'failed'],
  };
  const miss = [];
  for (const [p, vals] of Object.entries(expect)) for (const v of vals) if (!((p + v) in dicts.ru)) miss.push(p + v);
  assert.deepEqual(miss, []);
});

test('every backend error code has a message', () => {
  const py = fs.readFileSync('../backend/apps/tests/error_codes.txt', 'utf8').split('\n').filter(Boolean);
  const miss = py.filter((c) => !(`err.${c}` in dicts.ru));
  assert.deepEqual(miss, []);
});

test('no raw HTML injection sinks other than the audited ones', () => {
  const allowed = new Set(['src/app/[lang]/layout.tsx', 'src/app/[lang]/product/[id]/page.tsx']);
  const bad = walk('src').filter((f) => fs.readFileSync(f, 'utf8').includes('dangerouslySetInnerHTML') && !allowed.has(f));
  assert.deepEqual(bad, []);
});

test('hard-coded UI language is not used: no Cyrillic literals in components outside i18n', () => {
  const bad = [];
  for (const f of walk('src')) {
    if (f.includes('/i18n/')) continue;
    if (/[А-Яа-яЁё]/.test(fs.readFileSync(f, 'utf8'))) bad.push(f);
  }
  assert.deepEqual(bad, []);
});
