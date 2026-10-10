#!/usr/bin/env node
// Builds extensions/avatar/hand_poses.json, the avatar's hand pose + hand animation library (extensions plan step 7), in
// the one hand-animation format of handposes.js: clips of frames { t, wrist: { pos, quat }, rows: { Thumb..Little:
// [dyaw, pitch, bend1, bend2] } } (degrees; dyaw relative to the rest spread of the hand the rows are applied to,
// pitch/bend absolute in the hand frame; wrist in the clip's space).
//
// Sources of the poses:
//   - Godot Contracts (NightfallContractsGodot, MIT, Copyright (c) 2026 Kasper Olesen), addons/nightfall_characters/
//     finger_poses.gd `POSES` at interaction-fix 1b9429e: relaxed, pistol, trigger, support, magazine, insert, slide,
//     object_wrap, object_neck, object_handle, object_pinch, open. Same row convention (the Godot solver is a port of
//     this extension's fingers.js/rigdata.js): yaw is added to the measured rest yaw of the finger (= our dyaw), MCP/
//     PIP/DIP absolute in the hand frame (F wrist -> middle knuckle, D dorsal, R radial), thumb frame tilted 60 deg
//     (d = D cos60 + R sin60). So the conversion is the identity; only the joint limits differ (Godot DIGIT/THUMB_MIN/MAX
//     vs this extension's LIMITS = grasp HARD), and every row is clamped to LIMITS here. The rows are copied below (the
//     Godot repo is only read, never written).
//   - This extension's own controller curves (fingers.js fingerStateFromCurls at curl 0 / 1, CharacterCreatorXR, MIT):
//     flat, fist.
//   - Authored here: point (fist + Godot's pistol index), thumbs_up and pinch, searched on the GameSystems reference hand
//     (grasp reference_hand.json) inside LIMITS: thumbs_up = fist with the thumb pointing radially out, pinch = thumb and
//     index pads meeting (tips ~1.2 cm apart, the pads' thickness).
// Animations: grab (open -> approach -> closed, item/grasp-relative), release, pour (grasp-relative) and two hand-
// relative gestures (wave, beckon). Grasp-relative frames carry `mix` (0 = the grasp's `from` rows, 1 = its `to` rows)
// instead of `rows` and their wrist is an offset in the hand frame from the grasp's wrist; handposes.resolveClip turns
// them into plain frames for a concrete grasp.
//
//   node extensions/avatar/tools/make_hand_poses.mjs [--check]     (--check: exit 1 when the JSON is out of date)
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LIMITS } from '../fingers.js';
import { referenceHand, fingerChain } from '../../grasp/index.js';

const OUT = fileURLToPath(new URL('../hand_poses.json', import.meta.url));
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const KEYS = ['yaw', 'pitch', 'bend1', 'bend2']; // LIMITS names; row[0] is dyaw (relative yaw)
const R2D = 180 / Math.PI;
const HARD = Object.fromEntries(FINGERS.map(f => [f, KEYS.map(k => LIMITS[f][k].map(v => Math.round(v * R2D * 1e6) / 1e6))]));

// finger_poses.gd POSES (Godot Contracts, MIT), rows thumb..little.
const GODOT = {
  relaxed: [[0, 0, 12, 8], [0, 12, 18, 10], [0, 17, 24, 14], [0, 21, 29, 17], [0, 25, 34, 20]],
  pistol: [[-12, -20, 55, 0], [0, 2, 5, 3], [0, 35, 65, 50], [0, 42, 67, 50], [0, 48, 72, 54]],
  trigger: [[-12, -20, 55, 0], [-20, 35, 50, 30], [0, 35, 65, 50], [0, 42, 67, 50], [0, 48, 72, 54]],
  support: [[-18, -18, 38, 8], [-3, 48, 65, 40], [0, 53, 72, 43], [0, 60, 80, 48], [0, 66, 86, 52]],
  magazine: [[-40, -5, 65, -25], [-3, 48, 65, 38], [0, 52, 73, 44], [0, 57, 79, 48], [0, 63, 85, 52]],
  insert: [[-40, -5, 65, -25], [-3, 42, 61, 35], [0, 50, 70, 41], [0, 57, 79, 48], [0, 63, 85, 52]],
  slide: [[-25, 12, 45, 28], [-5, 46, 75, 45], [0, 49, 80, 49], [4, 32, 50, 32], [8, 24, 35, 24]],
  object_wrap: [[-18, -8, 48, 20], [0, 49, 72, 43], [0, 55, 80, 48], [0, 61, 86, 53], [0, 67, 92, 57]],
  object_neck: [[-24, 6, 58, 32], [-5, 66, 94, 62], [0, 70, 99, 64], [2, 62, 86, 55], [5, 58, 80, 52]],
  object_handle: [[-12, -14, 35, 16], [0, 65, 94, 55], [0, 71, 100, 60], [0, 76, 102, 64], [0, 80, 106, 68]],
  object_pinch: [[-30, 20, 52, 40], [-8, 42, 80, 51], [0, 22, 34, 20], [4, 26, 38, 24], [8, 30, 44, 28]],
  open: [[-40, -35, 0, -20], [0, -5, 0, 0], [0, -5, 0, 0], [0, -5, 0, 0], [0, -5, 0, 0]],
};
const GODOT_NOTES = {
  relaxed: 'Godot relaxed', pistol: 'Godot pistol (index straight beside the trigger guard)', trigger: 'Godot trigger (index on the trigger)',
  support: 'Godot support hand on the pistol', magazine: 'Godot magazine grip', insert: 'Godot magazine insert', slide: 'Godot slide pinch',
  object_wrap: 'Godot object wrap', object_neck: 'Godot bottle-neck grip', object_handle: 'Godot handle grip', object_pinch: 'Godot object pinch',
  open: 'Godot open (provisional approach hand: digits straight, thumb out of the palm)',
};
// fingers.js fingerStateFromCurls at curl 0 (flat) and 1 (fist), in degrees: OPEN/FIST, THUMB_OPEN/THUMB_DOWN, index x0.97 and
// little x1.06 on the MCP flexion.
const fistRow = k => [0, +(4 + 78 * k).toFixed(2), 100, 65];
const CURVES = {
  flat: [[0, 0, 0, 5], [0, 4, 6, 4], [0, 4, 6, 4], [0, 4, 6, 4], [0, 4, 6, 4]],
  fist: [[-10, -15, 75, 0], fistRow(0.97), fistRow(1), fistRow(1), fistRow(1.06)],
};

const clampRow = (f, r) => r.map((v, j) => Math.max(HARD[f][j][0], Math.min(HARD[f][j][1], v)));
function clamped(name, rows) {
  const hits = [];
  const out = rows.map((r, i) => {
    const f = FINGERS[i], c = clampRow(f, r);
    c.forEach((v, j) => { if (Math.abs(v - r[j]) > 1e-9) hits.push({ finger: f, joint: j === 0 ? 'dyaw' : KEYS[j], value: r[j], limit: v }); });
    return c;
  });
  return { rows: out, hits };
}

// ---- searched poses on the reference hand (right hand; rows are hand-independent) -----------------------------------
const hand = referenceHand('right');
const tip = (f, row) => fingerChain(hand.fingers[f], row)[3];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return a.map(v => v / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const RADIAL = [1, 0, 0], DORSAL = [0, 1, 0]; // hand local X = D x F = radial for a right hand, Y = dorsal, Z = forward

/** Coordinate search inside the limits (deterministic): minimise cost(rows) over the free (finger, joint) pairs. */
function search(start, free, cost, { step = 8, min = 0.25 } = {}) {
  let rows = start.map(r => [...r]), best = cost(rows);
  for (let s = step; s >= min; s /= 2) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const [i, j] of free) for (const d of [s, -s]) {
        const next = rows.map(r => [...r]);
        next[i][j] = Math.max(HARD[FINGERS[i]][j][0], Math.min(HARD[FINGERS[i]][j][1], next[i][j] + d));
        const c = cost(next);
        if (c < best - 1e-12) { rows = next; best = c; improved = true; }
      }
    }
  }
  return rows.map(r => r.map(v => +v.toFixed(2)));
}

// thumbs up: fist, thumb straight (MCP 5, IP 0) and pointing radially out of the fist, square to the fingers.
const fist = CURVES.fist;
const FORWARD = [0, 0, 1];
const thumbsUp = search([[0, -10, 5, 0], ...fist.slice(1)], [[0, 0], [0, 1]], rows => {
  const d = norm(sub(tip('Thumb', rows[0]), hand.fingers.Thumb.base));
  return -dot(d, RADIAL) + 0.5 * Math.abs(dot(d, FORWARD)) - 0.1 * dot(d, DORSAL);
});
// point: the fist with Godot's pistol index (straight).
const point = [fist[0], GODOT.pistol[1], ...fist.slice(2)];
// pinch: thumb and index pads together (tip joints PINCH_GAP apart), other fingers as Godot's object pinch.
const PINCH_GAP = 0.012;
const pinch = search(GODOT.object_pinch, [[0, 0], [0, 1], [0, 2], [0, 3], [1, 1], [1, 2], [1, 3]], rows => {
  const d = len(sub(tip('Thumb', rows[0]), tip('Index', rows[1])));
  return ((d - PINCH_GAP) * 1000) ** 2 + 0.01 * rows.slice(0, 2).flat().reduce((s, v, k) => s + (v - GODOT.object_pinch[k >> 2][k & 3]) ** 2, 0) / 100;
});

const POSES = [];
const add = (id, rows, source, note) => {
  const c = clamped(id, rows);
  POSES.push({ id, kind: 'pose', space: 'hand', source, note, clamped: c.hits,
    frames: [{ t: 0, wrist: { pos: [0, 0, 0], quat: [0, 0, 0, 1] }, rows: Object.fromEntries(FINGERS.map((f, i) => [f, c.rows[i]])) }] });
};
add('relaxed', GODOT.relaxed, 'godot', GODOT_NOTES.relaxed);
add('open', GODOT.open, 'godot', GODOT_NOTES.open);
add('flat', CURVES.flat, 'curves', 'controller curve at curl 0 (fingers.js OPEN / THUMB_OPEN)');
add('fist', CURVES.fist, 'curves', 'controller curve at curl 1 (fingers.js FIST / THUMB_DOWN): thumb across the index/middle middle phalanges');
add('point', point, 'authored', 'fist with Godot\'s pistol index (straight)');
add('pinch', pinch, 'authored', `thumb and index pads together (tips ${PINCH_GAP * 1000} mm apart on the reference hand), from Godot object_pinch`);
add('thumbs_up', thumbsUp, 'authored', 'fist, thumb straight and pointing out of the fist on the thumb side (reference hand search)');
for (const id of ['pistol', 'trigger', 'support', 'magazine', 'insert', 'slide', 'object_wrap', 'object_neck', 'object_handle', 'object_pinch']) add(id, GODOT[id], 'godot', GODOT_NOTES[id]);

// ---- clips ------------------------------------------------------------------------------------------------------------
const I = [0, 0, 0, 1], Z = [0, 0, 0];
const qAxis = (axis, deg) => { const h = deg * Math.PI / 360, s = Math.sin(h); return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)].map(v => +v.toFixed(6)); };
const per = (t, i, m, r, l) => ({ Thumb: t, Index: i, Middle: m, Ring: r, Little: l });
const poseFrame = id => POSES.find(p => p.id === id).frames[0].rows;
const CLIPS = [
  { id: 'grab', kind: 'animation', space: 'grasp', duration: 1, note: 'open -> approach (thumb opposes first, fingers a little wider than the approach) -> closed; '
    + 'sampled with the grasp progress 0..1 (replaces the linear open -> closed lerp); wrist = offset from the grasp wrist in the hand frame (m; +Y back of the hand, +Z fingers)',
  frames: [
    { t: 0, wrist: { pos: [0, 0.02, -0.03], quat: I }, mix: 0 },
    { t: 0.4, wrist: { pos: [0, 0.008, -0.012], quat: I }, mix: per(0.45, -0.12, -0.12, -0.1, -0.08) },
    { t: 0.75, wrist: { pos: [0, 0.002, -0.003], quat: I }, mix: per(0.9, 0.85, 0.8, 0.75, 0.7) },
    { t: 1, wrist: { pos: Z, quat: I }, mix: 1 },
  ] },
  { id: 'release', kind: 'animation', space: 'grasp', duration: 0.24, note: 'held grip (from) -> free hand (to): the index lets go first, the others follow, a slight overshoot open',
  frames: [
    { t: 0, wrist: { pos: Z, quat: I }, mix: 0 },
    { t: 0.08, wrist: { pos: Z, quat: I }, mix: per(0.5, 0.7, 0.55, 0.45, 0.4) },
    { t: 0.17, wrist: { pos: Z, quat: I }, mix: per(1.05, 1.1, 1.08, 1.06, 1.05) },
    { t: 0.24, wrist: { pos: Z, quat: I }, mix: 1 },
  ] },
  { id: 'pour', kind: 'animation', space: 'grasp', duration: 1, note: 'grip (to) tightening while the wrist rolls toward the little finger to pour (tilt progress 0..1); '
    + 'from = the grasp open rows, to = its closed rows',
  frames: [
    { t: 0, wrist: { pos: Z, quat: I }, mix: 1 },
    { t: 0.5, wrist: { pos: Z, quat: qAxis([0, 0, 1], -45) }, mix: per(1.04, 1.03, 1.05, 1.07, 1.09) },
    { t: 1, wrist: { pos: Z, quat: qAxis([0, 0, 1], -100) }, mix: per(1.06, 1.05, 1.08, 1.1, 1.12) },
  ] },
  { id: 'wave', kind: 'animation', space: 'hand', duration: 1.2, loop: true, note: 'open hand waving (wrist swings about the back-of-hand axis)',
  frames: [0, 0.3, 0.6, 0.9, 1.2].map((t, k) => ({ t, wrist: { pos: Z, quat: qAxis([0, 1, 0], [0, 22, 0, -22, 0][k]) }, rows: poseFrame('open') })) },
  { id: 'beckon', kind: 'animation', space: 'hand', duration: 1, loop: true, note: '"come here": the index curls and straightens, the other fingers in a fist',
  frames: [0, 0.5, 1].map((t, k) => ({ t, wrist: { pos: Z, quat: I }, rows: { ...poseFrame('point'), Index: k === 1 ? [0, 55, 85, 60] : poseFrame('point').Index } })) },
];

const doc = {
  schema: 'gamesystems.hand-poses.v1',
  note: 'Generated by extensions/avatar/tools/make_hand_poses.mjs (do not edit by hand; edit the tool or record poses with Grasp Studio, '
    + 'which writes recorded_hand.json). A pose is a one-frame clip. Rows [dyaw, pitch, bend1, bend2] in degrees per digit; clamped to the avatar LIMITS (= grasp HARD). '
    + 'Godot poses: NightfallContractsGodot finger_poses.gd (MIT, Copyright (c) 2026 Kasper Olesen).',
  conventions: {
    rows: '[dyaw, pitch, bend1, bend2] deg; dyaw relative to the rest spread of the hand, pitch/bend absolute in the hand frame (fingers.js chainAngles)',
    hand: 'hand frame: +Z wrist -> middle knuckle, +Y back of the hand, +X = Y x Z; wrist { pos (m), quat [x,y,z,w] }',
    spaces: 'hand: wrist relative to the tracked hand; item: wrist in item space (grasp clips recorded on an item); grasp: frames carry mix (0 = from rows, 1 = to rows) and the wrist is an offset from the grasp wrist in the hand frame',
  },
  limits: HARD,
  controller: {
    note: 'quality mid: each finger follows its curl 0..1 from `curl.from` to `curl.to` (the data form of the old curves). high: grip blends '
      + 'idle -> grip for middle/ring/little, trigger blends idle -> grip for the index, an untouched trigger points, a lifted thumb on a held grip gives a thumbs up.',
    curl: { from: 'flat', to: 'fist' },
    high: { idle: 'relaxed', grip: 'fist', point: 'point', thumbUp: 'thumbs_up' },
    ease: 0.08,
  },
  poses: POSES,
  clips: CLIPS,
};
const text = JSON.stringify(doc, null, 1).replace(/\[\s+([-\d.,\s]+?)\s+\]/g, (_, inner) => `[${inner.replace(/\s+/g, ' ').trim().replace(/, /g, ', ')}]`) + '\n';
const old = await readFile(OUT, 'utf8').catch(() => null);
if (process.argv.includes('--check')) {
  console.log(old === text ? 'hand_poses.json up to date' : 'hand_poses.json out of date: run node extensions/avatar/tools/make_hand_poses.mjs');
  process.exit(old === text ? 0 : 1);
}
if (old !== text) await writeFile(OUT, text);
const hits = POSES.filter(p => p.clamped.length);
console.log(`hand_poses.json: ${POSES.length} poses, ${CLIPS.length} clips${old === text ? ' (unchanged)' : ''}`);
for (const p of hits) console.log(`  clamped ${p.id}: ${p.clamped.map(h => `${h.finger}.${h.joint} ${h.value} -> ${h.limit}`).join(', ')}`);
console.log(`  thumbs_up thumb ${JSON.stringify(thumbsUp[0])}, pinch thumb ${JSON.stringify(pinch[0])} index ${JSON.stringify(pinch[1])} (tip gap ${(len(sub(tip('Thumb', pinch[0]), tip('Index', pinch[1]))) * 1000).toFixed(1)} mm)`);
