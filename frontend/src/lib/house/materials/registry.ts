import data from './sets.json';

/** One CC0 PBR texture set (see sets.json and scripts/assets/textures.mjs). */
export type PbrSet = {
  id: string; src: string; size: [number, number];
  anti?: 'bomb' | 'macro' | 'none'; tint?: boolean; rot?: boolean; metal?: number; rough?: number;
};

export const SETS: Record<string, PbrSet> = Object.fromEntries(
  (data.sets as PbrSet[]).map((s) => [s.id, s]),
);

export const hasSet = (id: string) => id in SETS;
export const thumbUrl = (id: string) => `/textures/thumbs/${id}.webp`;
export const setUrl = (id: string, map: 'albedo' | 'normal' | 'orm') => `/textures/${id}/${map}.ktx2`;

/** Rough average colour of each untinted set, used while its textures are still loading. */
export const BASE: Record<string, string> = {
  brick: '#9c5a44', clinker: '#8a5d4f', stone: '#a39a88', travertine: '#d8cdb9', wood: '#7a5a42', concrete: '#a8a6a0',
  ceramic: '#b2643f', green: '#5f7f3e', lawn: '#62803f', paving: '#8f8b84', granite: '#b8b4ad', gravel: '#9a968f', decking: '#9a6c48',
  oak_herring: '#a07548', light_herring: '#d9c7a4', dark_herring: '#4f3e30', parquet_classic: '#7a4a28', laminate: '#b07a4a', concrete_floor: '#8d8c88',
  tile_stone: '#c9c5bd', tile_beige: '#d9c8a8', tile_white: '#e9e9e6', tile_small: '#eef0f0', marble: '#e8e8e6', marble_dark: '#2a2a2c',
  walnut: '#5a3a24', oak: '#b88a5a', steel: '#8d9096',
};
