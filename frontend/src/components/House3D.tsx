'use client';
import { MutableRefObject, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Built, buildHouse, PLINTH } from '@/lib/house/build';
import type { Design } from '@/lib/house/design';
import type { Zone } from '@/lib/house/kit';

export type View = { xray: boolean; roof: boolean; explode: number; rotate: boolean; dims: boolean };
export type Cam = 'iso' | 'front' | 'side' | 'top';
export type HouseApi = { shot: () => string | null; fly: (c: Cam) => void };

type Props = { design: Design; zones: string[]; view: View; unit: string; onZone?: (z: Zone) => void; onError?: () => void; apiRef?: MutableRefObject<HouseApi | null> };

const ACCENT = new THREE.Color('#b3502a');
const SKY = { night: new THREE.Color('#121725'), dusk: new THREE.Color('#e7a883'), day: new THREE.Color('#d9e4ea') };

/** Interactive 3D house: orbit, zoom, click a part to include/exclude that zone, live lighting by time of day and season. */
export default function House3D({ design, zones, view, unit, onZone, onError, apiRef }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const S = useRef<any>(null);                     // three.js state lives outside React
  const live = useRef({ design, zones, view, unit, onZone });
  live.current = { design, zones, view, unit, onZone };

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); }
    catch { onError?.(); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer(); labels.domElement.className = 'h3d-labels'; el.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 600);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.07; controls.maxPolarAngle = Math.PI / 2 - 0.04; controls.minDistance = 6;
    controls.autoRotateSpeed = 0.6;
    const hemi = new THREE.HemisphereLight('#ffffff', '#8a7f6a', 0.6); scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff4e2', 2.4); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    const moon = new THREE.DirectionalLight('#9db4ff', 0); moon.position.set(-30, 40, -20); scene.add(moon);
    scene.fog = new THREE.Fog(SKY.day.clone(), 60, 220);
    const dims = new THREE.Group(); scene.add(dims);
    const particles = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 0.09, color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }));
    scene.add(particles);
    const st = S.current = { renderer, labels, scene, camera, controls, sun, moon, hemi, dims, particles, built: null as Built | null, fly: null as THREE.Vector3 | null, hover: null as Zone | null, explode: 0, first: true, visible: true };

    const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
    const pick = (e: PointerEvent): Zone | null => {
      if (!st.built) return null;
      const r = renderer.domElement.getBoundingClientRect();
      ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      for (const h of ray.intersectObject(st.built.group, true)) {
        let o: THREE.Object3D | null = h.object, vis = true;
        for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) vis = false;
        if (vis && o.userData.zone) return o.userData.zone as Zone;
        if (vis && !(o as THREE.Mesh).userData.zone && (o as any).material?.transparent !== true) return null;
      }
      return null;
    };
    let down = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; controls.autoRotate = false; };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const z = pick(e); if (z) live.current.onZone?.(z);
    };
    const onMove = (e: PointerEvent) => { if (e.buttons) return; const z = pick(e); st.hover = z; renderer.domElement.style.cursor = z ? 'pointer' : 'grab'; };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', () => { st.hover = null; });

    const size = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); labels.setSize(w, h); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); };
    const ro = new ResizeObserver(size); ro.observe(el); size();
    const io = new IntersectionObserver(([e]) => { st.visible = e.isIntersecting; }); io.observe(el);

    const timer = new THREE.Timer();
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!st.visible || document.hidden) return;
      timer.update();
      const dt = Math.min(0.05, timer.getDelta()), t = timer.getElapsed(), { view: v, design: d } = live.current;
      if (st.fly) { camera.position.lerp(st.fly, 0.08); if (camera.position.distanceTo(st.fly) < 0.05) st.fly = null; }
      controls.autoRotate = v.rotate && !st.fly;
      controls.update();
      if (st.built) {
        const b = st.built as Built;
        st.explode += (v.explode - st.explode) * 0.12;
        b.floorGroups.forEach((g, i) => { g.position.y = PLINTH + i * d.floorHeight + i * st.explode; });
        b.roofGroup.position.y = PLINTH + d.floors * d.floorHeight + d.floors * st.explode;
        const hov = st.hover as Zone | null;
        for (const [z, mats] of Object.entries(b.kit.zoneMats) as [Zone, THREE.MeshStandardMaterial[]][]) for (const m of mats) {
          const target = hov === z ? 0.28 + Math.sin(t * 5) * 0.06 : 0;
          m.emissive.copy(ACCENT); m.emissiveIntensity += (target - m.emissiveIntensity) * 0.2;
        }
        b.group.traverse((o) => { if (o.userData.water) ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = 0.12 + Math.sin(t * 1.6) * 0.05; });
      }
      const pos = particles.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (pos && particles.visible) {
        const winter = live.current.design.season === 'winter', top = particles.userData.top || 30;
        for (let i = 0; i < pos.count; i++) {
          let y = pos.getY(i) - dt * (winter ? 1.4 : 0.9) * (0.6 + (i % 7) / 10);
          if (y < 0) y = top;
          pos.setXYZ(i, pos.getX(i) + Math.sin(t + i) * dt * 0.4, y, pos.getZ(i) + Math.cos(t * 0.7 + i) * dt * 0.3);
        }
        pos.needsUpdate = true;
      }
      renderer.render(scene, camera); labels.render(scene, camera);
    };
    loop();

    if (apiRef) apiRef.current = {
      shot: () => { try { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); } catch { return null; } },
      fly: (c) => {
        const r = st.built ? st.built.radius : 20, y = st.built ? st.built.top * 0.4 : 3;
        controls.target.set(0, y, 0);
        st.fly = { iso: new THREE.Vector3(r * 1.2, r * 0.72, r * 1.35), front: new THREE.Vector3(0, r * 0.28, r * 1.45), side: new THREE.Vector3(r * 1.45, r * 0.28, 0.01), top: new THREE.Vector3(0.01, r * 1.7, 0.4) }[c];
      },
    };
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); controls.dispose();
      if (st.built) { scene.remove(st.built.group); st.built.dispose(); }
      dims.clear(); particles.geometry.dispose(); (particles.material as THREE.Material).dispose();
      scene.environment?.dispose(); pmrem.dispose(); renderer.dispose();
      el.innerHTML = '';
      if (apiRef) apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild the house whenever the design changes (time of day only relights it).
  const { time, ...shape } = design;
  const key = JSON.stringify(shape);
  useEffect(() => {
    const st = S.current; if (!st) return;
    if (st.built) { st.scene.remove(st.built.group); st.built.dispose(); }
    const b = buildHouse(design); st.built = b; st.scene.add(b.group);
    const r = b.radius;
    st.controls.maxDistance = r * 3.2;
    const sh = st.sun.shadow.camera as THREE.OrthographicCamera; sh.left = sh.bottom = -r; sh.right = sh.top = r; sh.near = 1; sh.far = r * 6; sh.updateProjectionMatrix();
    if (st.first) { st.first = false; st.controls.target.set(0, b.top * 0.4, 0); st.camera.position.set(r * 1.2, r * 0.72, r * 1.35); }
    // seasonal particles: snow in winter, falling leaves in autumn
    const season = design.season, n = season === 'winter' ? 1600 : season === 'autumn' ? 260 : 0;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = (Math.random() - 0.5) * r * 2.2; arr[i * 3 + 1] = Math.random() * 30; arr[i * 3 + 2] = (Math.random() - 0.5) * r * 2.2; }
    st.particles.geometry.dispose(); st.particles.geometry = new THREE.BufferGeometry(); st.particles.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const pm = st.particles.material as THREE.PointsMaterial; pm.color.set(season === 'winter' ? '#ffffff' : '#c9772e'); pm.size = season === 'winter' ? 0.09 : 0.16;
    st.particles.visible = n > 0; st.particles.userData.top = 30;
    drawDims(st.dims, design, live.current.unit);
    applyView(st, live.current.view, live.current.zones); light(st, design.time, design.season);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { if (S.current?.built) applyView(S.current, view, zones); }, [view, zones]);
  useEffect(() => { if (S.current) light(S.current, time, design.season); }, [time, design.season]);
  useEffect(() => { if (S.current) drawDims(S.current.dims, design, unit); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [unit]);

  return <div ref={host} className="h3d" />;
}

/** Zones not in the estimate turn into ghosts; x-ray makes walls and roof see-through; the roof can be lifted off. */
function applyView(st: any, v: View, zones: string[]) {
  const b: Built = st.built;
  for (const [z, mats] of Object.entries(b.kit.zoneMats) as [Zone, THREE.MeshStandardMaterial[]][]) for (const m of mats) {
    const off = !zones.includes(z), see = v.xray && (z === 'walls' || z === 'roof');
    const op = off ? 0.16 : see ? 0.28 : 1;
    m.transparent = op < 1; m.opacity = op; m.depthWrite = op === 1; m.needsUpdate = true;
  }
  for (const c of b.roofGroup.children) c.visible = v.roof || c.userData.zone === 'ceiling';
  st.dims.visible = v.dims;
}

/** Sun path, sky colour, night lights. 6:00 sunrise, 18:00 sunset. */
function light(st: any, time: number, season: string) {
  const b: Built | null = st.built, r = b ? b.radius : 20;
  const a = ((time - 6) / 12) * Math.PI, elev = Math.sin(a), az = Math.cos(a);
  const low = season === 'winter' ? 0.65 : 1;
  st.sun.position.set(az * r * 1.6, Math.max(0.05, elev * low) * r * 2, r * 0.9);
  const day = Math.max(0, elev), night = Math.min(1, Math.max(0, (0.18 - elev) / 0.3));
  st.sun.intensity = day * 2.6; st.hemi.intensity = 0.18 + day * 0.55; st.moon.intensity = night * 0.45;
  st.renderer.toneMappingExposure = 0.85 + day * 0.25;
  st.scene.environmentIntensity = 0.15 + day * 0.35;
  const sky = SKY.night.clone().lerp(SKY.dusk, Math.min(1, Math.max(0, elev + 0.25) * 2.5)).lerp(SKY.day, Math.min(1, Math.max(0, elev - 0.15) * 2.2));
  st.scene.background = sky; st.scene.fog.color.copy(sky);
  if (b) {
    b.kit.glassLit.emissiveIntensity = night * 1.7; b.kit.glassDim.emissiveIntensity = night * 0.12; b.kit.lamp.emissiveIntensity = night * 2.2;
    b.lamps.forEach((l) => { l.intensity = night * 7; });
  }
}

/** Dimension lines with labels: length along the front, width on the left, wall height at the front-left corner. */
function drawDims(g: THREE.Group, d: Design, unit: string) {
  g.children.forEach((c) => { if (c instanceof CSS2DObject) c.element.remove(); });
  g.traverse((c) => { const l = c as THREE.LineSegments; if (l.geometry) { l.geometry.dispose(); (l.material as THREE.Material).dispose(); } });
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
