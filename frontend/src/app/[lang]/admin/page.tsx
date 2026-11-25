'use client';
import { useCallback, useEffect, useState } from 'react';
import { ErrorText } from '@/components/Bits';
import { Accounting, VatMeter } from '@/components/AdminAccounting';
import { Crm } from '@/components/AdminCrm';
import { Analytics, Content, Flags, Model, Quality, Reports, ReviewsMod } from '@/components/AdminReports';
import Icon from '@/components/Icon';
import ImportWizard from '@/components/ImportWizard';
import { useLang, useT } from '@/components/Providers';
import { api, money } from '@/lib/api';
import './admin.css';

export default function AdminPage() {
  const t = useT();
  const [me, setMe] = useState<any>(null);
  const [checked, setChecked] = useState(false);
  const check = useCallback(() => api('/admin-api/me').then(setMe).catch(() => setMe(null)).finally(() => setChecked(true)), []);
  useEffect(() => { check(); }, [check]);
  if (!checked) return <p className="muted">…</p>;
  if (!me) return <Login onDone={check} />;
  return <Panel me={me} onLogout={async () => { await api('/admin-api/logout', { method: 'POST', body: {} }); setMe(null); }} t={t} />;
}

function Login({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [f, setF] = useState({ username: '', password: '', otp: '', backup_code: '' });
  const [useBackup, setUseBackup] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setErr(null);
    try { await api('/admin-api/login', { body: { username: f.username, password: f.password, ...(useBackup ? { backup_code: f.backup_code } : { otp: f.otp }) } }); onDone(); }
    catch (e: any) { setErr(e.error); }
  }
  return (
    <div className="card" style={{ maxWidth: 420, margin: '0 auto' }}>
      <h1>{t('admin.login')}</h1>
      <div className="field"><label htmlFor="u">{t('admin.username')}</label><input id="u" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></div>
      <div className="field"><label htmlFor="p">{t('admin.password')}</label><input id="p" type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
      {useBackup
        ? <div className="field"><label htmlFor="b">{t('admin.backup')}</label><input id="b" value={f.backup_code} onChange={(e) => setF({ ...f, backup_code: e.target.value })} /></div>
        : <div className="field"><label htmlFor="o">{t('admin.otp')}</label><input id="o" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={f.otp} onChange={(e) => setF({ ...f, otp: e.target.value })} /></div>}
      <div className="actions"><button className="btn" onClick={go}>{t('login.enter')}</button>
        <button className="btn ghost" onClick={() => setUseBackup(!useBackup)}>{useBackup ? t('admin.use_otp') : t('admin.use_backup')}</button></div>
      <ErrorText code={err} />
    </div>
  );
}

type Nav = [tab: string, perm: string, icon: string];
const GROUPS: [string, Nav[]][] = [
  ['main', [['home', '', 'grid']]],
  ['people', [['sellers', 'sellers', 'users'], ['imports', 'catalog', 'box'], ['applications', 'sellers', 'file'], ['commission', 'sellers', 'chart'], ['quality', 'sellers', 'star'], ['flags', 'sellers', 'warn']]],
  ['money', [['orders', 'orders', 'box'], ['payouts', 'finance', 'card'], ['analytics', 'finance', 'chart'], ['reports', 'finance', 'file'], ['model', 'finance', 'calc']]],
  ['accounting', [['accounting', 'accounting', 'book']]],
  ['support', [['complaints', 'support', 'chat'], ['reviews', 'support', 'star'], ['content', 'catalog', 'file']]],
  ['system', [['settings', 'settings', 'gear'], ['crm', 'settings', 'arrow'], ['roles', 'roles', 'shield'], ['audit', 'audit', 'shield']]],
];

function badges(ov: any): Record<string, number> {
  if (!ov) return {};
  const a = ov.accounting || {};
  return {
    applications: ov.applications_new || 0, sellers: (ov.sellers_pending || 0) + (ov.contracts_unconfirmed || 0),
    complaints: ov.complaints_new || 0, payouts: ov.payouts_requested || 0,
    accounting: (a.to_confirm || 0) + (a.to_pay_out || 0) + (a.discrepancies || 0),
  };
}

function Panel({ me, onLogout, t }: { me: any; onLogout: () => void; t: (k: string, v?: any) => string }) {
  const can = (p: string) => !p || me.permissions.includes('*') || me.permissions.includes(p);
  const groups = GROUPS.map(([g, items]) => [g, items.filter(([, p]) => can(p))] as [string, Nav[]]).filter(([, i]) => i.length);
  const tabs = groups.flatMap(([, i]) => i.map(([x]) => x));
  const [tab, setTabState] = useState('home');
  const [ov, setOv] = useState<any>(null);
  const loadOv = useCallback(() => api('/admin-api/overview').then(setOv).catch(() => setOv(null)), []);
  useEffect(() => {
    const fromHash = () => { const h = window.location.hash.slice(1); setTabState(tabs.includes(h) ? h : 'home'); };
    fromHash();
    loadOv();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setTab = (x: string) => {
    if (window.location.hash !== `#${x}`) window.history.pushState(null, '', `#${x}`);
    setTabState(x); if (x === 'home') loadOv(); window.scrollTo({ top: 0 });
  };
  const b = badges(ov);
  return (
    <div className="adm">
      <aside className="adm-side" aria-label={t('admin.title')}>
        <div className="adm-brand"><span className="adm-avatar" aria-hidden>{String(me.username || '?').slice(0, 1)}</span>
          <div><b>{me.username}</b><small>{me.superuser ? t('admin.superadmin') : t('admin.staff')}</small></div></div>
        {groups.map(([g, items]) => (
          <nav className="adm-group" key={g} aria-label={t(`admin.group.${g}`)}>
            {g !== 'main' && <h4>{t(`admin.group.${g}`)}</h4>}
            {items.map(([x, , icon]) => (
              <button key={x} className={`adm-link ${tab === x ? 'on' : ''}`} aria-current={tab === x ? 'page' : undefined} onClick={() => setTab(x)}>
                <Icon name={icon} /><span className="lbl">{t(`admin.tab.${x}`)}</span>{b[x] ? <span className="adm-badge">{b[x]}</span> : null}
              </button>))}
          </nav>))}
        <button className="btn ghost small" onClick={onLogout}><Icon name="logout" />{t('nav.logout')}</button>
      </aside>
      <section className="adm-main">
        <div className="adm-mobile-nav">
          <select aria-label={t('admin.title')} value={tab} onChange={(e) => setTab(e.target.value)}>
            {groups.map(([g, items]) => <optgroup key={g} label={t(`admin.group.${g}`)}>{items.map(([x]) => <option key={x} value={x}>{t(`admin.tab.${x}`)}{b[x] ? ` (${b[x]})` : ''}</option>)}</optgroup>)}
          </select>
        </div>
        <header className="adm-head"><div><h1>{t(`admin.tab.${tab}`)}</h1><p>{t(`admin.desc.${tab}`)}</p></div>
          <button className="btn ghost small adm-mobile-nav" onClick={onLogout}>{t('nav.logout')}</button></header>
        {tab === 'home' && <Home t={t} ov={ov} can={can} go={setTab} />}
        {tab === 'sellers' && <Sellers t={t} />}
        {tab === 'applications' && <Applications t={t} />}
        {tab === 'commission' && <Levels t={t} />}
        {tab === 'settings' && <SettingsTab t={t} />}
        {tab === 'complaints' && <Complaints t={t} />}
        {tab === 'audit' && <Audit t={t} />}
        {tab === 'orders' && <Orders t={t} />}
        {tab === 'payouts' && <Payouts t={t} />}
        {tab === 'roles' && <Roles t={t} superuser={me.superuser} />}
        {tab === 'analytics' && <Analytics t={t} />}
        {tab === 'reports' && <Reports t={t} />}
        {tab === 'quality' && <Quality t={t} />}
        {tab === 'flags' && <Flags t={t} />}
        {tab === 'reviews' && <ReviewsMod t={t} />}
        {tab === 'content' && <Content t={t} />}
        {tab === 'accounting' && <Accounting t={t} />}
        {tab === 'model' && <Model t={t} />}
        {tab === 'crm' && <Crm t={t} />}
        {tab === 'imports' && <SellerImport />}
      </section>
    </div>
  );
}

/** "Import a seller's database": AI determines the seller and the columns, asks about the rest, finds photos. */
function SellerImport() {
  const [sellers, setSellers] = useState<any[] | null>(null);
  useEffect(() => { api('/admin-api/imports').then((d) => setSellers(d.sellers)).catch(() => setSellers([])); }, []);
  if (!sellers) return <p className="muted">…</p>;
  return <ImportWizard base="/admin-api/imports" sellers={sellers} />;
}

/** Start page: one look shows what needs a human and where to click. */
function Home({ t, ov, can, go }: { t: any; ov: any; can: (p: string) => boolean; go: (x: string) => void }) {
  const lang = useLang();
  if (!ov) return <p className="muted">…</p>;
  const a = ov.accounting || {};
  const todo: [string, number | undefined, string][] = [
    ['applications_new', ov.applications_new, 'applications'], ['sellers_pending', ov.sellers_pending, 'sellers'],
    ['contracts_unconfirmed', ov.contracts_unconfirmed, 'accounting'], ['complaints_new', ov.complaints_new, 'complaints'],
    ['payouts_requested', ov.payouts_requested, 'payouts'], ['to_confirm', a.to_confirm, 'accounting'],
    ['to_pay_out', a.to_pay_out, 'accounting'], ['discrepancies', a.discrepancies, 'accounting'],
    ['seller_invoices_unconfirmed', a.seller_invoices_unconfirmed, 'accounting'],
  ];
  const shown = todo.filter(([, n]) => n !== undefined).sort((x, y) => Number((y[1] || 0) > 0) - Number((x[1] || 0) > 0));
  const hot = shown.filter(([, n]) => (n || 0) > 0);
  const th = ov.vat_threshold;
  return (
    <>
      <h3>{t('admin.home.todo')}</h3>
      {hot.length === 0 && <p className="adm-allclear"><Icon name="check" />{t('admin.home.all_clear')}</p>}
      <div className="adm-todo">{shown.map(([k, n, target]) => (
        <button key={k} className={(n || 0) > 0 ? 'hot' : ''} onClick={() => go(target)}><b>{n}</b><span>{t(`admin.home.${k}`)}</span>
          <small>{t(`admin.tab.${target}`)} →</small></button>))}</div>
      {can('orders') && ov.orders_30d !== undefined && (
        <div className="kpis">
          <div className="card kpi"><small>{t('admin.home.orders_30d')}</small><b>{ov.orders_30d}</b></div>
          <div className="card kpi"><small>{t('admin.home.gmv_30d')}</small><b>{money(ov.gmv_30d, lang)}</b></div>
          <div className="card kpi"><small>{t('admin.home.orders_paid')}</small><b>{ov.orders_paid}</b></div>
        </div>)}
      {th && <VatMeter t={t} th={th} />}
    </>
  );
}

function useList(url: string) {
  const [rows, setRows] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api(url).then(setRows).catch((e) => setErr(e.error)), [url]);
  useEffect(() => { load(); }, [load]);
  return { rows, err, load, setErr };
}

function Sellers({ t }: any) {
  const { rows, err, load, setErr } = useList('/admin-api/sellers');
  const [phone, setPhone] = useState<Record<number, string>>({});
  async function patch(id: number, body: any) { setErr(null); try { await api(`/admin-api/sellers/${id}`, { method: 'PATCH', body }); load(); } catch (e: any) { setErr(e.error); } }
  async function reveal(id: number) { const r = await api(`/admin-api/sellers/${id}/phone`, { method: 'POST', body: {} }); setPhone({ ...phone, [id]: r.phone }); }
  return (
    <div className="card table-wrap"><ErrorText code={err} />
      <table><thead><tr><th>#</th><th>{t('login.company')}</th><th>{t('admin.status')}</th><th>{t('seller.commission')} %</th><th>{t('admin.docs')}</th><th /></tr></thead>
        <tbody>{rows?.map((s: any) => (
          <tr key={s.id}><td>{s.id}</td><td>{s.company_name}</td>
            <td><span className={`tag ${s.status === 'approved' ? 'ok' : s.status === 'blocked' ? 'bad' : ''}`}>{t(`admin.seller_status.${s.status}`)}</span></td>
            <td><input style={{ width: 80 }} defaultValue={s.commission_override ?? ''} placeholder={s.commission_percent}
              onBlur={(e) => patch(s.id, { commission_override: e.target.value })} aria-label="commission" /></td>
            <td>{s.documents}</td>
            <td className="actions" style={{ margin: 0 }}>
              {s.status !== 'approved' && <button className="btn small" onClick={() => patch(s.id, { status: 'approved' })}>{t('admin.approve')}</button>}
              {s.status !== 'blocked' && <button className="btn danger small" onClick={() => patch(s.id, { status: 'blocked' })}>{t('admin.block')}</button>}
              {phone[s.id] ? <b>{phone[s.id]}</b> : <button className="btn ghost small" onClick={() => reveal(s.id)}>{t('seller.show_phone')}</button>}</td></tr>))}</tbody></table></div>
  );
}

function Levels({ t }: any) {
  const { rows, err, load, setErr } = useList('/admin-api/commission-levels');
  const [f, setF] = useState({ name: '', percent: '8' });
  async function add() { setErr(null); try { await api('/admin-api/commission-levels', { body: f }); load(); } catch (e: any) { setErr(e.error); } }
  return (
    <div className="card"><p className="muted small">{t('admin.commission_hint')}</p>
      <div className="row"><div><input value={f.name} placeholder={t('admin.level_name')} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><input type="number" min="0" max="30" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} /></div>
        <div style={{ flex: '0 0 auto' }}><button className="btn" onClick={add}>{t('add')}</button></div></div>
      <ErrorText code={err} />
      <table><tbody>{rows?.map((l: any) => <tr key={l.id}><td>{l.name}</td><td>{l.percent}%</td></tr>)}</tbody></table></div>
  );
}

function SettingsTab({ t }: any) {
  const { rows, err, load, setErr } = useList('/admin-api/settings');
  const [vals, setVals] = useState<any>({});
  useEffect(() => { if (rows) setVals(rows); }, [rows]);
  async function save() {
    setErr(null);
    const body: any = {};
    for (const [k, v] of Object.entries(vals)) body[k] = typeof v === 'boolean' || typeof rows?.[k] === 'string' ? v : Number(v);
    try { await api('/admin-api/settings', { method: 'PUT', body }); load(); } catch (e: any) { setErr(e.error); }
  }
  return (
    <div className="card"><ErrorText code={err} />
      <div className="adm-form">{Object.entries(vals).map(([k, v]) => (
        <div className="field" key={k}>
          {typeof v === 'boolean'
            ? <label className="check"><input type="checkbox" checked={v as boolean} onChange={(e) => setVals({ ...vals, [k]: e.target.checked })} /><span>{t(`setting.${k}`)}</span></label>
            : <><label htmlFor={k}>{t(`setting.${k}`)}</label><input id={k} type={typeof rows?.[k] === 'string' ? 'text' : 'number'} maxLength={100} value={v as any} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} /></>}
        </div>))}</div>
      <button className="btn" onClick={save}>{t('save')}</button></div>
  );
}

function Applications({ t }: any) {
  const { rows, load } = useList('/admin-api/seller-applications');
  if (rows && rows.length === 0) return <div className="empty card">{t('sellers.none')}</div>;
  return (
    <div className="card table-wrap"><table>
      <thead><tr><th>#</th><th>{t('apply.company')}</th><th>{t('apply.contact')}</th><th>{t('apply.category')}</th><th>{t('admin.when')}</th><th /></tr></thead>
      <tbody>{rows?.map((a: any) => (
        <tr key={a.id}><td>{a.id}</td><td>{a.company_name}</td>
          <td>{a.contact_name}<div className="muted small">{a.phone}{a.email && ` · ${a.email}`}</div></td>
          <td>{a.category}{a.comment && <div className="muted small" style={{ whiteSpace: 'pre-wrap', maxWidth: 320 }}>{a.comment}</div>}</td>
          <td>{new Date(a.created_at).toLocaleString()}</td>
          <td><select aria-label={t('apply.company')} value={a.status} onChange={async (e) => { await api(`/admin-api/seller-applications/${a.id}`, { method: 'PATCH', body: { status: e.target.value } }); load(); }}>
            {['new', 'in_progress', 'approved', 'rejected'].map((s) => <option key={s} value={s}>{t(`app.status.${s}`)}</option>)}</select></td></tr>))}</tbody></table></div>
  );
}

function Complaints({ t }: any) {
  const { rows, load } = useList('/admin-api/complaints');
  return (
    <div className="card table-wrap">{rows && rows.length === 0 && <p className="adm-empty">{t('admin.empty')}</p>}<table><tbody>{rows?.map((c: any) => (
      <tr key={c.id}><td>#{c.id}</td><td style={{ maxWidth: 380, whiteSpace: 'pre-wrap' }}>{c.text}</td><td>{c.order_id && `${t('order.number')} #${c.order_id}`}</td>
        <td><select value={c.status} onChange={async (e) => { await api(`/admin-api/complaints/${c.id}`, { method: 'PATCH', body: { status: e.target.value } }); load(); }}>
          {['new', 'in_progress', 'resolved'].map((s) => <option key={s} value={s}>{t(`admin.complaint_status.${s}`)}</option>)}</select></td></tr>))}</tbody></table></div>
  );
}

function Audit({ t }: any) {
  const { rows } = useList('/admin-api/audit');
  return (
    <div className="card table-wrap"><table><thead><tr><th>{t('admin.when')}</th><th>{t('admin.who')}</th><th>{t('admin.action')}</th><th>{t('admin.object')}</th><th>IP</th></tr></thead>
      <tbody>{rows?.map((a: any) => (
        <tr key={a.id}><td>{new Date(a.created_at).toLocaleString()}</td><td>{a.actor || a.actor_id || '—'}</td><td>{a.action}</td>
          <td>{a.object_type} {a.object_id} {a.order_id && `(${t('order.number')} #${a.order_id})`}</td><td>{a.ip}</td></tr>))}</tbody></table></div>
  );
}

function Orders({ t }: any) {
  const { rows, err, load, setErr } = useList('/admin-api/orders');
  async function refund(id: number, fault: string) {
    setErr(null); try { await api(`/admin-api/orders/${id}/refund`, { body: { fault } }); load(); } catch (e: any) { setErr(e.error); }
  }
  return (
    <div className="card table-wrap"><ErrorText code={err} /><table><thead><tr><th>#</th><th>{t('admin.status')}</th><th>{t('calc.total')}</th><th>{t('admin.paid')}</th><th>{t('admin.refund')}</th></tr></thead>
      <tbody>{rows?.map((o: any) => (
        <tr key={o.id}><td>{o.id}</td><td><span className={`tag ${o.status === 'completed' ? 'ok' : o.status === 'cancelled' ? 'bad' : ''}`}>{t(`status.${o.status}`)}</span></td><td className="n">{o.total}</td><td className="n">{o.amount_paid}</td>
          <td className="actions" style={{ margin: 0 }}>{o.amount_paid !== '0.00' && o.status !== 'cancelled' && ['client', 'seller', 'bmg'].map((f) =>
            <button key={f} className="btn ghost small" onClick={() => confirm(t('admin.refund_confirm')) && refund(o.id, f)}>{t(`fault.${f}`)}</button>)}</td></tr>))}</tbody></table></div>
  );
}

function Payouts({ t }: any) {
  const { rows, load } = useList('/admin-api/payouts');
  async function act(id: number, action: string) { await api(`/admin-api/payouts/${id}`, { body: { action } }); load(); }
  return (
    <div className="card table-wrap">{rows && rows.length === 0 && <p className="adm-empty">{t('admin.empty')}</p>}<table><tbody>{rows?.map((p: any) => (
      <tr key={p.id}><td>#{p.id}</td><td>{t('admin.seller')} #{p.seller_id}</td><td className="n">{p.amount}</td><td><span className={`tag ${p.status === 'paid' ? 'ok' : p.status === 'rejected' ? 'bad' : 'warn'}`}>{t(`admin.payout_status.${p.status}`)}</span></td>
        <td>{p.status === 'requested' && <><button className="btn small" onClick={() => act(p.id, 'pay')}>{t('admin.mark_paid')}</button>{' '}
          <button className="btn ghost small" onClick={() => act(p.id, 'reject')}>{t('admin.reject')}</button></>}</td></tr>))}</tbody></table></div>
  );
}

function Roles({ t, superuser }: any) {
  const { rows, err, load, setErr } = useList('/admin-api/roles');
  const [name, setName] = useState('');
  const [perms, setPerms] = useState<string[]>([]);
  const [staff, setStaff] = useState({ username: '', password: '', role_id: '' });
  const [created, setCreated] = useState<any>(null);
  async function addRole() { setErr(null); try { await api('/admin-api/roles', { body: { name, permissions: perms } }); setName(''); setPerms([]); load(); } catch (e: any) { setErr(e.error); } }
  async function addStaff() { setErr(null); try { setCreated(await api('/admin-api/staff', { body: staff })); } catch (e: any) { setErr(e.error); } }
  return (
    <div className="split">
      <div className="card"><h3>{t('admin.roles')}</h3><ErrorText code={err} />
        {rows?.roles.map((r: any) => <p key={r.id}><b>{r.name}</b>: {r.permissions.map((p: string) => t(`admin.perm.${p}`)).join(', ') || '—'}</p>)}
        <input value={name} placeholder={t('admin.role_name')} onChange={(e) => setName(e.target.value)} />
        <div className="tabs">{rows?.all_permissions.map((p: string) => (
          <label className="check" key={p}><input type="checkbox" checked={perms.includes(p)} onChange={(e) => setPerms(e.target.checked ? [...perms, p] : perms.filter((x) => x !== p))} />{t(`admin.perm.${p}`)}</label>))}</div>
        <button className="btn" disabled={!name || !superuser} onClick={addRole}>{t('add')}</button>
        {!superuser && <p className="muted small">{t('admin.only_superadmin')}</p>}</div>
      <div className="card"><h3>{t('admin.new_staff')}</h3>
        <div className="field"><input value={staff.username} placeholder={t('admin.username')} onChange={(e) => setStaff({ ...staff, username: e.target.value })} /></div>
        <div className="field"><input type="password" value={staff.password} placeholder={t('admin.password')} autoComplete="new-password" onChange={(e) => setStaff({ ...staff, password: e.target.value })} /></div>
        <div className="field"><select value={staff.role_id} onChange={(e) => setStaff({ ...staff, role_id: e.target.value })}>
          <option value="">—</option>{rows?.roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
        <button className="btn" disabled={!superuser} onClick={addStaff}>{t('add')}</button>
        {created && <div className="notice"><p>{t('admin.shown_once')}</p><p style={{ wordBreak: 'break-all' }}>{created.totp_uri}</p><p>{created.backup_codes.join('  ')}</p></div>}</div>
    </div>
  );
}
