import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import DATA from '../../extensions/grasp/data/held_drive.data.json' with { type: 'json' };
import * as source from '../../extensions/grasp/held_drive.js';
import * as vendored from '../src/vendor/extensions/grasp/held_drive.js';

test('held-drive data preserves all pre-extraction public scalar constants across sync', () => {
  const names = ['STIFFNESS', 'DAMPING', 'MAX_ACCELERATION', 'MAX_TORQUE', 'MAX_HOLD_FORCE', 'HAND_MOTION_SAMPLES'];
  const values = Object.fromEntries(names.map(name => [name, source[name]]));
  assert.deepEqual(DATA, { schema: 'gamesystems.grasp-held-drive-data.v1', ...values });
  // Captured from the original public exports before extracting the JS literals.
  assert.equal(createHash('sha256').update(JSON.stringify(values)).digest('hex'),
    'e6a6209cc88601adeb73c108ef7347322be8adaceeb2a640dfc612780958d0cd');
  for (const name of names) assert.equal(vendored[name], values[name], `${name} survives nested-data sync`);
});

test('held-drive acceleration and motion window preserve pre-extraction behavior', () => {
  const close = (actual, expected) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-12));
  for (const api of [source, vendored]) {
    assert.deepEqual([0, 1, 2, 100].map(api.accelerationLimit), [90, 90, 60, 1.2]);
    // Captured from the old module at dt = 1/72; these exercise both spring coefficients.
    close(api.driveAcceleration({ position: [1, 2, 3], velocity: [0.1, -0.2, 0.3],
      targetPosition: [1.02, 2.03, 3.01], targetVelocity: [0.4, 0.5, -0.2], mass: 2, dt: 1 / 72 }),
    [19.806228373702428, 48.550484429065754, -13.577854671280463]);
    close(api.driveAngular({ angularError: [0.01, -0.02, 0.03], angularVelocity: [0.1, 0.2, 0.3],
      targetSpin: [0.2, 0.1, 0], dt: 1 / 72 }), [7.474048442906575, -11.958477508650521, 4.484429065743945]);
    const motion = api.createHandMotion();
    api.pushHandMotion(motion, [2, 0, 0], [0, 1, 0], 1);
    api.pushHandMotion(motion, [4, 0, 0], [0, 2, 0], 3);
    api.pushHandMotion(motion, [10, 0, 0], [0, 6, 0], 1);
    assert.equal(motion.samples.length, 2);
    assert.deepEqual(motion.linear, [5.5, 0, 0]);
    assert.deepEqual(motion.angular, [0, 3, 0]);
  }
});
