// Active ragdoll (extensions/hitreact, step 2; a port of the idea of NightfallContractsGodot active_ragdoll.gd): the
// pure body plan and math, then the real thing on the cannon adapter (extensions/adapters/physics-cannon.js, real
// cannon-es in node, no rendering) and the three.js layer on a stand-in character (an Object3D root, the real MakeHuman
// rest heads, applyPose recorded). Opt-in: with the default config no physics body is ever created.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { RAGDOLL_SEGMENTS, RAGDOLL_JOINTS, SHOT_IMPULSE, segmentForRegion, restSegments, segmentFrames, jointFrames, poseFromSegments, rotationError,
  muscleTorque, createDownedMonitor, createRagdollDriver, supportsRagdoll, capsuleShapes, resolveHitReactConfig, createHitReactor } from '../../extensions/hitreact/index.js';
import { headsFromSidecar, fkPositions, poseToWorld, qAxisAngle, qMul, qAngle, qRotate } from '../../extensions/humanoid/index.js';
import { createCannonPhysics } from '../src/vendor/extensions/adapters/physics-cannon.js';
import { createFakePhysics } from './fake-physics.js';

const H = headsFromSidecar(JSON.parse(readFileSync(new URL('../public/avatar-assets/base_body.joints.json', import.meta.url), 'utf8')));
const DT = 1 / 60;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const finiteDeep = v => typeof v === 'number' ? Number.isFinite(v) : Array.isArray(v) ? v.every(finiteDeep) : v && typeof v === 'object' ? Object.values(v).every(finiteDeep) : true;
const REST = { joints: {}, root: [0, 0, 0] };
const POSED = { joints: { spine: qAxisAngle([1, 0, 0], 0.2), leftUpperArm: qAxisAngle([0, 0, 1], -0.9), rightLowerArm: qAxisAngle([1, 0, 0], -0.6),
  leftUpperLeg: qAxisAngle([1, 0, 0], -0.3), leftLowerLeg: qAxisAngle([1, 0, 0], 0.5), head: qAxisAngle([0, 1, 0], 0.4) }, root: [0.05, -0.02, 0.1] };

function world() {
  const physics = createCannonPhysics(undefined, { allowSleep: false, friction: 0.6, restitution: 0 });
  physics.addBody({ type: 'box', size: [20, 0.2, 20] }, 0, { position: [0, -0.1, 0] }, { contacts: false });
  return physics;
}

test('body plan: 11 segments, 10 cone/twist joints, the 4.5 N·s shot (Nightfall active_ragdoll.gd)', () => {
  assert.equal(RAGDOLL_SEGMENTS.length, 11);
  assert.equal(RAGDOLL_JOINTS.length, 10);
  assert.equal(SHOT_IMPULSE, 4.5);
  assert.deepEqual(RAGDOLL_SEGMENTS.map(s => s.key).sort(), ['head', 'hips', 'leftLowerArm', 'leftLowerLeg', 'leftUpperArm', 'leftUpperLeg', 'rightLowerArm',
    'rightLowerLeg', 'rightUpperArm', 'rightUpperLeg', 'upperChest']);
  assert.equal(RAGDOLL_SEGMENTS.reduce((s, x) => s + x.mass, 0), 14 + 18 + 4 + 2 * (2.2 + 1.5 + 7 + 4));
  for (const j of RAGDOLL_JOINTS) assert.ok(j.cone > 0 && j.twist > 0 && j.torque > 0, j.child);
  assert.deepEqual(['cranium', 'leftHand', 'rightFoot', 'belly', 'chestLeft', 'rightUpperArm'].map(segmentForRegion), ['head', 'leftLowerArm', 'rightLowerLeg', 'hips', 'upperChest', 'rightUpperArm']);
  assert.equal(capsuleShapes(0.1, 0.18).length, 1, 'short segment: a sphere');
  assert.equal(capsuleShapes(0.06, 0.45).length, 3, 'capsule: cylinder + two spheres');
});

test('segment frames and back: the pose a ragdoll reads out is the pose it was built from', () => {
  const rest = restSegments(H);
  for (const pose of [REST, POSED]) {
    const frames = segmentFrames(H, pose, rest), back = poseFromSegments(H, frames, pose, rest);
    const W = poseToWorld(pose.joints), Wb = poseToWorld(back.joints);
    for (const s of RAGDOLL_SEGMENTS) assert.ok(qAngle(W[s.joint], Wb[s.joint]) < 1e-6, s.key);
    assert.ok(dist(back.root, pose.root) < 1e-6, 'root from the pelvis segment');
    // every segment centre lies between its joint head and tip in the posed skeleton
    const P = fkPositions(H, pose);
    assert.ok(dist(frames.leftLowerLeg.center, [(P.leftLowerLeg[0] + P.leftFoot[0]) / 2, (P.leftLowerLeg[1] + P.leftFoot[1]) / 2, (P.leftLowerLeg[2] + P.leftFoot[2]) / 2]) < 1e-6);
  }
  // joint pivots coincide in both bodies' frames
  const frames = segmentFrames(H, POSED, rest);
  for (const j of jointFrames(H, POSED, frames, rest)) {
    const a = frames[j.parent], b = frames[j.child];
    const pa = qRotate(a.quaternion, j.pivotA).map((v, i) => v + a.center[i]), pb = qRotate(b.quaternion, j.pivotB).map((v, i) => v + b.center[i]);
    assert.ok(dist(pa, pb) < 1e-6, `${j.child} pivot`);
  }
});

test('muscles: bounded PD torque toward the target; slack at zero frequency; error is the shortest rotation', () => {
  const q0 = [0, 0, 0, 1], q1 = qAxisAngle([0, 1, 0], 0.5);
  const e = rotationError(q0, q1); assert.ok(Math.abs(e[1] - 0.5) < 1e-9 && Math.abs(e[0]) < 1e-12);
  const t = muscleTorque(q0, q1, [0, 0, 0], 2, 1.5, 1, 1000); assert.ok(t[1] > 0);
  assert.ok(Math.abs(Math.hypot(...muscleTorque(q0, q1, [0, 0, 0], 50, 5, 1, 30)) - 30) < 1e-9, 'capped');
  assert.deepEqual(muscleTorque(q0, q1, [0, 0, 0], 2, 0, 1, 100), [0, 0, 0]);
  assert.ok(muscleTorque(q0, q0, [0, 3, 0], 2, 1.5, 1, 1000)[1] < 0, 'damps spin');
  const m = createDownedMonitor({ minDownedSeconds: 1, maxDownedSeconds: 3, settleSpeed: 0.2, settleSeconds: 0.5 });
  let n = 1; while (!m.update(0.1, 0.05)) n++; assert.ok(n >= 10 && n <= 11, `settled at the min time (${n} steps of 0.1 s)`);
  m.reset(); n = 1; while (!m.update(0.1, 5)) n++; assert.ok(n >= 30 && n <= 31, `max time while moving (${n} steps)`);
  m.reset(); n = 1; while (!m.update(0.1, n < 15 ? 5 : 0.05)) n++; assert.ok(n >= 19 && n <= 21, `settleSeconds after it stops (${n} steps)`);
});

test('adapter capability: the cannon adapter runs the ragdoll, the engine-free fake adapter does not', () => {
  assert.equal(supportsRagdoll(world()), true);
  assert.equal(supportsRagdoll(createFakePhysics()), false);
  assert.throws(() => createRagdollDriver(createFakePhysics(), resolveHitReactConfig().ragdoll), /lacks addJoint/);
});

test('cannon: a passive ragdoll stood up falls to the floor, joints hold together, a shot moves the hit segment', () => {
  const physics = world(), cfg = resolveHitReactConfig({ ragdoll: { enabled: true } }).ragdoll, rest = restSegments(H);
  const frames = segmentFrames(H, REST, rest), driver = createRagdollDriver(physics, cfg);
  driver.activate({ frames, joints: jointFrames(H, REST, frames, rest), rest, muscles: 0 });
  assert.equal(driver.bodies.size, 11); assert.equal(driver.jointCount, 10);
  // a shot on the head: 4.5 N·s on 4 kg
  driver.applyImpulse('head', [0, 0, -SHOT_IMPULSE], null);
  const head0 = driver.read().head.center;
  physics.step(DT);
  assert.ok(driver.read().head.center[2] < head0[2], 'the head is pushed back');
  let worstPivot = 0, finalPivot = 0;
  for (let i = 0; i < 300; i++) {
    physics.step(DT);
    const f = driver.read();
    for (const j of jointFrames(H, REST, frames, rest)) {
      const a = f[j.parent], b = f[j.child];
      const pa = qRotate(a.quaternion, j.pivotA).map((v, k) => v + a.center[k]), pb = qRotate(b.quaternion, j.pivotB).map((v, k) => v + b.center[k]);
      worstPivot = Math.max(worstPivot, dist(pa, pb));
      if (i === 299) finalPivot = Math.max(finalPivot, dist(pa, pb));
    }
  }
  const f = driver.read();
  assert.ok(finiteDeep(f));
  assert.ok(f.hips.center[1] < 0.35, `the pelvis is down (${f.hips.center[1].toFixed(3)} m)`);
  assert.ok(Object.values(f).every(s => s.center[1] > -0.05), 'nothing fell through the floor');
  assert.ok(worstPivot < 0.05, `joint pivots stay together through the landing (worst ${worstPivot.toFixed(3)} m)`);
  assert.ok(finalPivot < 0.01, `and close up at rest (${finalPivot.toFixed(4)} m)`);
  assert.ok(driver.maxSpeed() < 0.3, `settled after 5 s (${driver.maxSpeed().toFixed(3)} m/s)`);
  const pose = poseFromSegments(H, f, REST, rest);
  assert.ok(finiteDeep(pose) && pose.root[1] < -0.4, 'the read-back pose lies low');
  driver.deactivate();
  assert.equal(physics.world.bodies.length, 1, 'only the floor is left');
  assert.equal(physics.world.constraints.length, 0);
});

test('cannon: severed limbs are not built', () => {
  const physics = world(), cfg = resolveHitReactConfig({ ragdoll: { enabled: true } }).ragdoll, rest = restSegments(H);
  const frames = segmentFrames(H, REST, rest), driver = createRagdollDriver(physics, cfg);
  driver.activate({ frames, joints: jointFrames(H, REST, frames, rest), rest, skip: new Set(['leftUpperLeg', 'leftLowerLeg']) });
  assert.equal(driver.bodies.size, 9); assert.equal(driver.jointCount, 8);
  driver.deactivate();
});

// ---- the three.js layer on a stand-in character
function character() {
  const parent = new THREE.Object3D(); parent.position.set(1, 0, -2); parent.rotation.y = 0.6;
  const root = new THREE.Object3D(); parent.add(root); parent.updateMatrixWorld(true);
  const applied = [];
  return { root, parent, applied, restHeads: () => H, applyPose: pose => applied.push(pose) };
}
function drive(reactor, ch, seconds, onFrame) {
  let r;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    ch.root.position.set(0, 0, 0);                              // the animator places the root each frame
    reactor.physics?.step(DT);
    r = reactor.update(DT, REST); onFrame?.(r, i);
  }
  return r;
}

test('three layer, default config: hits push the bones and move the root; downed uses the IK knockdown, no physics bodies', () => {
  const ch = character(), physics = world();
  const reactor = createHitReactor(THREE, { character: ch, physics });
  assert.equal(reactor.ragdollEnabled, false, 'opt-in: off by default');
  const chest = new THREE.Vector3(...fkPositions(H, REST).upperChest); ch.root.localToWorld(chest);
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(ch.parent.quaternion);       // pushed backward in the character frame
  reactor.hit({ region: 'chest', point: chest, direction: dir, impulse: 2.7 });
  let minZ = 0, states = [];
  drive(Object.assign(reactor, { physics }), ch, 1, r => { minZ = Math.min(minZ, ch.root.position.clone().applyQuaternion(ch.root.quaternion).z); states.push(...r.events.map(e => e.to)); });
  assert.ok(minZ < -0.005, `the root moved back in the character frame (${minZ})`);
  assert.ok(ch.applied.length > 0 && finiteDeep(ch.applied.at(-1).joints));
  assert.deepEqual(states, ['destabilized', 'standing']);
  reactor.hit({ region: 'chest', point: chest, direction: dir, impulse: 40 });
  const r = drive(reactor, ch, 0.5);
  assert.equal(r.state, 'downed'); assert.equal(r.ragdoll, false);
  assert.equal(physics.world.bodies.length, 1, 'no ragdoll bodies with the default config');
});

test('three layer, ragdoll on: downed hands the body to physics, it settles, recovers by blending back and frees the bodies; dead is a passive corpse', () => {
  const ch = character(), physics = world();
  const reactor = Object.assign(createHitReactor(THREE, { character: ch, physics, config: { ragdoll: { enabled: true } } }), { physics });
  assert.equal(reactor.ragdollEnabled, true);
  const chest = new THREE.Vector3(...fkPositions(H, REST).upperChest); ch.root.localToWorld(chest);
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(ch.parent.quaternion);
  reactor.hit({ region: 'chest', point: chest, direction: dir, impulse: 2.7 });
  drive(reactor, ch, 0.2);
  assert.equal(physics.world.bodies.length, 1, 'destabilized: still the IK reaction, no bodies');
  reactor.hit({ region: 'chest', point: chest, direction: dir, impulse: 40 });
  const events = [], lows = [];
  let sawRagdoll = false, sawBlend = false;
  const end = drive(reactor, ch, 7, r => {
    events.push(...r.events.map(e => `${e.from}->${e.to}`));
    if (r.ragdoll) { sawRagdoll = true; lows.push(fkPositions(H, r.pose).hips[1]); }
    if (r.blend > 0) sawBlend = true;
  });
  assert.ok(sawRagdoll, 'the ragdoll owned the body while downed');
  assert.equal(physics.world.bodies.length, 1, 'bodies freed after recovering');
  assert.ok(Math.min(...lows) < 0.45, `the body fell (lowest pelvis ${Math.min(...lows).toFixed(2)} m)`);
  assert.ok(sawBlend, 'recovering blends back');
  assert.deepEqual(events, ['destabilized->downed', 'downed->recovering', 'recovering->standing']);
  assert.equal(end.state, 'standing');
  const back = poseToWorld(ch.applied.at(-1).joints);
  assert.ok(qAngle(back.spine, [0, 0, 0, 1]) < 0.02, 'back on the animated pose');
  const recenter = reactor.takeRecenter(); assert.equal(recenter, null, 'taken only during the blend');
  // dead: passive corpse that stays
  reactor.kill();
  drive(reactor, ch, 2);
  assert.equal(reactor.state, 'inert'); assert.equal(reactor.ragdollActive, true);
  assert.equal(physics.world.bodies.length, 12);
  reactor.reset(); assert.equal(physics.world.bodies.length, 1);
  reactor.dispose();
});

test('three layer: the ragdoll needs an adapter with the capability (enabled + fake adapter = IK only)', () => {
  const ch = character();
  const reactor = createHitReactor(THREE, { character: ch, physics: createFakePhysics(), config: { ragdoll: { enabled: true } } });
  assert.equal(reactor.ragdollEnabled, false);
  assert.throws(() => createHitReactor(THREE, { character: {} }), /humanoid contract/);
});
