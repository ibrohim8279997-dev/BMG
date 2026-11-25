'use client';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import HouseZones from './HouseZones';
import './HouseStudio.css';
import { CatalogMatch, Joystick, Loading, MatGrid } from './house/StudioParts';
import { useLang, useMode, useT } from './Providers';
import type { Cam, HouseApi, Mode, Stats, View } from './House3D';
import {
  clamp, DEFAULT_DESIGN, Design, DOOR_COLORS, EXTRAS, FLOOR_MATS, FRAME_COLORS, FRAME_MATS, GROUNDS, metrics, NATURAL, PAINTS, randomLook, ROOF_COLORS, ROOF_MATS, ROOFS,
  SEASONS, STYLE_PRESET, STYLES, TILE_MATS, TRIM_COLORS, WALL_COLORS, WALL_MATS,
} from '@/lib/house/design';
import { QUALITY_PICKS, type QualityPick, type Tier } from '@/lib/house/quality';

const House3D = dynamic(() => import('./House3D'), { ssr: false, loading: () => <div className="h3d h3d-wait"><span className="h3d-spin" /></div> });

type Tab = 'size' | 'material' | 'color' | 'interior' | 'extras' | 'scene';
const TABS: Tab[] = ['size', 'material', 'color', 'interior', 'extras', 'scene'];
const MODES: Mode[] = ['exterior', 'cutaway', 'walk'];

/** Floors the 3D model shows per object type (the estimate itself accepts more for complexes). */
export const FLOORS: Record<string, [number, number]> = { apartment: [1, 1], house: [1, 4], complex: [2, 16] };

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

function Swatches({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (c: string) => void }) {
  const t = useT();
  return (
    <div className="hs-sw">
      <span className="hs-label">{label}</span>
      <div className="hs-sw-row" role="radiogroup" aria-label={label}>
        {options.map((c) => <button key={c} type="button" role="radio" aria-checked={value.toLowerCase() === c} aria-label={c} className={`sw ${value.toLowerCase() === c ? 'on' : ''}`} style={{ background: c }} onClick={() => onChange(c)} />)}
        <label className="sw sw-custom" title={t('studio.custom')}><input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label} · ${t('studio.custom')}`} /><span>+</span></label>
      </div>
    </div>
  );
}

function Chips<T extends string>({ label, value, options, name, onChange }: { label: string; value: T; options: readonly T[]; name: (v: T) => string; onChange: (v: T) => void }) {
  return (
    <div className="hs-chips-wrap"><span className="hs-label">{label}</span>
      <div className="hs-chips" role="radiogroup" aria-label={label}>
        {options.map((o) => <button key={o} type="button" role="radio" aria-checked={value === o} className={`chip ${value === o ? 'on' : ''}`} onClick={() => onChange(o)}>{name(o)}</button>)}
      </div>
    </div>
  );
}

type Props = { design: Design; onChange: (d: Design) => void; type: string; zones: string[]; onZone: (z: string) => void };

/** 3D house designer: dimensions drive the estimate; materials, colours, interior and extras are for the look (and link to catalogue products). */
export default function HouseStudio({ design: d, onChange, type, zones, onZone }: Props) {
  const t = useT(), lang = useLang();
  const { mode } = useMode();
  const [tab, setTab] = useState<Tab>('size');
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>({ xray: false, roof: true, explode: 0, rotate: false, dims: true, mode: 'exterior', level: 0 });
  const [quality, setQuality] = useState<QualityPick>('auto');
  const [tier, setTier] = useState<Tier | null>(null);
  const [load, setLoad] = useState({ pending: 0, done: 0 });
  const [touch, setTouch] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const api = useRef<HouseApi | null>(null);
  const set = (p: Partial<Design>) => onChange({ ...d, ...p });
  const m = metrics(d), apt = type === 'apartment', [fmin, fmax] = FLOORS[type] || FLOORS.house;
  const u = t('studio.unit_m'), u2 = t('studio.unit_m2'), u3 = t('studio.unit_m3');
  const three = mode !== 'lite' && !failed;
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) setView((v) => ({ ...v, rotate: false }));
    setTouch(matchMedia('(pointer: coarse)').matches);
    try { const q = localStorage.getItem('bmg.house.quality') as QualityPick | null; if (q && QUALITY_PICKS.includes(q)) setQuality(q); } catch { /* private mode */ }
    if (!new URLSearchParams(location.search).has('debug3d')) return;
    const id = setInterval(() => { const s = api.current?.stats(); if (s) setStats(s); }, 500);   // ?debug3d shows FPS / draw calls
    return () => clearInterval(id);
  }, []);
  const pickQuality = (q: QualityPick) => { setQuality(q); try { localStorage.setItem('bmg.house.quality', q); } catch { /* private mode */ } };
  const shot = () => {
    const url = api.current?.shot(2); if (!url) return;
    const a = document.createElement('a'); a.href = url; a.download = `bmg-house-${Math.round(d.length)}x${Math.round(d.width)}-${view.mode}.png`; a.click();
  };
  // an explicit locale, so the server and the browser print the same digits (no hydration mismatch)
  const fmt = (n: number) => n.toLocaleString(lang === 'en' ? 'en-US' : lang === 'uz' ? 'uz-UZ' : 'ru-RU', { maximumFractionDigits: 1 });
  const stats_: [string, string][] = [
    [t('studio.m.area'), `${fmt(apt ? m.foot : m.area)} ${u2}`], [t('studio.m.walls'), `${fmt(apt ? m.foot * 2.5 : m.wallArea)} ${u2}`],
    ...(apt ? [] : [[t('studio.m.roof'), `${fmt(m.roofArea)} ${u2}`] as [string, string]]),
    [t('studio.m.height'), `${fmt(m.height)} ${u}`], [t('studio.m.volume'), `${fmt(m.volume)} ${u3}`],
  ];
  const ext = view.mode === 'exterior';
  return (
    <section className="hs card" aria-label={t('studio.title')}>
      <div className="hs-stage">
        {three ? <House3D design={d} zones={zones} view={view} unit={u} quality={quality} onZone={onZone} onError={() => setFailed(true)} onProgress={(pending, done) => setLoad({ pending, done })} onTier={setTier} apiRef={api} />
               : <div className="hs-flat"><HouseZones active={zones} onToggle={onZone} />{failed && <p className="muted small">{t('studio.fallback')}</p>}</div>}
        {three && (
          <>
            <div className="hs-modes" role="radiogroup" aria-label={t('studio.mode')}>
              {MODES.map((x) => <button key={x} type="button" role="radio" aria-checked={view.mode === x} className={view.mode === x ? 'on' : ''} onClick={() => setView({ ...view, mode: x })}>{t(`studio.mode.${x}`)}</button>)}
            </div>
            {ext && (
              <div className="hs-cams" role="group" aria-label={t('studio.camera')}>
                {(['iso', 'front', 'side', 'top'] as Cam[]).map((c) => <button key={c} type="button" onClick={() => api.current?.fly(c)}>{t(`studio.view.${c}`)}</button>)}
              </div>
            )}
            {view.mode === 'cutaway' && d.floors > 1 && (
              <div className="hs-cams" role="radiogroup" aria-label={t('studio.level')}>
                {Array.from({ length: d.floors }, (_, i) => <button key={i} type="button" role="radio" aria-checked={view.level === i} className={view.level === i ? 'on' : ''} onClick={() => setView({ ...view, level: i })}>{t('studio.level_n').replace('{n}', String(i + 1))}</button>)}
              </div>
            )}
            <div className="hs-tools">
              {ext && <button type="button" className={view.xray ? 'on' : ''} aria-pressed={view.xray} onClick={() => setView({ ...view, xray: !view.xray })}>{t('studio.xray')}</button>}
              {ext && !apt && <button type="button" className={view.roof ? 'on' : ''} aria-pressed={view.roof} onClick={() => setView({ ...view, roof: !view.roof })}>{t('studio.roof_on')}</button>}
              {ext && <button type="button" className={view.dims ? 'on' : ''} aria-pressed={view.dims} onClick={() => setView({ ...view, dims: !view.dims })}>{t('studio.dims')}</button>}
              {ext && <button type="button" className={view.rotate ? 'on' : ''} aria-pressed={view.rotate} onClick={() => setView({ ...view, rotate: !view.rotate })}>{t('studio.rotate')}</button>}
              {ext && d.floors > 1 && <label className="hs-explode">{t('studio.explode')}<input type="range" min={0} max={3} step={0.1} value={view.explode} onChange={(e) => setView({ ...view, explode: Number(e.target.value) })} /></label>}
              <label className="hs-explode hs-quality">{t('studio.quality')}
                <select value={quality} onChange={(e) => pickQuality(e.target.value as QualityPick)} aria-label={t('studio.quality')}>
                  {QUALITY_PICKS.map((q) => <option key={q} value={q}>{t(`studio.q.${q}`)}{q === 'auto' && tier ? ` · ${t(`studio.q.${tier}`)}` : ''}</option>)}
                </select>
              </label>
              <button type="button" onClick={shot}>{t('studio.render')}</button>
            </div>
            <Loading pending={load.pending} done={load.done} />
            {view.mode === 'walk' && touch && <Joystick onMove={(x, y) => api.current?.joy(x, y)} />}
            <p className="hs-hint">{t(view.mode === 'walk' ? (touch ? 'studio.hint_walk_touch' : 'studio.hint_walk') : view.mode === 'cutaway' ? 'studio.hint_cut' : 'studio.hint')}</p>
            {stats && <output className="hs-debug">{stats.fps.toFixed(0)} fps · {stats.calls} calls · {(stats.tris / 1000).toFixed(0)}k tris · {stats.geometries} geo · {stats.textures} tex · {stats.tier}</output>}
          </>
        )}
        <dl className="hs-stats">{stats_.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </div>

      <div className="hs-panel">
        <div className="hs-head">
          <div><span className="sec-no">3D</span><h2>{t('studio.title')}</h2><p className="muted small">{t('studio.sub')}</p></div>
        </div>
        <div className="hs-tabs" role="tablist">
          {TABS.map((x) => <button key={x} role="tab" type="button" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`studio.tab.${x}`)}</button>)}
        </div>
        <div className="hs-body" role="tabpanel">
          {tab === 'size' && (<>
            {apt && <p className="notice">{t('studio.apartment_note')}</p>}
            <Num id="hs-l" label={t('studio.length')} value={d.length} min={3} max={60} step={0.1} suffix={u} onChange={(v) => set({ length: v })} />
            <Num id="hs-w" label={t('studio.width')} value={d.width} min={3} max={60} step={0.1} suffix={u} onChange={(v) => set({ width: v })} />
            {!apt && <Num id="hs-f" label={t('studio.floors')} value={clamp(d.floors, fmin, fmax)} min={fmin} max={fmax} step={1} suffix="" onChange={(v) => { set({ floors: v }); setView((x) => ({ ...x, level: Math.min(x.level, v - 1) })); }} />}
            <Num id="hs-h" label={t('studio.floor_height')} value={d.floorHeight} min={2.4} max={4} step={0.05} suffix={u} onChange={(v) => set({ floorHeight: v })} />
            {!apt && <Chips label={t('studio.roof_type')} value={d.roofType} options={ROOFS} name={(r) => t(`studio.roof.${r}`)} onChange={(r) => set({ roofType: r, roofMat: r !== 'flat' && d.roofMat === 'green' ? 'metal' : d.roofMat })} />}
            {!apt && d.roofType !== 'flat' && <Num id="hs-p" label={t('studio.roof_pitch')} value={d.roofPitch} min={10} max={55} step={1} suffix="°" onChange={(v) => set({ roofPitch: v })} />}
          </>)}
          {tab === 'material' && (<>
            <MatGrid label={t('studio.wall_mat')} items={WALL_MATS} value={d.wall} name={(w) => t(`studio.wall.${w}`)} color={(w) => (d.wall === w ? d.wallColor : WALL_COLORS[w][0])} onPick={(w) => set({ wall: w, wallColor: WALL_COLORS[w][0] })} />
            <CatalogMatch mat={d.wall} />
            {!apt && (<>
              <MatGrid label={t('studio.roof_mat')} items={ROOF_MATS.filter((r) => r !== 'green' || d.roofType === 'flat')} value={d.roofMat} name={(r) => t(`studio.roofmat.${r}`)} color={(r) => (d.roofMat === r ? d.roofColor : ROOF_COLORS[r][0])} onPick={(r) => set({ roofMat: r, roofColor: ROOF_COLORS[r][0] })} />
              <CatalogMatch mat={d.roofMat} />
            </>)}
            <Chips label={t('studio.frame_mat')} value={d.frameMat} options={FRAME_MATS} name={(f) => t(`studio.frame.${f}`)} onChange={(f) => set({ frameMat: f, frameColor: f === 'pvc_wood' ? '#b08a62' : f === 'alu' ? '#3c4146' : d.frameColor })} />
          </>)}
          {tab === 'color' && (<>
            <Swatches label={t('studio.c.wall')} value={d.wallColor} options={WALL_COLORS[d.wall]} onChange={(c) => set({ wallColor: c })} />
            {NATURAL.has(d.wall) && <p className="muted small">{t('studio.tint_note')}</p>}
            {!apt && <Swatches label={t('studio.c.roof')} value={d.roofColor} options={ROOF_COLORS[d.roofMat]} onChange={(c) => set({ roofColor: c })} />}
            <Swatches label={t('studio.c.trim')} value={d.trimColor} options={TRIM_COLORS} onChange={(c) => set({ trimColor: c })} />
            <Swatches label={t('studio.c.door')} value={d.doorColor} options={DOOR_COLORS} onChange={(c) => set({ doorColor: c })} />
            <Swatches label={t('studio.c.frame')} value={d.frameColor} options={FRAME_COLORS} onChange={(c) => set({ frameColor: c })} />
          </>)}
          {tab === 'interior' && (<>
            <Chips label={t('studio.style')} value={d.style} options={STYLES} name={(s) => t(`studio.st.${s}`)} onChange={(s) => set({ style: s, ...STYLE_PRESET[s] })} />
            <MatGrid label={t('studio.floor_mat')} items={FLOOR_MATS} value={d.floorMat} name={(f) => t(`studio.fl.${f}`)} color={() => '#ffffff'} onPick={(f) => set({ floorMat: f })} />
            <CatalogMatch mat={d.floorMat} />
            <MatGrid label={t('studio.tile_mat')} items={TILE_MATS} value={d.tileMat} name={(f) => t(`studio.tl.${f}`)} color={() => '#ffffff'} onPick={(f) => set({ tileMat: f })} />
            <Swatches label={t('studio.paint')} value={d.paint} options={PAINTS} onChange={(c) => set({ paint: c })} />
            {view.mode === 'exterior' && <button type="button" className="btn small" onClick={() => setView({ ...view, mode: 'cutaway' })}>{t('studio.look_inside')}</button>}
          </>)}
          {tab === 'extras' && (
            <div className="hs-extras">
              {EXTRAS.filter((x) => x !== 'balcony' || d.floors > 1).map((x) => (
                <label key={x} className={`xtra ${d.extras[x] ? 'on' : ''}`}><input type="checkbox" checked={d.extras[x]} onChange={(e) => set({ extras: { ...d.extras, [x]: e.target.checked } })} /><span>{t(`studio.x.${x}`)}</span></label>
              ))}
              <p className="muted small" style={{ gridColumn: '1 / -1', margin: '4px 0 0' }}>{t('studio.extras_note')}</p>
            </div>
          )}
          {tab === 'scene' && (<>
            <Chips label={t('studio.season')} value={d.season} options={SEASONS} name={(s) => t(`studio.s.${s}`)} onChange={(s) => set({ season: s })} />
            <MatGrid label={t('studio.ground')} items={GROUNDS} value={d.ground} name={(g) => t(`studio.g.${g}`)} color={() => '#ffffff'} onPick={(g) => set({ ground: g })} />
            <Num id="hs-t" label={t('studio.time')} value={d.time} min={0} max={24} step={0.25} suffix="h" onChange={(v) => set({ time: v })} />
          </>)}
        </div>
        <div className="hs-foot">
          <button type="button" className="btn ghost small" onClick={() => onChange(randomLook(d))}>{t('studio.random')}</button>
          <button type="button" className="btn ghost small" onClick={() => onChange({ ...DEFAULT_DESIGN, length: d.length, width: d.width, floors: d.floors })}>{t('studio.reset')}</button>
        </div>
      </div>
    </section>
  );
}
