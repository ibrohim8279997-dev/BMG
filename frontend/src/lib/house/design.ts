/** Design state of the 3D house and the numbers derived from it. Pure data: no three.js here, so it also runs on the server. */
export type Roof = 'gable' | 'hip' | 'mono' | 'flat';
export type WallMat = 'brick' | 'plaster' | 'gasblock' | 'stone' | 'wood' | 'concrete';
export type RoofMat = 'metal' | 'ceramic' | 'seam' | 'shingle' | 'green';
export type Season = 'summer' | 'autumn' | 'winter';
export type Ground = 'lawn' | 'paving' | 'gravel';
export type Extra = 'chimney' | 'porch' | 'garage' | 'balcony' | 'solar' | 'pool' | 'fence' | 'trees' | 'shutters';

export type Design = {
  length: number; width: number; floors: number; floorHeight: number; roofType: Roof; roofPitch: number;
  wall: WallMat; wallColor: string; roofMat: RoofMat; roofColor: string; trimColor: string; doorColor: string; frameColor: string;
  extras: Record<Extra, boolean>; season: Season; ground: Ground; time: number;
};

export const WALL_MATS: WallMat[] = ['brick', 'plaster', 'gasblock', 'stone', 'wood', 'concrete'];
export const ROOF_MATS: RoofMat[] = ['metal', 'ceramic', 'seam', 'shingle', 'green'];
export const ROOFS: Roof[] = ['gable', 'hip', 'mono', 'flat'];
export const EXTRAS: Extra[] = ['chimney', 'porch', 'garage', 'balcony', 'solar', 'pool', 'fence', 'trees', 'shutters'];
export const SEASONS: Season[] = ['summer', 'autumn', 'winter'];
export const GROUNDS: Ground[] = ['lawn', 'paving', 'gravel'];

/** Suggested colours per material (any colour can still be picked freely). */
export const WALL_COLORS: Record<WallMat, string[]> = {
  brick: ['#b5532f', '#9c4a2e', '#c98b5e', '#d6c2a2', '#7d3f33', '#8a8680'],
  plaster: ['#efe9dd', '#e3d3b4', '#c9d3d8', '#d8c3b8', '#9aa59b', '#3d3f43'],
  gasblock: ['#f1f1ee', '#e4e2da', '#d1d4d2', '#e6dcc8'],
  stone: ['#a39a8a', '#8c8f90', '#b9ad96', '#7a6f66', '#c7beaa'],
  wood: ['#b98a5b', '#8a5f3c', '#d3b48a', '#5b4636', '#e8dcc6', '#3a3a38'],
  concrete: ['#b8b8b4', '#9d9d9a', '#d4d2cc', '#6f7274'],
};
export const ROOF_COLORS: Record<RoofMat, string[]> = {
  metal: ['#5a3a30', '#3a3d42', '#2f5d4b', '#7a2e2a', '#4b5563', '#a1634a'],
  ceramic: ['#b4532f', '#7b3a2c', '#5b5651', '#c98f5a'],
  seam: ['#3a3d42', '#6b6f75', '#2e4e6b', '#8a3a2e', '#2f2f2f'],
  shingle: ['#3b3b3d', '#5a4a3f', '#3f4f45', '#7a6a58'],
  green: ['#6f9a52', '#86a85d', '#5d8a4a'],
};
export const TRIM_COLORS = ['#f3f0ea', '#d8d2c4', '#2a2823', '#8a8272', '#b3502a'];
export const DOOR_COLORS = ['#3b2a20', '#2a2823', '#8f3d1d', '#2f5d4b', '#f3f0ea', '#46627f'];
export const FRAME_COLORS = ['#f3f0ea', '#2a2823', '#6b6f75', '#5b4636'];

export const DEFAULT_DESIGN: Design = {
  length: 12, width: 9, floors: 2, floorHeight: 2.8, roofType: 'gable', roofPitch: 30,
  wall: 'plaster', wallColor: '#efe9dd', roofMat: 'metal', roofColor: '#5a3a30', trimColor: '#f3f0ea', doorColor: '#3b2a20', frameColor: '#2a2823',
  extras: { chimney: true, porch: true, garage: false, balcony: false, solar: false, pool: false, fence: true, trees: true, shutters: false },
  season: 'summer', ground: 'lawn', time: 14,
};

export const LIMITS = { length: [3, 60], width: [3, 60], floors: [1, 8], floorHeight: [2.4, 4], roofPitch: [10, 55] } as const;
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Numbers the estimate is based on: they mirror the backend formulas (apps/calculator/service.py). */
export function metrics(d: Design) {
  const foot = d.length * d.width;
  const pitch = d.roofType === 'flat' ? 0 : (d.roofPitch * Math.PI) / 180;
  const roofArea = d.roofType === 'flat' ? foot * 1.03 : (foot / Math.cos(pitch)) * 1.08;
  return {
    foot, area: foot * d.floors, perimeter: 2 * (d.length + d.width), height: d.floorHeight * d.floors,
    wallArea: 2 * (d.length + d.width) * d.floorHeight * d.floors, roofArea,
    volume: foot * d.floorHeight * d.floors,
  };
}

/** Starting dimensions from a plain area (home-page quick form, old links): a 1.35 : 1 rectangle. */
export function designFromArea(area: number, floors: number, base: Design = DEFAULT_DESIGN): Design {
  const f = clamp(Math.round(floors) || 1, 1, 100), foot = Math.max(9, area / f), w = Math.sqrt(foot / 1.35);
  return { ...base, floors: f, width: clamp(round1(w), 3, 300), length: clamp(round1(w * 1.35), 3, 300) };
}

/** Payload fields for the calculator API. The server recomputes the area from these, so the browser never dictates it. */
export function geometryPayload(d: Design, type: string) {
  const flat = type === 'apartment' || d.roofType === 'flat';
  return { length: d.length, width: d.width, floors: type === 'apartment' ? 1 : d.floors, floor_height: d.floorHeight,
    roof_type: flat ? 'flat' : d.roofType, roof_pitch: Math.round(d.roofPitch) };
}

const KEY = 'bmg.house.design.v1';
export function loadDesign(): Design | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return null;
    const d = { ...DEFAULT_DESIGN, ...raw, extras: { ...DEFAULT_DESIGN.extras, ...(raw.extras || {}) } } as Design;
    if (!WALL_MATS.includes(d.wall) || !ROOF_MATS.includes(d.roofMat) || !ROOFS.includes(d.roofType)) return null;
    const col = /^#[0-9a-fA-F]{6}$/;
    for (const k of ['wallColor', 'roofColor', 'trimColor', 'doorColor', 'frameColor'] as const) if (!col.test(d[k])) d[k] = DEFAULT_DESIGN[k];
    d.length = clamp(d.length, 3, 300); d.width = clamp(d.width, 3, 300); d.floors = clamp(Math.round(d.floors), 1, 100);
    d.floorHeight = clamp(d.floorHeight, 2.4, 4); d.roofPitch = clamp(d.roofPitch, 10, 55); d.time = clamp(d.time, 0, 24);
    return d;
  } catch { return null; }
}
export function saveDesign(d: Design) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* private mode */ } }

const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
/** "Surprise me": a random but sensible combination of materials, colours and extras. */
export function randomLook(d: Design): Design {
  const wall = pick(WALL_MATS), roofMat = d.roofType === 'flat' ? pick(ROOF_MATS) : pick(ROOF_MATS.filter((m) => m !== 'green'));
  const extras = { ...d.extras };
  for (const e of EXTRAS) extras[e] = Math.random() > 0.55;
  return { ...d, wall, wallColor: pick(WALL_COLORS[wall]), roofMat, roofColor: pick(ROOF_COLORS[roofMat]), trimColor: pick(TRIM_COLORS),
    doorColor: pick(DOOR_COLORS), frameColor: pick(FRAME_COLORS), extras, season: pick(SEASONS), ground: pick(GROUNDS) };
}
