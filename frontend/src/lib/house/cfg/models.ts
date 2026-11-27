import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { track } from '../materials/loader';

/** Shared GLB cache (meshopt + WebP). Callers get clones that share geometry and materials (flagged userData.shared,
 *  so a rebuild never frees them); everything is freed once in disposeModels(). */
let loader: GLTFLoader | null = null;
const cache = new Map<string, Promise<THREE.Group>>();

function getLoader() {
  if (!loader) { loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); }
  return loader;
}

export function loadModel(url: string): Promise<THREE.Group> {
  let p = cache.get(url);
  if (!p) {
    p = track(getLoader().loadAsync(url)).then((g) => {
      g.scene.traverse((o) => {
        o.userData.shared = true;
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true; m.receiveShadow = true;
        for (const mat of [m.material].flat()) { mat.userData.shared = true; const s = mat as THREE.MeshStandardMaterial; if (s.map) s.map.anisotropy = 4; }
      });
      return g.scene;
    });
    cache.set(url, p);
    p.catch(() => cache.delete(url));
  }
  return p.then((s) => s.clone(true));
}

/** A private copy of a shared material (it may be faded or tinted on its own, and is freed with its owner). */
export function own<M extends THREE.Material>(m: M): M { const c = m.clone() as M; c.userData.shared = false; return c; }

/** Scales a model so its bounding box fits `size` (keeping proportions) and stands on y = 0, centred on x/z. */
export function fitModel(o: THREE.Object3D, size: { w?: number; h?: number; d?: number }) {
  o.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(o), dim = box.getSize(new THREE.Vector3());
  const k = Math.min(size.w ? size.w / dim.x : Infinity, size.h ? size.h / dim.y : Infinity, size.d ? size.d / dim.z : Infinity);
  const s = Number.isFinite(k) ? k : 1;
  o.scale.multiplyScalar(s);
  const c = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
  o.position.set(-c.x, -box.min.y * s, -c.z);
  const wrap = new THREE.Group(); wrap.add(o); wrap.userData.height = dim.y * s;
  return wrap;
}

export async function disposeModels() {
  const all = [...cache.values()]; cache.clear();
  for (const p of all) {
    try {
      const s = await p;
      s.traverse((o) => {
        const m = o as THREE.Mesh; if (!m.isMesh) return;
        m.geometry.dispose();
        for (const mat of [m.material].flat()) {
          for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
          mat.dispose();
        }
      });
    } catch { /* failed loads hold nothing */ }
  }
}
