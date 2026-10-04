// Volume-preserving fake liquid with bubbles + foam for bottle_*.glb / container_*.glb (three.js >= 0.160, tested r170).
// Port of shaders/godot/bottle_liquid.gd + bottle_liquid.gdshader (HIGH tier).
//
//   import { setupBottle, setupBottleFromUrl } from './bottle_liquid.js';
//   const b = await setupBottleFromUrl(gltf.scene, '/export/bottle_beer.glb', { fill: 0.7 }); // sidecar -> extras
//   // or sync: setupBottle(gltf.scene, { fill: 0.7, info })   (info = parsed sidecar; omitted -> GLB extras.liquid)
//   b.update(dt);            // every frame; ~free when asleep (one matrix compare every 0.1 s)
//   b.fill = 0.4;            // 0..1 of the interior volume (setter wakes it)
//   b.capOpen = true;        // force the opening live; info.open / a removed or hidden `Cap` node are auto-detected
//
// Data order: explicit opts.info -> <glb>.liquid_v2.json -> <glb>.liquid.json -> GLB extras.liquid (v1 or v2 table,
// decoded by liquid_lut_v2.js; same code path). Open containers clamp the level at the rim via lut.spill().
// Bubbles rise in a "flow frame" whose y axis is world up, parallel-transported each frame so the field never jumps.
// Foam builds from agitation (scaled by extras `foam`) and settles slowly.
//
// Realism tiers: only HIGH (3) is implemented. Lower tiers go in TIER_DEFINES below (a #define per tier selects the
// cheaper paths in LIQUID_FRAG); `quality` is accepted but anything other than 3 currently renders HIGH.
import * as THREE from 'three';
import { makeLut } from './liquid_lut_v2.js';

export const HIGH = 3;
const TIER_DEFINES = { 3: { LIQUID_HIGH: '' } };   // add 2/1/0 here (MEDIUM/LOW/MINIMAL) when needed

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _s = new THREE.Vector3();
const _v = new THREE.Vector3(), _acc = new THREE.Vector3(), _tgt = new THREE.Vector3(), _tq = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------------------------------------------- GLSL
const LIQUID_COMMON = /* glsl */`
uniform mat4 modelMatrix;     // set by three per object (vertex-only by default; declared here for the fragment stage)
varying vec3 vObjPos;
varying vec3 vCamObj;
uniform vec4 uPlane;          // xyz = world up in OBJECT space, w = plane offset (from the baked table)
uniform vec3 uUpWorld;        // effective (slosh-bent) up in world space
uniform vec3 uLiquidColor;    // linear; colour seen through uRefPath of liquid
uniform float uRipple, uAgitation, uCarbonation, uBubbleScale, uFoam, uFoamHeight, uBubbleSize, uRise, uBaseY, uRefPath, uTime;
uniform mat3 uFlowBasis;      // columns = flow axes in object space (column 1 = world up)
uniform vec3 uFlowPivot;
uniform bool uFlipFaces;      // Liquid mesh exported with inverted winding

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(vec2(c, s), vec2(-s, c)); }

float col_yoff(vec2 cid, float seed, float spd, out float sf, out float colh) {
  vec2 hc = hash22(cid + seed);
  colh = hc.y;
  sf = 0.22 + 0.78 * hc.x * hc.x * hc.x;            // power law: many small, few big
  return uRise * spd * (0.35 + 0.65 * sf);           // bigger rises faster
}

void bubble_cell(inout vec3 col, inout vec3 em, vec3 q, vec3 v, vec2 cid, float cy, float yoff, float sf,
    float cell, float cell_y, float rmax, float dens, float seed, vec3 tk, float px, float fade) {
  vec3 id = vec3(cid.x, cy, cid.y) + seed;
  vec3 h = hash33(id);
  if (h.x > dens) return;
  float r = rmax * sf * (0.7 + 0.3 * h.y);
  vec3 jr = max(vec3(0.0), 1.0 - 2.4 * r / vec3(cell, cell_y, cell));
  vec3 j = 0.5 + (hash33(id + 17.17) - 0.5) * jr;
  float yc = (cy + j.y) * cell_y + yoff;
  vec2 wob = (0.06 * cell * sf) * vec2(sin(yc * 230.0 + h.z * 6.283), cos(yc * 170.0 + h.z * 11.0));
  vec3 c = vec3((cid.x + j.x) * cell + wob.x, yc, (cid.y + j.z) * cell + wob.y);
  vec3 d = c - q;
  vec3 perp = d - v * dot(d, v);
  float re = max(r, 0.6 * px);
  float x = length(perp) / re;
  if (x >= 1.0) return;
  float sub = clamp(r / max(px, 1e-6), 0.0, 1.0);
  float aa = clamp(px / re, 0.08, 0.6);
  float a = (1.0 - smoothstep(1.0 - aa, 1.0, x)) * fade * mix(sub * sub, 1.0, 0.25);
  vec3 m = -perp / re;
  vec3 n = m + v * sqrt(max(1.0 - x * x, 0.0));
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 R = reflect(-v, n);
  float ring = smoothstep(0.6, 0.9, x);
  float env = mix(0.1, 1.0, smoothstep(-0.3, 0.8, R.y));
  float spec = pow(max(dot(n, normalize(v + up * 1.1 + vec3(-0.4, 0.0, 0.0))), 0.0), 60.0);
  vec3 upp = up - v * dot(up, v);
  upp *= inversesqrt(max(dot(upp, upp), 1e-4));
  float caus = 1.0 - smoothstep(0.0, 0.42, length(m + upp * 0.45));
  float rim = smoothstep(0.86, 1.0, x);
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  vec3 lens = mix(col, vec3(lum), 0.3) * 1.25 + 0.012;
  vec3 inside = mix(lens, col * 0.4, ring) * (1.0 - rim * 0.7);
  col = mix(col, inside, a);
  vec3 tw = mix(tk, vec3(1.0), 0.35);
  em += a * (tw * ring * (1.0 - rim * 0.6) * (env * 0.42 + 0.05) + tw * spec * 1.8 + tk * caus * 0.3 * (1.0 - ring));
}

void bubble_layer(inout vec3 col, inout vec3 em, vec3 q, vec3 v, float cell, float cell_y, float rmax,
    float spd, float d_small, float d_big, float colfrac, float seed, vec3 tk, float px, float fade) {
  vec2 g = q.xz / cell;
  vec2 cid = floor(g);
  vec2 fg = g - cid;
  float sf, ch;
  float yoff = col_yoff(cid, seed, spd, sf, ch);
  float gy = (q.y - yoff) / cell_y;
  float cy = floor(gy);
  float fy = gy - cy;
  if (ch <= colfrac) bubble_cell(col, em, q, v, cid, cy, yoff, sf, cell, cell_y, rmax, mix(d_small, d_big, sf), seed, tk, px, fade);
  vec3 dist = vec3(min(fg.x, 1.0 - fg.x) * cell, min(fy, 1.0 - fy) * cell_y, min(fg.y, 1.0 - fg.y) * cell);
  if (dist.y <= min(dist.x, dist.z)) {
    if (ch <= colfrac) bubble_cell(col, em, q, v, cid, cy + (fy < 0.5 ? -1.0 : 1.0), yoff, sf, cell, cell_y, rmax, mix(d_small, d_big, sf), seed, tk, px, fade);
  } else {
    vec2 nid = cid + (dist.x < dist.z ? vec2(fg.x < 0.5 ? -1.0 : 1.0, 0.0) : vec2(0.0, fg.y < 0.5 ? -1.0 : 1.0));
    float sf2, ch2;
    float yoff2 = col_yoff(nid, seed, spd, sf2, ch2);
    if (ch2 <= colfrac) bubble_cell(col, em, q, v, nid, floor((q.y - yoff2) / cell_y), yoff2, sf2, cell, cell_y, rmax, mix(d_small, d_big, sf2), seed, tk, px, fade);
  }
}

vec2 voro3(vec3 x) {
  vec3 n = floor(x - 0.5); vec3 f = x - n; float f1 = 8.0, f2 = 8.0;
  for (int k = 0; k < 8; k++) {
    vec3 g = vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 r = g + 0.2 + 0.6 * hash33(n + g) - f; float dd = dot(r, r);
    if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) { f2 = dd; }
  }
  return sqrt(vec2(f1, f2));
}
vec2 voro2(vec2 x) {
  vec2 n = floor(x - 0.5); vec2 f = x - n; float f1 = 8.0, f2 = 8.0;
  for (int k = 0; k < 4; k++) {
    vec2 g = vec2(float(k & 1), float(k >> 1));
    vec2 r = g + 0.2 + 0.6 * hash22(n + g) - f; float dd = dot(r, r);
    if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) { f2 = dd; }
  }
  return sqrt(vec2(f1, f2));
}
float snoise(vec3 p) { return 0.5 + 0.25 * (sin(p.x * 1.7 + sin(p.z * 2.3)) * sin(p.y * 1.9 + sin(p.x * 1.3)) + sin(p.z * 2.9 + p.y * 1.1) * 0.6); }
`;

// Runs right after clipping: discard above the plane, then computes lAlbedo / lEmit / lRough / lSpec (Godot ALBEDO,
// EMISSION, ROUGHNESS, SPECULAR) and lSurf (true = this fragment shows the liquid surface through the cut).
const LIQUID_FRAG = /* glsl */`
vec3 lAlbedo, lEmit; float lRough, lSpec; bool lSurf; vec3 lSurfN;
{
  float px = length(fwidth(vObjPos));
  vec3 u = normalize(uPlane.xyz);
  float h = dot(vObjPos, u) - uPlane.w;
  h -= uRipple * 0.0015 * sin(uTime * 9.0 + vObjPos.x * 90.0 + vObjPos.z * 70.0);
  if (h > 0.0) discard;
  vec3 vd = normalize(vCamObj - vObjPos);
  vec3 lc = log(max(uLiquidColor, vec3(1e-4)));
  float bs = clamp(uBubbleScale, 0.0, 1.0);
  float carb = uCarbonation * bs;
  float ag = uAgitation * bs;
  float fm = clamp(uFoam * bs, 0.0, 1.0);
  vec3 foam_col = mix(vec3(0.95, 0.93, 0.88), pow(uLiquidColor, vec3(0.25)), 0.35);
  mat3 F = uFlowBasis;
  vec3 vq = vd * F;
  lSurf = gl_FrontFacing == uFlipFaces;
  lSurfN = u;
  if (!lSurf) {
    vec3 rd = -vd;
    vec2 o2 = vObjPos.xz; vec2 d2 = rd.xz;
    float a2 = max(dot(d2, d2), 1e-5); float b2 = dot(o2, d2); float rr = dot(o2, o2);
    float L = b2 < 0.0 ? -2.0 * b2 / a2 : 0.002;
    float ru = dot(rd, u);
    if (ru > 1e-4) L = min(L, -h / ru);
    if (rd.y < -1e-4) L = min(L, (vObjPos.y - uBaseY) / -rd.y);
    L = max(L, 0.0);
    vec3 col = exp(lc * clamp(L / uRefPath, 0.3, 3.0));
    col = mix(col, col * 1.4 + uLiquidColor * 0.03, ag * ag * (0.2 + 0.4 * carb));
    vec3 em = vec3(0.0);
    float dsurf0 = -h;
    if (carb + ag > 0.001) {
      for (int k = 0; k < 3; k++) {
        float f = k == 0 ? 0.25 : (k == 1 ? 0.58 : 0.84);
        float cc = rr * (1.0 - f * f);
        float disc = b2 * b2 - a2 * cc;
        if (disc <= 0.0 || b2 >= 0.0) continue;
        float t = (-b2 - sqrt(disc)) / a2;
        float fade = smoothstep(0.0, 0.2 * b2 * b2, disc) * (1.0 - smoothstep(L - 0.004, L, t));
        if (fade <= 0.0) continue;
        vec3 p = vObjPos + rd * t;
        float ds = uPlane.w - dot(p, u);
        vec3 q = (p - uFlowPivot) * F;
        vec3 v = vq;
        mat2 R2 = rot2(1.3 + float(k) * 2.1);
        q.xz = R2 * q.xz; v.xz = R2 * v.xz;
        vec3 tk = exp(lc * (t / uRefPath));
        float agd = clamp(ag * 1.7 - ds * 3.0, 0.0, 1.0);
        float d_small = carb * 0.25 + smoothstep(0.03, 0.45, agd) * 0.9;
        float d_big = carb * 0.06 + smoothstep(0.45, 0.95, agd) * 0.9;
        float pxk = px * (1.0 + t * 3.0);
        if (k == 0) bubble_layer(col, em, q, v, 0.003, 0.003, 0.0008 * uBubbleSize, 0.03, d_small, d_big, 1.0, 11.0, tk, pxk, fade);
        else if (k == 1) bubble_layer(col, em, q, v, 0.0085, 0.0085, 0.0021 * uBubbleSize, 0.06, d_small, d_big, 1.0, 23.0, tk, pxk, fade);
        else { float st = carb * 0.4 + ag * 0.3; bubble_layer(col, em, q, v, 0.011, 0.0035, 0.0009 * uBubbleSize, 0.07, 0.8, 0.8, st, 37.0, tk, pxk, fade); }
      }
      mat3 W = mat3(vec3(0.8, 0.36, -0.48), vec3(-0.6, 0.48, -0.64), vec3(0.0, 0.8, 0.6));
      float dw = carb * 0.5 + ag * 0.35;
      if (dw > 0.0) bubble_layer(col, em, vObjPos * W, vd * W, 0.0055, 0.0055, 0.0016 * uBubbleSize, 0.0, dw, dw * 0.6, 1.0, 51.0, vec3(1.0), px, 1.0);
    }
    float head = fm * uFoamHeight;
    float fmask = 0.0;
    if (head > 0.0004 && dsurf0 < head * 1.4) {
      vec3 qf = (vObjPos - uFlowPivot) * F + vec3(0.0, uRise * 0.0003, 0.0);
      float fd = clamp(dsurf0 / head, 0.0, 1.4);
      vec2 a = voro3(qf * (900.0 * mix(1.1, 0.55, min(fd, 1.0))));
      float edge = 1.0 - smoothstep(0.0, 0.1, a.y - a.x);
      float nz = snoise(qf * 260.0);
      float fb = fd + (nz - 0.5) * 0.4 + (a.x - 0.45) * 0.3;
      fmask = 1.0 - smoothstep(0.82, 1.0, fb);
      float wet = smoothstep(0.35, 0.95, fd);
      vec3 fcol = foam_col * (0.9 + 0.1 * smoothstep(0.05, 0.6, a.x)) * (1.0 - edge * mix(0.08, 0.3, wet));
      fcol = mix(fcol, mix(col * 1.3 + 0.03, foam_col, 0.45), wet * 0.55 * (1.0 - edge));
      col = mix(col, fcol, fmask);
      em = mix(em, fcol * 0.12, fmask);
    }
    float men = 1.0 - smoothstep(0.0, 0.0014, dsurf0);
    em += vec3(0.22) * men * (1.0 - fmask);
    lAlbedo = col * 0.8;
    lEmit = col * 0.2 + col * 0.15 + em;        // + 0.15: stands in for Godot BACKLIGHT (col * 0.6)
    lRough = mix(0.1, 0.65, fmask);
    lSpec = mix(0.12, 0.2, fmask);
  } else {
    float vu = max(dot(vd, u), 0.03);
    float st = -h / vu;
    vec3 ps = vObjPos + vd * st;
    vec3 qs = (ps - uFlowPivot) * F;
    vec3 col = exp(lc * clamp(st / uRefPath, 0.3, 3.0));
    col = mix(col, col * 1.4 + uLiquidColor * 0.03, ag * ag * (0.2 + 0.4 * carb));
    vec2 g = vec2(cos(qs.x * 140.0 + uTime * 7.0) + 0.6 * cos(qs.x * 90.0 + qs.z * 120.0 - uTime * 9.0),
                  cos(qs.z * 150.0 - uTime * 8.0) + 0.6 * cos(qs.x * 90.0 + qs.z * 120.0 - uTime * 9.0));
    lSurfN = normalize(u + (F * vec3(g.x, 0.0, g.y)) * (0.02 + uRipple * 0.12));
    float rim = 1.0 - smoothstep(0.0, 0.006, st * vu);
    vec2 v1 = voro2(qs.xz * 520.0);
    vec2 v2 = voro2(qs.xz * 1300.0 + 7.3);
    float isl = snoise(vec3(qs.xz * 90.0, 3.1).xzy);
    float cover = clamp(fm * 1.6 + rim * (0.35 * carb + fm) - 0.5 + isl * 0.6, 0.0, 1.0);
    cover = smoothstep(0.35, 0.65, cover) * step(0.001, fm + carb);
    float edge = 1.0 - smoothstep(0.0, 0.14, v1.y - v1.x);
    float edge2 = 1.0 - smoothstep(0.0, 0.18, v2.y - v2.x);
    vec3 fcol = foam_col * (0.68 + 0.32 * smoothstep(0.1, 0.7, v1.x)) + vec3(0.15) * max(edge, edge2 * 0.6);
    float holes = smoothstep(0.25, 0.45, v2.x) * (1.0 - smoothstep(0.65, 0.95, cover + fm * 0.4));
    fcol = mix(fcol, col * 1.4 + 0.05, holes * 0.6);
    col = mix(col, fcol, cover);
    lAlbedo = col * 0.8;
    lEmit = col * 0.25 + col * 0.12;           // + 0.12: stands in for Godot BACKLIGHT (col * 0.5)
    lRough = mix(0.04, 0.7, cover);
    lSpec = mix(0.5, 0.25, cover);
  }
}
`;

/** Liquid material (MeshStandardMaterial + injected HIGH-tier liquid code). `uniforms` is shared with the driver. */
export function makeLiquidMaterial(quality = HIGH) {
  const u = {
    uPlane: { value: new THREE.Vector4(0, 1, 0, 1) }, uUpWorld: { value: new THREE.Vector3(0, 1, 0) },
    uLiquidColor: { value: new THREE.Color(0.8, 0.5, 0.1) },
    uRipple: { value: 0 }, uAgitation: { value: 0 }, uCarbonation: { value: 0 }, uBubbleScale: { value: 1 },
    uFoam: { value: 0 }, uFoamHeight: { value: 0.022 }, uBubbleSize: { value: 1 }, uRise: { value: 0 },
    uBaseY: { value: 0 }, uRefPath: { value: 0.045 }, uTime: { value: 0 },
    uFlowBasis: { value: new THREE.Matrix3() }, uFlowPivot: { value: new THREE.Vector3(0, 0.08, 0) }, uFlipFaces: { value: false },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0, side: THREE.DoubleSide });
  mat.defines = { ...(TIER_DEFINES[quality] || TIER_DEFINES[HIGH]) };
  mat.userData.u = u;
  mat.customProgramCacheKey = () => 'bottle_liquid_v2_q' + quality;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vCamObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;\nvCamObj = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + LIQUID_COMMON)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + LIQUID_FRAG)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = lAlbedo;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = lRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (lSurf) { vec3 nw = normalize(mat3(modelMatrix) * lSurfN); nw = normalize(mix(uUpWorld, nw, 0.999)); normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz); }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = lEmit;')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.specularColor *= lSpec / 0.5;');   // Godot SPECULAR 0.5 = F0 0.04
  };
  return mat;
}

/** Signed volume of the Liquid geometry (> 0 when faces point outward). Negative -> inverted winding -> flip_faces. */
export function signedVolume(geo) {
  const P = geo.attributes.position, I = geo.index; let v = 0;
  const n = I ? I.count : P.count, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i + 2 < n; i += 3) {
    const i0 = I ? I.getX(i) : i, i1 = I ? I.getX(i + 1) : i + 1, i2 = I ? I.getX(i + 2) : i + 2;
    a.fromBufferAttribute(P, i0); b.fromBufferAttribute(P, i1); c.fromBufferAttribute(P, i2);
    v += a.dot(b.cross(c));
  }
  return v / 6;   // three/glTF winding is CCW-outward (Godot's sign is the opposite, hence its -v)
}

function findLiquid(root) {
  let liquid = null, cap = null;
  root.traverse((o) => {
    if (!liquid && o.isMesh && o.name.startsWith('Liquid')) liquid = o;
    if (!cap && o.name.startsWith('Cap')) cap = o;
  });
  if (!liquid) throw new Error('no Liquid mesh under ' + root.name);
  return { liquid, cap };
}

async function fetchJson(url) {
  try { const r = await fetch(url); if (!r.ok) return null; const j = await r.json(); return j && typeof j === 'object' ? j : null; } catch { return null; }
}

/** Data order: <glb>.liquid_v2.json -> <glb>.liquid.json -> GLB extras.liquid (returns the parsed info). */
export async function loadLiquidInfo(root, glbUrl) {
  if (glbUrl) {
    const base = glbUrl.replace(/\.glb(\?.*)?$/i, '');
    const d = (await fetchJson(base + '.liquid_v2.json')) || (await fetchJson(base + '.liquid.json'));
    if (d) return d;
  }
  const ex = findLiquid(root).liquid.userData.liquid;
  if (!ex) throw new Error('no liquid table (extras.liquid missing; pass a .liquid.json sidecar)');
  return typeof ex === 'string' ? JSON.parse(ex) : ex;
}

export async function setupBottleFromUrl(root, glbUrl, opts = {}) {
  return setupBottle(root, { ...opts, info: opts.info || (await loadLiquidInfo(root, glbUrl)) });
}

function visibleInTree(o) { for (; o; o = o.parent) if (!o.visible) return false; return true; }

/**
 * Drive the liquid of a loaded bottle/container scene. Options: fill, slosh, bubbles (0..1), carbonation (-1 = baked),
 * capOpen, allowSleep, foamCapacity (-1 = baked `foam`), foamSettle, quality (only 3 = HIGH implemented), info.
 */
export function setupBottle(root, opts = {}) {
  const { liquid, cap } = findLiquid(root);
  let info = opts.info || liquid.userData.liquid;
  if (typeof info === 'string') info = JSON.parse(info);
  const lut = makeLut(info);
  const mat = makeLiquidMaterial(opts.quality ?? HIGH), U = mat.userData.u;
  const c = info.color;
  U.uLiquidColor.value.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);   // Godot: source_color (sRGB -> linear)
  const bnd = info.bounds || {};
  const z0 = info.z0 ?? (bnd.min ? bnd.min[1] : 0), z1 = info.z1 ?? (bnd.max ? bnd.max[1] : 0.2);
  U.uBaseY.value = z0;
  U.uFlowPivot.value.set(0, z0 + (z1 - z0) * 0.4, 0);
  U.uBubbleSize.value = info.bubble_size ?? 1;
  const foamH = info.foam_height ?? 0.022;
  U.uFoamHeight.value = foamH;
  U.uFlipFaces.value = signedVolume(liquid.geometry) < 0;
  liquid.material = mat;
  liquid.frustumCulled = false;
  liquid.renderOrder = 0;
  root.traverse((o) => { if (o.isMesh && o.name.startsWith('Glass')) o.renderOrder = 1; });   // glass after the liquid

  // --- state (mirrors BottleLiquid.gd) ---
  const upEff = new THREE.Vector3(0, 1, 0), vel = new THREE.Vector3(), lastPos = new THREE.Vector3(), lastVel = new THREE.Vector3();
  const lastMat = new THREE.Matrix4(), upObj = new THREE.Vector3(), memoUp = new THREE.Vector3(9, 9, 9);
  const flowX = new THREE.Vector3(1, 0, 0), flowUp = new THREE.Vector3(0, 1, 0), fz = new THREE.Vector3();
  let first = true, kick = 0, agit = 0, foam = 0, rise = 0, time = 0, stable = 0, sleeping = false, poll = 0;
  let appFill = -1, appOpen = false, memoFill = -1, memoOpen = false, foamScale = 1;
  let fill = opts.fill ?? 0.6, slosh = opts.slosh ?? true, bubbles = opts.bubbles ?? 1, carbonation = opts.carbonation ?? -1, capOpen = opts.capOpen ?? false;

  const S = {
    liquid, material: mat, uniforms: U, lut, info,
    allowSleep: opts.allowSleep ?? true,
    foamCapacity: opts.foamCapacity ?? -1, foamSettle: opts.foamSettle ?? 0.18,
    lastSpill: { d: 0, fill: 0, spilled: false, lost: 0 },
    workFrames: 0,   // frames that did real work (for tests / profiling)
    get fill() { return fill; }, set fill(v) { fill = v; S.wake(); },
    get slosh() { return slosh; }, set slosh(v) { slosh = v; S.wake(); },
    get bubbles() { return bubbles; }, set bubbles(v) { bubbles = v; S.wake(); },
    get carbonation() { return carbonation; }, set carbonation(v) { carbonation = v; S.wake(); },
    get capOpen() { return capOpen; }, set capOpen(v) { capOpen = v; S.wake(); },
    get sleeping() { return sleeping; },
    get foam() { return foam; }, get agitation() { return agit; },
    isOpen() {
      if (info.open || capOpen) return true;
      return info.closed_by != null && (!cap || !cap.parent || !visibleInTree(cap));
    },
    wake() { if (!sleeping) return; sleeping = false; first = true; lastVel.set(0, 0, 0); },
    /** Inject a shake (0..1) without moving the node, e.g. on an impact. */
    agitate(a = 1) { agit = Math.min(1, Math.max(agit, a)); S.wake(); },
    update(dt = 1 / 60) {
      if (sleeping) {   // ~zero idle cost: one matrix compare at 10 Hz
        poll += dt; if (poll < 0.1) return; poll = 0;
        liquid.updateWorldMatrix(true, false);
        if (!liquid.matrixWorld.equals(lastMat) || S.isOpen() !== appOpen || Math.abs(fill - appFill) > 1e-7) S.wake(); else return;
      }
      apply(dt);
      if (S.allowSleep && atRest()) sleep();
    },
  };

  function carb() { return carbonation < 0 ? (info.carbonation ?? 0) : carbonation; }
  function atRest() {
    if (carb() * bubbles > 0.001) return false;   // fizz animates with rise: keep running
    if (agit > 0.001 || foam > 0.004 || kick > 0.001) return false;
    if (slosh && (vel.length() > 0.002 || upEff.distanceTo(UP) > 0.0002)) return false;
    return stable >= 3;
  }
  function sleep() {
    agit = foam = kick = 0; vel.set(0, 0, 0); upEff.set(0, 1, 0);
    U.uRipple.value = 0; U.uFoam.value = 0; U.uAgitation.value = 0; U.uUpWorld.value.set(0, 1, 0);
    sleeping = true; poll = 0;
  }
  function apply(dt) {
    S.workFrames++;
    dt = Math.min(Math.max(dt, 1 / 240), 1 / 30);
    liquid.updateWorldMatrix(true, false);
    liquid.matrixWorld.decompose(_p, _q, _s);
    if (first) { lastPos.copy(_p); first = false; }
    const still = _p.distanceToSquared(lastPos) < 1e-12 && liquid.matrixWorld.equals(lastMat) && Math.abs(fill - appFill) < 1e-7;
    stable = still ? stable + 1 : 0;
    lastMat.copy(liquid.matrixWorld); appFill = fill;
    _v.copy(_p).sub(lastPos).divideScalar(dt);
    _acc.copy(_v).sub(lastVel).divideScalar(dt);
    lastPos.copy(_p); lastVel.copy(_v);
    _tgt.set(0, 1, 0);
    if (slosh) {
      _tgt.addScaledVector(_acc, -0.06 / 9.81).addScaledVector(_v, -0.01).normalize();
      vel.addScaledVector(_tgt.sub(upEff), 160 * dt).multiplyScalar(Math.max(0, 1 - 5.5 * dt));
      upEff.addScaledVector(vel, dt).normalize();
      kick = Math.min(1, kick * Math.max(0, 1 - 2.5 * dt) + vel.length() * 0.15);
      agit = Math.min(1, Math.max(agit * Math.max(0, 1 - dt), vel.length() * 0.5));
    } else upEff.copy(_tgt);
    upObj.copy(upEff).applyQuaternion(_qi.copy(_q).invert()).normalize();
    const open = S.isOpen(); appOpen = open;
    if (open !== memoOpen || fill !== memoFill || Math.abs(upObj.x - memoUp.x) + Math.abs(upObj.y - memoUp.y) + Math.abs(upObj.z - memoUp.z) > 1e-7) {
      memoUp.copy(upObj); memoFill = fill; memoOpen = open;
      let d;
      if (open) { S.lastSpill = lut.spill(upObj, fill); d = S.lastSpill.d; }
      else { d = lut.offset(upObj, fill); S.lastSpill = { d, fill, spilled: false, lost: 0 }; }
      U.uPlane.value.set(upObj.x, upObj.y, upObj.z, d);
      // the head keeps its volume: thickness ~ 1 / surface area; area = dV/d(offset), from the same LUT
      const f0 = Math.min(0.95, Math.max(0.05, fill));
      const dd = lut.offset(upObj, f0 + 0.04) - lut.offset(upObj, f0 - 0.04);
      const ddUp = lut.offset(UP, f0 + 0.04) - lut.offset(UP, f0 - 0.04);
      foamScale = Math.min(1.5, Math.max(0.2, dd / Math.max(ddUp, 1e-5)));
      U.uFoamHeight.value = foamH * foamScale;
    }
    U.uUpWorld.value.copy(upEff);
    U.uRipple.value = kick;
    // flow frame: minimal-arc rotation from last frame's up to this one (never flips), then re-orthonormalise
    if (flowUp.dot(upObj) < 0.9999) { _tq.setFromUnitVectors(flowUp, upObj); flowX.applyQuaternion(_tq); }
    flowUp.copy(upObj);
    flowX.addScaledVector(upObj, -flowX.dot(upObj)).normalize();
    fz.crossVectors(flowX, upObj);
    U.uFlowBasis.value.set(flowX.x, upObj.x, fz.x, flowX.y, upObj.y, fz.y, flowX.z, upObj.z, fz.z);   // columns = axes
    rise = (rise + dt) % 600; time += dt;
    U.uRise.value = rise; U.uTime.value = time;
    const capF = S.foamCapacity < 0 ? (info.foam ?? 0) : S.foamCapacity;
    const ft = agit * capF;
    foam = ft > foam ? Math.min(ft, foam + 4 * dt) : foam * Math.max(0, 1 - S.foamSettle * dt);
    U.uFoam.value = foam; U.uAgitation.value = agit;
    U.uCarbonation.value = carb(); U.uBubbleScale.value = bubbles;
  }

  apply(1 / 60);
  return S;
}
