import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mesh } from '../kit';
import { boxM } from '../textures';
import type { StyleMats } from './styles';

/** Furniture built to the room's size. Every piece: back at z = 0, front toward +z, centred on x, standing on y = 0. */
const rb = (w: number, h: number, d: number, r = 0.03) => {
  const g = new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2) * 0.99);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute, pos = g.getAttribute('position') as THREE.BufferAttribute, n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {   // UVs in metres (box projection) so fabric weave keeps its real size
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    uv.setXY(i, ax > 0.5 ? pos.getZ(i) : pos.getX(i), ay > 0.5 ? pos.getZ(i) : pos.getY(i));
  }
  return g;
};
const put = (g: THREE.Group, m: THREE.Mesh, x: number, y: number, z: number) => { m.position.set(x, y, z); g.add(m); return m; };

export function sofa(w: number, m: StyleMats) {
  const g = new THREE.Group(), d = 0.95;
  put(g, mesh(rb(w, 0.22, d - 0.1, 0.04), m.fabric), 0, 0.2, d / 2 + 0.03);                 // base
  put(g, mesh(rb(w, 0.5, 0.22, 0.06), m.fabric), 0, 0.5, 0.13);                              // back
  for (const s of [-1, 1]) put(g, mesh(rb(0.2, 0.42, d - 0.05, 0.06), m.fabric), s * (w / 2 - 0.1), 0.42, d / 2);
  const seats = w > 2.2 ? 3 : 2, sw = (w - 0.42) / seats;
  for (let i = 0; i < seats; i++) {
    put(g, mesh(rb(sw - 0.01, 0.16, d - 0.32, 0.06), m.fabric), -w / 2 + 0.21 + sw * (i + 0.5), 0.39, d / 2 + 0.1);
    const back = put(g, mesh(rb(sw - 0.04, 0.42, 0.16, 0.07), m.fabric), -w / 2 + 0.21 + sw * (i + 0.5), 0.62, 0.3); back.rotation.x = -0.12;
  }
  for (const sx of [-1, 1]) for (const sz of [0.08, d - 0.08]) put(g, mesh(new THREE.CylinderGeometry(0.02, 0.015, 0.09, 10), m.metal), sx * (w / 2 - 0.08), 0.045, sz);
  return g;
}

export function bed(w: number, l: number, m: StyleMats) {
  const g = new THREE.Group();
  put(g, mesh(rb(w + 0.1, 0.3, l + 0.05, 0.02), m.wood), 0, 0.2, l / 2);
  put(g, mesh(rb(w + 0.14, 1.05, 0.08, 0.02), m.fabric), 0, 0.52, 0.04);                       // upholstered headboard
  put(g, mesh(rb(w, 0.22, l - 0.06, 0.06), m.bedding), 0, 0.46, l / 2 + 0.02);                 // mattress
  const duvet = put(g, mesh(rb(w + 0.04, 0.08, l * 0.68, 0.04), m.bedding), 0, 0.6, l * 0.62); duvet.scale.y = 1;
  const throwB = put(g, mesh(rb(w + 0.06, 0.03, 0.45, 0.015), m.fabric), 0, 0.655, l * 0.8); throwB.castShadow = false;
  const n = w > 1.2 ? 2 : 1;
  for (let i = 0; i < n; i++) { const p = put(g, mesh(rb(n === 2 ? w / 2 - 0.12 : w - 0.2, 0.14, 0.38, 0.06), m.bedding), n === 2 ? (i - 0.5) * (w / 2) : 0, 0.65, 0.28); p.rotation.x = -0.35; }
  return g;
}

export function wardrobe(w: number, m: StyleMats) {
  const g = new THREE.Group(), h = 2.25, d = 0.6, doors = Math.max(2, Math.round(w / 0.55));
  put(g, mesh(boxM(w, h, d - 0.02), m.fronts), 0, h / 2, (d - 0.02) / 2);
  const dw = w / doors;
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + dw * (i + 0.5);
    put(g, mesh(boxM(dw - 0.006, h - 0.06, 0.02), m.fronts), x, h / 2, d);
    put(g, mesh(boxM(0.015, 0.3, 0.025), m.metal), x + (i % 2 ? -1 : 1) * (dw / 2 - 0.05), 1.1, d + 0.02);
  }
  return g;
}

/** Straight kitchen run: base units with worktop, sink and hob, wall units where `upper` allows. */
export function kitchenRun(len: number, m: StyleMats, opts: { sink: number | null; hob: number | null; upper: [number, number][]; fridge: boolean; tile: THREE.Material }) {
  const g = new THREE.Group(), d = 0.6, bh = 0.86;
  const base = opts.fridge ? len - 0.62 : len, bx = opts.fridge ? -len / 2 + base / 2 : 0;
  put(g, mesh(boxM(base, 0.1, d - 0.06), m.metal), bx, 0.05, (d - 0.06) / 2);                    // plinth
  const units = Math.max(1, Math.round(base / 0.6)), uw = base / units;
  for (let i = 0; i < units; i++) {
    const x = bx - base / 2 + uw * (i + 0.5);
    put(g, mesh(boxM(uw - 0.004, bh - 0.12, 0.02), m.fronts), x, 0.1 + (bh - 0.12) / 2 + 0.01, d - 0.01);
    put(g, mesh(boxM(0.14, 0.012, 0.02), m.metal), x, bh - 0.08, d + 0.01);
  }
  put(g, mesh(boxM(base, bh - 0.1, d - 0.04), m.fronts), bx, 0.1 + (bh - 0.1) / 2, (d - 0.04) / 2);
  put(g, mesh(boxM(base + 0.02, 0.04, d + 0.02), m.counter), bx, bh + 0.02, d / 2 + 0.01);         // worktop
  const back = put(g, mesh(boxM(base, 0.58, 0.012), opts.tile, undefined, false), bx, bh + 0.33, 0.006); back.castShadow = false;   // splashback
  if (opts.sink !== null) {
    put(g, mesh(boxM(0.5, 0.012, 0.4), m.chrome), opts.sink, bh + 0.035, d / 2);
    const tap = put(g, mesh(new THREE.TorusGeometry(0.12, 0.012, 8, 20, Math.PI), m.chrome), opts.sink, bh + 0.05, 0.08); tap.rotation.y = Math.PI / 2;
  }
  if (opts.hob !== null) {
    put(g, mesh(boxM(0.58, 0.008, 0.5), m.screen), opts.hob, bh + 0.044, d / 2);
    put(g, mesh(boxM(0.6, 0.06, 0.5), m.chrome), opts.hob, 1.62, 0.25);                            // hood
    put(g, mesh(boxM(0.3, 0.6, 0.25), m.chrome), opts.hob, 1.95, 0.13);
  }
  for (const [a, b] of opts.upper) {   // wall cabinets (a..b along the run, run-local x)
    const w = b - a; if (w < 0.35) continue;
    const n = Math.max(1, Math.round(w / 0.5)), cw = w / n;
    for (let i = 0; i < n; i++) put(g, mesh(boxM(cw - 0.004, 0.7, 0.34), m.fronts), a + cw * (i + 0.5), 1.5 + 0.35, 0.17);
  }
  if (opts.fridge) {
    put(g, mesh(rb(0.6, 2.0, 0.64, 0.02), m.chrome), len / 2 - 0.31, 1.0, 0.32);
    put(g, mesh(boxM(0.02, 0.5, 0.03), m.metal), len / 2 - 0.55, 1.15, 0.66);
  }
  return g;
}

export function diningTable(w: number, l: number, m: StyleMats) {
  const g = new THREE.Group();
  put(g, mesh(rb(w, 0.04, l, 0.01), m.wood), 0, 0.74, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(g, mesh(boxM(0.05, 0.72, 0.05), m.metal), sx * (w / 2 - 0.08), 0.36, sz * (l / 2 - 0.08));
  return g;
}

export function tvWall(w: number, m: StyleMats) {
  const g = new THREE.Group(), tw = Math.min(1.45, w * 0.7);
  put(g, mesh(boxM(tw, tw * 0.5625, 0.03), m.screen), 0, 1.25, 0.03);
  put(g, mesh(boxM(Math.min(w, 2.0), 0.42, 0.4), m.fronts), 0, 0.3, 0.2);
  return g;
}

export function bathtub(m: StyleMats) {
  const g = new THREE.Group();
  put(g, mesh(rb(1.7, 0.58, 0.76, 0.08), m.ceramic), 0, 0.29, 0.38);
  const water = put(g, mesh(rb(1.5, 0.02, 0.56, 0.01), m.chrome), 0, 0.56, 0.38); water.visible = false;
  const tap = put(g, mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 10), m.chrome), 0.7, 0.68, 0.06); tap.rotation.x = Math.PI / 2;
  return g;
}

export function shower(m: StyleMats) {
  const g = new THREE.Group();
  put(g, mesh(boxM(0.9, 0.05, 0.9), m.ceramic), 0, 0.025, 0.45);
  put(g, mesh(boxM(0.9, 2.0, 0.01), m.showerGlass, undefined, false), 0, 1.05, 0.9);
  put(g, mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 20), m.chrome), 0, 2.0, 0.25);
  put(g, mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 8), m.chrome), 0, 1.55, 0.02);
  return g;
}

export function toilet(m: StyleMats) {
  const g = new THREE.Group();
  put(g, mesh(rb(0.36, 0.4, 0.5, 0.12), m.ceramic), 0, 0.2, 0.35);
  put(g, mesh(rb(0.38, 0.04, 0.48, 0.15), m.ceramic), 0, 0.42, 0.36);
  put(g, mesh(rb(0.4, 0.38, 0.16, 0.04), m.ceramic), 0, 0.62, 0.08);
  return g;
}

export function vanity(w: number, m: StyleMats) {
  const g = new THREE.Group();
  put(g, mesh(boxM(w, 0.45, 0.46), m.fronts), 0, 0.62, 0.23);
  put(g, mesh(rb(w + 0.02, 0.05, 0.48, 0.01), m.counter), 0, 0.87, 0.24);
  put(g, mesh(rb(0.42, 0.12, 0.34, 0.04), m.ceramic), 0, 0.95, 0.25);
  const tap = put(g, mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 10), m.chrome), 0, 1.05, 0.06); tap.rotation.x = 0.0;
  put(g, mesh(boxM(Math.min(0.9, w), 0.8, 0.02), m.mirror, undefined, false), 0, 1.55, 0.012);
  return g;
}

export function rug(w: number, l: number, m: StyleMats) {
  const g = new THREE.Group(), r = mesh(rb(w, 0.012, l, 0.005), m.rug, undefined, false);
  r.position.y = 0.006; g.add(r);
  return g;
}

export function console_(w: number, m: StyleMats) {
  const g = new THREE.Group();
  put(g, mesh(boxM(w, 0.75, 0.35), m.fronts), 0, 0.42, 0.175);
  put(g, mesh(boxM(w + 0.02, 0.03, 0.37), m.wood), 0, 0.81, 0.185);
  put(g, mesh(boxM(Math.min(0.7, w), 0.9, 0.02), m.mirror, undefined, false), 0, 1.55, 0.012);
  return g;
}

export function pendant(m: StyleMats) {
  const g = new THREE.Group();
  put(g, mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.5, 6), m.metal), 0, -0.25, 0);
  put(g, mesh(new THREE.SphereGeometry(0.14, 20, 14), m.bulb, undefined, false), 0, -0.58, 0);
  return g;
}
