import * as THREE from 'three';
import type { Design } from './design';
import { addDetails } from './details';
import { addExtras, addGround } from './extras';
import { DoorCut, Hole, Kit, PLINTH, T, Zone, disposeObject, makeKit, mesh, outlineGeo, polyFace, wallGeo } from './kit';
import { planHouse, type Rect } from './interior/plan';
import { mergeStatic } from './merge';
import { Side, wallLayout } from './openings';
import { boxM } from './textures';
import type { ShrubSpot, TreeSpot } from './vegetation';

export { PLINTH, roofY } from './kit';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export type Built = {
  group: THREE.Group; kit: Kit; floorGroups: THREE.Group[]; roofGroup: THREE.Group; lamps: THREE.PointLight[];
  /** Exterior wall groups per storey, so the cutaway view can hide the ones facing the camera. */
  walls: { group: THREE.Group; side: Side; floor: number }[];
  radius: number; top: number; plotX: number; plotZ: number; trees: TreeSpot[]; shrubs: ShrubSpot[]; dispose: () => void;
};

const FW = 0.068, FD = 0.075;   // window frame profile width and depth (m)

/** Windows with real frame depth, mullions on wide openings, inner window board and a pressed-metal outer sill. */
function addWindows(kit: Kit, g: THREE.Group, holes: Hole[], len: number, seed: number) {
  const { frame, glassLit, glassDim, sill } = kit, zf = T * 0.62;
  holes.forEach((o, i) => {
    const x = o.x - len / 2, cy = o.y + o.h / 2, lit = Math.abs(Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453) % 1 > 0.35;   // ~65 % glow at night
    const glass = mesh(new THREE.PlaneGeometry(o.w - FW, o.h - FW), lit ? glassLit : glassDim, undefined, false);
    glass.position.set(x, cy, zf); glass.renderOrder = 2; g.add(glass);
    const bars: number[][] = [[o.w, FW, 0, o.h / 2 - FW / 2], [o.w, FW, 0, -o.h / 2 + FW / 2], [FW, o.h, o.w / 2 - FW / 2, 0], [FW, o.h, -o.w / 2 + FW / 2, 0]];
    if (o.w > 0.95) bars.push([FW * 0.9, o.h - 2 * FW, 0, 0]);                  // mullion: two sashes
    if (o.h > 1.6) bars.push([o.w - 2 * FW, FW * 0.8, 0, o.h / 2 - o.h * 0.28]);   // transom light on tall windows
    for (const [w, h, px, py] of bars) { const b = mesh(boxM(w, h, FD), frame); b.position.set(x + px, cy + py, zf); g.add(b); }
    const out = mesh(boxM(o.w + 0.06, 0.025, 0.16), sill); out.position.set(x, o.y - 0.012, T + 0.05); out.rotation.x = 0.08; g.add(out);
    const board = mesh(boxM(o.w + 0.12, 0.03, 0.24), kit.trim); board.position.set(x, o.y - 0.015, 0.06); g.add(board);
    if (kit.d.extras.shutters) for (const s of [-1, 1]) { const sh = mesh(boxM(o.w / 2 + 0.04, o.h + 0.12, 0.04), kit.door); sh.position.set(x + s * (o.w / 2 + o.w / 4 + 0.08), cy, T + 0.03); g.add(sh); }
  });
}

function addDoor(kit: Kit, g: THREE.Group, door: DoorCut, len: number) {
  const x = door.x - len / 2;
  // the leaf hangs on a hinge at its left edge: walk mode swings it open
  const hinge = new THREE.Group(); hinge.name = 'frontDoor'; hinge.userData.keep = true; hinge.position.set(x - door.w / 2 + 0.05, 0, T * 0.55 - 0.03); g.add(hinge);
  const leaf = mesh(boxM(door.w - 0.1, door.h - 0.06, 0.06), kit.door); leaf.position.set(door.w / 2 - 0.05, door.h / 2 - 0.01, 0.03); hinge.add(leaf);
  for (const [w, h, px, py] of [[door.w, 0.06, 0, door.h - 0.03], [0.06, door.h, -door.w / 2 + 0.03, door.h / 2], [0.06, door.h, door.w / 2 - 0.03, door.h / 2]]) {
    const f = mesh(boxM(w, h, 0.1), kit.frame); f.position.set(x + px, py, T * 0.55); g.add(f);
  }
  const hnd = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 10), kit.sill); hnd.position.set(door.w - 0.21, 1.1, 0.11); hinge.add(hnd);
  const lite = mesh(new THREE.PlaneGeometry(0.16, door.h * 0.62), kit.glassDim, undefined, false); lite.position.set(0.15, door.h * 0.5, 0.061); hinge.add(lite);
}

/** One storey: four walls with openings, glazing, and the floor slab. */
function storey(kit: Kit, f: number, walls: Built['walls'], hole?: Rect): THREE.Group {
  const { d } = kit, h = d.floorHeight, L = d.length, W = d.width, g = new THREE.Group();
  g.add(mesh(slabGeo(L - 0.5, W - 0.5, hole), kit.floor, 'floor'));
  const mats = [kit.wall, kit.paint, kit.reveal];
  const place = (side: Side, len: number, long: boolean, rot: number, x: number, z: number) => {
    const lay = wallLayout(len, h, long, side === 'front' && f === 0), gr = new THREE.Group();
    gr.add(mesh(wallGeo(len, h, lay.holes, T, lay.door), mats, 'walls'));
    addWindows(kit, gr, lay.holes, len, f * 7 + side.length); if (lay.door) addDoor(kit, gr, lay.door, len);
    gr.rotation.y = rot; gr.position.set(x, 0, z); gr.userData.keep = true; g.add(gr); walls.push({ group: gr, side, floor: f });
  };
  place('front', L, true, 0, 0, W / 2 - T);
  place('back', L, true, Math.PI, 0, -W / 2 + T);
  place('right', W - 2 * T, false, Math.PI / 2, L / 2 - T, 0);
  place('left', W - 2 * T, false, -Math.PI / 2, -L / 2 + T, 0);
  return g;
}

/** Floor slab 0.2 m thick (top at y = 0.2), with the stairwell cut out when a flight comes up through it. */
function slabGeo(w: number, l: number, hole?: Rect) {
  if (!hole) { const g = boxM(w, 0.2, l); g.translate(0, 0.1, 0); return g; }
  const s = new THREE.Shape([new THREE.Vector2(-w / 2, -l / 2), new THREE.Vector2(w / 2, -l / 2), new THREE.Vector2(w / 2, l / 2), new THREE.Vector2(-w / 2, l / 2)]);
  s.holes.push(new THREE.Path([new THREE.Vector2(hole.x0, hole.z0), new THREE.Vector2(hole.x0, hole.z1), new THREE.Vector2(hole.x1, hole.z1), new THREE.Vector2(hole.x1, hole.z0)]));
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: false });
  g.rotateX(Math.PI / 2); g.translate(0, 0.2, 0);   // shape y → +z, extruded downward from y = 0.2 to 0
  return g;
}

/** Roof geometry for the four shapes. Returns the group (y = 0 is the top of the walls). */
function roofGroup(kit: Kit): THREE.Group {
  const { d } = kit, L = d.length, W = d.width, o = 0.45, g = new THREE.Group();
  const p = (d.roofPitch * Math.PI) / 180, tan = Math.tan(p), ye = -o * tan, hw = W / 2 + o, hl = L / 2 + o, X = V(1, 0, 0);
  const ceil = mesh(boxM(L - 0.5, 0.2, W - 0.5), kit.ceil, 'ceiling'); ceil.position.y = -0.1; g.add(ceil);
  const roofFace = (pts: THREE.Vector3[], u: THREE.Vector3) => g.add(mesh(polyFace(pts, u), kit.roof, 'roof'));
  const mats = [kit.wall, kit.paint, kit.reveal];
  // gable infill sits 8 cm under the roof plane so its top edge never shows through the roof
  const sideFill = (pts: [number, number][], mirror = false) => {
    for (const s of [1, -1]) {
      const gr = new THREE.Group(), m = mesh(outlineGeo(pts.map(([x, y]) => [mirror && s < 0 ? -x : x, y > 0 ? Math.max(0, y - 0.08) : y] as [number, number]), T), mats, 'walls');
      gr.add(m); gr.rotation.y = (s * Math.PI) / 2; gr.position.x = s * (L / 2 - T); g.add(gr);
    }
  };
  if (d.roofType === 'gable') {
    const r = (W / 2) * tan;
    roofFace([V(-hl, ye, hw), V(hl, ye, hw), V(hl, r, 0), V(-hl, r, 0)], X);
    roofFace([V(hl, ye, -hw), V(-hl, ye, -hw), V(-hl, r, 0), V(hl, r, 0)], X.clone().negate());
    sideFill([[-W / 2, 0], [W / 2, 0], [0, r]]);
  } else if (d.roofType === 'hip') {
    const r = (W / 2) * tan, lr = Math.max(0.01, L - W) / 2;
    roofFace([V(-hl, ye, hw), V(hl, ye, hw), V(lr, r, 0), V(-lr, r, 0)], X);
    roofFace([V(hl, ye, -hw), V(-hl, ye, -hw), V(-lr, r, 0), V(lr, r, 0)], X.clone().negate());
    roofFace([V(hl, ye, hw), V(hl, ye, -hw), V(lr, r, 0)], V(0, 0, -1));
    roofFace([V(-hl, ye, -hw), V(-hl, ye, hw), V(-lr, r, 0)], V(0, 0, 1));
  } else if (d.roofType === 'mono') {
    const rise = W * tan, top = (W + o) * tan;
    roofFace([V(-hl, ye, hw), V(hl, ye, hw), V(hl, top, -hw), V(-hl, top, -hw)], X);
    const back = mesh(boxM(L, rise, T), mats[0], 'walls'); back.position.set(0, rise / 2, -W / 2 + T / 2); g.add(back);
    sideFill([[-W / 2, 0], [W / 2, 0], [W / 2, rise]], true);   // high side is at the back on both ends
  } else {
    const slab = mesh(boxM(L + 0.3, 0.22, W + 0.3), kit.roof, 'roof'); slab.position.y = 0.11; g.add(slab);
    for (const [w, dd, x, z] of [[L + 0.3, 0.18, 0, W / 2 + 0.06], [L + 0.3, 0.18, 0, -W / 2 - 0.06], [0.18, W + 0.3, L / 2 + 0.06, 0], [0.18, W + 0.3, -L / 2 - 0.06, 0]]) {
      const par = mesh(boxM(w, 0.45, dd), kit.wall); par.position.set(x, 0.22 + 0.22, z); g.add(par);
    }
  }
  return g;
}

export function buildHouse(d: Design): Built {
  const kit = makeKit(d), group = new THREE.Group(), L = d.length, W = d.width, walls: Built['walls'] = [];
  const plinth = mesh(boxM(L + 0.12, PLINTH, W + 0.12), kit.plinth); plinth.position.y = PLINTH / 2; group.add(plinth);
  const floorGroups: THREE.Group[] = [];
  const plans = planHouse(d);
  for (let f = 0; f < d.floors; f++) { const s = storey(kit, f, walls, plans[f]?.hole); s.position.y = PLINTH + f * d.floorHeight; floorGroups.push(s); group.add(s); }
  const roof = roofGroup(kit); roof.position.y = PLINTH + d.floors * d.floorHeight; group.add(roof);
  addDetails(kit, group, roof);
  const lamps = addExtras(kit, group, floorGroups, roof);
  const plot = addGround(kit, group);
  // one draw call per material and scope (scopes = parts that move or hide on their own)
  for (const w of walls) mergeStatic(w.group);
  for (const s of floorGroups) { s.userData.keep = true; mergeStatic(s); }
  roof.userData.keep = true; mergeStatic(roof); mergeStatic(group);
  for (const n of ['porchTop', 'cutHide']) { const o = group.getObjectByName(n); if (o) mergeStatic(o); }
  const top = PLINTH + d.floors * d.floorHeight + (d.roofType === 'flat' ? 0.7 : (W / 2) * Math.tan((d.roofPitch * Math.PI) / 180));
  return { group, kit, floorGroups, roofGroup: roof, lamps, walls, radius: Math.max(plot.x, plot.z) + 4, top, plotX: plot.x, plotZ: plot.z, trees: plot.trees, shrubs: plot.shrubs,
    dispose: () => { disposeObject(group); kit.all.forEach((m) => { m.userData.disposed = true; m.dispose(); }); } };
}

export type { Zone };
