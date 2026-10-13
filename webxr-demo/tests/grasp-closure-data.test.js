import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import DATA from '../../extensions/grasp/data/closure.data.json' with { type: 'json' };
import { CLOSURE, PAD_RADIUS, REFERENCE_HAND, THUMB_TILT } from '../../extensions/grasp/closure.js';
import * as vendored from '../src/vendor/extensions/grasp/closure.js';

test('closure data preserves every pre-extraction public default and exact numeric precision', () => {
  assert.equal(DATA.schema, 'gamesystems.grasp-closure-data.v1');
  const values = { CLOSURE, PAD_RADIUS, REFERENCE_HAND, THUMB_TILT };
  assert.deepEqual(DATA, { schema: DATA.schema, ...values });
  // Captured from the original public exports before extracting JS literals to JSON.
  assert.equal(createHash('sha256').update(JSON.stringify(values)).digest('hex'),
    '796ff4f78c48aee1ae50707ce8d14af72ee1dec694b9c92406a9f5a26e93f967');
  assert.equal(THUMB_TILT, Math.PI / 3, 'radians retain the original IEEE-754 value');
  for (const [name, value] of Object.entries(values)) assert.deepEqual(vendored[name], value, `${name} survives nested-data sync`);
});

test('closure defaults preserve existing frozen and mutable API boundaries', () => {
  for (const api of [{ CLOSURE, PAD_RADIUS, REFERENCE_HAND }, vendored]) {
    assert.equal(Object.isFrozen(api.CLOSURE), true);
    assert.equal(Object.isFrozen(api.PAD_RADIUS), false);
    assert.equal(Object.isFrozen(api.PAD_RADIUS.Thumb), false);
    assert.equal(Object.isFrozen(api.REFERENCE_HAND), false);
    assert.equal(Object.isFrozen(api.REFERENCE_HAND.palm), false);
  }
});
