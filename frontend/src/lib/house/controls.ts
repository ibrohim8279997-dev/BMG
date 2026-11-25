import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Built } from './build';
import { Walker, type WalkWorld } from './walk';

/** View modes and the camera moves between them.
 *  exterior: orbit around the house · cutaway: dollhouse (roof and the walls facing you lifted off) · walk: first person inside. */
export type Mode = 'exterior' | 'cutaway' | 'walk';
type Tween = { p0: THREE.Vector3; p1: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3; f0: number; f1: number; k: number; dur: number; done?: () => void };
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Navigator {
  orbit: OrbitControls;
  walker: Walker;
  mode: Mode = 'exterior';
  private tween: Tween | null = null;
  private look = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera, dom: HTMLElement, world: () => WalkWorld | null) {
    this.orbit = new OrbitControls(camera, dom);
    this.orbit.enableDamping = true; this.orbit.dampingFactor = 0.07; this.orbit.maxPolarAngle = Math.PI / 2 - 0.04; this.orbit.minDistance = 6;
    this.orbit.autoRotateSpeed = 0.6;
    this.walker = new Walker(camera, dom, world);
  }

  get busy() { return !!this.tween; }

  /** Smooth camera move (position, target, field of view). */
  fly(p: THREE.Vector3, t: THREE.Vector3, fov = this.camera.fov, dur = 1.1, done?: () => void) {
    this.tween = { p0: this.camera.position.clone(), p1: p.clone(), t0: this.orbit.target.clone(), t1: t.clone(), f0: this.camera.fov, f1: fov, k: 0, dur, done };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) this.tween.dur = 0.01;
  }

  setMode(mode: Mode, b: Built | null) {
    const prev = this.mode; this.mode = mode;
    const r = b ? b.radius : 20, top = b ? b.top : 6, d = b?.kit.d;
    if (prev === 'walk') { this.walker.enabled = false; this.walker.detach(); this.orbit.enabled = true; this.orbit.target.copy(this.look); }
    if (mode === 'exterior') {
      this.orbit.minDistance = 6; this.orbit.maxPolarAngle = Math.PI / 2 - 0.04;
      this.fly(new THREE.Vector3(r * 1.2, r * 0.72, r * 1.35), new THREE.Vector3(0, top * 0.4, 0), 38);
    } else if (mode === 'cutaway') {
      const s = d ? Math.max(d.length, d.width) : 12;
      this.orbit.minDistance = 3; this.orbit.maxPolarAngle = Math.PI / 2.3;
      this.fly(new THREE.Vector3(s * 0.75, s * 1.05, s * 1.0), new THREE.Vector3(0, 1.2, 0), 40);
    } else if (d) {
      // walk in from the garden path, facing the front door
      const z = d.width / 2 + 3.2;
      this.walker.place(0, z, 0, 0, false);
      const eye = this.walker.eye(), aim = eye.clone().add(this.walker.dir());
      this.orbit.enabled = false;
      this.fly(eye, aim, 62, 1.3, () => { this.walker.enabled = true; this.walker.attach(); });
    }
  }

  update(dt: number) {
    if (this.tween) {
      const tw = this.tween; tw.k = Math.min(1, tw.k + dt / tw.dur); const e = ease(tw.k);
      this.camera.position.lerpVectors(tw.p0, tw.p1, e);
      this.look.lerpVectors(tw.t0, tw.t1, e);
      this.camera.fov = THREE.MathUtils.lerp(tw.f0, tw.f1, e); this.camera.updateProjectionMatrix();
      if (this.mode === 'walk') this.camera.lookAt(this.look); else { this.orbit.target.copy(this.look); this.orbit.update(); }
      if (tw.k >= 1) { this.tween = null; tw.done?.(); }
      return;
    }
    if (this.mode === 'walk' && this.walker.enabled) { this.walker.update(dt); this.walker.apply(); this.look.copy(this.camera.position).add(this.walker.dir()); }
    else this.orbit.update();
  }

  /** Cutaway: hide the roof, storeys above the chosen level, and exterior walls whose outside faces the camera. */
  cut(b: Built, level: number) {
    const cam = this.camera.position;
    for (const w of b.walls) {
      const n = w.side === 'front' ? [0, 1] : w.side === 'back' ? [0, -1] : w.side === 'right' ? [1, 0] : [-1, 0];
      const p = w.group.getWorldPosition(new THREE.Vector3());
      const facing = (cam.x - p.x) * n[0] + (cam.z - p.z) * n[1] > 0;
      w.group.visible = !(facing && w.floor === level) && w.floor <= level;
    }
    b.floorGroups.forEach((g, i) => { g.visible = i <= level; });
  }

  dispose() { this.walker.detach(); this.orbit.dispose(); }
}
