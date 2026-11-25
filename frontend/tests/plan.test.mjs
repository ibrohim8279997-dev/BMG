import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planHouse, roomGaps, TI } from '../src/lib/house/interior/plan.ts';
import { facadeSpans } from '../src/lib/house/openings.ts';

const base = { length: 12, width: 9, floors: 2, floorHeight: 2.8, roofType: 'gable', roofPitch: 30, extras: {} };
const sizes = [[12, 9, 1], [12, 9, 2], [16, 11, 3], [8, 7, 1], [5, 4.5, 1], [6, 5, 2], [20, 14, 2], [9.5, 6.4, 2]];

for (const [length, width, floors] of sizes) {
  const d = { ...base, length, width, floors };
  test(`plan ${length}x${width}x${floors}`, () => {
    const plans = planHouse(d);
    assert.equal(plans.length, floors);
    plans.forEach((p, f) => {
      const I = p.inner;
      // rooms stay inside the shell and have usable size
      for (const r of p.rooms) {
        assert.ok(r.x0 >= I.x0 - 1e-6 && r.x1 <= I.x1 + 1e-6 && r.z0 >= I.z0 - 1e-6 && r.z1 <= I.z1 + 1e-6, `${r.id} outside`);
        assert.ok(r.x1 - r.x0 >= 0.9 && r.z1 - r.z0 >= 0.9, `${r.id} too small`);
      }
      // every room except the hall/open room is reachable through a door
      for (const r of p.rooms.filter((x) => x.kind !== 'hall' && !x.id.endsWith('main'))) {
        const g = roomGaps(r, p, d);
        assert.ok(Object.values(g).flat().some((x) => x.door), `${r.id} (${r.kind}) has no door`);
      }
      // partitions never run into a window of the facade they meet
      const sp = facadeSpans(d, f);
      for (const w of p.walls) {
        const vertical = Math.abs(w.ax - w.bx) < 1e-6;
        if (!vertical) continue;
        for (const [z, side] of [[w.az, 'back'], [w.bz, 'front']]) {
          if (Math.abs(z - (side === 'back' ? I.z0 : I.z1)) > 1e-6) continue;
          for (const s of sp[side]) assert.ok(w.ax + TI / 2 <= s.a || w.ax - TI / 2 >= s.b, `wall x=${w.ax.toFixed(2)} hits ${side} window ${s.a.toFixed(2)}..${s.b.toFixed(2)}`);
        }
      }
      // multi-storey houses get a stair on every floor but the top, and its hole on the floor above
      if (f < floors - 1 && !(length < 6.2 || width < 5.2) || (f < floors - 1 && floors > 1)) assert.ok(p.up, `floor ${f} has no stair`);
      if (f > 0) assert.deepEqual(p.hole, plans[f - 1].up);
    });
  });
}

test('one storey has living, kitchen, bedroom and bath', () => {
  const kinds = planHouse({ ...base, floors: 1 })[0].rooms.map((r) => r.kind).sort();
  for (const k of ['living', 'kitchen', 'bedroom', 'bath', 'hall']) assert.ok(kinds.includes(k), k);
});
