// Anatomical + contact plausibility checks for a hand grasp (pure, no three.js).
//
// A baked or generated grasp is a set of finger rows [dyaw, pitch, bend1, bend2] (degrees, plugin finger state) plus a
// wrist pose. The character plugin applies those rows to the skeleton WITHOUT clamping them (only tracked fingers pass
// through limitFingerState), so nothing stops a grasp from folding a joint past what a hand can do. This module is the
// missing check, used three ways:
//   1. offline by tools/fit_baked_thumbs.mjs / tools/apply_grasp_fit.mjs as the acceptance gate for refitted grasps,
//   2. in the games' tests against every shipped grasp,
//   3. at runtime: baked_grasps.js fingerState() puts every row through clampRows (memoised per pose) unless the grasp
//      quality is 'raw', and closure.js clamps the rows it closes to contact, so a data error can never show a broken hand.
//
// Rows per digit: Thumb: dyaw = CMC abduction/adduction (+ toward the radial side), pitch = CMC flexion,
// bend1 = MCP flexion, bend2 = IP flexion, optional 5th value twist = axial twist of the thumb (CMC pronation, turns the
// MCP/IP hinge about the metacarpal; recorded from tracked hands, closure.js fingerChain). Index..Little: dyaw = spread,
// pitch = MCP flexion, bend1 = PIP, bend2 = DIP.
// The hard ranges are the plugin's own LIMITS (src/ik/fingers.js, "common anatomical ranges"); COMFORT is the band a
// relaxed grip stays in, tighter and used for scoring, never for rejecting.

import VALIDATOR_DATA from './data/validator.data.json' with { type: 'json' };

export const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
export const HARD = VALIDATOR_DATA.HARD;
// Relaxed power-grasp centre per digit and the half width (deg) over which the comfort cost reaches 1.
export const COMFORT = VALIDATOR_DATA.COMFORT;
const KEYS = ['dyaw', 'pitch', 'bend1', 'bend2'];
export const HYPEREXTENSION_WARN_DEG = -12; // thumb IP past this reads as a bent-back stub
export const DIP_PER_PIP = { min: 0.35, max: 1.0, slack: 8 }; // bend2 vs bend1 once the finger is actually flexed
export const MAX_NEIGHBOUR_PITCH_DEG = 40; // adjacent fingers curl by similar amounts in a wrap
export const WRIST_SOFT_DEG = 35; // forearm axis vs hand axis: ordinary wrap
export const WRIST_HARD_DEG = 60;
export const MAX_CONTACT_GAP_DEG = 200; // largest empty arc around the item axis between contacts (force closure with friction)

/** Row length allowed for a digit: 4, or 5 for the thumb (its twist). */
export const rowLengthOk = (f, n) => n === 4 || (n === 5 && f === 'Thumb');
const row = (rows, f) => Array.isArray(rows?.[f]) && rowLengthOk(f, rows[f].length) && rows[f].every(Number.isFinite) ? rows[f] : null;

/** Convert a plugin finger state (radians, record.fingers[side]) back to rows in degrees. */
export function rowsFromState(state) {
  const D = 180 / Math.PI, out = {};
  for (const f of FINGERS) {
    const s = state?.[f];
    if (s) out[f] = [(s.dyaw ?? 0) * D, s.pitch * D, s.bend1 * D, s.bend2 * D];
    if (s && f === 'Thumb' && Number.isFinite(s.twist)) out[f].push(s.twist * D);
  }
  return out;
}

/**
 * Check rows against joint ranges and finger coupling. Returns { ok, hard: [..], warn: [..], cost }.
 * hard: a joint outside the plugin range, or a non-finite row. warn: anatomically odd but representable.
 * cost: 0 = the relaxed centre, ~1 per digit at the comfort width (sum over digits, for search).
 */
export function validateRows(rows) {
  const hard = [], warn = [];
  let cost = 0;
  for (const f of FINGERS) {
    const r = row(rows, f);
    if (!r) { hard.push({ finger: f, rule: 'missing' }); continue; }
    KEYS.forEach((k, i) => {
      const [lo, hi] = HARD[f][k];
      if (r[i] < lo - 0.01 || r[i] > hi + 0.01) hard.push({ finger: f, joint: k, value: r[i], range: [lo, hi], rule: 'range' });
      const c = COMFORT[f];
      cost += ((r[i] - c.centre[i]) / c.width[i]) ** 2;
    });
    if (r.length > 4) {   // thumb twist: range only (no comfort cost: the twist follows the CMC, it is not a free choice)
      const [lo, hi] = HARD.Thumb.twist;
      if (r[4] < lo - 0.01 || r[4] > hi + 0.01) hard.push({ finger: f, joint: 'twist', value: r[4], range: [lo, hi], rule: 'range' });
    }
    if (f === 'Thumb') {
      if (r[3] < HYPEREXTENSION_WARN_DEG) warn.push({ finger: f, joint: 'bend2', value: r[3], rule: 'thumb-ip-hyperextended' });
    } else if (r[2] > 20) {
      const ratio = r[3] / r[2];
      if (r[3] < DIP_PER_PIP.min * r[2] - DIP_PER_PIP.slack || r[3] > DIP_PER_PIP.max * r[2] + DIP_PER_PIP.slack) warn.push({ finger: f, joint: 'bend2', value: r[3], ratio, rule: 'dip-pip-coupling' });
    }
  }
  const four = FINGERS.slice(1).map(f => row(rows, f)).filter(Boolean);
  for (let i = 1; i < four.length; i++) {
    if (Math.abs(four[i][1] - four[i - 1][1]) > MAX_NEIGHBOUR_PITCH_DEG) warn.push({ finger: FINGERS[i + 1], rule: 'neighbour-pitch', delta: four[i][1] - four[i - 1][1] });
  }
  return { ok: hard.length === 0, hard, warn, cost };
}

/** Clamp rows into the hard ranges (returns a new object; non-finite entries fall back to the comfort centre). A thumb
 * twist (5th value) is kept, clamped (non-finite: 0). */
export function clampRows(rows) {
  const out = {};
  for (const f of FINGERS) {
    const r = rows?.[f] || [];
    out[f] = KEYS.map((k, i) => { const v = Number.isFinite(r[i]) ? r[i] : COMFORT[f].centre[i], [lo, hi] = HARD[f][k]; return Math.max(lo, Math.min(hi, v)); });
    if (f === 'Thumb' && r.length > 4) { const [lo, hi] = HARD.Thumb.twist; out[f].push(Number.isFinite(r[4]) ? Math.max(lo, Math.min(hi, r[4])) : 0); }
  }
  return out;
}

/** Comfort cost of a single digit row (for hill climbing). */
export function digitCost(finger, r) {
  const c = COMFORT[finger]; let s = 0;
  for (let i = 0; i < 4; i++) {
    const [lo, hi] = HARD[finger][KEYS[i]];
    s += ((r[i] - c.centre[i]) / c.width[i]) ** 2;
    if (r[i] < lo || r[i] > hi) s += 100 + Math.abs(r[i] < lo ? lo - r[i] : r[i] - hi);
  }
  return s;
}

/** Angle between the forearm axis (elbow -> wrist) and the hand axis (wrist -> middle knuckle), degrees; or null. */
export function wristDeviationDeg(elbow, wrist, middleKnuckle) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const f = sub(wrist, elbow), h = sub(middleKnuckle, wrist), lf = Math.hypot(...f), lh = Math.hypot(...h);
  if (!(lf > 1e-6 && lh > 1e-6)) return null;
  const c = (f[0] * h[0] + f[1] * h[1] + f[2] * h[2]) / (lf * lh);
  return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
}

/**
 * Largest empty arc (deg) between contact directions around the item axis. A hand that encloses an object has
 * contacts spread all around it; with a friction cone of about 27 deg per contact, a gap under ~200 deg still closes.
 * angles: radians of contact points around the axis (any fixed basis).
 */
export function maxContactGapDeg(angles) {
  const a = angles.filter(Number.isFinite).map(v => ((v % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).sort((x, y) => x - y);
  if (a.length < 2) return 360;
  let gap = a[0] + 2 * Math.PI - a.at(-1);
  for (let i = 1; i < a.length; i++) gap = Math.max(gap, a[i] - a[i - 1]);
  return gap * 180 / Math.PI;
}

export const GATES = VALIDATOR_DATA.GATES;

/**
 * One verdict from skin metrics (hand_contact.contactMetrics + lab extras) and rows.
 * m: { penetrationMm, palmGapMm, tipGapMm, fingersTouching, thumbTouching, thumbOppositionDeg, deviationDeg?, contactGapDeg? }
 * Returns { ok, failures: [string], warnings: [string], rows: validateRows(rows) }.
 */
export function verdict(m, rows, { wrap = true, gates = GATES } = {}) {
  const failures = [], warnings = [], r = validateRows(rows);
  for (const h of r.hard) failures.push(`joint ${h.finger}.${h.joint ?? h.rule} ${h.value?.toFixed?.(1) ?? ''} outside ${h.range ?? ''}`.trim());
  for (const w of r.warn) warnings.push(`${w.finger} ${w.rule}`);
  if (m.wristErrorMm != null && m.wristErrorMm > gates.wristErrorMm) failures.push(`arm misses the wrist by ${Math.round(m.wristErrorMm)} mm`);
  if (m.penetrationMm > gates.penetrationMm) failures.push(`skin ${m.penetrationMm} mm inside (${m.worstGroup || '?'})`);
  if (m.palmGapMm != null && (m.palmGapMm > gates.palmGapMaxMm || m.palmGapMm < gates.palmGapMinMm)) failures.push(`palm gap ${m.palmGapMm} mm`);
  if (wrap) {
    if (m.fingersTouching < gates.minFingersTouching) failures.push(`only ${m.fingersTouching} fingertips touch`);
    if (!m.thumbTouching) failures.push('thumb does not touch');
    if (m.thumbOppositionDeg < gates.minOppositionDeg) failures.push(`thumb opposition ${m.thumbOppositionDeg} deg`);
    if (m.contactGapDeg != null && m.contactGapDeg > MAX_CONTACT_GAP_DEG) failures.push(`contacts leave a ${Math.round(m.contactGapDeg)} deg gap (no closure)`);
  }
  if (m.deviationDeg != null) {
    if (m.deviationDeg > WRIST_HARD_DEG) failures.push(`wrist bent ${Math.round(m.deviationDeg)} deg`);
    else if (m.deviationDeg > WRIST_SOFT_DEG) warnings.push(`wrist bent ${Math.round(m.deviationDeg)} deg`);
  }
  return { ok: failures.length === 0, failures, warnings, rows: r };
}
