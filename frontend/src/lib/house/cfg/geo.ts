import * as THREE from 'three';

/** BoxGeometry whose UVs are in metres (BoxGeometry face order: +x, -x, +y, -y, +z, -z). */
export function boxGeo(w: number, h: number, d: number) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv as THREE.BufferAttribute;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]); }
  return g;
}
export function bx(g: THREE.Group, m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) {
  const o = new THREE.Mesh(boxGeo(w, h, d), m); o.position.set(x, y, z); g.add(o); return o;
}
