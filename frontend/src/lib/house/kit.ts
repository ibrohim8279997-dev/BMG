import * as THREE from 'three';
import type { Design } from './design';
import { texture, TexKind } from './textures';

export type Zone = 'walls' | 'floor' | 'ceiling' | 'roof';
export const PLINTH = 0.45;   // height of the base under the walls (m)

/** Height of the roof surface above the wall top at plan position (x, z) (used to seat chimney and panels). */
export function roofY(d: Design, z: number) {
  const tan = Math.tan((d.roofPitch * Math.PI) / 180);
  if (d.roofType === 'flat') return 0.22;
  if (d.roofType === 'mono') return (d.width / 2 - z) * tan;
  return Math.max(0, d.width / 2 - Math.abs(z)) * tan;
}


/** Materials shared by one house build. Zone materials are the ones the calculator zones refer to (walls / floor / ceiling / roof). */
export type Kit = {
  d: Design; wall: THREE.MeshStandardMaterial; roof: THREE.MeshStandardMaterial; floor: THREE.MeshStandardMaterial; ceil: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial; door: THREE.MeshStandardMaterial; frame: THREE.MeshStandardMaterial; plinth: THREE.MeshStandardMaterial;
  glassLit: THREE.MeshStandardMaterial; glassDim: THREE.MeshStandardMaterial; lamp: THREE.MeshStandardMaterial;
  zoneMats: Record<Zone, THREE.MeshStandardMaterial[]>; all: THREE.Material[];
  std: (o: { tex?: TexKind; color: string; rough?: number; metal?: number; bump?: number }) => THREE.MeshStandardMaterial;
};

export function makeKit(d: Design): Kit {
  const all: THREE.Material[] = [];
  const std: Kit['std'] = ({ tex, color, rough = 0.85, metal = 0, bump = 0.9 }) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    if (tex) { const t = texture(tex); m.map = t.map; m.bumpMap = t.bump; m.bumpScale = bump; }
    all.push(m);
    return m;
  };
  const winter = d.season === 'winter';
  const wall = std({ tex: d.wall, color: d.wallColor, rough: d.wall === 'wood' ? 0.7 : 0.92, bump: d.wall === 'plaster' ? 0.4 : 1.4 });
  const roof = std({ tex: d.roofMat, color: d.roofColor, rough: d.roofMat === 'metal' || d.roofMat === 'seam' ? 0.45 : 0.85, metal: d.roofMat === 'metal' || d.roofMat === 'seam' ? 0.35 : 0, bump: 1.2 });
  roof.side = THREE.DoubleSide;
  if (winter && d.roofMat !== 'green') roof.color.lerp(new THREE.Color('#f4f7f9'), 0.82);   // snow on the roof
  const floor = std({ tex: 'concrete', color: '#c9c3b6' }), ceil = std({ tex: 'plaster', color: '#ece7dc' });
  const trim = std({ tex: 'concrete', color: d.trimColor, bump: 0.6 }), plinth = std({ tex: 'concrete', color: d.trimColor, bump: 1 });
  const door = std({ tex: 'door', color: d.doorColor, rough: 0.55 }), frame = std({ color: d.frameColor, rough: 0.5 });
  const glassOpts = { color: '#7c97ad', roughness: 0.06, metalness: 0.55, transparent: true, opacity: 0.8, emissive: new THREE.Color('#ffc978'), emissiveIntensity: 0 };
  const glassLit = new THREE.MeshStandardMaterial(glassOpts), glassDim = new THREE.MeshStandardMaterial({ ...glassOpts, emissive: new THREE.Color('#ffc978') });
  const lamp = new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: new THREE.Color('#ffd58f'), emissiveIntensity: 0 });
  all.push(glassLit, glassDim, lamp);
  return { d, wall, roof, floor, ceil, trim, door, frame, plinth, glassLit, glassDim, lamp, std, all,
    zoneMats: { walls: [wall], roof: [roof], floor: [floor], ceiling: [ceil] } };
}

/** Mesh with shadows on; `zone` makes it clickable in the viewer. */
export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, zone?: Zone, cast = true) {
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

/** Wall panel in local metres: x along the wall (centred), y up, z = thickness (front face at z = t). Holes are windows, an optional notch is the door. */
export function wallGeo(len: number, h: number, holes: { x: number; y: number; w: number; h: number }[], t: number, door?: { x: number; w: number; h: number }) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  if (door) { s.lineTo(door.x - door.w / 2, 0); s.lineTo(door.x - door.w / 2, door.h); s.lineTo(door.x + door.w / 2, door.h); s.lineTo(door.x + door.w / 2, 0); }
  s.lineTo(len, 0); s.lineTo(len, h); s.lineTo(0, h); s.lineTo(0, 0);
  for (const o of holes) { const p = new THREE.Path(); p.moveTo(o.x - o.w / 2, o.y); p.lineTo(o.x + o.w / 2, o.y); p.lineTo(o.x + o.w / 2, o.y + o.h); p.lineTo(o.x - o.w / 2, o.y + o.h); p.lineTo(o.x - o.w / 2, o.y); s.holes.push(p); }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
  g.translate(-len / 2, 0, 0);
  return g;
}

/** Extruded outline in the same local frame as wallGeo (for gable ends and mono-pitch fills). */
export function outlineGeo(pts: [number, number][], t: number) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
}

export function disposeObject(o: THREE.Object3D) {
  o.traverse((c) => { const m = c as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
}
