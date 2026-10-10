// GameSystems avatar extension: hand poses and hand animations (extensions plan step 7). MIT (GameSystems/LICENSE).
// One format for every hand pose and hand animation, retargetable to any character because the angles live in the hand
// frame (fingers.js chainAngles):
//   clip  = { id, kind: 'pose' | 'animation', space: 'hand' | 'item' | 'grasp', duration?, loop?, side?, frames }
//   frame = { t (s), wrist: { pos [3] m, quat [x,y,z,w] }, rows: { Thumb..Little: [dyaw, pitch, bend1, bend2] } (deg) }
// A pose is a one-frame clip. space 'hand': the wrist is relative to the tracked hand (gestures); 'item': the wrist is
// in item space (grasp animations recorded on an item); 'grasp': a template for any grasp, whose frames carry `mix`
// (0 = the grasp's `from` rows, 1 = its `to` rows; a number or per finger) instead of rows and whose wrist is an offset
// from the grasp wrist in the hand frame (resolveClip() turns it into plain frames for a concrete grasp).
// Hand frame: +Z wrist -> middle knuckle, +Y back of the hand, +X = Y x Z (grasp closure.js, record.js).
//
// Data: hand_poses.json (tools/make_hand_poses.mjs: Godot Contracts' named poses + this extension's curves + authored
// gestures, clamped to LIMITS) and recorded_hand.json (Grasp Studio's animation/gesture modes), merged by buildLibrary.
//
// Quality (HAND_POSE_QUALITY, global like grasp's setGraspQuality; cheap at every tier, a few hundred flops per hand):
//   'low'  the old synthetic curves: controller fingers from fingerStateFromCurls, the grab a linear open -> closed lerp,
//          no release animation
//   'mid'  data poses: controller fingers follow each curl along the library's flat -> fist rows; the grab and release
//          play their clips (linear between keyframes)
//   'high' 'mid' + controller gestures from the capacitive touch sensors (an untouched trigger points, a lifted thumb on a
//          held grip gives a thumbs up, eased) and Catmull-Rom interpolation between keyframes (default)
// Recording pipeline (processRecording, used by Grasp Studio): One Euro filter -> keyframe reduction -> validator per
// keyframe (pass grasp's clampRows/validateRows through the grasp public API; avatar never imports grasp).
import LIBRARY from './hand_poses.json' with { type: 'json' };
import RECORDED from './recorded_hand.json' with { type: 'json' };
import { FINGERS } from './rigdata.js';
import { LIMITS, curlOf } from './fingers.js';
import { createOneEuro, oneEuro, createPoseFilter, filterPose } from './filters.js';
import { qSlerp, qMul, qNormalize, qAngle, qRotate } from './qx.js';

export const HAND_FORMAT = 'gamesystems.hand-animation.v1';
export const HAND_POSES_SCHEMA = 'gamesystems.hand-poses.v1';
export const HAND_RECORDINGS_SCHEMA = 'gamesystems.hand-recordings.v1';
export const HAND_POSE_QUALITY = Object.freeze(['low', 'mid', 'high']);
let quality = 'high';
/** Set the hand-pose tier for every player ('low' = the old curves; see the header). Returns the active tier. */
export function setHandPoseQuality(q) { quality = HAND_POSE_QUALITY.includes(q) ? q : 'high'; return quality; }
export const handPoseQuality = () => quality;

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const KEYS = ['yaw', 'pitch', 'bend1', 'bend2'];
/** Joint ranges in degrees per digit, row order [dyaw, pitch, bend1, bend2] (= fingers.js LIMITS = grasp HARD). */
export const LIMITS_DEG = Object.freeze(Object.fromEntries(FINGERS.map(f => [f, KEYS.map(k => LIMITS[f][k].map(v => v * R2D))])));
export const IDENTITY_WRIST = Object.freeze({ pos: Object.freeze([0, 0, 0]), quat: Object.freeze([0, 0, 0, 1]) });
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smooth = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

// ---- rows ------------------------------------------------------------------------------------------------------------
/** Rows as { Thumb..Little: [4] } from that object or an array of 5 rows (grasp data); missing digits -> null. Copies. */
export function toRows(rows) {
  const out = {};
  FINGERS.forEach((f, i) => { const r = Array.isArray(rows) ? rows[i] : rows?.[f]; out[f] = Array.isArray(r) && r.length === 4 ? r.map(Number) : null; });
  return out;
}
/** Rows as an array of 5 rows (thumb..little), the grasp data layout. */
export const rowsToArray = rows => FINGERS.map(f => [...rows[f]]);
/** Clamp rows into LIMITS: { rows, clamped: [{ finger, joint, value, limit }] }. Non-finite values become 0. */
export function limitRows(rows) {
  const out = {}, clamped = [];
  for (const f of FINGERS) {
    const r = rows?.[f];
    if (!r) { out[f] = null; continue; }
    out[f] = r.map((v, j) => {
      const [lo, hi] = LIMITS_DEG[f][j], x = Number.isFinite(v) ? v : 0, c = clamp(x, lo, hi);
      if (c !== v) clamped.push({ finger: f, joint: j === 0 ? 'dyaw' : KEYS[j], value: v, limit: c });
      return c;
    });
  }
  return { rows: out, clamped };
}
/** a -> b by t (number or { finger: t }); a null digit takes the other side. Writes into out when given. */
export function mixRows(a, b, t, out = {}) {
  for (const f of FINGERS) {
    const x = a?.[f], y = b?.[f], k = typeof t === 'number' ? t : (t?.[f] ?? 1);
    if (!x || !y) { out[f] = (x || y) ? [...(x || y)] : null; continue; }
    const o = out[f] || (out[f] = [0, 0, 0, 0]);
    for (let j = 0; j < 4; j++) o[j] = x[j] + (y[j] - x[j]) * k;
  }
  return out;
}
/**
 * Finger state (radians, the avatar's input; yaw null = the rest spread + dyaw) from rows in degrees. src: a string or
 * { finger: src }. curl = fingers.js curlOf of the angles unless `curl` (number) is given.
 */
export function stateFromRows(rows, { src = 'pose', curl = null } = {}) {
  const out = {};
  for (const f of FINGERS) {
    const r = rows?.[f];
    if (!r) { out[f] = null; continue; }
    const a = { yaw: null, dyaw: r[0] * D2R, pitch: r[1] * D2R, bend1: r[2] * D2R, bend2: r[3] * D2R };
    a.curl = curl ?? curlOf(f, a);
    a.src = typeof src === 'string' ? src : (src?.[f.toLowerCase()] ?? src?.[f] ?? 'pose');
    out[f] = a;
  }
  return out;
}
/** Rows (deg) of a finger state (radians); yaw is ignored (dyaw is the relative spread). */
export function rowsFromState(state) {
  const out = {};
  for (const f of FINGERS) { const s = state?.[f]; out[f] = s ? [(s.dyaw ?? 0) * R2D, s.pitch * R2D, s.bend1 * R2D, s.bend2 * R2D] : null; }
  return out;
}

// ---- library ---------------------------------------------------------------------------------------------------------
const isVec = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
const isRows = rows => rows && FINGERS.every(f => isVec(rows[f], 4));
/** Structural check of a clip (the endpoint and the loader use it). */
export function isClip(c) {
  if (!c || typeof c.id !== 'string' || !c.id || !['pose', 'animation'].includes(c.kind) || !['hand', 'item', 'grasp'].includes(c.space)) return false;
  if (!Array.isArray(c.frames) || !c.frames.length || (c.kind === 'pose' && c.frames.length !== 1)) return false;
  let last = -Infinity;
  for (const f of c.frames) {
    if (!Number.isFinite(f?.t) || f.t < last || !isVec(f.wrist?.pos, 3) || !isVec(f.wrist?.quat, 4)) return false;
    last = f.t;
    if (c.space === 'grasp' ? !(Number.isFinite(f.mix) || (f.mix && FINGERS.every(g => Number.isFinite(f.mix[g])))) : !isRows(f.rows)) return false;
  }
  return true;
}
/**
 * The library: { poses: Map(id -> clip), clips: Map(id -> clip) } from a hand_poses.json document and recorded clips
 * (recorded_hand.json). A recorded clip replaces the library entry with the same id; invalid recorded clips are skipped.
 * Pose rows are clamped to LIMITS (the generator already did; recordings are clamped by processRecording too).
 */
export function buildLibrary(base = LIBRARY, recorded = RECORDED) {
  const poses = new Map(), clips = new Map();
  const put = c => {
    if (c.kind === 'pose') {
      const frame = c.frames[0];
      poses.set(c.id, { ...c, frames: [{ ...frame, rows: limitRows(frame.rows).rows }] });
    } else clips.set(c.id, c);
  };
  for (const c of [...(base?.poses || []), ...(base?.clips || [])]) if (isClip(c)) put(c);
  for (const c of recorded?.clips || []) if (isClip(c)) put({ ...c, recorded: c.recorded ?? true });
  return { poses, clips, controller: base?.controller ?? LIBRARY.controller };
}
export let HAND_LIBRARY = buildLibrary();
/** Replace the active library (tests, a game shipping its own poses); returns it. */
export function setHandLibrary(library) { HAND_LIBRARY = library?.poses ? library : buildLibrary(); invalidate(); return HAND_LIBRARY; }
/** Rows of a named pose (relaxed, open, flat, fist, point, pinch, thumbs_up, pistol, trigger, support, ...), or null. */
export const handPose = (id, library = HAND_LIBRARY) => library.poses.get(id)?.frames[0].rows ?? null;
/** A named animation clip (grab, release, pour, wave, beckon, recorded ones), or null. */
export const handClip = (id, library = HAND_LIBRARY) => library.clips.get(id) ?? library.poses.get(id) ?? null;
export const poseNames = (library = HAND_LIBRARY) => [...library.poses.keys()];
export const clipNames = (library = HAND_LIBRARY) => [...library.clips.keys()];
/** Finger state of a named pose (radians), or null. */
export function poseState(id, { library = HAND_LIBRARY, src = 'pose' } = {}) {
  const rows = handPose(id, library);
  return rows ? stateFromRows(rows, { src }) : null;
}

// ---- playback --------------------------------------------------------------------------------------------------------
export const clipDuration = clip => clip.duration ?? clip.frames.at(-1).t;
const frameRows = (frame, from, to, out) => (frame.rows ? frame.rows : mixRows(from, to, frame.mix, out));
const catmull = (p0, p1, p2, p3, u) => {
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (3 * p1 - p0 - 3 * p2 + p3) * u3);
};
function nlerp(a, b, u) {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  return qNormalize([0, 1, 2, 3].map(k => a[k] + (s * b[k] - a[k]) * u));
}
/**
 * Clip at `time` (s): { t, wrist: { pos, quat }, rows }. loop: wrap (default clip.loop), else clamp to the ends.
 * Grasp templates need { from, to } rows. quality 'high': Catmull-Rom between keyframes (+ slerp), else linear (+ nlerp).
 * Cubic overshoot is clamped to LIMITS widened to the segment's own keyframes, so a keyframe is always reproduced exactly.
 */
export function sampleClip(clip, time, { from = null, to = null, loop = clip.loop, quality: q = quality } = {}) {
  const F = clip.frames, n = F.length, dur = clipDuration(clip);
  let t = Number.isFinite(time) ? time : 0;
  if (loop && dur > 0) t = ((t % dur) + dur) % dur; else t = clamp(t, F[0].t, F[n - 1].t);
  let i = 0;
  while (i < n - 2 && t > F[i + 1].t) i++;
  if (n === 1) return { t, wrist: { pos: [...F[0].wrist.pos], quat: [...F[0].wrist.quat] }, rows: toRows(frameRows(F[0], from, to, {})) };
  const a = F[i], b = F[i + 1], span = b.t - a.t, u = span > 0 ? clamp((t - a.t) / span, 0, 1) : 1;
  const ra = frameRows(a, from, to, {}), rb = frameRows(b, from, to, {});
  const rows = {};
  if (q === 'high' && n > 2) {
    const pa = i > 0 ? F[i - 1] : (loop ? F[n - 2] : a), pb = i + 2 < n ? F[i + 2] : (loop ? F[1] : b);
    const r0 = frameRows(pa, from, to, {}), r3 = frameRows(pb, from, to, {});
    for (const f of FINGERS) {
      if (!ra[f] || !rb[f]) { rows[f] = ra[f] || rb[f] ? [...(ra[f] || rb[f])] : null; continue; }
      const p0 = r0[f] || ra[f], p3 = r3[f] || rb[f];
      rows[f] = ra[f].map((v, j) => {
        const lo = Math.min(LIMITS_DEG[f][j][0], v, rb[f][j]), hi = Math.max(LIMITS_DEG[f][j][1], v, rb[f][j]);
        return clamp(catmull(p0[j], v, rb[f][j], p3[j], u), lo, hi);
      });
    }
    const pos = a.wrist.pos.map((v, k) => catmull((pa.wrist.pos)[k], v, b.wrist.pos[k], (pb.wrist.pos)[k], u));
    return { t, wrist: { pos, quat: qSlerp(a.wrist.quat, b.wrist.quat, u) }, rows };
  }
  mixRows(ra, rb, u, rows);
  return { t, wrist: { pos: a.wrist.pos.map((v, k) => v + (b.wrist.pos[k] - v) * u), quat: nlerp(a.wrist.quat, b.wrist.quat, u) }, rows };
}
/**
 * A plain clip from a grasp template: rows from { from, to }; with `grasp` ({ wrist, quat } in item space) the wrist
 * offsets are composed onto the grasp wrist and the clip is in item space, else they stay hand-relative offsets.
 * Other clips are returned as they are.
 */
export function resolveClip(clip, { from, to, grasp = null } = {}) {
  if (clip.space !== 'grasp') return clip;
  const frames = clip.frames.map(f => {
    const rows = toRows(mixRows(from, to, f.mix, {}));
    if (!grasp) return { t: f.t, wrist: { pos: [...f.wrist.pos], quat: [...f.wrist.quat] }, rows };
    const p = qRotate(grasp.quat, f.wrist.pos);
    return { t: f.t, wrist: { pos: grasp.wrist.map((v, k) => v + p[k]), quat: qNormalize(qMul(grasp.quat, f.wrist.quat)) }, rows };
  });
  const { mix, ...rest } = clip;
  return { ...rest, space: grasp ? 'item' : 'hand', frames };
}

const graspCache = new WeakMap(); // from rows -> WeakMap(to rows -> { rows obj }) for array inputs
let cacheEpoch = 0;
function invalidate() { cacheEpoch++; }
function rowPair(from, to) {
  if (!Array.isArray(from) || !Array.isArray(to)) return { from: toRows(from), to: toRows(to) };
  let byTo = graspCache.get(from);
  if (!byTo) graspCache.set(from, byTo = new WeakMap());
  let pair = byTo.get(to);
  if (!pair || pair.epoch !== cacheEpoch) byTo.set(to, pair = { from: toRows(from), to: toRows(to), epoch: cacheEpoch });
  return pair;
}
/**
 * Finger state of a grasp at progress t (0 = the open approach `open`, 1 = closed `angles`; rows as grasp data arrays or
 * objects), replacing the linear open -> closed lerp: 'low' = that linear lerp (identical to grasp fingerState),
 * 'mid'/'high' = the grab clip (approach pre-shape: the thumb opposes first, the fingers open a little wider, then
 * close in turn). t = 0 and t = 1 give exactly the open and closed rows; in between the clip's overshoot is clamped to
 * LIMITS widened to the two endpoints (a grasp exempt from the clamp, like the mug thumb, keeps its raw rows).
 */
export function grabFingerState({ open, angles }, t, { quality: q = quality, clip = 'grab', library = HAND_LIBRARY } = {}) {
  const k = clamp(Number.isFinite(t) ? t : 0, 0, 1), { from, to } = rowPair(open, angles);
  const c = q === 'low' ? null : handClip(clip, library);
  const rows = c ? sampleClip(c, k * clipDuration(c), { from, to, quality: q, loop: false }).rows : mixRows(from, to, k, {});
  if (c) clampBetween(rows, from, to);
  return stateFromRows(rows, { src: 'baked', curl: k });
}
/** Clamp rows into LIMITS widened to include the rows `from` and `to` (in place). */
function clampBetween(rows, from, to) {
  for (const f of FINGERS) {
    if (!rows[f]) continue;
    for (let j = 0; j < 4; j++) {
      const a = from[f][j], b = to[f][j];
      rows[f][j] = clamp(rows[f][j], Math.min(LIMITS_DEG[f][j][0], a, b), Math.max(LIMITS_DEG[f][j][1], a, b));
    }
  }
  return rows;
}
/**
 * Finger state of a held grasp while pouring, p = pour progress 0..1 (e.g. from the item's tilt): 'low' = the closed
 * rows unchanged; 'mid'/'high' = the pour clip (the grip tightens, little finger most). Same clamp as grabFingerState.
 */
export function pourFingerState({ open, angles }, p, { quality: q = quality, clip = 'pour', library = HAND_LIBRARY } = {}) {
  const k = clamp(Number.isFinite(p) ? p : 0, 0, 1), { from, to } = rowPair(open, angles);
  const c = q === 'low' ? null : handClip(clip, library);
  const rows = c ? clampBetween(sampleClip(c, k * clipDuration(c), { from, to, quality: q, loop: false }).rows, from, to) : toRows(to);
  return stateFromRows(rows, { src: 'baked', curl: 1 });
}

/**
 * Plays clips on one hand: play(id | clip, { loop, speed, from, to, onEnd }), stop(), update(dt) -> frame | null
 * (rows + hand-relative wrist), playing. Grasp templates need from/to.
 */
export function createHandAnimator({ library = HAND_LIBRARY } = {}) {
  let cur = null;
  return {
    get playing() { return cur ? cur.clip.id : null; },
    play(idOrClip, { loop, speed = 1, from = null, to = null, onEnd = null } = {}) {
      const clip = typeof idOrClip === 'string' ? handClip(idOrClip, library) : idOrClip;
      if (!clip) throw new RangeError(`no hand clip ${idOrClip}`);
      cur = { clip, time: 0, loop: loop ?? !!clip.loop, speed, from, to, onEnd };
      return clip.id;
    },
    stop() { cur = null; },
    update(dt) {
      if (!cur) return null;
      cur.time += Math.max(0, dt || 0) * cur.speed;
      const dur = clipDuration(cur.clip), frame = sampleClip(cur.clip, cur.time, { from: cur.from, to: cur.to, loop: cur.loop });
      if (!cur.loop && cur.time >= dur) { const end = cur.onEnd; cur = null; end?.(); }
      return frame;
    },
  };
}

// ---- controllers -----------------------------------------------------------------------------------------------------
const relaxedCache = new Map();
/** The relaxed hand at a tier: 'low' = the old relaxed curls, otherwise the library's relaxed pose (finger state). */
export function relaxedRows(library = HAND_LIBRARY) { return handPose(library.controller?.high?.idle ?? 'relaxed', library) ?? handPose('relaxed', library); }
/**
 * Controller fingers as data poses (rows, deg). input: { curls: { thumb..little 0..1 } (fingerInput's curls),
 * sensor: { finger: true } (digits read from a per-finger sensor), trigger, triggerTouched, grip, thumbTouched,
 * touchKnown }. 'mid': each digit along its curl from the library's controller.curl.from to .to rows (the data form of
 * fingerStateFromCurls). 'high': grip blends idle -> grip for middle/ring/little, the trigger idle -> grip for the index,
 * and with touch sensors an untouched trigger points and a lifted thumb on a held grip gives a thumbs up (eased by
 * controller.ease s when `state` (per hand, mutable) and dt are given). Sensor digits always follow their curl.
 */
export function controllerRows(input, { quality: q = quality, library = HAND_LIBRARY, state = null, dt = 0, out = {} } = {}) {
  const cfg = library.controller || LIBRARY.controller, curls = input.curls || {}, sensor = input.sensor || {};
  const from = handPose(cfg.curl.from, library), to = handPose(cfg.curl.to, library);
  for (const f of FINGERS) {
    const c = clamp(Number(curls[f.toLowerCase()]) || 0, 0, 1), o = out[f] || (out[f] = [0, 0, 0, 0]), a = from[f], b = to[f];
    for (let j = 0; j < 4; j++) o[j] = a[j] + (b[j] - a[j]) * c;
  }
  if (q !== 'high') return out;
  const H = cfg.high, idle = handPose(H.idle, library), grip = handPose(H.grip, library), point = handPose(H.point, library), up = handPose(H.thumbUp, library);
  const g = clamp(+input.grip || 0, 0, 1), tr = clamp(+input.trigger || 0, 0, 1);
  const target = { point: input.touchKnown && !input.triggerTouched ? 1 : 0, up: input.touchKnown && !input.thumbTouched ? smooth((g - 0.4) / 0.5) : 0 };
  let w = target;
  if (state) {
    state.w ??= { ...target };
    const k = dt > 0 ? 1 - Math.exp(-dt / (cfg.ease || 0.08)) : 1;
    state.w.point += (target.point - state.w.point) * k; state.w.up += (target.up - state.w.up) * k;
    w = state.w;
  }
  const set = (f, x, y, k) => { const o = out[f]; for (let j = 0; j < 4; j++) o[j] = x[f][j] + (y[f][j] - x[f][j]) * k; };
  for (const f of ['Middle', 'Ring', 'Little']) if (!sensor[f.toLowerCase()]) set(f, idle, grip, g);
  if (!sensor.index) {
    set('Index', idle, grip, tr);
    if (w.point > 0) { const o = out.Index; for (let j = 0; j < 4; j++) o[j] += (point.Index[j] - o[j]) * w.point; }
  }
  if (!sensor.thumb) {
    // thumb on the controller face (curl 0.55 / 0.85 from fingerInput) toward the fist thumb; idle otherwise
    set('Thumb', idle, grip, clamp(((Number(curls.thumb) || 0) - 0.1) / 0.9, 0, 1));
    if (w.up > 0) { const o = out.Thumb; for (let j = 0; j < 4; j++) o[j] += (up.Thumb[j] - o[j]) * w.up; }
  }
  return out;
}

// ---- recording pipeline ----------------------------------------------------------------------------------------------
export const RECORD_DEFAULTS = Object.freeze({
  filter: Object.freeze({ minCutoff: 1.5, beta: 0.3, dCutoff: 1 }), // rows (deg); the wrist uses filters.js createPoseFilter
  toleranceDeg: 2,   // keyframe reduction: max row / wrist-angle error of the dropped frames
  toleranceMm: 3,    // max wrist position error of the dropped frames
});
/** Indices of the frames kept by Ramer-Douglas-Peucker in time (linear interpolation error, normalised by the tolerances). */
export function reduceKeyframes(frames, { toleranceDeg = RECORD_DEFAULTS.toleranceDeg, toleranceMm = RECORD_DEFAULTS.toleranceMm } = {}) {
  const n = frames.length;
  if (n <= 2) return [...Array(n).keys()];
  const keep = new Set([0, n - 1]);
  const err = (a, b, k) => {
    const A = frames[a], B = frames[b], K = frames[k], u = (K.t - A.t) / ((B.t - A.t) || 1);
    let e = 0;
    for (const f of FINGERS) for (let j = 0; j < 4; j++) e = Math.max(e, Math.abs(A.rows[f][j] + (B.rows[f][j] - A.rows[f][j]) * u - K.rows[f][j]) / toleranceDeg);
    for (let j = 0; j < 3; j++) e = Math.max(e, Math.abs(A.wrist.pos[j] + (B.wrist.pos[j] - A.wrist.pos[j]) * u - K.wrist.pos[j]) * 1000 / toleranceMm);
    return Math.max(e, qAngle(nlerp(A.wrist.quat, B.wrist.quat, u), K.wrist.quat) * R2D / toleranceDeg);
  };
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1, at = -1;
    for (let k = a + 1; k < b; k++) { const e = err(a, b, k); if (e > worst) { worst = e; at = k; } }
    if (worst > 1) { keep.add(at); stack.push([a, at], [at, b]); }
  }
  return [...keep].sort((x, y) => x - y);
}
/**
 * Raw samples [{ t, wrist: { pos, quat }, rows }] (one hand, any t origin) -> { clip, report }: One Euro filter per row
 * channel (+ the pose filter on the wrist), keyframe reduction, then the validator per keyframe: validateRows (grasp's,
 * optional) reports hard/warn issues, clampRows (grasp's; default limitRows) clamps. The clip starts at t = 0.
 */
export function processRecording(samples, {
  id = 'recording', kind = 'animation', space = 'hand', side = 'right', loop = false, filter = RECORD_DEFAULTS.filter,
  toleranceDeg = RECORD_DEFAULTS.toleranceDeg, toleranceMm = RECORD_DEFAULTS.toleranceMm, clampRows = null, validateRows = null, meta = {},
} = {}) {
  const list = samples.filter(s => s && Number.isFinite(s.t) && isRows(toRows(s.rows)) && isVec(s.wrist?.pos, 3) && isVec(s.wrist?.quat, 4));
  if (!list.length) throw new Error('processRecording: no valid samples');
  const t0 = list[0].t, filters = {}, pose = createPoseFilter(), tmp = { pos: [0, 0, 0], quat: [0, 0, 0, 1] };
  let prev = t0;
  const filtered = list.map(s => {
    const dt = s.t - prev; prev = s.t;
    const rows = toRows(s.rows), out = {};
    for (const f of FINGERS) out[f] = rows[f].map((v, j) => oneEuro(filters[f + j] ??= createOneEuro(filter), v, dt));
    filterPose(pose, s.wrist.pos, s.wrist.quat, dt, tmp);
    return { t: +(s.t - t0).toFixed(4), wrist: { pos: [...tmp.pos], quat: [...tmp.quat] }, rows: out };
  });
  const kept = kind === 'pose' ? [filtered.length - 1] : reduceKeyframes(filtered, { toleranceDeg, toleranceMm });
  let hard = 0, warn = 0, clampedFrames = 0;
  const frames = kept.map(k => {
    const f = filtered[k], v = validateRows?.(f.rows);
    if (v) { hard += v.hard.length; warn += v.warn.length; }
    const c = clampRows ? clampRows(f.rows) : limitRows(f.rows).rows;
    if (FINGERS.some(g => c[g].some((x, j) => Math.abs(x - f.rows[g][j]) > 1e-9))) clampedFrames++;
    const round = a => a.map(x => +x.toFixed(2));
    return { t: kind === 'pose' ? 0 : f.t, wrist: { pos: f.wrist.pos.map(x => +x.toFixed(5)), quat: f.wrist.quat.map(x => +x.toFixed(6)) },
      rows: Object.fromEntries(FINGERS.map(g => [g, round(c[g])])) };
  });
  const clip = { id, kind, space, side, ...(kind === 'animation' ? { duration: frames.at(-1).t, loop } : {}), frames };
  const report = { samples: samples.length, used: list.length, keyframes: frames.length, duration: filtered.at(-1).t, clampedFrames, hard, warn, toleranceDeg, toleranceMm };
  clip.recorded = { ...meta, keyframes: frames.length, samples: list.length, clampedFrames, hard, warn };
  return { clip, report };
}

/**
 * The same clip for the other hand. Rows are hand-independent. space 'hand'/'grasp': mirror across the hand's X
 * (x -> -x, quat (x, -y, -z, w)); 'item': across the item's XY plane like grasp record.js mirrorPose (z -> -z, quat
 * (-x, -y, z, w) turned 180 deg about the hand's Y). id gets the other side's suffix when it has one.
 */
export function mirrorClip(clip) {
  const side = clip.side === 'left' ? 'right' : clip.side === 'right' ? 'left' : clip.side;
  const m = clip.space === 'item'
    ? w => ({ pos: [w.pos[0], w.pos[1], -w.pos[2]], quat: qNormalize(qMul([-w.quat[0], -w.quat[1], w.quat[2], w.quat[3]], [0, 1, 0, 0])) })
    : w => ({ pos: [-w.pos[0], w.pos[1], w.pos[2]], quat: [w.quat[0], -w.quat[1], -w.quat[2], w.quat[3]] });
  const id = clip.side && clip.id.endsWith(`-${clip.side}`) ? `${clip.id.slice(0, -clip.side.length)}${side}` : clip.id;
  return { ...clip, id, side, mirroredFrom: clip.id, frames: clip.frames.map(f => ({ ...f, wrist: m(f.wrist) })) };
}
