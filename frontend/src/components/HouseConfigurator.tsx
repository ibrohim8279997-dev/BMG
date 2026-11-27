'use client';
import { useEffect, useRef, useState } from 'react';
import HouseZones from './HouseZones';
import { InteriorPanel, Joystick, PartPanel, SizePanel, ViewPanel, YardPanel } from './house/CfgPanel';
import { useLang, useMode, useT } from './Providers';
import './HouseConfigurator.css';
import { Design, geometryPayload, metrics } from '@/lib/house/design';
import { current, DEFAULT_LOCAL, LocalPick, PART_TYPES, pick, type PartType } from '@/lib/house/cfg/catalog';
import type { Configurator, PartInfo, ViewState } from '@/lib/house/cfg/engine';
import { QUALITY_PICKS, type QualityPick } from '@/lib/house/cfg/quality';

/** Floors the 3D model shows per object type (the estimate itself accepts more for complexes). */
export const FLOORS: Record<string, [number, number]> = { apartment: [1, 1], house: [1, 4], complex: [2, 16] };

const LOCAL_KEY = 'bmg.house.cfg.local.v1';
function loadLocal(): LocalPick {
  try { const v = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); return v && typeof v === 'object' ? { ...DEFAULT_LOCAL, ...v } : DEFAULT_LOCAL; } catch { return DEFAULT_LOCAL; }
}

const Q_KEY = 'bmg.house.quality.v1';
type Tab = 'size' | 'yard' | 'interior' | 'view';
const TABS: Tab[] = ['size', 'yard', 'interior', 'view'];
type View = 'exterior' | 'cutaway' | 'walk';
const VIEWS: View[] = ['exterior', 'cutaway', 'walk'];

type Props = { design: Design; onChange: (d: Design) => void; type: string; zones: string[]; onZone: (z: string) => void };

/** Layered 3D house configurator: explode the house into foundation, floors (slab, walls, openings, frame, wiring) and roof,
 *  click any part to dress it in the shop's materials and see the matching products in stock. Dimensions drive the estimate. */
export default function HouseConfigurator({ design: d, onChange, type, zones, onZone }: Props) {
  const t = useT(), lang = useLang(), { mode } = useMode();
  const canvas = useRef<HTMLCanvasElement>(null), eng = useRef<Configurator | null>(null);
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  const [local, setLocal] = useState<LocalPick>(DEFAULT_LOCAL);
  const [part, setPart] = useState<PartInfo | null>(null), [sizeOpen, setSizeOpen] = useState(false), [tab, setTab] = useState<Tab>('size');
  const [st, setSt] = useState<ViewState>({ exploded: false, auto: true, level: '', walking: false, floor: 0, tier: 'medium' });
  const [quality, setQuality] = useState<QualityPick>('auto'), qLoaded = useRef(false);
  const [touch, setTouch] = useState(false);
  const [load, setLoad] = useState({ pending: 0, done: 0 });
  const painted = useRef<Partial<Record<PartType, string>>>({});
  const three = mode !== 'lite' && !failed, apt = type === 'apartment';
  const set = (p: Partial<Design>) => onChange({ ...d, ...p });

  useEffect(() => {
    setLocal(loadLocal()); setTouch(matchMedia('(pointer: coarse)').matches);
    try { const q = localStorage.getItem(Q_KEY) as QualityPick | null; if (q && QUALITY_PICKS.includes(q)) setQuality(q); } catch { /* private mode */ }
    qLoaded.current = true;
  }, []);
  useEffect(() => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); } catch { /* private mode */ } }, [local]);

  useEffect(() => {
    if (!three || !canvas.current) return;
    let alive = true, made: Configurator | null = null;
    import('@/lib/house/cfg/engine').then(({ createConfigurator }) => {
      if (!alive || !canvas.current) return;
      try {
        made = createConfigurator(canvas.current, {
          onSelect: (p) => { setPart(p); if (p) setSizeOpen(false); },
          onState: setSt, onLoad: (pending, done) => setLoad({ pending, done }),
        });
        eng.current = made; setReady(true);
      } catch { setFailed(true); }
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; made?.destroy(); eng.current = null; setReady(false); };
  }, [three]);

  // geometry: rebuild when a dimension changes (materials are re-applied in the same pass)
  const geo = geometryPayload(d, type);
  // the yard and the generated interior are part of the build, so their settings rebuild too
  const geoSig = JSON.stringify([geo, d.ground, d.season, d.extras, d.style, d.paint, d.tileMat]);
  const lookOf = (k: PartType) => current(k, d, local);
  useEffect(() => {
    const e = eng.current; if (!ready || !e) return;
    e.build({ ...d, floors: geo.floors }, geo.roof_type as Design['roofType'], lookOf);
    PART_TYPES.forEach((k) => { painted.current[k] = JSON.stringify(lookOf(k)); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, geoSig]);
  // looks: repaint only the part types whose material or colour changed
  const lookSig = PART_TYPES.map((k) => JSON.stringify(lookOf(k))).join('|');
  useEffect(() => {
    const e = eng.current; if (!ready || !e) return;
    PART_TYPES.forEach((k) => { const s = JSON.stringify(lookOf(k)); if (painted.current[k] !== s) { painted.current[k] = s; e.look(k, lookOf(k)); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, lookSig]);

  // light: time of day and season move the sun, sky, HDRI and night glow (no rebuild)
  useEffect(() => { if (ready) eng.current?.setTime(d.time, d.season); }, [ready, d.time, d.season]);
  useEffect(() => {
    if (ready) eng.current?.setQuality(quality);
    if (qLoaded.current) try { localStorage.setItem(Q_KEY, quality); } catch { /* private mode */ }
  }, [ready, quality]);

  useEffect(() => {
    const k = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { eng.current?.select(null); setSizeOpen(false); } };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);

  const onPick = (k: PartType, id: string) => { const r = pick(k, id, d, local); if (r.design !== d) onChange(r.design); if (r.local !== local) setLocal(r.local); };
  const close = () => { eng.current?.select(null); setPart(null); setSizeOpen(false); };
  const shot = () => {
    const url = eng.current?.shot(2); if (!url) return;
    const a = document.createElement('a'); a.href = url; a.download = `bmg-house-${Math.round(d.length)}x${Math.round(d.width)}.png`; a.click();
  };
  const floorsL = Array.from({ length: geo.floors }, (_, i) => `f${i}`);
  const levels = st.walking ? floorsL : ['', 'foundation', ...floorsL, 'roof'];
  const active = (l: string) => (st.walking ? l === `f${st.floor}` : st.level === l);
  const levelName = (l: string) => (l === '' ? t('cfg.all') : l === 'foundation' ? t('cfg.part.foundation') : l === 'roof' ? t('cfg.roof') : t('cfg.floor_n').replace('{n}', String(Number(l.slice(1)) + 1)));
  const m = metrics({ ...d, floors: geo.floors });
  const fmt = (n: number) => n.toLocaleString(lang === 'en' ? 'en-US' : lang === 'uz' ? 'uz-UZ' : 'ru-RU', { maximumFractionDigits: 1 });
  const open = !!part || sizeOpen;
  const view: View = st.walking ? 'walk' : st.exploded ? 'cutaway' : 'exterior';
  const setView = (m: View) => {
    const e = eng.current; if (!e || m === view) return;
    setPart(null);
    if (m === 'walk') { e.setWalk(true); return; }
    if (st.walking) e.setWalk(false);
    if ((m === 'cutaway') !== (st.exploded && !st.walking)) e.toggleExplode();
  };
  const pct = Math.round((load.done / Math.max(1, load.done + load.pending)) * 100);

  return (
    <section className={`cfg ${open ? 'open' : ''}`} aria-label={t('studio.title')}>
      {three ? <canvas ref={canvas} className="cfg-cv" aria-label={t('studio.title')} /> : (
        <div className="cfg-flat"><HouseZones active={zones} onToggle={onZone} />{failed && <p className="muted small">{t('studio.fallback')}</p>}</div>
      )}
      <div className="cfg-top">
        {three && (
          <div className="cfg-chips" role="radiogroup" aria-label={t('studio.level')}>
            {levels.map((l) => <button key={l || 'all'} type="button" role="radio" aria-checked={active(l)} className={active(l) ? 'on' : ''} onClick={() => eng.current?.setLevel(l)}>{levelName(l)}</button>)}
          </div>
        )}
        <div className="cfg-tools">
          {three && (
            <div className="cfg-seg" role="radiogroup" aria-label={t('studio.mode')}>
              {VIEWS.map((m) => <button key={m} type="button" role="radio" aria-checked={view === m} className={view === m ? 'on' : ''} onClick={() => setView(m)}>{t(`studio.mode.${m}`)}</button>)}
            </div>
          )}
          <button type="button" className={sizeOpen ? 'on' : ''} aria-pressed={sizeOpen} onClick={() => { eng.current?.select(null); setPart(null); setSizeOpen(!sizeOpen); }}>{t('cfg.settings')}</button>
          {three && <>
            {!st.walking && <button type="button" className={st.auto ? 'on' : ''} aria-pressed={st.auto} onClick={() => eng.current?.setAuto(!st.auto)}>{t('cfg.rotate')}</button>}
            <button type="button" onClick={shot}>{t('studio.render')}</button>
          </>}
        </div>
      </div>
      {three && !ready && <div className="cfg-boot" aria-hidden="true"><span /></div>}
      {three && load.pending > 0 && (
        <div className="cfg-loading" role="status" aria-live="polite">
          <span>{t('studio.loading')}</span><b>{pct}%</b>
          <i role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><em style={{ width: `${pct}%` }} /></i>
        </div>
      )}
      {three && <p className="cfg-hint">{st.walking ? t(touch ? 'studio.hint_walk_touch' : 'studio.hint_walk') : t('cfg.hint')}</p>}
      {three && st.walking && touch && <Joystick onMove={(x, y) => eng.current?.joy(x, y)} />}
      <dl className="cfg-stats">
        {[[t('studio.m.area'), `${fmt(apt ? m.foot : m.area)} ${t('studio.unit_m2')}`], [t('studio.m.height'), `${fmt(m.height)} ${t('studio.unit_m')}`],
          ...(apt ? [] : [[t('studio.m.roof'), `${fmt(m.roofArea)} ${t('studio.unit_m2')}`]])].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <aside className="cfg-panel" aria-hidden={!open}>
        <button type="button" className="cfg-x" aria-label={t('cfg.close')} onClick={close}>×</button>
        {part ? <PartPanel part={part} design={d} local={local} zones={zones} onZone={onZone} onPick={onPick} onDesign={set} />
          : sizeOpen ? (<>
            <div className="cfg-tabs" role="tablist">
              {TABS.map((x) => <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`cfg.tab.${x}`)}</button>)}
            </div>
            {tab === 'size' ? <SizePanel d={d} apt={apt} floors={FLOORS[type] || FLOORS.house} set={set} /> : tab === 'yard' ? <YardPanel d={d} set={set} />
              : tab === 'interior' ? <InteriorPanel d={d} set={set} /> : <ViewPanel d={d} set={set} quality={quality} tier={st.tier} onQuality={setQuality} three={three} />}
          </>) : null}
      </aside>
    </section>
  );
}
