import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import DATA from '../../extensions/grasp/recorded_grasps.json' with { type: 'json' };
import * as source from '../../extensions/grasp/baked_grasps.js';
import * as vendored from '../src/vendor/extensions/grasp/baked_grasps.js';
import { recordedPoses, isPose, RECORDED_SCHEMA } from '../../extensions/grasp/record.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('canonical recordings preserve historical raw/filtered values and public mutability', () => {
  assert.equal(hash(DATA), 'b9ed8bd4183e02ab9250af7248bda0ff443812dcae4416810a7092d2cb32f913');
  assert.equal(DATA.poses.length, 10);
  for (const api of [source, vendored]) {
    assert.equal(hash(api.RECORDED), '6f49faf9cd2b74a246db907bb8347a49f1310beef6b90cad9980e229905c4e89');
    assert.deepEqual(api.RECORDED, recordedPoses(DATA));
    assert.equal(Object.isFrozen(api.RECORDED), true);
    assert.equal(Object.isFrozen(api.RECORDED[0]), false);
    assert.equal(api.RECORDED[0].angles[0][4], -47.32, 'raw recording keeps thumb twist beyond HARD bounds');
  }
});

test('JS recording filter drops malformed geometry without silently changing metadata or duplicate behavior', () => {
  const valid = DATA.poses[0], invalid = { ...valid, quat: [0, 0, 0, 2] };
  const metadataOnly = { ...valid, recorded: { source: false }, default: 'yes' };
  assert.equal(isPose(metadataOnly), true, 'JS structural filter does not validate recording metadata');
  const mixed = { schema: RECORDED_SCHEMA, poses: [valid, invalid, null, metadataOnly, valid] };
  assert.deepEqual(recordedPoses(mixed), [valid, metadataOnly, valid], 'filter preserves order and duplicate ids');
  assert.deepEqual(recordedPoses({ poses: [valid] }), [valid], 'legacy schema omission remains accepted in JS');
  assert.deepEqual(recordedPoses({ schema: 'wrong', poses: [valid] }), []);
});

test('recorded variants preserve baked opt-in behavior and preferred record selection', () => {
  const preferred = 'bottle_beer/right/body/rec-20261010T195613';
  for (const api of [source, vendored]) {
    const original = api.graspVariantSelection();
    try {
      api.setGraspVariants('baked');
      assert.equal(api.defaultPose('bottle_beer', 'right', 'body').id, 'bottle_beer/right/body/o+0.0000_r000_t+1');
      assert.equal(api.poseById(preferred), api.RECORDED.find(pose => pose.id === preferred), 'recording remains discoverable before opt-in');
      api.setGraspVariants('recorded');
      assert.equal(api.defaultPose('bottle_beer', 'right', 'body').id, preferred);
      assert.equal(api.defaultPose('bottle_beer', 'left', 'body').id, 'bottle_beer/left/body/rec-20261010T195613-m');
    } finally { api.setGraspVariants(original); }
  }
});
