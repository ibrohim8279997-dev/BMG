import * as THREE from 'three';
import { Kit, PLINTH, mesh, roofY } from './kit';
import { boxM } from './textures';
import type { ShrubSpot, TreeSpot } from './vegetation';

/** Chimney, porch, balcony, garage, solar panels, pool, door lamps. Returns the lights that switch on at night. */
export function addExtras(kit: Kit, group: THREE.Group, floors: THREE.Group[], roof: THREE.Group): THREE.PointLight[] {
  const { d } = kit, L = d.length, W = d.width, x = d.extras, p = (d.roofPitch * Math.PI) / 180;
  const doorH = Math.min(2.15, d.floorHeight - 0.3);
  if (x.chimney) {
    const ridge = d.roofType === 'flat' ? 0.4 : d.roofType === 'mono' ? W * Math.tan(p) : (W / 2) * Math.tan(p);
    const h = ridge + 0.9, cx = d.roofType === 'hip' ? Math.min(L / 4, Math.max(0, (L - W) / 2)) : L / 4;
    const ch = mesh(boxM(0.7, h, 0.7), kit.std({ set: 'clinker', color: '#ffffff' })); ch.position.set(cx, h / 2, -W / 5); roof.add(ch);
    const cap = mesh(boxM(0.86, 0.1, 0.86), kit.trim); cap.position.set(cx, h + 0.05, -W / 5); roof.add(cap);
  }
  if (x.porch) {
    const deck = mesh(boxM(2.8, PLINTH, 1.5), kit.plinth); deck.position.set(0, PLINTH / 2, W / 2 + 0.75); group.add(deck);
    const step = mesh(boxM(2.8, PLINTH / 2, 0.45), kit.plinth); step.position.set(0, PLINTH / 4, W / 2 + 1.72); group.add(step);
    const cy = PLINTH + doorH + 0.45;
    const top = new THREE.Group(); top.name = 'porchTop'; top.userData.keep = true; group.add(top);   // hidden in the cutaway view
    const roofSlab = mesh(boxM(3.2, 0.14, 1.8), kit.trim); roofSlab.position.set(0, cy, W / 2 + 0.9); top.add(roofSlab);
    for (const s of [-1, 1]) { const col = mesh(new THREE.CylinderGeometry(0.08, 0.09, cy - PLINTH, 16), kit.trim); col.position.set(s * 1.3, PLINTH + (cy - PLINTH) / 2, W / 2 + 1.55); top.add(col); }
  } else {
    const step = mesh(boxM(1.6, PLINTH, 0.6), kit.plinth); step.position.set(0, PLINTH / 2, W / 2 + 0.3); group.add(step);
  }
  const lamps: THREE.PointLight[] = [];
  for (const s of [-1, 1]) {
    const lampBox = mesh(boxM(0.12, 0.22, 0.12), kit.lamp, undefined, false); lampBox.position.set(s * 0.95, PLINTH + doorH + 0.1, W / 2 + 0.07); group.add(lampBox);
    const l = new THREE.PointLight('#ffcf8a', 0, 9, 2); l.position.set(s * 0.95, PLINTH + doorH + 0.1, W / 2 + 0.45); group.add(l); lamps.push(l);
  }
  if (x.balcony && floors.length > 1) {
    const b = floors[1];
    const slab = mesh(boxM(3, 0.14, 1.3), kit.trim); slab.position.set(0, 0.13, W / 2 + 0.65); b.add(slab);
    const post = new THREE.BoxGeometry(0.035, 1.0, 0.035);
    for (let i = 0; i <= 10; i++) { const m = mesh(post, kit.frame); m.position.set(-1.45 + i * 0.29, 0.7, W / 2 + 1.27); b.add(m); }
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { const m = mesh(post, kit.frame); m.position.set(s * 1.45, 0.7, W / 2 + 0.1 + i * 0.36); b.add(m); }
    const rail = mesh(boxM(3, 0.05, 0.06), kit.frame); rail.position.set(0, 1.2, W / 2 + 1.27); b.add(rail);
    for (const s of [-1, 1]) { const r = mesh(boxM(0.06, 0.05, 1.25), kit.frame); r.position.set(s * 1.45, 1.2, W / 2 + 0.65); b.add(r); }
  }
  if (x.garage) {
    const gl = 3.8, gd = Math.min(W - 0.4, 6.2), gh = Math.min(3, d.floorHeight + 0.2), gx = L / 2 + gl / 2, gz = W / 2 - gd / 2;
    const body = mesh(boxM(gl, gh, gd), kit.wall, 'walls'); body.position.set(gx, gh / 2, gz); group.add(body);
    const door = mesh(boxM(gl - 0.8, gh - 0.55, 0.06), kit.door); door.position.set(gx, (gh - 0.55) / 2, W / 2 + 0.02); group.add(door);
    const top = mesh(boxM(gl + 0.4, 0.2, gd + 0.4), kit.roof, 'roof'); top.position.set(gx, gh + 0.1, gz); group.add(top);
  }
  if (x.solar) {
    const mat = kit.std({ tex: 'solar', color: '#6b86c2', rough: 0.25, metal: 0.4, bump: 0.2 });
    const panel = boxM(1.0, 0.04, 1.65), flat = d.roofType === 'flat';
    const z0 = flat ? 0 : d.roofType === 'mono' ? 0 : W / 4, tilt = flat ? (20 * Math.PI) / 180 : p;
    const slopeLen = flat ? W * 0.6 : (d.roofType === 'mono' ? W : W / 2) / Math.cos(p);
    const rows = Math.max(1, Math.min(3, Math.floor((slopeLen - 0.8) / 1.75)));
    const span = d.roofType === 'hip' ? L - W / 2 - 1 : L * 0.72, cols = Math.max(1, Math.min(10, Math.floor(span / 1.05)));
    for (let r = 0; r < (flat ? 2 : 1); r++) {
      const g = new THREE.Group(); g.rotation.x = tilt;
      const zz = flat ? -W / 5 + r * (W / 2.6) : z0;
      g.position.set(0, (flat ? 0.75 : roofY(d, zz) + 0.07), zz);
      for (let i = 0; i < cols; i++) for (let j = 0; j < (flat ? 1 : rows); j++) {
        const m = mesh(panel, mat); m.position.set((i - (cols - 1) / 2) * 1.05, 0, (j - ((flat ? 1 : rows) - 1) / 2) * 1.72); g.add(m);
      }
      roof.add(g);
    }
  }
  if (x.pool) {
    const px = -L / 6, pz = -(W / 2 + 3.6);
    const coping = mesh(boxM(6.6, 0.2, 3.6), kit.std({ set: 'granite', color: '#ffffff' })); coping.position.set(px, 0.1, pz); group.add(coping);
    const water = new THREE.MeshPhysicalMaterial({ color: '#2f8fae', roughness: 0.02, metalness: 0, ior: 1.33, transparent: true, opacity: 0.88, clearcoat: 1, emissive: new THREE.Color('#1d6f8f'), emissiveIntensity: 0.15 });
    kit.all.push(water);
    const w = mesh(new THREE.BoxGeometry(6, 0.04, 3), water, undefined, false); w.position.set(px, 0.2, pz); w.userData.water = true; group.add(w);
  }
  return lamps;
}

/** Plane whose UVs are in metres. */
function planeM(w: number, h: number) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
  g.rotateX(-Math.PI / 2);
  return g;
}

export type Plot = { x: number; z: number; trees: TreeSpot[]; shrubs: ShrubSpot[] };

/** Ground, yard surface, paths with kerbs, driveway, fence and the spots where trees and shrubs will grow. */
export function addGround(kit: Kit, group: THREE.Group): Plot {
  const { d } = kit, L = d.length, W = d.width, x = d.extras, winter = d.season === 'winter';
  const px = L / 2 + 6.5 + (x.garage ? 3.8 : 0), pz = W / 2 + 7;
  const snow = kit.std({ tex: 'snow', color: '#f2f5f7', rough: 0.9 });
  const field = mesh(planeM(320, 320), winter ? snow : kit.std({ set: 'lawn', color: d.season === 'autumn' ? '#e0d4a0' : '#ffffff' }), undefined, false);
  group.add(field);
  if (!winter && d.ground !== 'lawn') {   // the chosen yard surface inside the plot
    const yard = mesh(planeM(2 * px, 2 * pz), kit.std({ set: d.ground, color: '#ffffff' }), undefined, false); yard.position.y = 0.012; group.add(yard);
  }
  const pave = winter ? snow : kit.std({ set: d.ground === 'paving' ? 'granite' : 'paving', color: '#ffffff' });
  const kerb = kit.std({ set: 'concrete', color: '#e6e3dc' });
  const start = W / 2 + (x.porch ? 1.95 : 0.6), plen = pz - start;
  const path = mesh(boxM(1.4, 0.05, plen), pave); path.position.set(0, 0.025, start + plen / 2); group.add(path);
  for (const s of [-1, 1]) { const k = mesh(boxM(0.08, 0.1, plen), kerb); k.position.set(s * 0.74, 0.05, start + plen / 2); group.add(k); }
  const apron = mesh(boxM(L + 1.4, 0.04, 0.6), pave); apron.position.set(0, 0.02, W / 2 + 0.36); if (!x.porch) group.add(apron);   // blind area along the front
  if (x.garage) {
    const dl = pz - W / 2, dw = mesh(boxM(3.2, 0.045, dl), winter ? snow : kit.std({ set: 'granite', color: '#ffffff' })); dw.position.set(L / 2 + 1.9, 0.022, W / 2 + dl / 2); group.add(dw);
    for (const s of [-1, 1]) { const k = mesh(boxM(0.08, 0.1, dl), kerb); k.position.set(L / 2 + 1.9 + s * 1.64, 0.05, W / 2 + dl / 2); group.add(k); }
  }
  for (const s of [-1, 1]) {   // path bollards
    const b = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 16), kit.frame); b.position.set(s * 1.0, 0.25, start + plen * 0.55); group.add(b);
    const h = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.08, 16), kit.lamp, undefined, false); h.position.set(s * 1.0, 0.52, start + plen * 0.55); group.add(h);
  }
  if (x.fence) {
    const wood = kit.std({ set: 'decking', color: '#ffffff', rough: 0.8 }), postM = kit.std({ color: '#2f3134', rough: 0.4, metal: 0.6 });
    const postG = boxM(0.08, 1.6, 0.08), gaps: [number, number][] = [[-1.2, 1.2]];
    if (x.garage) gaps.push([L / 2 + 1.9 - 1.9, L / 2 + 1.9 + 1.9]);
    const run = (a: THREE.Vector3, b: THREE.Vector3) => {
      const len = a.distanceTo(b); if (len < 0.3) return;
      const n = Math.max(1, Math.round(len / 2.4)), dir = new THREE.Vector3().subVectors(b, a);
      for (let i = 0; i <= n; i++) { const m = mesh(postG, postM); m.position.copy(a).addScaledVector(dir, i / n).setY(0.8); group.add(m); }
      for (let k = 0; k < 6; k++) {   // horizontal planks with gaps: a modern slatted fence
        const r = mesh(boxM(len, 0.12, 0.025), wood); r.position.copy(a).add(b).multiplyScalar(0.5).setY(0.22 + k * 0.23); r.rotation.y = -Math.atan2(dir.z, dir.x); group.add(r);
      }
    };
    run(new THREE.Vector3(-px, 0, -pz), new THREE.Vector3(px, 0, -pz));
    run(new THREE.Vector3(-px, 0, -pz), new THREE.Vector3(-px, 0, pz));
    run(new THREE.Vector3(px, 0, -pz), new THREE.Vector3(px, 0, pz));
    let cur = -px;
    for (const [a, b] of gaps.sort((u, v) => u[0] - v[0])) { run(new THREE.Vector3(cur, 0, pz), new THREE.Vector3(a, 0, pz)); cur = b; }
    run(new THREE.Vector3(cur, 0, pz), new THREE.Vector3(px, 0, pz));
  }
  const trees: TreeSpot[] = [], shrubs: ShrubSpot[] = [];
  if (x.trees) {
    trees.push({ x: -px + 2.6, z: pz - 2.8, h: 8.5, kind: 'oak' }, { x: px - 2.6, z: -pz + 2.5, h: 9.5, kind: 'ash' },
      { x: -px + 2.8, z: -pz + 2.8, h: 10, kind: 'pine' }, { x: px - 2.4, z: -pz * 0.1, h: 7.5, kind: 'aspen' },
      { x: -px - 7, z: -pz - 6, h: 12, kind: 'pine' }, { x: px + 8, z: -pz - 4, h: 11, kind: 'oak' }, { x: -px - 9, z: pz - 3, h: 9, kind: 'aspen' }, { x: px + 6, z: pz + 9, h: 10, kind: 'ash' });
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) shrubs.push({ x: sx * (2.2 + i * 1.3), z: W / 2 + 0.9, s: 0.8 + (i % 2) * 0.25 });
    for (let i = 0; i < 6; i++) shrubs.push({ x: -px + 1 + i * 0.1, z: -pz + 4 + i * 2.1, s: 1 + (i % 3) * 0.2 });
  }
  return { x: px, z: pz, trees, shrubs };
}
