/** Parametric layered house for the configurator: foundation, per floor (slab, walls, openings, frame, wiring),
 *  top slab, rafters and roof cover. Dimensions are real metres and UVs are in metres, so the shop's PBR sets tile true to size. */
import * as THREE from 'three';
import type { Design, Roof } from '../design';
import type { PartType } from './catalog';
import { bx, boxGeo } from './geo';
import { buildInterior, interiorMats, planFloor } from './interior';
import { grid, holes, shellOpenings, shellWalls } from './shell';
import type { WalkFloor } from './walk';

export type Def = {
  id: string; level: string; type: PartType | 'interior'; floor: number; ex: number; reveal: boolean;
  build: (g: THREE.Group, m: THREE.MeshStandardMaterial) => void;
};
export type Layout = {
  defs: Def[]; levels: string[]; levelY: Record<string, number>; height: number; maxEx: number; hx: number; hz: number;
  plinth: number; doorX: number; floors: WalkFloor[];
};

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A beam of section w×h from a to b. */
function beam(g: THREE.Group, m: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, w: number, h: number) {
  const dir = b.clone().sub(a), len = dir.length(); if (len < 1e-3) return;
  const o = new THREE.Mesh(boxGeo(w, h, len), m);
  o.position.copy(a).add(b).multiplyScalar(0.5); o.quaternion.setFromUnitVectors(V(0, 0, 1), dir.normalize()); g.add(o);
}
/** Planar convex roof plane; UVs run along the eave (u) and up the slope (v), in metres. */
function plane(g: THREE.Group, m: THREE.Material, pts: THREE.Vector3[]) {
  const n = pts[1].clone().sub(pts[0]).cross(pts[2].clone().sub(pts[0]));
  if (n.y < 0) pts = [...pts].reverse();
  const U = pts[1].clone().sub(pts[0]).normalize(), N = pts[1].clone().sub(pts[0]).cross(pts[2].clone().sub(pts[0])).normalize();
  const Vv = N.clone().cross(U); if (Vv.y < 0) Vv.negate();
  const pos: number[] = [], uv: number[] = [];
  for (let i = 1; i < pts.length - 1; i++) for (const p of [pts[0], pts[i], pts[i + 1]]) { pos.push(p.x, p.y, p.z); uv.push(p.dot(U), p.dot(Vv)); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals(); g.add(new THREE.Mesh(geo, m));
}
/** Triangular end wall in the x = const plane: base along z from -hz..hz, apex at zApex (shape x maps to -z). */
function gableEnd(g: THREE.Group, m: THREE.Material, hz: number, rise: number, zApex: number, x: number, y: number, t: number) {
  const s = new THREE.Shape(); s.moveTo(-hz, 0); s.lineTo(hz, 0); s.lineTo(-zApex, rise); s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false }); geo.rotateY(Math.PI / 2);
  const o = new THREE.Mesh(geo, m); o.position.set(x, y, 0); g.add(o);
}
const spread = (from: number, to: number, n: number) => Array.from({ length: n }, (_, i) => (n === 1 ? (from + to) / 2 : from + ((to - from) * i) / (n - 1)));

export function layout(d: Design, roof: Roof): Layout {
  const L = d.length, W = d.width, N = Math.max(1, Math.round(d.floors)), H = d.floorHeight;
  const hx = L / 2, hz = W / 2, t = 0.3, F = 0.6, s = H / 2.6, o = 0.45;
  const defs: Def[] = [], levelY: Record<string, number> = { foundation: F / 2 };
  const gr = grid(L, W), floors: WalkFloor[] = [];
  /** Painted ceiling under a slab whose bottom is at y (seen only from below). */
  const ceiling = (g: THREE.Group, y: number) => {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(L - 0.62, W - 0.62).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf6f5f1, roughness: 0.95, emissive: 0x3a3936 }));
    c.position.y = y - 0.004; g.add(c);
  };
  const top = F + N * H, y0r = top + 0.2;
  const tp = roof === 'flat' ? 0 : Math.tan((d.roofPitch * Math.PI) / 180);
  const rise = roof === 'flat' ? 0.5 : roof === 'mono' ? W * tp : roof === 'hip' ? Math.min(hx, hz) * tp : hz * tp;

  defs.push({ id: 'foundation', level: 'foundation', type: 'foundation', floor: 0, ex: 0, reveal: false, build: (g, m) => { bx(g, m, L + 0.4, F, W + 0.4, 0, F / 2, 0); } });

  for (let i = 0; i < N; i++) {
    const y0 = F + i * H, yb = y0 + 0.2, h = H - 0.2, lv = `f${i}`, base = (0.8 + i * 2.2) * s, ex = base + 0.8 * s, last = i === N - 1;
    levelY[lv] = y0 + H / 2;
    const hs = holes(gr, i, yb), plan = planFloor(gr, i, L, W), im = interiorMats(d);   // per storey: fading one level must not fade another
    floors.push({ y: yb, segs: plan.segs, boxes: plan.boxes, spawn: plan.spawn });
    defs.push({ id: `${lv}_slab`, level: lv, type: 'slab', floor: i + 1, ex: base, reveal: false, build: (g, m) => { bx(g, m, L + 0.1, 0.2, W + 0.1, 0, y0 + 0.1, 0); if (i > 0) ceiling(g, y0); } });
    defs.push({ id: `${lv}_int`, level: lv, type: 'interior', floor: i + 1, ex: base, reveal: false, build: (g) => buildInterior(g, plan, im, yb, h, d.style) });
    defs.push({ id: `${lv}_walls`, level: lv, type: 'walls', floor: i + 1, ex, reveal: false, build: (g, m) => {
      shellWalls(g, m, im.paint, hx, hz, yb, h, hs);
      if (last && (roof === 'gable' || roof === 'mono')) {
        const apex = roof === 'gable' ? 0 : -hz, r = roof === 'gable' ? hz * tp : W * tp;
        gableEnd(g, m, hz, r, apex, hx - t, y0r, t); gableEnd(g, m, hz, r, apex, -hx, y0r, t);
      }
    } });
    defs.push({ id: `${lv}_open`, level: lv, type: 'open', floor: i + 1, ex, reveal: false, build: (g, m) => { shellOpenings(g, m, hx, hz, hs); } });
    defs.push({ id: `${lv}_frame`, level: lv, type: 'frame', floor: i + 1, ex, reveal: true, build: (g, m) => {
      const ix = hx - 0.35, iz = hz - 0.35;
      spread(-ix, ix, Math.max(2, Math.round(L / 4) + 1)).forEach((x) => [-iz, iz].forEach((z) => bx(g, m, 0.2, h, 0.2, x, yb + h / 2, z)));
      [-iz, iz].forEach((z) => bx(g, m, 2 * ix + 0.2, 0.2, 0.2, 0, yb + h - 0.1, z)); [-ix, ix].forEach((x) => bx(g, m, 0.2, 0.2, 2 * iz, x, yb + h - 0.1, 0));
    } });
    defs.push({ id: `${lv}_elec`, level: lv, type: 'elec', floor: i + 1, ex, reveal: true, build: (g, m) => {
      const y = yb + 0.3, iz = hz - t - 0.04, ix = hx - t - 0.04, so = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.5 });
      bx(g, m, 2 * ix, 0.06, 0.06, 0, y, -iz); [-ix, ix].forEach((x) => bx(g, m, 0.06, 0.06, 2 * iz, x, y, 0));
      spread(-ix + 1, ix - 1, Math.max(2, Math.round(L / 3))).forEach((x) => { bx(g, m, 0.06, 1.1, 0.06, x, y + 0.55, -iz); bx(g, so, 0.16, 0.16, 0.05, x, y + 1.15, -iz + 0.03); });
    } });
  }

  const topEx = (0.8 + N * 2.2) * s, rEx = topEx + 1.0 * s, cEx = rEx + 1.4 * s;
  levelY.roof = y0r + rise / 2;
  defs.push({ id: 'ceiling', level: 'roof', type: 'slab', floor: 0, ex: topEx, reveal: false, build: (g, m) => { bx(g, m, L + 0.1, 0.2, W + 0.1, 0, top + 0.1, 0); ceiling(g, top); } });

  const a = hx + o, b = hz + o, yE = y0r - o * tp, off = 0.14;
  const long = L >= W, A = long ? a : b, B = long ? b : a, M = (x: number, y: number, z: number) => (long ? V(x, y, z) : V(z, y, x));
  const yRidge = roof === 'hip' ? y0r + Math.min(hx, hz) * tp : y0r + hz * tp, r = Math.max(0, A - B);
  const yHigh = y0r + (W + o) * tp;

  defs.push({ id: 'rafters', level: 'roof', type: 'rafters', floor: 0, ex: rEx, reveal: false, build: (g, m) => {
    const lo = -0.1;
    if (roof === 'flat') { spread(-hx + 0.2, hx - 0.2, Math.max(2, Math.round(L / 0.8))).forEach((x) => bx(g, m, 0.1, 0.2, W - 0.2, x, y0r + 0.1, 0)); return; }
    if (roof === 'gable') {
      for (let x = -a; x <= a + 1e-3; x += 0.8) [b, -b].forEach((z) => beam(g, m, V(x, yE + lo, z), V(x, yRidge + lo, 0), 0.1, 0.2));
      bx(g, m, 2 * a, 0.2, 0.2, 0, yRidge - 0.15, 0); return;
    }
    if (roof === 'mono') { for (let x = -a; x <= a + 1e-3; x += 0.8) beam(g, m, V(x, yE + lo, b), V(x, yHigh + lo, -b), 0.1, 0.2); return; }
    for (let x = -r; x <= r + 1e-3; x += 0.8) [B, -B].forEach((z) => beam(g, m, M(x, yE + lo, z), M(x, yRidge + lo, 0), 0.1, 0.2));
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sz]) => beam(g, m, M(sx * A, yE + lo, sz * B), M(sx * r, yRidge + lo, 0), 0.12, 0.22));
    if (r > 0) beam(g, m, M(-r, yRidge - 0.15, 0), M(r, yRidge - 0.15, 0), 0.2, 0.2);
  } });

  defs.push({ id: 'cover', level: 'roof', type: 'cover', floor: 0, ex: cEx, reveal: false, build: (g, m) => {
    m.side = THREE.DoubleSide;
    const e = yE + off, rr = yRidge + off;
    if (roof === 'flat') {
      bx(g, m, L + 0.3, 0.16, W + 0.3, 0, y0r + 0.25, 0);
      [hz + 0.08, -(hz + 0.08)].forEach((z) => bx(g, m, L + 0.3, 0.4, 0.15, 0, y0r + 0.45, z));
      [hx + 0.08, -(hx + 0.08)].forEach((x) => bx(g, m, 0.15, 0.4, W + 0.3, x, y0r + 0.45, 0)); return;
    }
    if (roof === 'gable') {
      plane(g, m, [V(-a, e, b), V(a, e, b), V(a, rr, 0), V(-a, rr, 0)]); plane(g, m, [V(a, e, -b), V(-a, e, -b), V(-a, rr, 0), V(a, rr, 0)]);
      bx(g, m, 2 * a + 0.1, 0.14, 0.36, 0, rr + 0.05, 0); return;
    }
    if (roof === 'mono') { plane(g, m, [V(-a, e, b), V(a, e, b), V(a, yHigh + off, -b), V(-a, yHigh + off, -b)]); return; }
    plane(g, m, [M(-A, e, B), M(A, e, B), M(r, rr, 0), M(-r, rr, 0)]); plane(g, m, [M(A, e, -B), M(-A, e, -B), M(-r, rr, 0), M(r, rr, 0)]);
    plane(g, m, [M(A, e, B), M(A, e, -B), M(r, rr, 0)]); plane(g, m, [M(-A, e, -B), M(-A, e, B), M(-r, rr, 0)]);
    if (r > 0) beam(g, m, M(-r, rr + 0.05, 0), M(r, rr + 0.05, 0), 0.36, 0.14);
  } });

  const levels = ['', 'foundation', ...Array.from({ length: N }, (_, i) => `f${i}`), 'roof'];
  return { defs, levels, levelY, height: y0r + rise + 0.4, maxEx: cEx, hx, hz, plinth: F, doorX: gr.doorX, floors };
}
