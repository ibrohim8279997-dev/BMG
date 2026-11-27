// Decodes every public/textures/<id>/{albedo,normal,orm}.ktx2 with the Basis transcoder (in Node, where no CSP applies)
// and writes full-size WebP twins next to them. The browser uses the WebP set when the page CSP blocks the transcoder
// (it needs 'unsafe-eval'), so the 3D house keeps its full PBR look (colour + normal + AO/roughness/metal) everywhere.
//
//   node scripts/assets/ktx2-webp.mjs [--force] [id ...]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEX = join(ROOT, 'public', 'textures'), LIB = join(ROOT, 'public', 'libs', 'basis');
const args = process.argv.slice(2), force = args.includes('--force'), only = args.filter((a) => !a.startsWith('--'));
const QUALITY = { albedo: 88, normal: 92, orm: 86 };
const RGBA32 = 13;   // basis TranscoderTextureFormat.cTFRGBA32

const BASIS = createRequire(import.meta.url)(join(LIB, 'basis_transcoder.js'));
const M = await BASIS({ wasmBinary: readFileSync(join(LIB, 'basis_transcoder.wasm')) });
M.initializeBasis();

function decode(file) {
  const k = new M.KTX2File(new Uint8Array(readFileSync(file)));
  try {
    if (!k.isValid() || !k.startTranscoding()) throw new Error(`cannot read ${file}`);
    const w = k.getWidth(), h = k.getHeight(), out = new Uint8Array(k.getImageTranscodedSizeInBytes(0, 0, 0, RGBA32));
    if (!k.transcodeImage(out, 0, 0, 0, RGBA32, 0, -1, -1)) throw new Error(`cannot transcode ${file}`);
    return { w, h, data: Buffer.from(out) };
  } finally { k.close(); k.delete(); }
}

const ids = readdirSync(TEX).filter((d) => statSync(join(TEX, d)).isDirectory() && existsSync(join(TEX, d, 'albedo.ktx2')) && (!only.length || only.includes(d)));
let made = 0;
for (const id of ids) for (const map of ['albedo', 'normal', 'orm']) {
  const src = join(TEX, id, `${map}.ktx2`), dst = join(TEX, id, `${map}.webp`);
  if (!existsSync(src) || (!force && existsSync(dst) && statSync(dst).mtimeMs >= statSync(src).mtimeMs)) continue;
  const { w, h, data } = decode(src);
  await sharp(data, { raw: { width: w, height: h, channels: 4 } }).removeAlpha()
    .webp({ quality: QUALITY[map], effort: 5, smartSubsample: map === 'albedo' }).toFile(dst);
  made++;
}
console.log(`ktx2-webp: ${made} file(s) written for ${ids.length} set(s)`);
