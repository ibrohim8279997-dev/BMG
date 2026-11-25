'use client';
import { useCallback, useEffect, useState } from 'react';
import { ErrorText, RequireAuth } from '@/components/Bits';
import { useLang, useT } from '@/components/Providers';
import { api, money } from '@/lib/api';

export default function SellerPage() {
  return <RequireAuth role="seller"><Cabinet /></RequireAuth>;
}

function Cabinet() {
  const t = useT();
  const [me, setMe] = useState<any>(null);
  const [tab, setTab] = useState('import');
  useEffect(() => { api('/api/v1/sellers/me').then(setMe).catch(() => {}); }, []);
  if (!me) return <p className="muted">…</p>;
  // Self-registered seller sees no cabinet until staff approves
  if (me.status !== 'approved') {
    return <div className="card"><h1>{t('seller.cabinet')}</h1>
      <p>{me.status === 'blocked' ? t('seller.blocked') : t('seller.pending')}</p></div>;
  }
  const tabs = ['import', 'offers', 'delivery', 'files', 'orders', 'invoices', 'analytics', 'profile'];
  return (
    <>
      <h1>{t('seller.cabinet')}</h1>
      <div className="tabs">{tabs.map((x) =>
        <button key={x} className={`btn ${tab === x ? 'on' : ''}`} onClick={() => setTab(x)}>{t(`seller.tab.${x}`)}</button>)}</div>
      {tab === 'import' && <Import />}
      {tab === 'offers' && <Offers />}
      {tab === 'delivery' && <Delivery />}
      {tab === 'files' && <Files />}
      {tab === 'orders' && <Orders />}
      {tab === 'invoices' && <Invoices />}
      {tab === 'analytics' && <Analytics />}
      {tab === 'profile' && <Profile me={me} onSaved={setMe} />}
    </>
  );
}

/** Data for the seller's own e-invoice to the client: BMG assembles it, the seller checks, confirms and signs it
 * at the e-invoice operator. Sellers never see BMG's tax accounting. */
function Invoices() {
  const t = useT();
  const lang = useLang();
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api('/api/v1/sellers/me/invoices').then(setRows).catch((e) => setErr(e.error)), []);
  useEffect(() => { load(); }, [load]);
  async function confirmDoc(id: number) {
    setErr(null);
    try { await api(`/api/v1/sellers/me/invoices/${id}/confirm`, { body: {} }); load(); } catch (e: any) { setErr(e.error); }
  }
  return (
    <div className="card table-wrap"><p className="muted small">{t('seller.inv.hint')}</p><ErrorText code={err} />
      {rows && rows.length === 0 && <p className="muted">{t('seller.inv.none')}</p>}
      {rows && rows.length > 0 && <table><thead><tr><th>{t('acc.number')}</th><th>{t('order.number')}</th><th>{t('seller.inv.buyer')}</th><th>{t('acc.base')}</th><th>{t('acc.vat')}</th><th>{t('acc.total')}</th><th /></tr></thead>
        <tbody>{rows.map((d) => (
          <tr key={d.id}><td>{d.number}<div className="muted small">{d.date}</div></td><td>#{d.order_id}</td>
            <td>{d.client?.type === 'legal' ? `${d.client.name} · ${d.client.inn}` : t('seller.inv.individual')}</td>
            <td>{money(d.base, lang)}</td><td>{money(d.vat, lang)} ({d.vat_rate}%)</td><td><b>{money(d.total, lang)}</b></td>
            <td>{d.status === 'draft' ? <button className="btn small" onClick={() => confirmDoc(d.id)}>{t('seller.inv.confirm')}</button>
              : <span className={`tag ${d.status === 'posted' ? 'ok' : 'bad'}`}>{t(`acc.doc.${d.status}`)}</span>}</td></tr>))}</tbody></table>}
    </div>
  );
}

const FIELDS = ['name', 'price', 'stock', 'category', 'unit', 'cost_price'];

function Import() {
  const t = useT();
  const [imp, setImp] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function upload(file: File) {
    setErr(null); setBusy(true);
    const fd = new FormData(); fd.append('file', file);
    try { setImp(await api('/api/v1/sellers/me/imports', { form: fd })); } catch (e: any) { setErr(e.error); }
    setBusy(false);
  }
  async function setCol(field: string, v: string) {
    const mapping = { ...imp.mapping };
    if (v === '') delete mapping[field]; else mapping[field] = Number(v);
    try { setImp({ ...imp, ...(await api(`/api/v1/sellers/me/imports/${imp.id}`, { method: 'PATCH', body: { mapping } })) }); }
    catch (e: any) { setErr(e.error); }
  }
  async function confirm() {
    setErr(null); setBusy(true);
    try { setImp({ ...imp, ...(await api(`/api/v1/sellers/me/imports/${imp.id}/confirm`, { method: 'POST', body: {} })) }); }
    catch (e: any) { setErr(e.error); }
    setBusy(false);
  }
  if (imp?.status === 'confirmed') {
    const r = imp.result;
    return (
      <div className="card"><h3>{t('import.done')}</h3>
        <p>{t('import.created')}: {r.created} · {t('import.updated')}: {r.updated} · {t('import.errors')}: {r.error_count}</p>
        {r.errors.length > 0 && <div className="table-wrap"><table><tbody>{r.errors.map((e: any, i: number) =>
          <tr key={i}><td>#{e.row}</td><td className="error">{t(`import.err.${e.error}`)}</td></tr>)}</tbody></table></div>}
        <button className="btn" onClick={() => setImp(null)}>{t('import.another')}</button></div>
    );
  }
  return (
    <div className="card">
      <p className="muted">{t('import.hint')}</p>
      <input type="file" accept=".xlsx" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <ErrorText code={err} />
      {imp && (
        <>
          <h3 style={{ marginTop: 16 }}>{t('import.mapping')}</h3>
          <p className="muted small">{t('import.mapping_hint')}</p>
          <div className="row">{FIELDS.map((f) => (
            <div key={f}><label htmlFor={`m-${f}`}>{t(`import.field.${f}`)}{imp.required.includes(f) ? ' *' : ''}</label>
              <select id={`m-${f}`} value={imp.mapping[f] ?? ''} onChange={(e) => setCol(f, e.target.value)}>
                <option value="">—</option>
                {imp.headers.map((h: string, i: number) => <option key={i} value={i}>{h || `#${i + 1}`}</option>)}
              </select></div>))}</div>
          <div className="table-wrap"><table>
            <thead><tr>{imp.headers.map((h: string, i: number) => <th key={i}>{h}</th>)}</tr></thead>
            <tbody>{imp.preview?.map((r: string[], i: number) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
          </table></div>
          <button className="btn" disabled={busy || imp.required.some((f: string) => imp.mapping[f] === undefined)} onClick={confirm}>{t('import.confirm')}</button>
        </>
      )}
    </div>
  );
}

function Offers() {
  const t = useT();
  const lang = useLang();
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api('/api/v1/sellers/me/offers').then(setRows).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  async function save(o: any, field: string, v: string) {
    setErr(null);
    try { await api(`/api/v1/sellers/me/offers/${o.id}`, { method: 'PATCH', body: { [field]: v } }); load(); } catch (e: any) { setErr(e.error); }
  }
  return (
    <div className="card table-wrap">
      <ErrorText code={err} />
      {rows.length === 0 ? <p className="muted">{t('offers.empty')}</p> : (
        <table><thead><tr><th>{t('calc.material')}</th><th>{t('product.price')}</th><th>{t('product.stock')}</th><th>{t('offers.cost')}</th><th /></tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.id}><td>{o.product}<div className="muted small">{o.category}</div></td>
              {['price', 'stock', 'cost_price'].map((f) => (
                <td key={f}><input style={{ minWidth: 90 }} defaultValue={o[f] ?? ''} onBlur={(e) => e.target.value !== (o[f] ?? '') && save(o, f, e.target.value)} aria-label={f} /></td>))}
              <td><button className="btn ghost small" onClick={async () => { await api(`/api/v1/sellers/me/offers/${o.id}`, { method: 'PATCH', body: { active: !o.active } }); load(); }}>{o.active ? t('offers.on') : t('offers.off')}</button></td></tr>))}
          </tbody></table>)}
    </div>
  );
}

function Delivery() {
  const t = useT();
  const lang = useLang();
  const [rows, setRows] = useState<any[]>([]);
  const [f, setF] = useState({ region: '', cost: '0', restrictions: '' });
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api('/api/v1/sellers/me/delivery-rules').then(setRows).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  async function add() {
    setErr(null);
    try { await api('/api/v1/sellers/me/delivery-rules', { body: f }); setF({ region: '', cost: '0', restrictions: '' }); load(); }
    catch (e: any) { setErr(e.error); }
  }
  return (
    <div className="card">
      <p className="muted small">{t('delivery.hint')}</p>
      <div className="row">
        <div><label htmlFor="rg">{t('delivery.region')}</label><input id="rg" value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} /></div>
        <div><label htmlFor="rc">{t('delivery.cost')}</label><input id="rc" type="number" min="0" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></div>
        <div><label htmlFor="rr">{t('delivery.restrictions')}</label><input id="rr" value={f.restrictions} onChange={(e) => setF({ ...f, restrictions: e.target.value })} /></div>
        <div style={{ flex: '0 0 auto' }}><button className="btn" disabled={!f.region.trim()} onClick={add}>{t('add')}</button></div>
      </div>
      <ErrorText code={err} />
      <table><tbody>{rows.map((r) => (
        <tr key={r.id}><td>{r.region}</td><td>{money(r.cost, lang)}</td><td className="muted">{r.restrictions}</td>
          <td><button className="btn ghost small" onClick={async () => { await api(`/api/v1/sellers/me/delivery-rules/${r.id}`, { method: 'DELETE' }); load(); }}>✕</button></td></tr>))}</tbody></table>
    </div>
  );
}

function Files() {
  const t = useT();
  const [rows, setRows] = useState<any[]>([]);
  const [kind, setKind] = useState('document');
  const [title, setTitle] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api('/api/v1/sellers/me/files').then(setRows).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  async function upload(file: File) {
    setErr(null);
    const fd = new FormData(); fd.append('file', file); fd.append('kind', kind); fd.append('title', title);
    try { await api('/api/v1/sellers/me/files', { form: fd }); setTitle(''); load(); } catch (e: any) { setErr(e.error); }
  }
  return (
    <div className="card">
      <p className="muted small">{t('files.hint')}</p>
      <div className="row">
        <div><label htmlFor="fk">{t('files.kind')}</label><select id="fk" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="document">{t('files.document')}</option><option value="photo">{t('files.photo')}</option></select></div>
        <div><label htmlFor="ft">{t('files.title')}</label><input id="ft" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div><label htmlFor="ff">{t('files.file')}</label>
          <input id="ff" type="file" accept={kind === 'photo' ? '.jpg,.jpeg,.png,.webp' : '.pdf,.docx'} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></div>
      </div>
      <ErrorText code={err} />
      <table><tbody>{rows.map((r) => (
        <tr key={r.id}><td>{t(`files.${r.kind}`)}</td><td>{r.title}</td><td>{r.type}</td><td>{Math.round(r.size / 1024)} KB</td>
          <td><button className="btn ghost small" onClick={async () => { await api(`/api/v1/sellers/me/files/${r.id}`, { method: 'DELETE' }); load(); }}>✕</button></td></tr>))}</tbody></table>
    </div>
  );
}

function Orders() {
  const t = useT();
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api('/api/v1/sellers/me/orders').then(setRows).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  async function fulfill(id: number) {
    try { await api(`/api/v1/sellers/me/orders/${id}/fulfill`, { method: 'POST', body: {} }); load(); } catch (e: any) { setErr(e.error); }
  }
  return (
    <div className="grid">{rows.length === 0 && <p className="muted">{t('orders.empty')}</p>}
      {rows.map((o) => (
        <div className="card" key={o.id}><h3>#{o.id} <span className="tag">{t(`status.${o.status}`)}</span></h3>
          <p className="muted small">{o.city} · {t(`order.mode_${o.payment_mode}`)}</p>
          <ul>{o.items.map((i: any) => <li key={i.id}>{i.name} × {Number(i.qty)} {i.fulfilled && '✓'}</li>)}</ul>
          {o.status === 'paid' && <button className="btn small" onClick={() => fulfill(o.id)}>{t('orders.fulfill')}</button>}</div>))}
      <ErrorText code={err} />
    </div>
  );
}

function Analytics() {
  const t = useT();
  const lang = useLang();
  const [a, setA] = useState<any>(null);
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  useEffect(() => { api('/api/v1/sellers/me/analytics').then(setA).catch(() => {}); }, []);
  async function payout() {
    setErr(null); setOk(false);
    try { await api('/api/v1/sellers/me/payouts', { body: { amount } }); setOk(true); } catch (e: any) { setErr(e.error); }
  }
  if (!a) return <p className="muted">…</p>;
  return (
    <div className="card">
      <p className="notice">{t('analytics.internal')}</p>
      <div className="grid">
        <div><span className="muted">{t('analytics.orders')}</span><div className="price">{a.orders}</div></div>
        <div><span className="muted">{t('analytics.revenue')}</span><div className="price">{money(a.revenue, lang)}</div></div>
        <div><span className="muted">{t('analytics.commission')}</span><div className="price">{money(a.commission, lang)}</div></div>
        {a.margin !== undefined ? <div><span className="muted">{t('analytics.margin')}</span><div className="price">{money(a.margin, lang)}</div></div>
          : <div className="muted small">{t('analytics.no_cost')}</div>}
        <div><span className="muted">{t('analytics.payable')}</span><div className="price">{money(a.payable_balance, lang)}</div></div>
      </div>
      <h3>{t('analytics.top')}</h3>
      <table><tbody>{a.top.map((x: any) => <tr key={x.name}><td>{x.name}</td><td>{money(x.revenue, lang)}</td></tr>)}</tbody></table>
      <h3>{t('analytics.payout')}</h3>
      <div className="row"><div><input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={t('wallet.amount')} /></div>
        <div style={{ flex: '0 0 auto' }}><button className="btn" disabled={!amount} onClick={payout}>{t('analytics.request_payout')}</button></div></div>
      {ok && <p className="ok">{t('analytics.payout_sent')}</p>}<ErrorText code={err} />
    </div>
  );
}

function Profile({ me, onSaved }: { me: any; onSaved: (m: any) => void }) {
  const t = useT();
  const [f, setF] = useState({ company_name: me.company_name, description: me.description, contact_phone: me.contact_phone,
    inn: me.inn || '', bank_account: me.bank_account || '', bank_mfo: me.bank_mfo || '', bank_name: me.bank_name || '' });
  const bank: [keyof typeof f, number][] = [['inn', 9], ['bank_account', 24], ['bank_mfo', 5], ['bank_name', 120]];
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  async function save() {
    setErr(null); setOk(false);
    try { onSaved(await api('/api/v1/sellers/me', { method: 'PATCH', body: f })); setOk(true); } catch (e: any) { setErr(e.error); }
  }
  return (
    <div className="card">
      <div className="field"><label htmlFor="cn">{t('login.company')}</label><input id="cn" value={f.company_name} onChange={(e) => setF({ ...f, company_name: e.target.value })} /></div>
      <div className="field"><label htmlFor="cp">{t('seller.contact_phone')}</label><input id="cp" value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} /></div>
      <div className="field"><label htmlFor="cd">{t('seller.description')}</label><textarea id="cd" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      <h3>{t('seller.bank')}</h3>
      <p className="muted small">{t('seller.bank_note')}</p>
      <div className="row">{bank.map(([k, n]) => (
        <div key={k}><label htmlFor={`b-${k}`}>{t(`seller.${k}`)}</label>
          <input id={`b-${k}`} maxLength={n} inputMode={k === 'bank_name' ? 'text' : 'numeric'} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>))}</div>
      <p className="muted small">{t('seller.commission')}: {me.commission_percent}%</p>
      <button className="btn" onClick={save}>{t('save')}</button>{ok && <span className="ok"> ✓</span>}<ErrorText code={err} />
    </div>
  );
}
