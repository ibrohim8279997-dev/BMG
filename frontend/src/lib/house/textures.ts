import * as THREE from 'three';

/** Procedural 1 m x 1 m material tiles drawn on a canvas, so the 3D house needs no image files.
 *  Textures are light and nearly grey: the material colour the customer picks tints them (multiply). */
export type TexKind = 'brick' | 'plaster' | 'gasblock' | 'stone' | 'wood' | 'concrete'
  | 'metal' | 'ceramic' | 'seam' | 'shingle' | 'green' | 'lawn' | 'paving' | 'gravel' | 'door' | 'solar' | 'snow';

const SIZE = 512;
const cache = new Map<TexKind, { map: THREE.CanvasTexture; bump: THREE.CanvasTexture }>();

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const g = (v: number) => { const n = Math.max(0, Math.min(255, Math.round(v))); return `rgb(${n},${n},${n})`; };

function noise(c: CanvasRenderingContext2D, r: () => number, amount: number, dots = 9000, base = 128) {
  for (let i = 0; i < dots; i++) { c.fillStyle = g(base + (r() - 0.5) * amount); c.fillRect(r() * SIZE, r() * SIZE, 1 + r() * 2.4, 1 + r() * 2.4); }
}

/** Draws [color, height] pairs into two canvases (colour + bump) at once. */
function draw(kind: TexKind): [HTMLCanvasElement, HTMLCanvasElement] {
  const col = document.createElement('canvas'), bmp = document.createElement('canvas');
  col.width = col.height = bmp.width = bmp.height = SIZE;
  const c = col.getContext('2d')!, b = bmp.getContext('2d')!;
  const r = rng(kind.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
  c.fillStyle = g(235); c.fillRect(0, 0, SIZE, SIZE); b.fillStyle = g(150); b.fillRect(0, 0, SIZE, SIZE);
  const rect = (x: number, y: number, w: number, h: number, cv: number, bv: number) => { c.fillStyle = g(cv); c.fillRect(x, y, w, h); b.fillStyle = g(bv); b.fillRect(x, y, w, h); };
  switch (kind) {
    case 'brick': {            // 25 x 7.5 cm bricks in running bond, 13 courses per metre
      const rows = 13, h = SIZE / rows, w = SIZE / 4;
      rect(0, 0, SIZE, SIZE, 150, 40);
      for (let y = 0; y < rows; y++) for (let x = -1; x < 5; x++) {
        const ox = (y % 2) * (w / 2), v = 205 + r() * 45;
        rect(x * w + ox + 2, y * h + 2, w - 4, h - 4, v, 200 + r() * 40);
      }
      noise(c, r, 40, 7000, 200); break;
    }
    case 'plaster': noise(c, r, 26, 16000, 236); noise(b, r, 90, 14000, 150); break;
    case 'gasblock': {         // 60 x 25 cm aerated concrete blocks with pores
      const rows = 4, h = SIZE / rows, w = SIZE * 0.6;
      rect(0, 0, SIZE, SIZE, 205, 80);
      for (let y = 0; y < rows; y++) for (let x = -1; x < 3; x++) rect(x * w + (y % 2) * (w / 2) + 1.5, y * h + 1.5, w - 3, h - 3, 238 + r() * 10, 170);
      for (let i = 0; i < 1400; i++) { const x = r() * SIZE, y = r() * SIZE, s = 0.6 + r() * 1.8; c.fillStyle = g(190 + r() * 30); c.beginPath(); c.arc(x, y, s, 0, 7); c.fill(); }
      break;
    }
    case 'stone': {            // random ashlar
      rect(0, 0, SIZE, SIZE, 120, 30);
      let y = 0;
      while (y < SIZE) { const h = 50 + r() * 60; let x = -r() * 80; while (x < SIZE) { const w = 70 + r() * 130; rect(x + 3, y + 3, w - 6, h - 6, 190 + r() * 55, 170 + r() * 60); x += w; } y += h; }
      noise(c, r, 36, 9000, 200); break;
    }
    case 'wood': {             // horizontal boards 14 cm, with grain
      const rows = 7, h = SIZE / rows;
      for (let y = 0; y < rows; y++) {
        const v = 205 + r() * 40; rect(0, y * h, SIZE, h - 2, v, 170);
        for (let i = 0; i < 22; i++) { const gy = y * h + 3 + r() * (h - 8); c.strokeStyle = g(v - 25 - r() * 25); c.lineWidth = 0.6 + r(); c.beginPath(); c.moveTo(0, gy); c.bezierCurveTo(SIZE * 0.3, gy + (r() - 0.5) * 6, SIZE * 0.7, gy + (r() - 0.5) * 6, SIZE, gy); c.stroke(); }
        rect(0, y * h + h - 2, SIZE, 2, 90, 40);
      }
      break;
    }
    case 'concrete': {         // 1 m formwork panels with tie holes
      noise(c, r, 30, 18000, 222); noise(b, r, 70, 12000, 150);
      rect(0, 0, SIZE, 3, 150, 60); rect(0, 0, 3, SIZE, 150, 60);
      for (const [x, y] of [[128, 128], [384, 128], [128, 384], [384, 384]]) { c.fillStyle = g(150); c.beginPath(); c.arc(x, y, 6, 0, 7); c.fill(); }
      break;
    }
    case 'metal': {            // profiled metal tile: 5 steps per metre
      const steps = 5, h = SIZE / steps;
      for (let y = 0; y < steps; y++) { const gr = c.createLinearGradient(0, y * h, 0, y * h + h); gr.addColorStop(0, g(250)); gr.addColorStop(0.55, g(215)); gr.addColorStop(1, g(150)); c.fillStyle = gr; c.fillRect(0, y * h, SIZE, h); const gb = b.createLinearGradient(0, y * h, 0, y * h + h); gb.addColorStop(0, g(220)); gb.addColorStop(1, g(60)); b.fillStyle = gb; b.fillRect(0, y * h, SIZE, h); }
      for (let x = 0; x < 3; x++) rect(x * (SIZE / 3), 0, 2, SIZE, 170, 90);
      break;
    }
    case 'ceramic': {          // overlapping round-edged clay tiles
      const rows = 8, h = SIZE / rows, w = SIZE / 6;
      for (let y = rows; y >= -1; y--) for (let x = -1; x < 7; x++) {
        const ox = (y % 2) * (w / 2), v = 215 + r() * 35;
        const gr = c.createLinearGradient(0, y * h, 0, y * h + h * 1.4); gr.addColorStop(0, g(v + 8)); gr.addColorStop(1, g(v - 70));
        c.fillStyle = gr; c.beginPath(); c.roundRect(x * w + ox + 1, y * h, w - 2, h * 1.4, [0, 0, w / 2.4, w / 2.4]); c.fill();
        b.fillStyle = g(190); b.beginPath(); b.roundRect(x * w + ox + 1, y * h, w - 2, h * 1.4, [0, 0, w / 2.4, w / 2.4]); b.fill();
      }
      break;
    }
    case 'seam': {             // standing-seam sheet metal: seams every 50 cm
      for (let x = 0; x < 2; x++) { const gr = c.createLinearGradient(x * 256, 0, x * 256 + 256, 0); gr.addColorStop(0, g(250)); gr.addColorStop(1, g(228)); c.fillStyle = gr; c.fillRect(x * 256, 0, 256, SIZE); rect(x * 256, 0, 6, SIZE, 150, 235); rect(x * 256 + 6, 0, 3, SIZE, 250, 120); }
      noise(c, r, 10, 3000, 240); break;
    }
    case 'shingle': {          // bitumen shingles in staggered tabs
      const rows = 9, h = SIZE / rows, w = SIZE / 4;
      for (let y = 0; y < rows; y++) for (let x = -1; x < 5; x++) { const ox = (y % 2) * (w / 2), v = 205 + r() * 40; rect(x * w + ox + 1, y * h, w - 2, h - 1, v, 150 + r() * 50); }
      for (let y = 0; y < rows; y++) rect(0, y * h + h - 3, SIZE, 3, 120, 70);
      noise(c, r, 40, 12000, 210); break;
    }
    case 'green': {            // sedum / grass roof
      noise(c, r, 70, 26000, 215); noise(b, r, 120, 20000, 150);
      for (let i = 0; i < 700; i++) { const x = r() * SIZE, y = r() * SIZE; c.strokeStyle = g(170 + r() * 80); c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 6, y - 5 - r() * 6); c.stroke(); }
      break;
    }
    case 'lawn': noise(c, r, 90, 40000, 225); for (let i = 0; i < 2400; i++) { const x = r() * SIZE, y = r() * SIZE; c.strokeStyle = g(170 + r() * 85); c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 5, y - 4 - r() * 6); c.stroke(); } break;
    case 'paving': {           // 50 x 25 cm paving slabs
      rect(0, 0, SIZE, SIZE, 150, 40);
      for (let y = 0; y < 4; y++) for (let x = -1; x < 3; x++) rect(x * 256 + (y % 2) * 128 + 2, y * 128 + 2, 252, 124, 205 + r() * 40, 190 + r() * 40);
      noise(c, r, 30, 9000, 215); break;
    }
    case 'gravel': noise(c, r, 120, 36000, 205); noise(b, r, 160, 30000, 150); break;
    case 'snow': noise(c, r, 8, 6000, 250); break;
    case 'door': {             // sectional garage door / planked door: grooves every 50 cm
      rect(0, 0, SIZE, SIZE, 235, 150);
      for (let y = 0; y < 2; y++) rect(0, y * 256, SIZE, 7, 120, 30);
      for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) rect(x * 128 + 24, y * 256 + 40, 80, 176, 245, 190);
      break;
    }
    case 'solar': {            // photovoltaic cells in a frame
      rect(0, 0, SIZE, SIZE, 120, 150);
      for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) { const gr = c.createLinearGradient(x * 85, y * 85, x * 85 + 80, y * 85 + 80); gr.addColorStop(0, g(210)); gr.addColorStop(1, g(150)); c.fillStyle = gr; c.fillRect(x * 85 + 3, y * 85 + 3, 78, 78); }
      for (let x = 0; x < 6; x++) for (let k = 1; k < 4; k++) rect(x * 85 + k * 20, 0, 1, SIZE, 170, 140);
      break;
    }
  }
  return [col, bmp];
}

export function texture(kind: TexKind) {
  let t = cache.get(kind);
  if (!t) {
    const [c, b] = draw(kind);
    const mk = (cv: HTMLCanvasElement, srgb: boolean) => {
      const tx = new THREE.CanvasTexture(cv);
      tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.anisotropy = 8; if (srgb) tx.colorSpace = THREE.SRGBColorSpace;
      return tx;
    };
    t = { map: mk(c, true), bump: mk(b, false) };
    cache.set(kind, t);
  }
  return t;
}

/** Box geometry whose UVs are in metres, so every texture keeps its real-world scale at any size. */
export function boxM(w: number, h: number, d: number) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];   // +x -x +y -y +z -z
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]); }
  uv.needsUpdate = true;
  return geo;
}

export function disposeTextures() { cache.forEach((t) => { t.map.dispose(); t.bump.dispose(); }); cache.clear(); }
