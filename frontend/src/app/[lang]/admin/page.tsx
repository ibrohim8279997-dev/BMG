'use client';
import { useCallback, useEffect, useState } from 'react';
import { ErrorText } from '@/components/Bits';
import { useT } from '@/components/Providers';
import { api } from '@/lib/api';

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

const ALL_TABS = [['sellers', 'sellers'], ['commission', 'sellers'], ['settings', 'settings'], ['complaints', 'support'],
  ['audit', 'audit'], ['orders', 'orders'], ['payouts', 'finance'], ['roles', 'roles']];

function Panel({ me, onLogout, t }: { me: any; onLogout: () => void; t: (k: string) => string }) {
  const can = (p: string) => me.permissions.includes('*') || me.permissions.includes(p);
  const tabs = ALL_TABS.filter(([, p]) => can(p)).map(([n]) => n);
  const [tab, setTab] = useState(tabs[0] || '');
  return (
    <>
      <div className="row" style={{ alignItems: 'center' }}><h1>{t('admin.title')}</h1>
        <div style={{ flex: '0 0 auto' }}><button className="btn ghost" onClick={onLogout}>{t('nav.logout')}</button></div></div>
      <div className="tabs">{tabs.map((x) => <button key={x} className={`btn ${tab === x ? 'on' : ''}`} onClick={() => setTab(x)}>{t(`admin.tab.${x}`)}</button>)}</div>
      {tab === 'sellers' && <Sellers t={t} />}
      {tab === 'commission' && <Levels t={t} />}
      {tab === 'settings' && <SettingsTab t={t} />}
      {tab === 'complaints' && <Complaints t={t} />}
      {tab === 'audit' && <Audit t={t} />}
      {tab === 'orders' && <Orders t={t} />}
      {tab === 'payouts' && <Payouts t={t} />}
      {tab === 'roles' && <Roles t={t} />}
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
            <td><span className={`tag ${s.status === 'approved' ? 'ok' : s.status === 'blocked' ? 'bad' : ''}`}>{s.status}</span></td>
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
    for (const [k, v] of Object.entries(vals)) body[k] = typeof v === 'boolean' ? v : Number(v);
    try { await api('/admin-api/settings', { method: 'PUT', body }); load(); } catch (e: any) { setErr(e.error); }
  }
  return (
    <div className="card"><ErrorText code={err} />
      {Object.entries(vals).map(([k, v]) => (
        <div className="field" key={k}>
          {typeof v === 'boolean'
            ? <label className="check"><input type="checkbox" checked={v as boolean} onChange={(e) => setVals({ ...vals, [k]: e.target.checked })} /><span>{t(`setting.${k}`)}</span></label>
            : <><label htmlFor={k}>{t(`setting.${k}`)}</label><input id={k} type="number" value={v as any} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} /></>}
        </div>))}
      <button className="btn" onClick={save}>{t('save')}</button></div>
  );
}

function Complaints({ t }: any) {
  const { rows, load } = useList('/admin-api/complaints');
  return (
    <div className="card table-wrap"><table><tbody>{rows?.map((c: any) => (
      <tr key={c.id}><td>#{c.id}</td><td style={{ maxWidth: 380, whiteSpace: 'pre-wrap' }}>{c.text}</td><td>{c.order_id && `${t('order.number')} #${c.order_id}`}</td>
        <td><select value={c.status} onChange={async (e) => { await api(`/admin-api/complaints/${c.id}`, { method: 'PATCH', body: { status: e.target.value } }); load(); }}>
          {['new', 'in_progress', 'resolved'].map((s) => <option key={s} value={s}>{s}</option>)}</select></td></tr>))}</tbody></table></div>
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
        <tr key={o.id}><td>{o.id}</td><td>{o.status}</td><td>{o.total}</td><td>{o.amount_paid}</td>
          <td className="actions" style={{ margin: 0 }}>{o.amount_paid !== '0.00' && o.status !== 'cancelled' && ['client', 'seller', 'bmg'].map((f) =>
            <button key={f} className="btn ghost small" onClick={() => confirm(t('admin.refund_confirm')) && refund(o.id, f)}>{t(`fault.${f}`)}</button>)}</td></tr>))}</tbody></table></div>
  );
}

function Payouts({ t }: any) {
  const { rows, load } = useList('/admin-api/payouts');
  async function act(id: number, action: string) { await api(`/admin-api/payouts/${id}`, { body: { action } }); load(); }
  return (
    <div className="card table-wrap"><table><tbody>{rows?.map((p: any) => (
      <tr key={p.id}><td>#{p.id}</td><td>{t('admin.seller')} {p.seller_id}</td><td>{p.amount}</td><td>{p.status}</td>
        <td>{p.status === 'requested' && <><button className="btn small" onClick={() => act(p.id, 'pay')}>{t('admin.mark_paid')}</button>{' '}
          <button className="btn ghost small" onClick={() => act(p.id, 'reject')}>{t('admin.reject')}</button></>}</td></tr>))}</tbody></table></div>
  );
}

function Roles({ t }: any) {
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
        {rows?.roles.map((r: any) => <p key={r.id}><b>{r.name}</b>: {r.permissions.join(', ') || '—'}</p>)}
        <input value={name} placeholder={t('admin.role_name')} onChange={(e) => setName(e.target.value)} />
        <div className="tabs">{rows?.all_permissions.map((p: string) => (
          <label className="check" key={p}><input type="checkbox" checked={perms.includes(p)} onChange={(e) => setPerms(e.target.checked ? [...perms, p] : perms.filter((x) => x !== p))} />{p}</label>))}</div>
        <button className="btn" disabled={!name} onClick={addRole}>{t('add')}</button></div>
      <div className="card"><h3>{t('admin.new_staff')}</h3>
        <div className="field"><input value={staff.username} placeholder={t('admin.username')} onChange={(e) => setStaff({ ...staff, username: e.target.value })} /></div>
        <div className="field"><input type="password" value={staff.password} placeholder={t('admin.password')} autoComplete="new-password" onChange={(e) => setStaff({ ...staff, password: e.target.value })} /></div>
        <div className="field"><select value={staff.role_id} onChange={(e) => setStaff({ ...staff, role_id: e.target.value })}>
          <option value="">—</option>{rows?.roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
        <button className="btn" onClick={addStaff}>{t('add')}</button>
        {created && <div className="notice"><p>{t('admin.shown_once')}</p><p style={{ wordBreak: 'break-all' }}>{created.totp_uri}</p><p>{created.backup_codes.join('  ')}</p></div>}</div>
    </div>
  );
}
