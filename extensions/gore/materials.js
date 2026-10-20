// GameSystems gore extension: materials (three.js, passed in; this file does not import it). One shared set per gore world.
//   capMaterial      stump cross-sections (baked caps): uv.x is the radial coordinate (1 at the skin -> 0 at the
//                    centre): skin edge, a yellow fat line, raw wet meat with fibres, and a bone ring with marrow in the
//                    middle; patch rims show meat. Standard lighting, skinned like the body.
//   insidesMaterial  vertex coloured, wet (procedural organs and bones, insides.js)
//   tearCloth()      torn clothing: fragments of a garment are discarded by a noise pattern (per zombie amount / seed)
//   splatTexture()   blood splat alpha texture (coverage in every channel: alphaMap reads green) (procedural DataTexture), dotTexture() round particle sprite
// All textures are generated in code (no third-party assets).

/** Cap (cross-section) material. blood: '#rrggbb'. */
export function createCapMaterial(THREE, { blood = '#6b0a0a' } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.38, metalness: 0, name: 'GoreCap' });
  const uniforms = { goreBlood: { value: new THREE.Color(blood) } };
  m.userData.gore = uniforms;
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGoreUv;\nvarying vec3 vGoreP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGoreUv = uv;\nvGoreP = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 goreBlood;
varying vec2 vGoreUv;
varying vec3 vGoreP;
float goreHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float goreNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(goreHash(i), goreHash(i + vec3(1,0,0)), f.x), mix(goreHash(i + vec3(0,1,0)), goreHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(goreHash(i + vec3(0,0,1)), goreHash(i + vec3(1,0,1)), f.x), mix(goreHash(i + vec3(0,1,1)), goreHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float r = vGoreUv.x;
  float n = goreNoise(vGoreP * 180.0), n2 = goreNoise(vGoreP * 45.0 + 3.1);
  vec3 meat = mix(vec3(0.42, 0.04, 0.04), vec3(0.62, 0.10, 0.09), n) * (0.75 + 0.35 * n2);
  meat = mix(meat, goreBlood, 0.35 + 0.3 * n2);
  vec3 fat = vec3(0.86, 0.74, 0.46);
  vec3 bone = vec3(0.90, 0.86, 0.74), marrow = vec3(0.45, 0.09, 0.07);
  vec3 c = meat;
  c = mix(c, fat, smoothstep(0.80, 0.86, r) * (1.0 - smoothstep(0.90, 0.95, r)));
  c = mix(c, goreBlood * 0.9, smoothstep(0.93, 1.0, r));
  float boneR = 0.24 + 0.05 * n2;
  c = mix(c, bone, 1.0 - smoothstep(boneR - 0.02, boneR, r));
  c = mix(c, marrow, 1.0 - smoothstep(0.10, 0.13, r));
  diffuseColor.rgb = c;
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.22, 0.6, step(vGoreUv.x, 0.26) - step(vGoreUv.x, 0.12));');
  };
  m.customProgramCacheKey = () => 'gore-cap-v1';
  return m;
}

/** Wet vertex-coloured material for the insides. */
export function createInsidesMaterial(THREE) {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0, name: 'GoreInsides' });
}

/**
 * Torn clothing: discards fragments of `material` where a 3D noise of the rest position falls below `amount` (0..1),
 * with darker blood-soaked edges. One uniform set per material; set material.userData.goreTear.value later to change.
 */
export function tearCloth(THREE, material, { amount = 0.25, seed = 0, blood = '#3a0505' } = {}) {
  if (!material || material.userData.goreTear) return material;
  const uniforms = { goreTear: { value: amount }, goreTearSeed: { value: seed }, goreSoak: { value: new THREE.Color(blood) } };
  material.userData.goreTear = uniforms.goreTear;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTearP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTearP = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float goreTear; uniform float goreTearSeed; uniform vec3 goreSoak;
varying vec3 vTearP;
float tearHash(vec3 p) { p = fract(p * 0.3183099 + goreTearSeed); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float tearNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(tearHash(i), tearHash(i + vec3(1,0,0)), f.x), mix(tearHash(i + vec3(0,1,0)), tearHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(tearHash(i + vec3(0,0,1)), tearHash(i + vec3(1,0,1)), f.x), mix(tearHash(i + vec3(0,1,1)), tearHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float tearN = 0.65 * tearNoise(vTearP * 14.0) + 0.35 * tearNoise(vTearP * 41.0);
if (tearN < goreTear * 0.62) discard;
diffuseColor.rgb = mix(diffuseColor.rgb, goreSoak, 0.8 * (1.0 - smoothstep(goreTear * 0.62, goreTear * 0.62 + 0.06, tearN)) + 0.25 * goreTear * (1.0 - tearNoise(vTearP * 6.0 + 7.0)));`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}|gore-tear`;
  material.needsUpdate = true;
  return material;
}

/** Procedural blood splat alpha (irregular blob with droplets), size × size, deterministic per seed. */
export function splatTexture(THREE, size = 128, seed = 7) {
  const data = new Uint8Array(size * size * 4);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const blobs = [[0.5, 0.5, 0.26]];
  for (let i = 0; i < 9; i++) { const a = rnd() * 6.283, d = 0.18 + rnd() * 0.22; blobs.push([0.5 + Math.cos(a) * d, 0.5 + Math.sin(a) * d, 0.03 + rnd() * 0.08]); }
  for (let i = 0; i < 14; i++) { const a = rnd() * 6.283, d = 0.3 + rnd() * 0.17; blobs.push([0.5 + Math.cos(a) * d, 0.5 + Math.sin(a) * d, 0.008 + rnd() * 0.02]); }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size, v = (y + 0.5) / size;
    let f = 0;
    for (const [bx, by, br] of blobs) f += (br * br) / ((u - bx) ** 2 + (v - by) ** 2 + 1e-5);
    const a = Math.max(0, Math.min(1, (f - 1) * 3));
    const i = 4 * (y * size + x);
    data[i] = data[i + 1] = data[i + 2] = data[i + 3] = Math.round(255 * a); // alphaMap reads green
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.needsUpdate = true; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  return tex;
}

/** Round soft particle sprite. */
export function dotTexture(THREE, size = 32) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2, i = 4 * (y * size + x);
    data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(255 * Math.max(0, Math.min(1, (1 - d) * 3)));
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.needsUpdate = true; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  return tex;
}
