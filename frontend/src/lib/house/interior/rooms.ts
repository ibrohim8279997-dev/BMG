import * as THREE from 'three';
import type { Design } from '../design';
import { Kit, mesh } from '../kit';
import { boxM } from '../textures';
import { DOOR_H, FloorPlan, Rect, Room, RoomSide, Stair, TI, roomGaps } from './plan';

/** Finished interior shell of one storey: floor finishes, ceilings, partitions with doors, skirting boards, tiles, switches, sockets, stairs.
 *  Coordinates are the storey's local frame (y = 0 at the slab bottom, finished floor at FLOOR_Y). */
export const FLOOR_Y = 0.2;
export type Seg = { ax: number; az: number; bx: number; bz: number; r: number };
export type Shell = { group: THREE.Group; segs: Seg[]; lights: THREE.Vector3[] };
export type InteriorMats = { floor: THREE.Material; tile: THREE.Material; wet: THREE.Material; wood: THREE.Material; skirting: THREE.Material; leaf: THREE.Material; plastic: THREE.Material };

/** Horizontal plate over a rect, with optional rect holes; UVs in world metres so patterns run on across rooms. */
function plate(r: Rect, holes: Rect[], y: number, down = false) {
  const s = new THREE.Shape([new THREE.Vector2(r.x0, r.z0), new THREE.Vector2(r.x1, r.z0), new THREE.Vector2(r.x1, r.z1), new THREE.Vector2(r.x0, r.z1)]);
  for (const h of holes) {
    const a = { x0: Math.max(r.x0, h.x0), z0: Math.max(r.z0, h.z0), x1: Math.min(r.x1, h.x1), z1: Math.min(r.z1, h.z1) };
    if (a.x1 - a.x0 < 0.02 || a.z1 - a.z0 < 0.02) continue;
    s.holes.push(new THREE.Path([new THREE.Vector2(a.x0, a.z0), new THREE.Vector2(a.x0, a.z1), new THREE.Vector2(a.x1, a.z1), new THREE.Vector2(a.x1, a.z0)]));
  }
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(Math.PI / 2);                       // shape y → world z (normal now points down)
  if (!down) flip(g);
  g.translate(0, y, 0);
  return g;
}
function flip(g: THREE.BufferGeometry) {
  const idx = g.getIndex(); if (idx) { const a = idx.array as Uint16Array | Uint32Array; for (let i = 0; i < a.length; i += 3) { const t = a[i]; a[i] = a[i + 2]; a[i + 2] = t; } }
  const n = g.getAttribute('normal') as THREE.BufferAttribute; for (let i = 0; i < n.count; i++) n.setY(i, -n.getY(i));
}

/** Vertical panel in a side's frame: u along the side, v up, with rect cut-outs (windows, doors). */
function panel(len: number, h: number, cuts: { a: number; b: number; y0: number; y1: number }[]) {
  const s = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(len, 0), new THREE.Vector2(len, h), new THREE.Vector2(0, h)]);
  for (const c of cuts) {
    const a = Math.max(0.01, c.a), b = Math.min(len - 0.01, c.b), y0 = Math.max(0.01, c.y0), y1 = Math.min(h - 0.01, c.y1);
    if (b - a < 0.05 || y1 - y0 < 0.05) continue;
    s.holes.push(new THREE.Path([new THREE.Vector2(a, y0), new THREE.Vector2(a, y1), new THREE.Vector2(b, y1), new THREE.Vector2(b, y0)]));
  }
  return new THREE.ShapeGeometry(s);
}

/** Places a side-frame object onto one side of a room, facing into the room. off = distance from the wall surface. */
export function onSide(o: THREE.Object3D, room: Rect, side: RoomSide, off: number) {
  switch (side) {
    case 'back': o.position.set(room.x0, 0, room.z0 + off); break;
    case 'front': o.position.set(room.x1, 0, room.z1 - off); o.rotation.y = Math.PI; break;
    case 'left': o.position.set(room.x0 + off, 0, room.z1); o.rotation.y = Math.PI / 2; break;
    case 'right': o.position.set(room.x1 - off, 0, room.z0); o.rotation.y = -Math.PI / 2; break;
  }
  return o;
}
/** Converts a gap measured in plan coordinates to the side frame's u (onSide runs front/left in reverse). */
export const toU = (room: Rect, side: RoomSide, a: number, b: number): [number, number] =>
  side === 'back' ? [a - room.x0, b - room.x0] : side === 'front' ? [room.x1 - b, room.x1 - a] : side === 'left' ? [room.z1 - b, room.z1 - a] : [a - room.z0, b - room.z0];
export const sideLen = (r: Rect, s: RoomSide) => (s === 'back' || s === 'front' ? r.x1 - r.x0 : r.z1 - r.z0);

/** Room rect shrunk to the wall surfaces (partitions are TI thick; the outer shell rect is already the inner face). */
export function clear(room: Room, plan: FloorPlan): Rect {
  const I = plan.inner, e = 0.01, t = TI / 2;
  return { x0: room.x0 + (Math.abs(room.x0 - I.x0) < e ? 0 : t), x1: room.x1 - (Math.abs(room.x1 - I.x1) < e ? 0 : t),
    z0: room.z0 + (Math.abs(room.z0 - I.z0) < e ? 0 : t), z1: room.z1 - (Math.abs(room.z1 - I.z1) < e ? 0 : t) };
}

export function buildShell(kit: Kit, d: Design, plan: FloorPlan, m: InteriorMats): Shell {
  const g = new THREE.Group(), h = d.floorHeight, segs: Seg[] = [], lights: THREE.Vector3[] = [], H = h - FLOOR_Y;
  const add = (o: THREE.Object3D) => { g.add(o); return o; };
  const I = plan.inner;
  // outer shell as collision, with the front door gap on the ground floor
  const outer: Seg[] = [
    { ax: I.x0, az: I.z0, bx: I.x1, bz: I.z0, r: 0.05 }, { ax: I.x0, az: I.z0, bx: I.x0, bz: I.z1, r: 0.05 }, { ax: I.x1, az: I.z0, bx: I.x1, bz: I.z1, r: 0.05 },
  ];
  if (plan.floor === 0) outer.push({ ax: I.x0, az: I.z1, bx: -0.55, bz: I.z1, r: 0.05 }, { ax: 0.55, az: I.z1, bx: I.x1, bz: I.z1, r: 0.05 });
  else outer.push({ ax: I.x0, az: I.z1, bx: I.x1, bz: I.z1, r: 0.05 });
  segs.push(...outer);

  for (const room of plan.rooms) {
    const c = clear(room, plan), gaps = roomGaps(room, plan, d);
    const wet = room.kind === 'bath', finish = wet ? m.wet : room.kind === 'kitchen' && d.style !== 'scandi' ? m.wet : m.floor;
    const hole = plan.hole ? [plan.hole] : [];
    add(mesh(plate(c, hole, FLOOR_Y + 0.004), finish, undefined, false));
    const ceil = mesh(plate(c, plan.up ? [plan.up] : [], h - 0.004, true), kit.ceil, undefined, false); ceil.castShadow = false; add(ceil);
    lights.push(new THREE.Vector3((c.x0 + c.x1) / 2, h - 0.02, (c.z0 + c.z1) / 2));
    for (const side of ['back', 'front', 'left', 'right'] as RoomSide[]) {
      const len = sideLen(c, side), cuts = gaps[side].map((gp) => { const [a, b] = toU(c, side, gp.a, gp.b); return { a, b, y0: gp.y0 - FLOOR_Y + 0.2, y1: gp.y1 - FLOOR_Y + 0.2 }; });
      if (wet) {   // full-height wall tiles
        const p = mesh(panel(len, H, cuts.map((k) => ({ ...k, y0: Math.max(0, k.y0 - 0.2), y1: k.y1 - 0.2 }))), m.tile, undefined, false);
        const o = onSide(new THREE.Group(), c, side, 0.006); p.position.y = FLOOR_Y; o.add(p); add(o);
      }
      // skirting boards between door gaps
      const doorCuts = cuts.filter((k) => k.y0 <= 0.25).sort((u, v) => u.a - v.a);
      let u = 0;
      for (const k of [...doorCuts, { a: len, b: len, y0: 0, y1: 0 }]) {
        if (k.a - u > 0.05 && !wet) { const s = mesh(boxM(k.a - u, 0.07, 0.014), m.skirting, undefined, false); s.position.set(u + (k.a - u) / 2, FLOOR_Y + 0.035, 0.007); add(onSide(new THREE.Group(), c, side, 0)).add(s); }
        u = Math.max(u, k.b);
      }
      // a socket in the middle of the longest solid stretch, a switch beside the first door
      if (side === 'back' || side === 'right') {
        const sock = mesh(boxM(0.08, 0.08, 0.012), m.plastic, undefined, false); sock.position.set(len * 0.5 + (cuts.some((k) => Math.abs(k.a + (k.b - k.a) / 2 - len / 2) < 0.6) ? 0.9 : 0), FLOOR_Y + 0.3, 0.006);
        if (sock.position.x < len - 0.1) add(onSide(new THREE.Group(), c, side, 0)).add(sock);
      }
      const dc = doorCuts[0];
      if (dc && room.kind !== 'hall') {
        const sw = mesh(boxM(0.08, 0.08, 0.012), m.plastic, undefined, false); const x = dc.b + 0.18 < len ? dc.b + 0.18 : dc.a - 0.18;
        sw.position.set(x, FLOOR_Y + 0.9, 0.006); add(onSide(new THREE.Group(), c, side, 0)).add(sw);
      }
    }
  }

  // partitions: wall pieces between openings, lintels above, door leaves standing open, casings
  for (const w of plan.walls) {
    const vertical = Math.abs(w.ax - w.bx) < 1e-6, len = vertical ? w.bz - w.az : w.bx - w.ax;
    const piece = (a: number, b: number, y0: number, y1: number) => {
      if (b - a < 0.01) return;
      const p = mesh(boxM(vertical ? TI : b - a, y1 - y0, vertical ? b - a : TI), kit.paint);
      p.position.set(vertical ? w.ax : w.ax + (a + b) / 2, y0 + (y1 - y0) / 2, vertical ? w.az + (a + b) / 2 : w.az); add(p);
    };
    const ds = [...w.doors].sort((u, v) => u.at - v.at);
    let cur = 0;
    for (const o of ds) {
      const a = o.at - o.w / 2, b = o.at + o.w / 2;
      piece(cur, a, FLOOR_Y, h); piece(a, b, FLOOR_Y + o.h, h);
      const seg = (s0: number, s1: number) => segs.push(vertical ? { ax: w.ax, az: w.az + s0, bx: w.ax, bz: w.az + s1, r: TI / 2 } : { ax: w.ax + s0, az: w.az, bx: w.ax + s1, bz: w.az, r: TI / 2 });
      seg(cur, a);
      if (!o.wide) {
        for (const [cw, ch, cu, cy] of [[0.07, o.h, a - 0.035, o.h / 2], [0.07, o.h, b + 0.035, o.h / 2], [o.w + 0.14, 0.07, (a + b) / 2, o.h + 0.035]]) {
          const cas = mesh(boxM(vertical ? TI + 0.03 : cw, ch, vertical ? cw : TI + 0.03), m.skirting);
          cas.position.set(vertical ? w.ax : w.ax + cu, FLOOR_Y + cy, vertical ? w.az + cu : w.az); add(cas);
        }
        const leaf = mesh(boxM(o.w - 0.04, o.h - 0.02, 0.04), m.leaf), hinge = new THREE.Group();
        leaf.position.set((o.w - 0.04) / 2, (o.h - 0.02) / 2, 0); hinge.add(leaf);
        const knob = mesh(new THREE.SphereGeometry(0.03, 12, 8), kit.sill); knob.position.set(o.w - 0.12, 1.0 - FLOOR_Y + 0.05, 0.04); hinge.add(knob);
        hinge.position.set(vertical ? w.ax : w.ax + a, FLOOR_Y + 0.01, vertical ? w.az + a : w.az);
        hinge.rotation.y = vertical ? -Math.PI / 2 + 1.35 : 1.35;   // standing open ~77°
        add(hinge);
      }
      cur = b;
    }
    piece(cur, len, FLOOR_Y, h);
    segs.push(vertical ? { ax: w.ax, az: w.az + cur, bx: w.ax, bz: w.bz, r: TI / 2 } : { ax: w.ax + cur, az: w.az, bx: w.bx, bz: w.az, r: TI / 2 });
  }

  if (plan.up) addStair(g, plan.up, d, m, segs);
  if (plan.hole) addRail(g, plan.hole, m, segs, true);
  return { group: g, segs, lights };
}

/** Straight flight with closed risers, a side stringer and a handrail on the open side. */
function addStair(g: THREE.Group, s: Stair, d: Design, m: InteriorMats, segs: Seg[]) {
  const h = d.floorHeight, rise = h / s.steps, run = (s.zb - s.zt) / s.steps, w = s.x1 - s.x0, cx = (s.x0 + s.x1) / 2;
  for (let i = 0; i < s.steps; i++) {
    const top = FLOOR_Y + rise * (i + 1), z = s.zb - run * (i + 0.5);
    const tread = mesh(boxM(w, 0.04, run + 0.03), m.wood); tread.position.set(cx, top - 0.02, z); g.add(tread);
    const riser = mesh(boxM(w, rise - 0.04, 0.02), m.skirting); riser.position.set(cx, top - 0.04 - (rise - 0.04) / 2, s.zb - run * i - 0.01); g.add(riser);
  }
  const len = Math.hypot(s.zb - s.zt, h), ang = Math.atan2(h, s.zb - s.zt);
  const open = s.x0 < 0 ? s.x1 : s.x0;   // the side facing the corridor
  const str = mesh(boxM(0.05, 0.3, len), m.skirting); str.position.set(open, FLOOR_Y + h / 2 - 0.12, (s.zb + s.zt) / 2); str.rotation.x = ang; g.add(str);
  addRail(g, s, m, segs, false, h);
  // you can't walk under the high end of the flight
  segs.push({ ax: open, az: s.zt, bx: open, bz: s.zb - 1.0, r: 0.04 });
}

/** Handrail along the open side: sloped with balusters on the flight, level around the stairwell upstairs. */
function addRail(g: THREE.Group, s: Stair, m: InteriorMats, segs: Seg[], level: boolean, h = 0) {
  const open = s.x0 < 0 ? s.x1 : s.x0, H = 0.95, span = s.zb - s.zt;
  if (level) {
    const z0 = s.zt + 0.95;   // the top end stays open: that's where you step on
    const rail = mesh(boxM(0.05, 0.05, s.zb - z0), m.wood); rail.position.set(open, FLOOR_Y + H, (s.zb + z0) / 2); g.add(rail);
    const front = mesh(boxM(s.x1 - s.x0, 0.05, 0.05), m.wood); front.position.set((s.x0 + s.x1) / 2, FLOOR_Y + H, s.zb); g.add(front);
    for (let z = z0; z <= s.zb + 1e-6; z += 0.12) { const b = mesh(boxM(0.02, H, 0.02), m.skirting, undefined, false); b.position.set(open, FLOOR_Y + H / 2, z); g.add(b); }
    segs.push({ ax: open, az: z0, bx: open, bz: s.zb, r: 0.05 }, { ax: s.x0, az: s.zb, bx: s.x1, bz: s.zb, r: 0.05 });
    return;
  }
  const n = Math.max(2, Math.round(span / 0.13));
  for (let i = 0; i <= n; i++) {
    const t = i / n, b = mesh(boxM(0.02, H, 0.02), m.skirting, undefined, false);
    b.position.set(open, FLOOR_Y + t * h + H / 2, s.zb - span * t); g.add(b);
  }
  const len = Math.hypot(span, h), rail = mesh(boxM(0.05, 0.05, len), m.wood);
  rail.position.set(open, FLOOR_Y + h / 2 + H, (s.zb + s.zt) / 2); rail.rotation.x = Math.atan2(h, span); g.add(rail);
}
