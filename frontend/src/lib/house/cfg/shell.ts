/** Exterior walls with real openings: windows and the front door are cut out of the facade (so you can see in and out),
 *  the inner face is a painted plaster layer, and the openings get frames, glass and an ajar front door. */
import * as THREE from 'three';
import { bx } from './geo';

export type Side = 'front' | 'back' | 'left' | 'right';
/** An opening on one wall: c = centre along the wall (x on front/back, z on the sides), y = bottom, absolute. */
export type Hole = { c: number; w: number; y: number; h: number; door?: boolean };
/** Grid of one storey: window cells along x and z. Partitions sit on cell edges, so they never cut a window. */
export type Grid = { nx: number; nz: number; xs: number[]; zs: number[]; doorX: number };

export const WALL_T = 0.3;

export function grid(L: number, W: number): Grid {
  const nx = Math.max(1, Math.round(L / 3.2)), nz = Math.max(1, Math.round(W / 3.6));
  const xs = Array.from({ length: nx }, (_, k) => -L / 2 + ((k + 0.5) * L) / nx), zs = Array.from({ length: nz }, (_, k) => -W / 2 + ((k + 0.5) * W) / nz);
  const k = nx >= 3 ? Math.floor(Math.max(1, Math.round(nx * 0.4)) / 2) : 0;   // the door opens into the living room (first band)
  return { nx, nz, xs, zs, doorX: xs[k] };
}

export function holes(g: Grid, floor: number, yb: number): Record<Side, Hole[]> {
  const win = (c: number): Hole => ({ c, w: 1.2, y: yb + 0.8, h: 1.4 });
  const front = g.xs.map((x) => (floor === 0 && x === g.doorX ? { c: x, w: 1.0, y: yb, h: 2.1, door: true } : win(x)));
  return { front, back: g.xs.map(win), left: g.zs.map(win), right: g.zs.map(win) };
}

/** Wall pieces around the holes, as boxes. along = 'x' (front/back) or 'z' (sides); pos = the wall's centre-line coordinate. */
function pierced(g: THREE.Group, m: THREE.Material, along: 'x' | 'z', from: number, to: number, pos: number, y0: number, h: number, th: number, hs: Hole[]) {
  const put = (a: number, b: number, ya: number, yb: number) => {
    if (b - a < 0.01 || yb - ya < 0.01) return;
    const c = (a + b) / 2, w = b - a, hh = yb - ya, y = (ya + yb) / 2;
    if (along === 'x') bx(g, m, w, hh, th, c, y, pos); else bx(g, m, th, hh, w, pos, y, c);
  };
  let cur = from;
  for (const o of [...hs].sort((a, b) => a.c - b.c)) {
    const a = Math.max(from, o.c - o.w / 2), b = Math.min(to, o.c + o.w / 2);
    put(cur, a, y0, y0 + h); put(a, b, y0, o.y); put(a, b, o.y + o.h, y0 + h); cur = b;
  }
  put(cur, to, y0, y0 + h);
}

/** Facade layer (part material) + 2 cm plaster inside (paint), both pierced by the same holes. */
export function shellWalls(g: THREE.Group, facade: THREE.Material, paint: THREE.Material, hx: number, hz: number, yb: number, h: number, hs: Record<Side, Hole[]>) {
  const t = WALL_T, out = t - 0.02;
  pierced(g, facade, 'x', -hx, hx, hz - out / 2, yb, h, out, hs.front); pierced(g, facade, 'x', -hx, hx, -(hz - out / 2), yb, h, out, hs.back);
  pierced(g, facade, 'z', -(hz - t), hz - t, hx - out / 2, yb, h, out, hs.right); pierced(g, facade, 'z', -(hz - t), hz - t, -(hx - out / 2), yb, h, out, hs.left);
  pierced(g, paint, 'x', -(hx - t), hx - t, hz - t + 0.01, yb, h, 0.02, hs.front); pierced(g, paint, 'x', -(hx - t), hx - t, -(hz - t + 0.01), yb, h, 0.02, hs.back);
  pierced(g, paint, 'z', -(hz - t), hz - t, hx - t + 0.01, yb, h, 0.02, hs.right); pierced(g, paint, 'z', -(hz - t), hz - t, -(hx - t + 0.01), yb, h, 0.02, hs.left);
}

/** Double glazing: a faint green-grey tint, glass IOR and a strong environment reflection (the sky and the yard show in it).
 *  userData.glass lets the renderer light the panes up warm after dusk. */
const glassMat = () => {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xa9bcbf, roughness: 0.02, metalness: 0, ior: 1.52, specularIntensity: 1, envMapIntensity: 1.8,
    clearcoat: 1, clearcoatRoughness: 0.01, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
  m.userData.glass = true;
  return m;
};

/** Frames, glass panes, sills and the front door (left ajar so you can walk in). */
export function shellOpenings(g: THREE.Group, frame: THREE.Material, hx: number, hz: number, hs: Record<Side, Hole[]>) {
  const gl = glassMat(), sill = new THREE.MeshStandardMaterial({ color: 0xd8d6d0, roughness: 0.5, metalness: 0.3 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3b2a20, roughness: 0.6 }), handle = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.3 });
  const mid = WALL_T / 2, fw = 0.07, fd = 0.09;
  const sides: [Side, number, number, boolean][] = [['front', 0, hz - mid, true], ['back', Math.PI, -(hz - mid), true], ['right', Math.PI / 2, hx - mid, false], ['left', -Math.PI / 2, -(hx - mid), false]];
  for (const [side, rot, pos, alongX] of sides) for (const o of hs[side]) {
    const og = new THREE.Group(); og.rotation.y = rot;
    if (alongX) og.position.set(o.c, 0, pos); else og.position.set(pos, 0, o.c);   // local +z points outwards on every side
    const cy = o.y + o.h / 2;
    const bars: number[][] = [[o.w, fw, 0, o.h / 2 - fw / 2], [fw, o.h, o.w / 2 - fw / 2, 0], [fw, o.h, -o.w / 2 + fw / 2, 0]];
    if (!o.door) bars.push([o.w, fw, 0, -o.h / 2 + fw / 2]);
    if (!o.door && o.w > 0.95) bars.push([fw * 0.8, o.h - 2 * fw, 0, 0]);
    for (const [w, h, px, py] of bars) bx(og, frame, w, h, fd, px, cy + py, 0);
    if (o.door) {
      const hinge = new THREE.Group(); hinge.position.set(-o.w / 2 + fw, o.y, 0); hinge.rotation.y = 1.25; og.add(hinge);
      bx(hinge, leafMat, o.w - 2 * fw, o.h - fw - 0.01, 0.05, (o.w - 2 * fw) / 2, (o.h - fw) / 2, 0);
      bx(hinge, handle, 0.03, 0.03, 0.12, o.w - 2 * fw - 0.1, 1.0, 0.06);
    } else {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(o.w - 2 * fw, o.h - 2 * fw), gl); pane.position.set(0, cy, 0); pane.renderOrder = 2; og.add(pane);
      bx(og, sill, o.w + 0.08, 0.03, 0.2, 0, o.y - 0.015, mid);
    }
    g.add(og);
  }
}
