// Floor-plan generator: rooms, partitions, doors and stairs derived from the design's size and floor count.
// Pure data, no three.js, so node tests can import it directly (tests/plan.test.mjs).
import type { Design } from '../design';
import { facadeSpans, T, type Side, type Span } from '../openings.ts';

export const TI = 0.12;          // interior partition thickness (m)
export const DOOR_H = 2.05;

export type RoomKind = 'living' | 'kitchen' | 'bedroom' | 'bath' | 'hall';
export type Rect = { x0: number; z0: number; x1: number; z1: number };
export type Room = Rect & { id: string; kind: RoomKind; floor: number };
/** Axis-aligned partition from a to b (plan metres). Openings are measured along it from a. */
export type Opening = { at: number; w: number; h: number; wide?: boolean };
export type IWall = { ax: number; az: number; bx: number; bz: number; doors: Opening[] };
/** A straight flight rising toward -z: bottom step at z = zb, top at z = zt, from storey `floor` to floor + 1. */
export type Stair = Rect & { floor: number; zb: number; zt: number; steps: number };
export type FloorPlan = { floor: number; rooms: Room[]; walls: IWall[]; up?: Stair; hole?: Stair; inner: Rect };

const near = (spans: Span[], c: number, pad: number) => spans.some((s) => c > s.a - pad && c < s.b + pad);

/** Moves a partition line off any window/door it would hit, staying inside [lo, hi]. */
export function snap(c: number, spans: Span[], lo: number, hi: number, pad = 0.12) {
  if (!near(spans, c, pad)) return c;
  for (let k = 1; k <= 60; k++) for (const s of [1, -1]) {
    const v = c + s * k * 0.05;
    if (v >= lo && v <= hi && !near(spans, v, pad)) return v;
  }
  return c;
}

/** Longest free stretch of [lo, hi] outside `blocked`; door centre goes in its middle. */
function doorAt(lo: number, hi: number, blocked: [number, number][], w: number, front = false): number | null {
  const cuts = blocked.filter(([a, b]) => b > lo && a < hi).sort((u, v) => u[0] - v[0]);
  let best: [number, number] | null = null, cur = lo;
  for (const [a, b] of [...cuts, [hi, hi] as [number, number]]) {
    if (a - cur >= w + 0.2 && (!best || front || a - cur > best[1] - best[0])) best = [cur, a];   // front: the stretch nearest the entrance wins
    cur = Math.max(cur, b);
  }
  return best ? (best[0] + best[1]) / 2 : null;
}

export function planHouse(d: Design): FloorPlan[] {
  const X0 = -d.length / 2 + T, X1 = d.length / 2 - T, Z0 = -d.width / 2 + T, Z1 = d.width / 2 - T;
  const IW = X1 - X0, ID = Z1 - Z0, h = d.floorHeight, floors = Math.max(1, Math.round(d.floors));
  const inner: Rect = { x0: X0, z0: Z0, x1: X1, z1: Z1 };
  const all = Array.from({ length: floors }, (_, f) => facadeSpans(d, f));
  const union = (side: Side) => all.flatMap((s) => s[side]);
  const fb = [...union('front'), ...union('back')], lft = union('left'), rgt = union('right');

  // a straight flight: ~17.5 cm risers, at least 1.2 m clear at the entrance end and 1 m landing room at the back
  const flight = (x0: number, x1: number, f: number, entry = ID >= 7.5 ? 2.0 : 1.3, landing = 1.0): Stair | undefined => {
    const steps = Math.ceil(h / 0.185), zb = Z1 - entry, room = zb - (Z0 + landing);
    const run = Math.min(steps * 0.27, room);
    if (run / steps < 0.2) return undefined;   // too short for a safe stair
    return { x0, x1, z0: zb - run, z1: zb, zb, zt: zb - run, steps, floor: f };
  };

  const plans: FloorPlan[] = [];
  const small = IW < 6.2 || ID < 5.2;
  if (small) {
    // studio: one open room, a shower room in the back-right corner, stair along the left wall
    const bx = snap(X1 - Math.min(2.2, IW * 0.4), fb, X0 + 1.5, X1 - 1.4), bz = snap(Z0 + Math.min(2.1, ID * 0.45), rgt, Z0 + 1.4, Z1 - 1.5);
    let prev: Stair | undefined;
    for (let f = 0; f < floors; f++) {
      const up = f < floors - 1 ? flight(X0, X0 + 0.9, f, 0.9, 0.1) : undefined;   // in a studio you step off sideways
      const main: RoomKind = f === 0 ? 'living' : 'bedroom';
      plans.push({ floor: f, inner, up, hole: prev, rooms: [
        { id: `${f}-main`, kind: main, floor: f, x0: X0, z0: Z0, x1: X1, z1: Z1 },
        { id: `${f}-bath`, kind: 'bath', floor: f, x0: bx, z0: Z0, x1: X1, z1: bz },
      ], walls: [
        { ax: bx, az: Z0, bx, bz, doors: [] },
        { ax: bx, az: bz, bx: X1, bz, doors: [{ at: (X1 - bx) / 2, w: 0.7, h: DOOR_H }] },
      ] });
      prev = up;
    }
    return plans;
  }

  const cw = floors > 2 ? 1.6 : floors > 1 ? 1.2 : 0.8;
  const xa = snap(-cw, fb, X0 + 2.0, -0.68), xb = snap(cw, fb, 0.68, X1 - 2.0);
  let prev: Stair | undefined;
  for (let f = 0; f < floors; f++) {
    const fs = all[f];
    // stairs alternate sides so a flight never stands in the hole of the one below
    const up = f < floors - 1 ? (f % 2 === 0 ? flight(xa + TI / 2, xa + TI / 2 + 1.0, f) : flight(xb - TI / 2 - 1.0, xb - TI / 2, f)) : undefined;
    const bands = (onLeft: boolean): [number, number][] => [up, prev].filter((s): s is Stair => !!s && (s.x0 < 0) === onLeft).map((s) => [s.z0 - 0.05, s.z1 + 0.05]);
    const zl = snap(Z0 + ID * 0.46, fs.left, Z0 + 2.2, Z1 - 2.2), zr = snap(Z0 + ID * 0.42, fs.right, Z0 + 1.9, Z1 - 2.4);
    const rooms: Room[] = [{ id: `${f}-hall`, kind: 'hall', floor: f, x0: xa, z0: Z0, x1: xb, z1: Z1 }];
    let leftKinds: RoomKind[], rightKinds: RoomKind[];
    if (f === 0) { leftKinds = floors === 1 ? ['living', 'bedroom'] : ['living']; rightKinds = ['kitchen', 'bath']; }
    else { leftKinds = ['bedroom', 'bedroom']; rightKinds = ['bedroom', 'bath']; }
    const walls: IWall[] = [];
    const side = (kinds: RoomKind[], x0: number, x1: number, split: number, onLeft: boolean) => {
      const wx = onLeft ? xa : xb, blocked = bands(onLeft);
      // the back room needs a reachable door; otherwise the side becomes one room
      const parts: Rect[] = kinds.length === 2 && doorAt(Z0, split, blocked, 0.8) !== null
        ? [{ x0, x1, z0: split, z1: Z1 }, { x0, x1, z0: Z0, z1: split }] : [{ x0, x1, z0: Z0, z1: Z1 }];
      if (parts.length === 2) walls.push({ ax: x0, az: split, bx: x1, bz: split, doors: [] });
      const doors: Opening[] = [];
      parts.forEach((r, i) => {
        const kind = kinds[i], wide = kind === 'living' && f === 0, w = wide ? 1.5 : kind === 'bath' ? 0.7 : 0.8;
        rooms.push({ ...r, id: `${f}-${onLeft ? 'l' : 'r'}${i}`, kind, floor: f });
        const c = doorAt(r.z0 + 0.1, r.z1 - 0.1, blocked, w, wide) ?? doorAt(r.z0 + 0.1, r.z1 - 0.1, blocked, 0.7);
        if (c !== null) doors.push({ at: c - Z0, w: c === null ? 0.7 : w, h: DOOR_H, wide });
      });
      walls.push({ ax: wx, az: Z0, bx: wx, bz: Z1, doors });
    };
    side(leftKinds, X0, xa, zl, true);
    side(rightKinds, xb, X1, zr, false);
    plans.push({ floor: f, inner, rooms, walls, up, hole: prev });
    prev = up;
  }
  return plans;
}

/** Openings seen from inside one room, per side, in plan metres along that side (x for back/front, z for left/right). */
export type RoomSide = 'back' | 'front' | 'left' | 'right';
export type Gap = { a: number; b: number; y0: number; y1: number; door: boolean };
export function roomGaps(room: Room, plan: FloorPlan, d: Design): Record<RoomSide, Gap[]> {
  const out: Record<RoomSide, Gap[]> = { back: [], front: [], left: [], right: [] };
  const eps = 0.2, sp = facadeSpans(d, room.floor), I = plan.inner;
  const facade = (rs: RoomSide, fsd: Side, on: boolean, lo: number, hi: number) => {
    if (!on) return;
    for (const s of sp[fsd]) if (s.b > lo && s.a < hi) out[rs].push({ a: Math.max(lo, s.a), b: Math.min(hi, s.b), y0: s.y, y1: s.y + s.h, door: s.door });
  };
  facade('back', 'back', Math.abs(room.z0 - I.z0) < eps, room.x0, room.x1);
  facade('front', 'front', Math.abs(room.z1 - I.z1) < eps, room.x0, room.x1);
  facade('left', 'left', Math.abs(room.x0 - I.x0) < eps, room.z0, room.z1);
  facade('right', 'right', Math.abs(room.x1 - I.x1) < eps, room.z0, room.z1);
  for (const w of plan.walls) for (const o of w.doors) {
    const vertical = Math.abs(w.ax - w.bx) < 1e-6;
    const c = vertical ? w.az + o.at : w.ax + o.at, a = c - o.w / 2, b = c + o.w / 2, g = { a, b, y0: 0, y1: o.h, door: true };
    if (vertical) {
      if (c < room.z0 || c > room.z1) continue;
      if (Math.abs(w.ax - room.x0) < eps) out.left.push(g); else if (Math.abs(w.ax - room.x1) < eps) out.right.push(g);
    } else {
      if (c < room.x0 || c > room.x1) continue;
      if (Math.abs(w.az - room.z0) < eps) out.back.push(g); else if (Math.abs(w.az - room.z1) < eps) out.front.push(g);
    }
  }
  return out;
}
