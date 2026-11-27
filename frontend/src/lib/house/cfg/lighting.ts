import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { Season } from '../design';
import { track } from '../materials/loader';

/** Physical sky + sun synced to the design's time of day, a CC0 HDRI (Poly Haven) for image-based light and reflections,
 *  atmospheric fog and a wide field around the plot so the horizon reads as land, not a floating disc.
 *  The HDRI's own sun is clipped out so it doesn't double the DirectionalLight. 6:00 sunrise, 18:00 sunset. */
type EnvKind = 'day' | 'golden' | 'night';
const ENV_GAIN: Record<EnvKind, number> = { day: 0.42, golden: 0.5, night: 0.35 };
const FIELD: Record<Season, string> = { summer: '#5d6b43', autumn: '#7b6c48', winter: '#dfe4e8' };

/** Approximate blackbody colour (Tanner Helland), 1000–12000 K. */
export function kelvin(k: number, out = new THREE.Color()) {
  const t = k / 100;
  const r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332);
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * Math.pow(t - 60, -0.0755);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  const c = (v: number) => Math.min(1, Math.max(0, v / 255));
  return out.setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace);
}

export type LightState = { day: number; night: number; elev: number };

export class Lighting {
  sky = new Sky();
  sun = new THREE.DirectionalLight('#ffffff', 3);
  hemi = new THREE.HemisphereLight('#cfe0ff', '#6b5d48', 0.25);
  field = new THREE.Mesh(new THREE.CircleGeometry(420, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: FIELD.summer, roughness: 1 }));
  private envs = new Map<EnvKind, THREE.Texture>();
  private loading = new Set<EnvKind>();
  private kind: EnvKind | null = null;
  private center = new THREE.Vector3();
  private radius = 20;
  private time = 14; private season: Season = 'summer';
  state: LightState = { day: 1, night: 0, elev: 1 };
  exposure = 1;

  constructor(private scene: THREE.Scene, private pmrem: THREE.PMREMGenerator) {
    this.sky.scale.setScalar(900);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4.5; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.00025; this.sun.shadow.normalBias = 0.025;
    this.field.position.y = -0.03; this.field.renderOrder = -2;
    scene.add(this.sky, this.sun, this.sun.target, this.hemi, this.field);
    scene.fog = new THREE.FogExp2('#cfd9e0', 0.0045);
  }

  setShadow(mapSize: number, radius: number) {
    const s = this.sun.shadow;
    if (s.mapSize.x !== mapSize) { s.mapSize.set(mapSize, mapSize); s.map?.dispose(); s.map = null; }
    s.radius = radius; s.blurSamples = 12;
  }

  /** Shadow frustum hugs the plot so texels stay small. */
  fit(center: THREE.Vector3, radius: number, top: number) {
    this.center.copy(center); this.radius = radius;
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -radius; cam.right = radius; cam.top = radius + top; cam.near = 1; cam.far = radius * 6;
    cam.updateProjectionMatrix();
    this.update(this.time, this.season);
  }

  private async env(kind: EnvKind) {
    if (this.envs.has(kind) || this.loading.has(kind)) return;
    this.loading.add(kind);
    try {
      const tex = await track(new HDRLoader().setDataType(THREE.FloatType).loadAsync(`/hdri/${kind}.hdr`));
      const data = tex.image.data as Float32Array;
      const cap = kind === 'night' ? 4 : 24;   // remove the sun / street lamps: the scene's own lights take their place
      for (let i = 0; i < data.length; i++) if ((i & 3) !== 3 && data[i] > cap) data[i] = cap;
      tex.mapping = THREE.EquirectangularReflectionMapping; tex.needsUpdate = true;
      const rt = this.pmrem.fromEquirectangular(tex);
      tex.dispose();
      this.envs.set(kind, rt.texture);
      if (this.kind === kind) this.scene.environment = rt.texture;
    } catch { /* keep the previous environment */ }
    finally { this.loading.delete(kind); }
  }

  update(time: number, season: Season): LightState {
    this.time = time; this.season = season;
    const a = ((time - 6) / 12) * Math.PI, low = season === 'winter' ? 0.62 : season === 'autumn' ? 0.85 : 1;
    const elev = Math.sin(a) * low;
    const dir = new THREE.Vector3(Math.cos(a), Math.max(-0.25, elev), 0.55 + 0.25 * (1 - low)).normalize();
    const day = THREE.MathUtils.smoothstep(elev, -0.04, 0.22), night = 1 - THREE.MathUtils.smoothstep(elev, -0.16, 0.04);
    this.state = { day, night, elev };

    const u = this.sky.material.uniforms;
    (u.sunPosition.value as THREE.Vector3).copy(dir);
    u.rayleigh.value = 1.2 + (1 - day) * 1.6;

    // the sun by day, a cool moon by night (one shadow-casting light either way)
    const isMoon = elev < -0.02;
    const ld = isMoon ? new THREE.Vector3(-0.45, 0.75, -0.35).normalize() : dir;
    this.sun.position.copy(this.center).addScaledVector(ld, this.radius * 2.5);
    this.sun.target.position.copy(this.center);
    if (isMoon) { this.sun.color.set('#9fb4e6'); this.sun.intensity = 0.18 * night; }
    else { kelvin(1900 + Math.pow(Math.max(0, elev), 0.6) * 4200, this.sun.color); this.sun.intensity = 4.2 * THREE.MathUtils.smoothstep(elev, -0.02, 0.18); }

    const kind: EnvKind = elev < -0.06 ? 'night' : elev < 0.28 ? 'golden' : 'day';
    if (kind !== this.kind) {
      this.kind = kind;
      const t = this.envs.get(kind);
      if (t) this.scene.environment = t; else void this.env(kind);
    }
    this.scene.environmentIntensity = ENV_GAIN[kind] * (kind === 'night' ? 0.25 + night * 0.1 : 0.55 + day * 0.45);
    this.hemi.intensity = 0.05 + day * 0.2;
    kelvin(isMoon ? 9000 : 7500, this.hemi.color);

    const horizon = new THREE.Color('#0d1320').lerp(new THREE.Color('#d39a7a'), THREE.MathUtils.smoothstep(elev, -0.18, 0.02))
      .lerp(new THREE.Color('#c9d6df'), THREE.MathUtils.smoothstep(elev, 0.08, 0.4));
    (this.scene.fog as THREE.FogExp2).color.copy(horizon);
    this.scene.background = night > 0.98 ? horizon : null;   // the Sky shader is black at night; a flat navy reads better
    this.sky.visible = night <= 0.98;
    (this.field.material as THREE.MeshStandardMaterial).color.set(FIELD[season] || FIELD.summer);
    this.exposure = 0.95 + night * 0.4;
    return this.state;
  }

  /** Preload the other HDRIs in idle time, so moving the time slider never waits. */
  warm() { for (const k of ['day', 'golden', 'night'] as EnvKind[]) void this.env(k); }

  dispose() {
    this.envs.forEach((t) => t.dispose()); this.envs.clear();
    this.sky.geometry.dispose(); this.sky.material.dispose();
    this.field.geometry.dispose(); (this.field.material as THREE.Material).dispose();
    this.sun.shadow.map?.dispose(); this.hemi.dispose(); this.sun.dispose();
    this.scene.remove(this.sky, this.sun, this.sun.target, this.hemi, this.field);
  }
}
