/** Generated interior of one storey: rooms laid out on the window grid (partitions never cut a window), furniture per room
 *  type in the chosen style, tiled wet rooms, and the collision walls / footprints for walking. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Design, Style } from '../design';
import { applySet } from '../materials/loader';
import { slotFor } from './furnish';
import { bx } from './geo';
import { WALL_T, type Grid } from './shell';

export type Seg = [number, number, number, number];
export type Rect = [number, number, number, number];   // x0, z0, x1, z1
type Kind = 'living' | 'kitchen' | 'bath' | 'bed' | 'kids' | 'study' | 'studio';
type Room = { kind: Kind; x0: number; x1: number; z0: number; z1: number };
type Item = { kind: string; x: number; z: number; rot: number; size: [number, number] };
export type FloorPlan = { rooms: Room[]; parts: Seg[]; items: Item[]; rugs: [number, number, number, number][]; segs: Seg[]; boxes: Rect[]; spawn: [number, number] };

const SIZE: Record<string, [number, number]> = {
  sofa: [2.1, 0.9], armchair: [0.85, 0.85], ctable: [1.0, 0.6], tv: [1.6, 0.45], shelf: [1.0, 0.35], plant: [0.5, 0.5],
  fridge: [0.7, 0.68], dining: [1.6, 2.0], bedD: [1.8, 2.1], bedS: [1.1, 2.1], nstand: [0.45, 0.4], wardrobe: [1.6, 0.6],
  desk: [1.4, 1.3], tub: [1.7, 0.75], toilet: [0.4, 0.65], sink: [0.7, 0.5],
};
const overlap = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** Gap of a partition line (centre c along it, width w) → the solid pieces as segments. */
function cut(a: [number, number], b: [number, number], gapAt: number, gw: number, alongX: boolean): Seg[] {
  const [s, e] = alongX ? [a[0], b[0]] : [a[1], b[1]], k = alongX ? a[1] : a[0];
  const g0 = gapAt - gw / 2, g1 = gapAt + gw / 2, out: Seg[] = [];
  for (const [p, q] of [[s, g0], [g1, e]]) if (q - p > 0.05) out.push(alongX ? [p, k, q, k] : [k, p, k, q]);
  return out;
}

export function planFloor(g: Grid, floor: number, L: number, W: number): FloorPlan {
  const hx = L / 2, hz = W / 2, ix = hx - WALL_T, iz = hz - WALL_T, step = L / g.nx;
  let nb = g.nx >= 3 ? 3 : g.nx, i1 = Math.max(1, Math.round(g.nx * 0.4)), i2 = Math.max(i1 + 1, Math.round(g.nx * 0.7));
  if (i2 >= g.nx) i2 = g.nx - 1;
  if (nb === 3 && i2 <= i1) nb = 2;
  const cuts = nb === 3 ? [-hx + i1 * step, -hx + i2 * step] : nb === 2 ? [-hx + Math.max(1, Math.round(g.nx / 2)) * step] : [];
  const xb = [-ix, ...cuts, ix];
  let zc = g.nz >= 2 ? -hz + Math.max(1, Math.round(g.nz * 0.45)) * (W / g.nz) : 0;
  if (zc < -iz + 1.8 || zc > iz - 1.8) zc = 0;
  const band = (k: number, kind: Kind): Room => ({ kind, x0: xb[k], x1: xb[k + 1], z0: -iz, z1: iz });
  const split = (k: number, back: Kind, front: Kind): Room[] => [{ ...band(k, back), z1: zc }, { ...band(k, front), z0: zc }];
  const rooms: Room[] = floor === 0
    ? nb === 3 ? [band(0, 'living'), band(1, 'kitchen'), ...split(2, 'bath', 'study')] : nb === 2 ? [band(0, 'living'), ...split(1, 'kitchen', 'bath')] : [band(0, 'studio')]
    : nb === 3 ? [band(0, 'bed'), band(1, 'kids'), ...split(2, 'bath', 'study')] : nb === 2 ? [band(0, 'bed'), ...split(1, 'bath', 'study')] : [band(0, 'bed')];

  const parts: Seg[] = [], reserve: Rect[] = [], gw = 0.9;
  const gz = iz - 1.0 - gw / 2 > -iz ? iz - 1.0 : 0;
  for (const x of cuts) { parts.push(...cut([x, -iz], [x, iz], gz, gw, false)); reserve.push([x - 1.0, gz - 0.6, x + 1.0, gz + 0.6]); }
  rooms.filter((r) => r.z1 === zc && zc !== iz).forEach((r) => {
    const c = (r.x0 + r.x1) / 2; parts.push(...cut([r.x0, zc], [r.x1, zc], c, gw, true)); reserve.push([c - 0.6, zc - 1.0, c + 0.6, zc + 1.0]);
  });
  if (floor === 0) reserve.push([g.doorX - 0.75, iz - 1.6, g.doorX + 0.75, iz]);

  const items: Item[] = [], rugs: FloorPlan['rugs'] = [], boxes: Rect[] = [], placed: Rect[] = [...reserve];
  const put = (r: Room, kind: string, x: number, z: number, rot: number, size = SIZE[kind]) => {
    const turned = Math.abs(Math.sin(rot)) > 0.5, fw = turned ? size[1] : size[0], fd = turned ? size[0] : size[1], m = 0.08;
    const box: Rect = [x - fw / 2, z - fd / 2, x + fw / 2, z + fd / 2];
    if (box[0] < r.x0 + m - 1e-6 || box[2] > r.x1 - m + 1e-6 || box[1] < r.z0 + m - 1e-6 || box[3] > r.z1 - m + 1e-6 || placed.some((p) => overlap(p, box))) return false;
    placed.push(box); if (kind !== 'plant') boxes.push(box); items.push({ kind, x, z, rot, size }); return true;
  };
  const P = Math.PI;
  for (const r of rooms) {
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, w = r.x1 - r.x0, dep = r.z1 - r.z0;
    if (r.kind === 'living' || r.kind === 'studio') {
      const zs = r.z0 + dep * 0.4;
      if (!put(r, 'sofa', r.x1 - 0.53, zs, -P / 2)) put(r, 'sofa', cx, r.z0 + 0.53, 0);
      put(r, 'tv', r.x0 + 0.31, zs, P / 2); put(r, 'ctable', cx + 0.1, zs, P / 2);
      rugs.push([cx + 0.1, zs, Math.min(2.4, w - 1.6), Math.min(2.2, dep - 1)]);
      put(r, 'armchair', r.x1 - 0.53, r.z0 + 0.53, -P / 2); put(r, 'shelf', cx, r.z0 + 0.26, 0);
      put(r, 'plant', r.x0 + 0.35, r.z0 + 0.35, 0); put(r, 'plant', r.x1 - 0.35, r.z1 - 0.35, 0);
      if (r.kind === 'studio') { const len = Math.min(w - 1.4, 2.4); put(r, 'counter', r.x0 + 0.1 + len / 2, r.z1 - 0.4, P, [len, 0.62]); }
    } else if (r.kind === 'kitchen') {
      const len = Math.max(1.2, Math.min(w - 1.0, 3.0));
      put(r, 'counter', r.x0 + 0.1 + len / 2, r.z0 + 0.4, 0, [len, 0.62]);
      if (!put(r, 'fridge', r.x0 + 0.1 + len + 0.45, r.z0 + 0.43, 0)) put(r, 'fridge', r.x1 - 0.45, r.z0 + 0.43, 0);
      put(r, 'dining', cx, r.z0 + dep * 0.58, 0) || put(r, 'dining', cx, r.z0 + dep * 0.58, P / 2);
      put(r, 'plant', r.x1 - 0.35, r.z1 - 0.35, 0);
    } else if (r.kind === 'bath') {
      put(r, 'tub', r.x0 + 0.95, r.z0 + 0.47, 0) || put(r, 'tub', r.x0 + 0.47, cz, P / 2);
      put(r, 'sink', r.x1 - 0.34, r.z0 + 0.5, -P / 2); put(r, 'toilet', r.x1 - 0.42, r.z0 + 1.3, -P / 2) || put(r, 'toilet', r.x1 - 0.42, r.z1 - 0.5, -P / 2);
    } else if (r.kind === 'bed' || r.kind === 'kids') {
      const k = r.kind === 'bed' && w >= 3 ? 'bedD' : 'bedS', bw = SIZE[k][0];
      put(r, k, cx, r.z0 + 1.13, 0);
      put(r, 'nstand', cx - bw / 2 - 0.3, r.z0 + 0.28, 0); put(r, 'nstand', cx + bw / 2 + 0.3, r.z0 + 0.28, 0);
      put(r, 'wardrobe', r.x0 + 0.38, r.z1 - 1.1, P / 2) || put(r, 'wardrobe', r.x1 - 0.38, r.z1 - 1.1, -P / 2) || put(r, 'wardrobe', cx, r.z1 - 0.38, P);
      rugs.push([cx, r.z0 + 2.4, Math.min(bw + 1, w - 0.6), 1.2]);
      if (r.kind === 'kids') put(r, 'desk', r.x1 - 0.73, r.z1 - 0.73, -P / 2);
      put(r, 'plant', r.x1 - 0.35, r.z0 + 0.35, 0);
    } else {
      put(r, 'desk', cx, r.z1 - 0.73, P) || put(r, 'desk', r.x1 - 0.73, cz, -P / 2);
      put(r, 'shelf', r.x0 + 0.26, cz, P / 2); put(r, 'armchair', r.x0 + 0.53, r.z0 + 0.53, P / 2); put(r, 'plant', r.x1 - 0.35, r.z0 + 0.35, 0);
    }
  }
  const segs: Seg[] = [...parts];
  const first = rooms[0];
  return { rooms, parts, items, rugs, segs, boxes, spawn: [(first.x0 + first.x1) / 2, Math.min(first.z1 - 1.2, (first.z0 + first.z1) / 2 + 1.5)] };
}

/* ---------- materials and pieces ---------- */
const PALETTE: Record<Style, { wood: [string, string]; fabric: string; accent: string; rug: string }> = {
  modern: { wood: ['oak', '#d9c4a8'], fabric: '#8f969c', accent: '#2f3236', rug: '#c9c4bb' },
  scandi: { wood: ['oak', '#ffffff'], fabric: '#e4e0d8', accent: '#7f927f', rug: '#efeae0' },
  classic: { wood: ['walnut', '#ffffff'], fabric: '#7d3a30', accent: '#b89a5e', rug: '#8a5a44' },
  loft: { wood: ['walnut', '#caa47c'], fabric: '#55575a', accent: '#1f1f1f', rug: '#6b625a' },
};
type Mats = Record<'wood' | 'fabric' | 'accent' | 'white' | 'paint' | 'tile' | 'stone' | 'black' | 'metal' | 'leaf' | 'rug' | 'water', THREE.MeshStandardMaterial>;
function mat(color: string, set?: string, rough = 0.8, metal = 0) {
  // fabrics get a soft sheen (velvet / wool fibres catching grazing light), everything else is plain PBR
  const m = set === 'fabric' ? new THREE.MeshPhysicalMaterial({ color, roughness: rough, metalness: metal, sheen: 0.6, sheenRoughness: 0.8, sheenColor: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.4) })
    : new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  if (set) { m.userData.set = set; applySet(m, { set, color }); }
  return m;
}
export function interiorMats(d: Design): Mats {
  const p = PALETTE[d.style] || PALETTE.modern;
  return {
    wood: mat(p.wood[1], p.wood[0]), fabric: mat(p.fabric, 'fabric', 0.95), accent: mat(p.accent, undefined, 0.55, d.style === 'loft' ? 0.6 : 0),
    white: mat('#f4f3ef', undefined, 0.35), paint: mat(d.paint, undefined, 0.92), tile: mat('#ffffff', d.tileMat, 0.4), stone: mat('#ffffff', 'marble', 0.25),
    black: mat('#1b1c1e', undefined, 0.3), metal: mat('#c9ccd0', 'steel', 0.35, 0.8), leaf: Object.assign(mat('#4f7d3a', undefined, 0.9), { flatShading: true }),
    rug: mat(p.rug, 'fabric', 1), water: mat('#bcd8e6', undefined, 0.1),
  };
}
/** Flat floor patch with UVs in metres (tiles, rugs). */
function patch(g: THREE.Group, m: THREE.Material, w: number, d: number, x: number, z: number, y: number) {
  const geo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
  const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o);
}
function piece(kind: string, M: Mats, size: [number, number]): THREE.Group {
  const g = new THREE.Group(), b = (m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => bx(g, m, w, h, d, x, y, z);
  switch (kind) {
    case 'sofa': case 'armchair': { const w = SIZE[kind][0]; b(M.fabric, w, 0.42, 0.9, 0, 0.21, 0); b(M.fabric, w, 0.45, 0.2, 0, 0.62, -0.35); [-1, 1].forEach((s) => b(M.fabric, 0.18, 0.62, 0.9, s * (w / 2 - 0.09), 0.31, 0)); if (w > 1) [-1, 1].forEach((s) => b(M.white, w / 2 - 0.25, 0.1, 0.62, s * (w / 4 - 0.04), 0.47, 0.08)); break; }
    case 'ctable': b(M.wood, 1.0, 0.05, 0.6, 0, 0.4, 0); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => b(M.accent, 0.05, 0.38, 0.05, sx * 0.45, 0.19, sz * 0.25)); break;
    case 'tv': b(M.wood, 1.6, 0.45, 0.4, 0, 0.225, 0); b(M.black, 1.3, 0.75, 0.05, 0, 0.9, -0.08); break;
    case 'shelf': b(M.wood, 1.0, 1.8, 0.35, 0, 0.9, 0); [0.5, 0.95, 1.4].forEach((y, i) => b(i % 2 ? M.accent : M.fabric, 0.6, 0.26, 0.24, (i - 1) * 0.1, y + 0.13, 0.06)); break;
    case 'plant': { const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.36, 12), M.white); pot.position.y = 0.18; g.add(pot);
      [[0, 0.75, 0, 0.34], [0.12, 0.98, 0.05, 0.24], [-0.1, 0.92, -0.06, 0.22]].forEach(([x, y, z, r]) => { const f = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), M.leaf); f.position.set(x, y, z); g.add(f); }); break; }
    case 'counter': { const len = size[0]; b(M.accent, len, 0.86, 0.6, 0, 0.43, 0); b(M.stone, len + 0.02, 0.04, 0.62, 0, 0.88, 0); b(M.accent, len, 0.7, 0.35, 0, 1.85, -0.13); b(M.black, 0.6, 0.01, 0.5, len / 2 - 0.5, 0.905, 0); b(M.metal, 0.5, 0.02, 0.4, -len / 2 + 0.5, 0.905, 0); break; }
    case 'fridge': b(M.metal, 0.7, 1.9, 0.68, 0, 0.95, 0); break;
    case 'dining': b(M.wood, 1.6, 0.05, 0.9, 0, 0.75, 0); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => b(M.accent, 0.06, 0.73, 0.06, sx * 0.72, 0.365, sz * 0.38));
      [-1, 1].forEach((sz) => [-0.45, 0.45].forEach((x) => { b(M.wood, 0.45, 0.05, 0.45, x, 0.45, sz * 0.72); b(M.wood, 0.45, 0.5, 0.05, x, 0.72, sz * 0.93); b(M.accent, 0.4, 0.42, 0.04, x, 0.21, sz * 0.72); })); break;
    case 'bedD': case 'bedS': { const w = SIZE[kind][0] - 0.1; b(M.wood, w, 0.3, 2.05, 0, 0.15, 0); b(M.white, w - 0.06, 0.22, 1.95, 0, 0.41, 0.03); b(M.fabric, w - 0.02, 0.07, 1.3, 0, 0.55, 0.36);
      (kind === 'bedD' ? [-1, 1] : [0]).forEach((s) => b(M.white, kind === 'bedD' ? w / 2 - 0.15 : w - 0.3, 0.13, 0.4, s * (w / 4), 0.58, -0.74)); b(M.fabric, w + 0.1, 1.1, 0.08, 0, 0.55, -1.02); break; }
    case 'nstand': b(M.wood, 0.45, 0.5, 0.4, 0, 0.25, 0); b(M.white, 0.22, 0.25, 0.22, 0, 0.65, 0); break;
    case 'wardrobe': b(M.wood, 1.6, 2.2, 0.6, 0, 1.1, 0); b(M.accent, 0.015, 2.1, 0.02, 0, 1.1, 0.305); break;
    case 'desk': b(M.wood, 1.4, 0.04, 0.7, 0, 0.74, -0.3); [-1, 1].forEach((s) => b(M.accent, 0.04, 0.72, 0.65, s * 0.66, 0.36, -0.3)); b(M.black, 0.6, 0.38, 0.03, 0, 0.98, -0.55);
      b(M.fabric, 0.5, 0.08, 0.5, 0, 0.48, 0.38); b(M.fabric, 0.5, 0.5, 0.06, 0, 0.78, 0.62); b(M.accent, 0.06, 0.44, 0.06, 0, 0.22, 0.38); break;
    case 'tub': b(M.white, 1.7, 0.55, 0.75, 0, 0.275, 0); b(M.water, 1.5, 0.02, 0.55, 0, 0.53, 0); break;
    case 'toilet': b(M.white, 0.38, 0.4, 0.5, 0, 0.2, 0.05); b(M.white, 0.38, 0.35, 0.18, 0, 0.55, -0.22); break;
    case 'sink': b(M.wood, 0.7, 0.8, 0.45, 0, 0.4, 0); b(M.white, 0.72, 0.05, 0.47, 0, 0.825, 0); b(M.metal, 0.6, 0.8, 0.02, 0, 1.55, -0.23); break;
  }
  return g;
}

/** Merges the storey's meshes per material (one draw call per material instead of hundreds).
 *  Pieces tagged for a GLB model stay separate, so they can be swapped later (furnish.ts). */
function mergeByMaterial(g: THREE.Group) {
  const keep = g.children.filter((c) => c.userData.slot);
  keep.forEach((c) => g.remove(c));
  g.updateMatrixWorld(true);
  const by = new Map<THREE.Material, THREE.BufferGeometry[]>(), inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  g.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    const geo = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    const list = by.get(m.material as THREE.Material) || []; list.push(geo); by.set(m.material as THREE.Material, list); m.geometry.dispose();
  });
  g.clear();
  by.forEach((list, m) => { const merged = mergeGeometries(list); list.forEach((x) => x.dispose()); if (merged) g.add(new THREE.Mesh(merged, m)); });
  keep.forEach((c) => g.add(c));
}

/** Builds the storey's interior at floor level y (top of the slab). */
export function buildInterior(g: THREE.Group, plan: FloorPlan, M: Mats, y: number, h: number, style: Style = 'modern') {
  const seen: Record<string, number> = {};
  const tag = (o: THREE.Object3D, kind: string, size: [number, number]) => { const n = seen[kind] ?? 0; seen[kind] = n + 1; const s = slotFor(style, kind, n, size); if (s) o.userData.slot = s; };
  for (const [x1, z1, x2, z2] of plan.parts) {
    const along = z1 === z2, len = along ? x2 - x1 : z2 - z1;
    if (along) bx(g, M.paint, len, h, 0.12, (x1 + x2) / 2, y + h / 2, z1); else bx(g, M.paint, 0.12, h, len, x1, y + h / 2, (z1 + z2) / 2);
  }
  for (const r of plan.rooms) if (r.kind === 'bath' || r.kind === 'kitchen') patch(g, M.tile, r.x1 - r.x0, r.z1 - r.z0, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, y + 0.004);
  for (const [x, z, w, d] of plan.rugs) if (w > 0.6 && d > 0.6) patch(g, M.rug, w, d, x, z, y + 0.008);
  for (const it of plan.items) { const p = piece(it.kind, M, it.size); p.position.set(it.x, y, it.z); p.rotation.y = it.rot; tag(p, it.kind, it.size); g.add(p); }
  // ceiling lamps: empty slots under the ceiling of every room but the bathroom, filled with the style's fixture
  for (const r of plan.rooms) if (r.kind !== 'bath') { const l = new THREE.Group(); l.position.set((r.x0 + r.x1) / 2, y + h - 0.01, (r.z0 + r.z1) / 2); tag(l, 'lamp', [0.9, 0.9]); if (l.userData.slot) g.add(l); }
  mergeByMaterial(g);
}
