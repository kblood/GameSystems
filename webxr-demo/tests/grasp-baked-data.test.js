import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import DATA from '../../extensions/grasp/baked_grasps.data.json' with { type: 'json' };
import * as source from '../../extensions/grasp/baked_grasps.js';
import * as vendored from '../src/vendor/extensions/grasp/baked_grasps.js';
import { CATALOG } from '../../extensions/grasp/catalog.js';

test('complete public bake preserves historical metadata, all pose records/order and mutable identity', () => {
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  assert.equal(source.BAKED, DATA);
  for (const api of [source, vendored]) {
    assert.equal(hash(api.BAKED), '6e253435445e2bcfe3117ad8714e2c93ad585a46e26da4822fefb64bd88d88af');
    assert.deepEqual(api.BAKED, DATA);
    assert.equal(api.BAKED.poses.length, 255);
    assert.equal(Object.isFrozen(api.BAKED), false);
    assert.equal(Object.isFrozen(api.BAKED.poses), false);
    const selection = api.graspVariantSelection();
    try {
      api.setGraspVariants('baked');
      assert.equal(api.POSES, api.BAKED.poses);
      for (const pose of api.BAKED.poses) {
        assert.equal(api.poseById(pose.id), pose);
        assert.equal(Object.isFrozen(pose), false);
      }
    } finally { api.setGraspVariants(selection); }
    const counts = {};
    for (const pose of api.BAKED.poses) counts[pose.kind] = (counts[pose.kind] ?? 0) + 1;
    assert.deepEqual(counts, { bottle_beer: 73, bottle_wine: 63, mug: 8, can: 37, carton: 40, magazine: 34 });
  }
});

test('bake keeps asset-specific records, contact sentinels and intentional raw/clamped behavior', () => {
  assert.equal(Object.hasOwn(CATALOG, 'magazine'), false);
  for (const api of [source, vendored]) {
    const quality = api.graspQuality();
    try {
      const mug = api.BAKED.poses.find(pose => pose.kind === 'mug');
      const magazine = api.BAKED.poses.find(pose => pose.kind === 'magazine');
      assert.ok(api.BAKED.poses.some(pose => pose.mode === 'pinch' && pose.metrics.palmGapMm === 1000));
      api.setGraspQuality('raw');
      assert.equal(api.runtimeRows(magazine), magazine);
      api.setGraspQuality('low');
      assert.equal(api.runtimeRows(mug), mug, 'mug remains clamp-exempt');
      assert.notEqual(api.runtimeRows(magazine), magazine);
      assert.deepEqual(api.runtimeRows(magazine).angles[0], [30, 10, 0, 70]);
      assert.deepEqual(magazine.angles[0], [70, 10, 0, 70], 'clamping does not rewrite the raw bake');
    } finally { api.setGraspQuality(quality); }
  }
});
