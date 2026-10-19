// Two-hand cap removal (bottles cap_gesture.js, port of Nightfall Godot bottle_cap.gd): twist + pull or a straight pull
// opens; sideways, tilt, push-in and tracking jumps cancel; an eccentric grip turning the cap is not withdrawal.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCapGesture, nearCap, TWIST_TO_LOOSEN } from '../src/vendor/extensions/bottles/index.js';

const CAP = [0, 0.30, 0], DT = 1 / 72;
// Hand pose for a cap turned by `twist` about the neck and lifted by `lift`, gripped `offset` from the cap centre.
function hand(twist = 0, lift = 0, offset = [0.03, 0.01, 0], extra = new THREE.Quaternion()) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), twist).multiply(extra);
  const pos = new THREE.Vector3(...offset).applyQuaternion(q).add(new THREE.Vector3(CAP[0], CAP[1] + lift, CAP[2]));
  return { pos: pos.toArray(), quat: q.toArray() };
}
function drive(g, from, to, steps = 30) {
  let s;
  for (let i = 1; i <= steps; i++) s = g.update(hand(...to(i / steps)), DT);
  return s;
}

test('a loosening twist plus a short pull opens; the eccentric grip orbit is not withdrawal', () => {
  const g = createCapGesture({ cap: CAP });
  g.begin(hand());
  let s = drive(g, null, k => [k * (TWIST_TO_LOOSEN + 0.1), 0]);
  assert.equal(s.status, 'active'); assert.ok(s.radial < 1e-6, `radial ${s.radial}`);
  assert.ok(g.preview().twist > 0.9);
  s = drive(g, null, k => [TWIST_TO_LOOSEN + 0.1, k * 0.02]);
  assert.equal(s.status, 'opened');
});

test('a cork opens with a straight pull, not with a short one', () => {
  const g = createCapGesture({ cap: CAP });
  g.begin(hand());
  assert.equal(drive(g, null, k => [0, k * 0.03]).status, 'active');
  assert.equal(drive(g, null, k => [0, 0.03 + k * 0.02]).status, 'opened');
});

test('tightening counts back, so twisting the wrong way never opens', () => {
  const g = createCapGesture({ cap: CAP });
  g.begin(hand());
  const s = drive(g, null, k => [-k * 1.2, k * 0.02]);
  assert.equal(s.status, 'active'); assert.ok(s.twist < 0);
});

test('sideways, tilt, push-in and a tracking jump cancel', () => {
  const sideways = createCapGesture({ cap: CAP }); sideways.begin(hand());
  assert.equal(drive(sideways, null, k => [0, 0, [0.03 + k * 0.05, 0.01, 0]]).reason, 'misaligned_or_withdrawn');
  const tilt = createCapGesture({ cap: CAP }); tilt.begin(hand(0, 0, [0, 0, 0]));
  assert.equal(drive(tilt, null, k => [0, 0, [0, 0, 0], new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), k * 1.3)]).reason, 'misaligned_or_withdrawn');
  const push = createCapGesture({ cap: CAP }); push.begin(hand());
  assert.equal(drive(push, null, k => [0, -k * 0.04]).reason, 'misaligned_or_withdrawn');
  const jump = createCapGesture({ cap: CAP }); jump.begin(hand());
  assert.equal(jump.update(hand(0, 0.2), DT).reason, 'tracking_discontinuity');
  const bad = createCapGesture({ cap: CAP }); bad.begin(hand());
  assert.equal(bad.update({ pos: [NaN, 0, 0], quat: [0, 0, 0, 1] }, DT).reason, 'invalid_intention');
  assert.deepEqual(bad.preview(), { twist: 0, lift: 0 });
});

test('the grip reach decides whether a squeeze takes the cap', () => {
  assert.ok(nearCap([0.04, 0.32, 0.02], CAP)); assert.ok(!nearCap([0.1, 0.2, 0], CAP));
});
