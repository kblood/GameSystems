// Thumb twist (axial pronation) and thumb bone roll: the avatar finger mapping (rigdata / fingers) and the grasp rows
// (record / closure / validator) carry the twist, and the avatar's thumb bones are posed by frame so the nail stays off
// the bend plane in every pose (docs/headset_testlab.md, "Kendte fejl / rettet").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/vendor/extensions/grasp/index.js';
import { prepareRig, chainAngles, handFrame, THUMB_AXIS } from '../src/vendor/extensions/avatar/rigdata.js';
import { fingerStateFromJoints, syntheticJoints, fingerWorldDeltas, fingerWorldDeltasInto } from '../src/vendor/extensions/avatar/fingers.js';
import { headsFromSidecar } from '../src/vendor/extensions/humanoid/index.js';
import * as PM from '../src/vendor/extensions/avatar/pm.js';

const D = Math.PI / 180, R2D = 180 / Math.PI;
const assets = new URL('../public/avatar-assets/', import.meta.url);
const rig = prepareRig(headsFromSidecar(JSON.parse(readFileSync(new URL('base_body.joints.json', assets), 'utf8'))));
const sub = (a, b) => a.map((v, i) => v - b[i]), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a); return a.map(v => v / l); }, rej = (v, n) => sub(v, n.map(x => x * dot(v, n)));
const qMul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qRot = (q, v) => { const u = q.slice(0, 3), t = cross(u, v).map(x => 2 * x), c = cross(u, t); return v.map((x, i) => x + q[3] * t[i] + c[i]); };
const thumbState = (dyaw, pitch, b1, b2, twist) => ({ yaw: null, dyaw: dyaw * D, pitch: pitch * D, bend1: b1 * D, bend2: b2 * D, ...(twist != null && { twist: twist * D }) });

test('avatar: a twisted thumb survives joints -> finger state -> joints on both hands (the twist is read back)', () => {
  for (const side of ['right', 'left']) {
    const h = rig.hands[side], wrist = rig.H[`${side}Hand`];
    for (const tw of [0, 20, -25, 40]) {
      const fs = { Thumb: thumbState(-20, 5, 40, 35, tw) };
      const got = fingerStateFromJoints(side, syntheticJoints(h, side, fs, [0, 0, 0, 1], wrist, wrist)).fingers.Thumb;
      assert.ok(Math.abs(got.twist * R2D - tw) < 0.5, `${side} twist ${tw}: read ${got.twist * R2D}`);
      for (const k of ['bend1', 'bend2']) assert.ok(Math.abs(got[k] - fs.Thumb[k]) < 0.5 * D, `${side} ${k} at twist ${tw}`);
    }
  }
});

test('avatar: pooled and allocating finger deltas agree with a thumb twist', () => {
  for (const side of ['right', 'left']) {
    const h = rig.hands[side], fs = { Thumb: thumbState(-30, 0, 45, 30, 25), Index: { yaw: null, pitch: 30 * D, bend1: 40 * D, bend2: 20 * D } };
    const a = fingerWorldDeltas(h, side, fs, [0, 0, 0, 1]), W = Object.fromEntries(Object.keys(a).map(k => [k, [0, 0, 0, 1]]));
    PM.beginFrame(); fingerWorldDeltasInto(W, h, side, fs, [0, 0, 0, 1]);
    for (const k of Object.keys(a)) assert.ok(Math.abs(Math.abs(dot(a[k], W[k]) + a[k][3] * W[k][3]) - 1) < 1e-9, k);
  }
});

// Bind-pose bone rotations of the CC body (GLB nodes), to check the thumb bones' roll after posing.
function glbWorld(url) {
  const b = readFileSync(url), j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
  const parent = {}; j.nodes.forEach((n, i) => (n.children || []).forEach(c => { parent[c] = i; }));
  const W = [], get = i => W[i] || (W[i] = (() => {
    const n = j.nodes[i], q = n.rotation || [0, 0, 0, 1], t = n.translation || [0, 0, 0];
    if (parent[i] === undefined) return { q, t };
    const P = get(parent[i]), ts = qRot(P.q, t);
    return { q: qMul(P.q, q), t: P.t.map((v, k) => v + ts[k]) };
  })());
  return Object.fromEntries(j.nodes.map((n, i) => [n.name, get(i)]));
}

test('avatar: the thumb bones keep their roll against the bend plane in every pose (no swing-induced twist)', () => {
  const w = glbWorld(new URL('base_body.glb', assets)), SEG = { Thumb: 'thumb', Index: 'index', Middle: 'middle', Ring: 'ring', Little: 'pinky' };
  const poses = { relaxed: [0, 0, 12, 8], open: [-40, -35, 0, -20], fist: [-10, -15, 75, 0], pinch: [-38, -4, 28, 23.5], thumbs_up: [26, -35, 5, 0], opposed: [-30, 20, 52, 40, 30] };
  for (const [x, side] of [['_r', 'right'], ['_l', 'left']]) {
    // rest hand from the GLB itself (same frame as the bind rotations)
    const hf = handFrame(side, w[`hand${x}`].t, w[`index_01${x}`].t, w[`middle_01${x}`].t, w[`pinky_01${x}`].t), fingers = {};
    for (const [f, b] of Object.entries(SEG)) {
      const s = [1, 2, 3].map(k => w[`${b}_0${k}${x}`].t), d2 = sub(s[2], s[1]), pts = [...s, s[2].map((v, i) => v + d2[i] * 0.8)];
      fingers[f] = { rest: chainAngles(f, hf, pts), pts, len: [0, 1, 2].map(k => Math.hypot(...sub(pts[k + 1], pts[k]))) };
    }
    const h = { frame: hf, fingers };
    const roll = (fs, twist) => {   // metacarpal / proximal bone X (the rig's flexion axis) vs the pose's hinge, about the bone
      const Wd = fingerWorldDeltas(h, side, { Thumb: fs }, [0, 0, 0, 1]), c = Math.cos(THUMB_AXIS.tilt), s = Math.sin(THUMB_AXIS.tilt);
      const Dt = norm(hf.D.map((v, i) => v * c + hf.R[i] * s)), Kh = norm(cross(Dt, hf.F)), sgn = dot(cross(hf.F, hf.R), hf.D) >= 0 ? 1 : -1;
      return ['Metacarpal', 'Proximal'].map((n, k) => {
        const q = qMul(Wd[`${side}Thumb${n}`], w[`thumb_0${k + 1}${x}`].q), y = norm(qRot(q, [0, 1, 0])), bx = norm(rej(qRot(q, [1, 0, 0]), y));
        let K = norm(rej(Kh, y));
        const tw = (twist || 0) * D * sgn, ct = Math.cos(tw), st = Math.sin(tw), kv = cross(y, K);
        K = K.map((v, i) => v * ct + kv[i] * st + y[i] * dot(y, K) * (1 - ct));
        return Math.atan2(dot(cross(K, bx), y), dot(K, bx)) * R2D * sgn;
      });
    };
    const base = roll(thumbState(0, 0, 0, 5));
    for (const [name, r] of Object.entries(poses)) {
      const got = roll(thumbState(...r), r[4]);
      got.forEach((v, k) => assert.ok(Math.abs(v - base[k]) < 0.5, `${side} ${name} bone ${k}: roll ${v.toFixed(1)} vs ${base[k].toFixed(1)} deg`));
    }
    assert.ok(base.every(v => Math.abs(v) < 8), `the CC bind thumb bones sit on the hinge convention: ${base}`);
  }
});

test('grasp rows: a recorded thumb twist round-trips through fingerChain, mirrors, clamps and scores', () => {
  const item = { pos: [0, 1, 0], quat: [0, 0, 0, 1] };
  for (const side of ['right', 'left']) {
    const hand = G.referenceHand(side), pose = G.defaultPose('bottle_beer', side, 'body');
    for (const tw of [0, 20, -20, 35]) {
      const rows = pose.angles.map((r, i) => (i === 0 ? [r[0], r[1], 40, 35, tw] : [...r]));
      const got = G.rowsFromJoints(side, G.poseJoints(pose, hand, item, rows), hand)[0];
      assert.equal(got.length, 5);
      got.forEach((v, k) => assert.ok(Math.abs(v - rows[0][k]) < 0.1, `${side} twist ${tw} value ${k}: ${v}`));
    }
  }
  const pr = G.defaultPose('bottle_beer', 'right', 'body'), angles = pr.angles.map((r, i) => (i === 0 ? [r[0], r[1], 40, 35, 25] : [...r]));
  const right = { ...pr, angles }, left = G.mirrorPose(right);
  const jr = G.poseJoints(right, G.referenceHand('right'), item), jl = G.poseJoints(left, G.referenceHand('left'), item);
  assert.ok(Math.hypot(jr['thumb-tip'][0] - jl['thumb-tip'][0], jr['thumb-tip'][1] - jl['thumb-tip'][1], jr['thumb-tip'][2] + jl['thumb-tip'][2]) < 2e-5, 'mirrored thumb');
  assert.ok(Math.abs(G.rowsFromJoints('left', jl, G.referenceHand('left'))[0][4] - 25) < 0.1, 'the mirrored hand reads the same twist');
  assert.deepEqual(G.clampRows({ Thumb: [0, 0, 0, 0, 80] }).Thumb, [0, 0, 0, 0, 45]);
  assert.ok(G.validateRows({ ...Object.fromEntries(G.FINGERS.map((f, i) => [f, angles[i]])), Thumb: [...angles[0].slice(0, 4), 60] }).hard.some(h => h.joint === 'twist'));
  assert.ok(G.scoreGrasp(right).score >= 80, 'a twisted thumb still scores');
  G.THUMB_TWIST.enabled = false;
  try { assert.equal(G.rowsFromJoints('right', jr, G.referenceHand('right'))[0].length, 4, 'switched off: the old 4-value thumb'); }
  finally { G.THUMB_TWIST.enabled = true; }
});
