/** Real furniture for the generated interior: Poly Haven GLB models (CC0, meshopt) per style, swapped in for the
 *  box pieces only once the visitor looks inside (walk, cutaway or a focused storey). The plan, footprints and collision
 *  boxes stay those of interior.ts; a model is fitted into its piece's footprint, so nothing moves. */
import * as THREE from 'three';
import type { Style } from '../design';
import { fitModel, loadModel, own } from './models';

/** A model and an optional height cap (m); width / depth come from the piece's footprint. */
export type Spec = { id: string; h?: number };
const S = (id: string, h?: number): Spec => ({ id, h });
const PLANTS = [S('potted_plant_01', 1.1), S('potted_plant_02', 0.85), S('potted_plant_04', 0.6)];

/** Pieces that get a model in each style (kinds of interior.ts); the rest stay parametric. `lamp` hangs under the ceiling. */
export const FURNITURE: Record<Style, Partial<Record<string, Spec[]>>> = {
  modern: { armchair: [S('modern_arm_chair_01')], ctable: [S('modern_coffee_table_01')], plant: PLANTS, lamp: [S('modern_ceiling_lamp_01', 0.6)] },
  scandi: { armchair: [S('mid_century_lounge_chair')], ctable: [S('side_table_01')], shelf: [S('wooden_display_shelves_01')], nstand: [S('side_table_01')], plant: PLANTS, lamp: [S('modern_ceiling_lamp_01', 0.6)] },
  classic: { sofa: [S('Sofa_01')], armchair: [S('ArmChair_01')], ctable: [S('CoffeeTable_01')], nstand: [S('ClassicNightstand_01')], plant: PLANTS, lamp: [S('Chandelier_01', 0.75)] },
  loft: { sofa: [S('sofa_02')], armchair: [S('Ottoman_01')], ctable: [S('industrial_coffee_table')], shelf: [S('steel_frame_shelves_03')], plant: PLANTS, lamp: [S('hanging_industrial_lamp', 0.7)] },
};

/** Tag stored on a piece group: the model and the footprint it must fill. */
export type Slot = { spec: Spec; w: number; d: number; hang: boolean };

/** Picks the model for the n-th piece of a kind in a style (plants alternate), or null when it stays parametric. */
export function slotFor(style: Style, kind: string, n: number, size: [number, number]): Slot | null {
  const list = (FURNITURE[style] || FURNITURE.modern)[kind];
  if (!list?.length) return null;
  return { spec: list[n % list.length], w: size[0], d: size[1], hang: kind === 'lamp' };
}

/** Swaps every tagged piece of a storey for its model. `onMats` receives each model's private materials (for fading). */
export function furnish(g: THREE.Group, alive: () => boolean, onMats: (m: THREE.Material[]) => void) {
  const slots: THREE.Object3D[] = [];
  g.traverse((o) => { if (o.userData.slot && !o.userData.filled) slots.push(o); });
  for (const o of slots) {
    o.userData.filled = true;
    const s = o.userData.slot as Slot;
    loadModel(`/models/furniture/${s.spec.id}.glb`).then((m) => {
      if (!alive()) return;
      const mats: THREE.Material[] = [];
      m.traverse((c) => {
        const mesh = c as THREE.Mesh; if (!mesh.isMesh) return;
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map((x) => own(x)) : own(mesh.material);
        mats.push(...[mesh.material].flat());
      });
      const fit = fitModel(m, s.hang ? { h: s.spec.h, w: 0.9 } : { w: s.w, d: s.d, h: s.spec.h });
      if (s.hang) fit.position.y = -(fit.userData.height as number);
      o.children.forEach((c) => { c.visible = false; });   // the box stand-in
      o.add(fit); onMats(mats);
    }).catch(() => { /* model missing: the box piece stays */ });
  }
}
