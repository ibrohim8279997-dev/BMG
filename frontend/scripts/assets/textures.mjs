// Downloads the CC0 PBR sets listed in src/lib/house/materials/sets.json from ambientCG,
// packs AO/roughness/metalness into one ORM image and compresses everything to KTX2 (Basis).
//
//   KTX_BIN=/path/to/ktx  node scripts/assets/textures.mjs [--force] [id ...]
//
// Needs: the KTX-Software `ktx` CLI (v4.3+) and `unzip`. sharp comes with Next.js.
// Output: public/textures/<id>/{albedo,normal,orm}.ktx2, public/textures/thumbs/<id>.webp, public/textures/LICENSES.md
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'public', 'textures');
const CACHE = process.env.ASSET_CACHE || join(tmpdir(), 'bmg-asset-cache');
const KTX = process.env.KTX_BIN || 'ktx';
const SIZE = Number(process.env.TEX_SIZE || 1024);
const args = process.argv.slice(2), force = args.includes('--force'), only = args.filter((a) => !a.startsWith('--'));
const { sets } = JSON.parse(readFileSync(join(ROOT, 'src/lib/house/materials/sets.json'), 'utf8'));

if (!/^[\w./-]+$/.test(CACHE)) throw new Error('ASSET_CACHE must be a plain path');
mkdirSync(CACHE, { recursive: true }); mkdirSync(join(OUT, 'thumbs'), { recursive: true });

async function download(src) {
  if (!/^[A-Za-z0-9]+$/.test(src)) throw new Error(`bad asset id ${src}`);
  const dir = join(CACHE, src);
  if (existsSync(dir) && readdirSync(dir).length) return dir;
  const zip = join(CACHE, `${src}.zip`);
  for (let attempt = 1; ; attempt++) {   // ambientCG drops connections now and then
    try {
      const res = await fetch(`https://ambientcg.com/get?file=${src}_1K-JPG.zip`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
      break;
    } catch (e) {
      if (attempt >= 4) throw new Error(`${src}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  mkdirSync(dir, { recursive: true });
  execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
  rmSync(zip);
  return dir;
}

const find = (dir, suffix) => readdirSync(dir).find((f) => f.endsWith(`_${suffix}.jpg`) || f.endsWith(`_${suffix}.png`));
const grey = async (file, fill) => file
  ? sharp(file).resize(SIZE, SIZE).greyscale().raw().toBuffer()
  : Buffer.alloc(SIZE * SIZE, fill);

function ktx(input, output, kind) {
  const common = ['create', '--generate-mipmap', '--assign-primaries', 'bt709'];
  const opts = kind === 'albedo'
    ? ['--format', 'R8G8B8_SRGB', '--assign-tf', 'srgb', '--encode', 'basis-lz', '--clevel', '2', '--qlevel', '192']
    : kind === 'normal'
      ? ['--format', 'R8G8B8_UNORM', '--assign-tf', 'linear', '--encode', 'basis-lz', '--clevel', '4', '--qlevel', '255']   // UASTC barely shrinks noisy normals
      : ['--format', 'R8G8B8_UNORM', '--assign-tf', 'linear', '--encode', 'basis-lz', '--clevel', '2', '--qlevel', '160'];
  execFileSync(KTX, [...common, ...opts, input, output], { stdio: ['ignore', 'ignore', 'inherit'] });
}

async function build(set) {
  const dest = join(OUT, set.id);
  if (!force && existsSync(join(dest, 'orm.ktx2'))) return 'cached';
  const dir = await download(set.src), work = join(CACHE, `_${set.id}`);
  mkdirSync(work, { recursive: true }); mkdirSync(dest, { recursive: true });
  const color = find(dir, 'Color'), normal = find(dir, 'NormalGL');
  if (!color || !normal) throw new Error(`${set.src}: missing Color/NormalGL`);

  let albedo = sharp(join(dir, color)).resize(SIZE, SIZE).removeAlpha();
  if (set.tint) {   // neutral grey with a fixed mean, so material.color decides the hue and brightness
    const { channels } = await sharp(join(dir, color)).greyscale().stats();
    // mean → 200 and contrast squeezed to 55 %: stains and highlights in the photo would otherwise read as blotches once tinted
    const k = 200 / Math.max(1, channels[0].mean), c = 0.55;
    albedo = albedo.greyscale().linear(k * c, 200 * (1 - c)).toColourspace('srgb');
  }
  await albedo.png().toFile(join(work, 'albedo.png'));
  await sharp(join(dir, normal)).resize(SIZE, SIZE).removeAlpha().png().toFile(join(work, 'normal.png'));

  const ao = find(dir, 'AmbientOcclusion'), rough = find(dir, 'Roughness'), metal = find(dir, 'Metalness');
  const [a, r, m] = await Promise.all([grey(ao && join(dir, ao), 255), grey(rough && join(dir, rough), 200), grey(metal && join(dir, metal), 0)]);
  const orm = Buffer.alloc(SIZE * SIZE * 3);
  for (let i = 0; i < SIZE * SIZE; i++) { orm[i * 3] = a[i]; orm[i * 3 + 1] = r[i]; orm[i * 3 + 2] = m[i]; }
  await sharp(orm, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toFile(join(work, 'orm.png'));

  for (const k of ['albedo', 'normal', 'orm']) ktx(join(work, `${k}.png`), join(dest, `${k}.ktx2`), k);
  await sharp(join(work, 'albedo.png')).resize(160, 160).webp({ quality: 78 }).toFile(join(OUT, 'thumbs', `${set.id}.webp`));
  rmSync(work, { recursive: true });
  return 'built';
}

const todo = sets.filter((s) => !only.length || only.includes(s.id));
let total = 0;
for (const s of todo) {
  try {
    const how = await build(s);
    const kb = ['albedo', 'normal', 'orm'].reduce((n, k) => n + statSync(join(OUT, s.id, `${k}.ktx2`)).size, 0) / 1024;
    total += kb;
    console.log(`${how.padEnd(6)} ${s.id.padEnd(16)} ${s.src.padEnd(20)} ${kb.toFixed(0)} KB`);
  } catch (e) { console.error(`FAILED ${s.id}: ${e.message}`); process.exitCode = 1; }
}
console.log(`total ${(total / 1024).toFixed(1)} MB`);

const lic = ['# Texture licences', '', 'All texture sets in this folder come from [ambientCG](https://ambientcg.com) and are licensed',
  '[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) (public domain, commercial use allowed, no attribution required).',
  'They were resized to 1024 px, AO/roughness/metalness packed into `orm`, and compressed to KTX2 by `scripts/assets/textures.mjs`.', '',
  '| Folder | ambientCG asset | Source |', '|---|---|---|',
  ...sets.map((s) => `| ${s.id} | ${s.src} | https://ambientcg.com/view?id=${s.src} |`), ''];
writeFileSync(join(OUT, 'LICENSES.md'), lic.join('\n'));
