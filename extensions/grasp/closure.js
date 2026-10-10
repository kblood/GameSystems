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
const KEYS = ['dyaw', 'pitch', 'bend1', 'bend2'];
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
 * the palm anchor is the mean of the lowest 10 % palm skin vertices in the hand frame).
 */
export const REFERENCE_HAND = { length: 0.203, palm: [0, -0.0238, 0.0685] };
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
export const CLOSURE = Object.freeze({ overshoot: 0.35, backoff: 0.5, squeeze: 0.001, touch: 0.002, tolerate: 0.002, step: 0.1, bisect: 6, opposition: 130, thumbSearch: false });

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

/**
 * Hand geometry for close-to-contact from a character's rest hand (see the header for the shape of `rest`).
 * rest: { side, frame: {F, D, R} (rest frame of that hand, character frame), wrist: rest wrist joint,
 *         fingers: { Thumb..Little: { pts: [knuckle, joint, joint, tip], len?: [3], rest?: { yaw } } } }
 * options: scale (world metres per rig metre, the character's scale), thumbTilt, radii (overrides PAD_RADIUS); scale and
 * thumbTilt default to rest.scale / rest.thumbTilt, so the avatar extension's entity.restHand(side) is complete input.
 * Returns { side, scale, length (world m, wrist -> middle fingertip), thumbTilt, fingers: { f: { base, len, restYaw,
 * radius, axes, hinge } } }; everything in hand-local rig metres except `length`.
 */
export function handGeometry(rest, { scale = rest?.scale ?? 1, thumbTilt = rest?.thumbTilt ?? THUMB_TILT, radii = PAD_RADIUS } = {}) {
  const { side, frame, wrist } = rest;
  if (side !== 'left' && side !== 'right') throw new TypeError(`handGeometry: side ${side}?`);
  const X = norm(cross(frame.D, frame.F)), Y = norm(frame.D), Z = norm(frame.F);
  const toLocal = v => [dot(v, X), dot(v, Y), dot(v, Z)];
  const fingers = {};
  for (const f of FINGERS) {
    const src = rest.fingers[f], pts = src.pts.map(p => toLocal(sub(p, wrist)));
    const lens = src.len || [0, 1, 2].map(k => len(sub(pts[k + 1], pts[k])));
    const axes = fingerAxes(f, side, thumbTilt), v0 = norm(sub(pts[1], pts[0]));
    fingers[f] = { base: pts[0], len: lens, axes, hinge: norm(cross(axes.D, axes.F)),
      restYaw: src.rest?.yaw ?? Math.atan2(dot(v0, axes.R), dot(v0, axes.F)), radius: [0, 0, 0] };
  }
  const m = fingers.Middle, length = len(m.base) + m.len[0] + m.len[1] + m.len[2];
  for (const f of FINGERS) fingers[f].radius = radii[f].map(r => r * length);
  return { side, scale, length: length * scale, thumbTilt, fingers };
}

/**
 * handGeometry() from an avatar extension rig (the public `entity.rig`: rig.hands[side] and the
 * rest heads rig.H) and the character's world scale (`player.scale`). Any character that exposes the same rest-hand
 * fields works; others call handGeometry() directly.
 */
export function handFromRig(rig, side, { scale = 1, ...options } = {}) {
  const h = rig?.hands?.[side], wrist = rig?.H?.[`${side}Hand`];
  if (!h || !wrist) return null;
  return handGeometry({ side, frame: h.frame, wrist, fingers: h.fingers }, { scale, ...options });
}

/** Joint positions [knuckle, joint, joint, tip] (hand-local rig metres) of one finger for a row in degrees. */
export function fingerChain(finger, row) {
  const { axes: { F, D, R }, hinge } = finger;
  const yaw = finger.restYaw + (row[0] || 0) * D2R, pitch = row[1] * D2R, cp = Math.cos(pitch);
  const v1 = norm(add(add(scl(R, Math.sin(yaw) * cp), scl(F, Math.cos(yaw) * cp)), scl(D, -Math.sin(pitch))));
  const next = (p, bend) => {
    let k = reject(hinge, p);
    if (len(k) < 1e-6) k = reject(D, p);
    return turn(p, norm(k), bend * D2R);
  };
  const v2 = next(v1, row[2]), v3 = next(v2, row[3]);
  const j0 = finger.base, j1 = add(j0, scl(v1, finger.len[0])), j2 = add(j1, scl(v2, finger.len[1]));
  return [j0, j1, j2, add(j2, scl(v3, finger.len[2]))];
}

/** Hand-local point -> item space for a wrist placement { wrist, quat } on a hand of scale s. */
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
  const H = HARD[name], deep = -opts.squeeze, tMax = 1 + opts.overshoot, thumb = name === 'Thumb';
  const lim = opts.free ? (j, v) => v : (j, v) => Math.max(H[KEYS[j]][0], Math.min(H[KEYS[j]][1], v));
  // T[0] drives dyaw + pitch (segment 0), T[1] bend1 (segment 1), T[2] bend2 (segment 2).
  const rowAt = T => { const t0 = thumb ? Math.min(1, T[0]) : T[0];
    return [lim(0, open[0] + (closed[0] - open[0]) * t0), lim(1, open[1] + (closed[1] - open[1]) * t0),
      lim(2, open[2] + (closed[2] - open[2]) * T[1]), lim(3, open[3] + (closed[3] - open[3]) * T[2])]; };
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
    const r = closeFinger('Thumb', thumb, [dyaw, pitch, ...flexOpen], [dyaw, pitch, ...flexClosed], place, distance, s, opts);
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
 * Close every finger of `rows` ({ open, angles }: 5 rows each, deg, thumb..little) to contact with `shape` for the hand
 * placed at { wrist, quat } (item space; default: placeWrist(pose, hand)). `keep`: fingers closed along their own rows without
 * the joint ranges (a CLAMP_EXEMPT bake's thumb). The thumb is searched (see CLOSURE) only when it touches
 * nothing along its shape; a stuck thumb (bake too deep, opening goes deeper) keeps the clamped bake.
 * Returns { open, angles (clamped rows), wrist, quat, fingers: { f: { t, touching, backedOff, stuck?, kept?, searched? } } }.
 */
export function closeToContact(pose, hand, shape, { rows = pose, wrist = null, quat = null, keep = [], options = CLOSURE } = {}) {
  const placed = wrist && quat ? { wrist, quat } : placeWrist(pose, hand);
  const s = hand.scale, place = placer(placed.wrist, placed.quat, s), distance = p => signedDistance(shape, p);
  const opts = { ...CLOSURE, ...options }, angles = {}, fingers = {}, wrap = (pose.mode ?? 'wrap') === 'wrap';
  FINGERS.forEach((f, i) => {
    const kept = keep.includes(f), r = closeFinger(f, hand.fingers[f], rows.open[i], rows.angles[i], place, distance, s, { ...opts, ...(kept && { free: true }), ...(!wrap && { overshoot: 0 }) });
    angles[f] = r.row; fingers[f] = { t: r.t, touching: r.touching, backedOff: r.backedOff, stuck: r.stuck, ...(kept && { kept }) };
  });
  const thumb = fingers.Thumb;
  if (opts.thumbSearch && wrap && !thumb.kept && !thumb.stuck && !thumb.touching.length) {
    const tips = ['Index', 'Middle'].map(f => place(fingerChain(hand.fingers[f], angles[f])[3]));
    const ref = around([(tips[0][0] + tips[1][0]) / 2, 0, (tips[0][2] + tips[1][2]) / 2]);
    const clampedOpen = clampRows({ Thumb: rows.open[0] }).Thumb, clampedClosed = clampRows({ Thumb: rows.angles[0] }).Thumb;
    const r = searchThumb(hand.fingers.Thumb, clampedOpen, clampedClosed, ref, place, distance, s, opts);
    if (r && r.opposition >= opts.opposition) {
      angles.Thumb = r.row;
      fingers.Thumb = { t: r.t, touching: r.touching, backedOff: false, searched: true, opposition: Math.round(r.opposition * 10) / 10 };
    }
  }
  const clamped = clampRows(angles), open = clampRows(Object.fromEntries(FINGERS.map((f, i) => [f, rows.open[i]])));
  return { open: FINGERS.map((f, i) => keep.includes(f) ? rows.open[i] : open[f]), angles: FINGERS.map(f => keep.includes(f) ? angles[f] : clamped[f]), wrist: placed.wrist, quat: placed.quat, fingers };
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
