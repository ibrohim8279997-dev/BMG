'use client';
import { useCallback, useEffect, useState } from 'react';
import { ErrorText } from './Bits';
import { useLang, useT } from './Providers';
import { api, money } from '@/lib/api';

/** Bank cards saved through Click (card token). The number goes to our server only to be passed to Click, which texts
 *  the card owner a code; afterwards we keep just Click's token and the masked number. Charges go to the BMG account. */
export default function SavedCards({ amount, orders, onChange }: { amount: string; orders: any[]; onChange: () => void }) {
  const t = useT();
  const lang = useLang();
  const [state, setState] = useState<{ enabled: boolean; cards: any[] } | null>(null);
  const [num, setNum] = useState('');
  const [exp, setExp] = useState('');
  const [pending, setPending] = useState<{ id: number; phone_hint: string } | null>(null);
  const [sms, setSms] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api('/api/v1/payments/cards').then(setState).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e: any) { setErr(e.error); }
    setBusy(false);
  }
  const add = () => run(async () => {
    setPending(await api('/api/v1/payments/cards', { body: { card_number: num, expire_date: exp } }));
    setNum(''); setExp('');
  });
  const verify = () => run(async () => {
    await api(`/api/v1/payments/cards/${pending!.id}/verify`, { body: { sms_code: sms } });
    setPending(null); setSms(''); await load();
  });
  const remove = (id: number) => run(async () => { await api(`/api/v1/payments/cards/${id}`, { method: 'DELETE' }); await load(); });
  const topup = (id: number) => run(async () => { await api(`/api/v1/payments/cards/${id}/topup`, { body: { amount } }); onChange(); });
  const payOrder = (id: number, orderId: number) => run(async () => {
    await api(`/api/v1/payments/cards/${id}/pay-order`, { body: { order_id: orderId } }); onChange();
  });

  if (!state?.enabled) return null;
  const unpaid = orders.filter((o) => o.status === 'pending_payment');
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>{t('card.title')}</h3>
      <p className="muted small">{t('card.note')}</p>
      {state.cards.map((c) => (
        <div className="row" key={c.id} style={{ alignItems: 'center' }}>
          <div><strong>{c.masked}</strong></div>
          <div style={{ flex: '0 0 auto' }} className="actions">
            <button className="btn small" disabled={busy} onClick={() => topup(c.id)}>{t('card.topup')} {money(amount, lang)}</button>
            {unpaid.map((o) => <button key={o.id} className="btn small" disabled={busy} onClick={() => payOrder(c.id, o.id)}>
              {t('card.pay_order')} #{o.id} ({money(o.amount_due_online, lang)})</button>)}
            <button className="btn small ghost" disabled={busy} onClick={() => remove(c.id)}>{t('card.remove')}</button>
          </div>
        </div>))}
      {pending ? (
        <div className="row">
          <div><label htmlFor="sms">{t('card.sms')} {pending.phone_hint}</label>
            <input id="sms" inputMode="numeric" maxLength={8} autoComplete="one-time-code" value={sms} onChange={(e) => setSms(e.target.value)} /></div>
          <div style={{ flex: '0 0 auto' }}><button className="btn" disabled={busy || sms.length < 4} onClick={verify}>{t('card.confirm')}</button></div>
        </div>
      ) : (
        <div className="row">
          <div><label htmlFor="cn">{t('card.number')}</label>
            <input id="cn" inputMode="numeric" autoComplete="cc-number" maxLength={23} placeholder="8600 0000 0000 0000" value={num} onChange={(e) => setNum(e.target.value)} /></div>
          <div style={{ flex: '0 0 120px' }}><label htmlFor="ce">{t('card.expiry')}</label>
            <input id="ce" inputMode="numeric" autoComplete="cc-exp" maxLength={5} placeholder="MM/YY" value={exp} onChange={(e) => setExp(e.target.value)} /></div>
          <div style={{ flex: '0 0 auto' }}><button className="btn" disabled={busy || num.replace(/\D/g, '').length < 16} onClick={add}>{t('card.add')}</button></div>
        </div>
      )}
      <ErrorText code={err} />
    </div>
  );
}
