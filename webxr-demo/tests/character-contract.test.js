// The character contract (humanoid contract.js): validateCharacter() / assertCharacter(), every node-buildable provider
// passes it, and the avatar extension rejects a provider that does not implement it with a message naming the gaps.
// character-cc needs its model files and CharacterCreator: the browser smokes cover it (the avatar runs assertCharacter
// on every character it is handed).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { validateCharacter, assertCharacter, CHARACTER_REQUIRED, JOINT_NAMES } from '../src/vendor/extensions/humanoid/index.js';
import { createCharacterPlugin } from '../src/vendor/extensions/avatar/index.js';
import { createVRMCharacter, vrmCharacters } from '../src/vendor/extensions/character-vrm/index.js';
import { fakeHeads, fakeVRM } from './fake-vrm.js';

/** The smallest character that satisfies the contract (rig-only: no meshes, no skin). */
function minimal(heads = fakeHeads()) {
  const bones = Object.fromEntries(Object.keys(heads).map(k => [k, new THREE.Bone()]));
  return { root: new THREE.Group(), humanoid: { bones }, restHeads: () => heads, applyPose() {}, dispose() {} };
}

test('a minimal character passes; each missing required member is named', () => {
  assert.deepEqual(validateCharacter(minimal()), { ok: true, errors: [], warnings: [] });
  for (const key of CHARACTER_REQUIRED) {
    const c = minimal(); delete c[key];
    const { ok, errors } = validateCharacter(c);
    assert.equal(ok, false, key);
    assert.ok(errors.some(e => e.startsWith(key)), `${key}: ${errors}`);
  }
  assert.deepEqual(validateCharacter(null).ok, false);
  assert.ok(!validateCharacter({ ...minimal(), root: {} }).ok, 'root must be an Object3D');
});

test('optional members are type-checked only when present', () => {
  const bad = [
    { tick: 1 }, { setFirstPerson: 'yes' }, { onRestChange: {} }, { meshes: {} }, { capabilities: { fingers: 'all' } },
    { bodyShape: { male: 2, bust: 0 } }, { bodyShape: { male: 1 } }, { handProfile: 3 },
  ];
  for (const extra of bad) assert.equal(validateCharacter({ ...minimal(), ...extra }).ok, false, JSON.stringify(extra));
  const good = { meshes: [], capabilities: { fingers: true, eyes: false }, bodyShape: { male: 0.5, bust: 0.2 }, handProfile: [{ size: 1 }], tick() {}, eyeOffset: () => null };
  assert.equal(validateCharacter({ ...minimal(), ...good }).ok, true);
});

test('{ skeleton: true }: required joints missing is an error, missing fingers only a warning', () => {
  const heads = fakeHeads();
  assert.deepEqual(validateCharacter(minimal(heads), { skeleton: true }).warnings, []);
  const noFingers = Object.fromEntries(Object.entries(heads).filter(([j]) => !/(Thumb|Index|Middle|Ring|Little)/.test(j)));
  const mitten = validateCharacter(minimal(noFingers), { skeleton: true });
  assert.equal(mitten.ok, true); assert.ok(mitten.warnings.some(w => /mitten/.test(w)), mitten.warnings.join('; '));
  const { leftHand, ...noHand } = heads;
  const broken = validateCharacter(minimal(noHand), { skeleton: true });
  assert.equal(broken.ok, false); assert.match(broken.errors[0], /leftHand/);
  const throws = validateCharacter({ ...minimal(), restHeads() { throw new Error('not bound'); } }, { skeleton: true });
  assert.match(throws.errors[0], /restHeads\(\) threw: not bound/);
});

test('assertCharacter throws a TypeError listing every gap, and returns the character otherwise', () => {
  const c = minimal();
  assert.equal(assertCharacter(c), c);
  assert.throws(() => assertCharacter({ root: new THREE.Group() }, { label: 'my provider' }),
    e => e instanceof TypeError && /my provider/.test(e.message) && /humanoid/.test(e.message) && /applyPose/.test(e.message) && /dispose/.test(e.message));
});

test('character-vrm implements the contract (VRM 0.x and 1.0, with and without fingers)', () => {
  for (const metaVersion of ['0', '1']) for (const fingers of [true, false]) {
    const c = createVRMCharacter(fakeVRM({ metaVersion, fingers }));
    const r = validateCharacter(c, { skeleton: true });
    assert.deepEqual(r.errors, [], `${metaVersion}/${fingers}`);
    assert.equal(r.warnings.some(w => /mitten/.test(w)), !fingers);
    assert.equal(Object.keys(c.humanoid.bones).length > 0 && JOINT_NAMES.includes('leftHand'), true);
    c.dispose();
  }
});

test('the avatar extension rejects a provider whose character breaks the contract, and accepts any that keeps it', async () => {
  const scene = new THREE.Scene(), renderer = { xr: { getReferenceSpace: () => null } };
  const broken = createCharacterPlugin({ scene, renderer, quality: 'arms', character: { id: 'broken', create: async () => ({ root: new THREE.Group(), restHeads: fakeHeads }) } });
  await assert.rejects(broken.createPlayer(), e => e instanceof TypeError && /character provider broken/.test(e.message) && /applyPose/.test(e.message));
  broken.dispose();
  for (const provider of [{ id: 'minimal', create: async () => minimal() }, vrmCharacters({ url: 'test.vrm', load: async () => fakeVRM() })]) {
    const characters = createCharacterPlugin({ scene, renderer, quality: 'arms', character: provider });
    const player = await characters.createPlayer();
    assert.ok(player.rig && player.character, provider.id);
    player.dispose(); characters.dispose();
  }
});
