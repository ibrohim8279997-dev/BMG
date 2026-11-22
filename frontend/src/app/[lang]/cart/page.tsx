'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ErrorText, RequireAuth } from '@/components/Bits';
import { useLang, useT } from '@/components/Providers';
import { api, money } from '@/lib/api';

export default function CartPage() {
  return <RequireAuth role="client"><Cart /></RequireAuth>;
}

function Cart() {
  const t = useT();
  const lang = useLang();
  const [items, setItems] = useState<any[]>([]);
  const [city, setCity] = useState('Tashkent');
  const [mode, setMode] = useState('full');
  const [order, setOrder] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [wallet, setWallet] = useState<any>(null);
  const load = useCallback(async () => {
    setItems(await api('/api/v1/cart'));
    setWallet(await api('/api/v1/wallet'));
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  async function remove(id: number) { await api(`/api/v1/cart/${id}`, { method: 'DELETE' }); load(); }
  async function checkout() {
    setErr(null);
    try { setOrder(await api('/api/v1/orders', { body: { city, payment_mode: mode } })); await load(); }
    catch (e: any) { setErr(e.error); }
  }
  async function pay() {
    setErr(null);
    try { setOrder(await api(`/api/v1/orders/${order.id}/pay`, { method: 'POST', body: {} })); await load(); }
    catch (e: any) { setErr(e.error); }
  }
  const sum = items.reduce((a, i) => a + Number(i.unit_price) * Number(i.qty), 0);
  return (
    <>
      <h1>{t('nav.cart')}</h1>
      {order ? (
        <div className="card">
          <h3>{t('order.number')} #{order.id} <span className="tag">{t(`status.${order.status}`)}</span></h3>
          <p>{t('calc.goods')}: {money(order.goods_total, lang)} · {t('calc.delivery')}: {money(order.delivery_total, lang)}</p>
          <p className="price">{t('calc.total')}: {money(order.total, lang)}</p>
          <p>{t('order.prepayment')}: <strong>{money(order.prepayment, lang)}</strong> <span className="muted small">({t('order.prepayment_note')})</span></p>
          {order.status === 'pending_payment' && (
            <>
              <p>{t('order.to_pay')}: <strong>{money(order.amount_due_online, lang)}</strong> · {t('wallet.balance')}: {wallet && money(wallet.balance, lang)}</p>
              <div className="actions"><button className="btn" onClick={pay}>{t('order.pay')}</button>
                <Link className="btn ghost" href={`/${lang}/account`}>{t('wallet.topup')}</Link></div>
            </>
          )}
          {order.payment_mode === 'cash' && <p className="muted small">{t('order.cash_note')}</p>}
          <ErrorText code={err} />
        </div>
      ) : items.length === 0 ? <p className="muted">{t('cart.empty')}</p> : (
        <>
          <div className="card table-wrap"><table>
            <thead><tr><th>{t('calc.material')}</th><th>{t('product.seller')}</th><th>{t('calc.qty')}</th><th>{t('product.price')}</th><th /></tr></thead>
            <tbody>{items.map((i) => (
              <tr key={i.id}><td>{i.name}{!i.available && <div className="error small">{t('err.offer_unavailable')}</div>}</td><td>{i.seller}</td>
                <td>{Number(i.qty)}</td><td>{money(i.unit_price, lang)}</td>
                <td><button className="btn ghost small" onClick={() => remove(i.id)}>✕</button></td></tr>))}</tbody>
          </table></div>
          <div className="card" style={{ marginTop: 16 }}>
            <p>{t('calc.goods')}: <strong>{money(sum, lang)}</strong> <span className="muted small">({t('cart.delivery_at_checkout')})</span></p>
            <div className="row">
              <div><label htmlFor="c">{t('calc.city')}</label><input id="c" value={city} onChange={(e) => setCity(e.target.value)} /></div>
              <div><label htmlFor="m">{t('order.payment_mode')}</label>
                <select id="m" value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="full">{t('order.mode_full')}</option><option value="cash">{t('order.mode_cash')}</option></select></div>
            </div>
            <p className="muted small">{t('order.mode_hint')}</p>
            <button className="btn" onClick={checkout}>{t('order.create')}</button>
            <ErrorText code={err} />
          </div>
        </>
      )}
    </>
  );
}
