import * as THREE from 'three';

/** Shader patch that hides texture repetition on large surfaces.
 *  'bomb'  : every lookup blends two randomly offset copies of the tile (Quilez, "texture repetition" #3); for plaster, grass, gravel.
 *  'macro' : keeps the pattern (bricks, tiles) but adds a slow tone variation so no two metres look identical. */
export type AntiTile = 'bomb' | 'macro' | 'none';

const GLSL = /* glsl */ `
float atHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float atNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(atHash(i), atHash(i + vec2(1.0, 0.0)), f.x), mix(atHash(i + vec2(0.0, 1.0)), atHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec4 atSample(sampler2D s, vec2 uv) {
  float k = atNoise(uv * 0.37) * 8.0, i = floor(k), f = fract(k);
  vec2 oa = sin(vec2(3.0, 7.0) * i), ob = sin(vec2(3.0, 7.0) * (i + 1.0));
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  return mix(textureGrad(s, uv + oa, dx, dy), textureGrad(s, uv + ob, dx, dy), smoothstep(0.25, 0.75, f));
}
float atMacro(vec2 uv) { return mix(0.88, 1.1, atNoise(uv * 0.23) * 0.6 + atNoise(uv * 0.071 + 13.0) * 0.4); }
`;

const CHUNKS = ['map_fragment', 'normal_fragment_maps', 'roughnessmap_fragment', 'metalnessmap_fragment', 'aomap_fragment'] as const;
type ChunkName = (typeof CHUNKS)[number];
const chunk = (n: ChunkName) => (THREE.ShaderChunk as unknown as Record<ChunkName, string>)[n];

export function antiTile(m: THREE.MeshStandardMaterial, mode: AntiTile) {
  if (mode === 'none') return;
  m.onBeforeCompile = (shader) => {
    let fs = shader.fragmentShader.replace('#include <common>', `#include <common>\n${GLSL}`);
    for (const c of CHUNKS) {
      let code = mode === 'bomb' ? chunk(c).replace(/texture2D\(\s*(\w+)\s*,\s*(\w+)\s*\)/g, 'atSample( $1, $2 )') : chunk(c);
      if (c === 'map_fragment') code += '\n#ifdef USE_MAP\n  diffuseColor.rgb *= atMacro( vMapUv );\n#endif\n';
      fs = fs.replace(`#include <${c}>`, code);
    }
    shader.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => `anti-${mode}`;
}
