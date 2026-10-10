// character-vrm (extensions plan step 6): the VRM provider behind the character contract, as synced into the demo.
//   - contract test with a fake three-vrm VRM (no model, no three-vrm): binding, character frame, poses, tiers, dispose
//   - the real CC0 test model (skipped until fetched: node ../extensions/character-vrm/fetch_model.mjs): three-vrm 3.5.5
//     loads it in node (textures stubbed), skeleton check (all fingers, no warnings), rest hand + thumb tilt, the avatar
//     extension poses it from a tracking record, the demo's grasp closes on its hand
//   - ?character=vrm selects the VRM provider (src/character-select.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createVRMCharacter, vrmCharacters, loadVRM, MODELS, DEFAULT_MODEL, modelURL, VRM_QUALITY } from '../src/vendor/extensions/character-vrm/index.js';
import { createCharacterPlugin, measureCharacter, restHand, THUMB_AXIS } from '../src/vendor/extensions/avatar/index.js';
import { JOINT_NAMES, LAYERS } from '../src/vendor/extensions/humanoid/index.js';
import { handGeometry, closeToContact, chainGaps, defaultPose, CATALOG } from '../src/vendor/extensions/grasp/index.js';
import { characterChoice, ccCharacters } from '../src/character-select.js';

const files = dir => readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name).sort();
test('character-vrm: the demo copy is GameSystems/extensions/character-vrm', () => {
  const a = fileURLToPath(new URL('../src/vendor/extensions/character-vrm/', import.meta.url)), b = fileURLToPath(new URL('../../extensions/character-vrm/', import.meta.url));
  assert.deepEqual(files(a), files(b));
  for (const f of files(a)) assert.ok(readFileSync(new URL(f, `file:///${a.replace(/\\/g, '/')}`)).equals(readFileSync(new URL(f, `file:///${b.replace(/\\/g, '/')}`))), f);
});

// ---- fake VRM: a humanoid of THREE.Bones with VRM 1.0 names, built facing -Z like a VRM 0.x export ----
function fakeHeads() {
  const H = { hips: [0, 0.95, 0], spine: [0, 1.05, 0], chest: [0, 1.18, 0], upperChest: [0, 1.3, 0], neck: [0, 1.45, 0], head: [0, 1.55, 0] };
  for (const [s, x] of [['left', 1], ['right', -1]]) {
    Object.assign(H, { [`${s}Shoulder`]: [0.03 * x, 1.4, 0], [`${s}UpperArm`]: [0.17 * x, 1.4, 0], [`${s}LowerArm`]: [0.45 * x, 1.4, 0], [`${s}Hand`]: [0.7 * x, 1.4, 0],
      [`${s}UpperLeg`]: [0.09 * x, 0.92, 0], [`${s}LowerLeg`]: [0.09 * x, 0.5, 0], [`${s}Foot`]: [0.09 * x, 0.08, 0], [`${s}Toes`]: [0.09 * x, 0.02, 0.12] });
    const knuckle = { Index: 0.025, Middle: 0.005, Ring: -0.015, Little: -0.033 };
    for (const [f, z] of Object.entries(knuckle)) ['Proximal', 'Intermediate', 'Distal'].forEach((g, k) => { H[`${s}${f}${g}`] = [(0.79 + 0.04 * k) * x, 1.4, z]; });
    ['Metacarpal', 'Proximal', 'Distal'].forEach((g, k) => { H[`${s}Thumb${g}`] = [(0.72 + 0.03 * k) * x, 1.39, 0.03 + 0.02 * k]; });
  }
  return H;
}
function fakeVRM({ metaVersion = '0', fingers = true } = {}) {
  const heads = fakeHeads(), bones = {}, scene = new THREE.Group();
  const vrm0 = metaVersion === '0', toFile = p => (vrm0 ? [-p[0], p[1], -p[2]] : p); // a VRM 0.x file faces -Z
  const parentOf = { spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck' };
  for (const s of ['left', 'right']) {
    Object.assign(parentOf, { [`${s}Shoulder`]: 'upperChest', [`${s}UpperArm`]: `${s}Shoulder`, [`${s}LowerArm`]: `${s}UpperArm`, [`${s}Hand`]: `${s}LowerArm`,
      [`${s}UpperLeg`]: 'hips', [`${s}LowerLeg`]: `${s}UpperLeg`, [`${s}Foot`]: `${s}LowerLeg`, [`${s}Toes`]: `${s}Foot` });
    for (const f of ['Index', 'Middle', 'Ring', 'Little']) Object.assign(parentOf, { [`${s}${f}Proximal`]: `${s}Hand`, [`${s}${f}Intermediate`]: `${s}${f}Proximal`, [`${s}${f}Distal`]: `${s}${f}Intermediate` });
    Object.assign(parentOf, { [`${s}ThumbMetacarpal`]: `${s}Hand`, [`${s}ThumbProximal`]: `${s}ThumbMetacarpal`, [`${s}ThumbDistal`]: `${s}ThumbProximal` });
  }
  for (const j of Object.keys(heads)) {
    if (!fingers && /(Thumb|Index|Middle|Ring|Little)/.test(j)) continue;
    const b = new THREE.Bone(); b.name = `bone_${j}`; bones[j] = b;
  }
  for (const [j, b] of Object.entries(bones)) {
    const p = parentOf[j], w = toFile(heads[j]), pw = p ? toFile(heads[p]) : [0, 0, 0];
    b.position.set(w[0] - pw[0], w[1] - pw[1], w[2] - pw[2]);
    (p ? bones[p] : scene).add(b);
  }
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  scene.add(mesh); scene.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(Object.values(bones)));
  let springResets = 0;
  return {
    bones, scene, meta: { metaVersion },
    humanoid: { autoUpdateHumanBones: true, getRawBoneNode: name => bones[name] ?? null },
    springBoneManager: { reset: () => springResets++, update() {} },
    get springResets() { return springResets; },
  };
}

test('VRM 0.x and 1.0 bind every canonical joint in the contract\'s frame (+X left, +Z forward)', () => {
  for (const metaVersion of ['0', '1']) {
    const c = createVRMCharacter(fakeVRM({ metaVersion }));
    assert.equal(c.version, metaVersion === '0' ? 0 : 1);
    assert.deepEqual(c.humanoid.missing, [], `${metaVersion}: all ${JOINT_NAMES.length} joints bound`);
    const H = c.restHeads(), ref = fakeHeads();
    for (const j of ['head', 'leftHand', 'rightToes', 'leftIndexDistal', 'rightThumbProximal']) {
      assert.ok(H[j].every((v, i) => Math.abs(v - ref[j][i]) < 1e-9), `${metaVersion}: ${j} ${H[j]} vs ${ref[j]}`);
    }
    assert.ok(H.leftHand[0] > 0 && H.leftToes[2] > H.leftFoot[2], 'left is +X, toes point +Z');
    assert.equal(c.vrm.humanoid.autoUpdateHumanBones, false, 'three-vrm must not overwrite the raw bones');
    assert.equal(c.skeleton.fingers, 'full'); assert.deepEqual(c.skeleton.warnings, []);
    assert.ok(c.capabilities.fingers);
  }
});

test('contract: keys, applyPose/resetPose on the raw bones, first person, tiers, dispose', () => {
  const vrm = fakeVRM(), c = createVRMCharacter(vrm, { quality: 'low' });
  for (const k of ['root', 'meshes', 'humanoid', 'headBone', 'capabilities', 'quality', 'restHeads', 'applyPose', 'resetPose', 'dispose']) assert.ok(k in c, k);
  assert.deepEqual(c.quality, VRM_QUALITY); assert.equal(c.tier, 'low');
  assert.equal(c.headBone, vrm.bones.head);
  const rest = vrm.bones.leftLowerArm.quaternion.clone();
  const bend = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1).toArray();
  c.applyPose({ joints: { leftLowerArm: bend }, root: [0, 0, 0] });
  assert.ok(vrm.bones.leftLowerArm.quaternion.angleTo(rest) > 0.99, 'pose written to the raw bone');
  // the elbow bend in the character frame swings the hand about +Y: the hand moves in the character's XZ plane
  c.root.updateMatrixWorld(true);
  const hand = vrm.bones.leftHand.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(hand.y - 1.4) < 1e-6 && hand.z < -0.1, `character-frame delta: hand ${hand.toArray()}`);
  c.resetPose();
  assert.ok(vrm.bones.leftLowerArm.quaternion.angleTo(rest) < 1e-9, 'rest restored exactly');
  c.setFirstPerson(true); assert.ok(vrm.bones.head.scale.x < 0.01); c.setFirstPerson(false); assert.equal(vrm.bones.head.scale.x, 1);
  assert.equal(c.setQuality('high'), 'high'); assert.equal(vrm.springResets, 1, 'springs restart when they come back');
  assert.equal(c.setQuality('nope'), 'high');
  c.tick(1 / 60);
  const parent = new THREE.Group(); parent.add(c.root);
  c.dispose(); assert.equal(c.root.parent, null); assert.ok(c.disposed);
  c.applyPose({ joints: { leftLowerArm: bend } }); assert.ok(vrm.bones.leftLowerArm.quaternion.angleTo(rest) < 1e-9, 'disposed: no-op');
});

test('a VRM without finger bones runs as a mitten hand with a warning', () => {
  const c = createVRMCharacter(fakeVRM({ fingers: false }));
  assert.equal(c.skeleton.fingers, 'none'); assert.ok(c.skeleton.mitten); assert.equal(c.capabilities.fingers, false);
  const rig = measureCharacter(c);
  assert.ok(rig.hands.left.mitten && restHand(rig, 'left').mitten);
});

test('?character=vrm selects the VRM provider, anything else the CharacterCreator one', () => {
  assert.equal(characterChoice('?character=vrm'), 'vrm');
  assert.equal(characterChoice('?character=cc'), 'cc'); assert.equal(characterChoice(''), 'cc'); assert.equal(characterChoice('?character=x'), 'cc');
  assert.equal(ccCharacters({ assetsURL: './avatar-assets/' }, '?character=vrm').id, 'vrm');
  assert.equal(ccCharacters({ assetsURL: './avatar-assets/' }, '').id, 'cc');
  assert.equal(modelURL('./vrm-assets/'), `./vrm-assets/${MODELS[DEFAULT_MODEL].file}`);
});

// ---- the real CC0 model ----
const modelFile = new URL(`../public/vrm-assets/${MODELS[DEFAULT_MODEL].file}`, import.meta.url);
const haveModel = existsSync(modelFile);
const skip = !haveModel && 'VRM test model not fetched: node ../extensions/character-vrm/fetch_model.mjs && npm run sync';
async function loadReal(options) {
  const buf = readFileSync(modelFile), loader = new GLTFLoader();
  // node has no image decoder: every texture is a blank THREE.Texture (geometry, skeleton and materials are real)
  loader.register(() => ({ name: 'test_stub_textures', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  return loadVRM(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), { loader, ...options });
}

test('real model: the synced file matches the pinned sha256 (CC0, official source)', { skip }, () => {
  const buf = readFileSync(modelFile), m = MODELS[DEFAULT_MODEL];
  assert.equal(buf.length, m.size); assert.equal(createHash('sha256').update(buf).digest('hex'), m.sha256);
  assert.equal(m.licence, 'CC0-1.0');
});

test('real model: three-vrm loads it, the skeleton check passes with full fingers, rest hand is usable', { skip }, async () => {
  const vrm = await loadReal();
  assert.equal(vrm.meta.metaVersion, '0'); assert.equal(vrm.meta.licenseName, 'CC0');
  const c = createVRMCharacter(vrm, { quality: 'low' });
  assert.deepEqual(c.humanoid.missing, [], 'every canonical joint (incl. 30 finger joints) bound');
  assert.equal(c.skeleton.fingers, 'full'); assert.deepEqual(c.skeleton.warnings, []);
  const H = c.restHeads();
  assert.ok(H.leftHand[0] > 0.3 && H.rightHand[0] < -0.3, 'left hand at +X (VRM 0.x turned to face +Z)');
  assert.ok(H.leftToes[2] > H.leftFoot[2] && H.head[1] > 1.1, 'toes forward, head up');
  const rig = measureCharacter(c);
  for (const side of ['left', 'right']) {
    const r = restHand(rig, side);
    assert.ok(!r.mitten && r.handLength > 0.2 && r.handLength < 0.3, `${side} hand length ${r.handLength}`);
    // The thumb tilt cannot be read from this rig (straight rest fingers, no flexion plane): the avatar's 60 deg stays.
    assert.equal(r.thumbTilt, THUMB_AXIS.tilt);
    const hand = handGeometry(r);
    assert.ok(hand.length > 0.2 && Object.values(hand.fingers).every(f => f.len.every(l => l > 0.005 && l < 0.08)), 'finger segments');
  }
  c.dispose();
});

test('real model: the avatar extension poses it from tracking, and the bottle grasp closes on its hand', { skip }, async () => {
  const scene = new THREE.Scene(), renderer = { xr: { getReferenceSpace: () => null } };
  const vrm = await loadReal();
  const characters = createCharacterPlugin({ scene, renderer, quality: 'arms', character: vrmCharacters({ url: 'test.vrm', load: async () => vrm }) });
  const player = await characters.createPlayer({ scale: 1.25 });
  assert.equal(player.character.id, 'vrm');
  const head = { pos: [0, 1.6, 0], quat: [0, 0, 0, 1] };
  const hand = (x, side) => ({ pos: [x, 1.1, -0.35], quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)).toArray(), valid: true, kind: 'controller', side });
  let result = null;
  for (let i = 0; i < 30; i++) result = player.updateTracking({ t: i / 72, head, hands: { left: hand(-0.2), right: hand(0.2) }, snaps: [], eyes: null, fingers: {} }, 1 / 72);
  assert.ok(result, 'solved');
  scene.updateMatrixWorld(true);
  const wrist = player.character.humanoid.bones.rightHand.getWorldPosition(new THREE.Vector3());
  assert.ok(wrist.toArray().every(Number.isFinite) && wrist.distanceTo(new THREE.Vector3(...hand(0.2).pos)) < 0.12, `right wrist follows the tracked hand: ${wrist.toArray()}`);
  const shown = player.character.root.getObjectByProperty('isSkinnedMesh', true);
  assert.ok(shown.layers.isEnabled(LAYERS.MAIN));
  // close-to-contact on this character's hand (no skin in node: the bone model must not go deep into the bottle)
  for (const side of ['left', 'right']) {
    const geo = handGeometry(player.restHand(side)), pose = defaultPose('bottle_beer', side, 'body') || defaultPose('bottle_beer', side);
    const closed = closeToContact(pose, geo, CATALOG.bottle_beer.shape);
    const gaps = chainGaps(geo, CATALOG.bottle_beer.shape, closed, closed.angles);
    const deepest = Math.min(...Object.values(gaps).map(g => g.min));
    assert.ok(deepest > -0.004, `${side}: deepest pad ${deepest * 1000} mm inside`);
    assert.ok(Object.values(closed.fingers).some(f => f.touching.length), `${side}: some finger touches`);
  }
  player.dispose(); characters.dispose();
  assert.ok(player.character.disposed);
});
