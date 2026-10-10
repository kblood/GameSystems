// Hand-contact measurement against held geometry (port of the Godot rendered-skin acceptance in
// test_review_baked_grasps.gd): every skinned hand vertex within 4 mm penetration, palm within 5 mm, and for a wrap
// the thumb opposing the index/middle contacts by >= 120 deg around the item's core axis.
// Pure: points arrive in the held object's local frame, grouped by the skin bone that dominates them. Used by the grasp
// lab (tools/lab) and the games' hand-contact smoke tests; game-specific geometry (weapons) stays in the game.
import { signedDistance, CATALOG } from './catalog.js';

export const MAX_PENETRATION_MM = 4.0;
export const MAX_PALM_GAP_MM = 5.0;
export const MIN_OPPOSITION_DEG = 120.0;
export const TOUCH_MM = 4.0; // a digit "touches" when a distal-pad vertex lies within this of the surface

/** Distance function and core axis for a catalogue kind (item-local, +Y up). */
export function kindGeometry(kind) {
  const shape = CATALOG[kind].shape;
  return { distance: p => signedDistance(shape, p), axis: { origin: [0, 0, 0], dir: [0, 1, 0] } };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Angle (rad) of a point around an axis, in a fixed basis perpendicular to it. */
function aroundAxis(axis, p) {
  const d = norm(axis.dir), ref = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  const e1 = norm(cross(d, ref)), e2 = cross(d, e1), r = sub(p, axis.origin);
  return Math.atan2(dot(r, e2), dot(r, e1));
}
const separation = (a, b) => { let x = Math.abs(a - b) % (2 * Math.PI); return x > Math.PI ? 2 * Math.PI - x : x; };

/**
 * points: [{ p:[x,y,z] (object-local, m), group: 'Hand' | '<Finger><Segment>' e.g. 'IndexDistal', 'ThumbDistal' }]
 * Returns millimetre metrics: penetration (max over every vertex), worst group, palm gap, per-digit distal-pad gap,
 * fingers touching (index..little), thumb touching, and thumb opposition (deg) of the thumb contact centroid against
 * the index/middle contact centroid around the core axis.
 */
export function contactMetrics(points, distance, axis, { touchMm = TOUCH_MM } = {}) {
  let penetration = 0, worst = '', palmGap = Infinity;
  const tips = { Thumb: Infinity, Index: Infinity, Middle: Infinity, Ring: Infinity, Little: Infinity };
  const touching = { Thumb: [], Index: [], Middle: [], Ring: [], Little: [] };
  for (const { p, group } of points) {
    const d = distance(p) * 1000;
    if (-d > penetration) { penetration = -d; worst = group; }
    if (group === 'Hand') palmGap = Math.min(palmGap, d);
    const finger = Object.keys(tips).find(f => group.startsWith(f));
    if (finger && group.endsWith('Distal')) {
      tips[finger] = Math.min(tips[finger], d);
      if (Math.abs(d) <= touchMm) touching[finger].push(p);
    }
  }
  const centroid = list => list.length ? list.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map(v => v / list.length) : null;
  const thumb = centroid(touching.Thumb), refs = centroid([...touching.Index, ...touching.Middle]);
  const opposition = thumb && refs ? separation(aroundAxis(axis, thumb), aroundAxis(axis, refs)) * 180 / Math.PI : 0;
  const round = v => Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  return {
    penetrationMm: round(penetration), worstGroup: worst, palmGapMm: round(palmGap),
    tipGapMm: Object.fromEntries(Object.entries(tips).map(([k, v]) => [k, round(v)])),
    fingersTouching: ['Index', 'Middle', 'Ring', 'Little'].filter(f => touching[f].length).length,
    thumbTouching: touching.Thumb.length > 0, thumbOppositionDeg: Math.round(opposition * 10) / 10, vertices: points.length,
  };
}
