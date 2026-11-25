'use client';
import { useCallback, useEffect, useState } from 'react';
import { ErrorText } from './Bits';
import { api } from '@/lib/api';

type T = (k: string, v?: any) => string;
const STATUSES = ['pending', 'delivered', 'failed'] as const;
const tag = (s: string) => (s === 'delivered' ? 'ok' : s === 'failed' ? 'bad' : 'warn');
const when = (v: string | null) => (v ? new Date(v).toLocaleString() : '—');

/** CRM (Nexio) integration: keys live in the server .env and are shown masked; test event; last 100 deliveries. */
export function Crm({ t }: { t: T }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<any>(null);
  const load = useCallback(() => api('/admin-api/crm').then(setD).catch((e) => setErr(e.error)), []);
  useEffect(() => { load(); }, [load]);
  async function run(path: string, after?: (r: any) => void) {
    setErr(null); setBusy(true);
    try { const r = await api(path, { body: {} }); after?.(r); await load(); } catch (e: any) { setErr(e.error); } finally { setBusy(false); }
  }
  if (!d) return <div className="card"><ErrorText code={err} /><p className="muted">…</p></div>;
  const c = d.config;
  const yes = (v: boolean) => <span className={`tag ${v ? 'ok' : 'bad'}`}>{v ? t('crm.set') : t('crm.not_set')}</span>;
  return (
    <>
      <div className="split">
        <div className="card">
          <h3>{t('crm.push')}</h3>
          <table><tbody>
            <tr><td>{t('crm.url')}</td><td style={{ wordBreak: 'break-all' }}>{c.endpoint || yes(false)}</td></tr>
            <tr><td>{t('crm.api_key')}</td><td>{c.api_key || yes(false)}</td></tr>
            <tr><td>{t('crm.secret')}</td><td>{yes(c.secret_set)}</td></tr>
          </tbody></table>
          {c.base_url && !c.https && <p className="notice">{t('crm.https_warn')}</p>}
          <p className="muted small">{t('crm.env_note')}</p>
          <div className="actions">
            <button className="btn" disabled={busy || !c.configured} onClick={() => run('/admin-api/crm/test', setTest)}>{t('crm.send_test')}</button>
          </div>
          {test && <p className="small"><span className={`tag ${tag(test.status)}`}>{t(`crm.status.${test.status}`)}</span>{' '}
            {test.last_status_code ?? '—'} {test.last_error && <code style={{ wordBreak: 'break-all' }}>{test.last_error}</code>}</p>}
          <ErrorText code={err} />
        </div>
        <div className="card">
          <h3>{t('crm.pull')}</h3>
          <table><tbody>
            <tr><td>{t('crm.read_key')}</td><td>{yes(c.read_key_set)}</td></tr>
            <tr><td>{t('crm.read_ips')}</td><td>{c.read_ips.length ? c.read_ips.join(', ') : t('crm.any_ip')}</td></tr>
            <tr><td>URL</td><td><code>/api/crm/v1/orders</code></td></tr>
          </tbody></table>
          <div className="kpis">{STATUSES.map((s) => (
            <div className="card kpi" key={s}><small>{t(`crm.status.${s}`)}</small><b>{d.counts[s]}</b></div>))}</div>
        </div>
      </div>
      <div className="card table-wrap">
        <h3>{t('crm.last')}</h3>
        {d.events.length === 0 && <p className="adm-empty">{t('admin.empty')}</p>}
        <table>
          <thead><tr><th>{t('admin.when')}</th><th>{t('crm.event')}</th><th>{t('order.number')}</th><th>v</th><th>{t('admin.status')}</th>
            <th>{t('crm.attempts')}</th><th>HTTP</th><th>{t('crm.error')}</th><th /></tr></thead>
          <tbody>{d.events.map((e: any) => (
            <tr key={e.id}>
              <td>{when(e.created_at)}</td>
              <td>{e.event_type}{e.is_test && <span className="tag"> {t('crm.test')}</span>}</td>
              <td>{e.order_id ? `#${e.order_id}` : '—'}</td><td className="n">{e.order_version}</td>
              <td><span className={`tag ${tag(e.status)}`}>{t(`crm.status.${e.status}`)}</span>
                {e.blocked && <div className="muted small">{t('crm.blocked')}</div>}
                {e.next_attempt_at && <div className="muted small">{t('crm.next', { d: when(e.next_attempt_at) })}</div>}</td>
              <td className="n">{e.attempts}</td><td className="n">{e.last_status_code ?? '—'}</td>
              <td className="small" style={{ maxWidth: 320, wordBreak: 'break-all' }} title={e.last_error}>{e.last_error ? e.last_error.slice(0, 160) : ''}</td>
              <td>{e.status !== 'delivered' && <button className="btn ghost small" disabled={busy} onClick={() => run(`/admin-api/crm/events/${e.id}/resend`)}>{t('crm.resend')}</button>}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </>
  );
}
