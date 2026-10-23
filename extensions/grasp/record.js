// Recorded grasps (extensions plan step 4, Grasp Studio): a grasp captured from a tracked hand (WebXR hand joints) is
// stored like a baked one, as the wrist placement in item space, the target SHAPE of the fingers and the length of the
// recording hand; close-to-contact (closure.js) fits it onto any character's hand at runtime. This module turns XR
// joints into that format, mirrors a grasp onto the other hand, scores it on the reference hand, and merges the
// recorded library (recorded_grasps.json) into the baked one (baked_grasps.js). Pure: plain arrays, no three.js.
//
// Conventions are the baked ones (baked_grasps.data.json `conventions`): wrist = the hand joint (XR 'wrist'), quat = the
// hand frame (+Z wrist -> middle knuckle, +Y back of the hand) in item space [x,y,z,w], rows [dyaw, pitch, bend1, bend2]
// in degrees per digit thumb..little, dyaw relative to the rest spread of the hand the rows are applied to (the
// reference hand when recorded), pitch/bend absolute in the hand frame (the plugin's chainAngles / closure fingerChain).
// A recorded thumb row has a 5th value, its axial twist (deg; THUMB_TWIST below): baked rows have none.
import REFERENCE from './reference_hand.json' with { type: 'json' };
import { handGeometry, fingerChain, closeToContact, chainGaps, REFERENCE_HAND } from './closure.js';
import { CATALOG, signedDistance } from './catalog.js';
import { TOUCH_MM } from './contact.js';
import { verdict, clampRows } from './grasp_validator.js';
import { qmul, qconj, rotate, add, sub, scale, cross, length } from './math.js';

export const RECORDED_SCHEMA = 'gamesystems.recorded-grasps.v1';
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const R2D = 180 / Math.PI;
/** Open approach rows of a recorded grasp (the baked grasps' approach: thumb slightly out, fingers straight). */
export const DEFAULT_OPEN = Object.freeze([[0, 10, 5, 5], [0, -5, 0, 0], [0, -5, 0, 0], [0, -5, 0, 0], [0, -5, 0, 0]].map(r => Object.freeze(r)));
/** WebXR Hand Input joint names per digit: [segment 0 start, joint, joint, tip] (= the plugin's XR_CHAINS). */
export const XR_CHAINS = Object.freeze({
  Thumb: ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  Index: ['index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'],
  Middle: ['middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'],
  Ring: ['ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip'],
  Little: ['pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'],
});
/** All 25 WebXR hand joints in the spec's order (XRHand iteration order). */
export const XR_JOINTS = Object.freeze(['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  ...['index', 'middle', 'ring', 'pinky'].flatMap(f => ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map(s => `${f}-finger-${s}`))]);

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const reject = (v, n) => sub(v, scale(n, dot(v, n)));
const finite = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
const joint = (joints, name) => (joints instanceof Map ? joints.get(name) : joints?.[name]);
/**
 * Thumb twist measurement (rowsFromJoints): enabled, and the bend-plane strength |n| (≈ sin bend1 + sin bend2) over which
 * it fades in (a straight thumb has no plane). Same rule as the avatar's rigdata.thumbTwist. enabled = false records the
 * old fixed-plane thumb (4 values).
 */
export const THUMB_TWIST = { enabled: true, plane: [0.15, 0.4] };
/**
 * Twist (rad, hand-independent via sgn) of a thumb chain v[0..2]: per bend, the angle about the parent segment from the
 * conventional hinge (hinge made perpendicular to it, as fingerChain does) to the hinge of the plane that bend lies in,
 * averaged weighted by the bends' sines; faded in over THUMB_TWIST.plane (a straight thumb has no plane). Exact inverse
 * of fingerChain's twist.
 */
function thumbTwist(v, hinge, D, sgn) {
  const about = (p, n, s) => {
    let K = reject(hinge, p);
    if (length(K) < 1e-6) K = reject(D, p);
    K = norm(K);
    const m = scale(n, dot(n, K) < 0 ? -1 / s : 1 / s);
    return Math.atan2(dot(cross(K, m), p), dot(K, m));
  };
  const n1 = cross(v[0], v[1]), n2 = cross(v[1], v[2]), s1 = length(n1), s2 = length(n2), S = s1 + s2, [lo, hi] = THUMB_TWIST.plane;
  const u = Math.max(0, Math.min(1, (S - lo) / (hi - lo))), w = u * u * (3 - 2 * u);
  if (w <= 0) return 0;
  const t = ((s1 > 1e-9 ? s1 * about(v[0], n1, s1) : 0) + (s2 > 1e-9 ? s2 * about(v[1], n2, s2) : 0)) / S;
  return sgn * w * t;
}
/** v rotated by `angle` about the unit axis k (Rodrigues). */
function turn(v, k, angle) {
  const c = Math.cos(angle), s = Math.sin(angle), kv = cross(k, v), d = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * d, v[1] * c + kv[1] * s + k[1] * d, v[2] * c + kv[2] * s + k[2] * d];
}

/** Quaternion [x,y,z,w] of the rotation whose columns are the orthonormal axes X, Y, Z. */
export function quatFromBasis(X, Y, Z) {
  const [m00, m10, m20] = X, [m01, m11, m21] = Y, [m02, m12, m22] = Z, tr = m00 + m11 + m22;
  let q;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]; }
  const l = Math.hypot(...q); return q.map(v => v / l);
}

/**
 * Hand frame of tracked joints (the plugin's rigdata.handFrame): F = wrist -> middle knuckle, R = little -> index knuckle
 * (radial) made perpendicular to F, D = back of the hand; X = D x F (thumb side for the right hand). quat: hand frame.
 * Returns null when a joint is missing.
 */
export function handBasis(side, joints) {
  const w = joint(joints, 'wrist'), i = joint(joints, 'index-finger-phalanx-proximal'), m = joint(joints, 'middle-finger-phalanx-proximal'), l = joint(joints, 'pinky-finger-phalanx-proximal');
  if (![w, i, m, l].every(p => finite(p, 3))) return null;
  const F = norm(sub(m, w)), R = norm(reject(sub(i, l), F));
  const D = norm(side === 'left' ? cross(R, F) : cross(F, R)), X = norm(cross(D, F));
  return { F, R, D, X, quat: quatFromBasis(X, D, F) };
}

/** Wrist -> middle fingertip along the bones (m): the hand length closure.handGeometry() reports for a character. */
export function handLengthFromJoints(joints) {
  const names = ['wrist', ...XR_CHAINS.Middle];
  let sum = 0;
  for (let k = 1; k < names.length; k++) {
    const a = joint(joints, names[k - 1]), b = joint(joints, names[k]);
    if (!finite(a, 3) || !finite(b, 3)) return null;
    sum += length(sub(b, a));
  }
  return sum;
}

/**
 * The tracked hand as a rest hand for closure.handGeometry() (its knuckles, segment lengths and current spread as the
 * rest spread): handGeometry(restFromJoints(side, joints)) is a bone model of the user's own hand, so chainGaps() on it
 * with rowsFromJoints() gives the live contact of the real fingers (Grasp Studio feedback). Null when joints are missing.
 */
export function restFromJoints(side, joints) {
  const b = handBasis(side, joints);
  if (!b) return null;
  const fingers = {};
  for (const f of FINGERS) {
    const pts = XR_CHAINS[f].map(n => joint(joints, n));
    if (!pts.every(p => finite(p, 3))) return null;
    fingers[f] = { pts: pts.map(p => [...p]) };
  }
  return { side, frame: { F: b.F, D: b.D, R: b.R }, wrist: [...joint(joints, 'wrist')], fingers };
}

/**
 * Finger rows (deg, thumb..little) of tracked joints for a hand: pitch and bends absolute in the tracked hand frame,
 * dyaw = tracked spread minus the rest spread of `hand` (closure.handGeometry(); the reference hand for recordings), so
 * closure.fingerChain(hand.fingers[f], row) bends `hand` like the tracked finger. Inverse of fingerChain on the same
 * hand. The thumb row gets a 5th value, its twist (THUMB_TWIST): the bends are measured about the hinge turned by it, so
 * an opposing (pronated) thumb keeps its bend plane instead of being projected onto the fixed one. Null when joints are
 * missing.
 */
export function rowsFromJoints(side, joints, hand) {
  const b = handBasis(side, joints);
  if (!b) return null;
  const w = joint(joints, 'wrist'), local = p => { const d = sub(p, w); return [dot(d, b.X), dot(d, b.D), dot(d, b.F)]; };
  const rows = [];
  for (const f of FINGERS) {
    const pts = XR_CHAINS[f].map(n => joint(joints, n));
    if (!pts.every(p => finite(p, 3))) return null;
    const P = pts.map(local), v = [0, 1, 2].map(k => norm(sub(P[k + 1], P[k])));
    const { axes: { F, D, R }, hinge, restYaw, twistSign = side === 'left' ? -1 : 1 } = hand.fingers[f];
    const vr = dot(v[0], R), vd = dot(v[0], D), vf = dot(v[0], F);
    const twist = f === 'Thumb' && THUMB_TWIST.enabled ? thumbTwist(v, hinge, D, twistSign) : null, tw = twist ? twist * twistSign : 0;
    const bend = k => {
      const p = v[k - 1], c = v[k];
      let K = reject(hinge, p);
      if (length(K) < 1e-6) K = reject(D, p);
      K = norm(K);
      if (tw) K = turn(K, p, tw);
      const a = reject(p, K), e = reject(c, K);
      return Math.atan2(dot(cross(a, e), K), dot(a, e));
    };
    let dyaw = Math.atan2(vr, vf) - restYaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const row = [dyaw * R2D, Math.atan2(-vd, Math.hypot(vr, vf)) * R2D, bend(1) * R2D, bend(2) * R2D];
    if (twist !== null) row.push(twist * R2D);
    rows.push(row);
  }
  return rows;
}

/** World pose { pos, quat } -> item space. */
const toItem = (item, pos, quat) => { const inv = qconj(item.quat); return { pos: rotate(inv, sub(pos, item.pos)), quat: qmul(inv, quat) }; };

/**
 * One capture of a tracked hand on an item: { side, wrist, quat (item space), angles (rows for `hand`), handLength }.
 * joints: name -> [x,y,z] (world); item: { pos, quat } (world); hand: the hand the rows are for (default: reference hand).
 */
export function captureFromJoints(side, joints, item, hand = referenceHand(side)) {
  const b = handBasis(side, joints), angles = b && rowsFromJoints(side, joints, hand), handLength = handLengthFromJoints(joints);
  if (!angles || !handLength) return null;
  const local = toItem(item, joint(joints, 'wrist'), b.quat);
  return { side, wrist: local.pos, quat: local.quat, angles, handLength };
}

/**
 * Synthetic WebXR joints (world, name -> [x,y,z]) of a hand holding a pose: `hand` (closure.handGeometry()) with the
 * pose's closed rows (or `rows`) and its wrist/quat as given (no placeWrist: the joints ARE the recording hand), on an
 * item at { pos, quat }. The inverse of captureFromJoints on the same hand; metacarpals are placed like the plugin's
 * syntheticJoints (60 % wrist + 40 % knuckle). For tests, desktop preview and smoke tests of recording apps.
 */
export function poseJoints(pose, hand, item = { pos: [0, 0, 0], quat: [0, 0, 0, 1] }, rows = pose.angles) {
  const wrist = add(item.pos, rotate(item.quat, pose.wrist)), quat = qmul(item.quat, pose.quat);
  const place = p => add(wrist, rotate(quat, scale(p, hand.scale)));
  const out = { wrist };
  FINGERS.forEach((f, i) => {
    const chain = fingerChain(hand.fingers[f], rows[i]);
    XR_CHAINS[f].forEach((name, k) => { out[name] = place(chain[k]); });
    if (f !== 'Thumb') out[XR_CHAINS[f][0].replace('phalanx-proximal', 'metacarpal')] = add(scale(wrist, 0.6), scale(out[XR_CHAINS[f][0]], 0.4));
  });
  return out;
}

const referenceHands = {};
/** closure.handGeometry() of the reference hand (reference_hand.json) at its reference scale, or another scale. */
export function referenceHand(side, { scale: s = REFERENCE.scale } = {}) {
  if (s !== REFERENCE.scale) return handGeometry(REFERENCE.hands[side], { scale: s });
  return (referenceHands[side] ??= handGeometry(REFERENCE.hands[side], { scale: s }));
}

const other = side => (side === 'left' ? 'right' : 'left');
/**
 * The same grasp on the other hand: mirrored across the item's XY plane (z -> -z), the plane the baked library mirrors
 * across (handles and the bottle's +X side stay where they are). Rows are hand-independent (spread toward the thumb,
 * flexion toward the palm), so they stay. The hand frame's fingers (+Z) and back (+Y) are reflected and its X = Y x Z
 * flips to the other hand's side: M R diag(-1, 1, 1) with M = diag(1, 1, -1), i.e. the reflected quat (-x, -y, z, w)
 * turned 180 deg about the hand's Y. The id gets the other side and a `-m` suffix; mirroredFrom names the source.
 */
export function mirrorPose(pose) {
  const [x, y, z, w] = pose.quat;
  const out = { ...pose, side: other(pose.side), wrist: [pose.wrist[0], pose.wrist[1], 0 - pose.wrist[2]], quat: qmul([-x, -y, z, w], [0, 1, 0, 0]).map(v => v + 0),
    angles: pose.angles.map(r => [...r]), open: (pose.open || DEFAULT_OPEN).map(r => [...r]), mirroredFrom: pose.id };
  if (pose.palm) out.palm = [pose.palm[0], pose.palm[1], -pose.palm[2]];
  if (typeof pose.id === 'string') out.id = pose.id.replace(`/${pose.side}/`, `/${out.side}/`) + '-m';
  return out;
}

/** True when a value is a usable grasp pose (baked or recorded). */
export function isPose(p) {
  return !!p && typeof p.id === 'string' && typeof p.kind === 'string' && typeof p.grasp === 'string' && (p.side === 'left' || p.side === 'right')
    && finite(p.wrist, 3) && finite(p.quat, 4) && Math.abs(Math.hypot(...p.quat) - 1) < 1e-3
    && [p.angles, p.open].every(rows => Array.isArray(rows) && rows.length === 5 && rows.every((r, i) => finite(r, 4) || (i === 0 && finite(r, 5))))
    && (p.role === undefined || p.role === 'primary' || p.role === 'secondary')
    && (p.handLength === undefined || (Number.isFinite(p.handLength) && p.handLength > 0.08 && p.handLength < 0.35));
}

/**
 * A recorded pose in the library format. capture: { side, wrist, quat, angles, handLength } (see captureFromJoints);
 * meta: { kind, grasp, mode?, default?, id?, at? (ISO time), score?, frames? }. Rounds to 0.01 mm / 1e-5 / 0.01 deg.
 */
export function recordedPose(capture, { kind, grasp, mode = CATALOG[kind]?.grip ?? 'wrap', default: isDefault = false, id = null, at = new Date().toISOString(), score = null, frames = null, role = null } = {}) {
  const r = (v, k) => Math.round(v * k) / k + 0; // + 0: no -0 (JSON writes it as 0)
  const stamp = at.replace(/[-:]/g, '').replace(/\.\d+Z?$|Z$/, '');
  const pose = { id: id || `${kind}/${capture.side}/${grasp}/rec-${stamp}`, kind, grasp, mode, side: capture.side, default: !!isDefault,
    wrist: capture.wrist.map(v => r(v, 1e5)), quat: capture.quat.map(v => r(v, 1e5)),
    angles: capture.angles.map(row => row.map(v => r(v, 100))), open: DEFAULT_OPEN.map(row => [...row]),
    ...(role && { role }), handLength: r(capture.handLength, 1e4), recorded: { at, source: 'grasp-studio', ...(score != null && { score }), ...(frames != null && { frames }) } };
  const l = Math.hypot(...pose.quat); pose.quat = pose.quat.map(v => r(v / l, 1e5));
  return pose;
}

/**
 * The bone model's palm anchor (REFERENCE_HAND.palm: the mean of the lowest palm skin vertices) reads farther from the
 * item than the lowest skin vertex the bake's palmGapMm measured: median +3.05 / +3.83 / +3.31 mm over the beer, wine
 * and can bakes (scoreGrasp vs baked_grasps.data.json metrics). Subtracted so the palm gate means the same thing.
 */
export const PALM_SKIN_MM = 3.0;
const around = p => Math.atan2(p[2], p[0]);
const separation = (a, b) => { const x = Math.abs(a - b) % (2 * Math.PI); return x > Math.PI ? 2 * Math.PI - x : x; };
/**
 * Validator verdict + score (0..100) of a grasp on a hand (default: the reference hand of its side), the way the game
 * shows it: the joint-range rows closed to contact (closeToContact), measured with the bone model (chainGaps):
 * penetration, palm gap at the reference palm anchor (minus PALM_SKIN_MM), fingertips (distal segment; thumb: distal or
 * middle segment, its pad) within contact.TOUCH_MM, thumb opposition of the tips around the item's +Y axis. The verdict also checks the pose's own rows (grasp_validator.verdict: joint ranges,
 * coupling). score = 100 - 20 per failure - 4 per warning - min(25, 2 x comfort cost), at least 0.
 * Returns { ok, score, failures, warnings, metrics, closed, gaps }.
 */
export function scoreGrasp(pose, hand = referenceHand(pose.side), shape = CATALOG[pose.kind]?.shape) {
  if (!shape) throw new Error(`scoreGrasp: no catalogue shape for ${pose.kind}`);
  const list = rows => { const c = clampRows(Object.fromEntries(FINGERS.map((f, i) => [f, rows[i]]))); return FINGERS.map(f => c[f]); };
  const closed = closeToContact(pose, hand, shape, { rows: { open: list(pose.open || DEFAULT_OPEN), angles: list(pose.angles) } });
  const gaps = chainGaps(hand, shape, closed, closed.angles);
  const place = p => add(closed.wrist, rotate(closed.quat, scale(p, hand.scale)));
  const tips = Object.fromEntries(FINGERS.map((f, i) => [f, place(fingerChain(hand.fingers[f], closed.angles[i])[3])]));
  const touch = TOUCH_MM / 1000, deepest = Math.min(...FINGERS.map(f => gaps[f].min));
  const k = hand.length / REFERENCE_HAND.length, palm = add(closed.wrist, rotate(closed.quat, scale(REFERENCE_HAND.palm, k)));
  const ref = [(tips.Index[0] + tips.Middle[0]) / 2, 0, (tips.Index[2] + tips.Middle[2]) / 2];
  const mm = v => Math.round(v * 1e5) / 100;
  const metrics = {
    penetrationMm: mm(Math.max(0, -deepest)), worstGroup: FINGERS.find(f => gaps[f].min === deepest),
    palmGapMm: mm(signedDistance(shape, palm) - PALM_SKIN_MM / 1000),
    tipGapMm: Object.fromEntries(FINGERS.map(f => [f, mm(gaps[f].segments[2])])),
    fingersTouching: FINGERS.slice(1).filter(f => gaps[f].segments[2] <= touch).length,
    thumbTouching: Math.min(gaps.Thumb.segments[1], gaps.Thumb.segments[2]) <= touch,
    thumbOppositionDeg: Math.round(separation(around(tips.Thumb), around(ref)) * 1800 / Math.PI) / 10,
  };
  const v = verdict(metrics, Object.fromEntries(FINGERS.map((f, i) => [f, pose.angles[i]])), { wrap: (pose.mode ?? 'wrap') === 'wrap' });
  const score = Math.max(0, Math.round(100 - 20 * v.failures.length - 4 * v.warnings.length - Math.min(25, 2 * v.rows.cost)));
  return { ok: v.ok, score, failures: v.failures, warnings: v.warnings, metrics, closed, gaps };
}

/** Valid poses of a recorded library document ({ schema, poses }); invalid entries are skipped. */
export function recordedPoses(doc) {
  if (!doc || (doc.schema && doc.schema !== RECORDED_SCHEMA) || !Array.isArray(doc.poses)) return [];
  return doc.poses.filter(isPose);
}

/**
 * Baked + recorded poses as one library: recorded poses are appended; a recorded pose marked default takes the default
 * of its kind/side/grasp from the baked one (that baked pose is copied with default false). Unchanged baked poses are
 * the same objects. Duplicate ids: the first wins.
 */
export function mergePoses(baked, recorded) {
  if (!recorded.length) return baked;
  const key = p => `${p.kind}/${p.side}/${p.grasp}`, defaults = new Set(recorded.filter(p => p.default).map(key));
  const ids = new Set(baked.map(p => p.id));
  const out = baked.map(p => (p.default && defaults.has(key(p)) ? { ...p, default: false } : p));
  const seen = new Set();
  for (const p of recorded) {
    if (ids.has(p.id) || seen.has(p.id)) continue;
    // Only the first recorded default of a kind/side/grasp stays default.
    const isDefault = p.default && !seen.has(`default:${key(p)}`);
    if (isDefault) seen.add(`default:${key(p)}`);
    seen.add(p.id); out.push(p.default && !isDefault ? { ...p, default: false } : p);
  }
  return out;
}
