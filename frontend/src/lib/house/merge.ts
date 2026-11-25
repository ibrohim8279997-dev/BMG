import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Draw-call reduction: static meshes that share a material (and shadow flags) inside one scope become a single mesh.
 *  Stops at children flagged `userData.keep` (they are merged as their own scopes: wall panels the cutaway hides, storeys that move…)
 *  and never touches clickable zone meshes, multi-material meshes, instanced meshes or meshes borrowing cached geometry. */
export function mergeStatic(scope: THREE.Object3D) {
  scope.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(scope.matrixWorld).invert();
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; recv: boolean; order: number; items: THREE.Mesh[] }>();
  const visit = (o: THREE.Object3D) => {
    for (const c of o.children) {
      if (c.userData.keep) continue;
      const m = c as THREE.Mesh;
      if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh && !m.userData.zone && !m.userData.shared && !Array.isArray(m.material) && m.visible) {
        const key = `${m.material.uuid}|${m.castShadow}|${m.receiveShadow}|${m.renderOrder}`;
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = { mat: m.material, cast: m.castShadow, recv: m.receiveShadow, order: m.renderOrder, items: [] }));
        b.items.push(m);
      }
      visit(c);
    }
  };
  visit(scope);
  const used = new Set<THREE.BufferGeometry>();
  for (const b of buckets.values()) {
    if (b.items.length < 2) continue;
    const geos: THREE.BufferGeometry[] = [];
    for (const m of b.items) {
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
      g.clearGroups();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      if (m.matrixWorld.determinant() < 0) g = flipWinding(g);
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    for (const m of b.items) { used.add(m.geometry); m.parent?.remove(m); }
    const out = new THREE.Mesh(merged, b.mat);
    out.castShadow = b.cast; out.receiveShadow = b.recv; out.renderOrder = b.order; out.userData.merged = true;
    scope.add(out);
  }
  // free source geometries nobody else still draws
  const alive = new Set<THREE.BufferGeometry>();
  scope.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) alive.add(m.geometry); });
  used.forEach((g) => { if (!alive.has(g)) g.dispose(); });
}

function flipWinding(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position') as THREE.BufferAttribute, n = g.getAttribute('normal') as THREE.BufferAttribute, u = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 3) for (const a of [p, n, u]) {
    for (let k = 0; k < a.itemSize; k++) { const t = a.getComponent(i + 1, k); a.setComponent(i + 1, k, a.getComponent(i + 2, k)); a.setComponent(i + 2, k, t); }
  }
  return g;
}
