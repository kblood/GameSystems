import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import DATA from '../src/vendor/extensions/humanoid/bone_maps.data.json' with { type: 'json' };
import { JOINT_NAMES } from '../src/vendor/extensions/humanoid/canonical.js';
import { MPFB_GAME_ENGINE, MPFB_ROOT_BONE } from '../src/vendor/extensions/humanoid/rig.js';
import { VRM_HUMANOID, VRM0_HUMANOID, MIXAMO, mixamoBoneMap } from '../src/vendor/extensions/humanoid/bone_maps.js';

const LEGACY_MAP_SHA256 = {
  mpfb: 'c327fd58fc8ffd14449c364d551b851ae39c711a92ea1a5831a8c21a8d728fa1',
  vrm1: 'fffa8c81c1b2db901b73d4888dcf71464f167fd094bef797092289d32b9b7bfe',
  vrm0: 'c37dcb8bf4517528c18f2bfc4848b712b67172c6a8d5d8a85abfd3f885df3289',
  mixamo: '1804e83318ed1f0b1655810b840625ab4b0c52c01ebba9a69034a269a8b8c062',
};

test('humanoid bone maps are loaded from the shared JSON contract without changing JS exports', () => {
  assert.equal(DATA.schema, 'gamesystems.humanoid-bone-maps.v1');
  assert.equal(DATA.rootMotionBone, MPFB_ROOT_BONE);
  assert.deepEqual(DATA.jointNames, JOINT_NAMES);
  assert.deepEqual(MPFB_GAME_ENGINE, DATA.maps.mpfb);
  assert.deepEqual(VRM_HUMANOID, DATA.maps.vrm1);
  assert.deepEqual(VRM0_HUMANOID, DATA.maps.vrm0);
  assert.deepEqual(MIXAMO, Object.fromEntries(Object.entries(DATA.maps.mixamo).map(([joint, bone]) => [joint, `mixamorig:${bone}`])));
  assert.deepEqual(mixamoBoneMap(''), DATA.maps.mixamo);
  assert.deepEqual(mixamoBoneMap('mixamorig1:'), Object.fromEntries(
    Object.entries(DATA.maps.mixamo).map(([joint, bone]) => [joint, `mixamorig1:${bone}`]),
  ));
  for (const map of Object.values(DATA.maps)) {
    assert.deepEqual(Object.keys(map).sort(), [...JOINT_NAMES].sort());
    assert.ok(Object.values(map).every(bone => typeof bone === 'string' && bone.length > 0));
  }
  for (const [id, map] of Object.entries(DATA.maps)) {
    const stable = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    const digest = createHash('sha256').update(JSON.stringify(stable)).digest('hex');
    assert.equal(digest, LEGACY_MAP_SHA256[id], `${id} retains the prior map key/value golden`);
  }
});
