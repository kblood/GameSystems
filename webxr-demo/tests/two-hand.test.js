import test from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../../extensions/grasp/index.js';
import { qmul, qconj, rotate, add, sub } from '../../extensions/grasp/math.js';

const { solveTwoHand, controllerPointOf, stepBlend, arcQuat, quatAngleOf, TWO_HAND } = g;
const len = v => Math.hypot(...v);
const qaxis = (axis, a) => { const l = len(axis); return [axis[0] / l * Math.sin(a / 2), axis[1] / l * Math.sin(a / 2), axis[2] / l * Math.sin(a / 2), Math.cos(a / 2)]; };
const D = Math.PI / 180;

// a pole along the item z axis: the primary controller sits 0.1 m behind the item origin, the secondary 0.5 m ahead of it
const offset1 = { pos: [0, 0, 0.1], quat: [0, 0, 0, 1] };   // item in the primary controller frame
const point2 = [0, 0, 0.5];                                  // secondary controller position in item space
const point1 = controllerPointOf(offset1);

function world(primary, aimDeg, dist) {
  // secondary controller at distance dist from the primary, aimDeg about +Y from the +Z axis
  const a = aimDeg * D, dir = [Math.sin(a), 0, Math.cos(a)];
  return { pos: add(primary.pos, dir.map(v => v * dist)) };
}

test('two-hand orientation: the item axis follows the line between the hands (angle error ~0 inside the bound)', () => {
  const primary = { pos: [0.2, 1.1, -0.4], quat: qaxis([0, 1, 0], 25 * D) };
  const axisLen = len(sub(point2, point1));
  for (const aim of [0, 10, 25, 40, 54]) {
    const secondary = world(primary, aim + 25, axisLen);
    const r = solveTwoHand({ primary, secondary, offset: offset1, point2 });
    assert.ok(r.active);
    assert.ok(r.axisError < 0.2 * D, `aim ${aim}: axis error ${r.axisError / D} deg`);
    assert.ok([...r.pos, ...r.quat].every(Number.isFinite));
    const grip = add(r.pos, rotate(r.quat, point1));
    assert.ok(len(sub(grip, primary.pos)) < 1e-6, 'the primary grip stays on the primary hand');
  }
});

test('the correction is bounded (55 deg) and adds no twist about the swing', () => {
  const primary = { pos: [0, 1, 0], quat: [0, 0, 0, 1] };
  const secondary = { pos: [0, 1, -1] };
  const r = solveTwoHand({ primary, secondary, offset: offset1, point2 });
  assert.ok(r.angle <= TWO_HAND.maxCorrectionDeg * D + 1e-9);
  assert.ok(r.axisError > 100 * D, 'the rest is left: the item does not flip');
  const swing = qmul(r.quat, qconj(r.base.quat)), axis = rotate(r.base.quat, [0, 0, 1]);
  assert.ok(Math.abs(swing[0] * axis[0] + swing[1] * axis[1] + swing[2] * axis[2]) < 1e-6, 'no twist about the grip axis');
});

test('degenerate input gives the one-hand target, never NaN', () => {
  const primary = { pos: [0, 1, 0], quat: [0, 0, 0, 1] };
  for (const secondary of [{ pos: [0, 1, 0] }, { pos: [NaN, 1, 0] }, null]) {
    const r = solveTwoHand({ primary, secondary, offset: offset1, point2 });
    assert.equal(r.active, false);
    assert.ok([...r.pos, ...r.quat].every(Number.isFinite));
    assert.deepEqual(r.pos, r.base.pos);
  }
  assert.equal(solveTwoHand({ primary, secondary: { pos: [0, 1, 0.01] }, offset: offset1, point2: point1 }).active, false, 'grips on top of each other');
});

test('dt independence: the solve is a pure function of the poses, the blend of total time', () => {
  const primary = { pos: [0, 1, 0], quat: [0, 0, 0, 1] }, secondary = world(primary, 30, 0.45);
  const a = solveTwoHand({ primary, secondary, offset: offset1, point2, weight: 0.6 }), b = solveTwoHand({ primary, secondary, offset: offset1, point2, weight: 0.6 });
  assert.deepEqual(a, b);
  const total = hz => { let w = 0; for (let i = 0; i < hz * 0.1; i++) w = stepBlend(w, 1, 1 / hz); return w; };
  for (const hz of [30, 60, 120]) assert.ok(Math.abs(total(hz) - total(60)) < 1e-9);
  assert.equal(stepBlend(0.5, 1, 0), 0.5); assert.equal(stepBlend(0.5, 1, NaN), 0.5);
});

test('1 -> 2 -> 1 hands: the item target moves continuously (a few mm per frame at most, no pop)', () => {
  const primary = { pos: [0, 1.1, -0.3], quat: [0, 0, 0, 1] };
  const dt = 1 / 72; let w = 0, prev = null, worst = 0, worstAngle = 0, t = 0;
  const frame = target => {
    t += dt; w = stepBlend(w, target, dt);
    const secondary = world(primary, 6, 0.6);   // a hand that grabs where it is: the axis is 6 deg off the nominal one, the blend takes it up
    const r = solveTwoHand({ primary, secondary, offset: offset1, point2, weight: w });
    if (prev) {
      const tip = add(r.pos, rotate(r.quat, [0, 0, 0.5])), ptip = add(prev.pos, rotate(prev.quat, [0, 0, 0.5]));
      worst = Math.max(worst, len(sub(r.pos, prev.pos)), len(sub(tip, ptip)));
      worstAngle = Math.max(worstAngle, quatAngleOf(qmul(r.quat, qconj(prev.quat))));
    }
    prev = r;
  };
  for (let i = 0; i < 30; i++) frame(0);
  for (let i = 0; i < 90; i++) frame(1);
  for (let i = 0; i < 60; i++) frame(1);
  for (let i = 0; i < 90; i++) frame(0);
  const end = solveTwoHand({ primary, secondary: world(primary, 0, 0.4), offset: offset1, point2, weight: 0 });
  assert.deepEqual(end.pos, end.base.pos);
  assert.ok(worst < 0.006, `largest step ${worst * 1000} mm`);
  assert.ok(worstAngle < 3 * D, `largest turn ${worstAngle / D} deg per frame`);
});

test('the hand-distance mismatch is shared between the hands, at most maxShift', () => {
  const primary = { pos: [0, 1, 0], quat: [0, 0, 0, 1] };
  for (const d of [0.5, 0.2, 0.9]) {
    const r = solveTwoHand({ primary, secondary: world(primary, 0, d), offset: offset1, point2 });
    assert.ok(r.shift <= TWO_HAND.maxShift + 1e-12, `${d}`);
  }
  assert.ok(solveTwoHand({ primary, secondary: world(primary, 0, 0.2), offset: offset1, point2 }).shift > 0);
});

test('secondaryHeld breaks when the hand leaves the grip; releasedTogether window', () => {
  const item = { pos: [0, 1, 0], quat: [0, 0, 0, 1] };
  assert.ok(g.secondaryHeld({ item, point2: [0, 0, 0.4], secondary: { pos: [0, 1, 0.42] } }));
  assert.ok(!g.secondaryHeld({ item, point2: [0, 0, 0.4], secondary: { pos: [0, 1, 1.2] } }));
  assert.ok(g.releasedTogether(1.0, 1.1) && !g.releasedTogether(1.0, 1.5));
});

test('arcQuat: shortest arc, also for antiparallel and identical vectors', () => {
  for (const [a, b] of [[[1, 0, 0], [0, 1, 0]], [[0, 0, 1], [0, 0, -1]], [[0, 1, 0], [0, 1, 0]], [[1, 0, 0], [-1, 0, 0]]]) {
    assert.ok(len(sub(rotate(arcQuat(a, b), a), b)) < 1e-9);
  }
});

test('specs: carton, pole, barrel and mug have a two-hand spec with grasp rows for both sides; a bottle has none', () => {
  for (const k of ['carton', 'pole', 'barrel', 'mug']) {
    const s = g.twoHandSpec(k);
    assert.ok(s && s.primary && s.secondary && s.minSeparation > 0, k);
  }
  // the grasp rows of the two-hand groups are the procedural grasps (opt-in): present with them on, pole/barrel absent by default
  g.setProceduralGrasps(true);
  try {
    for (const k of ['carton', 'pole', 'barrel', 'mug']) {
      const s = g.twoHandSpec(k);
      assert.ok(g.hasPoses(k), `${k} has grasp rows`);
      for (const group of [s.primary, s.secondary]) for (const side of ['left', 'right']) assert.ok(g.posesFor(k, side).some(p => p.grasp === group), `${k}/${side}/${group}`);
    }
  } finally { g.setProceduralGrasps(false); }
  assert.equal(g.hasPoses('pole') || g.hasPoses('barrel'), false, 'pole and barrel have no grasp rows by default');
  assert.equal(g.twoHandSpec('bottle_beer'), null);
  assert.equal(g.isTwoHanded('can'), false);
});
