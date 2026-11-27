/** The plot around the house: ground in the chosen material with a soft edge, a paved path and steps to the door,
 *  optional fence, trees and shrubs (instanced GLB, by season) and a pool. Deterministic, so the yard does not jump on every rebuild. */
import * as THREE from 'three';
import type { Design } from '../design';
import { applySet } from '../materials/loader';
import { bx } from './geo';
import { addVegetation, type ShrubSpot, type TreeKind, type TreeSpot } from './trees';

export type Yard = { group: THREE.Group; px: number; pz: number; radius: number; fence: boolean };

function rnd(seed: number) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function tex(set: string, color: string, rough = 0.95) { const m = new THREE.MeshStandardMaterial({ color, roughness: rough }); m.userData.set = set; applySet(m, { set, color }); return m; }

/** Disc of ground; UV in metres for the texture and a second UV set (0..1) for the soft radial edge. */
function ground(r: number, m: THREE.MeshStandardMaterial) {
  const geo = new THREE.CircleGeometry(r, 96).rotateX(-Math.PI / 2), uv = geo.attributes.uv as THREE.BufferAttribute;
  geo.setAttribute('uv1', uv.clone());
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - 0.5) * 2 * r, (uv.getY(i) - 0.5) * 2 * r);
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d')!, grd = x.createRadialGradient(64, 64, 40, 64, 64, 64);
  grd.addColorStop(0, '#fff'); grd.addColorStop(1, '#000'); x.fillStyle = grd; x.fillRect(0, 0, 128, 128);
  const a = new THREE.CanvasTexture(c); a.channel = 1;
  m.alphaMap = a; m.transparent = true; m.depthWrite = true;
  const o = new THREE.Mesh(geo, m); o.receiveShadow = true; o.renderOrder = -1;
  return o;
}

export function buildYard(d: Design, hx: number, hz: number, doorX: number, plinth: number): Yard {
  const g = new THREE.Group(), r = rnd(Math.round(d.length * 31 + d.width * 17)), px = hx + 6, pz = hz + 7, radius = Math.hypot(px, pz) + 6;
  const winter = d.season === 'winter';
  const gm = tex(d.ground, winter ? '#e9eef2' : '#ffffff'); g.add(ground(radius, gm));
  // paved path from the gate to the door, and two steps up to the floor level
  const pave = tex('paving', '#ffffff', 0.85), len = pz - hz - 0.2;
  const path = new THREE.Mesh(new THREE.PlaneGeometry(1.6, len).rotateX(-Math.PI / 2), pave);
  const puv = path.geometry.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < puv.count; i++) puv.setXY(i, puv.getX(i) * 1.6, puv.getY(i) * len);
  path.position.set(doorX, 0.012, hz + 0.2 + len / 2); path.receiveShadow = true; g.add(path);
  const step = tex('concrete', '#ffffff', 0.8), sh = plinth + 0.2;
  bx(g, step, 1.8, sh * 0.66, 0.5, doorX, sh * 0.33, hz + 0.45); bx(g, step, 1.8, sh * 0.33, 0.45, doorX, sh * 0.165, hz + 0.92);
  if (d.extras.fence) {
    const wood = tex('wood', '#8a6a52', 0.85);
    const run = (ax: number, az: number, bx2: number, bz: number) => {
      const len2 = Math.hypot(bx2 - ax, bz - az), n = Math.max(1, Math.round(len2 / 2.4));
      for (let k = 0; k <= n; k++) { const f = k / n; bx(g, wood, 0.1, 1.3, 0.1, ax + (bx2 - ax) * f, 0.65, az + (bz - az) * f); }
      const alongX = az === bz;
      [0.35, 1.0].forEach((y) => bx(g, wood, alongX ? len2 : 0.05, 0.1, alongX ? 0.05 : len2, (ax + bx2) / 2, y, (az + bz) / 2));
    };
    run(-px, -pz, px, -pz); run(-px, -pz, -px, pz); run(px, -pz, px, pz); run(-px, pz, doorX - 1.1, pz); run(doorX + 1.1, pz, px, pz);
  }
  if (d.extras.pool) {
    const w = Math.min(6, hx * 1.2), dd = 3, z = -(hz + 3.2), stone = tex('travertine', '#ffffff', 0.7);
    [[w + 0.8, 0.4, 0, -dd / 2 - 0.2], [w + 0.8, 0.4, 0, dd / 2 + 0.2]].forEach(([a, b, x, zz]) => bx(g, stone, a, 0.12, b, x, 0.06, z + zz));
    [[-1], [1]].forEach(([s]) => bx(g, stone, 0.4, 0.12, dd, s * (w / 2 + 0.2), 0.06, z));
    const water = new THREE.Mesh(new THREE.PlaneGeometry(w, dd).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({
      color: 0x2f8fb8, roughness: 0.03, metalness: 0, ior: 1.33, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6, transparent: true, opacity: 0.9 }));
    water.position.set(0, 0.03, z); g.add(water);
  }
  if (d.extras.trees) {
    const trees: TreeSpot[] = [], shrubs: ShrubSpot[] = [], kinds: TreeKind[] = winter ? ['pine'] : d.season === 'autumn' ? ['oak', 'ash', 'aspen'] : ['oak', 'ash'];
    for (let k = 0; k < 60 && trees.length < 9; k++) {
      const x = (r() * 2 - 1) * (px - 1), z = (r() * 2 - 1) * (pz - 1);
      if (Math.abs(x) < hx + 2.2 && Math.abs(z) < hz + 2.2) continue;               // keep clear of the house
      if (Math.abs(x - doorX) < 2 && z > 0) continue;                                  // and of the path
      if (d.extras.pool && Math.abs(x) < hx + 1 && z < -hz && z > -(hz + 5.5)) continue;
      if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3.2)) continue;
      trees.push({ x, z, h: 5 + r() * 3.5, kind: kinds[Math.floor(r() * kinds.length)] });
    }
    if (!winter) [-1, 1].forEach((s) => [1.6, 3, 4.4].forEach((dx) => {   // shrubs along the facade
      const x = doorX + s * dx; if (Math.abs(x) > hx - 0.3) return;
      shrubs.push({ x, z: hz + 0.75, s: 0.55 + r() * 0.2 });
    }));
    void addVegetation(g, trees, shrubs, d.season, () => !g.userData.dead);
  }
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.castShadow !== true) { m.castShadow = !(m.geometry instanceof THREE.CircleGeometry); m.receiveShadow = true; } });
  return { group: g, px, pz, radius, fence: d.extras.fence };
}
