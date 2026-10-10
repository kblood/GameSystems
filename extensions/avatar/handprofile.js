// GameSystems avatar extension: the HAND PROFILE of a character (extensions plan, "Håndprofil"). Pure, no three.js.
// A small flat data object with the sizes of one hand that grasping needs (the grasp extension's closure.js depends only
// on it, never on a reference hand): measured once per character from its skinned mesh (handskin.js gathers the rest-pose
// skin vertices per hand / finger bone, measureHandProfile() turns them into sizes), overridable per character (provider
// or player option `handProfile`) and adjustable at runtime (entity.setHandProfile).
//
// Format (HAND_PROFILE_FORMAT), hand-local frame, metres of the character's REST RIG (the world size is rig x the
// entity's calibrated scale, restHand().scale): origin at the wrist joint, +x = radial (thumb side) for BOTH hands,
// +y = back of the hand (dorsal), +z = distal (wrist -> middle knuckle).
//   { format, side, source: 'measured' | 'rig' (no skin: proportional defaults) | '+override',
//     length          wrist -> middle fingertip (knuckle + middle segments),
//     knuckle         wrist -> middle knuckle,
//     palmWidth       across the knuckles (skin), palmThickness  palmar to dorsal skin (mid palm),
//     palmCenter [3]  centre of the palmar contact patch (skin), palmNormal [3]  unit, out of the palm,
//     palmPatch [[3]] up to 12 palmar skin points (3 x 4 grid over the whole palm, the most palmar point per cell),
//     thumbRoot       thenar / thumb-root thickness: palmar skin reach from the thumb metacarpal axis (85th percentile),
//     thenarPatch [[3]] up to 6 thenar skin points (the most palmar thumb-metacarpal vertices; [] = a capsule of radius
//                     thumbRoot along the metacarpal); a thumbRoot override moves them palmar by the change,
//     palmOffset      posed-skin correction of the palm (m, default 0; the grasp lab's calibrate: patch gap minus the
//                     posed palm-skin gap): the closure holds the patch at palmGap + palmOffset,
//     thumbTilt       thumb flexion-plane tilt (rad, avatar rigdata THUMB_AXIS),
//     bases  { Thumb..Little: [3] }   knuckle (first joint) of each digit,
//     spread { Thumb..Little: rad }   rest yaw of each digit's first segment toward the radial side,
//     segments { Thumb..Little: [3] } segment lengths (distal: to the skin tip minus its pad),
//     girth  { Thumb..Little: [3] }   median skin distance from the segment's bone axis (finger "radius"),
//     pad    { Thumb..Little: [3] }   contact radius: PAD_CONTACT x the median skin reach from the bone axis on the flexor
//                                     (palmar) side }
// Overrides (applyHandProfile): any field replaced (objects per digit merged), plus multipliers `size` (every length and
// position, i.e. a bigger / smaller hand) and `girth` (girth, pad, thumbRoot, palmThickness: thicker / thinner fingers).
// An override is a flat object for both hands or { left: {...}, right: {...} }.
import { vSub, vDot, vLen, vNorm } from '../humanoid/index.js';

export const HAND_PROFILE_FORMAT = 'gamesystems.hand-profile.v1';
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const SEGMENTS = {
  Thumb: ['Metacarpal', 'Proximal', 'Distal'], Index: ['Proximal', 'Intermediate', 'Distal'], Middle: ['Proximal', 'Intermediate', 'Distal'],
  Ring: ['Proximal', 'Intermediate', 'Distal'], Little: ['Proximal', 'Intermediate', 'Distal'],
};
/** Bone group names (side-less) of a hand: 'Hand' and '<Finger><Segment>' (as the grasp lab / contact.js use them). */
export const HAND_BONES = Object.freeze(['Hand', ...FINGERS.flatMap(f => SEGMENTS[f].map(s => f + s))]);
/**
 * Proportional defaults (fraction of the hand length) for a hand without skin data (a fake / mesh-less character):
 * the CharacterCreator hand's measured values (grasp lab, 2026-10-10), so a rig-only profile is a plausible human hand.
 */
export const DEFAULT_PROPORTIONS = Object.freeze({
  pad: { Thumb: [0.034, 0.034, 0.036], Index: [0.058, 0.054, 0.046], Middle: [0.066, 0.055, 0.045], Ring: [0.06, 0.048, 0.042], Little: [0.046, 0.039, 0.033] },
  palmWidth: 0.43, palmThickness: 0.16, thumbRoot: 0.075, palmCenter: [-0.04, -0.075, 0.33],
});

/**
 * Contact radius per measured flexor reach: linear-blend skinning pulls the flexor skin in when a joint bends, so a curled
 * finger touches with less than its rest-pose reach (grasp lab, CC hand: 0.75 x the median flexor reach matches the
 * calibrated bone-model-minus-skin gaps of the beer/wine/can bakes within ~1-2 mm on the index/ring/little; the thumb,
 * whose pad flattens against the item and whose flexor side is tilted, 0.55).
 */
export const PAD_CONTACT = Object.freeze({ finger: 0.75, thumb: 0.55 });
const r4 = v => Math.round(v * 1e5) / 1e5;
const r3v = v => v.map(r4);
const quantile = (list, q) => { if (!list.length) return null; const a = [...list].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))]; };
const mean = list => [0, 1, 2].map(k => list.reduce((s, p) => s + p[k], 0) / list.length);

/** Smallest-eigenvalue eigenvector of a symmetric 3x3 (Jacobi). */
function smallestAxis(c) {
  const a = c.map(r => [...r]), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 20; sweep++) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-15) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
      for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = cs * x - sn * y; a[k][q] = sn * x + cs * y; }
      for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = cs * x - sn * y; a[q][k] = sn * x + cs * y; }
      for (let k = 0; k < 3; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = cs * x - sn * y; v[k][q] = sn * x + cs * y; }
    }
  }
  const i = [0, 1, 2].reduce((b, k) => (a[k][k] < a[b][b] ? k : b), 0);
  return [v[0][i], v[1][i], v[2][i]];
}

/** Hand-local transform of a rest hand ({ frame: {F, D, R}, wrist }, character frame): x radial, y dorsal, z distal. */
export function handLocal(rest) {
  const { F, D, R } = rest.frame, w = rest.wrist;
  return { point: p => { const d = vSub(p, w); return [vDot(d, R), vDot(d, D), vDot(d, F)]; }, dir: v => [vDot(v, R), vDot(v, D), vDot(v, F)] };
}

/**
 * The rig part of a profile (bones only, proportional defaults for the skin fields): rest = the avatar's rest hand
 * { side, frame, wrist, fingers: { f: { pts, len, rest: { yaw } } }, thumbTilt }.
 */
export function rigHandProfile(rest) {
  const L = handLocal(rest), bases = {}, spread = {}, segments = {};
  for (const f of FINGERS) {
    const src = rest.fingers[f];
    bases[f] = r3v(L.point(src.pts[0]));
    segments[f] = (src.len ?? [0, 1, 2].map(k => vLen(vSub(src.pts[k + 1], src.pts[k])))).map(r4);
    const v0 = vNorm(L.dir(vSub(src.pts[1], src.pts[0])));
    spread[f] = r4(src.rest?.yaw ?? Math.atan2(v0[0], v0[2]));
  }
  const knuckle = vLen(bases.Middle), length = knuckle + segments.Middle.reduce((s, x) => s + x, 0), P = DEFAULT_PROPORTIONS;
  return {
    format: HAND_PROFILE_FORMAT, side: rest.side, source: 'rig',
    length: r4(length), knuckle: r4(knuckle), palmWidth: r4(P.palmWidth * length), palmThickness: r4(P.palmThickness * length),
    palmCenter: r3v(P.palmCenter.map(v => v * length)), palmNormal: [0, -1, 0], palmPatch: [], thenarPatch: [], palmOffset: 0,
    thumbRoot: r4(P.thumbRoot * length), thumbTilt: rest.thumbTilt ?? Math.PI / 3,
    bases, spread, segments,
    girth: Object.fromEntries(FINGERS.map(f => [f, P.pad[f].map(v => r4(v * length * 0.8))])),
    pad: Object.fromEntries(FINGERS.map(f => [f, P.pad[f].map(v => r4(v * length))])),
  };
}

/**
 * Measured profile: rest (as rigHandProfile) + skin points [{ p: [x,y,z] character frame, rest pose, rig metres,
 * bone: HAND_BONES name }]. Fields the skin cannot give (too few vertices on a bone) keep the rig defaults.
 */
export function measureHandProfile(rest, points) {
  const profile = rigHandProfile(rest);
  if (!points?.length) return profile;
  const L = handLocal(rest), by = new Map();
  // Palm size: every vertex the Hand bone dominates (the validator's palm); palm patch: the firmly weighted ones (w >= 0.8:
  // knuckle-area vertices blended with the fingers lift off when the fingers curl, by up to 25 mm on a low-poly hand);
  // digits: w >= 0.5 (no joint creases).
  const firm = [];
  for (const { p, bone, w = 1 } of points) {
    if (bone === 'Hand' && w >= 0.8) firm.push(L.point(p));
    if (bone !== 'Hand' && w < 0.5) continue;
    if (!by.has(bone)) by.set(bone, []); by.get(bone).push(L.point(p));
  }
  const kd = profile.knuckle, hand = by.get('Hand') ?? [], palmSkin = firm.length >= 12 ? firm : hand;
  let measured = false;
  // Palm: thickness in the mid palm, width across the knuckles, the palmar patch between the index and little knuckles.
  const mid = hand.filter(q => q[2] > 0.3 * kd && q[2] < 0.9 * kd);
  if (mid.length >= 12) {
    const ys = mid.map(q => q[1]), y0 = quantile(ys, 0.03), y1 = quantile(ys, 0.97);
    profile.palmThickness = r4(y1 - y0);
    const across = hand.filter(q => q[2] > 0.55 * kd && q[2] < 1.05 * kd).map(q => q[0]);
    if (across.length >= 8) profile.palmWidth = r4(quantile(across, 0.98) - quantile(across, 0.02));
    const xa = Math.min(profile.bases.Index[0], profile.bases.Little[0]), xb = Math.max(profile.bases.Index[0], profile.bases.Little[0]);
    // (low-poly hands: the patch band reaches further toward the wrist and a few vertices are enough)
    const z0 = 0.15 * kd, z1 = 0.95 * kd;
    const palmar = palmSkin.filter(q => q[2] > z0 && q[2] < z1 && q[0] >= xa && q[0] <= xb && q[1] <= y0 + 0.35 * (y1 - y0));
    if (palmar.length >= 3) {
      const cells = new Map();
      for (const q of palmar) {
        const i = Math.min(2, Math.floor((q[0] - xa) / ((xb - xa) / 3 || 1))), j = Math.min(2, Math.floor((q[2] - z0) / ((z1 - z0) / 3)));
        const key = i * 3 + j, best = cells.get(key);
        if (!best || q[1] < best[1]) cells.set(key, q);
      }
      const patch = [...cells.values()], pm = mean(patch);
      // Centre: across between the index and little knuckles, 0.55 of the way to the knuckles (a fixed place on the palm,
      // not the patch mean, which a sparse mesh pulls anywhere), at the patch's palmar height.
      const c = [(xa + xb) / 2, pm[1], 0.55 * kd];
      let n = [0, -1, 0];
      if (patch.length >= 5) {
        const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (const q of patch) { const d = vSub(q, pm); for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a][b] += d[a] * d[b]; }
        const axis = vNorm(smallestAxis(cov)), s = axis[1] > 0 ? -1 : 1, fit = axis.map(v => v * s);
        if (-fit[1] > Math.cos(35 * Math.PI / 180)) n = fit;   // a cupped / sparse patch: keep the frame's palm direction
      }
      // The patch the closure keeps off the item: the most palmar Hand vertex per cell of a 3 (across) x 4 (along) grid
      // over the whole palm (heel to knuckles, ulnar edge to thenar), so no palm skin outside the central patch sinks in.
      const xs = palmSkin.map(q => q[0]), xl = quantile(xs, 0.02), xr = quantile(xs, 0.98), zl = 0.05 * kd, zr = 1.0 * kd, full = new Map();
      for (const q of palmSkin) {
        if (q[2] < zl || q[2] > zr || q[0] < xl || q[0] > xr) continue;
        const i = Math.min(2, Math.floor((q[0] - xl) / ((xr - xl) / 3 || 1))), j = Math.min(3, Math.floor((q[2] - zl) / ((zr - zl) / 4)));
        const key = i * 4 + j, best = full.get(key);
        if (!best || q[1] < best[1]) full.set(key, q);
      }
      profile.palmCenter = r3v(c); profile.palmNormal = r3v(vNorm(n)); profile.palmPatch = (full.size >= 3 ? [...full.values()] : patch).map(r3v);
    }
    measured = true;
  }
  // Fingers: per segment the skin distance from the bone axis (girth = median, pad = PAD_CONTACT x the flexor-side median);
  // the distal segment ends at the skin tip minus its pad (the capsule's end cap reaches the tip).
  const tilt = profile.thumbTilt;
  for (const f of FINGERS) {
    const src = rest.fingers[f], pts = src.pts.map(L.point);
    const contact = f === 'Thumb' ? PAD_CONTACT.thumb : PAD_CONTACT.finger;
    const flexor = f === 'Thumb' ? [-Math.sin(tilt), -Math.cos(tilt), 0] : [0, -1, 0];
    for (let k = 0; k < 3; k++) {
      const list = by.get(f + SEGMENTS[f][k]) ?? [], a = pts[k], ax = vSub(pts[k + 1], a), len = vLen(ax), u = vNorm(ax);
      if (list.length < 6 || !(len > 1e-5)) continue;
      const side = vNorm(vSub(flexor, u.map(v => v * vDot(flexor, u))));
      let tip = 0, dists = [], pads = [];
      const sample = (lo, hi) => {
        dists = []; pads = [];
        for (const q of list) {
          const d = vSub(q, a), t = vDot(d, u), r = vSub(d, u.map(v => v * t)), dist = vLen(r);
          tip = Math.max(tip, t);
          if (t < lo * len || t > hi * len) continue;
          dists.push(dist);
          if (dist > 1e-6 && vDot(r, side) / dist > 0.6) pads.push(dist);
        }
      };
      sample(0.2, k === 2 ? 0.7 : 0.8);
      // A low-poly segment has its vertices in rings at the joints only: then the whole segment.
      if (dists.length < 4) sample(-0.1, k === 2 ? 0.8 : 1.1);
      if (dists.length >= 4) profile.girth[f][k] = r4(quantile(dists, 0.5));
      if (pads.length >= 3) profile.pad[f][k] = r4(contact * quantile(pads, 0.5));
      else if (dists.length >= 4) profile.pad[f][k] = r4(contact * quantile(dists, 0.5));
      if (k === 2 && tip > 0) profile.segments[f][2] = r4(Math.max(0.6 * len, tip - profile.pad[f][2]));
      measured = true;
    }
  }
  // The thumb metacarpal's flexor bulk is the thenar (thumbRoot, its own constraint), not a finger pad: its contact
  // radius is at most the proximal phalanx's.
  profile.pad.Thumb[0] = Math.min(profile.pad.Thumb[0], profile.pad.Thumb[1]);
  // Thumb root (thenar): skin reach from the thumb metacarpal axis.
  const meta = by.get('ThumbMetacarpal') ?? [];
  if (meta.length >= 6) {
    const pts = rest.fingers.Thumb.pts.map(L.point), a = pts[0], u = vNorm(vSub(pts[1], a));
    // palmar side only (the side that meets an item; the dorsal / radial bulk never does), 85th percentile
    const reach = meta.map(q => { const d = vSub(q, a), t = vDot(d, u), r = vSub(d, u.map(v => v * t)), l = vLen(r); return { l, palmar: l > 1e-6 && -r[1] / l > 0.5 }; });
    const palmar = reach.filter(x => x.palmar).map(x => x.l);
    profile.thumbRoot = r4(quantile(palmar.length >= 3 ? palmar : reach.map(x => x.l), 0.85));
  }
  // The thenar as skin: the 6 most palmar thumb-metacarpal vertices on its proximal 60 % (what the closure keeps out of
  // the item; the distal part rides with the thumb, whose segment capsules keep it out while it closes).
  if (meta.length) {
    const tp = rest.fingers.Thumb.pts.map(L.point), a = tp[0], ax = vSub(tp[1], a), l = vLen(ax), u = vNorm(ax);
    const root = meta.filter(q => vDot(vSub(q, a), u) <= 0.6 * l);
    profile.thenarPatch = [...(root.length ? root : meta)].sort((p, q) => p[1] - q[1]).slice(0, 6).map(r3v);
  }
  const m = profile.segments.Middle;
  profile.length = r4(profile.knuckle + m[0] + m[1] + m[2]);
  if (measured) profile.source = 'measured';
  return profile;
}

const LENGTHS = ['length', 'knuckle', 'palmWidth', 'palmOffset'];
/**
 * A profile with an override applied (see the header): fields replaced, per-digit objects merged, then `size` scales
 * every length and position, `girth` the thicknesses. override may be { left, right } or flat; null = unchanged.
 */
export function applyHandProfile(profile, override) {
  if (!profile || !override) return profile;
  const o = override.left || override.right ? override[profile.side] : override;
  if (!o || typeof o !== 'object') return profile;
  const out = structuredClone(profile);
  for (const [k, v] of Object.entries(o)) {
    if (k === 'size' || k === 'girth' && typeof v === 'number' || k === 'side' || k === 'format') continue;
    if (['bases', 'spread', 'segments', 'girth', 'pad'].includes(k) && v && typeof v === 'object' && !Array.isArray(v)) out[k] = { ...out[k], ...structuredClone(v) };
    else out[k] = structuredClone(v);
  }
  const size = Number.isFinite(o.size) && o.size > 0 ? o.size : 1, girth = Number.isFinite(o.girth) && o.girth > 0 ? o.girth : 1;
  if (size !== 1) {
    for (const k of LENGTHS) if (Number.isFinite(out[k])) out[k] *= size;
    out.palmCenter = out.palmCenter.map(v => v * size); out.palmPatch = out.palmPatch.map(p => p.map(v => v * size));
    out.thenarPatch = (out.thenarPatch ?? []).map(p => p.map(v => v * size));
    for (const f of FINGERS) { out.bases[f] = out.bases[f].map(v => v * size); out.segments[f] = out.segments[f].map(v => v * size); }
  }
  const thick = size * girth;
  if (thick !== 1) {
    out.palmThickness *= thick; out.thumbRoot *= thick;
    for (const f of FINGERS) { out.girth[f] = out.girth[f].map(v => v * thick); out.pad[f] = out.pad[f].map(v => v * thick); }
  }
  // A thicker / thinner thumb root (thumbRoot override or girth): the thenar skin moves palmar / dorsal by the change.
  const rootShift = out.thumbRoot - (profile.thumbRoot ?? 0) * size;
  if (Math.abs(rootShift) > 1e-7 && out.thenarPatch?.length) out.thenarPatch = out.thenarPatch.map(p => [p[0], p[1] - rootShift, p[2]]);
  if (Object.keys(o).length) out.source = `${profile.source.split('+')[0]}+override`;
  const m = out.segments.Middle;
  if (!('length' in o)) out.length = vLen(out.bases.Middle) + m[0] + m[1] + m[2];
  return out;
}

/** True when `p` is a usable profile (format and the fields grasping reads). */
export function isHandProfile(p) {
  const v3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  return !!p && p.format === HAND_PROFILE_FORMAT && (p.side === 'left' || p.side === 'right') && [p.length, p.knuckle, p.thumbRoot].every(x => Number.isFinite(x) && x > 0)
    && v3(p.palmCenter) && v3(p.palmNormal) && FINGERS.every(f => v3(p.bases?.[f]) && v3(p.segments?.[f]) && v3(p.pad?.[f]) && Number.isFinite(p.spread?.[f]));
}

