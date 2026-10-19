// Body height (avatar body_height.js, port of Nightfall Godot body_height.gd + automatic seated choice): stick crouch,
// seated offset, the first-calibration posture decision and standing up out of seated mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBodyHeight, MIN_EYE_HEIGHT, SEATED_OFFSET_MAX } from '../src/vendor/extensions/avatar/index.js';

const DT = 1 / 72, LEVEL = { pitch: 0, roll: 0 };
function run(body, seconds, eye, stick = null) {
  for (let t = 0; t < seconds; t += DT) { if (stick) body.update(stick, DT); body.observe(eye, DT, LEVEL); }
}
function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { data, get: k => data[k] ?? null, set: (k, v) => { data[k] = v; } };
}

test('a low first calibration picks seated mode and lifts the view to the standing reference', () => {
  const body = createBodyHeight(), events = [];
  body.onChange(e => events.push(e));
  run(body, 1, 1.15);
  assert.equal(body.decided, false, 'needs a calibration window first');
  run(body, 3, 1.15);
  assert.equal(body.decided, true); assert.equal(body.posture, 'seated');
  assert.equal(events.at(-1).posture, 'seated'); assert.equal(events.at(-1).referenceEye, 1.62);
  run(body, 1, 1.15); // offset slews at 1.5 m/s
  assert.ok(Math.abs(body.originOffset() - (1.62 - 1.15)) < 1e-9);
  assert.ok(Math.abs(body.effectiveEye() - 1.62) < 1e-9, 'a seated user sees from standing height');
});

test('a standing first calibration keeps standing, stores the eye and no offset', () => {
  const storage = memoryStorage(), body = createBodyHeight({ storage });
  run(body, 4, 1.71);
  assert.equal(body.posture, 'standing'); assert.equal(body.referenceEye, 1.71); assert.equal(body.originOffset(), 0);
  // the next session's seated reference is this stored standing eye
  const next = createBodyHeight({ storage });
  run(next, 5, 1.2);
  assert.equal(next.posture, 'seated'); assert.equal(next.referenceEye, 1.71);
  assert.ok(Math.abs(next.originOffset() - Math.min(SEATED_OFFSET_MAX, 1.71 - 1.2)) < 1e-9);
});

test('crouching and bobbing do not decide the posture; looking down is ignored', () => {
  const body = createBodyHeight();
  for (let t = 0; t < 5; t += DT) body.observe(1.0, DT, { pitch: -0.8, roll: 0 });
  assert.equal(body.decided, false);
});

test('standing up out of seated mode switches back to standing and re-measures', () => {
  const body = createBodyHeight();
  run(body, 4, 1.15); assert.equal(body.posture, 'seated');
  run(body, 2, 1.68);
  assert.equal(body.posture, 'standing'); assert.equal(body.decided, false);
  run(body, 4, 1.68);
  assert.equal(body.decided, true); assert.equal(body.posture, 'standing'); assert.equal(body.referenceEye, 1.68);
  run(body, 1, 1.68); assert.equal(body.originOffset(), 0);
});

test('a forced posture skips the automatic choice', () => {
  const standing = createBodyHeight({ posture: 'standing' });
  run(standing, 4, 1.15); assert.equal(standing.posture, 'standing');
  const seated = createBodyHeight({ posture: 'seated' });
  run(seated, 4, 1.15); run(seated, 3, 1.7);
  assert.equal(seated.posture, 'seated', 'a forced seat never stands up by itself');
});

test('right stick Y is an analog hold-height crouch that claims the stick and re-arms through the deadzone', () => {
  const body = createBodyHeight({ posture: 'standing' });
  run(body, 4, 1.6);
  assert.equal(body.update({ x: 0, y: 1 }, DT), false, 'a stick already held at start must not crouch');
  body.update({ x: 0, y: 0 }, DT);
  run(body, 0.5, 1.6, { x: 0, y: 1 });
  assert.ok(body.claimsStick); assert.ok(Math.abs(body.virtualCrouch - 0.6) < 0.02, `0.5 s at full deflection ~0.6 m, got ${body.virtualCrouch}`);
  run(body, 0.5, 1.6, { x: 0, y: 0 });
  assert.ok(Math.abs(body.virtualCrouch - 0.6) < 0.02, 'the height holds when released');
  run(body, 5, 1.6, { x: 0, y: 1 });
  assert.ok(Math.abs(body.effectiveEye() - MIN_EYE_HEIGHT) < 1e-9, 'never below the minimum eye');
  run(body, 0.3, 1.6, { x: 0, y: -1 });
  assert.ok(body.virtualCrouch < 1.05 - 0.3, 'stick up rises');
  body.update({ x: 1, y: 0.5 }, DT); assert.equal(body.claimsStick, false, 'a turn (x dominant) is not a crouch');
});

test('a blocked rise stops at the headroom and reports a low ceiling', () => {
  const body = createBodyHeight({ posture: 'standing' });
  run(body, 4, 1.6); body.update({ x: 0, y: 0 }, DT);
  run(body, 0.5, 1.6, { x: 0, y: 1 });
  const crouch = body.virtualCrouch;
  body.headroom = () => 0;
  run(body, 0.3, 1.6, { x: 0, y: -1 });
  assert.equal(body.virtualCrouch, crouch); assert.equal(body.hint, 'Low ceiling');
});

test('invalid input disarms; storage failures are harmless', () => {
  const broken = { get() { throw new Error('denied'); }, set() { throw new Error('quota'); } };
  const body = createBodyHeight({ storage: broken });
  run(body, 4, 1.7); assert.equal(body.posture, 'standing');
  body.update({ x: 0, y: 0 }, DT); body.update({ x: NaN, y: 1 }, DT);
  assert.equal(body.update({ x: 0, y: 1 }, DT), false);
  body.observe(NaN, DT, LEVEL); assert.equal(body.trackedEye, 1.7);
});
