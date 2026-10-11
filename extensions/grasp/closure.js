// Close-to-contact (extensions plan step 3): a baked or recorded grasp gives the wrist placement in item space and the
// target SHAPE of the fingers (open approach row -> closed row); on grab every finger closes along that shape until its
// segments touch the item's signed distance field (catalog.js signedDistance), on the CHARACTER's own hand: segment
// lengths, knuckle positions and rest spread come from the character (its rest joint heads), the wrist offset is scaled
// by hand length, and the result stays inside the validator's joint ranges (clampRows). That replaces per-kind skin
// margins and per-character refits. Pure: plain arrays, no three.js, no avatar/character import.
//
// The hand model is injected (no import of avatar internals, see docs/extensions_plan.md steps 3 and 5): handGeometry()
// takes the duck-typed rest hand the avatar extension exposes for any character (`entity.restHand(side)`: { side, frame:
// {F, D, R}, wrist, fingers: { Thumb..Little: { pts, len, rest: { yaw } } }, scale, handLength, thumbTilt }); handFromRig()
// builds the same from an avatar rig (`entity.rig`) plus the character's world scale. The finger forward kinematics
// below follows the avatar extension's convention (fingers.js chainDirs + rigdata.js fingerAxes: pitch toward the
// palm, yaw toward the thumb side from the rest spread, bends about the hand's lateral axis, thumb nail side tilted
// THUMB_TILT from the back of the hand) so the rows mean the same thing.
//
// Hand-local frame: origin at the wrist joint, +Z = fingers (wrist -> middle knuckle), +Y = back of the hand,
// +X = Y x Z (thumb side for the right hand, little-finger side for the left), metres of the character's rest rig.
import { signedDistance } from './catalog.js';
import { HARD, clampRows } from './grasp_validator.js';

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const KEYS = ['dyaw', 'pitch', 'bend1', 'bend2', 'twist'];
const D2R = Math.PI / 180;
/** Thumb nail-side tilt from the back of the hand toward the thumb side (rad): the avatar's rigdata THUMB_AXIS.tilt
 * (default; a rest hand may bring its own `thumbTilt`). */
export const THUMB_TILT = Math.PI / 3;

/**
 * Effective pad radius per segment (proximal, middle, distal) as a fraction of the hand length (wrist -> middle
 * fingertip): how far the skin reaches toward the item beyond the bone model below (segment middle + end samples).
 * Measured on the CharacterCreator hand in the grasp lab (tools/lab/closure_lab.mjs calibrate: median of bone-model gap
 * minus skin gap on the lab-refitted beer/wine/can bakes, 24 samples per distal segment, thumb 12-24 per segment). The
 * fingers' proximal/middle segments rarely touch in those grasps, so they are the distal value +10 % / +5 %.
 * A character can pass its own `radii`.
 */
export const PAD_RADIUS = {
  Thumb: [0.031, 0.037, 0.032],
  Index: [0.055, 0.052, 0.05],
  Middle: [0.04, 0.037, 0.034],
  Ring: [0.05, 0.047, 0.045],
  Little: [0.044, 0.042, 0.04],
};
/**
 * The hand the baked grasps were fitted on (CharacterCreator male, lab scale): world hand length (m) and the palm
 * anchor (hand-local, m) the wrist offset scales about. A bigger hand moves the wrist away from the item by
 * (1 - k) * palm, k = length / REFERENCE_HAND.length (grasp lab, tools/lab/closure_lab.mjs calibrate `reference`:
 * the palm anchor is the mean of the lowest 10 % palm skin vertices in the hand frame). palmCenter: the same hand's hand-profile
 * palm centre (avatar handprofile.js, profile frame: +x radial; mean of both hands, lab scale 1): where placePalm puts a
 * character's own profile palm centre.
 */
export const REFERENCE_HAND = { length: 0.203, palm: [0, -0.0238, 0.0685], palmCenter: [-0.0065, -0.0249, 0.0617] };
/**
 * Closure tuning (see closeFinger): each finger starts at its baked closed row (t = 1; t = 0 is the open approach).
 * A bake deeper than `squeeze` (m) inside the item opens along its shape (down to t = -backoff); one within `touch` (m)
 * of the surface is kept; otherwise it closes further, up to t = 1 + overshoot (the character's hand is smaller or the
 * item further away), until it presses `squeeze` into the surface; a finger that touches nothing even then keeps the
 * bake (a hooked or resting finger). Only wraps close past the bake: a flat or pinch bake is the target pose itself
 * (closing a flat hand curls the fingertips into the face: +4 mm skin on the carton in the lab), so it only opens. step/bisect: march step in t and bisection count (cost ~ (overshoot / step +
 * bisect) finger evaluations per contact phase, three phases at most per finger).
 * Thumb search (wrap grasps only, thumbSearch; OFF by default: in the grasp lab the capsule model's thumb drifts from the
 * CC skin away from the bake, so searched thumbs read as touching while the skin was up to 10 mm inside; the bake's own
 * thumb, closed along its shape, measured better on every bottle/can pose): when the thumb cannot touch along its baked shape (its bake is outside the
 * joint ranges, so the clamped shape misses or starts inside the item, as the Godot mug thumb does), the thumb's CMC
 * (dyaw, pitch) is searched on a 20 deg grid inside the joint ranges (then 7 deg around the best), the IP/MCP closing to
 * contact for each; the winner touches and is nearest to the clamped bake, weighted by how far it falls short of opposing
 * the index/middle tips by `opposition` deg around the item's +Y axis. It is used only if it reaches `opposition` (a
 * handle grip, whose thumb rests off that axis, keeps its clamped bake). A bake deeper than `squeeze` whose open path
 * goes deeper still (a thumb's approach can swing through the item) is kept if within `tolerate`, else marked stuck.
 * ~40 thumb closures (~1-3 ms in node), only for such poses, once per grab. Without it a pose closes in ~0.1-0.3 ms.
 */
export const CLOSURE = Object.freeze({ overshoot: 0.7, backoff: 0.5, squeeze: 0.001, touch: 0.002, tolerate: 0.002, step: 0.1, bisect: 6, opposition: 130, thumbSearch: false, palmGap: 0.004, palmSlide: 0.04 });

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const reject = (v, n) => sub(v, scl(n, dot(v, n)));
function rotate(q, v) {
  const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}
/** v rotated by `angle` about the unit axis k (Rodrigues). */
function turn(v, k, angle) {
  const c = Math.cos(angle), s = Math.sin(angle), kv = cross(k, v), d = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * d, v[1] * c + kv[1] * s + k[1] * d, v[2] * c + kv[2] * s + k[2] * d];
}

/** Reference axes of a finger in the hand-local frame (thumb: nail side tilted toward the thumb side). */
function fingerAxes(finger, side, tilt) {
  const F = [0, 0, 1], D = [0, 1, 0], R = side === 'left' ? [-1, 0, 0] : [1, 0, 0];
  if (finger !== 'Thumb') return { F, D, R };
  const c = Math.cos(tilt), s = Math.sin(tilt);
  const Dt = norm(add(scl(D, c), scl(R, s)));
  return { F, D: Dt, R: norm(reject(sub(scl(R, c), scl(D, s)), Dt)) };
}

const isV3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
/** True when `p` is a usable hand profile (avatar handprofile.js format; checked duck-typed, grasp imports no avatar). */
export function isHandProfile(p) {
  return !!p && p.format === HAND_PROFILE_FORMAT && (p.side === 'left' || p.side === 'right') && [p.length, p.knuckle].every(x => Number.isFinite(x) && x > 0)
    && isV3(p.palmCenter) && isV3(p.palmNormal) && FINGERS.every(f => isV3(p.bases?.[f]) && isV3(p.segments?.[f]) && isV3(p.pad?.[f]) && Number.isFinite(p.spread?.[f]));
}
export const HAND_PROFILE_FORMAT = 'gamesystems.hand-profile.v1';

/**
 * A hand profile from a rest hand WITHOUT one (bones only: tracked XR hands, reference_hand.json, old providers): the
 * knuckles, segment lengths and rest spread of the rest hand, pads = `radii` (fraction of the hand length, PAD_RADIUS by
 * default) and the palm from REFERENCE_HAND.palm scaled to this hand. Same format as the avatar's measured profile
 * (hand-local, +x radial for both hands, rig metres).
 */
export function profileFromRest(rest, { thumbTilt = rest?.thumbTilt ?? THUMB_TILT, radii = PAD_RADIUS } = {}) {
  const { side, frame, wrist } = rest;
  if (side !== 'left' && side !== 'right') throw new TypeError(`handGeometry: side ${side}?`);
  const R = norm(frame.R ?? (side === 'left' ? scl(cross(frame.D, frame.F), -1) : cross(frame.D, frame.F))), Y = norm(frame.D), Z = norm(frame.F);
  const toLocal = v => [dot(v, R), dot(v, Y), dot(v, Z)];
  const bases = {}, segments = {}, spread = {};
  for (const f of FINGERS) {
    const src = rest.fingers[f], pts = src.pts.map(p => toLocal(sub(p, wrist)));
    bases[f] = pts[0];
    segments[f] = src.len || [0, 1, 2].map(k => len(sub(pts[k + 1], pts[k])));
    const v0 = norm(sub(pts[1], pts[0]));
    spread[f] = src.rest?.yaw ?? Math.atan2(v0[0], v0[2]);
  }
  const knuckle = len(bases.Middle), length = knuckle + segments.Middle[0] + segments.Middle[1] + segments.Middle[2];
  const pad = Object.fromEntries(FINGERS.map(f => [f, radii[f].map(r => r * length)]));
  return { format: HAND_PROFILE_FORMAT, side, source: 'rest', length, knuckle, palmWidth: 0.43 * length, palmThickness: 0.16 * length,
    palmCenter: scl(REFERENCE_HAND.palm, length / REFERENCE_HAND.length), palmNormal: [0, -1, 0], palmPatch: [],
    thumbRoot: pad.Thumb[0], thumbTilt, bases, spread, segments, girth: pad, pad };
}

/**
 * Hand geometry for close-to-contact. Everything comes from the HAND PROFILE (avatar handprofile.js: measured from the
 * character's skin, overridable, adjustable at runtime): rest.profile when the rest hand has one (the avatar's
 * entity.restHand(side)), else profileFromRest(rest). options: scale (world metres per rig metre; default rest.scale),
 * profile (use this profile instead), thumbTilt, radii (legacy: pads as PAD_RADIUS-style fractions of the hand length,
 * replacing the profile's). Returns { side, scale, length (world m), thumbTilt, profile, fingers: { f: { base, len,
 * restYaw, radius, axes, hinge, twistSign } }, palm: { center, normal, samples, width, thickness }, thenar: { a, b, radius } };
 * hand-local rig metres (closure frame, see the header) except `length`.
 */
export function handGeometry(rest, { scale = rest?.scale ?? 1, thumbTilt, radii = null, profile = null } = {}) {
  let p = profile ?? (isHandProfile(rest?.profile) ? rest.profile : null);
  if (!p) p = profileFromRest(rest, { thumbTilt: thumbTilt ?? rest?.thumbTilt ?? THUMB_TILT, ...(radii && { radii }) });
  else if (radii) p = { ...p, pad: Object.fromEntries(FINGERS.map(f => [f, radii[f].map(r => r * p.length)])) };
  const side = p.side ?? rest?.side;
  if (side !== 'left' && side !== 'right') throw new TypeError(`handGeometry: side ${side}?`);
  const tilt = thumbTilt ?? p.thumbTilt ?? rest?.thumbTilt ?? THUMB_TILT;
  // profile +x is radial for both hands; the closure frame's +X is radial for the right hand only.
  const cv = v => (side === 'left' ? [-v[0], v[1], v[2]] : [v[0], v[1], v[2]]);
  const fingers = {};
  for (const f of FINGERS) {
    const axes = fingerAxes(f, side, tilt);
    fingers[f] = { base: cv(p.bases[f]), len: [...p.segments[f]], axes, hinge: norm(cross(axes.D, axes.F)), restYaw: p.spread[f], radius: [...p.pad[f]],
      twistSign: side === 'left' ? -1 : 1 };
  }
  const center = cv(p.palmCenter), normal = norm(cv(p.palmNormal));
  let samples = (p.palmPatch || []).filter(isV3).map(cv);
  if (samples.length < 3) {
    // No measured patch: a 3 x 3 grid on the palm plane (width across, knuckle along the fingers).
    const w = 0.3 * (p.palmWidth || 0.43 * p.length), d = 0.25 * p.knuckle, u = norm(reject([1, 0, 0], normal)), v = norm(cross(normal, u));
    samples = [];
    for (const i of [-1, 0, 1]) for (const j of [-1, 0, 1]) samples.push(add(center, add(scl(u, i * w), scl(v, j * d))));
  }
  samples.push(center);
  // Thenar / thumb root: the profile's thenar skin points, else the proximal 60 % of the rest thumb metacarpal as a
  // capsule of radius thumbRoot.
  const tb = fingers.Thumb.base, tj = fingerChain(fingers.Thumb, [0, 0, 0, 0])[1];
  const thenar = { a: tb, b: add(tb, scl(sub(tj, tb), 0.6)), radius: p.thumbRoot ?? fingers.Thumb.radius[0], points: (p.thenarPatch || []).filter(isV3).map(cv) };
  return { side, scale, length: p.length * scale, thumbTilt: tilt, profile: p, fingers,
    palm: { center, normal, samples, width: p.palmWidth, thickness: p.palmThickness }, thenar };
}

/**
 * handGeometry() from an avatar extension rig (the public `entity.rig`: rig.hands[side] and the
 * rest heads rig.H) and the character's world scale (`player.scale`). Uses the rig hand's profile when it has one.
 */
export function handFromRig(rig, side, { scale = 1, ...options } = {}) {
  const h = rig?.hands?.[side], wrist = rig?.H?.[`${side}Hand`];
  if (!h || !wrist) return null;
  return handGeometry({ side, frame: h.frame, wrist, fingers: h.fingers, profile: h.profile }, { scale, ...options });
}

/**
 * Joint positions [knuckle, joint, joint, tip] (hand-local rig metres) of one finger for a row in degrees. A thumb row's
 * optional 5th value (twist, deg) turns the MCP/IP hinge about each parent segment (the avatar's fingers.js chainDirs):
 * the pronation a real thumb has when it opposes. Without it the hinge is the fixed THUMB_TILT plane, as before.
 */
export function fingerChain(finger, row) {
  const { axes: { F, D, R }, hinge } = finger;
  const yaw = finger.restYaw + (row[0] || 0) * D2R, pitch = row[1] * D2R, cp = Math.cos(pitch);
  const v1 = norm(add(add(scl(R, Math.sin(yaw) * cp), scl(F, Math.cos(yaw) * cp)), scl(D, -Math.sin(pitch))));
  const tw = row[4] ? row[4] * D2R * (finger.twistSign || 1) : 0;
  const next = (p, bend) => {
    let k = reject(hinge, p);
    if (len(k) < 1e-6) k = reject(D, p);
    k = norm(k);
    if (tw) k = turn(k, p, tw);
    return turn(p, k, bend * D2R);
  };
  const v2 = next(v1, row[2]), v3 = next(v2, row[3]);
  const j0 = finger.base, j1 = add(j0, scl(v1, finger.len[0])), j2 = add(j1, scl(v2, finger.len[1]));
  return [j0, j1, j2, add(j2, scl(v3, finger.len[2]))];
}

/** Hand-local point -> item space for a wrist placement { wrist, quat } on a hand of scale s. */
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qaxis = (k, a) => { const h = a / 2, s = Math.sin(h); return [k[0] * s, k[1] * s, k[2] * s, Math.cos(h)]; };
const placer = (wrist, quat, s) => p => add(wrist, rotate(quat, scl(p, s)));

/**
 * Wrist placement of a pose on this hand: the baked wrist moved by (1 - k) * REFERENCE_HAND.palm (hand frame) with
 * k = hand.length / REFERENCE_HAND.length, so the palm stays where the bake put it while the wrist sits further out for a
 * bigger hand (closer for a smaller one). A recorded pose (record.js) carries the length of the hand that recorded it
 * (`handLength`); its palm anchor is the reference palm scaled to that hand, so the wrist moves by
 * (handLength - hand.length) / REFERENCE_HAND.length * palm. Returns { wrist, quat } (item space).
 */
export function placeWrist(pose, hand, reference = REFERENCE_HAND) {
  if (Number.isFinite(pose.handLength) && pose.handLength > 0) {
    const d = (pose.handLength - hand.length) / reference.length;
    if (!Number.isFinite(d) || Math.abs(d) < 1e-6) return { wrist: [...pose.wrist], quat: [...pose.quat] };
    return { wrist: add(pose.wrist, rotate(pose.quat, scl(reference.palm, d))), quat: [...pose.quat] };
  }
  const k = hand.length / reference.length;
  if (!Number.isFinite(k) || Math.abs(k - 1) < 1e-4) return { wrist: [...pose.wrist], quat: [...pose.quat] };
  return { wrist: add(pose.wrist, rotate(pose.quat, scl(reference.palm, 1 - k))), quat: [...pose.quat] };
}

/** Signed gaps (m, skin vs surface) of segments k >= from of a chain, sampled at the middle and the end of each segment. */
function segmentGaps(chain, finger, place, distance, s, from, out) {
  for (let k = from; k < 3; k++) {
    const a = chain[k], b = chain[k + 1], r = finger.radius[k] * s;
    const mid = place([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]), end = place(b);
    out[k] = Math.min(distance(mid), distance(end)) - r;
  }
  return out;
}

/**
 * Close one finger along its shape, starting from the baked closed row (t = 1, the target shape): a bake whose segments
 * are deeper than `squeeze` inside the item opens along the shape (toward t = -backoff) until they are not; a bake
 * within `touch` of the surface is kept; otherwise the joints close further (up to 1 + overshoot) until a segment
 * presses `squeeze` into the surface. Joints proximal to a touching segment then stay, the distal ones keep closing
 * (a wrap: the fingertip curls on after the proximal phalanx touched). The thumb's CMC (dyaw, pitch) never goes past
 * the bake (swinging it further would slide the thumb around the item instead of pressing it). open/closed: rows (deg).
 * Returns { row, t: [segment 0, 1, 2 parameters], touching: segment indices at the surface, backedOff, stuck }.
 */
function closeFinger(name, finger, open, closed, place, distance, s, opts) {
  const H = HARD[name], deep = -opts.squeeze, thumb = name === 'Thumb', tMax = 1 + (thumb ? opts.thumbOvershoot ?? opts.overshoot : opts.overshoot);
  const lim = opts.free ? (j, v) => v : (j, v) => Math.max(H[KEYS[j]][0], Math.min(H[KEYS[j]][1], v));
  // T[0] drives dyaw + pitch (segment 0), T[1] bend1 (segment 1), T[2] bend2 (segment 2).
  const twisted = thumb && (open.length > 4 || closed.length > 4), tw0 = open[4] || 0, tw1 = closed[4] || 0;
  const rowAt = T => { const t0 = thumb ? Math.min(1, T[0]) : T[0];
    const r = [lim(0, open[0] + (closed[0] - open[0]) * t0), lim(1, open[1] + (closed[1] - open[1]) * t0),
      lim(2, open[2] + (closed[2] - open[2]) * T[1]), lim(3, open[3] + (closed[3] - open[3]) * T[2])];
    if (twisted) r.push(lim(4, tw0 + (tw1 - tw0) * t0));   // thumb twist rides on the CMC, like dyaw/pitch
    return r; };
  const gaps = [Infinity, Infinity, Infinity];
  /** Lowest segment >= from at or past `limit` (gap <= limit), else -1. */
  const reach = (T, from, limit) => {
    segmentGaps(fingerChain(finger, rowAt(T)), finger, place, distance, s, from, gaps);
    for (let k = from; k < 3; k++) if (gaps[k] <= limit) return k;
    return -1;
  };
  const T = [1, 1, 1], touching = [];
  const set = (from, t) => { for (let j = from; j < 3; j++) T[j] = t; return T; };
  let from = 0, backedOff = false;
  const deepest = () => Math.min(gaps[0], gaps[1], gaps[2]);
  const inside = reach(T, 0, deep);
  if (inside >= 0) {
    // The bake is inside the item on this hand: open the whole finger along its shape until it is not. The open path
    // need not lead out (a thumb's approach can swing through the item): if opening first goes deeper, keep the bake.
    const depth0 = deepest(), dt = opts.step / 2;
    let prev = 1, t = 1, clear = false;
    while (t > -opts.backoff + 1e-9) {
      t = Math.max(-opts.backoff, t - dt);
      if (reach(set(0, t), 0, deep) < 0) { clear = true; break; }
      if (deepest() < depth0 - opts.squeeze) break;
      prev = t;
    }
    if (!clear) {
      set(0, 1); reach(T, 0, deep);
      // Shallow enough to read as a firm press (within `tolerate`): keep the bake as the contact; deeper: stuck.
      if (depth0 >= -opts.tolerate) return { row: rowAt(T), t: [1, 1, 1], touching: [inside], backedOff: false, stuck: false };
      return { row: rowAt(T), t: [1, 1, 1], touching: [], backedOff: true, stuck: true };
    }
    // Bisect between the free t and the last t still inside; the segment inside there is the one that touches.
    let out = t, deeper = prev;
    for (let i = 0; i < opts.bisect; i++) { const m = (out + deeper) / 2; if (reach(set(0, m), 0, deep) >= 0) deeper = m; else out = m; }
    const k = reach(set(0, deeper), 0, deep);
    set(0, out); touching.push(k >= 0 ? k : inside); from = touching[0] + 1; backedOff = true;
  } else {
    const k = reach(T, 0, opts.touch);
    if (k >= 0) { touching.push(k); from = k + 1; }
  }
  while (from < 3) {
    const start = T[from];
    let prev = start, hit = -1, t = start;
    while (t < tMax) {
      t = Math.min(tMax, t + opts.step);
      if ((hit = reach(set(from, t), from, deep)) >= 0) break;
      prev = t;
    }
    // Nothing (more) touched up to the overshoot: the joints still free keep their shape.
    if (hit < 0) { set(from, start); break; }
    let lo = prev, hi = t;
    for (let i = 0; i < opts.bisect; i++) { const m = (lo + hi) / 2; if (reach(set(from, m), from, deep) >= 0) hi = m; else lo = m; }
    hit = reach(set(from, hi), from, deep);
    touching.push(hit);
    from = hit + 1;
  }
  return { row: rowAt(T), t: [...T], touching, backedOff, stuck: false };
}

const around = p => Math.atan2(p[2], p[0]);
const separation = (a, b) => { const x = Math.abs(a - b) % (2 * Math.PI); return x > Math.PI ? 2 * Math.PI - x : x; };
/** Thumb (dyaw, pitch) search for a wrap whose thumb missed along its shape; returns closeFinger's result + opposition or null. */
function searchThumb(thumb, open, closed, refAngle, place, distance, s, opts) {
  const H = HARD.Thumb, flexOpen = [open[2], open[3]], flexClosed = [Math.max(closed[2], 45), Math.max(closed[3], 50)];
  const tried = new Map();
  const tryAt = (dyaw, pitch) => {
    dyaw = Math.max(H.dyaw[0], Math.min(H.dyaw[1], dyaw)); pitch = Math.max(H.pitch[0], Math.min(H.pitch[1], pitch));
    const key = `${dyaw},${pitch}`;
    if (tried.has(key)) return tried.get(key);
    const tw = closed.length > 4 ? [closed[4]] : [];
    const r = closeFinger('Thumb', thumb, [dyaw, pitch, ...flexOpen, ...tw], [dyaw, pitch, ...flexClosed, ...tw], place, distance, s, opts);
    let out = null;
    if (!r.stuck && r.touching.length) {
      const opp = separation(around(place(fingerChain(thumb, r.row)[3])), refAngle) * 180 / Math.PI;
      out = { ...r, opposition: opp, cost: (Math.abs(dyaw - closed[0]) + Math.abs(pitch - closed[1])) / 60 + Math.max(0, opts.opposition - opp) / 5 };
    }
    tried.set(key, out);
    return out;
  };
  let best = null;
  const keep = r => { if (r && (!best || r.cost < best.cost)) best = r; };
  for (let dyaw = H.dyaw[0]; dyaw <= H.dyaw[1] + 1e-9; dyaw += 20) for (let pitch = H.pitch[0]; pitch <= H.pitch[1] + 1e-9; pitch += 20) keep(tryAt(dyaw, pitch));
  if (!best) return null;
  const [d0, p0] = best.row;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) keep(tryAt(d0 + 7 * i, p0 + 7 * j));
  return best;
}

/**
 * Where the pose's recording hand had its palm (item space): the bake's wrist + its hand frame x the palm of the hand
 * the data was fitted on (REFERENCE_HAND, the CharacterCreator lab hand: bake provenance, like a recording's
 * `handLength`); a recorded pose's palm is the reference palm scaled to its `handLength`. The character's own hand is
 * then placed by ITS profile palm against that point (placePalm), so the closure never assumes the reference size.
 */
export function palmAnchor(pose, side = pose.side, reference = REFERENCE_HAND) {
  const k = Number.isFinite(pose.handLength) && pose.handLength > 0 ? pose.handLength / reference.length : 1, c = reference.palmCenter;
  return add(pose.wrist, rotate(pose.quat, scl(side === 'left' ? [-c[0], c[1], c[2]] : c, k)));
}

/**
 * The thenar skin points moved with the thumb's metacarpal for a thumb row (deg; null = rest): the rotation that takes
 * the rest metacarpal direction to the row's, about the thumb base (the thenar bulk rides on the CMC joint).
 */
function thenarPoints(hand, thumbRow) {
  const t = hand.thenar;
  if (!thumbRow || !t.points.length) return t.points;
  const T = hand.fingers.Thumb, base = T.base, r0 = norm(sub(fingerChain(T, [0, 0, 0, 0])[1], base)), r1 = norm(sub(fingerChain(T, thumbRow)[1], base));
  const axis = cross(r0, r1), sin = len(axis);
  if (sin < 1e-6) return t.points;
  const angle = Math.atan2(sin, dot(r0, r1)), k = scl(axis, 1 / sin);
  return t.points.map(p => add(base, turn(sub(p, base), k, angle)));
}

/** Smallest signed distance (m) of the hand's palm patch and thenar on a placement (skin points: no pad). */
function palmGaps(hand, place, distance, thumbRow = null) {
  let palm = Infinity;
  for (const p of hand.palm.samples) palm = Math.min(palm, distance(place(p)));
  const s = hand.scale, t = hand.thenar;
  let thenar = Infinity;
  if (t.points.length) for (const p of thenarPoints(hand, thumbRow)) thenar = Math.min(thenar, distance(place(p)));
  else for (const k of [0, 0.5, 1]) thenar = Math.min(thenar, distance(place(add(t.a, scl(sub(t.b, t.a), k)))) - t.radius * s);
  return { palm, thenar };
}

/**
 * Wrist placement from the hand profile: the profile's palm centre on the pose's palm anchor (palmAnchor), same hand
 * orientation, then slid along the palm normal until the palm patch is `palmGap` (m, CLOSURE) from the item's surface
 * (at most `palmSlide` either way), and backed off along the normal while the thenar / thumb root (profile thumbRoot) is
 * inside the item. `offset` (closeToContact's search; hand frame, about the palm centre, before the slide):
 * { lateral (m, + = radial), along (m, the hand point put on the anchor moves from the palm centre toward the knuckles:
 * the hand moves back, so a narrow item sits under the distal palm of a long hand), pitch (deg, about the hand's X axis:
 * + lowers the knuckle end of the palm, lifts the thenar), twist (deg, about the palm normal), normal (m, after the
 * slide, + = away from the item) }. thumbRow: the thumb row (deg) the thenar is checked with (default: the pose's open
 * approach row: the closing thumb keeps its own metacarpal out, see closeFinger).
 * Returns { wrist, quat, palmGap, thenarGap } (item space, m).
 */
export function placePalm(pose, hand, shape, options = CLOSURE, offset = null, thumbRow = pose.open?.[0] ?? null) {
  const opts = { ...CLOSURE, ...options }, s = hand.scale, o = offset || {};
  let quat = [...pose.quat];
  if (o.pitch) quat = qmul(quat, qaxis([1, 0, 0], o.pitch * D2R));
  if (o.twist) quat = qmul(quat, qaxis(hand.palm.normal, o.twist * D2R));
  let pivot = palmAnchor(pose, hand.side);
  if (o.lateral) pivot = add(pivot, rotate(pose.quat, [hand.side === 'left' ? -o.lateral : o.lateral, 0, 0]));
  const c = hand.palm.center, at = o.along ? [c[0], c[1], c[2] + o.along / s] : c;
  let wrist = sub(pivot, rotate(quat, scl(at, s)));
  if (!shape) return { wrist, quat };
  const distance = p => signedDistance(shape, p), n = rotate(quat, hand.palm.normal);
  let moved = 0, g = palmGaps(hand, placer(wrist, quat, s), distance, thumbRow);
  for (let i = 0; i < 3 && Number.isFinite(g.palm); i++) {
    const want = Math.max(-opts.palmSlide - moved, Math.min(opts.palmSlide - moved, g.palm - opts.palmGap - (hand.profile.palmOffset || 0) * s));
    if (Math.abs(want) < 1e-4) break;
    wrist = add(wrist, scl(n, want)); moved += want;
    g = palmGaps(hand, placer(wrist, quat, s), distance, thumbRow);
  }
  for (let i = 0; i < 3 && g.thenar < -opts.squeeze; i++) {
    wrist = add(wrist, scl(n, g.thenar + opts.squeeze / 2));
    g = palmGaps(hand, placer(wrist, quat, s), distance, thumbRow);
  }
  if (o.normal) { wrist = add(wrist, scl(n, -o.normal)); g = palmGaps(hand, placer(wrist, quat, s), distance, thumbRow); }
  return { wrist, quat, palmGap: g.palm, thenarGap: g.thenar };
}

/** Close the five fingers on one placement (see closeToContact); returns { angles (unclamped), fingers }. */
function closeAll(hand, rows, placed, distance, keep, opts, wrap) {
  const s = hand.scale, place = placer(placed.wrist, placed.quat, s), angles = {}, fingers = {};
  FINGERS.forEach((f, i) => {
    const kept = keep.includes(f), r = closeFinger(f, hand.fingers[f], rows.open[i], rows.angles[i], place, distance, s, { ...opts, ...(kept && { free: true }), ...(!wrap && { overshoot: 0 }) });
    angles[f] = r.row; fingers[f] = { t: r.t, touching: r.touching, backedOff: r.backedOff, stuck: r.stuck, ...(kept && { kept }) };
  });
  const thumb = fingers.Thumb;
  // a baked-shape thumb that ends within gradeGrasp's reach (3 mm) is kept: it counts as touching, and a searched CMC drifts
  // from the skin (SEARCHED_THUMB)
  const near = () => { const g = segmentGaps(fingerChain(hand.fingers.Thumb, angles.Thumb), hand.fingers.Thumb, place, distance, s, 0, [0, 0, 0]); return Math.min(g[1], g[2]) <= 0.003; };
  if (opts.thumbSearch && wrap && !thumb.kept && (opts.thumbSearch === 'any' ? thumb.stuck || !thumb.touching.length : !thumb.stuck && !thumb.touching.length) && (thumb.stuck || !near())) {
    const tips = ['Index', 'Middle'].map(f => place(fingerChain(hand.fingers[f], angles[f])[3]));
    const ref = around([(tips[0][0] + tips[1][0]) / 2, 0, (tips[0][2] + tips[1][2]) / 2]);
    const clampedOpen = clampRows({ Thumb: rows.open[0] }).Thumb, clampedClosed = clampRows({ Thumb: rows.angles[0] }).Thumb;
    const r = searchThumb(hand.fingers.Thumb, clampedOpen, clampedClosed, ref, place, distance, s, opts);
    if (r && r.opposition >= opts.opposition) {
      angles.Thumb = r.row;
      fingers.Thumb = { t: r.t, touching: r.touching, backedOff: false, searched: true, opposition: Math.round(r.opposition * 10) / 10 };
    }
  }
  return { angles, fingers };
}

/**
 * Bone-model grade of a closed grasp (m / deg): deepest segment, palm patch and thenar gaps, fingertips (index..little
 * distal segment within `reach`), thumb touching (distal or middle segment), thumb opposition around the item's +Y axis,
 * and `score` (higher is better): contacts and opposition up, penetration and a palm far from the item down.
 */
export function gradeGrasp(hand, shape, placed, angles, { reach = 0.003, palmGap = CLOSURE.palmGap, wrap = true } = {}) {
  const s = hand.scale, place = placer(placed.wrist, placed.quat, s), distance = p => signedDistance(shape, p);
  const list = Array.isArray(angles) ? angles : FINGERS.map(f => angles[f]);
  let deepest = Infinity;
  const tips = {}, gaps = {};
  FINGERS.forEach((f, i) => {
    const chain = fingerChain(hand.fingers[f], list[i]), g = segmentGaps(chain, hand.fingers[f], place, distance, s, 0, [0, 0, 0]);
    gaps[f] = g; deepest = Math.min(deepest, ...g); tips[f] = place(chain[3]);
  });
  const pg = palmGaps(hand, place, distance, list[0]);
  const fingersTouching = FINGERS.slice(1).filter(f => gaps[f][2] <= reach).length;
  const thumbTouching = Math.min(gaps.Thumb[1], gaps.Thumb[2]) <= reach;
  const ref = [(tips.Index[0] + tips.Middle[0]) / 2, 0, (tips.Index[2] + tips.Middle[2]) / 2];
  const opposition = separation(around(tips.Thumb), around(ref)) * 180 / Math.PI;
  const pen = Math.max(0, -Math.min(deepest, pg.thenar, pg.palm)) * 1000;
  let score = 3 * fingersTouching - 6 * Math.max(0, pen - 1.5) - 1.5 * Math.max(0, pg.palm * 1000 - Math.max(5, palmGap * 1000 + 1));
  if (wrap) score += (thumbTouching ? 5 : 0) + (thumbTouching ? Math.min(opposition, 140) / 35 : 0) + (thumbTouching && opposition >= 125 ? 3 : 0);
  return { score, penetration: pen / 1000, deepest, palmGap: pg.palm, thenarGap: pg.thenar, fingersTouching, thumbTouching, opposition, gaps };
}

/**
 * Bounded wrist search per grasp quality (closeToContact `search`): placePalm offsets tried (every combination; each
 * candidate is re-slid to the palm gap): `lateral` across the palm (fraction of the profile palm width, + = radial),
 * `along` (fraction of the palm centre -> middle knuckle distance: the hand point on the palm anchor moves toward the
 * knuckles, the hand back; a long hand on a narrow item), `pitch` (deg) about the hand's X axis (+ rolls the palm contact toward the knuckles, lifting the thenar: a hand with a
 * big thumb root), `twist` (deg) about the palm normal, `normal` along the palm normal (fraction of the hand length,
 * + = away from the item).
 * Every candidate is one closure of the five fingers; the best gradeGrasp score wins (the unsearched placement unless
 * another is better by `margin`). thumbSearch 'any': the thumb CMC search also runs for a stuck thumb (its bake inside the
 * item on this hand, e.g. a bigger thumb). Fractions of the profile's sizes, so the steps follow the hand.
 */
export const SEARCH = Object.freeze({
  mid: Object.freeze({ normal: [0], lateral: [-0.12, 0, 0.12], along: [0, 0.4, 0.8], pitch: [-10, 0, 20], twist: [0], margin: 1, thumbSearch: 'any' }),
  high: Object.freeze({ normal: [0, 0.02], lateral: [-0.12, 0, 0.12], along: [0, 0.4, 0.8], pitch: [-10, 0, 20], twist: [-12, 0, 12], margin: 1, thumbSearch: 'any' }),
});

/** Score handicap of a searched thumb in closeToContact's search (see there). */
const SEARCHED_THUMB = 4;
/** gradeGrasp score of a full wrap (4 fingertips, thumb touching, opposition >= 140 deg, no penalty): the search stops there. */
const GRADE_FULL = 3 * 4 + 5 + 140 / 35 + 3;
// A thumb closed far past its baked shape (t > THUMB_STRETCH.from) scores THUMB_STRETCH.per less per unit t: the bone thumb
// under-reads the skin most there (grasp lab, CC beer r180 / neck bakes: 6-8 mm skin inside at t ~1.7, bone model -1 mm).
const THUMB_STRETCH = Object.freeze({ from: 1.4, per: 8 });

/**
 * Close every finger of `rows` ({ open, angles }: 5 rows each, deg, thumb..little) to contact with `shape` on the hand
 * (handGeometry: the character's hand profile). Placement: { wrist, quat } when given (the shown wrist, 'high' re-check),
 * else placePalm (the profile's palm patch on the pose's palm anchor, thenar kept out). `keep`: fingers closed along their
 * own rows without the joint ranges (a CLAMP_EXEMPT bake's thumb). `search`: null | 'mid' | 'high' | a SEARCH-like object:
 * a bounded search over wrist offsets (wraps only, never with a given wrist) keeping the best gradeGrasp score; the
 * thumb's CMC is searched (see CLOSURE) when it touches nothing along its shape.
 * Returns { open, angles (clamped rows), wrist, quat, fingers: { f: { t, touching, backedOff, stuck?, kept?, searched? } },
 * grade, tried (closures run) }.
 */
export function closeToContact(pose, hand, shape, { rows = pose, wrist = null, quat = null, keep = [], options = CLOSURE, search = null } = {}) {
  const opts = { ...CLOSURE, ...options }, wrap = (pose.mode ?? 'wrap') === 'wrap', distance = p => signedDistance(shape, p);
  const given = !!(wrist && quat), base = given ? { wrist, quat } : placePalm(pose, hand, shape, opts, null, rows.open[0]);
  const plan = !given && wrap && search ? (typeof search === 'string' ? SEARCH[search] : search) : null;
  // A searched thumb (CMC off its baked shape) scores SEARCHED_THUMB less: the capsule thumb drifts from the skin away from
  // the bake (grasp lab: up to 9 mm skin inside on the CC hand), so a bake-shaped thumb that touches is preferred.
  const run = (placed, o) => {
    const r = closeAll(hand, rows, placed, distance, keep, o, wrap), grade = gradeGrasp(hand, shape, placed, r.angles, { palmGap: opts.palmGap + (hand.profile.palmOffset || 0) * hand.scale, wrap });
    if (r.fingers.Thumb.searched) grade.score -= SEARCHED_THUMB;
    if (wrap) grade.score -= THUMB_STRETCH.per * Math.max(0, Math.max(...r.fingers.Thumb.t) - THUMB_STRETCH.from);
    return { placed, ...r, grade };
  };
  let best = run(base, opts), tried = 1;
  // Unsearched (raw/low) tiers: a thumb whose baked shape is already inside the item on this hand (a hand much bigger than
  // the bake's: the 1.56x VRM test hand) or misses it gets one CMC search (kept only when it grades better).
  if (!plan && !given && wrap && (best.fingers.Thumb.stuck || !best.fingers.Thumb.touching.length) && !keep.includes('Thumb')) {
    const r = run(base, { ...opts, thumbSearch: 'any' }); tried++; if (r.grade.score > best.grade.score) best = r;
  }
  if (plan) {
    const o = { ...opts, thumbSearch: plan.thumbSearch ?? opts.thumbSearch }, s = hand.scale;
    if (o.thumbSearch && (best.fingers.Thumb.stuck || !best.fingers.Thumb.touching.length)) { const r = run(base, o); tried++; if (r.grade.score > best.grade.score) best = r; }
    const width = (hand.profile.palmWidth || 0.43 * hand.profile.length) * s, L = hand.profile.length * s;
    let winner = best;
    const span = Math.max(0, hand.fingers.Middle.base[2] - hand.palm.center[2]) * s;
    // Every combination, nearest first; none when the placePalm grasp already grades full (GRADE_FULL: 4 fingertips, thumb
    // touching with >= 140 deg opposition, no penalty), and it stops at the first full-grade candidate.
    const offsets = [];
    for (const dn of plan.normal ?? [0]) for (const dl of plan.lateral ?? [0]) for (const da of plan.along ?? [0]) for (const pitch of plan.pitch ?? [0]) for (const twist of plan.twist ?? [0]) {
      if (dn || dl || da || pitch || twist) offsets.push({ dn, dl, da, pitch, twist, cost: Math.abs(dn) * 20 + Math.abs(dl) * 4 + Math.abs(da) + Math.abs(pitch) / 15 + Math.abs(twist) / 15 });
    }
    offsets.sort((a, b) => a.cost - b.cost);
    for (const { dn, dl, da, pitch, twist } of best.grade.score >= GRADE_FULL - 1e-9 ? [] : offsets) {
      const r = run(placePalm(pose, hand, shape, opts, { normal: dn * L, lateral: dl * width, along: da * span, pitch, twist }, rows.open[0]), o); tried++;
      if (r.grade.score > winner.grade.score) winner = r;
      if (winner.grade.score >= GRADE_FULL - 1e-9) break;
    }
    if (winner !== best && winner.grade.score >= best.grade.score + (plan.margin ?? 0)) best = winner;
  }
  const { angles, fingers, placed, grade } = best;
  const clamped = clampRows(angles), open = clampRows(Object.fromEntries(FINGERS.map((f, i) => [f, rows.open[i]])));
  return { open: FINGERS.map((f, i) => keep.includes(f) ? rows.open[i] : open[f]), angles: FINGERS.map(f => keep.includes(f) ? angles[f] : clamped[f]),
    wrist: placed.wrist, quat: placed.quat, fingers, grade, tried };
}

/** Bone-model contact readout (m) of rows on a placed hand: per finger the smallest segment gap and the tip gap. */
export function chainGaps(hand, shape, placed, angles) {
  const s = hand.scale, place = placer(placed.wrist, placed.quat, s), distance = p => signedDistance(shape, p), out = {};
  FINGERS.forEach((f, i) => {
    const g = segmentGaps(fingerChain(hand.fingers[f], angles[i]), hand.fingers[f], place, distance, s, 0, [0, 0, 0]);
    out[f] = { min: Math.min(...g), segments: g };
  });
  return out;
}
