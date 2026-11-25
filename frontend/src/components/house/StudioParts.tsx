'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { thumbUrl } from '@/lib/house/materials/registry';
import { useLang, useT } from '../Providers';

/** Material picker cards with a real texture swatch (tinted by the colour that will be applied). */
export function MatGrid<T extends string>({ label, items, value, color, name, onPick }: {
  label: string; items: readonly T[]; value: T; color: (m: T) => string; name: (m: T) => string; onPick: (m: T) => void;
}) {
  return (
    <div>
      <span className="hs-label">{label}</span>
      <div className="hs-mats" role="radiogroup" aria-label={label}>
        {items.map((m) => (
          <button type="button" key={m} role="radio" aria-checked={value === m} className={`mat-card ${value === m ? 'on' : ''}`} onClick={() => onPick(m)}>
            <i className="mt mt-tex" style={{ backgroundImage: `url(${thumbUrl(m)})`, backgroundColor: color(m) }} />
            {name(m)}
          </button>
        ))}
      </div>
    </div>
  );
}

type Product = { id: number; name: string; min_price?: string | number | null; unit?: string };

/** Up to three catalogue products for the picked material, with a link to the full search. */
export function CatalogMatch({ mat }: { mat: string }) {
  // the search words live in the dictionaries (studio.cq.*): sellers name products in the shop's language
  const t = useT(), lang = useLang(), key = `studio.cq.${mat}`, word = t(key), q = word && word !== key ? word : null;
  const [items, setItems] = useState<Product[] | null>(null);
  useEffect(() => {
    if (!q) return;
    let on = true; setItems(null);
    api<{ results: Product[] }>(`/api/v1/products?${new URLSearchParams({ q, lang, page: '1' })}`)
      .then((r) => { if (on) setItems((r?.results || []).slice(0, 3)); }).catch(() => { if (on) setItems([]); });
    return () => { on = false; };
  }, [q, lang]);
  if (!q) return null;
  return (
    <div className="hs-match">
      <span className="hs-label">{t('studio.in_catalog')}</span>
      {items === null ? <p className="muted small">…</p> : items.length === 0 ? <p className="muted small">{t('studio.no_match')}</p> : (
        <ul>{items.map((p) => <li key={p.id}><Link href={`/${lang}/product/${p.id}`}>{p.name}</Link>{p.min_price ? <span className="muted"> · {t('catalog.from')} {Number(p.min_price).toLocaleString()}{p.unit ? ` / ${p.unit}` : ''}</span> : null}</li>)}</ul>
      )}
      <Link className="small" href={`/${lang}/catalog?q=${encodeURIComponent(q)}`}>{t('studio.see_all')} →</Link>
    </div>
  );
}

/** On-screen stick for walking on touch screens. Reports -1..1 on both axes. */
export function Joystick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const base = useRef<HTMLDivElement>(null), [k, setK] = useState({ x: 0, y: 0 });
  const id = useRef<number | null>(null);
  const move = (e: React.PointerEvent) => {
    if (id.current !== e.pointerId || !base.current) return;
    const r = base.current.getBoundingClientRect(), R = r.width / 2;
    let x = (e.clientX - r.left - R) / R, y = (e.clientY - r.top - R) / R; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    setK({ x, y }); onMove(x, y);
  };
  const end = () => { id.current = null; setK({ x: 0, y: 0 }); onMove(0, 0); };
  return (
    <div ref={base} className="hs-joy" aria-hidden="true"
      onPointerDown={(e) => { id.current = e.pointerId; try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } move(e); e.stopPropagation(); }}
      onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <span style={{ transform: `translate(${k.x * 34}px, ${k.y * 34}px)` }} />
    </div>
  );
}

/** Thin progress line + label while texture sets stream in. */
export function Loading({ pending, done }: { pending: number; done: number }) {
  const t = useT();
  if (pending <= 0) return null;
  const pct = Math.round((done / Math.max(1, done + pending)) * 100);
  return (
    <div className="hs-loading" role="status" aria-live="polite">
      <span>{t('studio.loading')} · {pct}%</span>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}
