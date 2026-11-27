/** First-person walk: WASD / arrows (Shift to run) and drag to look on desktop, on-screen stick + drag on touch.
 *  Circle collision against exterior walls (door gap on the ground floor), partitions and furniture; the fence bounds the plot. */
import * as THREE from 'three';
import type { Rect, Seg } from './interior';

export type WalkFloor = { y: number; segs: Seg[]; boxes: Rect[]; spawn: [number, number] };
export type WalkWorld = { floors: WalkFloor[]; hx: number; hz: number; px: number; pz: number; doorX: number };

const EYE = 1.62, R = 0.3, SPEED = 1.6, RUN = 3.2;

export class Walker {
  pos = new THREE.Vector2(); y = 0; floor = 0; yaw = 0; pitch = -0.05;
  joy = new THREE.Vector2();
  private keys = new Set<string>();
  private ac: AbortController | null = null;

  constructor(private world: () => WalkWorld | null) {}

  attach() {
    this.detach(); this.ac = new AbortController(); const sig = { signal: this.ac.signal };
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.closest?.('input,textarea,select')) return;
      const k = e.code === 'ShiftRight' ? 'ShiftLeft' : e.code;   // physical keys: works on any layout
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft'].includes(k)) { this.keys.add(k); e.preventDefault(); }
    }, sig);
    addEventListener('keyup', (e) => { this.keys.delete(e.code === 'ShiftRight' ? 'ShiftLeft' : e.code); }, sig);
    addEventListener('blur', () => this.keys.clear(), sig);
  }
  detach() { this.ac?.abort(); this.ac = null; this.keys.clear(); this.joy.set(0, 0); }

  look(dx: number, dy: number, touch: boolean) {
    const k = touch ? 0.006 : 0.0035;
    this.yaw -= dx * k; this.pitch = THREE.MathUtils.clamp(this.pitch - dy * k, -1.2, 1.0);
  }

  /** Start outside in front of the door, looking at the house. */
  start() { const w = this.world(); if (!w) return; this.floor = 0; this.pos.set(w.doorX, w.hz + 4.5); this.yaw = 0; this.pitch = -0.04; this.y = 0; }
  /** Jump to a storey (its main room). */
  goFloor(i: number) { const w = this.world(); if (!w || !w.floors[i]) return; this.floor = i; this.pos.set(...w.floors[i].spawn); this.y = w.floors[i].y; this.yaw = 0; }

  private inside(w: WalkWorld) { return Math.abs(this.pos.x) < w.hx && Math.abs(this.pos.y) < w.hz; }

  update(dt: number, cam: THREE.PerspectiveCamera) {
    const w = this.world(); if (!w) return;
    const k = this.keys, f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - this.joy.y;
    const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + this.joy.x;
    if (k.has('ArrowLeft')) this.yaw += dt * 1.8;
    if (k.has('ArrowRight')) this.yaw -= dt * 1.8;
    const sp = (k.has('ShiftLeft') ? RUN : SPEED) * dt, fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const mv = new THREE.Vector2(fx * f + Math.cos(this.yaw) * s, fz * f - Math.sin(this.yaw) * s);
    if (mv.lengthSq() > 1) mv.normalize();
    this.pos.addScaledVector(mv, sp);
    this.collide(w);
    const fl = w.floors[this.floor], target = this.inside(w) || this.floor > 0 ? fl.y : 0;
    this.y += (target - this.y) * Math.min(1, dt * 9);
    cam.position.set(this.pos.x, this.y + EYE, this.pos.y);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  private collide(w: WalkWorld) {
    const fl = w.floors[this.floor], hx = w.hx - 0.15, hz = w.hz - 0.15, ground = this.floor === 0;
    const ext: Seg[] = [[-hx, -hz, hx, -hz], [-hx, -hz, -hx, hz], [hx, -hz, hx, hz]];
    if (ground) ext.push([-hx, hz, w.doorX - 0.5, hz], [w.doorX + 0.5, hz, hx, hz]); else ext.push([-hx, hz, hx, hz]);
    const segs = this.inside(w) ? [...ext, ...fl.segs] : ext;
    for (let it = 0; it < 2; it++) {
      for (const [x1, z1, x2, z2] of segs) {
        const ax = x2 - x1, az = z2 - z1, l2 = ax * ax + az * az || 1;
        const t = THREE.MathUtils.clamp(((this.pos.x - x1) * ax + (this.pos.y - z1) * az) / l2, 0, 1);
        const qx = x1 + ax * t, qz = z1 + az * t, dx = this.pos.x - qx, dz = this.pos.y - qz, d = Math.hypot(dx, dz);
        if (d < R) { if (d > 1e-4) this.pos.set(qx + (dx * R) / d, qz + (dz * R) / d); else this.pos.x += R; }
      }
      if (this.inside(w)) for (const [x0, z0, x1, z1] of fl.boxes) {
        const a = x0 - R, b = z0 - R, c = x1 + R, e = z1 + R, { x, y: z } = this.pos;
        if (x > a && x < c && z > b && z < e) {
          const m = Math.min(x - a, c - x, z - b, e - z);
          if (m === x - a) this.pos.x = a; else if (m === c - x) this.pos.x = c; else if (m === z - b) this.pos.y = b; else this.pos.y = e;
        }
      }
    }
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -w.px + 0.4, w.px - 0.4); this.pos.y = THREE.MathUtils.clamp(this.pos.y, -w.pz + 0.4, w.pz - 0.4);
  }
}
