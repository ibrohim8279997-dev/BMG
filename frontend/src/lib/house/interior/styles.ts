import * as THREE from 'three';
import type { Design, Style } from '../design';
import type { Kit } from '../kit';
import type { InteriorMats } from './rooms';

/** A Poly Haven model (public/models/furniture/<id>.glb) and the box it should fill (m). */
export type Model = { id: string; w?: number; h?: number; d?: number };
const M = (id: string, w?: number, h?: number, d?: number): Model => ({ id, w, h, d });

/** What fills the rooms in each interior style. `null` = parametric piece (sized to the room). */
export type StyleDef = {
  sofa: Model | null; armchair: Model; coffee: Model; tvUnit: Model | null; diningChair: Model; diningTable: Model | null;
  lamp: Model; plants: Model[]; picture: Model; shelf: Model | null; nightstand: Model | null; mirror: Model | null;
  fabric: string; fabricSet: 'fabric' | 'felt' | 'leather'; fronts: string; frontsWood: boolean; counter: 'marble' | 'marble_dark' | 'oak' | 'walnut';
  wood: 'oak' | 'walnut'; rug: string; metal: string; bedding: string; skirting: string; leaf: string;
};

const plants = [M('potted_plant_01', undefined, 1.1), M('potted_plant_02', undefined, 0.8), M('potted_plant_04', undefined, 0.45)];

export const STYLE_DEFS: Record<Style, StyleDef> = {
  modern: {
    sofa: null, armchair: M('modern_arm_chair_01', 0.75), coffee: M('modern_coffee_table_01', 1.1), tvUnit: M('modern_wooden_cabinet', 1.8),
    diningChair: M('dining_chair_02', undefined, 0.95), diningTable: null, lamp: M('modern_ceiling_lamp_01', undefined, 0.6), plants,
    picture: M('hanging_picture_frame_01', 0.6), shelf: null, nightstand: null, mirror: null,
    fabric: '#8d8f91', fabricSet: 'fabric', fronts: '#e9e7e2', frontsWood: false, counter: 'marble', wood: 'oak', rug: '#b9b4ab', metal: '#2b2d30', bedding: '#f2f0eb', skirting: '#f4f3f0', leaf: '#f1efe9',
  },
  scandi: {
    sofa: null, armchair: M('mid_century_lounge_chair', 0.8), coffee: M('side_table_01', 0.6), tvUnit: null,
    diningChair: M('dining_chair_02', undefined, 0.95), diningTable: null, lamp: M('modern_ceiling_lamp_01', undefined, 0.6), plants,
    picture: M('hanging_picture_frame_02', 0.8), shelf: M('wooden_display_shelves_01', 1.1), nightstand: M('side_table_01', 0.45), mirror: null,
    fabric: '#d8d3c8', fabricSet: 'felt', fronts: '#f4f2ee', frontsWood: true, counter: 'oak', wood: 'oak', rug: '#ece6da', metal: '#d9d6cf', bedding: '#f6f4ef', skirting: '#f6f5f2', leaf: '#f6f5f2',
  },
  classic: {
    sofa: M('Sofa_01', 2.1), armchair: M('ArmChair_01', 0.8), coffee: M('CoffeeTable_01', 1.1), tvUnit: M('ClassicConsole_01', 1.3),
    diningChair: M('GreenChair_01', undefined, 1.05), diningTable: M('round_wooden_table_01', 1.2), lamp: M('Chandelier_01', undefined, 0.75), plants,
    picture: M('fancy_picture_frame_01', 0.9), shelf: null, nightstand: M('ClassicNightstand_01', 0.5), mirror: M('ornate_mirror_01', undefined, 1.1),
    fabric: '#cbbfa9', fabricSet: 'fabric', fronts: '#efe6d6', frontsWood: false, counter: 'marble', wood: 'walnut', rug: '#8c5a46', metal: '#b08d57', bedding: '#efe6d6', skirting: '#f3eee4', leaf: '#f3eee4',
  },
  loft: {
    sofa: M('sofa_02', 2.1), armchair: M('Ottoman_01', 0.75), coffee: M('industrial_coffee_table', 1.0), tvUnit: M('drawer_cabinet', 0.9),
    diningChair: M('metal_stool_01', undefined, 0.75), diningTable: M('round_wooden_table_02', 1.0), lamp: M('hanging_industrial_lamp', undefined, 0.7), plants,
    picture: M('hanging_picture_frame_01', 0.6), shelf: M('steel_frame_shelves_03', 1.3), nightstand: null, mirror: null,
    fabric: '#4a4c4f', fabricSet: 'leather', fronts: '#2f3236', frontsWood: false, counter: 'walnut', wood: 'walnut', rug: '#6b6258', metal: '#1f2124', bedding: '#d9d6d0', skirting: '#3a3c3f', leaf: '#3a3c3f',
  },
};

/** Materials shared by the whole interior, created through the kit so they are freed with the house. */
export type StyleMats = InteriorMats & {
  fabric: THREE.Material; bedding: THREE.Material; fronts: THREE.Material; counter: THREE.Material; ceramic: THREE.Material; chrome: THREE.Material;
  metal: THREE.Material; rug: THREE.Material; screen: THREE.Material; mirror: THREE.Material; showerGlass: THREE.Material; bulb: THREE.Material;
};

export function styleMats(kit: Kit, d: Design): StyleMats {
  const s = STYLE_DEFS[d.style], std = kit.std;
  return {
    floor: std({ set: d.floorMat, color: '#ffffff' }),
    wet: std({ set: d.tileMat === 'tile_small' ? 'tile_white' : d.tileMat, color: '#ffffff', rough: 0.35 }),
    tile: std({ set: d.tileMat, color: '#ffffff', rough: 0.25 }),
    wood: std({ set: s.wood, color: '#ffffff', rough: 0.55, clearcoat: 0.25 }),
    skirting: std({ color: s.skirting, rough: 0.5 }),
    leaf: std({ color: s.leaf, rough: 0.45, clearcoat: 0.2 }),
    plastic: std({ color: '#f5f5f2', rough: 0.3 }),
    fabric: std({ set: s.fabricSet, color: s.fabric, sheen: s.fabricSet === 'leather' ? undefined : 0.6, ...(s.fabricSet === 'leather' ? { clearcoat: 0.15 } : {}) }),
    bedding: std({ set: 'fabric', color: s.bedding, sheen: 0.5 }),
    fronts: s.frontsWood ? std({ set: 'oak', color: '#ffffff', rough: 0.5 }) : std({ color: s.fronts, rough: 0.28, clearcoat: 0.6 }),
    counter: std({ set: s.counter, color: '#ffffff', rough: 0.2, clearcoat: s.counter.startsWith('marble') ? 0.8 : 0.3 }),
    ceramic: std({ color: '#f7f7f5', rough: 0.08, clearcoat: 1 }),
    chrome: std({ color: '#dfe2e6', rough: 0.12, metal: 1 }),
    metal: std({ color: s.metal, rough: 0.4, metal: 0.8 }),
    rug: std({ set: 'carpet', color: s.rug, sheen: 0.8 }),
    screen: std({ color: '#0c0d0f', rough: 0.08, clearcoat: 1 }),
    mirror: std({ color: '#ffffff', rough: 0.02, metal: 1 }),
    showerGlass: (() => { const g = kit.glass.clone(); g.opacity = 0.14; kit.all.push(g); return g; })(),
    bulb: kit.lamp,
  };
}
