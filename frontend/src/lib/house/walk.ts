import * as THREE from 'three';
import type { Interior } from './interior';
import type { Rect, Stair } from './interior/plan';
import { FLOOR_Y, type Seg } from './interior/rooms';

/** First-person walking: WASD / arrows + drag to look on desktop, joystick + drag on touch, tap (or double-click) a spot to walk there.
 *  Circle-vs-segment collision against walls, railings and furniture; stairs lift you between storeys. */
export type WalkWorld = { interior: Interior; plinth: number; h: number; floors: number; house: Rect; plot: Rect; doorHalf: number };

const EYE = 1.62, R = 0.24, SPEED = 1.5, RUN = 2.8;

export class Walker {
  pos = new THREE.Vector2();      // plan x, z
  y = 0; floor = 0; inside = false; yaw = 0; pitch = -0.05;
  joy = new THREE.Vector2();      // -1..1 from the on-screen stick
  private keys = new Set<string>();
  private target: THREE.Vector2 | null = null;
  private drag: { x: number; y: number; id: number; moved: number } | null = null;
  private yS = 0;
  enabled = false;

  constructor(private camera: THREE.PerspectiveCamera, private dom: HTMLElement, private world: () => WalkWorld | null) {}

  private kd = (e: KeyboardEvent) => {
    if (!this.enabled || (e.target as HTMLElement)?.closest?.('input,textarea,select')) return;
    // physical key codes: the same keys work on any keyboard layout (Latin, Cyrillic…)
    const k = e.code === 'ShiftRight' ? 'ShiftLeft' : e.code;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft'].includes(k)) { this.keys.add(k); this.target = null; e.preventDefault(); }
  };
  private ku = (e: KeyboardEvent) => { this.keys.delete(e.code === 'ShiftRight' ? 'ShiftLeft' : e.code); };
  private pd = (e: PointerEvent) => { if (!this.enabled) return; this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: 0 }; };
  private pm = (e: PointerEvent) => {
    if (!this.enabled || !this.drag || e.pointerId !== this.drag.id) return;
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX; this.drag.y = e.clientY; this.drag.moved += Math.abs(dx) + Math.abs(dy);
    const k = e.pointerType === 'touch' ? 0.006 : 0.0035;
    this.yaw -= dx * k; this.pitch = THREE.MathUtils.clamp(this.pitch - dy * k, -1.2, 1.0);
  };
  private pu = (e: PointerEvent) => {
    if (!this.enabled || !this.drag) return;
    const tap = this.drag.moved < 6; this.drag = null;
    if (tap && (e.pointerType === 'touch' || e.detail >= 2)) this.walkTo(e);
  };
  private bl = () => { this.keys.clear(); };

  attach() {
    addEventListener('keydown', this.kd); addEventListener('keyup', this.ku); addEventListener('blur', this.bl);
    this.dom.addEventListener('pointerdown', this.pd); addEventListener('pointermove', this.pm); addEventListener('pointerup', this.pu);
  }
  detach() {
    removeEventListener('keydown', this.kd); removeEventListener('keyup', this.ku); removeEventListener('blur', this.bl);
    this.dom.removeEventListener('pointerdown', this.pd); removeEventListener('pointermove', this.pm); removeEventListener('pointerup', this.pu);
    this.keys.clear(); this.joy.set(0, 0); this.target = null;
  }

  /** Tap-to-move: where the tapped ray meets the current floor. */
  private walkTo(e: PointerEvent) {
    const r = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const hitP = new THREE.Vector3();
    if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.y), hitP) && hitP.distanceTo(this.camera.position) < 25) this.target = new THREE.Vector2(hitP.x, hitP.z);
  }

  /** Puts the walker somewhere (used when entering walk mode). */
  place(x: number, z: number, yaw: number, floor = 0, inside = false) {
    this.pos.set(x, z); this.yaw = yaw; this.pitch = -0.05; this.floor = floor; this.inside = inside;
    const w = this.world(); this.y = w ? this.groundY(w) : 0; this.yS = this.y; this.target = null;
  }

  eye(out = new THREE.Vector3()) { return out.set(this.pos.x, this.yS + EYE, this.pos.y); }
  dir(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }

  private storeyBase(w: WalkWorld, f: number) { return w.plinth + f * w.h + FLOOR_Y; }
  private stairAt(w: WalkWorld): { s: Stair; t: number } | null {
    for (const f of [this.floor, this.floor - 1]) {
      const s = w.interior.plans[f]?.up; if (!s) continue;
      const p = this.pos;
      if (p.x > s.x0 - 0.02 && p.x < s.x1 + 0.02 && p.y < s.zb + 0.02 && p.y > s.zt - 0.02) return { s, t: THREE.MathUtils.clamp((s.zb - p.y) / (s.zb - s.zt), 0, 1) };
    }
    return null;
  }
  private groundY(w: WalkWorld) {
    if (!this.inside) return 0;
    const st = this.stairAt(w);
    return st ? this.storeyBase(w, st.s.floor) + st.t * w.h : this.storeyBase(w, this.floor);
  }

  update(dt: number) {
    const w = this.world(); if (!w || !this.enabled) return;
    const k = this.keys, f = new THREE.Vector2(-Math.sin(this.yaw), -Math.cos(this.yaw)), rgt = new THREE.Vector2(-f.y, f.x);
    const mv = new THREE.Vector2();
    if (k.has('KeyW') || k.has('ArrowUp')) mv.add(f);
    if (k.has('KeyS') || k.has('ArrowDown')) mv.sub(f);
    if (k.has('KeyD')) mv.add(rgt);
    if (k.has('KeyA')) mv.sub(rgt);
    if (k.has('ArrowLeft')) this.yaw += dt * 1.8;
    if (k.has('ArrowRight')) this.yaw -= dt * 1.8;
    if (this.joy.lengthSq() > 0.01) { mv.addScaledVector(f, -this.joy.y).addScaledVector(rgt, this.joy.x); this.target = null; }
    if (this.target && mv.lengthSq() === 0) {
      const to = this.target.clone().sub(this.pos);
      if (to.length() < 0.15) this.target = null;
      else mv.copy(to.normalize());
    }
    if (mv.lengthSq() > 1) mv.normalize();
    const before = this.pos.clone();
    this.pos.addScaledVector(mv, (k.has('ShiftLeft') ? RUN : SPEED) * dt);
    this.resolve(w);
    if (this.target && this.pos.distanceTo(before) < 0.002 * dt * 60) this.target = null;   // blocked: give up
    // storey bookkeeping: stepping off the top or bottom of a flight changes the floor we collide with
    const st = this.stairAt(w);
    if (st) this.floor = st.t > 0.5 ? st.s.floor + 1 : st.s.floor;
    this.y = this.groundY(w);
    this.yS += (this.y - this.yS) * Math.min(1, dt * 12);
  }

  private resolve(w: WalkWorld) {
    const H = w.house, p = this.pos, d = w.doorHalf;
    const inHouse = p.x > H.x0 + 0.02 && p.x < H.x1 - 0.02 && p.y > H.z0 + 0.02 && p.y < H.z1 - 0.02;
    if (inHouse !== this.inside) { if (this.floor === 0) this.inside = inHouse; }
    const segs: Seg[] = [];
    if (this.inside) segs.push(...(w.interior.segs[this.floor] || []));
    else {   // outside: the house shell with its front door gap, then the plot boundary
      const t = 0.03;   // H is the outer face of the walls
      segs.push({ ax: H.x0, az: H.z0, bx: H.x1, bz: H.z0, r: t }, { ax: H.x0, az: H.z0, bx: H.x0, bz: H.z1, r: t }, { ax: H.x1, az: H.z0, bx: H.x1, bz: H.z1, r: t },
        { ax: H.x0, az: H.z1, bx: -d, bz: H.z1, r: t }, { ax: d, az: H.z1, bx: H.x1, bz: H.z1, r: t });
      p.x = THREE.MathUtils.clamp(p.x, w.plot.x0, w.plot.x1); p.y = THREE.MathUtils.clamp(p.y, w.plot.z0, w.plot.z1);
    }
    const boxes = this.inside ? (w.interior.boxes[this.floor] || []) : [];
    for (let it = 0; it < 3; it++) {
      for (const s of segs) {
        const ax = s.bx - s.ax, az = s.bz - s.az, l2 = ax * ax + az * az || 1;
        const t = THREE.MathUtils.clamp(((p.x - s.ax) * ax + (p.y - s.az) * az) / l2, 0, 1);
        const cx = s.ax + ax * t, cz = s.az + az * t, dx = p.x - cx, dz = p.y - cz, dd = Math.hypot(dx, dz), min = R + s.r;
        if (dd < min) { if (dd < 1e-5) { p.x += min; continue; } p.x = cx + (dx / dd) * min; p.y = cz + (dz / dd) * min; }
      }
      for (const b of boxes) {
        const cx = THREE.MathUtils.clamp(p.x, b.x0, b.x1), cz = THREE.MathUtils.clamp(p.y, b.z0, b.z1), dx = p.x - cx, dz = p.y - cz, dd = Math.hypot(dx, dz);
        if (dd >= R) continue;
        if (dd > 1e-5) { p.x = cx + (dx / dd) * R; p.y = cz + (dz / dd) * R; continue; }
        const e = [p.x - b.x0, b.x1 - p.x, p.y - b.z0, b.z1 - p.y], m = Math.min(...e);   // inside: leave by the nearest edge
        if (m === e[0]) p.x = b.x0 - R; else if (m === e[1]) p.x = b.x1 + R; else if (m === e[2]) p.y = b.z0 - R; else p.y = b.z1 + R;
      }
    }
  }

  apply() { const e = this.eye(), d = this.dir(); this.camera.position.copy(e); this.camera.lookAt(e.add(d)); }
}
