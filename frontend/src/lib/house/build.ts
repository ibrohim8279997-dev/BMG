import * as THREE from 'three';
import type { Design } from './design';
import { addExtras, addGround } from './extras';
import { Kit, PLINTH, Zone, disposeObject, makeKit, mesh, outlineGeo, polyFace, wallGeo } from './kit';

export { PLINTH, roofY } from './kit';
import { boxM } from './textures';

const T = 0.3;              // wall thickness
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export type Built = {
  group: THREE.Group; kit: Kit; floorGroups: THREE.Group[]; roofGroup: THREE.Group; lamps: THREE.PointLight[];
  radius: number; top: number; plotX: number; plotZ: number; dispose: () => void;
};

/** Window / door layout of one wall: returns hole rectangles in the wall's local metres. */
function layout(len: number, h: number, front: boolean, ground: boolean) {
  const slots = front ? Math.max(3, Math.round(len / 2.6) | 1) : Math.max(1, Math.round(len / 2.9));
  const slotW = len / slots, ww = Math.min(1.35, slotW * 0.56), wh = Math.min(1.35, h * 0.5), sill = Math.max(0.7, Math.min(0.95, h - wh - 0.5));
  const holes: { x: number; y: number; w: number; h: number }[] = [];
  let door: { x: number; w: number; h: number } | undefined;
  for (let i = 0; i < slots; i++) {
    const x = slotW * (i + 0.5);
    if (front && ground && i === (slots - 1) / 2) { door = { x, w: 1.1, h: Math.min(2.15, h - 0.3) }; continue; }
    holes.push({ x, y: sill, w: ww, h: wh });
  }
  return { holes, door };
}

function addWindows(kit: Kit, g: THREE.Group, holes: ReturnType<typeof layout>['holes'], len: number, seed: number) {
  const { frame, glassLit, glassDim, trim } = kit;
  holes.forEach((o, i) => {
    const x = o.x - len / 2, lit = Math.abs(Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453) % 1 > 0.35;   // ~65 % of windows glow at night
    const glass = mesh(new THREE.PlaneGeometry(o.w, o.h), lit ? glassLit : glassDim, undefined, false);
    glass.position.set(x, o.y + o.h / 2, T * 0.55); g.add(glass);
    const fw = 0.06;
    for (const [w, h, px, py] of [[o.w + fw * 2, fw, 0, o.h / 2 + fw / 2], [o.w + fw * 2, fw, 0, -o.h / 2 - fw / 2], [fw, o.h, o.w / 2 + fw / 2, 0], [fw, o.h, -o.w / 2 - fw / 2, 0], [0.04, o.h, 0, 0], [o.w, 0.04, 0, 0]] as number[][]) {
      const b = mesh(boxM(w, h, 0.09), frame); b.position.set(x + px, o.y + o.h / 2 + py, T - 0.02); g.add(b);
    }
    const sill = mesh(boxM(o.w + 0.3, 0.06, 0.16), trim); sill.position.set(x, o.y - 0.04, T + 0.04); g.add(sill);
    if (kit.d.extras.shutters) for (const s of [-1, 1]) { const sh = mesh(boxM(o.w / 2 + 0.04, o.h + 0.12, 0.05), kit.door); sh.position.set(x + s * (o.w / 2 + o.w / 4 + 0.08), o.y + o.h / 2, T + 0.04); g.add(sh); }
  });
}

function addDoor(kit: Kit, g: THREE.Group, door: { x: number; w: number; h: number }, len: number) {
  const leaf = mesh(boxM(door.w - 0.04, door.h - 0.03, 0.07), kit.door); leaf.position.set(door.x - len / 2, door.h / 2, T * 0.6); g.add(leaf);
  const hnd = mesh(new THREE.BoxGeometry(0.03, 0.14, 0.04), kit.frame); hnd.position.set(door.x - len / 2 + door.w / 2 - 0.14, 1.0, T * 0.6 + 0.06); g.add(hnd);
  const top = mesh(boxM(door.w + 0.2, 0.08, 0.14), kit.trim); top.position.set(door.x - len / 2, door.h + 0.04, T + 0.02); g.add(top);
}

/** One storey: four walls with openings, glazing, and the floor slab. */
function storey(kit: Kit, f: number): THREE.Group {
  const { d } = kit, h = d.floorHeight, L = d.length, W = d.width, g = new THREE.Group();
  const slab = mesh(boxM(L - 0.5, 0.2, W - 0.5), kit.floor, 'floor'); slab.position.y = 0.1; g.add(slab);
  const walls: [number, number, number, number, boolean][] = [[0, W / 2 - T, L, 0, true], [Math.PI, -W / 2 + T, L, 0, false]];
  for (const [rot, z, len, , front] of walls) {
    const lay = layout(len, h, front, f === 0), gr = new THREE.Group();
    gr.add(mesh(wallGeo(len, h, lay.holes, T, lay.door), kit.wall, 'walls'));
    addWindows(kit, gr, lay.holes, len, f * 3 + (front ? 1 : 2)); if (lay.door) addDoor(kit, gr, lay.door, len);
    gr.rotation.y = rot; gr.position.set(0, 0, z); g.add(gr);
  }
  for (const [rot, x] of [[Math.PI / 2, L / 2 - T], [-Math.PI / 2, -L / 2 + T]]) {
    const len = W - 2 * T, lay = layout(len, h, false, false), gr = new THREE.Group();
    gr.add(mesh(wallGeo(len, h, lay.holes, T), kit.wall, 'walls')); addWindows(kit, gr, lay.holes, len, f * 5 + x);
    gr.rotation.y = rot; gr.position.set(x, 0, 0); g.add(gr);
  }
  return g;
}

/** Roof geometry for the four shapes. Returns the group (y = 0 is the top of the walls). */
function roofGroup(kit: Kit): THREE.Group {
  const { d } = kit, L = d.length, W = d.width, o = 0.45, g = new THREE.Group();
  const p = (d.roofPitch * Math.PI) / 180, tan = Math.tan(p), ye = -o * tan, hw = W / 2 + o, hl = L / 2 + o, X = V(1, 0, 0);
  const ceil = mesh(boxM(L - 0.5, 0.2, W - 0.5), kit.ceil, 'ceiling'); ceil.position.y = -0.1; g.add(ceil);
  const roofFace = (pts: THREE.Vector3[], u: THREE.Vector3) => g.add(mesh(polyFace(pts, u), kit.roof, 'roof'));
  const sideFill = (pts: [number, number][], mirror = false) => {
    for (const s of [1, -1]) {
      const gr = new THREE.Group(), m = mesh(outlineGeo(pts.map(([x, y]) => [mirror && s < 0 ? -x : x, y] as [number, number]), T), kit.wall, 'walls');
      gr.add(m); gr.rotation.y = (s * Math.PI) / 2; gr.position.x = s * (L / 2 - T); g.add(gr);
    }
  };
  if (d.roofType === 'gable') {
    const r = (W / 2) * tan;
    roofFace([V(-hl, ye, hw), V(hl, ye, hw), V(hl, r, 0), V(-hl, r, 0)], X);
    roofFace([V(hl, ye, -hw), V(-hl, ye, -hw), V(-hl, r, 0), V(hl, r, 0)], X.clone().negate());
    sideFill([[-W / 2, 0], [W / 2, 0], [0, r]]);
    const ridge = mesh(boxM(L + 2 * o, 0.12, 0.3), kit.trim); ridge.position.y = r + 0.02; g.add(ridge);
  } else if (d.roofType === 'hip') {
    const r = (W / 2) * tan, lr = Math.max(0.01, L - W) / 2;
    roofFace([V(-hl, ye, hw), V(hl, ye, hw), V(lr, r, 0), V(-lr, r, 0)], X);
    roofFace([V(hl, ye, -hw), V(-hl, ye, -hw), V(-lr, r, 0), V(lr, r, 0)], X.clone().negate());
    roofFace([V(hl, ye, hw), V(hl, ye, -hw), V(lr, r, 0)], V(0, 0, -1));
    roofFace([V(-hl, ye, -hw), V(-hl, ye, hw), V(-lr, r, 0)], V(0, 0, 1));
  } else if (d.roofType === 'mono') {
    const rise = W * tan, top = (W + o) * tan;
    roofFace([V(-hl, ye, hw), V(hl, ye, hw), V(hl, top, -hw), V(-hl, top, -hw)], X);
    const back = mesh(boxM(L, rise, T), kit.wall, 'walls'); back.position.set(0, rise / 2, -W / 2 + T / 2); g.add(back);
    sideFill([[-W / 2, 0], [W / 2, 0], [W / 2, rise]], true);   // high side is at the back on both ends
  } else {
    const slab = mesh(boxM(L + 0.3, 0.22, W + 0.3), kit.roof, 'roof'); slab.position.y = 0.11; g.add(slab);
    for (const [w, dd, x, z] of [[L + 0.3, 0.18, 0, W / 2 + 0.06], [L + 0.3, 0.18, 0, -W / 2 - 0.06], [0.18, W + 0.3, L / 2 + 0.06, 0], [0.18, W + 0.3, -L / 2 - 0.06, 0]]) {
      const par = mesh(boxM(w, 0.45, dd), kit.trim); par.position.set(x, 0.22 + 0.22, z); g.add(par);
    }
  }
  return g;
}

export function buildHouse(d: Design): Built {
  const kit = makeKit(d), group = new THREE.Group(), L = d.length, W = d.width;
  const plinth = mesh(boxM(L + 0.2, PLINTH, W + 0.2), kit.plinth); plinth.position.y = PLINTH / 2; group.add(plinth);
  const floorGroups: THREE.Group[] = [];
  for (let f = 0; f < d.floors; f++) { const s = storey(kit, f); s.position.y = PLINTH + f * d.floorHeight; floorGroups.push(s); group.add(s); }
  const roof = roofGroup(kit); roof.position.y = PLINTH + d.floors * d.floorHeight; group.add(roof);
  const lamps = addExtras(kit, group, floorGroups, roof);
  const plot = addGround(kit, group);
  const top = PLINTH + d.floors * d.floorHeight + (d.roofType === 'flat' ? 0.7 : (W / 2) * Math.tan((d.roofPitch * Math.PI) / 180));
  return { group, kit, floorGroups, roofGroup: roof, lamps, radius: Math.max(plot.x, plot.z) + 4, top, plotX: plot.x, plotZ: plot.z,
    dispose: () => { disposeObject(group); kit.all.forEach((m) => m.dispose()); } };
}

export type { Zone };
