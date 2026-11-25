'use client';
import { useCallback, useEffect, useState } from 'react';
import { ErrorText } from './Bits';
import { useLang } from './Providers';
import { api, money } from '@/lib/api';

type T = (k: string, v?: any) => string;
type Err = { error: string; problems?: string[] } | null;

/** Table amounts: digits only, the currency is stated once above the table. */
const num = (v: number, lang: string) => new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'ru-RU', { maximumFractionDigits: 0 }).format(v);
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => today().slice(0, 8) + '01';
const qs = (o: Record<string, string>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v)).toString();

function Problems({ err, t }: { err: Err; t: T }) {
  if (!err) return null;
  if (err.error !== 'document_mismatch') return <ErrorText code={err.error} />;
  return (
    <div className="notice" role="alert"><b>{t('acc.mismatch')}</b>
      <ul className="problems">{(err.problems || []).map((p) => <li key={p}>{t(`acc.problem.${p}`) === `acc.problem.${p}` ? p : t(`acc.problem.${p}`)}</li>)}</ul></div>
  );
}

function useAct(reload: () => void) {
  const [err, setErr] = useState<Err>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (path: string, opts: any) => {
    setErr(null); setBusy(true);
    try { const r = await api(path, opts); await reload(); return r; } catch (e: any) { setErr({ error: e.error, problems: e.data?.problems }); return null; } finally { setBusy(false); }
  }, [reload]);
  return { err, busy, run, setErr };
}

function Period({ p, setP, t }: { p: { from: string; to: string }; setP: (v: any) => void; t: T }) {
  return (<>
    <div><label htmlFor="pf">{t('acc.from')}</label><input id="pf" type="date" value={p.from} max={p.to} onChange={(e) => setP({ ...p, from: e.target.value })} /></div>
    <div><label htmlFor="pt">{t('acc.to')}</label><input id="pt" type="date" value={p.to} min={p.from} onChange={(e) => setP({ ...p, to: e.target.value })} /></div>
  </>);
}

const SUBS = ['summary', 'deals', 'documents', 'reconcile', 'parties', 'settings'] as const;

/** Accounting (agent scheme). Client money is transit; BMG revenue is only its commission. */
export function Accounting({ t }: { t: T }) {
  const [sub, setSub] = useState<(typeof SUBS)[number]>('summary');
  const [att, setAtt] = useState<any>({});
  useEffect(() => { api('/admin-api/accounting/overview').then((d) => setAtt(d.attention)).catch(() => setAtt({})); }, [sub]);
  const badge: Record<string, number> = { deals: (att.to_confirm || 0) + (att.to_pay_out || 0), reconcile: att.discrepancies || 0, documents: att.seller_invoices_unconfirmed || 0 };
  return (
    <>
      <div className="adm-sub" role="tablist">{SUBS.map((x) => (
        <button key={x} role="tab" aria-selected={sub === x} className={sub === x ? 'on' : ''} onClick={() => setSub(x)}>
          {t(`acc.sub.${x}`)}{badge[x] ? <span className="adm-badge">{badge[x]}</span> : null}</button>))}</div>
      {sub === 'summary' && <Summary t={t} go={setSub} />}
      {sub === 'deals' && <Deals t={t} />}
      {sub === 'documents' && <Documents t={t} />}
      {sub === 'reconcile' && <Reconcile t={t} />}
      {sub === 'parties' && <Parties t={t} />}
      {sub === 'settings' && <AccSettings t={t} />}
    </>
  );
}

export function VatMeter({ t, th }: { t: T; th: any }) {
  const lang = useLang();
  return (
    <div className="card">
      <h3>{t('acc.threshold')}</h3>
      <div className={`meter ${th.level}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, th.percent)}><i style={{ width: `${Math.min(100, th.percent)}%` }} /></div>
      <p className="small"><b>{th.percent}%</b> · {money(th.turnover, lang)} / {money(th.threshold, lang)} · {t('acc.since', { d: th.since })}</p>
      {th.level !== 'ok' && <p className="notice">{t(`acc.threshold_${th.level}`)}</p>}
      <p className="muted small">{th.bmg_vat_payer ? t('acc.vat_on', { d: th.bmg_vat_from || '—' }) : t('acc.vat_off')} {t('acc.threshold_note')}</p>
    </div>
  );
}

function Summary({ t, go }: { t: T; go: (s: any) => void }) {
  const lang = useLang();
  const [p, setP] = useState({ from: monthStart(), to: today() });
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api(`/admin-api/accounting/overview?${qs(p)}`).then(setD).catch((e) => setErr(e.error)); }, [p]);
  if (!d) return <ErrorText code={err} />;
  const s = d.summary, a = d.attention;
  return (
    <>
      <div className="card"><div className="adm-filters"><Period p={p} setP={setP} t={t} />
        <div className="adm-actions" style={{ flex: '1 1 auto' }}>
          <a className="btn ghost small" href={`/admin-api/accounting/export/xlsx?${qs(p)}`} download>Excel</a>
          <a className="btn ghost small" href={`/admin-api/accounting/export/pdf?${qs(p)}`} download>PDF</a></div></div>
        <p className="muted small" style={{ margin: 0 }}>{t('acc.scheme_note')}</p></div>
      <div className="kpis" style={{ marginTop: 16 }}>
        <div className="card kpi"><small>{t('acc.turnover')}</small><b>{money(s.turnover, lang)}</b><span className="muted small">{t('acc.deals_n', { n: s.deals })}</span></div>
        <div className="card kpi"><small>{t('acc.commission')}</small><b>{money(s.commission, lang)}</b></div>
        <div className="card kpi"><small>{t('acc.commission_vat')}</small><b>{money(s.commission_vat, lang)}</b></div>
        <div className="card kpi"><small>{t('acc.payout_outstanding')}</small><b>{money(s.payout_outstanding, lang)}</b><span className="muted small">{t('acc.of_total', { v: money(s.payout_total, lang) })}</span></div>
      </div>
      <div className="adm-todo">{(['to_confirm', 'to_pay_out', 'discrepancies', 'seller_invoices_unconfirmed'] as const).map((k) => (
        <button key={k} className={a[k] > 0 ? 'hot' : ''} onClick={() => go(k === 'discrepancies' ? 'reconcile' : k === 'seller_invoices_unconfirmed' ? 'documents' : 'deals')}>
          <b>{a[k]}</b><span>{t(`admin.home.${k}`)}</span></button>))}</div>
      <VatMeter t={t} th={d.threshold} />
    </>
  );
}

const DEAL_ST = ['paid', 'delivered', 'confirmed', 'paid_out', 'refunded'];
const tagOf = (s: string) => (s === 'paid_out' || s === 'posted' ? 'ok' : s === 'refunded' || s === 'reversed' ? 'bad' : s === 'delivered' || s === 'draft' ? 'warn' : '');

function Deals({ t }: { t: T }) {
  const lang = useLang();
  const [p, setP] = useState({ from: monthStart().slice(0, 5) + '01-01', to: today() });
  const [st, setSt] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [sel, setSel] = useState<number[]>([]);
  const [ref, setRef] = useState('');
  const load = useCallback(() => api(`/admin-api/accounting/deals?${qs({ ...p, status: st })}`).then((r) => { setRows(r); setSel([]); }), [p, st]);
  useEffect(() => { load(); }, [load]);
  const { err, busy, run } = useAct(load);
  const payable = (rows || []).filter((d) => sel.includes(d.id));
  return (
    <div className="card table-wrap">
      <div className="adm-filters"><Period p={p} setP={setP} t={t} />
        <div><label htmlFor="ds">{t('admin.status')}</label><select id="ds" value={st} onChange={(e) => setSt(e.target.value)}>
          <option value="">{t('filters.all')}</option>{DEAL_ST.map((x) => <option key={x} value={x}>{t(`acc.deal.${x}`)}</option>)}</select></div></div>
      <p className="muted small">{t('acc.deals_hint')}</p>
      <Problems err={err} t={t} />
      {sel.length > 0 && (
        <div className="notice"><b>{t('acc.payout_selected', { n: sel.length, v: money(payable.reduce((a, d) => a + d.payout, 0), lang) })}</b>
          <div className="adm-filters" style={{ marginTop: 8, marginBottom: 0 }}>
            <div style={{ flex: '1 1 240px' }}><label htmlFor="bref">{t('acc.bank_ref')}</label><input id="bref" value={ref} maxLength={80} onChange={(e) => setRef(e.target.value)} /></div>
            <button className="btn small" disabled={!ref.trim() || busy} onClick={() => confirm(t('acc.payout_confirm')) && run('/admin-api/accounting/payouts', { body: { deal_ids: sel, bank_ref: ref } }).then((r) => r && setRef(''))}>{t('acc.mark_paid_out')}</button></div></div>)}
      {rows && rows.length === 0 && <p className="adm-empty">{t('admin.empty')}</p>}
      {rows && rows.length > 0 && <p className="muted small">{t('acc.amounts_in')}</p>}
      {rows && rows.length > 0 && <table><thead><tr><th /><th>#</th><th>{t('admin.seller')}</th><th>{t('admin.status')}</th><th className="n">{t('acc.total')}</th><th className="n">{t('acc.commission')}</th><th className="n">{t('acc.vat')}</th><th className="n">{t('acc.payout')}</th></tr></thead>
        <tbody>{rows.map((d) => (
          <tr key={d.id}>
            <td>{d.status === 'confirmed' && d.payout > 0 && <input type="checkbox" aria-label={`${t('acc.select')} ${d.id}`} checked={sel.includes(d.id)} onChange={(e) => setSel(e.target.checked ? [...sel, d.id] : sel.filter((x) => x !== d.id))} />}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{d.id}<div className="muted small">#{d.order_id}</div></td>
            <td style={{ minWidth: 140 }}>{d.seller}<div className="muted small">{t(`order.mode_${d.payment_mode}`)}</div></td>
            <td><span className={`tag ${tagOf(d.status)}`}>{t(`acc.deal.${d.status}`)}</span>
              {d.status === 'delivered' && <div style={{ marginTop: 6 }}><button className="btn small" disabled={busy} onClick={() => confirm(t('acc.confirm_q')) && run(`/admin-api/accounting/deals/${d.id}/confirm`, { body: {} })}>{t('acc.confirm_short')}</button></div>}</td>
            <td className="n">{num(d.total, lang)}</td><td className="n">{num(d.commission, lang)}<div className="muted small">{Number(d.commission_rate)}%</div></td>
            <td className="n">{num(d.commission_vat, lang)}</td><td className="n"><b>{num(d.payout, lang)}</b></td>
          </tr>))}</tbody></table>}
    </div>
  );
}

const KINDS = ['commission', 'seller_inv', 'act', 'registry', 'storno'];

function Documents({ t }: { t: T }) {
  const lang = useLang();
  const [f, setF] = useState({ from: monthStart(), to: today(), kind: '', status: '', seller: '', q: '' });
  const [rows, setRows] = useState<any[] | null>(null);
  const [sellers, setSellers] = useState<any[]>([]);
  const [act, setAct] = useState('');
  const load = useCallback(() => api(`/admin-api/accounting/documents?${qs(f)}`).then(setRows), [f]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api('/admin-api/accounting/sellers').then(setSellers).catch(() => {}); }, []);
  const { err, busy, run } = useAct(load);
  const storno = (d: any) => { const r = prompt(t('acc.storno_reason')); if (r && r.trim()) run(`/admin-api/accounting/documents/${d.id}/storno`, { body: { reason: r } }); };
  const einv = (d: any) => {
    const st = prompt(t('acc.einv_status_prompt'), d.einvoice_status || 'sent'); if (!st) return;
    const ref = ['sent', 'accepted'].includes(st) ? prompt(t('acc.einv_ref_prompt'), d.einvoice_ref || '') : '';
    run(`/admin-api/accounting/documents/${d.id}/einvoice-status`, { body: { status: st.trim(), ref: ref || '' } });
  };
  return (
    <>
      <div className="card">
        <div className="adm-filters"><Period p={f} setP={setF} t={t} />
          <div><label htmlFor="fk">{t('acc.kind')}</label><select id="fk" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="">{t('filters.all')}</option>{KINDS.map((k) => <option key={k} value={k}>{t(`acc.kind.${k}`)}</option>)}</select></div>
          <div><label htmlFor="fs">{t('admin.status')}</label><select id="fs" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">{t('filters.all')}</option>{['draft', 'posted', 'reversed'].map((k) => <option key={k} value={k}>{t(`acc.doc.${k}`)}</option>)}</select></div>
          <div><label htmlFor="fse">{t('admin.seller')}</label><select id="fse" value={f.seller} onChange={(e) => setF({ ...f, seller: e.target.value })}><option value="">{t('filters.all')}</option>{sellers.map((s) => <option key={s.id} value={s.id}>{s.company_name || `#${s.id}`}</option>)}</select></div>
          <div><label htmlFor="fq">{t('acc.search')}</label><input id="fq" value={f.q} maxLength={40} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
          <div className="adm-actions"><a className="btn ghost small" href={`/admin-api/accounting/export/xlsx?${qs(f)}`} download>Excel</a><a className="btn ghost small" href={`/admin-api/accounting/export/pdf?${qs(f)}`} download>PDF</a></div></div>
        <div className="adm-filters" style={{ marginBottom: 0 }}>
          <div style={{ flex: '1 1 260px' }}><label htmlFor="as">{t('acc.act_for')}</label><select id="as" value={act} onChange={(e) => setAct(e.target.value)}><option value="">—</option>{sellers.map((s) => <option key={s.id} value={s.id}>{s.company_name || `#${s.id}`}</option>)}</select></div>
          <button className="btn small" disabled={!act || busy} onClick={() => run('/admin-api/accounting/documents/act', { body: { seller_id: Number(act), from: f.from, to: f.to } })}>{t('acc.make_act')}</button></div>
        <Problems err={err} t={t} />
      </div>
      <div className="card table-wrap">
        {rows && rows.length === 0 && <p className="adm-empty">{t('admin.empty')}</p>}
        {rows && rows.length > 0 && <p className="muted small">{t('acc.amounts_in')}</p>}
        {rows && rows.length > 0 && <table><thead><tr><th>{t('acc.number')}</th><th>{t('acc.kind')}</th><th>{t('admin.seller')}</th><th>{t('admin.status')}</th><th className="n">{t('acc.base')}</th><th className="n">{t('acc.vat')}</th><th className="n">{t('acc.total')}</th><th /></tr></thead>
          <tbody>{rows.map((d) => (
            <tr key={d.id}><td className="nw"><b>{d.number}</b><div className="muted small">{d.date}</div></td>
              <td>{t(`acc.kind.${d.kind}`)}{d.reverses && <div className="muted small">← {d.reverses}</div>}
                {['commission', 'seller_inv'].includes(d.kind) && d.status === 'posted' && <div><button className="linkbtn small" onClick={() => einv(d)}>{t('acc.einv')}: {d.einvoice_status || '—'} {d.einvoice_ref} ✎</button></div>}</td>
              <td>{d.seller || '—'}</td><td><span className={`tag ${tagOf(d.status)}`}>{t(`acc.doc.${d.status}`)}</span></td>
              <td className="n">{num(d.base, lang)}</td><td className="n">{num(d.vat, lang)}<div className="muted small">{Number(d.vat_rate)}%</div></td><td className="n"><b>{num(d.total, lang)}</b></td>
              <td><div className="adm-actions">
                <a className="btn ghost small" href={`/admin-api/accounting/documents/${d.id}/pdf`} download>PDF</a>
                {['commission', 'seller_inv'].includes(d.kind) && <a className="btn ghost small" href={`/admin-api/accounting/documents/${d.id}/einvoice`} download title={t('acc.einv_export_hint')}>{t('acc.einv')}</a>}
                {d.kind !== 'storno' && d.kind !== 'registry' && d.status !== 'reversed' && <button className="btn ghost small" disabled={busy} onClick={() => storno(d)}>{t('acc.storno')}</button>}
              </div></td></tr>))}</tbody></table>}
      </div>
    </>
  );
}

function Reconcile({ t }: { t: T }) {
  const lang = useLang();
  const [all, setAll] = useState(false);
  const [rows, setRows] = useState<any[] | null>(null);
  const [note, setNote] = useState('');
  const load = useCallback(() => api(`/admin-api/accounting/discrepancies${all ? '?all=1' : ''}`).then(setRows), [all]);
  useEffect(() => { load(); }, [load]);
  const { err, busy, run } = useAct(load);
  return (
    <div className="card table-wrap">
      <div className="adm-filters"><button className="btn small" disabled={busy} onClick={async () => { const r = await run('/admin-api/accounting/discrepancies', { body: {} }); if (r) setNote(t('acc.found_n', { n: r.found })); }}>{t('acc.run_reconcile')}</button>
        <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />{t('acc.show_resolved')}</label></div>
      <p className="muted small">{t('acc.reconcile_hint')}</p>
      {note && <p className="ok">{note}</p>}<Problems err={err} t={t} />
      {rows && rows.length === 0 && <p className="adm-empty">{t('acc.no_discrepancies')}</p>}
      {rows && rows.length > 0 && <table><thead><tr><th>#</th><th>{t('acc.kind')}</th><th>{t('order.number')}</th><th className="n">{t('acc.expected')}</th><th className="n">{t('acc.actual')}</th><th /></tr></thead>
        <tbody>{rows.map((x) => (
          <tr key={x.id}><td>{x.id}</td><td>{t(`acc.disc.${x.kind}`) === `acc.disc.${x.kind}` ? x.kind : t(`acc.disc.${x.kind}`)}<div className="muted small">{x.note}</div></td>
            <td>{x.order_id ? `#${x.order_id}` : '—'}</td><td className="n">{num(x.expected, lang)}</td><td className="n">{num(x.actual, lang)}</td>
            <td>{x.resolved ? <span className="tag ok" title={x.resolution}>{t('acc.resolved')}</span>
              : <button className="btn ghost small" onClick={() => { const r = prompt(t('acc.resolution_prompt')); if (r && r.trim()) run(`/admin-api/accounting/discrepancies/${x.id}/resolve`, { body: { resolution: r } }); }}>{t('acc.resolve')}</button>}</td></tr>))}</tbody></table>}
    </div>
  );
}

const SELLER_TEXT = ['company_name', 'inn', 'legal_address', 'bank_name', 'bank_account', 'bank_mfo', 'contract_number'];

function Parties({ t }: { t: T }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [open, setOpen] = useState<any>(null);
  const load = useCallback(() => api('/admin-api/accounting/sellers').then(setRows), []);
  useEffect(() => { load(); }, [load]);
  const { err, busy, run, setErr } = useAct(load);
  async function save(extra: any = {}) {
    const body: any = { ...Object.fromEntries(SELLER_TEXT.map((k) => [k, open[k] || ''])), vat_payer: !!open.vat_payer, contract_date: open.contract_date || '', ...extra };
    const r = await run(`/admin-api/accounting/sellers/${open.id}`, { method: 'PATCH', body });
    if (r) setOpen(r);
  }
  return (
    <>
      {open && (
        <div className="card">
          <h3>{open.company_name || `#${open.id}`} <span className={`tag ${open.contract_status === 'confirmed' ? 'ok' : 'warn'}`}>{t(`acc.contract.${open.contract_status}`)}</span></h3>
          <div className="adm-form">{SELLER_TEXT.map((k) => (
            <div className="field" key={k}><label htmlFor={`sr-${k}`}>{t(`acc.req.${k}`)}</label>
              <input id={`sr-${k}`} value={open[k] || ''} maxLength={k === 'legal_address' ? 250 : 200} inputMode={['inn', 'bank_account', 'bank_mfo'].includes(k) ? 'numeric' : undefined} onChange={(e) => setOpen({ ...open, [k]: e.target.value })} /></div>))}
            <div className="field"><label htmlFor="sr-cd">{t('acc.req.contract_date')}</label><input id="sr-cd" type="date" value={open.contract_date || ''} onChange={(e) => setOpen({ ...open, contract_date: e.target.value })} /></div>
            <div className="field"><label className="check"><input type="checkbox" checked={!!open.vat_payer} onChange={(e) => setOpen({ ...open, vat_payer: e.target.checked })} />{t('acc.req.vat_payer')}</label></div></div>
          <Problems err={err} t={t} />
          <div className="adm-actions">
            <button className="btn" disabled={busy} onClick={() => save()}>{t('save')}</button>
            {open.contract_status !== 'confirmed' && <button className="btn ghost" disabled={busy} onClick={() => save({ contract_status: 'confirmed' })}>{t('acc.confirm_contract')}</button>}
            {open.contract_status === 'confirmed' && <button className="btn ghost" disabled={busy} onClick={() => confirm(t('acc.terminate_q')) && save({ contract_status: 'terminated' })}>{t('acc.terminate_contract')}</button>}
            <button className="btn ghost" onClick={() => { setOpen(null); setErr(null); }}>{t('cancel')}</button></div>
        </div>)}
      <div className="card table-wrap">
        <p className="muted small">{t('acc.parties_hint')}</p>
        <table><thead><tr><th>#</th><th>{t('login.company')}</th><th>{t('acc.req.inn')}</th><th>{t('acc.req.vat_payer')}</th><th>{t('acc.contract')}</th><th>{t('seller.commission')}</th><th /></tr></thead>
          <tbody>{rows?.map((s) => (
            <tr key={s.id}><td>{s.id}</td><td>{s.company_name || '—'}</td><td>{s.inn || <span className="tag bad">{t('acc.missing')}</span>}</td>
              <td>{s.vat_payer ? t('yes') : t('no')}</td>
              <td><span className={`tag ${s.contract_status === 'confirmed' ? 'ok' : s.contract_status === 'terminated' ? 'bad' : 'warn'}`}>{t(`acc.contract.${s.contract_status}`)}</span>
                {s.contract_number && <div className="muted small">№ {s.contract_number} · {s.contract_date}</div>}</td>
              <td>{Number(s.commission_percent)}%</td>
              <td><button className="btn ghost small" onClick={() => { setErr(null); setOpen(s); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{t('acc.edit')}</button></td></tr>))}</tbody></table>
      </div>
    </>
  );
}

const ACC_NUM = ['default_commission_percent', 'vat_rate', 'brv_value', 'vat_threshold_brv'];
const ACC_TEXT = ['bmg_name', 'bmg_inn', 'bmg_address', 'bmg_bank_name', 'bmg_bank_account', 'bmg_bank_mfo'];

function AccSettings({ t }: { t: T }) {
  const lang = useLang();
  const [v, setV] = useState<any>(null);
  const [ok, setOk] = useState(false);
  const load = useCallback(() => api('/admin-api/accounting/settings').then(setV), []);
  useEffect(() => { load(); }, [load]);
  const { err, busy, run } = useAct(load);
  if (!v) return <p className="muted">…</p>;
  async function save() {
    setOk(false);
    const body: any = { ...Object.fromEntries(ACC_TEXT.map((k) => [k, String(v[k] ?? '')])), bmg_vat_payer: !!v.bmg_vat_payer, bmg_vat_from: v.bmg_vat_from || '', einvoice_api_enabled: !!v.einvoice_api_enabled };
    for (const k of ACC_NUM) body[k] = Number(v[k]);
    if (await run('/admin-api/accounting/settings', { method: 'PUT', body })) setOk(true);
  }
  return (
    <div className="card">
      <h3>{t('acc.set.tax')}</h3>
      <div className="adm-form">{ACC_NUM.map((k) => (
        <div className="field" key={k}><label htmlFor={`as-${k}`}>{t(`acc.set.${k}`)}</label><input id={`as-${k}`} type="number" min={0} step={k.includes('brv') ? 1 : 0.01} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></div>))}</div>
      <p className="muted small">{t('acc.set.threshold_is', { v: money(Number(v.brv_value) * Number(v.vat_threshold_brv) || 0, lang) })}</p>
      <div className="adm-form">
        <div className="field"><label className="check"><input type="checkbox" checked={!!v.bmg_vat_payer} onChange={(e) => setV({ ...v, bmg_vat_payer: e.target.checked })} />{t('acc.set.bmg_vat_payer')}</label></div>
        <div className="field"><label htmlFor="as-from">{t('acc.set.bmg_vat_from')}</label><input id="as-from" type="date" value={v.bmg_vat_from || ''} onChange={(e) => setV({ ...v, bmg_vat_from: e.target.value })} /></div></div>
      <p className="notice">{t('acc.set.vat_note')}</p>
      <h3>{t('acc.set.bmg')}</h3>
      <div className="adm-form">{ACC_TEXT.map((k) => (
        <div className="field" key={k}><label htmlFor={`as-${k}`}>{t(`acc.set.${k}`)}</label><input id={`as-${k}`} value={v[k] || ''} maxLength={250} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></div>))}</div>
      <h3>{t('acc.set.einvoice')}</h3>
      <label className="check"><input type="checkbox" checked={!!v.einvoice_api_enabled} onChange={(e) => setV({ ...v, einvoice_api_enabled: e.target.checked })} />{t('acc.set.einvoice_api_enabled')}</label>
      <p className="muted small">{t('acc.set.einvoice_note')}</p>
      <Problems err={err} t={t} />
      {ok && <p className="ok">{t('acc.saved')}</p>}
      <div className="actions"><button className="btn" disabled={busy} onClick={save}>{t('save')}</button></div>
    </div>
  );
}
