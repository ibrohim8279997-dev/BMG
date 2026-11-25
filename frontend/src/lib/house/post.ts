import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import type { Settings } from './quality';

/** HDR post chain: scene → GTAO (contact shadows) → bloom (only very bright pixels: lamps, lit windows) → AgX tone map + sRGB → vignette → SMAA. */
export class Post {
  composer: EffectComposer;
  private ao: GTAOPass; private bloom: UnrealBloomPass; private smaa: SMAAPass; private vignette: ShaderPass;
  enabled = true;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.ao = new GTAOPass(scene, camera, 1, 1);
    this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.1, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    this.ao.blendIntensity = 0.9;
    this.composer.addPass(this.ao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.5, 2.2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.vignette = new ShaderPass(VignetteShader);
    this.vignette.uniforms.offset.value = 0.95; this.vignette.uniforms.darkness.value = 1.12;
    this.composer.addPass(this.vignette);
    this.smaa = new SMAAPass();
    this.composer.addPass(this.smaa);
  }

  private bloomOk = true;
  apply(s: Settings) {
    this.enabled = s.post; this.bloomOk = s.bloom;
    this.ao.enabled = s.ao; this.bloom.enabled = s.bloom; this.smaa.enabled = s.smaa;
  }

  /** Bloom is a night effect: by day sunlit white walls would glow. */
  setNight(night: number, interior: boolean) {
    // by day the HDR sky is far above any threshold and would veil the whole frame: bloom only after dusk
    this.bloom.enabled = this.bloomOk && night > 0.05;
    this.bloom.strength = night * 0.5;
    this.bloom.threshold = interior ? 3.5 : 1.6;
    this.ao.blendIntensity = interior ? 1 : 0.85;
  }

  setSize(w: number, h: number, pr: number) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); }

  /** Low tier skips the chain: the canvas' own MSAA and the renderer's tone mapping do the job. */
  render() { if (this.enabled) this.composer.render(); else this.renderer.render(this.scene, this.camera); }

  dispose() {
    for (const p of this.composer.passes) p.dispose();
    this.composer.dispose();
  }
}
