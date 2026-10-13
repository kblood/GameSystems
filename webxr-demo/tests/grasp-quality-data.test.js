import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import DATA from '../../extensions/grasp/data/quality.data.json' with { type: 'json' };
import * as source from '../../extensions/grasp/baked_grasps.js';
import * as vendored from '../src/vendor/extensions/grasp/baked_grasps.js';
import { referenceHand } from '../../extensions/grasp/record.js';

const initial = [source.graspQuality(), vendored.graspQuality()];

test('quality contract preserves historical public/private policy values and frozen arrays', () => {
  const { schema, ...policy } = DATA;
  assert.equal(schema, 'gamesystems.grasp-quality-data.v1');
  // Captured before extraction: exports/default/alias via API, exemptKeep from the private literal.
  assert.equal(createHash('sha256').update(JSON.stringify(policy)).digest('hex'),
    'bc06fbb148ce15e132fa086065ab8a0973944f77d517608241ccdf2662055006');
  assert.deepEqual(initial, ['mid', 'mid']);
  for (const api of [source, vendored]) {
    assert.deepEqual(api.GRASP_QUALITY, ['raw', 'low', 'mid', 'high']);
    assert.deepEqual(api.CLAMP_EXEMPT, ['mug']);
    assert.equal(Object.isFrozen(api.GRASP_QUALITY), true);
    assert.equal(Object.isFrozen(api.CLAMP_EXEMPT), true);
  }
});

test('quality selection, aliases and exemption behavior remain unchanged after extraction', () => {
  for (const api of [source, vendored]) {
    const previous = api.graspQuality();
    try {
      for (const level of api.GRASP_QUALITY) {
        assert.equal(api.setGraspQuality(level), level);
        assert.equal(api.graspQuality(), level);
      }
      assert.equal(api.setGraspQuality('clamped'), 'low');
      assert.throws(() => api.setGraspQuality('unknown'), RangeError);
      assert.equal(api.graspQuality(), 'low', 'invalid selection does not mutate state');
      const mug = api.BAKED.poses.find(pose => pose.kind === 'mug' && pose.side === 'right');
      assert.equal(api.runtimeRows(mug), mug, 'low keeps exempt kind raw');
      api.setGraspQuality('mid');
      const fitted = api.graspPose(mug, referenceHand('right'));
      assert.deepEqual(fitted.angles[0], mug.angles[0], 'private exemptKeep preserves raw thumb during closure');
      const magazine = api.BAKED.poses.find(pose => pose.kind === 'magazine');
      api.setGraspQuality('raw');
      assert.equal(api.runtimeRows(magazine), magazine);
      api.setGraspQuality('low');
      assert.deepEqual(api.runtimeRows(magazine).angles[0], [30, 10, 0, 70]);
    } finally { api.setGraspQuality(previous); }
  }
});
