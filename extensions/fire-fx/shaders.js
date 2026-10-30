// GLSL of fire-fx (strings only; pure). three's ShaderMaterial prefixes the usual uniforms/attributes (modelMatrix,
// viewMatrix, projectionMatrix, cameraPosition, position, uv, instanceMatrix with USE_INSTANCING). OCTAVES is a define set
// per quality tier (changing it recompiles once).

const NOISE = /* glsl */`
float ffxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float ffxNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ffxHash(i), ffxHash(i + vec2(1.0, 0.0)), f.x), mix(ffxHash(i + vec2(0.0, 1.0)), ffxHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float ffxFbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < OCTAVES; i++) { v += a * ffxNoise(p); p = p * 2.03 + vec2(1.7, -3.1); a *= 0.5; }
  return v;
}`;

/** Flame: a cylindrical billboard (turns about world up towards the camera), base at the instance origin, size = scale. */
export const FLAME_VERTEX = /* glsl */`
attribute vec4 flameParams; // intensity, seed, fakeGlow (1 = no real light), height / width
varying vec2 vUv;
varying vec4 vParams;
void main() {
  vUv = uv;
  vParams = flameParams;
  vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float s = length(instanceMatrix[0].xyz);
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 toCam = cameraPosition - center; toCam.y = 0.0;
  vec3 right = dot(toCam, toCam) > 1e-8 ? normalize(cross(up, toCam)) : vec3(1.0, 0.0, 0.0);
  vec3 p = center + right * position.x * s + up * (position.y + 0.5) * s * flameParams.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

export const FLAME_FRAGMENT = /* glsl */`
uniform float uTime;
varying vec2 vUv;
varying vec4 vParams;
${NOISE}
void main() {
  float intensity = vParams.x, seed = vParams.y * 17.0, glow = vParams.z;
  float t = uTime;
  // Upward turbulence: noise scrolls down in uv space, so its features rise through the flame.
  float n = ffxFbm(vec2(vUv.x * 3.0 + seed, vUv.y * 2.5 - t * 2.2));
  float n2 = ffxFbm(vec2(vUv.x * 6.0 - seed, vUv.y * 5.0 - t * 3.7));
  float x = (vUv.x - 0.5) * 2.0 + (n2 - 0.5) * 0.55 * vUv.y;    // tongues lick sideways, more at the top
  float width = mix(0.85, 0.05, pow(vUv.y, 0.8));                  // teardrop: wide base, thin tip
  float shape = 1.0 - smoothstep(width * 0.5, width, abs(x));
  float heightFade = 1.0 - smoothstep(0.3 + 0.4 * n, 1.0, vUv.y);
  float baseFade = smoothstep(0.0, 0.08, vUv.y);
  float flicker = 0.82 + 0.18 * sin(t * 13.0 + seed) * sin(t * 7.3 + seed * 1.7);
  float heat = shape * heightFade * baseFade * (0.65 + 0.7 * n) * flicker * intensity;
  // Colour ramp: dark red edge -> orange -> white-yellow core.
  vec3 col = mix(vec3(0.35, 0.04, 0.01), vec3(1.0, 0.42, 0.06), smoothstep(0.08, 0.45, heat));
  col = mix(col, vec3(1.0, 0.93, 0.65), smoothstep(0.55, 0.95, heat));
  float alpha = smoothstep(0.02, 0.35, heat);                       // soft edge fade
  // Flames without a real PointLight fake their light with a soft halo.
  float halo = glow * 0.22 * intensity * (1.0 - smoothstep(0.0, 0.55, length(vec2(x * 0.5, vUv.y - 0.3))));
  vec3 outColor = col * alpha + vec3(1.0, 0.45, 0.12) * halo;
  if (alpha + halo < 0.003) discard;
  gl_FragColor = vec4(outColor, 1.0);
}`;

/** Particles: camera-facing quads; pData = heat (1 hot .. 0 cold), alpha, kind, seed. */
export const PARTICLE_VERTEX = /* glsl */`
attribute vec4 pData;
varying vec2 vUv;
varying vec4 vData;
void main() {
  vUv = uv;
  vData = pData;
  vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float s = length(instanceMatrix[0].xyz);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  gl_Position = projectionMatrix * viewMatrix * vec4(c + (right * position.x + up * position.y) * s, 1.0);
}`;

export const PARTICLE_FRAGMENT = /* glsl */`
varying vec2 vUv;
varying vec4 vData;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float soft = vData.z > 1.5 ? 1.0 - smoothstep(0.0, 1.0, r) : 1.0 - smoothstep(0.3, 1.0, r); // puffs are softer
  float a = soft * vData.y;
  if (a < 0.004) discard;
  float heat = vData.x;
  vec3 col = mix(vec3(0.45, 0.05, 0.01), vec3(1.0, 0.45, 0.08), smoothstep(0.0, 0.5, heat));
  col = mix(col, vec3(1.0, 0.95, 0.75), smoothstep(0.6, 1.0, heat));
  gl_FragColor = vec4(col * a, 1.0);
}`;

/** Scorch decal: a quad lying on the surface (instance matrix), procedural burnt ring. */
export const SCORCH_VERTEX = /* glsl */`
attribute float sSeed;
varying vec2 vUv;
varying float vSeed;
void main() {
  vUv = uv;
  vSeed = sSeed;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}`;

export const SCORCH_FRAGMENT = /* glsl */`
varying vec2 vUv;
varying float vSeed;
${NOISE}
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float n = ffxFbm(p * 5.0 + vSeed * 31.0);
  float a = (1.0 - smoothstep(0.35, 1.0, r + (n - 0.5) * 0.6)) * 0.88;
  if (a < 0.01) discard;
  vec3 col = mix(vec3(0.02, 0.015, 0.01), vec3(0.12, 0.07, 0.04), smoothstep(0.2, 0.9, r + n * 0.3));
  gl_FragColor = vec4(col, a);
}`;
