'use client';
import { useEffect, useState } from 'react';
import { ErrorText } from './Bits';
import { useT } from './Providers';
import { api } from '@/lib/api';

type Pending = { order_id: number; seller_id: number; seller: string };

/** Client: orders delivered but not yet reviewed. One review per order and seller. */
export default function ReviewForm() {
  const t = useT();
  const [list, setList] = useState<Pending[] | null>(null);
  const [form, setForm] = useState<Record<string, { rating: number; text: string }>>({});
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const load = () => api<Pending[]>('/api/v1/reviews').then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  const key = (p: Pending) => `${p.order_id}-${p.seller_id}`;
  async function send(p: Pending) {
    const f = form[key(p)] || { rating: 5, text: '' };
    setErr(null); setDone(false);
    try { await api('/api/v1/reviews', { body: { order_id: p.order_id, seller_id: p.seller_id, rating: f.rating, text: f.text } }); setDone(true); load(); }
    catch (e: any) { setErr(e.error); }
  }
  if (list === null) return <p className="muted">…</p>;
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))' }}>
      <p className="muted" style={{ gridColumn: '1 / -1', margin: 0 }}>{list.length ? t('review.pending') : t('review.none_pending')}</p>
      {done && <p className="ok" style={{ gridColumn: '1 / -1' }}>{t('review.sent')}</p>}
      <ErrorText code={err} />
      {list.map((p) => {
        const f = form[key(p)] || { rating: 5, text: '' };
        const set = (v: Partial<typeof f>) => setForm({ ...form, [key(p)]: { ...f, ...v } });
        return (
          <div className="card" key={key(p)}>
            <h3>{p.seller}</h3>
            <p className="muted small">{t('review.order', { n: p.order_id })}</p>
            <div className="field"><label htmlFor={`r${key(p)}`}>{t('review.rating')}</label>
              <div className="rate-pick" role="radiogroup" aria-label={t('review.rating')}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={f.rating === n} aria-label={`${n}`} className={n <= f.rating ? 'on' : ''} onClick={() => set({ rating: n })}>★</button>
                ))}
              </div></div>
            <div className="field"><label htmlFor={`t${key(p)}`}>{t('review.text')}</label>
              <textarea id={`t${key(p)}`} maxLength={1000} value={f.text} onChange={(e) => set({ text: e.target.value })} /></div>
            <button className="btn" onClick={() => send(p)}>{t('review.send')}</button>
          </div>
        );
      })}
    </div>
  );
}
