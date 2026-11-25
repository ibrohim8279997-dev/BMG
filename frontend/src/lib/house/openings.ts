// No runtime imports: the floor-plan generator and its node tests use this file directly.
import type { Design } from './design';

export const T = 0.3;   // exterior wall thickness (m)
export type Hole = { x: number; y: number; w: number; h: number };
export type DoorCut = { x: number; w: number; h: number };

/** Window / door layout of one wall: returns hole rectangles in the wall's local metres (x from the wall's left end seen from outside).
 *  Long walls (front and back) share one odd grid of window axes, so the piers between windows line up front to back
 *  and interior partitions can meet both facades between windows. `entry` puts the front door in the middle slot. */
export function wallLayout(len: number, h: number, long: boolean, entry: boolean) {
  const front = long, ground = entry;
  const slots = long ? Math.max(3, Math.round(len / 2.6) | 1) : Math.max(1, Math.round(len / 2.9));
  const slotW = len / slots, ww = Math.min(1.35, slotW * 0.56), wh = Math.min(1.45, h * 0.52), sill = Math.max(0.7, Math.min(0.9, h - wh - 0.45));
  const holes: Hole[] = [];
  let door: DoorCut | undefined;
  for (let i = 0; i < slots; i++) {
    const x = slotW * (i + 0.5);
    if (front && ground && i === (slots - 1) / 2) { door = { x, w: 1.1, h: Math.min(2.15, h - 0.3) }; continue; }
    holes.push({ x, y: sill, w: ww, h: wh });
  }
  return { holes, door };
}

export type Side = 'front' | 'back' | 'left' | 'right';
/** An opening projected onto the plan: [a, b] along the side's world axis (x for front/back, z for left/right). */
export type Span = { a: number; b: number; y: number; h: number; door: boolean };

/** All facade openings of one storey in world plan coordinates (house centred at 0, front = +z). */
export function facadeSpans(d: Design, floor: number): Record<Side, Span[]> {
  const L = d.length, W = d.width, h = d.floorHeight;
  const out: Record<Side, Span[]> = { front: [], back: [], left: [], right: [] };
  const add = (side: Side, len: number, long: boolean, map: (x: number) => number) => {
    const lay = wallLayout(len, h, long, side === 'front' && floor === 0);
    for (const o of lay.holes) { const p = [map(o.x - o.w / 2), map(o.x + o.w / 2)].sort((u, v) => u - v); out[side].push({ a: p[0], b: p[1], y: o.y, h: o.h, door: false }); }
    if (lay.door) { const p = [map(lay.door.x - lay.door.w / 2), map(lay.door.x + lay.door.w / 2)].sort((u, v) => u - v); out[side].push({ a: p[0], b: p[1], y: 0, h: lay.door.h, door: true }); }
  };
  add('front', L, true, (x) => x - L / 2);
  add('back', L, true, (x) => -(x - L / 2));
  const sl = W - 2 * T;
  add('right', sl, false, (x) => -(x - sl / 2));
  add('left', sl, false, (x) => x - sl / 2);
  return out;
}
