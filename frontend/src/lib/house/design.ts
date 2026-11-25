/** Design state of the 3D house and the numbers derived from it. Pure data: no three.js here, so it also runs on the server. */
export type Roof = 'gable' | 'hip' | 'mono' | 'flat';
export type WallMat = 'brick' | 'brick_yellow' | 'clinker' | 'bark' | 'lamb' | 'gasblock' | 'stone' | 'travertine' | 'wood' | 'fibro' | 'cassette' | 'concrete' | 'sandwich';
export type RoofMat = 'metal' | 'seam' | 'ceramic' | 'cement' | 'shingle' | 'ondulin' | 'green';
export type Season = 'summer' | 'autumn' | 'winter';
export type Ground = 'lawn' | 'paving' | 'granite' | 'gravel' | 'decking';
export type FrameMat = 'pvc' | 'pvc_wood' | 'alu';
export type Style = 'modern' | 'scandi' | 'classic' | 'loft';
export type FloorMat = 'oak_herring' | 'light_herring' | 'dark_herring' | 'parquet_classic' | 'laminate' | 'concrete_floor';
export type TileMat = 'tile_white' | 'tile_small' | 'tile_stone' | 'tile_beige' | 'marble';
export type Extra = 'chimney' | 'porch' | 'garage' | 'balcony' | 'solar' | 'pool' | 'fence' | 'trees' | 'shutters';

export type Design = {
  length: number; width: number; floors: number; floorHeight: number; roofType: Roof; roofPitch: number;
  wall: WallMat; wallColor: string; roofMat: RoofMat; roofColor: string; trimColor: string; doorColor: string; frameColor: string; frameMat: FrameMat;
  extras: Record<Extra, boolean>; season: Season; ground: Ground; time: number;
  style: Style; floorMat: FloorMat; tileMat: TileMat; paint: string;
};

export const WALL_MATS: WallMat[] = ['brick', 'brick_yellow', 'clinker', 'bark', 'lamb', 'gasblock', 'stone', 'travertine', 'wood', 'fibro', 'cassette', 'concrete', 'sandwich'];
export const ROOF_MATS: RoofMat[] = ['metal', 'seam', 'ceramic', 'cement', 'shingle', 'ondulin', 'green'];
export const ROOFS: Roof[] = ['gable', 'hip', 'mono', 'flat'];
export const EXTRAS: Extra[] = ['chimney', 'porch', 'garage', 'balcony', 'solar', 'pool', 'fence', 'trees', 'shutters'];
export const SEASONS: Season[] = ['summer', 'autumn', 'winter'];
export const GROUNDS: Ground[] = ['lawn', 'paving', 'granite', 'gravel', 'decking'];
export const FRAME_MATS: FrameMat[] = ['pvc', 'pvc_wood', 'alu'];
export const STYLES: Style[] = ['modern', 'scandi', 'classic', 'loft'];
export const FLOOR_MATS: FloorMat[] = ['oak_herring', 'light_herring', 'dark_herring', 'parquet_classic', 'laminate', 'concrete_floor'];
export const TILE_MATS: TileMat[] = ['tile_white', 'tile_small', 'tile_stone', 'tile_beige', 'marble'];

/** Materials whose texture carries its own colour: the swatch only tints it (white = as photographed). */
export const NATURAL = new Set<string>(['brick', 'clinker', 'stone', 'travertine', 'wood', 'concrete', 'ceramic', 'green', 'lawn', 'paving', 'granite', 'gravel', 'decking']);

/** Suggested colours per material (any colour can still be picked freely). */
const TONES = ['#ffffff', '#efe4da', '#e0d2c6', '#d0cbc6', '#f3e6cc', '#c9bdb4'];
export const WALL_COLORS: Record<WallMat, string[]> = {
  brick: TONES, clinker: TONES, stone: TONES, travertine: TONES, wood: ['#ffffff', '#e9dccb', '#c9b8a6', '#8f8378', '#f3e9da', '#5e5650'], concrete: TONES,
  brick_yellow: ['#f2dca8', '#ead2a0', '#f5e6c4', '#dcc08a'],
  bark: ['#efe9dd', '#e3d3b4', '#c9d3d8', '#d8c3b8', '#9aa59b', '#3d3f43'],
  lamb: ['#f1ede4', '#e8dcc4', '#d5dcdf', '#e2cfc4', '#a8b2a7', '#4a4c50'],
  gasblock: ['#f1f1ee', '#e4e2da', '#d1d4d2', '#e6dcc8'],
  fibro: ['#d9d6cf', '#b9b7b2', '#8c8f90', '#4b4e52', '#c8b9a3', '#e9e4da'],
  cassette: ['#3a3d42', '#6b6f75', '#a7aaad', '#8a5a3c', '#2f4a5e', '#d8d6d0'],
  sandwich: ['#e8e8e4', '#a7aaad', '#3a3d42', '#2e4e6b', '#7a2e2a'],
};
export const ROOF_COLORS: Record<RoofMat, string[]> = {
  metal: ['#5a3a30', '#3a3d42', '#2f5d4b', '#7a2e2a', '#4b5563', '#a1634a'],
  seam: ['#3a3d42', '#6b6f75', '#2e4e6b', '#8a3a2e', '#2f2f2f'],
  ceramic: TONES,
  cement: ['#7b3a2c', '#5b5651', '#3a3a3c', '#a5603f', '#6f6a62'],
  shingle: ['#3b3b3d', '#5a4a3f', '#3f4f45', '#7a6a58', '#7a2e2a'],
  ondulin: ['#7a2e2a', '#3f5a3f', '#5a3a30', '#3b3b3d'],
  green: ['#ffffff', '#e8f0dc', '#d6e2c6'],
};
/** Interior defaults per style preset (floor, tiles, wall paint). */
export const STYLE_PRESET: Record<Style, { floorMat: FloorMat; tileMat: TileMat; paint: string }> = {
  modern: { floorMat: 'oak_herring', tileMat: 'tile_white', paint: '#ecebe7' },
  scandi: { floorMat: 'light_herring', tileMat: 'tile_small', paint: '#f4f2ee' },
  classic: { floorMat: 'parquet_classic', tileMat: 'marble', paint: '#efe6d6' },
  loft: { floorMat: 'concrete_floor', tileMat: 'tile_stone', paint: '#d9d6d0' },
};
export const PAINTS = ['#f4f2ee', '#ecebe7', '#efe6d6', '#dfe3e0', '#d9d6d0', '#c9cfc6', '#e6d9cc', '#b9c3c9'];
export const TRIM_COLORS = ['#f3f0ea', '#d8d2c4', '#2a2823', '#8a8272', '#b3502a'];
export const DOOR_COLORS = ['#3b2a20', '#2a2823', '#8f3d1d', '#2f5d4b', '#f3f0ea', '#46627f'];
export const FRAME_COLORS = ['#f3f0ea', '#2a2823', '#3c4146', '#6b6f75', '#b08a62'];

export const DEFAULT_DESIGN: Design = {
  length: 12, width: 9, floors: 2, floorHeight: 2.8, roofType: 'gable', roofPitch: 30,
  wall: 'lamb', wallColor: '#f1ede4', roofMat: 'metal', roofColor: '#3a3d42', trimColor: '#f3f0ea', doorColor: '#3b2a20', frameColor: '#3c4146', frameMat: 'pvc',
  extras: { chimney: true, porch: true, garage: false, balcony: false, solar: false, pool: false, fence: true, trees: true, shutters: false },
  season: 'summer', ground: 'lawn', time: 14, style: 'modern', ...STYLE_PRESET.modern,
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
    if ((d.wall as string) === 'plaster') d.wall = 'lamb';   // v1 name
    if (!WALL_MATS.includes(d.wall) || !ROOF_MATS.includes(d.roofMat) || !ROOFS.includes(d.roofType)) return null;
    if (!GROUNDS.includes(d.ground)) d.ground = 'lawn';
    if (!FRAME_MATS.includes(d.frameMat)) d.frameMat = 'pvc';
    if (!STYLES.includes(d.style)) d.style = 'modern';
    if (!FLOOR_MATS.includes(d.floorMat)) d.floorMat = STYLE_PRESET[d.style].floorMat;
    if (!TILE_MATS.includes(d.tileMat)) d.tileMat = STYLE_PRESET[d.style].tileMat;
    const col = /^#[0-9a-fA-F]{6}$/;
    for (const k of ['wallColor', 'roofColor', 'trimColor', 'doorColor', 'frameColor', 'paint'] as const) if (!col.test(d[k])) d[k] = DEFAULT_DESIGN[k];
    // natural textures are only tinted: a strong old v1 colour would darken them, so start from their own look
    if (NATURAL.has(d.wall) && !WALL_COLORS[d.wall].includes(d.wallColor.toLowerCase())) d.wallColor = WALL_COLORS[d.wall][0];
    if (NATURAL.has(d.roofMat) && !ROOF_COLORS[d.roofMat].includes(d.roofColor.toLowerCase())) d.roofColor = ROOF_COLORS[d.roofMat][0];
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
  const style = pick(STYLES);
  return { ...d, wall, wallColor: pick(WALL_COLORS[wall]), roofMat, roofColor: pick(ROOF_COLORS[roofMat]), trimColor: pick(TRIM_COLORS),
    doorColor: pick(DOOR_COLORS), frameColor: pick(FRAME_COLORS), frameMat: pick(FRAME_MATS), extras, season: pick(SEASONS), ground: pick(GROUNDS),
    style, ...STYLE_PRESET[style] };
}
