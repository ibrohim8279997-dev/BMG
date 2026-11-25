import * as THREE from 'three';
import { Kit, PLINTH, mesh } from './kit';
import { boxM } from './textures';

/** Facade details that sell the scale: fascia boards, ridge cap, verge trims, gutters and downpipes, parapet copings. */
export function addDetails(kit: Kit, group: THREE.Group, roof: THREE.Group) {
  const { d } = kit, L = d.length, W = d.width, o = 0.45;
  const p = (d.roofPitch * Math.PI) / 180, tan = Math.tan(p), ye = -o * tan, hl = L / 2 + o, hw = W / 2 + o;
  const wallTop = PLINTH + d.floors * d.floorHeight;
  const gutterG = new THREE.CylinderGeometry(0.07, 0.07, 1, 14, 1, true, 0, Math.PI);
  const gutter = (len: number, x: number, z: number, alongX: boolean) => {
    const m = mesh(gutterG, kit.metal); m.scale.y = len; m.rotation.z = -Math.PI / 2;   // open half-pipe, trough facing up
    const holder = new THREE.Group(); holder.add(m); holder.rotation.y = alongX ? 0 : Math.PI / 2;
    holder.position.set(x, ye - 0.07, z); roof.add(holder);
  };
  const fascia = (len: number, x: number, z: number, alongX: boolean) => {
    const f = mesh(boxM(alongX ? len : 0.035, 0.2, alongX ? 0.035 : len), kit.trim); f.position.set(x, ye - 0.04, z); roof.add(f);
  };
  // downpipes live in their own group: the cutaway view hides them with the roof
  let pipes = group.getObjectByName('cutHide') as THREE.Group | undefined;
  if (!pipes) { pipes = new THREE.Group(); pipes.name = 'cutHide'; pipes.userData.keep = true; group.add(pipes); }
  const pg = pipes;
  const pipe = (x: number, z: number) => {
    const h = wallTop + ye - 0.1, m = mesh(new THREE.CylinderGeometry(0.045, 0.045, h, 12), kit.metal);
    m.position.set(x, h / 2, z); pg.add(m);
    const elbow = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 12), kit.metal); elbow.rotation.x = Math.PI / 2;
    elbow.position.set(x, 0.12, z + Math.sign(z) * 0.12); pg.add(elbow);
    for (let y = 1; y < h - 0.3; y += 1.6) { const c = mesh(boxM(0.11, 0.03, 0.11), kit.metal); c.position.set(x, y, z); pg.add(c); }   // brackets
  };
  const pipeZ = (s: number) => s * (W / 2 + 0.09);

  if (d.roofType === 'flat') {
    for (const [w, dd, x, z] of [[L + 0.42, 0.32, 0, W / 2 + 0.06], [L + 0.42, 0.32, 0, -W / 2 - 0.06], [0.32, W + 0.42, L / 2 + 0.06, 0], [0.32, W + 0.42, -L / 2 - 0.06, 0]]) {
      const cap = mesh(boxM(w, 0.04, dd), kit.metal); cap.position.set(x, 0.69, z); roof.add(cap);
    }
    pipe(-L / 2 + 0.25, pipeZ(1)); pipe(L / 2 - 0.25, pipeZ(-1));
    return;
  }
  // eaves: fascia + gutter on the low edges, downpipes at the corners
  const eaves: number[] = d.roofType === 'mono' ? [1] : [1, -1];
  for (const s of eaves) { fascia(2 * hl, 0, s * hw, true); gutter(2 * hl, 0, s * (hw + 0.05), true); pipe(-L / 2 - 0.1, pipeZ(s)); pipe(L / 2 + 0.1, pipeZ(s)); }
  if (d.roofType === 'hip') for (const s of [1, -1]) { fascia(2 * hw, s * hl, 0, false); gutter(2 * hw, s * (hl + 0.05), 0, false); }

  const r = (W / 2) * tan;
  if (d.roofType === 'gable' || d.roofType === 'hip') {
    const lr = d.roofType === 'hip' ? Math.max(0.01, L - W) / 2 : hl;
    const ridge = mesh(new THREE.CylinderGeometry(0.11, 0.11, 2 * lr + 0.05, 16, 1, false, 0, Math.PI), kit.metal);
    ridge.rotation.z = Math.PI / 2; ridge.position.set(0, r + 0.01, 0); roof.add(ridge);
  }
  // verge trims along the sloped gable edges
  const verge = (x: number, z0: number, y0: number, z1: number, y1: number) => {
    const len = Math.hypot(z1 - z0, y1 - y0), v = mesh(boxM(0.04, 0.22, len), kit.metal);
    v.position.set(x, (y0 + y1) / 2 - 0.05, (z0 + z1) / 2); v.rotation.x = Math.atan2(-(y1 - y0), z1 - z0); roof.add(v);
    const cap = mesh(boxM(0.1, 0.03, len), kit.metal); cap.position.set(x, (y0 + y1) / 2 + 0.06, (z0 + z1) / 2); cap.rotation.x = v.rotation.x; roof.add(cap);
  };
  if (d.roofType === 'gable') for (const sx of [-1, 1]) { verge(sx * hl, hw, ye, 0, r); verge(sx * hl, -hw, ye, 0, r); }
  if (d.roofType === 'mono') { const top = (W + o) * tan; for (const sx of [-1, 1]) verge(sx * hl, hw, ye, -hw, top); }
}
