// Runtime baked-grasp library (port of the Godot baked_grasp_library.gd): nearest offline-baked pose with
// hysteresis, no solver at runtime. Poses were converted by the Contracts tools/convert_baked_grasps.mjs into plugin
// conventions (wrist + hand-frame quaternion in item space, finger angles as Godot finger_poses degrees) and refitted by
// tools/fit_baked_thumbs.mjs + tools/apply_grasp_fit.mjs. Part of GameSystems/extensions/grasp (source of truth); games
// get synced copies.
//
// Quality (GRASP_QUALITY, setGraspQuality), cheapest first:
//   'raw'  baked angles unchanged (lab and diagnostics only),
//   'low'  baked angles through the validator's joint ranges (clampRows), memoised per pose: costs nothing per frame,
//   'mid'  (default) close-to-contact once per grab on the character's own hand (graspPose + closure.js), memoised per
//          pose and hand; without a hand (or for a kind without a catalogue shape) it is 'low',
//   'high' 'mid' plus a contact re-check whenever the hand moves relative to the item (graspPose with `local`).
// 'clamped' is the step-2 name of 'low' and still accepted. Kinds in CLAMP_EXEMPT are raw at 'low' until refitted.
//
// Recorded grasps (Grasp Studio, extensions plan step 4) live in recorded_grasps.json beside the bake, written by the
// studio's dev-server endpoint; record.js mergePoses() appends them to the library (posesFor, nearestPose, poseById,
// defaultPose), and one marked default replaces the baked default of its kind/side/grasp. BAKED stays the bake alone.
import DATA from './baked_grasps.data.json' with { type: 'json' };
import RECORDED_DATA from './recorded_grasps.json' with { type: 'json' };
import { qmul, qconj, rotate, add, sub, length } from './math.js';
import { clampRows } from './grasp_validator.js';
import { CATALOG } from './catalog.js';
import { closeToContact } from './closure.js';
import { mergePoses, recordedPoses } from './record.js';

export const ANGLE_WEIGHT = 0.05; // metres of cost per radian of wrist rotation
export const HYSTERESIS = 0.01; // the current pose keeps winning until another is 1 cm "closer"
const D = Math.PI / 180;
export const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];

export const BAKED = DATA;
/** The recorded poses in the library (valid entries of recorded_grasps.json). */
export const RECORDED = Object.freeze(recordedPoses(RECORDED_DATA));
/** Every pose of the library: the bake plus the recorded poses (record.js mergePoses). */
export const POSES = mergePoses(DATA.poses, RECORDED);
const byKindSide = new Map();
for (const pose of POSES) {
  const key = `${pose.kind}/${pose.side}`;
  if (!byKindSide.has(key)) byKindSide.set(key, []);
  byKindSide.get(key).push(pose);
}
export function posesFor(kind, side) { return byKindSide.get(`${kind}/${side}`) || []; }
export function hasPoses(kind) { return byKindSide.has(`${kind}/left`) || byKindSide.has(`${kind}/right`); }
export function defaultPose(kind, side, grasp) {
  const list = posesFor(kind, side).filter(p => !grasp || p.grasp === grasp);
  return list.find(p => p.default) || list[0] || null;
}
export function poseById(id) { return POSES.find(p => p.id === id) || null; }

export function quatAngle(a, b) {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, d));
}

/**
 * Nearest pose to an item-local hand (wrist position + hand-frame quat).
 * cost = |wrist delta| + ANGLE_WEIGHT * angle; the previous pose id gets a HYSTERESIS bonus.
 * Returns { pose, cost, distance, angle } or null.
 */
export function nearestPose(kind, side, local, { previousId = null, grasp = null, filter = null } = {}) {
  let best = null;
  for (const pose of posesFor(kind, side)) {
    if (grasp && pose.grasp !== grasp) continue;
    if (filter && !filter(pose)) continue;
    const distance = length(sub(pose.wrist, local.pos)), angle = quatAngle(pose.quat, local.quat);
    const cost = distance + ANGLE_WEIGHT * angle - (pose.id === previousId ? HYSTERESIS : 0);
    if (!best || cost < best.cost) best = { pose, cost, distance, angle };
  }
  return best;
}

/** World pose -> item-local pose. */
export function toItemLocal(item, worldPose) {
  const inv = qconj(item.quat);
  return { pos: rotate(inv, sub(worldPose.pos, item.pos)), quat: qmul(inv, worldPose.quat) };
}
/** Item-local baked wrist -> world wrist pose. */
export function toWorld(item, pose) {
  return { pos: add(item.pos, rotate(item.quat, pose.wrist)), quat: qmul(item.quat, pose.quat) };
}

export const GRASP_QUALITY = Object.freeze(['raw', 'low', 'mid', 'high']);
const ALIASES = { clamped: 'low' };
let quality = 'mid';
/** 'raw' | 'low' | 'mid' (default) | 'high' ('clamped' = 'low'); returns the active level. */
export function setGraspQuality(level) {
  const q = ALIASES[level] ?? level;
  if (!GRASP_QUALITY.includes(q)) throw new RangeError(`grasp quality ${level}? ${GRASP_QUALITY}`);
  return (quality = q);
}
export const graspQuality = () => quality;

// Kinds whose bake needs out-of-range rows to hold the item: their rows stay raw at 'low', and at 'mid'/'high' their
// thumb (EXEMPT_KEEP, the out-of-range finger of the mug bake: CMC pitch 100 > 65) keeps its raw row while the other
// fingers close to contact. The grasp lab (step 3) found no in-range mug thumb that holds the cup on the CC skin, so
// close-to-contact replaced the old per-kind SKIN_MARGIN but not this exemption (grab_findings 1.4, 3.1). The margin's mug
// thumb part (+10 deg bend1) was folded into the mug poses of baked_grasps.data.json, as a refit would.
export const CLAMP_EXEMPT = Object.freeze(['mug']);
const EXEMPT_KEEP = ['Thumb'];

// Clamped open/closed rows per pose object (the joint ranges are a box, so a lerp between two clamped ends stays inside).
const clampedRows = new WeakMap();
const clampList = list => { const r = clampRows(Object.fromEntries(FINGERS.map((f, i) => [f, list[i]]))); return FINGERS.map(f => r[f]); };
/** The rows fingerState() uses for a pose: { open, angles } (5 x [dyaw, pitch, bend1, bend2] deg) at the active quality. */
export function runtimeRows(pose) {
  if (quality === 'raw' || CLAMP_EXEMPT.includes(pose.kind)) return pose;
  let rows = clampedRows.get(pose);
  if (!rows) clampedRows.set(pose, rows = { open: clampList(pose.open), angles: clampList(pose.angles) });
  return rows;
}

/**
 * Plugin finger state (record.fingers[side]) blended from the pose's open approach (t=0) to its closed angles (t=1),
 * inside the joint ranges unless the quality is 'raw' or the kind is CLAMP_EXEMPT. Pass graspPose(pose, hand) to get
 * the fingers closed to contact on the character's hand ('mid'/'high').
 */
export function fingerState(pose, t = 1) {
  const k = Math.max(0, Math.min(1, t)), out = {}, rows = runtimeRows(pose);
  FINGERS.forEach((finger, i) => {
    const a = rows.open[i], b = rows.angles[i], m = j => (a[j] + (b[j] - a[j]) * k) * D;
    out[finger] = { yaw: null, dyaw: m(0), pitch: m(1), bend1: m(2), bend2: m(3), curl: k, src: 'baked' };
  });
  return out;
}

const fitted = new WeakMap(); // hand -> WeakMap(pose -> Map(shape -> pose closed to contact))
const tracked = new WeakMap(); // hand -> { pose, shape, local, out }: the last 'high' re-check
const near = (a, b) => length(sub(a.pos, b.pos)) < 5e-4 && quatAngle(a.quat, b.quat) < 0.5 * Math.PI / 180;
/**
 * The pose to show on a character's hand at the active quality. 'raw'/'low', no hand, or no shape: the pose itself.
 * 'mid': a copy (same id) whose wrist is placed for this hand's length and whose closed angles are closed to contact
 * with the item (closure.js), memoised per pose, hand and shape, so a grab costs one closure (~0.1-0.3 ms in node) and every later
 * frame nothing. 'high' with `local` (the shown wrist in item space, { pos, quat }): the fingers are re-closed against
 * that wrist whenever it moved more than 0.5 mm / 0.5 deg since the last check.
 * hand: closure.handGeometry() of the character's hand; shape: the item's catalogue shape unless given (scaled props).
 */
export function graspPose(pose, hand, { shape = null, local = null } = {}) {
  if (!pose || !hand || quality === 'raw' || quality === 'low') return pose;
  const s = shape || CATALOG[pose.kind]?.shape;
  if (!s) return pose;
  let byPose = fitted.get(hand);
  if (!byPose) fitted.set(hand, byPose = new WeakMap());
  let byShape = byPose.get(pose);
  if (!byShape) byPose.set(pose, byShape = new Map());
  let out = byShape.get(s);
  if (!out) {
    const r = closeToContact(pose, hand, s, { rows: runtimeRows(pose), keep: CLAMP_EXEMPT.includes(pose.kind) ? EXEMPT_KEEP : [] });
    byShape.set(s, out = { ...pose, wrist: r.wrist, quat: r.quat, open: r.open, angles: r.angles, contact: r.fingers, source: pose });
  }
  if (quality !== 'high' || !local) return out;
  const last = tracked.get(hand);
  if (last && last.pose === pose && last.shape === s && near(last.local, local)) return last.out;
  const r = closeToContact(pose, hand, s, { rows: runtimeRows(pose), wrist: local.pos, quat: local.quat, keep: CLAMP_EXEMPT.includes(pose.kind) ? EXEMPT_KEEP : [] });
  const next = { ...out, open: r.open, angles: r.angles, contact: r.fingers };
  tracked.set(hand, { pose, shape: s, local: { pos: [...local.pos], quat: [...local.quat] }, out: next });
  return next;
}
/** Plugin finger state of the pose's open approach only (fingers open until the wrist has arrived). */
export const openFingerState = pose => fingerState(pose, 0);
