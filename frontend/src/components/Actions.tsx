'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { ErrorText } from './Bits';
import { useAuth, useLang, useT } from './Providers';

export function AddToCart({ offerId }: { offerId: number }) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const { me } = useAuth();
  const [qty, setQty] = useState('1');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function add() {
    if (!me) return router.push(`/${lang}/login`);
    setErr(null);
    try { await api('/api/v1/cart', { body: { offer_id: offerId, qty } }); setDone(true); }
    catch (e: any) { setErr(e.error); }
  }
  return (
    <span>
      <input style={{ width: 90, marginRight: 8 }} type="number" min="0.001" step="any" value={qty} onChange={(e) => setQty(e.target.value)} aria-label={t('qty')} />
      <button className="btn small" onClick={add}>{done ? '✓' : t('cart.add')}</button>
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
    if (!me) return router.push(`/${lang}/login`);
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
