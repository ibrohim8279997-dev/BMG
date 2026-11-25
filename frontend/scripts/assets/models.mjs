// Downloads CC0 furniture models from Poly Haven (1k glTF) and packs each into one GLB
// with meshopt geometry and WebP textures, ready for GLTFLoader + MeshoptDecoder.
//
//   GLTF_TRANSFORM=/path/to/gltf-transform  node scripts/assets/models.mjs [--force] [id ...]
//
// Output: public/models/furniture/<id>.glb and public/models/LICENSES.md
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'public', 'models', 'furniture');
const CACHE = process.env.ASSET_CACHE || join(tmpdir(), 'bmg-asset-cache');
const GT = process.env.GLTF_TRANSFORM || 'gltf-transform';
const args = process.argv.slice(2), force = args.includes('--force'), only = args.filter((a) => !a.startsWith('--'));

/** Model id → texture size. Mirrors src/lib/house/interior/styles.ts. */
export const MODELS = {
  potted_plant_01: 512, potted_plant_02: 512, potted_plant_04: 512, throw_pillows_01: 512, ceramic_vase_01: 256,
  modern_arm_chair_01: 1024, modern_coffee_table_01: 512, modern_wooden_cabinet: 1024, modern_ceiling_lamp_01: 256, hanging_picture_frame_01: 512, dining_chair_02: 512,
  mid_century_lounge_chair: 1024, side_table_01: 512, wooden_display_shelves_01: 512, hanging_picture_frame_02: 512, coffee_table_round_01: 512,
  Sofa_01: 1024, ArmChair_01: 1024, CoffeeTable_01: 512, ClassicConsole_01: 512, ClassicNightstand_01: 512, Chandelier_01: 512, fancy_picture_frame_01: 512, ornate_mirror_01: 512, round_wooden_table_01: 512, GreenChair_01: 512,
  sofa_02: 1024, industrial_coffee_table: 512, steel_frame_shelves_03: 512, hanging_industrial_lamp: 512, metal_stool_01: 512, Ottoman_01: 512, round_wooden_table_02: 512, drawer_cabinet: 512,
};

async function get(url, tries = 4) {
  for (let i = 1; ; i++) {
    try { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; }
    catch (e) { if (i >= tries) throw e; await new Promise((s) => setTimeout(s, 2500 * i)); }
  }
}

async function build(id, size) {
  if (!/^\w+$/.test(id)) throw new Error(`bad id ${id}`);
  const out = join(OUT, `${id}.glb`);
  if (!force && existsSync(out)) return 'cached';
  const files = await (await get(`https://api.polyhaven.com/files/${id}`)).json();
  const g = files.gltf?.['1k']?.gltf; if (!g) throw new Error('no 1k glTF');
  const dir = join(CACHE, `ph_${id}`); mkdirSync(dir, { recursive: true });
  const main = join(dir, `${id}.gltf`);
  writeFileSync(main, Buffer.from(await (await get(g.url)).arrayBuffer()));
  for (const [rel, f] of Object.entries(g.include || {})) {
    if (rel.includes('..')) throw new Error('unsafe include path');
    const p = join(dir, rel); mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, Buffer.from(await (await get(f.url)).arrayBuffer()));
  }
  execFileSync(GT, ['optimize', main, out, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', String(size), '--simplify', 'false'], { stdio: ['ignore', 'ignore', 'inherit'] });
  rmSync(dir, { recursive: true });
  return 'built';
}

mkdirSync(OUT, { recursive: true });
let total = 0;
for (const [id, size] of Object.entries(MODELS)) {
  if (only.length && !only.includes(id)) continue;
  try { const how = await build(id, size); const kb = statSync(join(OUT, `${id}.glb`)).size / 1024; total += kb; console.log(`${how.padEnd(6)} ${id.padEnd(28)} ${kb.toFixed(0)} KB`); }
  catch (e) { console.error(`FAILED ${id}: ${e.message}`); process.exitCode = 1; }
}
console.log(`total ${(total / 1024).toFixed(1)} MB`);
writeFileSync(join(ROOT, 'public', 'models', 'LICENSES.md'), [
  '# Model licences', '',
  '- `furniture/*.glb`: [Poly Haven](https://polyhaven.com) models, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Re-packed with meshopt + WebP by `scripts/assets/models.mjs`.',
  '- `trees/*.glb`: generated with [EZ-Tree](https://github.com/dgreenheck/ez-tree) (MIT licence, Daniel Greenheck); the generated meshes and its bundled bark/leaf textures are used under that licence.', '',
  '| File | Source |', '|---|---|',
  ...Object.keys(MODELS).map((id) => `| furniture/${id}.glb | https://polyhaven.com/a/${id} |`), '',
].join('\n'));
