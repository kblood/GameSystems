import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSkeleton, completeHands } from '../src/vendor/extensions/humanoid/index.js';

test('skeleton validation rejects malformed points and completes a true mitten chain', () => {
  const malformed = [[], [1], [0, 0], [0, 0, 0, 1], [NaN, 0, 0], [0, Infinity, 0]];
  for (const bad of malformed) {
    const heads = {
      hips: [], leftHand: [0, 0, 0], leftLowerArm: [0, 0, -0.25],
      leftIndexProximal: [...bad], leftMiddleProximal: [...bad], leftLittleProximal: [...bad],
    };
    const report = checkSkeleton(heads);
    assert.ok(report.missing.includes('hips'), `hips ${JSON.stringify(bad)}`);
    assert.equal(report.hands.left.mitten, true, `mitten ${JSON.stringify(bad)}`);
    const completed = completeHands(heads, report);
    for (const id of ['leftIndexProximal', 'leftMiddleProximal', 'leftLittleProximal']) {
      assert.ok(completed.synthetic.includes(id), `${id} repaired for ${String(bad)}`);
      assert.equal(completed.heads[id].length, 3);
      assert.ok(completed.heads[id].every(Number.isFinite));
    }
  }
});

test('mitten completion does not synthesize coordinates from malformed wrist or forearm anchors', () => {
  for (const [hand, lowerArm] of [
    [[], [0, 0, -0.25]], [[0, 0], [0, 0, -0.25]], [[NaN, 0, 0], [0, 0, -0.25]],
    [[0, 0, 0], []], [[0, 0, 0], [0, 0]], [[0, 0, 0], [0, Infinity, 0]],
  ]) {
    const heads = { leftHand: hand, leftLowerArm: lowerArm };
    const report = checkSkeleton(heads); assert.equal(report.hands.left.mitten, true);
    const completed = completeHands(heads, report);
    assert.deepEqual(completed.synthetic, []);
    assert.equal(completed.heads.leftHand, hand); assert.equal(completed.heads.leftLowerArm, lowerArm);
  }
});
