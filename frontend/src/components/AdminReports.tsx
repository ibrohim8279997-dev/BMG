'use client';
import { useCallback, useEffect, useState } from 'react';
import { ErrorText } from './Bits';
import { useLang } from './Providers';
import { api, money } from '@/lib/api';

type T = (k: string, v?: any) => string;

function useList(url: string) {
  const [rows, setRows] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api(url).then(setRows).catch((e) => setErr(e.error)), [url]);
  useEffect(() => { load(); }, [load]);
  return { rows, err, load, setErr };
}

export function Analytics({ t }: { t: T }) {
  const lang = useLang();
  const { rows, err } = useList('/admin-api/analytics/revenue');
  if (err) return <ErrorText code={err} />;
  if (!rows) return <p className="muted">…</p>;
  const max = Math.max(1, ...rows.series.map((s: any) => Number(s.revenue)));
  return (
    <>
      <div className="kpis">
        <div className="card kpi"><small>{t('admin.mrr')}</small><b>{money(rows.mrr, lang)}</b></div>
        <div className="card kpi"><small>{t('admin.arr')}</small><b>{money(rows.arr, lang)}</b></div>
        <div className="card kpi"><small>{t('admin.this_month')}</small><b>{money(rows.current_month, lang)}</b></div>
        <div className="card kpi"><small>{t('admin.growth')}</small><b>{rows.mom_growth_percent ?? '—'}</b></div>
      </div>
      <div className="card">
        <h3>{t('admin.revenue')}</h3>
        <div className="bars" role="img" aria-label={t('admin.revenue')}>
          {rows.series.map((s: any) => <div key={s.month} className="bar" title={`${s.month}: ${money(s.revenue, lang)} · ${s.orders}`} style={{ height: `${Math.max(2, (Number(s.revenue) / max) * 100)}%` }} />)}
        </div>
        <div className="bars-x">{rows.series.map((s: any) => <span key={s.month}>{s.month.slice(5)}</span>)}</div>
        <p className="muted small">{t('admin.revenue_note')}</p>
      </div>
      <div className="card table-wrap" style={{ marginTop: 16 }}>
        <h3>{t('admin.payers')}</h3>
        <table><thead><tr><th>#</th><th>{t('login.company')}</th><th>{t('admin.orders_n')}</th><th>{t('seller.commission')}</th></tr></thead>
          <tbody>{rows.sellers.map((s: any) => <tr key={s.seller_id}><td>{s.seller_id}</td><td>{s.company_name}</td><td>{s.orders}</td><td>{money(s.commission, lang)}</td></tr>)}</tbody></table>
      </div>
    </>
  );
}

export function Quality({ t }: { t: T }) {
  const [label, setLabel] = useState('');
  const { rows, err } = useList(`/admin-api/analytics/sellers${label ? `?label=${label}` : ''}`);
  return (
    <div className="card table-wrap"><ErrorText code={err} />
      <p className="muted small">{t('admin.quality_hint')}</p>
      <div className="tabs">{['', 'good', 'neutral', 'bad'].map((l) => (
        <button key={l || 'all'} className={`btn ${label === l ? 'on' : ''}`} onClick={() => setLabel(l)}>{l ? t(`admin.label.${l}`) : t('filters.all')}</button>))}</div>
      <table><thead><tr><th>#</th><th>{t('login.company')}</th><th>{t('seller.rating')}</th><th>{t('admin.orders_n')}</th><th>{t('admin.completion')}</th><th>{t('admin.faults')}</th><th>{t('admin.complaints_n')}</th><th /></tr></thead>
        <tbody>{rows?.map((s: any) => (
          <tr key={s.seller_id}><td>{s.seller_id}</td><td>{s.company_name}</td><td>{s.rating} ({s.reviews})</td><td>{s.orders}</td>
            <td>{s.completion_rate === null ? '—' : `${Math.round(s.completion_rate * 100)}%`}</td><td>{s.seller_fault_refunds}</td><td>{s.complaints}</td>
            <td><span className={`tag ${s.label === 'good' ? 'ok' : s.label === 'bad' ? 'bad' : ''}`}>{t(`admin.label.${s.label}`)}</span></td></tr>))}</tbody></table></div>
  );
}

export function Flags({ t }: { t: T }) {
  const { rows, err } = useList('/admin-api/analytics/bypass');
  return (
    <div className="card table-wrap"><ErrorText code={err} /><p className="muted small">{t('admin.flags_hint')}</p>
      {rows && rows.length === 0 && <p className="muted">{t('admin.flags_empty')}</p>}
      {rows && rows.length > 0 && <table><thead><tr><th>{t('admin.client')}</th><th>{t('admin.seller')}</th><th>{t('admin.when')}</th><th>{t('order.number')}</th><th /></tr></thead>
        <tbody>{rows.map((f: any, i: number) => (
          <tr key={i}><td>#{f.client_id}</td><td>#{f.seller_id}</td><td>{new Date(f.revealed_at).toLocaleString()}</td><td>{f.order_ids.map((o: number) => `#${o}`).join(', ')}</td>
            <td><span className="tag warn">{t(`admin.flag.${f.reason}`)}</span></td></tr>))}</tbody></table>}</div>
  );
}

export function ReviewsMod({ t }: { t: T }) {
  const { rows, err, load } = useList('/admin-api/reviews');
  async function hide(id: number, hidden: boolean) { await api(`/admin-api/reviews/${id}`, { method: 'PATCH', body: { hidden } }); load(); }
  return (
    <div className="card table-wrap"><ErrorText code={err} />
      <table><tbody>{rows?.map((r: any) => (
        <tr key={r.id}><td>#{r.id}</td><td>{t('admin.seller')} #{r.seller_id}</td><td>{'★'.repeat(r.rating)}</td>
          <td style={{ maxWidth: 360, whiteSpace: 'pre-wrap' }}>{r.text}</td><td>{r.hidden && <span className="tag bad">{t('admin.hidden')}</span>}</td>
          <td><button className="btn ghost small" onClick={() => hide(r.id, !r.hidden)}>{r.hidden ? t('admin.show') : t('admin.hide')}</button></td></tr>))}</tbody></table></div>
  );
}

/** AI drafts the 3-language category text; it stays hidden until a staff member reads, fixes and approves it. */
export function Content({ t }: { t: T }) {
  const lang = useLang();
  const { rows: cats } = useList(`/api/v1/categories?lang=${lang}`);
  const [slug, setSlug] = useState('');
  const [txt, setTxt] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = useCallback(async (s: string) => { setSlug(s); setErr(null); setTxt(s ? await api(`/admin-api/categories/${s}`) : null); }, []);
  async function generate() {
    setBusy(true); setErr(null);
    try { await api(`/admin-api/categories/${slug}/describe`, { body: {} }); setTxt(await api(`/admin-api/categories/${slug}`)); }
    catch (e: any) { setErr(e.error); }
    setBusy(false);
  }
  async function save(extra: any = {}) {
    setErr(null);
    try { await api(`/admin-api/categories/${slug}`, { method: 'PATCH', body: { uz: txt.uz, ru: txt.ru, en: txt.en, ...extra } }); setTxt(await api(`/admin-api/categories/${slug}`)); }
    catch (e: any) { setErr(e.error); }
  }
  return (
    <div className="card">
      <div className="field"><label htmlFor="cs">{t('admin.category')}</label>
        <select id="cs" value={slug} onChange={(e) => open(e.target.value)}><option value="">—</option>
          {cats?.map((c: any) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select></div>
      {txt && (
        <>
          <p><span className={`tag ${txt.reviewed ? 'ok' : 'warn'}`}>{txt.reviewed ? t('admin.text_reviewed') : t('admin.text_unreviewed')}</span></p>
          {(['uz', 'ru', 'en'] as const).map((l) => (
            <div className="field" key={l}><label htmlFor={`d${l}`}>{l.toUpperCase()}</label>
              <textarea id={`d${l}`} maxLength={1500} value={txt[l]} onChange={(e) => setTxt({ ...txt, [l]: e.target.value })} /></div>))}
          <div className="actions">
            <button className="btn ghost" disabled={busy} onClick={generate}>{busy ? '…' : t('admin.generate')}</button>
            <button className="btn ghost" onClick={() => save()}>{t('admin.save_text')}</button>
            <button className="btn" disabled={!txt.ru && !txt.en} onClick={() => save({ reviewed: true })}>{t('admin.approve_text')}</button>
          </div>
        </>
      )}
      <ErrorText code={err} />
    </div>
  );
}

const KINDS = ['orders', 'payments', 'commissions', 'refunds', 'seller-ledger', 'client-balances'];
export function Reports({ t }: { t: T }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))' }}>
      {KINDS.map((k) => (
        <div className="card" key={k}><h3>{t(`admin.export.${k}`)}</h3>
          <a className="btn ghost small" href={`/admin-api/export/${k}`} download>{t('admin.export')}</a></div>))}
    </div>
  );
}

// ---------- tax accounting package (switch) ----------

const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

export function Accounting({ t }: { t: T }) {
  const lang = useLang();
  const [month, setMonth] = useState(lastMonth());
  const [rows, setRows] = useState<any[] | null>(null);
  const [vat, setVat] = useState<any>(null);
  const [off, setOff] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const load = useCallback(async () => {
    setErr(null);
    try {
      setRows(await api(`/admin-api/accounting/invoices?month=${month}`));
      setVat(await api(`/admin-api/accounting/vat?month=${month}`));
      setOff(false);
    } catch (e: any) { if (e.status === 404) setOff(true); else setErr(e.error); }
  }, [month]);
  useEffect(() => { load(); }, [load]);
  async function act(path: string, body: any = {}) {
    setErr(null); setNote('');
    try { const r = await api(path, { body }); if (typeof r?.created === 'number') setNote(t('admin.created_n', { n: r.created })); await load(); }
    catch (e: any) { setErr(e.error); }
  }
  async function enable() { try { await api('/admin-api/settings', { method: 'PUT', body: { tax_accounting_enabled: true } }); await load(); } catch (e: any) { setErr(e.error); } }
  if (off) return <div className="card"><p>{t('admin.tax_off')}</p><button className="btn" onClick={enable}>{t('admin.tax_enable')}</button><ErrorText code={err} /></div>;
  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <p className="notice" style={{ marginTop: 0 }}>{t('admin.tax_note')}</p>
        <div className="row"><div><label htmlFor="mo">{t('admin.month')}</label><input id="mo" type="month" value={month} max={lastMonth()} onChange={(e) => setMonth(e.target.value)} /></div>
          <div style={{ flex: '0 0 auto' }}><button className="btn" onClick={() => act('/admin-api/accounting/invoices/generate', { month })}>{t('admin.generate_invoices')}</button></div>
          <div style={{ flex: '0 0 auto' }}><a className="btn ghost" href="/admin-api/export/invoices" download>{t('admin.export')}</a></div></div>
        {note && <p className="ok">{note}</p>}<ErrorText code={err} />
      </div>
      {vat && (
        <div className="kpis">
          <div className="card kpi"><small>{t('admin.taxable_base')}</small><b>{money(vat.taxable_base, lang)}</b></div>
          <div className="card kpi"><small>{t('admin.output_vat')} ({vat.vat_rate}%)</small><b>{money(vat.output_vat, lang)}</b></div>
          <div className="card kpi"><small>{t('admin.drafts_not_counted')}</small><b>{vat.drafts_not_counted}</b></div>
          <div className="card kpi"><small>{t('admin.cash_prepay')}</small><b>{money(vat.cash_prepayments_unclassified, lang)}</b></div>
        </div>)}
      <div className="card table-wrap">
        <table><thead><tr><th>{t('admin.invoice.number')}</th><th>{t('admin.seller')}</th><th>{t('admin.invoice.gross')}</th><th>{t('admin.invoice.vat')}</th><th>{t('admin.invoice.net')}</th><th>{t('admin.status')}</th><th /></tr></thead>
          <tbody>{rows?.map((i) => (
            <tr key={i.id}><td>{i.number || '—'}</td><td>{i.seller}</td><td>{money(i.gross, lang)}</td><td>{money(i.vat_amount, lang)}</td><td>{money(i.net, lang)}</td>
              <td><span className={`tag ${i.status === 'sent_to_tax' ? 'ok' : i.status === 'void' ? 'bad' : ''}`}>{t(`admin.invoice.status.${i.status}`)}</span>{i.tax_ref && <div className="muted small">{i.tax_ref}</div>}</td>
              <td className="actions" style={{ margin: 0 }}>
                {i.status === 'draft' && <button className="btn small" onClick={() => act(`/admin-api/accounting/invoices/${i.id}/issue`)}>{t('admin.invoice.issue')}</button>}
                {i.status === 'issued' && <button className="btn small" onClick={() => { const r = prompt(t('admin.invoice.ref_prompt')); if (r) act(`/admin-api/accounting/invoices/${i.id}/sent`, { tax_ref: r }); }}>{t('admin.invoice.sent')}</button>}
                {(i.status === 'draft' || i.status === 'issued') && <button className="btn ghost small" onClick={() => confirm(t('admin.invoice.void_confirm')) && act(`/admin-api/accounting/invoices/${i.id}/void`)}>{t('admin.invoice.void')}</button>}</td></tr>))}</tbody></table>
      </div>
    </>
  );
}

// ---------- financial model ----------

const MODEL_FIELDS = ['orders_per_day', 'avg_basket', 'growth_pct', 'commission_pct', 'cash_share_pct', 'prepayment_pct', 'refund_rate_pct', 'vat_pct',
  'fixed_costs_month', 'variable_cost_per_order', 'marketing_month', 'ai_cost_month', 'opening_cash', 'months'];

export function Model({ t }: { t: T }) {
  const lang = useLang();
  const [vals, setVals] = useState<Record<string, string> | null>(null);
  const [based, setBased] = useState(0);
  const [out, setOut] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api('/admin-api/model').then((d) => { setBased(d.based_on_orders); setVals(Object.fromEntries(MODEL_FIELDS.map((k) => [k, String(d[k])]))); }).catch((e) => setErr(e.error));
  }, []);
  async function run() {
    setErr(null);
    try { setOut(await api('/admin-api/model', { body: Object.fromEntries(Object.entries(vals!).map(([k, v]) => [k, Number(v)])) })); } catch (e: any) { setErr(e.error); }
  }
  if (!vals) return <ErrorText code={err} />;
  const max = out ? Math.max(1, ...out.rows.map((r: any) => Math.abs(r.cash))) : 1;
  const s = out?.summary;
  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <p className="notice" style={{ marginTop: 0 }}>{t('admin.model.note', { n: based })}</p>
        <div className="row">{MODEL_FIELDS.map((k) => (
          <div key={k}><label htmlFor={`m-${k}`}>{t(`admin.model.${k}`)}</label>
            <input id={`m-${k}`} type="number" step="any" value={vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} /></div>))}</div>
        <div className="actions"><button className="btn" onClick={run}>{t('admin.model.run')}</button></div>
        <ErrorText code={err} />
      </div>
      {out && (
        <>
          <div className="kpis">
            <div className="card kpi"><small>{t('admin.model.total_revenue')}</small><b>{money(s.total_revenue, lang)}</b></div>
            <div className="card kpi"><small>{t('admin.model.total_profit')}</small><b>{money(s.total_profit, lang)}</b></div>
            <div className="card kpi"><small>{t('admin.model.break_even')}</small><b>{s.break_even_month ?? '—'}</b></div>
            <div className="card kpi"><small>{t('admin.model.funding')}</small><b>{money(s.funding_needed, lang)}</b></div>
          </div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>{t('admin.model.cash')}</h3>
            <div className="bars" style={{ gridTemplateColumns: `repeat(${out.rows.length}, 1fr)` }} role="img" aria-label={t('admin.model.cash')}>
              {out.rows.map((r: any) => <div key={r.month} className="bar" title={`${r.month}: ${money(r.cash, lang)}`}
                style={{ height: `${Math.max(2, (Math.abs(r.cash) / max) * 100)}%`, background: r.cash < 0 ? 'linear-gradient(180deg,#e5484d,#b42318)' : undefined }} />)}
            </div>
            <div className="bars-x" style={{ gridTemplateColumns: `repeat(${out.rows.length}, 1fr)` }}>{out.rows.map((r: any) => <span key={r.month}>{r.month}</span>)}</div>
          </div>
          <div className="card table-wrap">
            <table><thead><tr><th>{t('admin.month')}</th><th>{t('admin.orders_n')}</th><th>GMV</th><th>{t('admin.revenue')}</th><th>VAT</th><th>{t('admin.model.refunds')}</th><th>{t('admin.model.costs')}</th><th>{t('admin.model.profit')}</th><th>{t('admin.model.cash')}</th></tr></thead>
              <tbody>{out.rows.map((r: any) => (
                <tr key={r.month}><td>{r.month}</td><td>{r.orders}</td><td>{money(r.gmv, lang)}</td><td>{money(r.revenue, lang)}</td><td>{money(r.vat, lang)}</td><td>{money(r.refunds, lang)}</td><td>{money(r.costs, lang)}</td><td>{money(r.profit, lang)}</td><td>{money(r.cash, lang)}</td></tr>))}</tbody></table>
          </div>
        </>)}
    </>
  );
}
