'use client';
import { useCallback, useEffect, useState } from 'react';
import { ErrorText, RequireAuth } from '@/components/Bits';
import ReviewForm from '@/components/ReviewForm';
import SavedCards from '@/components/SavedCards';
import { useLang, useT } from '@/components/Providers';
import { api, money } from '@/lib/api';

export default function AccountPage() {
  return <RequireAuth role="client"><Account /></RequireAuth>;
}

function Account() {
  const t = useT();
  const lang = useLang();
  const [tab, setTab] = useState('wallet');
  const [wallet, setWallet] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [amount, setAmount] = useState('100000');
  const [text, setText] = useState('');
  const [orderId, setOrderId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const load = useCallback(async () => {
    setWallet(await api('/api/v1/wallet')); setOrders(await api('/api/v1/orders'));
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  async function topup() {
    setErr(null);
    try { const r = await api('/api/v1/wallet/topup', { body: { amount } }); window.location.href = r.pay_url; }
    catch (e: any) { setErr(e.error); }
  }
  async function complain() {
    setErr(null); setSent(false);
    try { await api('/api/v1/complaints', { body: { text, ...(orderId ? { order_id: orderId } : {}) } }); setSent(true); setText(''); }
    catch (e: any) { setErr(e.error); }
  }
  async function pay(id: number) {
    setErr(null);
    try { await api(`/api/v1/orders/${id}/pay`, { method: 'POST', body: {} }); await load(); } catch (e: any) { setErr(e.error); }
  }
  return (
    <>
      <h1>{t('nav.account')}</h1>
      <div className="tabs">{['wallet', 'orders', 'reviews', 'complaint'].map((x) =>
        <button key={x} className={`btn ${tab === x ? 'on' : ''}`} onClick={() => setTab(x)}>{t(`account.${x}`)}</button>)}</div>
      {tab === 'wallet' && wallet && (
        <div className="card">
          <p>{t('wallet.balance')}: <span className="price">{money(wallet.balance, lang)}</span></p>
          <p className="muted small">{t('wallet.note')}</p>
          <div className="row"><div><label htmlFor="am">{t('wallet.amount')}</label>
            <input id="am" type="number" min="1000" step="1000" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div style={{ flex: '0 0 auto' }}><button className="btn" onClick={topup}>{t('wallet.topup_click')}</button></div></div>
          <ErrorText code={err} />
          <div className="table-wrap"><table><tbody>{wallet.entries.map((e: any, i: number) =>
            <tr key={i}><td>{new Date(e.at).toLocaleString(lang)}</td><td>{t(`ledger.${e.kind}`)}</td><td>{money(e.amount, lang)}</td></tr>)}</tbody></table></div>
        </div>
      )}
      {tab === 'wallet' && wallet && <SavedCards amount={amount} orders={orders} onChange={() => load().catch(() => {})} />}
      {tab === 'orders' && (
        <div className="grid">{orders.length === 0 && <p className="muted">{t('orders.empty')}</p>}
          {orders.map((o) => (
            <div className="card" key={o.id}>
              <h3>#{o.id} <span className="tag">{t(`status.${o.status}`)}</span></h3>
              <ul>{o.items.map((i: any) => <li key={i.id}>{i.name} × {Number(i.qty)}</li>)}</ul>
              <div className="price">{money(o.total, lang)}</div>
              {o.status === 'pending_payment' && <button className="btn small" onClick={() => pay(o.id)}>{t('order.pay')} ({money(o.amount_due_online, lang)})</button>}
            </div>))}
          <ErrorText code={err} />
        </div>
      )}
      {tab === 'reviews' && <ReviewForm />}
      {tab === 'complaint' && (
        <div className="card">
          <div className="field"><label htmlFor="ct">{t('complaint.text')}</label><textarea id="ct" maxLength={3000} value={text} onChange={(e) => setText(e.target.value)} /></div>
          <div className="field"><label htmlFor="oi">{t('complaint.order')}</label><input id="oi" inputMode="numeric" value={orderId} onChange={(e) => setOrderId(e.target.value)} /></div>
          <button className="btn" disabled={!text.trim()} onClick={complain}>{t('complaint.send')}</button>
          {sent && <p className="ok">{t('complaint.sent')}</p>}<ErrorText code={err} />
        </div>
      )}
    </>
  );
}
