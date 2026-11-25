'use client';
import { MutableRefObject, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Built, buildHouse, PLINTH } from '@/lib/house/build';
import { Navigator, type Mode } from '@/lib/house/controls';
import type { Design } from '@/lib/house/design';
import { disposeModels } from '@/lib/house/gltf';
import { buildInterior, type Interior } from '@/lib/house/interior';
import type { Zone } from '@/lib/house/kit';
import { Lighting } from '@/lib/house/lighting';
import { disposeSets, initTextures, onProgress as watchTextures } from '@/lib/house/materials/loader';
import { Post } from '@/lib/house/post';
import { detectTier, FpsMeter, lower, settingsFor, type QualityPick, type Settings, type Tier } from '@/lib/house/quality';
import { disposeTextures } from '@/lib/house/textures';
import { addVegetation } from '@/lib/house/vegetation';
import type { WalkWorld } from '@/lib/house/walk';

export type { Mode };
export type View = { xray: boolean; roof: boolean; explode: number; rotate: boolean; dims: boolean; mode: Mode; level: number };
export type Cam = 'iso' | 'front' | 'side' | 'top';
export type Stats = { fps: number; calls: number; tris: number; tier: Tier; geometries: number; textures: number };
export type HouseApi = { shot: (scale?: number) => string | null; fly: (c: Cam) => void; joy: (x: number, y: number) => void; stats: () => Stats };

type Props = {
  design: Design; zones: string[]; view: View; unit: string; quality: QualityPick;
  onZone?: (z: Zone) => void; onError?: () => void; onProgress?: (pending: number, done: number) => void; onTier?: (t: Tier) => void;
  apiRef?: MutableRefObject<HouseApi | null>;
};

type St = {
  renderer: THREE.WebGLRenderer; labels: CSS2DRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; nav: Navigator; light: Lighting; post: Post;
  built: Built | null; interior: Interior | null; wantInterior: boolean; veg: THREE.Material[]; gen: number;
  dims: THREE.Group; particles: THREE.Points; hover: Zone | null; explode: number; first: boolean; visible: boolean;
  settings: Settings; pick: QualityPick; meter: FpsMeter; pool: THREE.PointLight[]; poolT: number; mode: Mode; stats: Stats; cooldown: number;
};

const ACCENT = new THREE.Color('#b3502a');

/** Interactive 3D house: orbit / cutaway / walk-through, click a part to include or exclude that zone, lighting by time of day and season. */
export default function House3D({ design, zones, view, unit, quality, onZone, onError, onProgress, onTier, apiRef }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const S = useRef<St | null>(null);
  const live = useRef({ design, zones, view, unit, onZone, quality, onTier });
  live.current = { design, zones, view, unit, onZone, quality, onTier };

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false }); }
    catch { onError?.(); return; }
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;   // more contrast than AgX: closer to the archviz look renderer.toneMappingExposure = 1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.info.autoReset = false;
    el.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer(); labels.domElement.className = 'h3d-labels'; el.appendChild(labels.domElement);
    initTextures(renderer);
    const offProgress = onProgress ? watchTextures(onProgress) : () => {};

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 1200);
    const light = new Lighting(scene, pmrem, renderer);
    const post = new Post(renderer, scene, camera);
    const tier = live.current.quality === 'auto' ? detectTier(renderer) : live.current.quality;
    const dims = new THREE.Group(); scene.add(dims);
    const particles = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 0.09, color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }));
    scene.add(particles);
    const st: St = S.current = {
      renderer, labels, scene, camera, light, post, built: null, interior: null, wantInterior: false, veg: [], gen: 0,
      nav: null as unknown as Navigator, dims, particles, hover: null, explode: 0, first: true, visible: true,
      settings: settingsFor(tier), pick: live.current.quality, meter: new FpsMeter(), pool: [], poolT: 0, mode: 'exterior', stats: { fps: 60, calls: 0, tris: 0, tier, geometries: 0, textures: 0 }, cooldown: 4,
    };
    st.nav = new Navigator(camera, renderer.domElement, () => walkWorld(st));
    applySettings(st); live.current.onTier?.(tier);
    light.warm();

    const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
    const pick = (e: PointerEvent): Zone | null => {
      if (!st.built || st.mode === 'walk') return null;
      const r = renderer.domElement.getBoundingClientRect();
      ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      for (const h of ray.intersectObject(st.built.group, true)) {
        const o = h.object; let vis = true;
        for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) vis = false;
        if (!vis) continue;
        if (o.userData.zone) return o.userData.zone as Zone;
        const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (mat && !Array.isArray(mat) && mat.transparent) continue;
        return null;
      }
      return null;
    };
    let down = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; st.nav.orbit.autoRotate = false; };
    const onUp = (e: PointerEvent) => { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return; const z = pick(e); if (z) live.current.onZone?.(z); };
    const onMove = (e: PointerEvent) => { if (e.buttons || st.mode === 'walk') return; const z = pick(e); st.hover = z; renderer.domElement.style.cursor = z ? 'pointer' : 'grab'; };
    const onLeave = () => { st.hover = null; };
    const cv = renderer.domElement;
    cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointerup', onUp); cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerleave', onLeave);

    const size = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h); labels.setSize(w, h); post.setSize(w, h, st.settings.pixelRatio);
      camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(size); ro.observe(el); size();
    const io = new IntersectionObserver(([e]) => { st.visible = e.isIntersecting; }); io.observe(el);

    const timer = new THREE.Timer();
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!st.visible || document.hidden) return;
      timer.update();
      const dt = Math.min(0.05, timer.getDelta()), t = timer.getElapsed(), { view: v, design: d } = live.current;
      st.nav.orbit.autoRotate = v.rotate && st.mode === 'exterior' && !st.nav.busy;
      st.nav.update(dt);
      if (st.built) frame(st, v, d, t, dt);
      renderer.info.reset();
      post.render(); labels.render(scene, camera);
      st.stats.calls = renderer.info.render.calls; st.stats.tris = renderer.info.render.triangles;
      st.stats.geometries = renderer.info.memory.geometries; st.stats.textures = renderer.info.memory.textures;
      if (st.meter.tick(dt)) st.stats.fps = st.meter.fps;
      adapt(st, dt);
    };
    loop();

    if (apiRef) apiRef.current = {
      shot: (scale = 2) => shot(st, el, scale),
      fly: (c) => {
        if (st.mode !== 'exterior') return;
        const r = st.built ? st.built.radius : 20, y = st.built ? st.built.top * 0.4 : 3;
        const to = { iso: new THREE.Vector3(r * 1.2, r * 0.72, r * 1.35), front: new THREE.Vector3(0, r * 0.28, r * 1.45), side: new THREE.Vector3(r * 1.45, r * 0.28, 0.01), top: new THREE.Vector3(0.01, r * 1.7, 0.4) }[c];
        st.nav.fly(to, new THREE.Vector3(0, y, 0));
      },
      joy: (x, y) => { st.nav.walker.joy.set(x, y); },
      stats: () => ({ ...st.stats, tier: st.settings.tier }),
    };
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); offProgress();
      cv.removeEventListener('pointerdown', onDown); cv.removeEventListener('pointerup', onUp); cv.removeEventListener('pointermove', onMove); cv.removeEventListener('pointerleave', onLeave);
      st.gen++; st.nav.dispose(); drop(st);
      dims.clear(); particles.geometry.dispose(); (particles.material as THREE.Material).dispose();
      st.pool.forEach((l) => l.dispose());
      light.dispose(); post.dispose(); pmrem.dispose();
      disposeTextures(); disposeSets(); void disposeModels();
      renderer.dispose(); el.innerHTML = '';
      if (apiRef) apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild the house whenever the design changes (time of day only relights it).
  const { time, ...shape } = design;
  const key = JSON.stringify(shape);
  useEffect(() => {
    const st = S.current; if (!st) return;
    drop(st);
    const b = buildHouse(design), gen = ++st.gen; st.built = b; st.scene.add(b.group);
    const alive = () => st.gen === gen;
    void addVegetation(b.group, b.trees, b.shrubs, design.season, alive).then((mats) => { if (alive()) st.veg = mats; else mats.forEach((m) => m.dispose()); });
    if (st.wantInterior) st.interior = buildInterior(b, design, alive);
    glass(st);
    const r = b.radius;
    st.nav.orbit.maxDistance = r * 3.2;
    st.light.fit(new THREE.Vector3(0, 0, 0), r);
    if (st.first) { st.first = false; st.nav.orbit.target.set(0, b.top * 0.4, 0); st.camera.position.set(r * 1.2, r * 0.72, r * 1.35); }
    // seasonal particles: snow in winter, falling leaves in autumn
    const season = design.season, n = season === 'winter' ? 1600 : season === 'autumn' ? 260 : 0;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = (Math.random() - 0.5) * r * 2.2; arr[i * 3 + 1] = Math.random() * 30; arr[i * 3 + 2] = (Math.random() - 0.5) * r * 2.2; }
    st.particles.geometry.dispose(); st.particles.geometry = new THREE.BufferGeometry(); st.particles.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const pm = st.particles.material as THREE.PointsMaterial; pm.color.set(season === 'winter' ? '#ffffff' : '#c9772e'); pm.size = season === 'winter' ? 0.09 : 0.16;
    st.particles.visible = n > 0; st.particles.userData.top = 30;
    drawDims(st.dims, design, live.current.unit);
    applyView(st, live.current.view, live.current.zones); relight(st, design.time, design.season);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { if (S.current?.built) applyView(S.current, view, zones); }, [view, zones]);
  useEffect(() => { if (S.current) relight(S.current, time, design.season); }, [time, design.season]);
  useEffect(() => { if (S.current) drawDims(S.current.dims, design, unit); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [unit]);
  useEffect(() => {   // view mode: build the interior on first entry, then move the camera
    const st = S.current; if (!st) return;
    if (view.mode !== 'exterior' && !st.wantInterior) {
      st.wantInterior = true;
      if (st.built) { const gen = st.gen; st.interior = buildInterior(st.built, live.current.design, () => st.gen === gen); glass(st); }
    }
    if (view.mode !== st.mode) {
      if (st.mode === 'cutaway' && st.built) { for (const w of st.built.walls) w.group.visible = true; st.built.floorGroups.forEach((g) => { g.visible = true; }); }
      st.mode = view.mode; st.nav.setMode(view.mode, st.built); applyView(st, view, live.current.zones);
    }
  }, [view]);
  useEffect(() => {   // quality picker
    const st = S.current; if (!st) return;
    const t = quality === 'auto' ? detectTier(st.renderer) : quality;
    st.pick = quality; st.settings = settingsFor(t); st.cooldown = 4; st.meter.reset(); applySettings(st); onTier?.(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality]);

  return <div ref={host} className="h3d" />;
}

/** Free the current house (and its interior and vegetation materials). */
function drop(st: St) {
  if (st.interior) { st.interior.dispose(); st.interior = null; }
  if (st.built) { st.scene.remove(st.built.group); st.built.dispose(); st.built = null; }
  st.veg.forEach((m) => m.dispose()); st.veg = [];
}

/** With an interior behind them, windows are clear; an empty shell gets a darker, more reflective pane. */
function glass(st: St) {
  if (!st.built) return;
  const k = st.built.kit, op = st.interior ? 0.16 : 0.62;
  for (const g of [k.glass, k.glassLit, k.glassDim]) { g.opacity = op; g.color.set(st.interior ? '#c9d6dc' : '#26303a'); }
}

function walkWorld(st: St): WalkWorld | null {
  const b = st.built, i = st.interior; if (!b || !i) return null;
  const d = b.kit.d, L = d.length, W = d.width;
  return { interior: i, plinth: PLINTH, h: d.floorHeight, floors: d.floors, doorHalf: 0.5,
    house: { x0: -L / 2, x1: L / 2, z0: -W / 2, z1: W / 2 }, plot: { x0: -b.plotX + 0.4, x1: b.plotX - 0.4, z0: -b.plotZ + 0.4, z1: b.plotZ + 2 } };
}

function applySettings(st: St) {
  const s = st.settings, el = st.renderer.domElement.parentElement;
  st.renderer.setPixelRatio(s.pixelRatio);
  st.post.apply(s);
  st.light.setShadow(s.shadowMap, s.shadowRadius);
  if (el) st.post.setSize(el.clientWidth, el.clientHeight, s.pixelRatio);
  if (st.pool.length !== s.lights) {   // a fixed pool of room lights, re-aimed at the nearest rooms (no shader recompiles while moving)
    st.pool.forEach((l) => { st.scene.remove(l); l.dispose(); });
    st.pool = Array.from({ length: s.lights }, () => { const l = new THREE.PointLight('#ffd9a8', 0, 7.5, 2); st.scene.add(l); return l; });
  }
}

/** Auto quality: step down when frames stay slow, after a warm-up. */
function adapt(st: St, dt: number) {
  st.cooldown -= dt;
  if (st.pick !== 'auto' || st.cooldown > 0 || st.settings.tier === 'low' || st.stats.fps >= 40) return;
  st.settings = settingsFor(lower(st.settings.tier)); st.cooldown = 5; st.meter.reset(); applySettings(st);
}

function frame(st: St, v: View, d: Design, t: number, dt: number) {
  const b = st.built!;
  st.explode += ((v.mode === 'exterior' ? v.explode : 0) - st.explode) * 0.12;
  b.floorGroups.forEach((g, i) => { g.position.y = PLINTH + i * d.floorHeight + i * st.explode; });
  b.roofGroup.position.y = PLINTH + d.floors * d.floorHeight + d.floors * st.explode;
  const hide = ['porchTop', 'cutHide'].map((n) => b.group.getObjectByName(n));
  if (v.mode === 'cutaway') { st.nav.cut(b, Math.min(v.level, d.floors - 1)); b.roofGroup.visible = false; }
  else b.roofGroup.visible = true;
  for (const o of hide) if (o) o.visible = v.mode !== 'cutaway';
  const door = b.group.getObjectByName('frontDoor');
  if (door) door.rotation.y += ((v.mode === 'walk' ? 1.45 : 0) - door.rotation.y) * Math.min(1, dt * 2.5);   // swings inward
  const hov = st.hover;
  for (const [z, mats] of Object.entries(b.kit.zoneMats) as [Zone, THREE.MeshStandardMaterial[]][]) for (const m of mats) {
    const target = hov === z ? 0.28 + Math.sin(t * 5) * 0.06 : 0;
    m.emissive.copy(ACCENT); m.emissiveIntensity += (target - m.emissiveIntensity) * 0.2;
  }
  const pos = st.particles.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  st.particles.visible = !!pos && pos.count > 0 && v.mode !== 'walk';
  if (pos && st.particles.visible) {
    const winter = d.season === 'winter', top = (st.particles.userData.top as number) || 30;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) - dt * (winter ? 1.4 : 0.9) * (0.6 + (i % 7) / 10);
      if (y < 0) y = top;
      pos.setXYZ(i, pos.getX(i) + Math.sin(t + i) * dt * 0.4, y, pos.getZ(i) + Math.cos(t * 0.7 + i) * dt * 0.3);
    }
    pos.needsUpdate = true;
  }
  // room lights follow the camera: the nearest lit rooms get the pool
  st.poolT -= dt;
  if (st.interior && st.poolT <= 0) {
    st.poolT = 0.4;
    const cam = st.camera.position, all: THREE.Vector3[] = [];
    st.interior.lights.forEach((ls, f) => { if (!b.floorGroups[f].visible) return; for (const p of ls) all.push(p.clone().setY(p.y + b.floorGroups[f].position.y)); });
    all.sort((p, q) => p.distanceToSquared(cam) - q.distanceToSquared(cam));
    const { night, day } = st.light.state, inside = v.mode !== 'exterior';
    st.pool.forEach((l, i) => {
      const p = all[i];
      if (!p) { l.intensity = 0; return; }
      l.position.copy(p); l.intensity = (inside ? 2.2 + night * 5 : night * 6) * (1 - day * 0.4);
    });
  } else if (!st.interior) st.pool.forEach((l) => { l.intensity = 0; });
  st.post.setNight(st.light.state.night, v.mode !== 'exterior');
  // eyes adapt indoors: rooms get a fraction of the outdoor light, so the camera opens up
  const target = st.light.exposure * (v.mode === 'walk' ? 1.6 : v.mode === 'cutaway' ? 1.08 : 1);
  st.renderer.toneMappingExposure += (target - st.renderer.toneMappingExposure) * Math.min(1, dt * 3);
}

/** Zones not in the estimate turn into ghosts; x-ray makes walls and roof see-through; the roof can be lifted off. */
function applyView(st: St, v: View, zones: string[]) {
  const b = st.built; if (!b) return;
  const walk = v.mode === 'walk';
  for (const [z, mats] of Object.entries(b.kit.zoneMats) as [Zone, THREE.MeshStandardMaterial[]][]) for (const m of mats) {
    const off = !walk && !zones.includes(z), see = !walk && v.xray && v.mode === 'exterior' && (z === 'walls' || z === 'roof');
    const op = off ? 0.16 : see ? 0.28 : 1;
    m.transparent = op < 1; m.opacity = op; m.depthWrite = op === 1; m.needsUpdate = true;
  }
  for (const c of b.roofGroup.children) c.visible = walk || v.roof || c.userData.zone === 'ceiling';
  st.dims.visible = v.dims && v.mode === 'exterior';
}

/** Sun, sky, HDRI and the night lights. */
function relight(st: St, time: number, season: string) {
  const s = st.light.update(time, season), b = st.built;
  if (b) {
    b.kit.glassLit.emissiveIntensity = s.night * (st.interior ? 0.25 : 1.6); b.kit.glassDim.emissiveIntensity = s.night * 0.05;
    b.kit.lamp.emissiveIntensity = 0.4 + s.night * 6;
    b.lamps.forEach((l) => { l.intensity = s.night * 7; });
  }
}

/** High-resolution still: re-renders at `scale`× the screen resolution (capped at 4096 px wide). */
function shot(st: St, el: HTMLElement, scale: number) {
  const w = el.clientWidth, h = el.clientHeight, pr = st.settings.pixelRatio, big = Math.min(pr * scale, 4096 / Math.max(1, w));
  try {
    st.renderer.setPixelRatio(big); st.renderer.setSize(w, h); st.post.setSize(w, h, big);
    st.post.render();
    return st.renderer.domElement.toDataURL('image/png');
  } catch { return null; }
  finally { st.renderer.setPixelRatio(pr); st.renderer.setSize(w, h); st.post.setSize(w, h, pr); }
}

/** Dimension lines with labels: length along the front, width on the left, wall height at the front-left corner. */
function drawDims(g: THREE.Group, d: Design, unit: string) {
  g.children.forEach((c) => { if (c instanceof CSS2DObject) c.element.remove(); });
  g.traverse((c) => { const l = c as THREE.LineSegments; if (l.isLineSegments) { l.geometry.dispose(); (l.material as THREE.Material).dispose(); } });
  g.clear();
  const L = d.length, W = d.width, H = d.floors * d.floorHeight, zf = W / 2 + (d.extras.porch ? 2.6 : 1.4), xl = -L / 2 - 1.3, y = 0.06;
  const pts = [
    [-L / 2, y, zf, L / 2, y, zf], [-L / 2, y, zf - 0.25, -L / 2, y, zf + 0.25], [L / 2, y, zf - 0.25, L / 2, y, zf + 0.25],
    [xl, y, -W / 2, xl, y, W / 2], [xl - 0.25, y, -W / 2, xl + 0.25, y, -W / 2], [xl - 0.25, y, W / 2, xl + 0.25, y, W / 2],
    [xl, PLINTH, W / 2, xl, PLINTH + H, W / 2], [xl - 0.25, PLINTH, W / 2, xl + 0.25, PLINTH, W / 2], [xl - 0.25, PLINTH + H, W / 2, xl + 0.25, PLINTH + H, W / 2],
  ].flat();
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#b3502a', depthTest: false, transparent: true }));
  lines.renderOrder = 10; g.add(lines);
  const label = (text: string, x: number, yy: number, z: number) => {
    const div = document.createElement('div'); div.className = 'dim-label'; div.textContent = text;
    const o = new CSS2DObject(div); o.position.set(x, yy, z); g.add(o);
  };
  const f = (n: number) => `${n.toFixed(1)} ${unit}`;
  label(f(L), 0, y + 0.3, zf); label(f(W), xl, y + 0.3, 0); label(f(H), xl, PLINTH + H / 2, W / 2);
}
