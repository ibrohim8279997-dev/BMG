'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, money } from '@/lib/api';
import { clamp, Design, Extra, FLOOR_MATS, GROUNDS, PAINTS, ROOFS, SEASONS, STYLE_PRESET, STYLES, TILE_MATS } from '@/lib/house/design';
import { colors, current, LocalPick, nameKey, options, PartType, queryKey, thumb, ZONES_OF } from '@/lib/house/cfg/catalog';
import type { PartInfo } from '@/lib/house/cfg/engine';
import { QUALITY_PICKS, type QualityPick, type Tier } from '@/lib/house/cfg/quality';
import { useLang, useT } from '../Providers';

type Product = { id: number; name: string; unit?: string; min_price?: string | null; image?: string | null };
type Found = { total: number; results: Product[] };

/** One request per search word for the whole visit: the panel asks for every option of a part at once. */
const cache = new Map<string, Promise<Found>>();
function search(q: string, lang: string) {
  const k = `${lang}|${q}`;
  let p = cache.get(k);
  if (!p) {
    p = api<Found>(`/api/v1/products?${new URLSearchParams({ q, lang, page: '1' })}`)
      .then((r) => ({ total: Number(r?.total) || 0, results: r?.results || [] }))
      .catch(() => { cache.delete(k); return { total: 0, results: [] }; });
    cache.set(k, p);
  }
  return p;
}
function useShop(q: string | null) {
  const lang = useLang(), [res, setRes] = useState<Found | null>(null);
  useEffect(() => {
    if (!q) { setRes({ total: 0, results: [] }); return; }
    let on = true; setRes(null);
    search(q, lang).then((r) => { if (on) setRes(r); });
    return () => { on = false; };
  }, [q, lang]);
  return res;
}
/** The shop search word behind a dictionary key, or null when the dictionaries have none. */
function useWord(k: string) { const t = useT(), w = t(k); return w && w !== k ? w : null; }
function useQuery(type: PartType, id: string) { return useWord(queryKey(type, id)); }

function ShopBadge({ qk }: { qk: string }) {
  const t = useT(), r = useShop(useWord(qk));
  if (!r) return <small className="cfg-stock">…</small>;
  return <small className={`cfg-stock ${r.total ? 'yes' : 'no'}`}>{r.total ? t('cfg.in_shop').replace('{n}', String(r.total)) : t('cfg.not_in_shop')}</small>;
}

function ShopList({ type, id }: { type: PartType; id: string }) {
  const t = useT(), lang = useLang(), q = useQuery(type, id), r = useShop(q);
  return (
    <div className="cfg-shop">
      <span className="cfg-label">{t('cfg.shop')}</span>
      {!r ? <p className="muted small">…</p> : r.results.length === 0 ? <p className="muted small">{t('studio.no_match')}</p> : (
        <ul>{r.results.slice(0, 4).map((p) => (
          <li key={p.id}><Link href={`/${lang}/product/${p.id}`}>
            <i style={p.image ? { backgroundImage: `url(${p.image})` } : undefined} aria-hidden="true" />
            <span><b>{p.name}</b>{p.min_price ? <small className="muted">{t('catalog.from')} {money(p.min_price, lang)}{p.unit ? ` / ${p.unit}` : ''}</small> : null}</span>
          </Link></li>
        ))}</ul>
      )}
      {q && r && r.total > 0 && <Link className="small" href={`/${lang}/catalog?q=${encodeURIComponent(q)}`}>{t('studio.see_all')} ({r.total}) →</Link>}
    </div>
  );
}

type PartProps = { part: PartInfo; design: Design; local: LocalPick; zones: string[]; onZone: (z: string) => void; onPick: (type: PartType, id: string) => void; onDesign: (p: Partial<Design>) => void };

/** Materials of the clicked part: the shop's own materials, each with its stock in the shop, plus matching products. */
export function PartPanel({ part, design, local, zones, onZone, onPick, onDesign }: PartProps) {
  const t = useT(), list = options(part.type, design), cur = current(part.type, design, local), col = colors(part.type, design);
  const title = part.id === 'ceiling' ? t('cfg.part.ceiling') : part.floor ? `${t('cfg.floor_n').replace('{n}', String(part.floor))} — ${t(`cfg.part.${part.type}`)}` : t(`cfg.part.${part.type}`);
  const zs = ZONES_OF[part.type];
  return (
    <>
      <h2>{title}</h2>
      {zs.length > 0 && (
        <div className="cfg-zones"><span className="cfg-label">{t('cfg.in_estimate')}</span>
          {zs.map((z) => <label key={z} className="check"><input type="checkbox" checked={zones.includes(z)} onChange={() => onZone(z)} />{t(`zone.${z}`)}</label>)}
        </div>
      )}
      <span className="cfg-label">{t('cfg.materials')}</span>
      <div className="cfg-grid" role="radiogroup" aria-label={t('cfg.materials')}>
        {list.map((o) => {
          const img = thumb(o);
          return (
            <button key={o.id} type="button" role="radio" aria-checked={o.id === cur.id} className={`cfg-card ${o.id === cur.id ? 'on' : ''}`} onClick={() => onPick(part.type, o.id)}>
              <i style={{ backgroundColor: o.color, backgroundImage: img ? `url(${img})` : undefined, backgroundBlendMode: img ? 'multiply' : undefined }} />
              <b>{t(nameKey(part.type, o.id))}</b>
              <ShopBadge qk={queryKey(part.type, o.id)} />
            </button>
          );
        })}
      </div>
      {col && (
        <div className="cfg-colors"><span className="cfg-label">{t('cfg.color')}</span>
          <div role="radiogroup" aria-label={t('cfg.color')}>
            {col.options.map((c) => <button key={c} type="button" role="radio" aria-checked={col.value.toLowerCase() === c} aria-label={c} className={`sw ${col.value.toLowerCase() === c ? 'on' : ''}`} style={{ background: c }} onClick={() => onDesign({ [col.key]: c })} />)}
            <label className="sw sw-custom" title={t('studio.custom')}><input type="color" value={col.value} onChange={(e) => onDesign({ [col.key]: e.target.value })} aria-label={t('studio.custom')} /><span>+</span></label>
          </div>
        </div>
      )}
      <ShopList type={part.type} id={cur.id} />
    </>
  );
}

function Num({ id, label, value, min, max, step, onChange, suffix }: { id: string; label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; suffix: string }) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => { setTxt(String(value)); }, [value]);
  const commit = (s: string) => { const v = Number(s.replace(',', '.')); if (Number.isFinite(v)) onChange(clamp(Math.round(v / step) * step, min, max)); else setTxt(String(value)); };
  return (
    <div className="hs-num">
      <label htmlFor={id}>{label}</label>
      <div className="hs-num-row">
        <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="hs-num-box"><input id={id} inputMode="decimal" value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }} /><small>{suffix}</small></span>
      </div>
    </div>
  );
}

/** Dimensions: these drive the estimate (the server recomputes areas from them). */
export function SizePanel({ d, apt, floors: [fmin, fmax], set }: { d: Design; apt: boolean; floors: [number, number]; set: (p: Partial<Design>) => void }) {
  const t = useT(), u = t('studio.unit_m');
  return (
    <>
      {apt && <p className="notice">{t('studio.apartment_note')}</p>}
      <Num id="cfg-l" label={t('studio.length')} value={d.length} min={3} max={60} step={0.1} suffix={u} onChange={(v) => set({ length: v })} />
      <Num id="cfg-w" label={t('studio.width')} value={d.width} min={3} max={60} step={0.1} suffix={u} onChange={(v) => set({ width: v })} />
      {!apt && <Num id="cfg-f" label={t('studio.floors')} value={clamp(d.floors, fmin, fmax)} min={fmin} max={fmax} step={1} suffix="" onChange={(v) => set({ floors: v })} />}
      <Num id="cfg-h" label={t('studio.floor_height')} value={d.floorHeight} min={2.4} max={4} step={0.05} suffix={u} onChange={(v) => set({ floorHeight: v })} />
      {!apt && (
        <div className="hs-chips-wrap"><span className="cfg-label">{t('studio.roof_type')}</span>
          <div className="hs-chips" role="radiogroup" aria-label={t('studio.roof_type')}>
            {ROOFS.map((r) => <button key={r} type="button" role="radio" aria-checked={d.roofType === r} className={`chip ${d.roofType === r ? 'on' : ''}`}
              onClick={() => set({ roofType: r, roofMat: r !== 'flat' && d.roofMat === 'green' ? 'metal' : d.roofMat })}>{t(`studio.roof.${r}`)}</button>)}
          </div>
        </div>
      )}
      {!apt && d.roofType !== 'flat' && <Num id="cfg-p" label={t('studio.roof_pitch')} value={d.roofPitch} min={10} max={55} step={1} suffix="°" onChange={(v) => set({ roofPitch: v })} />}
    </>
  );
}

/** Texture cards with the shop stock of each (grounds, floors, tiles). */
function TexCards<T extends string>({ label, items, value, name, onPick }: { label: string; items: readonly T[]; value: T; name: (v: T) => string; onPick: (v: T) => void }) {
  return (
    <>
      <span className="cfg-label">{label}</span>
      <div className="cfg-grid" role="radiogroup" aria-label={label}>
        {items.map((v) => (
          <button key={v} type="button" role="radio" aria-checked={v === value} className={`cfg-card ${v === value ? 'on' : ''}`} onClick={() => onPick(v)}>
            <i style={{ backgroundImage: `url(/textures/thumbs/${v}.webp)` }} /><b>{name(v)}</b><ShopBadge qk={`studio.cq.${v}`} />
          </button>
        ))}
      </div>
    </>
  );
}
function Chips<T extends string>({ label, items, value, name, onPick }: { label: string; items: readonly T[]; value: T; name: (v: T) => string; onPick: (v: T) => void }) {
  return (
    <div className="hs-chips-wrap"><span className="cfg-label">{label}</span>
      <div className="hs-chips" role="radiogroup" aria-label={label}>
        {items.map((v) => <button key={v} type="button" role="radio" aria-checked={v === value} className={`chip ${v === value ? 'on' : ''}`} onClick={() => onPick(v)}>{name(v)}</button>)}
      </div>
    </div>
  );
}

const YARD_EXTRAS: Extra[] = ['fence', 'trees', 'pool'];
/** The plot: ground material, season, fence / trees / pool. */
export function YardPanel({ d, set }: { d: Design; set: (p: Partial<Design>) => void }) {
  const t = useT();
  return (
    <>
      <TexCards label={t('studio.ground')} items={GROUNDS} value={d.ground} name={(g) => t(`studio.g.${g}`)} onPick={(g) => set({ ground: g })} />
      <Chips label={t('studio.season')} items={SEASONS} value={d.season} name={(s) => t(`studio.s.${s}`)} onPick={(s) => set({ season: s })} />
      <span className="cfg-label">{t('studio.tab.extras')}</span>
      <div className="cfg-zones">
        {YARD_EXTRAS.map((x) => <label key={x} className="check"><input type="checkbox" checked={d.extras[x]} onChange={(e) => set({ extras: { ...d.extras, [x]: e.target.checked } })} />{t(`studio.x.${x}`)}</label>)}
      </div>
    </>
  );
}

/** The generated interior: style preset, floor, tiles of the wet rooms, wall paint. */
export function InteriorPanel({ d, set }: { d: Design; set: (p: Partial<Design>) => void }) {
  const t = useT();
  return (
    <>
      <Chips label={t('studio.style')} items={STYLES} value={d.style} name={(s) => t(`studio.st.${s}`)} onPick={(s) => set({ style: s, ...STYLE_PRESET[s] })} />
      <TexCards label={t('studio.floor_mat')} items={FLOOR_MATS} value={d.floorMat} name={(f) => t(`studio.fl.${f}`)} onPick={(f) => set({ floorMat: f })} />
      <TexCards label={t('studio.tile_mat')} items={TILE_MATS} value={d.tileMat} name={(f) => t(`studio.tl.${f}`)} onPick={(f) => set({ tileMat: f })} />
      <span className="cfg-label">{t('studio.paint')}</span>
      <div className="cfg-colors"><div role="radiogroup" aria-label={t('studio.paint')}>
        {PAINTS.map((c) => <button key={c} type="button" role="radio" aria-checked={d.paint.toLowerCase() === c} aria-label={c} className={`sw ${d.paint.toLowerCase() === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set({ paint: c })} />)}
        <label className="sw sw-custom" title={t('studio.custom')}><input type="color" value={d.paint} onChange={(e) => set({ paint: e.target.value })} aria-label={t('studio.custom')} /><span>+</span></label>
      </div></div>
    </>
  );
}

/** Time-of-day presets (hours); the slider sets any hour in between. */
const TOD: [string, number][] = [['morning', 7.5], ['day', 13], ['evening', 17.6], ['night', 22]];
const hhmm = (h: number) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;

/** Look of the render: time of day (sun, sky, lit windows) and quality tier. Neither touches the estimate. */
export function ViewPanel({ d, set, quality, tier, onQuality, three }: { d: Design; set: (p: Partial<Design>) => void; quality: QualityPick; tier: Tier; onQuality: (q: QualityPick) => void; three: boolean }) {
  const t = useT(), near = TOD.reduce((a, b) => (Math.abs(b[1] - d.time) < Math.abs(a[1] - d.time) ? b : a))[0];
  return (
    <>
      <span className="cfg-label">{t('studio.time')} · {hhmm(d.time)}</span>
      <div className="cfg-tod" role="radiogroup" aria-label={t('studio.time')}>
        {TOD.map(([k, h]) => <button key={k} type="button" role="radio" aria-checked={near === k} className={`cfg-tod-${k} ${near === k ? 'on' : ''}`} onClick={() => set({ time: h })}><i aria-hidden="true" />{t(`studio.tod.${k}`)}</button>)}
      </div>
      <input className="cfg-time" type="range" min={5} max={23.5} step={0.25} value={clamp(d.time, 5, 23.5)} aria-label={t('studio.time')} onChange={(e) => set({ time: Number(e.target.value) })} />
      {three && <>
        <Chips label={t('studio.quality')} items={QUALITY_PICKS} value={quality} name={(q) => t(`studio.q.${q}`)} onPick={onQuality} />
        {quality === 'auto' && <p className="muted small">{t('studio.q.now').replace('{tier}', t(`studio.q.${tier}`))}</p>}
      </>}
    </>
  );
}

/** On-screen stick for walking on touch screens. Reports -1..1 on both axes. */
export function Joystick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const base = useRef<HTMLDivElement>(null), id = useRef<number | null>(null), [k, setK] = useState({ x: 0, y: 0 });
  const move = (e: React.PointerEvent) => {
    if (id.current !== e.pointerId || !base.current) return;
    const r = base.current.getBoundingClientRect(), R = r.width / 2;
    let x = (e.clientX - r.left - R) / R, y = (e.clientY - r.top - R) / R; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    setK({ x, y }); onMove(x, y);
  };
  const end = () => { id.current = null; setK({ x: 0, y: 0 }); onMove(0, 0); };
  return (
    <div ref={base} className="cfg-joy" aria-hidden="true"
      onPointerDown={(e) => { id.current = e.pointerId; try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic */ } move(e); e.stopPropagation(); }}
      onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <span style={{ transform: `translate(${k.x * 34}px, ${k.y * 34}px)` }} />
    </div>
  );
}
