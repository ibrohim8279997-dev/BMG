import * as THREE from 'three';
import type { Design } from './design';
import { applySet } from './materials/loader';
import { hasSet } from './materials/registry';
import { T, type DoorCut, type Hole } from './openings';
import { texture, TexKind } from './textures';

export { T, type DoorCut, type Hole };

export type Zone = 'walls' | 'floor' | 'ceiling' | 'roof';
export const PLINTH = 0.45;   // height of the base under the walls (m)

/** Height of the roof surface above the wall top at plan position (x, z) (used to seat chimney and panels). */
export function roofY(d: Design, z: number) {
  const tan = Math.tan((d.roofPitch * Math.PI) / 180);
  if (d.roofType === 'flat') return 0.22;
  if (d.roofType === 'mono') return (d.width / 2 - z) * tan;
  return Math.max(0, d.width / 2 - Math.abs(z)) * tan;
}

type Std = THREE.MeshStandardMaterial;
export type MatOpts = {
  set?: string; tex?: TexKind; color: string; rough?: number; metal?: number; bump?: number; normal?: number;
  clearcoat?: number; sheen?: number; side?: THREE.Side;
};

/** Materials shared by one house build. Zone materials are the ones the calculator zones refer to (walls / floor / ceiling / roof). */
export type Kit = {
  d: Design; wall: Std; paint: Std; reveal: Std; roof: Std; floor: Std; ceil: Std;
  trim: Std; door: Std; frame: Std; plinth: Std; metal: Std; sill: Std;
  glass: THREE.MeshPhysicalMaterial; glassLit: THREE.MeshPhysicalMaterial; glassDim: THREE.MeshPhysicalMaterial; lamp: Std;
  zoneMats: Record<Zone, Std[]>; all: THREE.Material[];
  std: (o: MatOpts) => Std;
};

export function makeKit(d: Design): Kit {
  const all: THREE.Material[] = [];
  const std = (o: MatOpts): Std => {
    const phys = o.clearcoat !== undefined || o.sheen !== undefined;
    const m = phys
      ? new THREE.MeshPhysicalMaterial({ color: o.color, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0, clearcoat: o.clearcoat ?? 0, clearcoatRoughness: 0.18, sheen: o.sheen ?? 0, sheenRoughness: 0.6 })
      : new THREE.MeshStandardMaterial({ color: o.color, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0 });
    if (o.side !== undefined) m.side = o.side;
    if (o.set && hasSet(o.set)) applySet(m, { set: o.set, color: o.color, normal: o.normal, rough: o.rough, metal: o.metal });
    else if (o.tex) { const t = texture(o.tex); m.map = t.map; m.bumpMap = t.bump; m.bumpScale = o.bump ?? 0.9; }
    all.push(m);
    return m;
  };
  const winter = d.season === 'winter';
  const wall = std({ set: d.wall, color: d.wallColor, normal: d.wall === 'lamb' || d.wall === 'bark' ? 1.4 : 1 });
  const roofMetal = d.roofMat === 'metal' || d.roofMat === 'seam';
  const roof = std({ set: d.roofMat, color: d.roofColor, side: THREE.DoubleSide, ...(roofMetal ? { clearcoat: 0.35 } : {}) });
  if (winter && d.roofMat !== 'green') roof.color.lerp(new THREE.Color('#f4f7f9'), 0.82);   // snow on the roof
  const paint = std({ set: 'lamb', color: d.paint, normal: 0.12, rough: 0.92 });
  const reveal = std({ set: 'lamb', color: d.trimColor, normal: 0.5 });
  const floor = std({ set: 'concrete', color: '#d8d4cc' }), ceil = std({ set: 'lamb', color: '#f4f3f0', normal: 0.08 });
  const trim = std({ set: 'lamb', color: d.trimColor, normal: 0.4, rough: 0.8 });
  const plinth = std({ set: d.wall === 'stone' ? 'stone' : 'concrete', color: d.wall === 'stone' ? '#ffffff' : '#d9d6d0' });
  const door = std({ set: d.doorColor === '#f3f0ea' ? undefined : 'walnut', color: lighten(d.doorColor), rough: 0.5, clearcoat: 0.6 });
  const frame = d.frameMat === 'alu'
    ? std({ color: d.frameColor, rough: 0.32, metal: 0.85 })
    : d.frameMat === 'pvc_wood' ? std({ set: 'walnut', color: lighten(d.frameColor), rough: 0.45, clearcoat: 0.3 })
      : std({ color: d.frameColor, rough: 0.38 });
  const metal = std({ color: d.roofColor, rough: 0.35, metal: 0.7 });          // gutters, flashing: match the roof
  const sill = std({ color: d.frameColor, rough: 0.3, metal: 0.6 });           // pressed-metal outer window sills
  const glass = new THREE.MeshPhysicalMaterial({ color: '#c9d6dc', roughness: 0.02, metalness: 0, transparent: true, opacity: 0.22, ior: 1.52, specularIntensity: 1, envMapIntensity: 1.6, depthWrite: false });
  // the same glass, but its pane glows warm at night as if a room light were on behind it
  const glassLit = glass.clone(); glassLit.emissive.set('#ffc27a'); glassLit.emissiveIntensity = 0;
  const glassDim = glass.clone(); glassDim.emissive.set('#ffc27a'); glassDim.emissiveIntensity = 0;
  const lamp = new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: new THREE.Color('#ffd58f'), emissiveIntensity: 0 });
  all.push(glass, glassLit, glassDim, lamp);
  return { d, wall, paint, reveal, roof, floor, ceil, trim, door, frame, plinth, metal, sill, glass, glassLit, glassDim, lamp, std, all,
    zoneMats: { walls: [wall], roof: [roof], floor: [floor], ceiling: [ceil] } };
}

/** Wood textures are mid-brown already: the picked colour tints them instead of multiplying them darker. */
function lighten(hex: string) { return '#' + new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), 0.45).getHexString(); }

/** Mesh with shadows on; `zone` makes it clickable in the viewer. */
export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], zone?: Zone, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast; m.receiveShadow = true;
  if (zone) m.userData.zone = zone;
  return m;
}

/** Flat polygon (fan-triangulated) with UVs in metres measured along `uDir` and up the slope, so roof textures keep their real size. */
export function polyFace(pts: THREE.Vector3[], uDir: THREE.Vector3) {
  const n = new THREE.Vector3().subVectors(pts[1], pts[0]).cross(new THREE.Vector3().subVectors(pts[2], pts[0])).normalize();
  const u = uDir.clone().normalize(), v = new THREE.Vector3().crossVectors(n, u).normalize();
  if (v.y < 0) v.negate();
  const pos: number[] = [], uv: number[] = [];
  const push = (p: THREE.Vector3) => { const r = new THREE.Vector3().subVectors(p, pts[0]); pos.push(p.x, p.y, p.z); uv.push(r.dot(u), r.dot(v)); };
  for (let i = 1; i < pts.length - 1; i++) { push(pts[0]); push(pts[i]); push(pts[i + 1]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}


/** Wall panel in local metres: x along the wall (centred), y up, z = thickness (outer face at z = t, inner at z = 0).
 *  Material groups: 0 = outer face, 1 = inner face, 2 = edges and window/door reveals. */
export function wallGeo(len: number, h: number, holes: Hole[], t: number, door?: DoorCut) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  if (door) { s.lineTo(door.x - door.w / 2, 0); s.lineTo(door.x - door.w / 2, door.h); s.lineTo(door.x + door.w / 2, door.h); s.lineTo(door.x + door.w / 2, 0); }
  s.lineTo(len, 0); s.lineTo(len, h); s.lineTo(0, h); s.lineTo(0, 0);
  for (const o of holes) { const p = new THREE.Path(); p.moveTo(o.x - o.w / 2, o.y); p.lineTo(o.x + o.w / 2, o.y); p.lineTo(o.x + o.w / 2, o.y + o.h); p.lineTo(o.x - o.w / 2, o.y + o.h); p.lineTo(o.x - o.w / 2, o.y); s.holes.push(p); }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
  g.translate(-len / 2, 0, 0);
  return splitFaces(g, t);
}

/** Re-groups an extruded slab's triangles by which face they lie on (outer z = t, inner z = 0, the rest). */
function splitFaces(g: THREE.BufferGeometry, t: number) {
  const src = g.index ? g.toNonIndexed() : g;
  const pos = src.getAttribute('position'), uv = src.getAttribute('uv'), nrm = src.getAttribute('normal');
  const buckets: number[][] = [[], [], []];
  for (let tri = 0; tri < pos.count / 3; tri++) {
    let zs = 0; for (let k = 0; k < 3; k++) zs += pos.getZ(tri * 3 + k);
    const z = zs / 3, nz = nrm.getZ(tri * 3);
    buckets[Math.abs(nz) > 0.99 && Math.abs(z - t) < 1e-4 ? 0 : Math.abs(nz) > 0.99 && Math.abs(z) < 1e-4 ? 1 : 2].push(tri);
  }
  const out = new THREE.BufferGeometry(), P: number[] = [], U: number[] = [], N: number[] = [];
  let start = 0;
  buckets.forEach((list, gi) => {
    for (const tri of list) for (let k = 0; k < 3; k++) {
      const i = tri * 3 + k;
      P.push(pos.getX(i), pos.getY(i), pos.getZ(i)); N.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i)); U.push(uv.getX(i), uv.getY(i));
    }
    out.addGroup(start, list.length * 3, gi); start += list.length * 3;
  });
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); out.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.dispose(); if (src !== g) src.dispose();
  return out;
}

/** Extruded outline in the same local frame as wallGeo (for gable ends and mono-pitch fills). */
export function outlineGeo(pts: [number, number][], t: number) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  return splitFaces(new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false }), t);
}

export function disposeObject(o: THREE.Object3D) {
  // meshes flagged `shared` borrow geometry from the model cache (gltf.ts), which frees it itself
  o.traverse((c) => { const m = c as THREE.Mesh; if (m.geometry && !m.userData.shared) m.geometry.dispose(); });
}
