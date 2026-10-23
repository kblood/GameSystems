// Elbow hint: VRIK setElbowHint (opt-in soft bias of the elbow pole) and weight_lag's elbow tiers feeding it.
// Without a call the solver is bit-identical to before (golden digest); bounded to 3 cm; no NaN; dt independent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareRig } from '../../extensions/avatar/rigdata.js';
import { createVRIK, VRIK_DEFAULTS } from '../../extensions/avatar/vrik.js';
import { headsFromSidecar } from '../../extensions/humanoid/index.js';
import { createWeightLag, elbowHintOf, WEIGHT_LAG } from '../../extensions/grasp/weight_lag.js';
import { vrikDigest } from './helpers/regression-digest.js';

// Golden digest of 600 solve frames BEFORE the elbow-hint addition (see helpers/regression-digest.js).
const GOLDEN_VRIK = '535f9a0015697da4e856f27e96476e8b22e17978e22224dcc9a5e0973095dc3c';
const rig = prepareRig(headsFromSidecar(JSON.parse(readFileSync(new URL('../public/avatar-assets/base_body.joints.json', import.meta.url), 'utf8'))));
const mk = () => createVRIK(rig, { clips: false });
const finiteDeep = v => typeof v === 'number' ? Number.isFinite(v) : Array.isArray(v) ? v.every(finiteDeep) : v && typeof v === 'object' ? Object.values(v).every(finiteDeep) : true;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const input = (hand = [0.25, 1.15, -0.35], scale = 1) => ({ head: { pos: [0, 1.62, 0], quat: [0, 0, 0, 1] },
  hands: { left: { pos: [-0.25, 1.15, -0.35], quat: [0, 0, 0, 1], valid: true }, right: { pos: hand, quat: [0, 0, 0, 1], valid: true } }, fingers: { left: null, right: null }, scale });
/** Elbow position (yaw frame, rig metres) of the right arm after `seconds` at `hz`. */
function elbowAfter(solver, seconds, hz, hand, scale = 1) {
  let e = null;
  for (let i = 0; i < Math.round(seconds * hz); i++) e = solver.solve(input(hand, scale), 1 / hz).positions.rightLowerArm.slice();
  return e;
}

test('default: without any hint call the solve is bit-identical to before (golden digest of 600 frames)', () => {
  assert.equal(vrikDigest(createVRIK, rig), GOLDEN_VRIK);
});

test('a hint that is never used leaves no trace: null / zero weight / invalid calls, and a faded-out hint, give the plain solve', () => {
  const plain = mk(), other = mk();
  assert.equal(other.setElbowHint('right', null), true);
  assert.equal(other.setElbowHint('left', [0.02, 0, 0], 0), true);
  assert.equal(other.setElbowHint('nope', [0, 0, 0.01], 1), false);
  assert.equal(other.setElbowHint('right', [NaN, 0, 0], 1), false);
  assert.equal(other.setElbowHint('right', [0, Infinity, 0], 1), false);
  assert.equal(other.setElbowHint('right', 'x', 1), false);
  const a = elbowAfter(plain, 1, 72), b = elbowAfter(other, 1, 72);
  assert.deepEqual(b, a);
  // hint on, then off: after the fade the arm is back where the plain solve has it
  other.setElbowHint('right', [0.03, -0.02, 0], 1);
  const hinted = elbowAfter(other, 2, 72);
  assert.ok(dist(hinted, a) > 0.003, 'the hint moved the elbow');
  other.setElbowHint('right', null);
  const back = elbowAfter(other, 3, 72), base = elbowAfter(plain, 3, 72);
  assert.ok(dist(back, base) < 1e-9, `faded out: ${dist(back, base)}`);
  assert.deepEqual(other.elbowHint('right'), [0, 0, 0]);
});

test('bounded: the elbow never moves more than 3 cm (+1 mm) from the plain solve, in any direction, hand position and avatar scale', () => {
  const cap = VRIK_DEFAULTS.elbowHintMax;
  assert.equal(cap, 0.03);
  let worst = 0, moved = 0;
  for (const scale of [1, 1.3]) for (const hand of [[0.25, 1.15, -0.35], [0.1, 1.4, -0.4], [0.3, 0.9, -0.2], [0.2, 1.6, -0.1], [0.35, 1.2, -0.55]]) {
    const plain = mk(), hinted = mk(); const e0 = elbowAfter(plain, 1.5, 72, hand, scale); elbowAfter(hinted, 1.5, 72, hand, scale);
    for (const v of [[0, -0.5, 0], [0.5, 0, 0], [-0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5], [0, 0, -0.5], [0.02, -0.02, 0.01]]) {   // 0.5 m: far over the limit, must be clamped
      hinted.setElbowHint('right', v, 1);
      const e = elbowAfter(hinted, 2, 72, hand, scale), d = dist(e, e0) * scale;       // world metres (positions are scale-free)
      worst = Math.max(worst, d); moved = Math.max(moved, d);
      assert.ok(d <= cap + 0.001, `scale ${scale} hand ${hand} dir ${v}: ${(d * 1000).toFixed(1)} mm`);
      assert.ok(Math.hypot(...hinted.elbowHint('right')) <= cap + 1e-9);
      hinted.setElbowHint('right', null); elbowAfter(hinted, 2, 72, hand, scale);
    }
  }
  assert.ok(moved > 0.015, `the hint is effective (largest elbow shift ${(moved * 1000).toFixed(1)} mm)`);
  console.log('elbow hint: largest elbow shift', `${(worst * 1000).toFixed(1)} mm`, 'of the 30 mm limit');
});

test('no NaN: random hint streams (including NaN, huge, zero-length and flipping) keep the whole solve finite', () => {
  const s = mk(); let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < 800; i++) {
    const pick = Math.floor(rnd() * 6), v = pick === 0 ? [NaN, 0, 0] : pick === 1 ? [1e9, -1e9, 1e9] : pick === 2 ? [0, 0, 0] : [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5].map(x => x * 0.2);
    s.setElbowHint(i % 2 ? 'left' : 'right', v, pick === 3 ? NaN : rnd() * 1.4 - 0.1);
    const r = s.solve(input([0.25 + 0.1 * Math.sin(i / 9), 1.15, -0.35]), i % 7 === 0 ? 0 : 1 / 72);
    assert.ok(finiteDeep([r.pose.joints, r.pose.root, r.positions]), `frame ${i}`);
  }
});

test('dt independent: the same hint settles on the same elbow at 36, 72 and 144 Hz (and a hint ramps in smoothly, no frame jumps)', () => {
  const end = {}, hand = [0.25, 1.15, -0.35];
  for (const hz of [36, 72, 144]) {
    const s = mk(); elbowAfter(s, 1, hz, hand);
    s.setElbowHint('right', [0.03, -0.03, 0.01], 1);
    let prev = null, step = 0;
    for (let i = 0; i < 3 * hz; i++) {
      const e = s.solve(input(hand), 1 / hz).positions.rightLowerArm.slice();
      if (prev) step = Math.max(step, dist(e, prev));
      prev = e;
    }
    end[hz] = prev;
    assert.ok(step < 0.004, `${hz} Hz: largest frame step ${(step * 1000).toFixed(2)} mm`);
  }
  assert.ok(dist(end[36], end[144]) < 0.001 && dist(end[72], end[144]) < 0.001, `settled elbows differ ${dist(end[36], end[144]) * 1000} / ${dist(end[72], end[144]) * 1000} mm`);
});

test('reset clears the hints; the other arm is untouched by a hint on one arm', () => {
  const s = mk(), plain = mk(), hand = [0.25, 1.15, -0.35];
  elbowAfter(s, 1, 72, hand); elbowAfter(plain, 1, 72, hand);
  s.setElbowHint('right', [0.03, 0, 0], 1);
  let left = null, leftPlain = null;
  for (let i = 0; i < 144; i++) { left = s.solve(input(hand), 1 / 72).positions.leftLowerArm.slice(); leftPlain = plain.solve(input(hand), 1 / 72).positions.leftLowerArm.slice(); }
  assert.deepEqual(left, leftPlain, 'left arm unchanged');
  assert.ok(Math.hypot(...s.elbowHint('right')) > 0.005);
  s.reset();
  assert.deepEqual(s.elbowHint('right'), [0, 0, 0]);
});

test('weight lag: elbowHintOf is null below tier mid (and when off / NaN), a bounded vector at mid / medium / high', () => {
  const run = tier => {
    const lag = createWeightLag({ enabled: true, tier }); let r = null;
    for (let i = 0; i < 120; i++) r = lag.update({ dt: 1 / 72, mass: 16, hands: 1, target: [0, 1.2, -0.3], simulate: true });
    return r;
  };
  assert.equal(WEIGHT_LAG.tiers.mid, 'elbow');
  for (const tier of ['minimal', 'low']) assert.equal(elbowHintOf(run(tier)), null, tier);
  for (const tier of ['mid', 'medium', 'high']) {
    const hint = elbowHintOf(run(tier));
    assert.ok(hint && hint.weight === 1 && hint.vector.every(Number.isFinite), tier);
    assert.ok(Math.hypot(...hint.vector) > 0 && Math.hypot(...hint.vector) < 0.03, `${tier}: ${Math.hypot(...hint.vector)}`);
  }
  const off = createWeightLag({ enabled: false, tier: 'high' });
  assert.equal(elbowHintOf(off.update({ dt: 1 / 72, mass: 16, target: [0, 1, 0], simulate: true })), null);
  assert.equal(elbowHintOf({ active: true, elbow: [NaN, 0, 0] }), null);
  assert.equal(elbowHintOf(null), null);
  assert.equal(elbowHintOf({ active: true, elbow: [0, 0, 0] }), null);
});

test('weight lag -> VRIK: a heavy item at tier high bends the elbow a little (<= 3 cm), tier low leaves the arm exactly as before', () => {
  const hand = [0.25, 1.15, -0.35], plain = mk(), low = mk(), high = mk();
  const lagLow = createWeightLag({ enabled: true, tier: 'low' }), lagHigh = createWeightLag({ enabled: true, tier: 'high' });
  const frame = (solver, lag) => {
    const r = lag.update({ dt: 1 / 72, mass: 16, hands: 1, target: [0.25, 1.15, -0.35], simulate: true }), hint = elbowHintOf(r);
    if (hint) solver.setElbowHint('right', hint.vector, hint.weight); else solver.setElbowHint('right', null, 0);
    return solver.solve(input(hand), 1 / 72).positions.rightLowerArm.slice();
  };
  let a, b, c;
  for (let i = 0; i < 288; i++) { a = plain.solve(input(hand), 1 / 72).positions.rightLowerArm.slice(); b = frame(low, lagLow); c = frame(high, lagHigh); }
  assert.deepEqual(b, a, 'tier low: no elbow hint, the arm is as before');
  const shift = dist(c, a);
  assert.ok(shift <= 0.031, `${shift}`);
  console.log('weight lag elbow (16 kg, tier high): elbow moved', `${(shift * 1000).toFixed(1)} mm`);
});
