/** Three.js runtime of the layered house configurator: build from a Design (house, generated interior, yard), explode / assemble,
 *  focus a level, orbit / zoom / pinch, hover + click picking, the shop's PBR materials on every part, and a first-person walk. */
import * as THREE from 'three';
import type { Design, Roof, Season } from '../design';
import { applySet, disposeSets, initTextures, onProgress } from '../materials/loader';
import type { Opt, PartType } from './catalog';
import { furnish } from './furnish';
import { Lighting } from './lighting';
import { disposeModels } from './models';
import { layout, type Layout } from './parts';
import { Post } from './post';
import { detectTier, FpsMeter, lower, settingsFor, type QualityPick, type Tier } from './quality';
import { Walker } from './walk';
import { buildYard, type Yard } from './yard';

export type PartInfo = { id: string; type: PartType; level: string; floor: number };
type U = Omit<PartInfo, 'type'> & { type: PartType | 'interior'; ex: number; reveal: boolean; main: THREE.MeshPhysicalMaterial; mats: THREE.Material[]; d: number; dt: number; lift: number; flash: number; sel: boolean; lo: number };
export type ViewState = { exploded: boolean; auto: boolean; level: string; walking: boolean; floor: number; tier: Tier };
export type Events = { onSelect: (p: PartInfo | null) => void; onState: (s: ViewState) => void; onLoad?: (pending: number, done: number) => void };

const plain = new THREE.MeshPhysicalMaterial();
/** Painted metal (roof sheets, cassettes, sandwich panels) carries a lacquer coat over its own roughness. */
const LACQUER: Record<string, number> = { metal: 0.6, seam: 0.5, cassette: 0.45, sandwich: 0.35, steel: 0.2 };
/** Puts one option on a part material: a PBR set from the shop's library, or a flat colour. */
function paint(m: THREE.MeshPhysicalMaterial, o: Opt) {
  m.onBeforeCompile = plain.onBeforeCompile; m.customProgramCacheKey = plain.customProgramCacheKey;   // drop a previous anti-tiling patch
  m.userData.set = o.set || null;
  m.clearcoat = (o.set && LACQUER[o.set]) || ((o.metal ?? 0) > 0.3 ? 0.4 : 0); m.clearcoatRoughness = 0.18;
  if (o.set) { applySet(m, { set: o.set, color: o.color, rough: o.rough, metal: o.metal }); }
  else {
    m.map = m.normalMap = m.aoMap = m.roughnessMap = m.metalnessMap = null;
    m.color.set(o.color); m.roughness = o.rough ?? 0.85; m.metalness = o.metal ?? 0;
  }
  m.needsUpdate = true;
}

export function createConfigurator(canvas: HTMLCanvasElement, ev: Events) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap;
  initTextures(renderer);
  const offLoad = ev.onLoad ? onProgress(ev.onLoad) : () => {};
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(35, 1, 0.5, 600);
  const pmrem = new THREE.PMREMGenerator(renderer), light = new Lighting(scene, pmrem), post = new Post(renderer, scene, cam);
  let pickQ: QualityPick = 'auto', tier: Tier = detectTier(renderer), w0 = 1, h0 = 1;
  const meter = new FpsMeter();
  /** Applies a tier: pixel ratio, shadow map, post chain. */
  function applyTier(t: Tier) {
    tier = t; const st = settingsFor(t);
    renderer.setPixelRatio(st.pixelRatio); renderer.setSize(w0, h0, false);
    light.setShadow(st.shadowMap, st.shadowRadius); post.apply(st); post.setSize(w0, h0, st.pixelRatio); meter.reset();
  }
  applyTier(tier);
  let time = 14, season: Season = 'summer', night = 0;
  const lamp = new THREE.PointLight(0xfff1dc, 0, 14, 2); scene.add(lamp);   // the walker's own light (kept in the scene: no shader rebuilds)
  let yard: Yard | null = null, walking = false;
  const walker = new Walker(() => (lay && yard ? { floors: lay.floors, hx: lay.hx, hz: lay.hz, px: yard.px, pz: yard.pz, doorX: lay.doorX } : null));

  let parts: THREE.Group[] = [], meshes: THREE.Mesh[] = [], guides: THREE.Line[] = [], lay: Layout | null = null;
  let e = 0, eT = 0, level = '', selected: THREE.Group | null = null, hover: THREE.Group | null = null, auto = true;
  let az = 0.7, tAz = 0.7, pol = 1.15, tPol = 1.15, zoom = 1, tZoom = 1, ty = 4, lf = 1, aspect = 1;
  const ud = (p: THREE.Group) => p.userData as U;
  const info = (p: THREE.Group): PartInfo => { const u = ud(p); return { id: u.id, type: u.type as PartType, level: u.level, floor: u.floor }; };
  const state = () => ev.onState({ exploded: !!eT, auto, level, walking, floor: walker.floor, tier });
  /** Furniture models load only once the visitor looks inside: walk, cutaway or a focused storey. */
  let inside = false;
  function furnishAll() {
    if (!inside) return;
    for (const p of parts) if (ud(p).type === 'interior') furnish(p, () => parts.includes(p), (ms) => {
      const u = ud(p); ms.forEach((m) => { m.userData.base = m.opacity; u.mats.push(m); }); u.lo = -1;
    });
  }
  const wantInside = () => { if (!inside) { inside = true; furnishAll(); } };
  /** Evening look: panes glow warm from inside (bloom picks them up), the walker's own lamp off by day. */
  function applyNight() {
    const lit = walking ? 0 : night;
    for (const p of parts) if (ud(p).type === 'open') for (const m of ud(p).mats) if (m.userData.glass) {
      const g = m as THREE.MeshPhysicalMaterial; g.emissive.set('#ffc27a'); g.emissiveIntensity = lit * 2.4; g.userData.base = 0.3 + lit * 0.55; ud(p).lo = -1;
    }
    post.setNight(night, walking);
  }
  function setTime(t: number, s: Season) {
    time = t; season = s; const ls = light.update(t, s); night = ls.night;
    renderer.toneMappingExposure = light.exposure; applyNight();
  }

  function clear() {
    for (const o of [...parts, ...guides, ...(yard ? [yard.group] : [])]) {
      scene.remove(o);
      o.userData.dead = true;
      o.traverse((x) => {
        const m = x as THREE.Mesh;
        if (m.geometry && !m.userData.shared) m.geometry.dispose();   // GLB geometry is cached across rebuilds
        if (m.material) [m.material].flat().forEach((k) => { if (k.userData.shared) return; k.userData.disposed = true; k.dispose(); });
      });
    }
    parts = []; meshes = []; guides = []; yard = null;
  }

  /** (Re)builds every part from the design; `look` gives the material of each part type. */
  function build(d: Design, roof: Roof, look: (t: PartType) => Opt) {
    const keep = selected ? ud(selected).id : null;
    clear(); lay = layout(d, roof);
    for (const def of lay.defs) {
      const g = new THREE.Group(), main = new THREE.MeshPhysicalMaterial({ roughness: 0.85 });
      def.build(g, main);
      const mats = new Set<THREE.Material>();
      const pickable = def.type !== 'interior';
      g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = m.receiveShadow = true; m.userData.part = g; if (pickable) meshes.push(m); [m.material].flat().forEach((k) => mats.add(k)); } });
      mats.forEach((m) => { m.userData.base = m.opacity; });
      const inLevel = !level || def.level === level;
      g.userData = { id: def.id, type: def.type, level: def.level, floor: def.floor, ex: def.ex, reveal: def.reveal, main, mats: [...mats],
        d: inLevel ? 1 : 0.12, dt: inLevel ? 1 : 0.12, lift: 0, flash: 0, sel: false, lo: -1 } satisfies U;
      if (def.type !== 'interior') paint(main, look(def.type));
      scene.add(g); parts.push(g);
    }
    const H = lay.height + lay.maxEx, gx = lay.hx + 0.5, gz = lay.hz + 0.5;
    [[-gx, -gz], [gx, -gz], [gx, gz], [-gx, gz]].forEach(([x, z]) => {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0, z), new THREE.Vector3(x, H, z)]),
        new THREE.LineDashedMaterial({ color: 0x8a96a3, dashSize: 0.25, gapSize: 0.25, transparent: true }));
      l.computeLineDistances(); scene.add(l); guides.push(l);
    });
    yard = buildYard(d, lay.hx, lay.hz, lay.doorX, lay.plinth); scene.add(yard.group);
    if (walking && walker.floor >= lay.floors.length) walker.goFloor(0);
    const R = Math.max(yard.radius * 0.8, Math.max(lay.hx, lay.hz, lay.height / 2) * 1.6 + lay.maxEx * 0.6);
    light.fit(new THREE.Vector3(0, 0, 0), R, lay.maxEx);
    furnishAll(); applyNight();
    selected = null; hover = null;
    const again = keep && parts.find((p) => ud(p).id === keep);
    if (again) select(again, false); else if (keep) ev.onSelect(null);
  }

  function setLevel(l: string) {
    if (walking) { if (/^f\d+$/.test(l)) { walker.goFloor(Number(l.slice(1))); state(); } return; }
    level = l;
    parts.forEach((p) => { ud(p).dt = !l || ud(p).level === l ? 1 : 0.12; });
    if (l) eT = 1;
    if (/^f\d+$/.test(l)) wantInside();
    if (selected && l && ud(selected).level !== l) select(null);
    state();
  }
  /** First-person walk: assembled house, start in front of the door. */
  function setWalk(on: boolean) {
    if (on === walking) return;
    walking = on; hover = null; glide();
    if (on) {
      select(null); eT = 0; level = ''; parts.forEach((p) => { ud(p).dt = 1; }); auto = false; wantInside();
      walker.attach(); walker.start(); fovT = 68; cam.near = 0.05; lamp.intensity = 7; canvas.style.cursor = 'grab';
    } else { walker.detach(); fovT = 35; cam.near = 0.5; lamp.intensity = 0; }
    cam.updateProjectionMatrix(); applyNight(); state();
  }
  function toggleExplode() { if (walking) return; eT = eT ? 0 : 1; if (eT) wantInside(); if (!eT && level) setLevel(''); state(); }
  /** Smooth camera move between modes: the next frames blend from the current pose to the new one. */
  const from = { pos: new THREE.Vector3(), q: new THREE.Quaternion(), k: 1 };
  let fovT = 35;
  function glide() { from.pos.copy(cam.position); from.q.copy(cam.quaternion); from.k = reduce ? 1 : 0; }
  function setAuto(v: boolean) { auto = v; state(); }
  function select(p: THREE.Group | null, notify = true) {
    if (selected) ud(selected).sel = false;
    selected = p; if (p) { ud(p).sel = true; ud(p).flash = 1; }
    if (notify || p) ev.onSelect(p ? info(p) : null);
  }
  /** Re-paints every part of a type (after a material or colour pick). */
  function look(type: PartType, o: Opt) { parts.forEach((p) => { if (ud(p).type === type) { paint(ud(p).main, o); if (p === selected) ud(p).flash = 1; } }); }

  const ray = new THREE.Raycaster(), mv = new THREE.Vector2();
  function pick(cx: number, cy: number) {
    const r = canvas.getBoundingClientRect(); mv.set(((cx - r.left) / r.width) * 2 - 1, (-(cy - r.top) / r.height) * 2 + 1); ray.setFromCamera(mv, cam);
    const hit = ray.intersectObjects(meshes.filter((o) => { const p = o.userData.part as THREE.Group; return p.visible && ud(p).dt > 0.5; }), false);
    return hit.length ? (hit[0].object.userData.part as THREE.Group) : null;
  }
  const ac = new AbortController(), sig = { signal: ac.signal };
  const ptrs = new Map<number, { x: number; y: number }>();
  let moved = 0, down = false, pinch = 0, lastTap = 0, ht = 0;
  const pd = () => { const p = [...ptrs.values()]; return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1; };
  const cl = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  canvas.addEventListener('pointerdown', (e2) => {
    canvas.setPointerCapture(e2.pointerId); ptrs.set(e2.pointerId, { x: e2.clientX, y: e2.clientY });
    if (ptrs.size === 1) { down = true; moved = 0; } else { moved = 99; pinch = pd(); }
    setAuto(false);
  }, sig);
  canvas.addEventListener('pointermove', (e2) => {
    const p = ptrs.get(e2.pointerId);
    if (p) {
      const dx = e2.clientX - p.x, dy = e2.clientY - p.y; p.x = e2.clientX; p.y = e2.clientY;
      if (walking) { walker.look(dx, dy, e2.pointerType === 'touch'); moved += Math.abs(dx) + Math.abs(dy); return; }
      if (ptrs.size === 1) { tAz -= dx * 0.008; tPol = cl(tPol - dy * 0.006, 0.3, 1.5); moved += Math.abs(dx) + Math.abs(dy); }
      else if (ptrs.size === 2) { const d = pd(); tZoom = cl((tZoom * pinch) / d, 0.3, 1.8); pinch = d; }
    } else if (!walking && e2.pointerType === 'mouse' && performance.now() - ht > 50) {
      ht = performance.now(); hover = pick(e2.clientX, e2.clientY); canvas.style.cursor = hover ? 'pointer' : 'grab';
    }
  }, sig);
  const up = (e2: PointerEvent, tap: boolean) => {
    ptrs.delete(e2.pointerId); if (ptrs.size) return;
    if (down && tap && moved < 8 && !walking) {
      const p = pick(e2.clientX, e2.clientY), n = performance.now();
      if (p && n - lastTap < 320) { toggleExplode(); lastTap = 0; } else { lastTap = n; select(p); }
    }
    down = false;
  };
  canvas.addEventListener('pointerup', (e2) => up(e2, true), sig);
  canvas.addEventListener('pointercancel', (e2) => up(e2, false), sig);
  canvas.addEventListener('pointerleave', () => { hover = null; }, sig);
  canvas.addEventListener('wheel', (e2) => { e2.preventDefault(); if (walking) return; tZoom = cl(tZoom * Math.exp(e2.deltaY * 0.001), 0.3, 1.8); }, { passive: false, signal: ac.signal });

  const host = canvas.parentElement!;
  const ro = new ResizeObserver(() => {
    w0 = host.clientWidth || 1; h0 = host.clientHeight || 1; renderer.setSize(w0, h0, false); post.setSize(w0, h0, renderer.getPixelRatio());
    aspect = w0 / h0; cam.aspect = aspect; cam.updateProjectionMatrix();
  });
  ro.observe(host);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) auto = false;
  const idle = (f: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(f, { timeout: 4000 }) : setTimeout(f, 2500));
  idle(() => light.warm());

  let last = performance.now(), raf = 0;
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!lay) return;
    const k = 1 - Math.exp(-dt * 3.5), kk = 1 - Math.exp(-dt * 10);
    e += (eT - e) * k; const ee = e * e * (3 - 2 * e);
    if (auto) tAz += dt * 0.18;
    az += (tAz - az) * kk; pol += (tPol - pol) * kk; zoom += (tZoom - zoom) * kk;
    const lvEx = level ? (parts.find((p) => ud(p).level === level)?.userData as U | undefined)?.ex ?? 0 : 0;
    const goal = level ? lay.levelY[level] + lvEx * ee : (lay.height + lay.maxEx * ee) / 2;
    ty += (goal - ty) * k; lf += ((level ? 0.55 : 1) - lf) * k;
    const span = Math.max(Math.hypot(lay.hx, lay.hz) * 1.1, (lay.height + lay.maxEx * ee) * 0.62);
    const dist = span * 3.5 * Math.max(1, 0.85 / aspect) * lf * zoom;
    if (walking) { walker.update(dt, cam); lamp.position.copy(cam.position); }
    else {
      cam.position.set(dist * Math.sin(pol) * Math.sin(az), ty + dist * Math.cos(pol), dist * Math.sin(pol) * Math.cos(az));
      cam.lookAt(0, ty, 0);
    }
    if (from.k < 1) {
      from.k = Math.min(1, from.k + dt / 0.9); const b = from.k * from.k * (3 - 2 * from.k);
      cam.position.lerpVectors(from.pos, cam.position, b); cam.quaternion.slerpQuaternions(from.q, cam.quaternion.clone(), b);
    }
    if (Math.abs(cam.fov - fovT) > 0.05) { cam.fov += (fovT - cam.fov) * kk; cam.updateProjectionMatrix(); }
    for (const p of parts) {
      const u = ud(p);
      u.d += (u.dt - u.d) * k; u.lift += ((u.sel ? 1 : 0) - u.lift) * kk; u.flash = Math.max(0, u.flash - dt * 2);
      const hs = u.sel ? 0.28 : p === hover ? 0.1 : 0;
      p.position.y = u.ex * ee + u.lift * 0.18;
      const rv = u.reveal ? ee : 1; p.visible = rv > 0.01;
      u.main.emissive.setHex(0xff8a3d); u.main.emissiveIntensity = Math.max(hs, u.flash * 0.5);
      const op = rv * u.d;
      if (Math.abs(op - u.lo) > 0.002) {
        u.lo = op;
        u.mats.forEach((m) => { m.opacity = m.userData.base * op; const tr = m.opacity < 0.999 || m.userData.base < 1; if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; } });
      }
    }
    guides.forEach((g) => { g.visible = ee > 0.02; (g.material as THREE.LineDashedMaterial).opacity = ee * 0.55; });
    post.render();
    // 'auto' steps down a tier when the last ~2 s stayed under 45 fps (never back up: no flicker between tiers)
    if (pickQ === 'auto' && tier !== 'low' && !document.hidden && meter.tick(dt) && meter.fps < 45) { applyTier(lower(tier)); state(); }
  }
  raf = requestAnimationFrame(frame);
  state();

  return {
    build, look, setLevel, toggleExplode, setAuto, setWalk, setTime, levels: () => lay?.levels ?? [],
    /** Quality pick: a fixed tier, or 'auto' (GPU guess, then steps down on slow frames). */
    setQuality(q: QualityPick) { pickQ = q; applyTier(q === 'auto' ? detectTier(renderer) : q); state(); },
    /** On-screen stick, -1..1 on both axes. */
    joy: (x: number, y: number) => { walker.joy.set(x, y); },
    select: (id: string | null) => select(id ? parts.find((p) => ud(p).id === id) ?? null : null),
    /** PNG of the current view at `scale` × the canvas size. */
    shot(scale = 2) {
      // full post chain at `scale` × the CSS size (the best tier's settings, whatever the live tier is)
      const sel = selected, keep = tier, pr = Math.min(4, scale * Math.max(1, devicePixelRatio || 1)); if (sel) ud(sel).sel = false;
      const st = settingsFor('high'); post.apply(st); setTime(time, season);
      renderer.setPixelRatio(pr); renderer.setSize(w0, h0, false); post.setSize(w0, h0, pr);
      post.render(); const url = canvas.toDataURL('image/png');
      applyTier(keep); setTime(time, season); if (sel) ud(sel).sel = true;
      return url;
    },
    destroy() {
      cancelAnimationFrame(raf); ac.abort(); ro.disconnect(); offLoad(); walker.detach(); clear();
      lamp.dispose(); light.dispose(); post.dispose(); pmrem.dispose();
      disposeSets(); void disposeModels(); renderer.dispose();
    },
  };
}
export type Configurator = ReturnType<typeof createConfigurator>;
