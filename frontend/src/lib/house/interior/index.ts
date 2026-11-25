import * as THREE from 'three';
import type { Built } from '../build';
import type { Design } from '../design';
import { mergeStatic } from '../merge';
import { furnish } from './furnish';
import { FloorPlan, Rect, planHouse } from './plan';
import { buildShell, Seg } from './rooms';
import { styleMats } from './styles';

/** The furnished interior, built only once someone looks inside (cutaway or walk mode). */
export type Interior = {
  groups: THREE.Group[]; plans: FloorPlan[];
  /** Walk collision per storey: wall segments and furniture footprints. */
  segs: Seg[][]; boxes: Rect[][];
  /** Ceiling-light anchors per storey (storey-local). */
  lights: THREE.Vector3[][];
  dispose: () => void;
};

export function buildInterior(b: Built, d: Design, alive: () => boolean): Interior {
  const plans = planHouse(d), mats = styleMats(b.kit, d);
  const groups: THREE.Group[] = [], segs: Seg[][] = [], boxes: Rect[][] = [], lights: THREE.Vector3[][] = [];
  plans.forEach((plan, f) => {
    const shell = buildShell(b.kit, d, plan, mats), furn = furnish(d, plan, mats, alive);
    const g = new THREE.Group(); g.add(shell.group, furn.group); g.userData.interior = true; g.userData.keep = true;
    b.floorGroups[f].add(g); mergeStatic(g); groups.push(g);
    segs.push(shell.segs); boxes.push(furn.boxes); lights.push(furn.lamps);
  });
  return {
    groups, plans, segs, boxes, lights,
    dispose: () => groups.forEach((g) => { g.parent?.remove(g); g.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry && !m.userData.shared) m.geometry.dispose(); }); }),
  };
}
