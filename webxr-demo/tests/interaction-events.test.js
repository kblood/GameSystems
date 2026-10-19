// Core interaction: events for the extension host and the fixes for grab_findings 1.1, 1.2, 1.6 and 1.9.
// The Interaction constructor binds DOM/XR input, so these tests build an instance on the prototype with stubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Interaction, tiltAboutGrip, DESKTOP_EYE, LOST_RELEASE_SECONDS } from '../src/interaction.js';
import { createHost } from '../src/vendor/extensions/host/index.js';
import { createBodyHeight } from '../src/vendor/extensions/avatar/body_height.js';

function rig({ avatar = null } = {}) {
  const host = createHost({ onError: e => { throw e; } }), events = [];
  for (const e of ['grab', 'release', 'broken', 'disconnect', 'handTrackingChanged']) host.on(e, d => events.push([e, d]));
  const released = [];
  const it = Object.create(Interaction.prototype);
  const controller = () => ({ pointer: new THREE.Object3D(), model: new THREE.Object3D(), handedness: 'right', isHand: false, lostFor: 0 });
  Object.assign(it, {
    host, held: new Map(), caps: new Map(), body: createBodyHeight({ posture: 'standing' }), bodyOffset: 0, tilt: 0, yaw: 0, pitch: 0, avatarModels: false,
    camera: new THREE.PerspectiveCamera(), rig: new THREE.Group(),
    renderer: { xr: { isPresenting: true, getSession: () => null } },
    physics: { release: (entry, velocity) => released.push({ entry, velocity: velocity.clone() }), hold() {} },
    factory: { bottles: new Set() },
    xrControllers: [controller(), controller()],
    _desktopMove() {}, _xrMove() {},
  });
  if (avatar) host.load({ id: 'avatar', init: () => avatar });
  return { it, host, events, released };
}
const bottle = (id = 'b') => ({ id, height: 0.25, root: new THREE.Object3D(), entry: { id } });
function hold(it, owner, b) {
  it.factory.bottles.add(b);
  it.held.set(owner, { bottle: b, last: new THREE.Vector3(), velocity: new THREE.Vector3(3, 0, 0) });
}

test('1.1: a bottle that breaks in the hand is dropped and every hand gets a release event', () => {
  const { it, events, released } = rig(), b = bottle(), other = bottle('other');
  hold(it, 0, b); hold(it, 'desktop', other);
  it.dropBottle(b);
  assert.ok(!it.held.has(0) && it.held.has('desktop'));
  assert.deepEqual(events, [['release', { owner: 0, bottle: b }]]);
  assert.equal(released.length, 0, 'no physics release for a body that is being removed');
  // A bottle removed some other way (reset, factory.remove) is dropped by step() through the same path.
  it.factory.bottles.delete(other);
  it.renderer.xr.isPresenting = false;
  it.step(0.016);
  assert.deepEqual(events.at(-1), ['release', { owner: 'desktop', bottle: other }]);
  assert.equal(it.held.size, 0);
});

test('1.2: disconnect drops the held bottle in place and tells extensions', () => {
  const { it, events, released } = rig(), b = bottle();
  hold(it, 1, b);
  it._onDisconnected(1);
  assert.equal(it.held.size, 0);
  assert.equal(released.length, 1);
  assert.equal(released[0].velocity.length(), 0, 'dropped still, not thrown with the stale hand velocity');
  assert.deepEqual(events.map(e => e[0]), ['release', 'disconnect']);
  assert.deepEqual(events[1][1], { owner: 1, handedness: 'right' });
  assert.equal(it.xrControllers[1].handedness, null);
});

test('1.2: an XR hold is released after tracking has been lost for a moment', () => {
  const { it, released } = rig(), b = bottle();
  hold(it, 0, b);
  it.xrControllers[0].pointer.visible = false;
  it._checkTracking(LOST_RELEASE_SECONDS * 0.6);
  assert.ok(it.held.has(0), 'short dropouts are tolerated');
  it.xrControllers[0].pointer.visible = true; it._checkTracking(0.01);
  it.xrControllers[0].pointer.visible = false; it._checkTracking(LOST_RELEASE_SECONDS * 0.6);
  assert.ok(it.held.has(0), 'the timer restarts when tracking returns');
  it._checkTracking(LOST_RELEASE_SECONDS * 0.6);
  assert.ok(!it.held.has(0));
  assert.equal(released[0].velocity.length(), 0);
});

test('grab events carry the side; the controller models follow whether the avatar is active', () => {
  const api = { active: true };
  const { it, events } = rig({ avatar: api }), b = bottle();
  return new Promise(r => setTimeout(r, 0)).then(() => {
    it.pick = () => ({ object: { userData: { bottle: b } } });
    it.hud = () => {};
    it.toggleGrab(0);
    assert.deepEqual(events[0], ['grab', { owner: 0, bottle: b, side: 'right' }]);
    it.held.clear();
    it.renderer.xr.isPresenting = false;
    it.step(0);
    assert.equal(it.xrControllers[0].model.visible, false);
    api.active = false; // quality tier 'off'
    it.step(0);
    assert.equal(it.xrControllers[0].model.visible, true);
    assert.equal(it.avatar, null);
  });
});

test('handTrackingChanged is sent when an input source switches between controller and hand', () => {
  const { it, events } = rig();
  it._onConnected(0, { handedness: 'left', hand: {} });
  it._onConnected(0, { handedness: 'left', hand: {} });
  it._onConnected(0, { handedness: 'left' });
  assert.deepEqual(events.map(e => [e[0], e[1].hand, e[1].handedness]), [['handTrackingChanged', true, 'left'], ['handTrackingChanged', false, 'left']]);
});

test('1.6: desktop tilt turns the bottle about the grip point, not its centre', () => {
  const base0 = new THREE.Vector3(0.3, 1.1, -0.5), q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.7, 0));
  const wrist = [0.07, 0.11, -0.02], axis = new THREE.Vector3(0, 0, -1).applyQuaternion(q0);
  const grip = p => new THREE.Vector3(...wrist).applyQuaternion(p.quaternion).add(p.position);
  const start = grip({ position: base0, quaternion: q0 });
  for (const angle of [0.4, 1.2, -0.8]) {
    const p = tiltAboutGrip(base0.clone(), q0, wrist, axis, angle);
    assert.ok(grip(p).distanceTo(start) < 1e-9, `grip fixed at ${angle}`);
    assert.ok(Math.abs(p.quaternion.angleTo(q0) - Math.abs(angle)) < 1e-6);
  }
  assert.ok(tiltAboutGrip(base0.clone(), q0, wrist, axis, 1.2).position.distanceTo(base0) > 0.05, 'the base moves instead of the hand');
});

test('1.9: leaving XR folds snap turns into the desktop yaw and resets the camera to the desktop eye', () => {
  const { it } = rig();
  it.yaw = 0.3; it.pitch = -0.2; it.rig.rotation.y = -Math.PI / 6;
  it.camera.position.set(0.1, 1.73, 0.2); it.camera.rotation.set(0.1, 2, 0.3);
  it.restoreDesktop();
  assert.equal(it.rig.rotation.y, 0);
  assert.ok(Math.abs(it.yaw - (0.3 - Math.PI / 6)) < 1e-12);
  assert.deepEqual(it.camera.position.toArray(), [0, DESKTOP_EYE, 0]);
  assert.deepEqual([it.camera.rotation.x, it.camera.rotation.y, it.camera.rotation.z, it.camera.rotation.order], [-0.2, it.yaw, 0, 'YXZ']);
  assert.ok(DESKTOP_EYE >= 1.5, 'desktop eye is a plausible standing eye height for avatar auto-calibration');
});
