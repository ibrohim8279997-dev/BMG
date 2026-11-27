/** What each configurator part can be made of. The options are the shop's own materials (the same texture sets
 *  and dictionary names the rest of the site uses); the shop search word of each option finds matching products. */
import {
  Design, FLOOR_MATS, FRAME_MATS, ROOF_COLORS, ROOF_MATS, WALL_COLORS, WALL_MATS,
} from '../design';

export type PartType = 'foundation' | 'slab' | 'walls' | 'open' | 'frame' | 'elec' | 'rafters' | 'cover';
export const PART_TYPES: PartType[] = ['foundation', 'slab', 'walls', 'open', 'frame', 'elec', 'rafters', 'cover'];

/** One material option. `set` = a PBR texture set (registry ids); without it the part gets a flat colour. */
export type Opt = { id: string; set?: string; color: string; metal?: number; rough?: number };

/** Parts the Design does not describe: their choice lives in the configurator only (look, not estimate). */
export type LocalPick = { foundation: string; rafters: string; frame: string; elec: string };
export const DEFAULT_LOCAL: LocalPick = { foundation: 'monolith', rafters: 'pine', frame: 'timber', elec: 'vvg' };

const LOCAL_OPTS: Record<keyof LocalPick, Opt[]> = {
  foundation: [
    { id: 'monolith', set: 'concrete', color: '#ffffff' },
    { id: 'fbs', set: 'concrete', color: '#c9c8c4' },
    { id: 'stone_base', set: 'stone', color: '#ffffff' },
    { id: 'xps', color: '#e9a13b', rough: 0.7 },
  ],
  rafters: [
    { id: 'pine', set: 'oak', color: '#f3dcb4' },
    { id: 'larch', set: 'oak', color: '#d29a68' },
    { id: 'glulam', set: 'oak', color: '#ffffff' },
    { id: 'steel', set: 'steel', color: '#ffffff' },
  ],
  frame: [
    { id: 'timber', set: 'oak', color: '#f0d6ac' },
    { id: 'steel', set: 'steel', color: '#ffffff' },
    { id: 'rc', set: 'concrete', color: '#ffffff' },
  ],
  elec: [
    { id: 'vvg', color: '#e8731c', rough: 0.6 },
    { id: 'corrugated', color: '#3b7fd1', rough: 0.55 },
    { id: 'channel', color: '#f1f1ee', rough: 0.5 },
    { id: 'copper', color: '#b87333', metal: 0.8, rough: 0.35 },
  ],
};

const FRAME_TONE: Record<string, string> = { pvc: '#f3f0ea', pvc_wood: '#b08a62', alu: '#3c4146' };

/** Options of a part type; the picked one carries the colour from the Design. */
export function options(type: PartType, d: Design): Opt[] {
  switch (type) {
    case 'walls': return WALL_MATS.map((id) => ({ id, set: id, color: id === d.wall ? d.wallColor : WALL_COLORS[id][0] }));
    case 'cover': return ROOF_MATS.filter((r) => r !== 'green' || d.roofType === 'flat')
      .map((id) => ({ id, set: id, color: id === d.roofMat ? d.roofColor : ROOF_COLORS[id][0] }));
    case 'slab': return FLOOR_MATS.map((id) => ({ id, set: id, color: '#ffffff' }));
    case 'open': return FRAME_MATS.map((id) => ({ id, color: id === d.frameMat ? d.frameColor : FRAME_TONE[id], rough: 0.45, metal: id === 'alu' ? 0.5 : 0 }));
    default: return LOCAL_OPTS[type];
  }
}

/** The option currently picked for a part type. */
export function current(type: PartType, d: Design, local: LocalPick): Opt {
  const list = options(type, d);
  const id = type === 'walls' ? d.wall : type === 'cover' ? d.roofMat : type === 'slab' ? d.floorMat : type === 'open' ? d.frameMat : local[type];
  return list.find((o) => o.id === id) || list[0];
}

/** Applies a pick: Design fields for the parts the estimate and the rest of the site know, local state otherwise. */
export function pick(type: PartType, id: string, d: Design, local: LocalPick): { design: Design; local: LocalPick } {
  switch (type) {
    case 'walls': return { design: { ...d, wall: id as Design['wall'], wallColor: WALL_COLORS[id as Design['wall']][0] }, local };
    case 'cover': return { design: { ...d, roofMat: id as Design['roofMat'], roofColor: ROOF_COLORS[id as Design['roofMat']][0] }, local };
    case 'slab': return { design: { ...d, floorMat: id as Design['floorMat'] }, local };
    case 'open': return { design: { ...d, frameMat: id as Design['frameMat'], frameColor: FRAME_TONE[id] }, local };
    default: return { design: d, local: { ...local, [type]: id } };
  }
}

/** Dictionary key of an option's display name. */
export function nameKey(type: PartType, id: string) {
  return type === 'walls' ? `studio.wall.${id}` : type === 'cover' ? `studio.roofmat.${id}` : type === 'slab' ? `studio.fl.${id}`
    : type === 'open' ? `studio.frame.${id}` : `cfg.m.${id}`;
}

/** Dictionary key of the shop search word (sellers name products in the shop's language). */
export const queryKey = (type: PartType, id: string) => (type === 'walls' || type === 'cover' || type === 'slab' ? `studio.cq.${id}` : `cfg.q.${id}`);

/** Swatch preview for a card: the texture thumbnail, or the flat colour. */
export const thumb = (o: Opt) => (o.set ? `/textures/thumbs/${o.set}.webp` : null);

/** Estimate zones a part type feeds (the calculator's walls / floor / ceiling / roof). */
export const ZONES_OF: Record<PartType, string[]> = {
  foundation: [], slab: ['floor', 'ceiling'], walls: ['walls'], open: [], frame: [], elec: [], rafters: ['roof'], cover: ['roof'],
};

/** Colour swatches offered for a part (only those the Design stores a colour for). */
export function colors(type: PartType, d: Design): { value: string; options: string[]; key: 'wallColor' | 'roofColor' | 'frameColor' } | null {
  if (type === 'walls') return { value: d.wallColor, options: WALL_COLORS[d.wall], key: 'wallColor' };
  if (type === 'cover') return { value: d.roofColor, options: ROOF_COLORS[d.roofMat], key: 'roofColor' };
  if (type === 'open') return { value: d.frameColor, options: ['#f3f0ea', '#2a2823', '#3c4146', '#6b6f75', '#b08a62'], key: 'frameColor' };
  return null;
}
