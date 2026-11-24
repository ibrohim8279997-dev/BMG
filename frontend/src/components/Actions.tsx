'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { clearPending, loginUrl, peekPending, savePending } from '@/lib/pending';
import { ErrorText, notifyCart } from './Bits';
import Icon from './Icon';
import { useAuth, useLang, useT } from './Providers';

export function AddToCart({ offerId, compact = false }: { offerId: number; compact?: boolean }) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const { me } = useAuth();
  const [qty, setQty] = useState('1');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function put(q: string) {
    setErr(null);
    try { await api('/api/v1/cart', { body: { offer_id: offerId, qty: q } }); setDone(true); notifyCart(); }
    catch (e: any) { setErr(e.error); }
  }
  function add() {
    if (me) return put(qty);
    // guest: remember the choice, log in, come back to this very page and finish adding
    savePending({ kind: 'cart', offer_id: offerId, qty });
    router.push(loginUrl(lang, window.location.pathname + window.location.search));
  }
  useEffect(() => {   // back from login: finish the add that was interrupted
    const p = peekPending();
    if (me && p?.kind === 'cart' && p.offer_id === offerId) { clearPending(); setQty(p.qty); put(p.qty); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);
  return (
    <span>
      {!compact && <input style={{ width: 90, marginRight: 8 }} type="number" min="0.001" step="any" value={qty} onChange={(e) => setQty(e.target.value)} aria-label={t('qty')} />}
      <button className={`btn small ${compact ? 'block ghost' : ''} ${done ? 'done' : ''}`} onClick={add}>{done ? <><Icon name="check" /> {t('cart.added')}</> : <><Icon name="cart" /> {t('cart.add')}</>}</button>
      <ErrorText code={err} />
    </span>
  );
}

export function SellerContact({ sellerId, hasDocs }: { sellerId: number; hasDocs: boolean }) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const { me } = useAuth();
  const [phone, setPhone] = useState<string | null>(null);
  const [docs, setDocs] = useState<{ id: number; title: string; type: string }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function reveal() {
    if (!me) return router.push(loginUrl(lang, window.location.pathname));
    try { setPhone((await api(`/api/v1/sellers/${sellerId}/phone`, { method: 'POST', body: {} })).phone); }
    catch (e: any) { setErr(e.error); }
  }
  async function showDocs() {
    try { setDocs(await api(`/api/v1/sellers/${sellerId}/documents`)); } catch (e: any) { setErr(e.error); }
  }
  return (
    <div className="card">
      <div className="actions" style={{ marginTop: 0 }}>
        {phone ? <strong>{phone}</strong> : <button className="btn" onClick={reveal}>{t('seller.show_phone')}</button>}
        {hasDocs && <button className="btn ghost" onClick={showDocs}>{t('seller.view_docs')}</button>}
      </div>
      <p className="muted small">{t('seller.phone_note')}</p>
      <ErrorText code={err} />
      {docs && (docs.length === 0 ? <p className="muted">{t('seller.no_docs')}</p> :
        <ul>{docs.map((d) => <li key={d.id}><a href={`/api/v1/files/${d.id}`} target="_blank" rel="noopener noreferrer">{d.title || `#${d.id}`} ({d.type})</a></li>)}</ul>)}
    </div>
  );
}
