import * as THREE from 'three';
import type { Season } from './design';
import { loadModel } from './gltf';

/** Trees and shrubs from EZ-Tree meshes, drawn as InstancedMesh (one draw call per tree part, however many trees). */
export type TreeSpot = { x: number; z: number; h: number; kind: 'oak' | 'ash' | 'aspen' | 'pine' };
export type ShrubSpot = { x: number; z: number; s: number };

const SRC_H: Record<string, number> = { oak: 68, ash: 70, aspen: 69.3, pine: 50.4, bush: 44.8 };   // generator units
const AUTUMN = new THREE.Color('#d0893a'), SUMMER = new THREE.Color('#ffffff');

type Part = { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial; leaves: boolean; local: THREE.Matrix4 };

async function parts(kind: string): Promise<Part[]> {
  const scene = await loadModel(`/models/trees/${kind}.glb`);
  scene.updateMatrixWorld(true);
  const out: Part[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    out.push({ geo: m.geometry, mat, leaves: mat.alphaTest > 0 && !mat.normalMap, local: m.matrixWorld.clone() });
  });
  return out;
}

/** Adds instanced trees/shrubs to `group` once their meshes arrive. Returns the created meshes' materials for disposal. */
export async function addVegetation(group: THREE.Group, trees: TreeSpot[], shrubs: ShrubSpot[], season: Season, alive: () => boolean) {
  const created: THREE.Material[] = [];
  const kinds = [...new Set(trees.map((t) => t.kind))];
  const jobs = kinds.map(async (kind) => {
    const ps = await parts(kind); if (!alive()) return;
    const spots = trees.filter((t) => t.kind === kind);
    for (const p of ps) {
      if (p.leaves && season === 'winter' && kind !== 'pine') continue;
      const mat = p.mat.clone(); created.push(mat);
      if (p.leaves) { mat.color.copy(season === 'autumn' && kind !== 'pine' ? AUTUMN : SUMMER); if (season === 'winter') mat.color.lerp(new THREE.Color('#e9eef0'), 0.45); }
      const im = new THREE.InstancedMesh(p.geo, mat, spots.length);
      im.castShadow = true; im.receiveShadow = !p.leaves;
      spots.forEach((s, i) => {
        const k = s.h / SRC_H[kind], rot = new THREE.Matrix4().makeRotationY((s.x * 13.7 + s.z * 7.1) % (Math.PI * 2));
        im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(s.x, 0, s.z).multiply(rot).multiply(new THREE.Matrix4().makeScale(k, k, k)).multiply(p.local));
      });
      im.computeBoundingSphere(); im.userData.shared = true;
      group.add(im);
    }
  });
  if (shrubs.length) jobs.push((async () => {
    const ps = await parts('bush'); if (!alive()) return;
    const leaf = ps.find((p) => p.leaves); if (!leaf) return;
    const mat = leaf.mat.clone(); created.push(mat);
    mat.color.copy(season === 'autumn' ? new THREE.Color('#c9a050') : season === 'winter' ? new THREE.Color('#9aa38f') : new THREE.Color('#d8e8c8'));
    // only the crown: a low, wide clump of foliage sitting on the ground
    const box = new THREE.Box3().setFromBufferAttribute(leaf.geo.getAttribute('position') as THREE.BufferAttribute).applyMatrix4(leaf.local);
    const im = new THREE.InstancedMesh(leaf.geo, mat, shrubs.length);
    im.castShadow = true;
    shrubs.forEach((s, i) => {
      const k = (1.3 * s.s) / (box.max.y - box.min.y), lift = -box.min.y * k;
      im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(s.x, lift - 0.05, s.z).multiply(new THREE.Matrix4().makeRotationY(i * 2.1)).multiply(new THREE.Matrix4().makeScale(k * 1.25, k, k * 1.25)).multiply(leaf.local));
    });
    im.computeBoundingSphere(); im.userData.shared = true; group.add(im);
  })());
  await Promise.allSettled(jobs);
  return created;
}
