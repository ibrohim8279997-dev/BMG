import type * as THREE from 'three';

/** Render quality tiers. 'auto' picks one from the GPU and screen, then steps down if frames stay slow. */
export type QualityPick = 'auto' | 'high' | 'medium' | 'low';
export type Tier = 'high' | 'medium' | 'low';
export const QUALITY_PICKS: QualityPick[] = ['auto', 'high', 'medium', 'low'];

export type Settings = { tier: Tier; pixelRatio: number; shadowMap: number; shadowRadius: number; post: boolean; ao: boolean; bloom: boolean; smaa: boolean };

export function settingsFor(tier: Tier): Settings {
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  switch (tier) {
    case 'high': return { tier, pixelRatio: Math.min(dpr, 2), shadowMap: 4096, shadowRadius: 4, post: true, ao: true, bloom: true, smaa: true };
    case 'medium': return { tier, pixelRatio: Math.min(dpr, 1.5), shadowMap: 2048, shadowRadius: 3, post: true, ao: true, bloom: true, smaa: true };
    default: return { tier, pixelRatio: Math.min(dpr, 1), shadowMap: 1024, shadowRadius: 2, post: false, ao: false, bloom: false, smaa: false };
  }
}

/** Best guess before the first frame: mobile and integrated GPUs start lower. */
export function detectTier(renderer: THREE.WebGLRenderer): Tier {
  const gl = renderer.getContext();
  let gpu = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
  } catch { /* hidden by the browser */ }
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) return 'low';
  if (coarse) return /apple|adreno (7|8)\d\d|mali-g7\d|xclipse/.test(gpu) && cores >= 6 ? 'medium' : 'low';
  if (/nvidia|geforce|rtx|radeon rx|apple m\d (pro|max|ultra)/.test(gpu)) return 'high';
  if (/apple m\d|apple gpu|iris xe|radeon(tm)? graphics|arc/.test(gpu)) return 'medium';
  if (/intel/.test(gpu)) return cores >= 8 ? 'medium' : 'low';
  return 'medium';
}

/** Rolling frame-time watcher: reports when a full ~2 s window has been measured. */
export class FpsMeter {
  private times: number[] = [];
  fps = 60;
  tick(dt: number) {
    this.times.push(dt); if (this.times.length > 120) this.times.shift();
    const avg = this.times.reduce((a, b) => a + b, 0) / this.times.length;
    this.fps = avg > 0 ? 1 / avg : 60;
    return this.times.length >= 120;
  }
  reset() { this.times = []; }
}

export const lower = (t: Tier): Tier => (t === 'high' ? 'medium' : 'low');
