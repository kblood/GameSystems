// The demo pistol (pistol.js): the hip holster, drawing, firing, dropping and the return to the holster, and how
// Interaction drives it. The Interaction instance is built on the prototype with stubs, as in interaction-events.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPistol, GUN_PITCH_DEG, GUN_PITCH_GLB_DEG, GUN_PIVOT, heldGunLocal, parseGunPitch, LASER_RANGE, RETURN_SECONDS, HIP_DROP, HOLSTER_OFFSET } from '../src/pistol.js';
import { Interaction } from '../src/interaction.js';
import { createHost } from '../src/vendor/extensions/host/index.js';
import { createBodyHeight } from '../src/vendor/extensions/avatar/body_height.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
function wall(z = -3) { // a room surface facing +Z
  const m = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial()); m.position.z = z; m.updateMatrixWorld(true); return m;
}
function floor() { // y = 0, facing up
  const m = new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial()); m.updateMatrixWorld(true); return m;
}
function setup({ targets = [wall()], surfaces = [floor()], gunPitchDeg } = {}) {
  const scene = new THREE.Scene(), head = new THREE.PerspectiveCamera(), returned = [];
  head.position.set(0, 1.62, 0); scene.add(head); head.updateMatrixWorld(true);
  const pistol = createPistol({ scene, head, targets: () => targets, surfaces: () => surfaces, sound: () => {}, onReturn: () => returned.push(true), gunPitchDeg });
  return { scene, pistol, head, returned };
}
const run = (pistol, seconds, dt = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += dt) pistol.update(dt); };

test('the pistol starts holstered on the right hip and the holster follows the head', () => {
  const { pistol, head } = setup();
  assert.equal(pistol.state, 'holstered'); assert.equal(pistol.owner, null);
  const hip = pistol.holsterPoint();
  close(hip.x, HOLSTER_OFFSET[0]); close(hip.y, 1.62 - HIP_DROP); close(hip.z, HOLSTER_OFFSET[2]);
  assert.ok(pistol.gripPoint().distanceTo(hip) < 1e-6, 'the grip sits in the holster');
  assert.ok(pistol.ray().direction.y < -0.9, 'muzzle down');
  head.position.set(1, 1.2, 2); head.rotation.y = Math.PI / 2; head.updateMatrixWorld(true); // crouched and turned left
  run(pistol, 3);
  const turned = pistol.holsterPoint();
  close(turned.x, 1 + HOLSTER_OFFSET[2], 0.01); close(turned.z, 2 - HOLSTER_OFFSET[0], 0.01); // facing -X: right is -Z, back is +X
  close(turned.y, Math.max(1.2 - HIP_DROP, 1.2 * 0.45));
  assert.ok(pistol.gripPoint().distanceTo(turned) < 1e-6);
});

test('drawn into a grip with gunpitch 0, the muzzle points along the grip -Z; holster() puts it back', () => {
  const { scene, pistol } = setup({ gunPitchDeg: 0 }), grip = new THREE.Group();
  scene.add(grip);
  grip.position.set(0, 1.2, 0); grip.rotation.y = Math.PI / 2; grip.updateMatrixWorld(true);
  pistol.take(1, grip);
  assert.equal(pistol.owner, 1); assert.equal(pistol.state, 'held');
  const { origin, direction } = pistol.ray();
  close(direction.x, -1); close(direction.z, 0); // -Z of a grip turned 90° left points to -X
  assert.ok(origin.x < -0.15 && origin.y > 1.2, 'the muzzle is ahead of and above the fist');
  pistol.holster();
  assert.equal(pistol.owner, null); assert.equal(pistol.state, 'holstered');
  assert.equal(pistol.root.parent, scene);
  assert.ok(pistol.gripPoint().distanceTo(pistol.holsterPoint()) < 1e-6);
});

test('default pitch is 0 (legacy, identity to the grip); an override pitches the barrel about grip X and the whole gun with it', () => {
  assert.equal(GUN_PITCH_DEG, 0);
  const grip = new THREE.Group(), a = setup(); a.scene.add(grip); grip.position.set(0, 1.2, 0); grip.updateMatrixWorld(true);
  a.pistol.take(0, grip);
  assert.deepEqual(a.pistol.root.position.toArray(), [0, 0, 0]); assert.deepEqual(a.pistol.root.quaternion.toArray(), [0, 0, 0, 1]);
  for (const p of [-82, -15, 15]) {
    const { scene, pistol } = setup({ gunPitchDeg: p }), g = new THREE.Group(); scene.add(g); g.position.set(0, 1.2, 0); g.updateMatrixWorld(true);
    pistol.take(0, g);
    const t = p * Math.PI / 180, { direction } = pistol.ray();
    close(direction.y, Math.sin(t), 1e-9); close(direction.z, -Math.cos(t), 1e-9);
    const trig = new THREE.Vector3(0, 0.024, -0.034).applyMatrix4(new THREE.Matrix4().compose(pistol.root.position, pistol.root.quaternion, new THREE.Vector3(1, 1, 1)));
    if (p === GUN_PITCH_GLB_DEG) assert.ok(Math.hypot(trig.y + 0.031, trig.z + 0.0254) < 0.004, 'documented GLB-aligned pose puts the trigger on the controller trigger');
  }
  assert.ok(GUN_PIVOT.length === 3);
});

test('gunpitch parses finite degrees within 180 and 0 is the identity pose', () => {
  assert.equal(parseGunPitch('0'), 0); assert.equal(parseGunPitch('-30'), -30); assert.equal(parseGunPitch(''), null);
  assert.equal(parseGunPitch('x'), null); assert.equal(parseGunPitch('999'), null); assert.equal(parseGunPitch(null), null);
  assert.deepEqual(heldGunLocal(0), { position: [0, 0, 0], quaternion: [0, 0, 0, 1] });
});

test('the laser ends in a dot on the first surface along the barrel, and is off in the holster', () => {
  const { scene, pistol } = setup({ targets: [wall(-3)], gunPitchDeg: 0 }), grip = new THREE.Group(); scene.add(grip);
  grip.position.set(0, 1.2, 0); grip.updateMatrixWorld(true);
  pistol.take(0, grip); pistol.update(1 / 60);
  const beam = scene.getObjectByName('pistol-laser'), dot = scene.getObjectByName('pistol-laser-dot');
  assert.ok(beam.visible && dot.visible);
  close(dot.position.z, -3 + 0.002, 1e-4);
  assert.ok(beam.scale.z > 2.5 && beam.scale.z < 3, `beam length ${beam.scale.z}`);
  grip.rotation.y = Math.PI; grip.updateMatrixWorld(true); pistol.update(1 / 60); // pointing at nothing
  assert.equal(dot.visible, false); close(beam.scale.z, LASER_RANGE);
  pistol.holster(); pistol.update(1 / 60);
  assert.equal(beam.visible, false);
});

test('a miss leaves a bullet hole on the room; a hit handled by breakage does not', () => {
  const { scene, pistol } = setup({ targets: [wall(-3)], gunPitchDeg: 0 }), grip = new THREE.Group(); scene.add(grip);
  grip.position.set(0, 1.2, 0); grip.updateMatrixWorld(true); pistol.take(0, grip);
  const { origin, direction } = pistol.ray();
  assert.ok(pistol.fire(origin, direction, false));
  assert.equal(pistol.holes, 1);
  pistol.fire(origin, direction, true);
  assert.equal(pistol.holes, 1);
  assert.equal(pistol.shots, 2);
  assert.ok(pistol.firing, 'the trigger pose shows just after a shot');
  pistol.update(0.5); assert.equal(pistol.firing, false);
  pistol.reset(); assert.equal(pistol.holes, 0); assert.equal(pistol.state, 'holstered');
});

test(`a dropped pistol falls to the floor, lies there and is back in the holster after ${RETURN_SECONDS} s`, () => {
  const { scene, pistol, returned } = setup(), grip = new THREE.Group(); scene.add(grip);
  grip.position.set(0.5, 1.3, -0.6); grip.updateMatrixWorld(true);
  pistol.take(0, grip); pistol.update(1 / 60);
  pistol.drop(new THREE.Vector3(1, 0, 0));
  assert.equal(pistol.owner, null); assert.equal(pistol.state, 'falling');
  assert.equal(scene.getObjectByName('pistol-laser').visible, false);
  run(pistol, 2);
  assert.equal(pistol.state, 'dropped');
  const lying = pistol.gripPoint();
  close(lying.y, 0.016, 1e-3); assert.ok(lying.x > 0.7, `thrown along +X (${lying.x})`);
  close(new THREE.Vector3(1, 0, 0).applyQuaternion(pistol.root.quaternion).y, 1, 1e-6); // on its side: gun +X up
  close(pistol.returnIn, RETURN_SECONDS - 2, 0.05);
  run(pistol, RETURN_SECONDS - 2 - 0.5);
  assert.equal(pistol.state, 'dropped'); assert.equal(returned.length, 0);
  run(pistol, 0.6);
  assert.equal(pistol.state, 'holstered'); assert.equal(returned.length, 1);
  assert.ok(pistol.gripPoint().distanceTo(pistol.holsterPoint()) < 1e-6);
});

function rig(pistol) {
  const host = createHost({ onError: e => { throw e; } }), events = [];
  for (const e of ['pistol', 'shot']) host.on(e, d => events.push([e, d]));
  const it = Object.create(Interaction.prototype), shots = [];
  const controller = index => ({ index, pointer: new THREE.Object3D(), grip: new THREE.Group(), ray: new THREE.Object3D(), model: new THREE.Object3D(), handedness: index ? 'right' : 'left', isHand: false, lostFor: 0 });
  Object.assign(it, {
    host, pistol, held: new Map(), caps: new Map(), body: createBodyHeight({ posture: 'standing' }), bodyOffset: 0, tilt: 0, yaw: 0, pitch: 0, avatarModels: false,
    camera: new THREE.PerspectiveCamera(), rig: new THREE.Group(), uiTargets: [], raycaster: new THREE.Raycaster(), hud() {},
    renderer: { xr: { isPresenting: true, getSession: () => null } },
    physics: { release() {}, hold() {} },
    breakage: { shoot: (origin, direction) => { shots.push({ origin: origin.clone(), direction: direction.clone() }); return null; } },
    factory: { bottles: new Set() },
    xrControllers: [controller(0), controller(1)],
    _desktopMove() {}, _xrMove() {}, _updateBody() {},
  });
  return { it, events, shots };
}
const placeGrip = (c, p) => { c.grip.position.copy(p); c.grip.updateMatrixWorld(true); };

test('Interaction: a squeeze at the hip draws, the trigger fires along the barrel, letting go at the hip holsters', () => {
  const { scene, pistol } = setup();
  const { it, events, shots } = rig(pistol), right = it.xrControllers[1];
  scene.add(right.grip);
  placeGrip(right, pistol.holsterPoint().add(new THREE.Vector3(0, 0.3, 0)));
  it.toggleGrab(1); // too far
  assert.equal(pistol.owner, null);
  placeGrip(right, pistol.holsterPoint().add(new THREE.Vector3(0.05, 0.1, 0.05)));
  it.toggleGrab(1);
  assert.equal(pistol.owner, 1);
  assert.deepEqual(events[0], ['pistol', { owner: 1, held: true, side: 'right' }]);
  it.step(1 / 60);
  assert.equal(right.ray.visible, false, 'no pointer ray on the pistol hand');
  assert.equal(it.xrControllers[0].ray.visible, true);
  it.shoot(1);
  assert.equal(shots.length, 1);
  const barrel = pistol.ray();
  assert.ok(shots[0].origin.distanceTo(barrel.origin) < 1e-9 && shots[0].direction.angleTo(barrel.direction) < 1e-9, 'fired from the muzzle');
  assert.equal(events.at(-1)[0], 'shot'); assert.equal(events.at(-1)[1].pistol, true);
  it.toggleGrab(0); // the other hand cannot take a held pistol
  assert.equal(pistol.owner, 1);
  placeGrip(right, pistol.holsterPoint().add(new THREE.Vector3(0, 0.12, 0)));
  it.release(1);
  assert.equal(pistol.state, 'holstered');
  assert.deepEqual(events.at(-1), ['pistol', { owner: 1, held: false, state: 'holstered' }]);
});

test('Interaction: letting go away from the hip drops it with the hand velocity; it can be picked up again', () => {
  const { scene, pistol } = setup();
  const { it, events } = rig(pistol), right = it.xrControllers[1];
  scene.add(right.grip);
  placeGrip(right, pistol.holsterPoint()); it.toggleGrab(1);
  placeGrip(right, new THREE.Vector3(0.3, 1.3, -0.5)); it.step(1 / 60);
  placeGrip(right, new THREE.Vector3(0.32, 1.3, -0.5)); it.step(1 / 60); // 1.2 m/s along +X
  it.release(1);
  assert.equal(pistol.state, 'falling');
  assert.deepEqual(events.at(-1), ['pistol', { owner: 1, held: false, state: 'dropped' }]);
  for (let i = 0; i < 120; i++) it.step(1 / 60);
  assert.equal(pistol.state, 'dropped');
  const lying = pistol.gripPoint();
  assert.ok(lying.x > 0.4, `thrown along +X (${lying.x})`);
  placeGrip(right, lying.clone().add(new THREE.Vector3(0, 0.08, 0)));
  it.toggleGrab(1);
  assert.equal(pistol.owner, 1, 'picked up from the floor before it returns');
});

test('Interaction: lost tracking drops it still; releaseAll holsters', () => {
  const { scene, pistol } = setup();
  const { it } = rig(pistol), right = it.xrControllers[1];
  scene.add(right.grip); right.pointer.visible = false;
  placeGrip(right, pistol.holsterPoint()); it.toggleGrab(1);
  placeGrip(right, new THREE.Vector3(0.3, 1.3, -0.5));
  it._checkTracking(0.3);
  assert.equal(pistol.state, 'falling');
  pistol.holster(); it._takePistol(1); it.releaseAll();
  assert.equal(pistol.state, 'holstered');
});

test('Interaction: desktop Q draws and holsters; G on the held pistol holsters it', () => {
  const { pistol } = setup();
  const { it } = rig(pistol);
  it.renderer.xr.isPresenting = false;
  it.togglePistol('desktop');
  assert.equal(pistol.owner, 'desktop'); assert.equal(pistol.root.parent, it.camera);
  it.togglePistol('desktop');
  assert.equal(pistol.state, 'holstered');
  it.togglePistol('desktop'); it.toggleGrab('desktop');
  assert.equal(pistol.state, 'holstered', 'desktop never drops it');
});
