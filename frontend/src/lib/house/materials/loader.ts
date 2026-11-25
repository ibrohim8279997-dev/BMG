import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { antiTile } from './antitile';
import { BASE, SETS, setUrl } from './registry';

/** KTX2 texture sets, loaded on demand and shared by every material that uses them.
 *  Materials are created right away with a flat colour (fast first frame) and upgraded in place once their set arrives. */
export type Maps = { map: THREE.Texture; normalMap: THREE.Texture; orm: THREE.Texture };
type Listener = (pending: number, done: number) => void;

let ktx: KTX2Loader | null = null;
let anisotropy = 8;
const cache = new Map<string, Promise<Maps>>();
const ready = new Map<string, Maps>();
let pending = 0, done = 0;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l(pending, done));

export function initTextures(renderer: THREE.WebGLRenderer) {
  ktx = new KTX2Loader().setTranscoderPath('/libs/basis/').detectSupport(renderer);
  anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
}

export function onProgress(l: Listener) { listeners.add(l); l(pending, done); return () => { listeners.delete(l); }; }

function prep(t: THREE.Texture, id: string, srgb: boolean) {
  const s = SETS[id];
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.repeat.set(1 / s.size[0], 1 / s.size[1]);
  if (s.rot) t.rotation = Math.PI / 2;
  return t;
}

export function loadSet(id: string): Promise<Maps> {
  const hit = cache.get(id); if (hit) return hit;
  if (!ktx) return Promise.reject(new Error('textures not initialised'));
  const loader = ktx;
  pending++; emit();
  const one = (m: 'albedo' | 'normal' | 'orm') => loader.loadAsync(setUrl(id, m));
  const p = Promise.all([one('albedo'), one('normal'), one('orm')]).then(([a, n, o]) => {
    const maps = { map: prep(a, id, true), normalMap: prep(n, id, false), orm: prep(o, id, false) };
    ready.set(id, maps);
    return maps;
  }).finally(() => { pending--; done++; emit(); });
  cache.set(id, p);
  return p;
}

export type PbrOpts = { set: string; color: string; normal?: number; rough?: number; metal?: number; repeat?: number };

/** Puts a texture set on a material (now if cached, otherwise when it arrives). */
export function applySet(m: THREE.MeshStandardMaterial, o: PbrOpts) {
  const s = SETS[o.set]; if (!s) return;
  const picked = new THREE.Color(o.color);
  const wire = (maps: Maps) => {
    m.map = maps.map; m.normalMap = maps.normalMap; m.normalScale.setScalar(o.normal ?? 1);
    m.aoMap = maps.orm; m.aoMapIntensity = 1; m.roughnessMap = maps.orm;
    const metal = o.metal ?? s.metal;
    if (metal === undefined) { m.metalnessMap = maps.orm; m.metalness = 1; } else { m.metalnessMap = null; m.metalness = metal; }
    m.roughness = o.rough ?? s.rough ?? 1;
    m.bumpMap = null; m.color.copy(picked);
    m.needsUpdate = true;
  };
  antiTile(m, s.anti ?? 'none');
  const now = ready.get(o.set);
  if (now) { wire(now); return; }
  if (!s.tint && BASE[o.set]) m.color.set(BASE[o.set]).multiply(picked);   // placeholder tone until loaded
  else m.color.copy(picked);
  m.roughness = o.rough ?? s.rough ?? 0.85; m.metalness = o.metal ?? s.metal ?? 0;
  loadSet(o.set).then((maps) => { if (m.userData.disposed) return; wire(maps); }).catch(() => { /* flat colour stays */ });
}

export function disposeSets() {
  ready.forEach((m) => { m.map.dispose(); m.normalMap.dispose(); m.orm.dispose(); });
  ready.clear(); cache.clear(); pending = 0; done = 0;
  ktx?.dispose(); ktx = null;
}
