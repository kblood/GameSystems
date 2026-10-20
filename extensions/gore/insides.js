// GameSystems gore extension: procedural insides (skeleton, organs, flesh lining), fitted from the rest joints. Pure (no
// three.js); character.js turns the parts into vertex-coloured meshes on the bones. Nothing here is a third-party asset.
//
//   buildInsides(heads, { body, capAxis, layers }) -> [{ key, layer, joint, positions, normals, colors, indices }]
//     heads   rest joint heads in the character frame (restHeads()) — the current sliders; parts scale with them
//     body    the bake's torso measures (bake json `body`) at the base body; scaled by the current shoulder / hip width
//     capAxis the bake's cap positions along each limb axis ({ seam: { variant: t } }) for the bone stubs
//     layers  { bones, organs, flesh } (config `insides`)
//   key      when the part shows: 'cavity:<region>' (a patch of the region is open: the lining, organs and bones behind
//            it), 'stub:<seam>' (bone stump sticking out of both caps of a severed limb seam; joint = the parent side's
//            bone, gibJoint = the child side's), 'spill:<seam>' (guts hanging out of the waist stump)
//   layer    'bones' | 'organs' | 'flesh'; positions/normals in the rest character frame (+X left, +Y up, +Z forward)
// The flesh lining is an inward-facing (reversed winding) ellipsoid: through a hole you see its far wall, not the
// background through the back of the skin.
import { REGION } from './regions.js';

export const COLORS = Object.freeze({
  bone: [0.86, 0.82, 0.70], marrow: [0.55, 0.12, 0.10], lining: [0.38, 0.03, 0.03], lung: [0.72, 0.36, 0.40], heart: [0.45, 0.05, 0.06],
  liver: [0.33, 0.08, 0.06], stomach: [0.75, 0.48, 0.45], gut: [0.80, 0.52, 0.48], brain: [0.82, 0.60, 0.60], muscle: [0.55, 0.08, 0.07],
});

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function frame(axis) {
  const ref = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(ref, axis)), v = cross(axis, u);
  return [u, v];
}

/** Mesh builder: positions/normals/colours/indices with a uniform colour per call (slight deterministic mottling). */
function builder() {
  const P = [], N = [], C = [], I = [];
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return {
    P, N, C, I,
    vertex(p, n, col, mottle = 0.08) { const k = 1 - mottle + 2 * mottle * rnd(); P.push(...p); N.push(...norm(n)); C.push(col[0] * k, col[1] * k, col[2] * k); return P.length / 3 - 1; },
    tri(a, b, c, flip = false) { if (flip) I.push(a, c, b); else I.push(a, b, c); },
  };
}

/** Ellipsoid: centre, radii [x, y, z], optional lumpiness (brain / guts). flip: inward facing. */
function ellipsoid(b, c, r, col, { seg = 14, rings = 10, flip = false, lump = 0 } = {}) {
  const base = b.P.length / 3;
  for (let i = 0; i <= rings; i++) {
    const th = Math.PI * i / rings;
    for (let j = 0; j <= seg; j++) {
      const ph = 2 * Math.PI * j / seg, n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
      const k = 1 + lump * Math.sin(5 * th + 3 * ph) * Math.sin(3 * th - 4 * ph);
      b.vertex([c[0] + r[0] * n[0] * k, c[1] + r[1] * n[1] * k, c[2] + r[2] * n[2] * k], flip ? mul([n[0] / r[0], n[1] / r[1], n[2] / r[2]], -1) : [n[0] / r[0], n[1] / r[1], n[2] / r[2]], col);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a = base + i * (seg + 1) + j, d = a + seg + 1;
    b.tri(a, a + 1, d, flip); b.tri(a + 1, d + 1, d, flip); // counter-clockwise seen from outside
  }
}

/** Tube along a polyline with radius r (array or number), closed ends. */
function tube(b, path, r, col, { seg = 8, caps = true, mottle = 0.08 } = {}) {
  const rad = i => (Array.isArray(r) ? r[i] : r), base = b.P.length / 3, n = path.length;
  for (let i = 0; i < n; i++) {
    const t = norm(sub(path[Math.min(n - 1, i + 1)], path[Math.max(0, i - 1)])), [u, v] = frame(t);
    for (let j = 0; j <= seg; j++) {
      const a = 2 * Math.PI * j / seg, d = add(mul(u, Math.cos(a)), mul(v, Math.sin(a)));
      b.vertex(add(path[i], mul(d, rad(i))), d, col, mottle);
    }
  }
  for (let i = 0; i + 1 < n; i++) for (let j = 0; j < seg; j++) {
    const a = base + i * (seg + 1) + j, d = a + seg + 1;
    b.tri(a, a + 1, d); b.tri(a + 1, d + 1, d); // (u, v, t) is right-handed: this winding faces outward
  }
  if (!caps) return;
  for (const [end, dir] of [[0, -1], [n - 1, 1]]) {
    const t = mul(norm(sub(path[Math.min(n - 1, end + 1)], path[Math.max(0, end - 1)])), dir);
    const c = b.vertex(path[end], t, col);
    for (let j = 0; j < seg; j++) { const a = base + end * (seg + 1) + j; b.tri(c, dir > 0 ? a + 1 : a, dir > 0 ? a : a + 1); }
  }
}

/** Long bone stub: shaft with a marrow end face at `tip`, from `from`. */
function boneStub(b, from, tip, r) {
  tube(b, [from, lerp(from, tip, 0.5), tip], [r * 1.25, r, r * 1.1], COLORS.bone, { seg: 8, caps: false, mottle: 0.05 });
  const t = norm(sub(tip, from)), [u, v] = frame(t), c = b.vertex(add(tip, mul(t, r * 0.15)), t, COLORS.marrow), ring = [];
  for (let j = 0; j <= 8; j++) { const a = 2 * Math.PI * j / 8; ring.push(b.vertex(add(tip, mul(add(mul(u, Math.cos(a)), mul(v, Math.sin(a))), r * 0.6)), t, COLORS.marrow)); }
  const outer = [];
  for (let j = 0; j <= 8; j++) { const a = 2 * Math.PI * j / 8; outer.push(b.vertex(add(tip, mul(add(mul(u, Math.cos(a)), mul(v, Math.sin(a))), r * 1.1)), t, COLORS.bone, 0.05)); }
  for (let j = 0; j < 8; j++) { b.tri(c, ring[j], ring[j + 1]); b.tri(ring[j], outer[j], outer[j + 1]); b.tri(ring[j], outer[j + 1], ring[j + 1]); }
}

/** Limb seams with a long bone through the cut: seam -> [joint, tip joint, bone radius as a fraction of the segment]. */
const STUB_BONES = {
  neck: ['neck', 'head', 0.11], head: ['neck', 'head', 0.11], chest: ['spine', 'chest', 0.12],
  ...Object.fromEntries(['left', 'right'].flatMap(s => [
    [`${s}UpperArm`, [`${s}UpperArm`, `${s}LowerArm`, 0.055]], [`${s}LowerArm`, [`${s}LowerArm`, `${s}Hand`, 0.045]],
    [`${s}Hand`, [`${s}Hand`, `${s}MiddleProximal`, 0.07]], [`${s}UpperLeg`, [`${s}UpperLeg`, `${s}LowerLeg`, 0.05]],
    [`${s}LowerLeg`, [`${s}LowerLeg`, `${s}Foot`, 0.045]], [`${s}Foot`, [`${s}Foot`, `${s}Toes`, 0.08]],
  ])),
};
/** Parent / child bone of each stub (joint whose bone carries it on the body side / on the gib). */
const STUB_SIDES = {
  neck: ['upperChest', 'neck'], head: ['neck', 'head'], chest: ['spine', 'chest'],
  ...Object.fromEntries(['left', 'right'].flatMap(s => [
    [`${s}UpperArm`, [`${s}Shoulder`, `${s}UpperArm`]], [`${s}LowerArm`, [`${s}UpperArm`, `${s}LowerArm`]], [`${s}Hand`, [`${s}LowerArm`, `${s}Hand`]],
    [`${s}UpperLeg`, ['hips', `${s}UpperLeg`]], [`${s}LowerLeg`, [`${s}UpperLeg`, `${s}LowerLeg`]], [`${s}Foot`, [`${s}LowerLeg`, `${s}Foot`]],
  ])),
};
export const STUB_SEAMS = Object.freeze(Object.keys(STUB_BONES));

/** Base-body shoulder / hip width (MakeHuman base mesh), for scaling the bake's torso measures to the current sliders. */
const widthOf = (h, a, b) => (h[a] && h[b] ? Math.abs(h[a][0] - h[b][0]) : 0);

export function buildInsides(heads, { body, capAxis = {}, variant = () => 'jagged', layers = { bones: true, organs: true, flesh: true }, baseHeads = null } = {}) {
  const h = heads, out = [];
  if (!h.hips || !h.chest || !h.neck || !h.head) return out;
  const kx = baseHeads ? (widthOf(h, 'leftUpperArm', 'rightUpperArm') / (widthOf(baseHeads, 'leftUpperArm', 'rightUpperArm') || 1)) || 1 : 1;
  const ky = baseHeads ? ((h.neck[1] - h.hips[1]) / ((baseHeads.neck[1] - baseHeads.hips[1]) || 1)) || 1 : 1;
  const m = body ?? {};
  const slab = (s, fallbackY) => ({ y: s ? h.hips[1] + (s.y - (baseHeads?.hips[1] ?? h.hips[1])) * ky : fallbackY, hw: (s?.halfWidth ?? 0.14) * kx, front: s?.front ?? 0.13, back: s?.back ?? -0.08 });
  const part = (key, layer, joint, fill, extra = {}) => {
    if (!layers[layer]) return;
    const b = builder(); fill(b);
    if (b.I.length) out.push({ key, layer, joint, positions: Float32Array.from(b.P), normals: Float32Array.from(b.N), colors: Float32Array.from(b.C), indices: Uint32Array.from(b.I), ...extra });
  };

  // ---- chest cavity: lining, ribs, sternum, spine, lungs, heart, liver, stomach (behind chestLeft / chestRight)
  const ch = slab(m.chest, (h.upperChest[1] + h.neck[1]) / 2), bl = slab(m.belly, (h.spine[1] + h.chest[1]) / 2);
  const chTop = h.neck[1] - 0.03, chBot = h.chest[1] - 0.02, chMidY = (chTop + chBot) / 2, chHalfH = (chTop - chBot) / 2;
  const chZ = (ch.front + ch.back) / 2, chRz = (ch.front - ch.back) / 2;
  part('cavity:chest', 'flesh', 'upperChest', b => ellipsoid(b, [0, chMidY, chZ], [ch.hw * 0.86, chHalfH, chRz * 0.86], COLORS.lining, { flip: true, seg: 16, rings: 10 }));
  part('cavity:chest', 'bones', 'upperChest', b => {
    // ribs and sternum follow the lining ellipsoid (narrower towards the top) so they stay under the skin there:
    // the chest slab is measured at mid height, the body is much flatter just below the collarbones
    const ribs = 7, inside = y => Math.sqrt(Math.max(0.05, 1 - ((y - chMidY) / chHalfH) ** 2));
    for (let i = 0; i < ribs; i++) {
      const y = chTop - 0.03 - i * (chTop - chBot - 0.06) / (ribs - 1), e = inside(y);
      const w = Math.min(ch.hw * (0.62 + 0.18 * Math.sin(Math.PI * (i + 1) / (ribs + 1))), ch.hw * 0.86 * e * 0.95), d = chRz * 0.86 * e * 0.88;
      for (const side of [1, -1]) {
        const path = [];
        for (let k = 0; k <= 8; k++) { const a = Math.PI * (-0.5 + 0.9 * k / 8); path.push([side * w * Math.cos(a) * 0.98, y - 0.01 * k / 8, chZ + d * Math.sin(a)]); }
        tube(b, path, 0.0065, COLORS.bone, { seg: 5, mottle: 0.04 });
      }
    }
    const sternum = [];
    for (let k = 0; k <= 4; k++) { const y = chTop - 0.07 - (chTop - chBot - 0.12) * k / 4; sternum.push([0, y, chZ + chRz * 0.86 * inside(y) * 0.78]); }
    tube(b, sternum, 0.011, COLORS.bone, { seg: 6 });
    const spine = [];
    for (let k = 0; k <= 6; k++) spine.push([0, chBot + (chTop - chBot) * k / 6, chZ - chRz * 0.7]);
    tube(b, spine, 0.016, COLORS.bone, { seg: 7 });
  });
  part('cavity:chest', 'organs', 'upperChest', b => {
    for (const side of [1, -1]) ellipsoid(b, [side * ch.hw * 0.38, chMidY + 0.02, chZ - 0.005], [ch.hw * 0.3, chHalfH * 0.72, chRz * 0.6], COLORS.lung, { lump: 0.05 });
    ellipsoid(b, [-0.015, chMidY - 0.03, chZ + chRz * 0.3], [0.045, 0.055, 0.04], COLORS.heart, { lump: 0.06 });
  });
  part('cavity:chest', 'organs', 'chest', b => {
    ellipsoid(b, [-bl.hw * 0.25, h.chest[1] + 0.03, chZ + 0.01], [bl.hw * 0.55, 0.045, chRz * 0.62], COLORS.liver, { lump: 0.04 });
    ellipsoid(b, [bl.hw * 0.35, h.chest[1] + 0.02, chZ + 0.02], [0.05, 0.04, 0.045], COLORS.stomach, { lump: 0.05 });
  });

  // ---- belly cavity (pelvis region, behind `belly`): lining, intestines, pelvis bone, lumbar spine
  const pv = slab(m.pelvis, h.hips[1]);
  const bTop = h.chest[1] + 0.02, bBot = h.hips[1] - 0.05, bMid = (bTop + bBot) / 2, bZ = (bl.front + bl.back) / 2, bRz = (bl.front - bl.back) / 2;
  part('cavity:pelvis', 'flesh', 'hips', b => ellipsoid(b, [0, bMid, bZ], [bl.hw * 0.88, (bTop - bBot) / 2, bRz * 0.88], COLORS.lining, { flip: true, seg: 16, rings: 8 }));
  const guts = (cx, cy, cz, w, hgt, d, loops = 5) => {
    const path = [];
    for (let k = 0; k <= loops * 10; k++) {
      const t = k / (loops * 10), row = Math.floor(t * loops), f = t * loops - row, dir = row % 2 ? -1 : 1;
      path.push([cx + dir * w * (f - 0.5) * 2 * 0.9, cy + hgt * (0.5 - (row + f * 0.15) / loops), cz + d * Math.sin(k * 0.9) * 0.4]);
    }
    return path;
  };
  part('cavity:pelvis', 'organs', 'hips', b => tube(b, guts(0, bMid, bZ + bRz * 0.25, bl.hw * 0.62, bTop - bBot - 0.04, bRz * 0.5), 0.016, COLORS.gut, { seg: 7 }));
  part('cavity:pelvis', 'bones', 'hips', b => {
    for (const side of [1, -1]) ellipsoid(b, [side * pv.hw * 0.55, h.hips[1] - 0.01, bZ - 0.01], [pv.hw * 0.32, 0.06, 0.035], COLORS.bone, { seg: 10, rings: 6 });
    tube(b, [[0, bBot, bZ - bRz * 0.7], [0, bTop, bZ - bRz * 0.7]], 0.017, COLORS.bone, { seg: 7 });
  });
  // guts hanging out of the waist stump (torso cut in two)
  part('spill:chest', 'organs', 'spine', b => {
    const y = h.chest[1] - 0.005, path = [];
    for (let k = 0; k <= 16; k++) path.push([0.04 * Math.sin(k * 0.8), y + 0.02 - 0.012 * k, bZ + 0.03 + 0.03 * Math.cos(k * 0.6)]);
    tube(b, path, 0.017, COLORS.gut, { seg: 7 });
  });

  // ---- head cavity (behind `cranium`): lining, skull, brain
  const hd = m.head ?? { y: h.head[1] + 0.03, halfWidth: 0.083, front: 0.156, back: -0.045 };
  const hY = h.head[1] + (hd.y - (baseHeads?.head[1] ?? h.head[1])) + 0.035, hZ = (hd.front + hd.back) / 2 + (h.head[2] - (baseHeads?.head[2] ?? h.head[2])) - 0.008;
  const hR = [hd.halfWidth * 0.9 * kx, 0.085, (hd.front - hd.back) / 2 * 0.82];
  part('cavity:head', 'flesh', 'head', b => ellipsoid(b, [0, hY, hZ], hR, COLORS.lining, { flip: true, seg: 16, rings: 10 }));
  part('cavity:head', 'organs', 'head', b => ellipsoid(b, [0, hY + 0.01, hZ - 0.005], mul(hR, 0.84), COLORS.brain, { lump: 0.07, seg: 18, rings: 12 }));
  part('cavity:head', 'bones', 'head', b => ellipsoid(b, [0, hY - 0.005, hZ], [hR[0] * 1.02, hR[1] * 0.75, hR[2] * 1.02], COLORS.bone, { flip: true, seg: 14, rings: 8 }));

  // ---- bone stubs through limb caps (body side on the parent bone; the gib side reuses the part on the child bone)
  for (const [seam, [j0, j1, rk]] of Object.entries(STUB_BONES)) {
    if (!h[j0] || !h[j1]) continue;
    const axis = sub(h[j1], h[j0]), L = len(axis), dir = mul(axis, 1 / L), t = capAxis[seam]?.[variant(seam)] ?? 0.05;
    const at = add(h[j0], mul(dir, Math.max(0, t) * L)), r = Math.max(0.006, Math.min(0.02, rk * L)), stick = 0.02 + 2 * r;
    const [parentJoint, childJoint] = STUB_SIDES[seam];
    part(`stub:${seam}`, 'bones', parentJoint, b => boneStub(b, add(at, mul(dir, -stick)), add(at, mul(dir, stick)), r), { gibJoint: childJoint, at, dir });
  }
  return out;
}

/** Which inside keys the body shows for its lost regions (isLost(id) -> bool). Gibs show their own stub (character.js). */
export function visibleInsides(isLost) {
  const keys = new Set();
  if (!isLost('chest') && (isLost('chestLeft') || isLost('chestRight'))) keys.add('cavity:chest');
  if (isLost('belly')) keys.add('cavity:pelvis');
  if (!isLost('head') && isLost('cranium')) keys.add('cavity:head');
  for (const s of STUB_SEAMS) if (isLost(s) && !isLost(REGION[s].parent)) keys.add(`stub:${s}`);
  if (isLost('chest')) keys.add('spill:chest');
  return keys;
}
