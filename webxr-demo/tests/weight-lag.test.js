import test from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../../extensions/grasp/index.js';

const { WEIGHT_LAG, maxOffset, sagOf, lagTarget, createWeightLag, softLimit, parseWeightLag, weightLagMode, holdForce, forceLimit } = g;
const len = v => Math.hypot(...v);

test('WEIGHT_LAG is one exported data table with the 5..30 mm range', () => {
  assert.equal(WEIGHT_LAG.offsetMm[0], 5);
  assert.equal(WEIGHT_LAG.offsetMm[1], 30);
  assert.ok(maxOffset(0.01) * 1000 >= 4.99 && maxOffset(0.01) * 1000 < 5.5);
  assert.ok(maxOffset(100) * 1000 <= 30 && maxOffset(100) * 1000 > 29.5);
});

test('offset limit and sag rise monotonically with mass; two hands share the load', () => {
  let a = 0, s = -1;
  for (const m of [0.05, 0.3, 0.6, 1, 2, 4, 8, 12, 30]) {
    assert.ok(maxOffset(m) >= a); a = maxOffset(m);
    assert.ok(sagOf(m) >= s); s = sagOf(m);
    assert.ok(maxOffset(m, { hands: 2 }) <= maxOffset(m) + 1e-12);
  }
  assert.ok(maxOffset(16, { hands: 2 }) < maxOffset(16));
});

test('lagTarget is bounded for any error (soft limit), never NaN, zero without mass error', () => {
  for (const mass of [0.1, 0.5, 2, 16, 500]) for (const e of [[0, 0, 0], [0.001, 0, 0], [0, -0.5, 0], [10, 10, 10], [NaN, 0, 0]]) {
    const t = lagTarget({ error: e, mass });
    assert.ok(t.every(Number.isFinite));
    assert.ok(len(t) < maxOffset(mass) + 1e-12, `${mass} ${e}`);
  }
  assert.deepEqual(softLimit([0, 0, 0], 0.02), [0, 0, 0]);
  const small = softLimit([0.0001, 0, 0], 0.03)[0];
  assert.ok(Math.abs(small - 0.0001) < 1e-8, 'identity for small vectors');
});

test('a heavy item sinks the shown hand 5..30 mm depending on mass, a light one hardly', () => {
  const settle = mass => {
    const lag = createWeightLag({ tier: 'low' }); let r;
    for (let i = 0; i < 360; i++) r = lag.update({ dt: 1 / 72, mass, target: [0, 1.2, -0.3], simulate: true });
    return r;
  };
  const light = settle(0.4), heavy = settle(12);
  assert.ok(len(light.offset) * 1000 >= 0 && len(light.offset) * 1000 < 6, `light ${len(light.offset) * 1000}`);
  assert.ok(len(heavy.offset) * 1000 > 8 && len(heavy.offset) * 1000 < 30, `heavy ${len(heavy.offset) * 1000}`);
  assert.ok(heavy.offset[1] < 0, 'sinks');
  assert.ok(heavy.effort > light.effort);
});

test('tiers: minimal = off, low = hand offset only, medium/high add the elbow hint', () => {
  const run = tier => { const lag = createWeightLag({ tier }); let r; for (let i = 0; i < 200; i++) r = lag.update({ dt: 1 / 72, mass: 10, target: [0, 1, 0], simulate: true }); return r; };
  const minimal = run('minimal'), low = run('low'), medium = run('medium'), high = run('high');
  assert.equal(minimal.active, false); assert.deepEqual(minimal.offset, [0, 0, 0]);
  assert.ok(len(low.offset) > 0 && len(low.elbow) === 0);
  assert.ok(len(medium.offset) > 0 && len(medium.elbow) > 0);
  assert.deepEqual(medium.elbow, high.elbow);
  assert.equal(weightLagMode('minimal'), 'off');
});

test("tier 'mid' (the bottle/Contracts tier name) is the elbow mode like 'medium', not the 'hand' fallback", () => {
  const run = tier => { const lag = createWeightLag({ tier }); let r; for (let i = 0; i < 200; i++) r = lag.update({ dt: 1 / 72, mass: 10, target: [0, 1, 0], simulate: true }); return r; };
  assert.equal(weightLagMode('mid'), 'elbow');
  assert.equal(weightLagMode('mid'), weightLagMode('medium'));
  assert.equal(weightLagMode('banana'), 'hand', 'unknown tiers still fall back to hand');
  const mid = run('mid'), medium = run('medium');
  assert.ok(len(mid.elbow) > 0);
  assert.deepEqual(mid.offset, medium.offset); assert.deepEqual(mid.elbow, medium.elbow);
});

test('the switch: parseWeightLag, setEnabled(false) returns zero, raw hand is never touched', () => {
  assert.equal(parseWeightLag('on'), true); assert.equal(parseWeightLag('off'), false); assert.equal(parseWeightLag(undefined), null);
  const lag = createWeightLag({ enabled: false });
  assert.equal(lag.update({ dt: 1 / 72, mass: 10, target: [0, 1, 0], simulate: true }).active, false);
  lag.setEnabled(true);
  for (let i = 0; i < 100; i++) lag.update({ dt: 1 / 72, mass: 10, target: [0, 1, 0], simulate: true });
  lag.setEnabled(false);
  assert.deepEqual(lag.update({ dt: 1 / 72, mass: 10, target: [0, 1, 0], simulate: true }).offset, [0, 0, 0]);
});

test('dt independence: 36, 72 and 144 Hz settle to the same offset; no jitter from a steady target', () => {
  const settle = hz => {
    const lag = createWeightLag({ tier: 'low' }); let r;
    for (let i = 0; i < hz * 3; i++) r = lag.update({ dt: 1 / hz, mass: 8, target: [0, 1, 0], simulate: true });
    return r.offset;
  };
  const a = settle(36), b = settle(72), c = settle(144);
  for (let k = 0; k < 3; k++) { assert.ok(Math.abs(a[k] - b[k]) < 0.0007); assert.ok(Math.abs(c[k] - b[k]) < 0.0007); }
  const lag = createWeightLag({ tier: 'low' }); let prev = null, maxStep = 0;
  for (let i = 0; i < 400; i++) { const r = lag.update({ dt: 1 / 72, mass: 8, target: [0, 1, 0], simulate: true }); if (prev) maxStep = Math.max(maxStep, len(r.offset.map((v, k) => v - prev[k]))); prev = r.offset; }
  assert.ok(maxStep < 0.0015, `largest per-frame step ${maxStep * 1000} mm`);
});

test('a physics body: the offset follows the real held-drive error and stays bounded', () => {
  const lag = createWeightLag({ tier: 'low' }); let r, worst = 0;
  for (let i = 0; i < 300; i++) {
    const t = i / 72, target = [Math.sin(t * 4) * 0.4, 1, 0], body = [target[0] - 0.05, target[1] - 0.04, 0];
    r = lag.update({ dt: 1 / 72, mass: 12, target, body }); worst = Math.max(worst, len(r.offset));
    assert.ok(r.offset.every(Number.isFinite));
  }
  assert.ok(worst < maxOffset(12) + 1e-9);
  assert.equal(lag.update({ dt: 1 / 72, mass: 12, target: [NaN, 0, 0], simulate: true }).active, false);
});

test('release resets: nothing carries to the next grab', () => {
  const lag = createWeightLag({ tier: 'low' });
  for (let i = 0; i < 200; i++) lag.update({ dt: 1 / 72, mass: 12, target: [0, 1, 0], simulate: true });
  lag.reset();
  assert.ok(len(lag.update({ dt: 1 / 72, mass: 12, target: [0, 1, 0], simulate: true }).offset) < 0.0005);
});

test('hold force of two hands is the sum, capped; the old one-hand accelerationLimit is unchanged', () => {
  assert.equal(holdForce(1), g.MAX_HOLD_FORCE);
  assert.ok(holdForce(2) > holdForce(1) && holdForce(2) <= 2 * g.MAX_HOLD_FORCE);
  assert.equal(g.accelerationLimit(2), forceLimit(2, g.MAX_HOLD_FORCE));
  // a 16 kg barrel: one hand cannot hold its weight (16 * 9.81 = 157 N > 120 N), two can
  assert.ok(holdForce(1) < 16 * 9.81 && holdForce(2) > 16 * 9.81 * 0.99 - 1 && holdForce(2) >= 16 * 9.81);
});
