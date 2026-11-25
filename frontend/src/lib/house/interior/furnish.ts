import * as THREE from 'three';
import type { Design } from '../design';
import { fitModel, loadModel } from '../gltf';
import * as P from './parametric';
import { FloorPlan, Gap, Rect, Room, RoomSide, roomGaps } from './plan';
import { FLOOR_Y, clear, onSide, sideLen, toU } from './rooms';
import { Model, STYLE_DEFS, StyleDef, StyleMats } from './styles';

/** Places furniture room by room. Every piece claims a footprint; later pieces try other spots so nothing overlaps
 *  doors (a 0.9 m swing zone is kept clear), windows (tall pieces avoid them) or each other. */
export type Furnished = { group: THREE.Group; boxes: Rect[]; lamps: THREE.Vector3[] };
const SIDES: RoomSide[] = ['back', 'right', 'front', 'left'];
const opposite: Record<RoomSide, RoomSide> = { back: 'front', front: 'back', left: 'right', right: 'left' };

/** A GLB that pops in when loaded; until then the slot is empty. */
function slot(m: Model, alive: () => boolean) {
  const g = new THREE.Group();
  loadModel(`/models/furniture/${m.id}.glb`).then((o) => {
    if (!alive()) return;
    o.traverse((c) => { c.userData.shared = true; });
    g.add(fitModel(o, { w: m.w, h: m.h, d: m.d }));
  }).catch(() => { /* model missing: the room just has one piece less */ });
  return g;
}

const hit = (a: Rect, b: Rect) => a.x0 < b.x1 - 0.01 && a.x1 > b.x0 + 0.01 && a.z0 < b.z1 - 0.01 && a.z1 > b.z0 + 0.01;

class Room_ {
  taken: Rect[] = [];
  constructor(public c: Rect, public gaps: Record<RoomSide, Gap[]>, public out: THREE.Group) {
    for (const s of SIDES) for (const g of gaps[s]) if (g.door) this.taken.push(this.foot(s, ((): number => { const [a, b] = toU(c, s, g.a, g.b); return (a + b) / 2; })(), g.b - g.a + 0.1, 0.9));
  }
  len(s: RoomSide) { return sideLen(this.c, s); }
  depth(s: RoomSide) { return s === 'back' || s === 'front' ? this.c.z1 - this.c.z0 : this.c.x1 - this.c.x0; }
  /** Footprint in plan coords of a piece w wide, d deep, centred at u along side s, back against the wall (+ off). */
  foot(s: RoomSide, u: number, w: number, d: number, off = 0): Rect {
    const c = this.c, a = u - w / 2, b = u + w / 2;
    switch (s) {
      case 'back': return { x0: c.x0 + a, x1: c.x0 + b, z0: c.z0 + off, z1: c.z0 + off + d };
      case 'front': return { x0: c.x1 - b, x1: c.x1 - a, z0: c.z1 - off - d, z1: c.z1 - off };
      case 'left': return { x0: c.x0 + off, x1: c.x0 + off + d, z0: c.z1 - b, z1: c.z1 - a };
      default: return { x0: c.x1 - off - d, x1: c.x1 - off, z0: c.z0 + a, z1: c.z0 + b };
    }
  }
  /** Stretches of side s where something of height ih can stand (doors always block, windows only if ih reaches the sill). */
  free(s: RoomSide, ih: number): [number, number][] {
    const L = this.len(s), cuts = this.gaps[s].filter((g) => g.door || FLOOR_Y + ih > g.y0 - 0.02).map((g) => toU(this.c, s, g.a, g.b)).sort((p, q) => p[0] - q[0]);
    const out: [number, number][] = []; let cur = 0.02;
    for (const [a, b] of [...cuts, [L - 0.02, L] as [number, number]]) { if (a - cur > 0.05) out.push([cur, a]); cur = Math.max(cur, b); }
    return out;
  }
  /** First spot on side s (middle of the longest free stretch first) where w × d fits without overlaps. */
  find(s: RoomSide, w: number, d: number, ih: number, off = 0, prefer?: number): number | null {
    if (d + off > this.depth(s) - 0.3) return null;
    const cands: number[] = [];
    for (const [a, b] of this.free(s, ih).sort((p, q) => q[1] - q[0] - (p[1] - p[0]))) {
      if (b - a < w) continue;
      const mid = prefer !== undefined ? Math.min(b - w / 2, Math.max(a + w / 2, prefer)) : (a + b) / 2;
      cands.push(mid);
      for (let k = 0.2; k < (b - a) / 2; k += 0.2) cands.push(Math.min(b - w / 2, mid + k), Math.max(a + w / 2, mid - k));
    }
    for (const u of cands) if (!this.taken.some((t) => hit(t, this.foot(s, u, w, d, off)))) return u;
    return null;
  }
  put(o: THREE.Object3D, s: RoomSide, u: number, w: number, d: number, off = 0, block = true) {
    const wrap = onSide(new THREE.Group(), this.c, s, 0); o.position.set(u, FLOOR_Y, off); wrap.add(o); this.out.add(wrap);
    if (block) this.taken.push(this.foot(s, u, w, d, off));
    return wrap;
  }
  /** Free-standing piece at plan point (x, z) facing `rotY`. */
  at(o: THREE.Object3D, x: number, z: number, rotY: number, w: number, d: number, block = true) {
    o.position.set(x, FLOOR_Y, z); o.rotation.y = rotY; this.out.add(o);
    const sw = Math.abs(Math.sin(rotY)) > 0.5;
    if (block) this.taken.push({ x0: x - (sw ? d : w) / 2, x1: x + (sw ? d : w) / 2, z0: z - (sw ? w : d) / 2, z1: z + (sw ? w : d) / 2 });
  }
  fits(r: Rect) { return r.x0 > this.c.x0 + 0.05 && r.x1 < this.c.x1 - 0.05 && r.z0 > this.c.z0 + 0.05 && r.z1 < this.c.z1 - 0.05 && !this.taken.some((t) => hit(t, r)); }
  corner(o: THREE.Object3D, size: number) {
    const c = this.c, k = size / 2 + 0.12;
    for (const [x, z] of [[c.x0 + k, c.z0 + k], [c.x1 - k, c.z0 + k], [c.x0 + k, c.z1 - k], [c.x1 - k, c.z1 - k]]) {
      const r = { x0: x - size / 2, x1: x + size / 2, z0: z - size / 2, z1: z + size / 2 };
      if (!this.taken.some((t) => hit(t, r))) { this.at(o, x, z, 0, size, size); return true; }
    }
    return false;
  }
}

/** Rotation that turns a side-frame object (+z into the room) to face plan direction from (x, z) toward (tx, tz). */
const face = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);

function living(R: Room_, s: StyleDef, m: StyleMats, alive: () => boolean) {
  const tvSide = [...SIDES].sort((a, b) => Math.max(0, ...R.free(b, 1.9).map(([p, q]) => q - p)) - Math.max(0, ...R.free(a, 1.9).map(([p, q]) => q - p)))[0];
  const tvW = 1.8, tu = R.find(tvSide, tvW, 0.45, 1.9);
  if (tu !== null) {
    if (s.tvUnit) { R.put(slot(s.tvUnit, alive), tvSide, tu, tvW, 0.45); const tv = P.tvWall(tvW, m); tv.children[1].visible = false; R.put(tv, tvSide, tu, tvW, 0.1, 0, false); }
    else R.put(P.tvWall(tvW, m), tvSide, tu, tvW, 0.45);
  }
  const sofaW = Math.min(2.4, R.len(tvSide) - 1.2), dep = R.depth(tvSide), sd = opposite[tvSide];
  if (sofaW < 1.4) return;
  const sofaObj = s.sofa ? slot({ ...s.sofa, w: Math.min(s.sofa.w ?? sofaW, sofaW) }, alive) : P.sofa(sofaW, m);
  const across = tu !== null ? R.len(sd) - tu : R.len(sd) / 2;
  let sofaDist: number;   // sofa front edge distance from the TV wall
  const su = dep <= 4.6 ? R.find(sd, sofaW, 0.95, 0.9, 0, across) : null;
  if (su !== null) { R.put(sofaObj, sd, su, sofaW, 0.95); sofaDist = dep - 0.95; }
  else {   // free-standing, 3 m from the screen
    sofaDist = Math.min(3.2, dep - 1.2);
    const tmp = new THREE.Group(); R.put(tmp, tvSide, tu ?? R.len(tvSide) / 2, sofaW, 0.95, sofaDist, true);
    sofaObj.rotation.y = Math.PI; sofaObj.position.set(0, 0, 0.95); tmp.add(sofaObj);
  }
  const mid = tu ?? R.len(tvSide) / 2, gap = (sofaDist + 0.45) / 2;
  R.put(P.rug(Math.min(2.6, sofaW + 0.6), Math.max(1.4, sofaDist - 0.9), m), tvSide, mid, 0.1, 0.1, 0.8, false);
  const coffee = slot(s.coffee, alive); R.put(coffee, tvSide, mid, 1.0, 0.6, gap + 0.2);
  const armW = 0.85, au = mid + sofaW / 2 + 0.55;
  if (au + armW / 2 < R.len(tvSide) - 0.1) { const arm = slot({ ...s.armchair }, alive); arm.rotation.y = -Math.PI / 2 + 0.35; R.put(arm, tvSide, au, armW, armW, gap); }
  const pic = slot(s.picture, alive); pic.position.y = 1.15;
  if (su !== null) R.put(pic, sd, su, 0.8, 0.05, 0, false);
  if (s.shelf) { for (const side of [SIDES[(SIDES.indexOf(tvSide) + 1) % 4], SIDES[(SIDES.indexOf(tvSide) + 3) % 4]]) { const u = R.find(side, 1.2, 0.4, 1.9); if (u !== null) { R.put(slot(s.shelf, alive), side, u, 1.2, 0.4); break; } } }
  R.corner(slot(s.plants[0], alive), 0.55);
}

function kitchen(R: Room_, s: StyleDef, m: StyleMats, tile: THREE.Material, alive: () => boolean, dining: boolean) {
  // the longest wall that a 0.9 m high counter can run along (under windows is fine)
  const best = [...SIDES].map((side) => ({ side, seg: R.free(side, 0.88).sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0] })).filter((x) => x.seg).sort((a, b) => b.seg[1] - b.seg[0] - (a.seg[1] - a.seg[0]))[0];
  if (best && best.seg[1] - best.seg[0] >= 1.6) {
    const [a, b] = best.seg, len = Math.min(b - a - 0.05, 4.2), u = (a + b) / 2;
    const upper = R.free(best.side, 2.3).map(([p, q]) => [Math.max(p, u - len / 2) - u, Math.min(q, u + len / 2) - u] as [number, number]).filter(([p, q]) => q - p > 0.3);
    const fridge = len > 2.4;
    const base = fridge ? len - 0.62 : len, bx = fridge ? -len / 2 + base / 2 : 0;
    R.put(P.kitchenRun(len, m, { sink: bx - base / 4, hob: base > 1.8 ? bx + base / 4 : null, upper: fridge ? upper.map(([p, q]) => [p, Math.min(q, len / 2 - 0.65)] as [number, number]) : upper, fridge, tile }), best.side, u, len, 0.62);
  }
  if (!dining) return;
  const c = R.c, cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2;
  for (const [tw, tl] of [[1.6, 0.9], [1.2, 0.8]]) {
    const foot = { x0: cx - tw / 2 - 0.55, x1: cx + tw / 2 + 0.55, z0: cz - tl / 2 - 0.55, z1: cz + tl / 2 + 0.55 };
    if (!R.fits(foot)) continue;
    const table = s.diningTable ? slot({ ...s.diningTable, w: Math.min(s.diningTable.w ?? tw, tw) }, alive) : P.diningTable(tw, tl, m);
    R.at(table, cx, cz, 0, tw, tl);
    const chairs: [number, number][] = [[-tw / 4, -tl / 2 - 0.3], [tw / 4, -tl / 2 - 0.3], [-tw / 4, tl / 2 + 0.3], [tw / 4, tl / 2 + 0.3]];
    for (const [dx, dz] of chairs) R.at(slot(s.diningChair, alive), cx + dx, cz + dz, face(cx + dx, cz + dz, cx + dx, cz), 0.45, 0.45, false);
    R.at(new THREE.Group(), cx, cz, 0, tw + 1.0, tl + 1.0);
    const plant = slot(s.plants[2], alive); plant.position.set(cx, FLOOR_Y + 0.76, cz); R.out.add(plant);
    return;
  }
}

function bedroom(R: Room_, s: StyleDef, m: StyleMats, alive: () => boolean, main: boolean) {
  const minDim = Math.min(R.c.x1 - R.c.x0, R.c.z1 - R.c.z0), bw = main && minDim >= 3 ? 1.6 : minDim >= 2.6 ? 1.2 : 0.9, bl = 2.05;
  let placed: { side: RoomSide; u: number } | null = null;
  for (const side of [...SIDES].sort((a, b) => R.len(b) - R.len(a))) {
    const u = R.find(side, bw + (bw > 1 ? 1.0 : 0.5), bl, 1.1); if (u === null) continue;
    R.put(P.bed(bw, bl, m), side, u, bw + 0.15, bl); placed = { side, u }; break;
  }
  if (placed) {
    const { side, u } = placed;
    R.put(P.rug(bw + 1.0, 1.6, m), side, u, 0.1, 0.1, 0.9, false);
    for (const k of bw > 1 ? [-1, 1] : [1]) {
      const n = s.nightstand ? slot(s.nightstand, alive) : P.console_(0.45, m);
      if (!s.nightstand) n.children[2].visible = false;
      R.put(n, side, u + k * (bw / 2 + 0.33), 0.45, 0.4, 0, false);
    }
    const pic = slot(s.picture, alive); pic.position.y = 1.35; R.put(pic, side, u, 0.8, 0.05, 0, false);
  }
  const ww = Math.min(2.0, Math.max(1.0, minDim - 1.2));
  for (const side of SIDES) { if (placed && side === placed.side) continue; const u = R.find(side, ww, 0.62, 2.3); if (u !== null) { R.put(P.wardrobe(ww, m), side, u, ww, 0.62); break; } }
  R.corner(slot(s.plants[1], alive), 0.5);
}

function bath(R: Room_, s: StyleDef, m: StyleMats) {
  let tub = false;
  for (const side of [...SIDES].sort((a, b) => R.depth(a) - R.depth(b))) { const u = R.find(side, 1.72, 0.78, 0.6); if (u !== null && R.len(side) >= 1.7) { R.put(P.bathtub(m), side, u, 1.72, 0.78); tub = true; break; } }
  if (!tub) for (const side of SIDES) { const u = R.find(side, 0.9, 0.9, 2.1); if (u !== null) { R.put(P.shower(m), side, u, 0.9, 0.9); break; } }
  for (const side of SIDES) { const u = R.find(side, 0.9, 0.5, 1.9); if (u !== null) { R.put(P.vanity(0.8, m), side, u, 0.9, 0.5); break; } }
  for (const side of SIDES) { const u = R.find(side, 0.5, 0.7, 0.8); if (u !== null) { R.put(P.toilet(m), side, u, 0.5, 0.7); break; } }
  void s;
}

function hall(R: Room_, s: StyleDef, m: StyleMats, alive: () => boolean, ground: boolean) {
  if (!ground) return;
  for (const side of ['left', 'right'] as RoomSide[]) {
    const u = R.find(side, 1.0, 0.36, 1.8, 0, R.len(side) - 1.2);
    if (u !== null) { if (s.mirror) { R.put(P.console_(1.0, m), side, u, 1.0, 0.36).children[0].children[2].visible = false; const mi = slot(s.mirror, alive); mi.position.y = 1.0; R.put(mi, side, u, 0.6, 0.04, 0, false); } else R.put(P.console_(1.0, m), side, u, 1.0, 0.36); break; }
  }
}

export function furnish(d: Design, plan: FloorPlan, m: StyleMats, alive: () => boolean): Furnished {
  const group = new THREE.Group(), s = STYLE_DEFS[d.style], boxes: Rect[] = [], lamps: THREE.Vector3[] = [];
  const kitchenRoom = plan.rooms.find((r) => r.kind === 'kitchen');
  const kitchenDining = !!kitchenRoom && (kitchenRoom.x1 - kitchenRoom.x0) * (kitchenRoom.z1 - kitchenRoom.z0) >= 12;
  let firstBed = true;
  for (const room of plan.rooms) {
    const c = clear(room, plan), R = new Room_(c, roomGaps(room, plan, d), group);
    for (const st of [plan.up, plan.hole]) if (st) R.taken.push({ x0: st.x0 - 0.05, x1: st.x1 + 0.05, z0: st.z0 - 0.9, z1: st.z1 + 1.0 });
    const reserved = R.taken.length;   // door swings and stairwells: kept clear, but not obstacles to walk into
    switch (room.kind) {
      case 'living': living(R, s, m, alive); if (!kitchenDining && !kitchenRoom) kitchen(R, s, m, m.tile, alive, true); break;
      case 'kitchen': kitchen(R, s, m, m.tile, alive, kitchenDining); break;
      case 'bedroom': bedroom(R, s, m, alive, firstBed); firstBed = false; break;
      case 'bath': bath(R, s, m); break;
      case 'hall': hall(R, s, m, alive, plan.floor === 0); break;
    }
    if (room.kind !== 'bath' && room.kind !== 'hall') {
      const model = room.kind === 'living' || room.kind === 'bedroom', cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2;
      const lamp = model ? slot(s.lamp, alive) : P.pendant(m);   // models stand on y = 0, the pendant hangs from it
      lamp.position.set(cx, d.floorHeight - (model ? (s.lamp.h ?? 0.5) + 0.01 : 0), cz); group.add(lamp);
    }
    lamps.push(new THREE.Vector3((c.x0 + c.x1) / 2, d.floorHeight - 0.5, (c.z0 + c.z1) / 2));
    boxes.push(...R.taken.slice(reserved));
  }
  return { group, boxes, lamps };
}

export type { Room };
