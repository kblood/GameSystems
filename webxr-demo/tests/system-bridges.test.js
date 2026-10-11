import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHost } from '../src/vendor/extensions/host/index.js';
import { createCannonPhysics } from '../src/vendor/extensions/adapters/physics-cannon.js';
import bottles from '../src/vendor/extensions/bottles/index.js';
import materials from '../src/vendor/extensions/materials/index.js';
import thermal from '../src/vendor/extensions/thermal/index.js';
import { createFakePhysics } from './fake-physics.js';

test('real falling bottle droplets emit one deposit, wet material and extinguish registered fire', async () => {
  const scene = new THREE.Scene(), physics = createFakePhysics(), errors = [];
  const host = createHost({ scene, physics, onError: e => errors.push(e.message) });
  const surface = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 2), new THREE.MeshStandardMaterial()); surface.position.y = -0.1; surface.userData.materialId = 'bench'; surface.userData.thermalId = 'fire'; scene.add(surface);
  const mat = await host.load(materials); mat.add('bench', { material: 'metal' });
  const heat = await host.load(thermal); heat.add('fire'); heat.ignite('fire');
  const api = await host.load(bottles, { surfaces: [surface], audio: { play() {} } }); const events = [];
  host.on('liquid:deposit', e => events.push(e));
  api.pour.initialMl = 30; api.pour.emit(30, new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(), { id: 'water-bottle', liquidKind: 'water' });
  for (let i = 0; i < 60; i++) physics.step(1 / 60);
  assert.equal(events.length, 1); assert.equal(events[0].ml, 30); assert.equal(events[0].surfaceId, 'bench'); assert.equal(events[0].kind, 'water'); assert.equal(mat.state('bench').liquidMl, 30); assert.equal(heat.state('fire').burning, false);
  assert.ok(Math.abs(api.ledger().errorMl) < 1e-6); assert.deepEqual(errors, []); host.dispose();
});
test('flight budget preserves mixture identity and unknown liquids never count as water', async () => {
  const scene = new THREE.Scene(), physics = createFakePhysics(), host = createHost({ scene, physics });
  const surface = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 2), new THREE.MeshStandardMaterial()); surface.position.y = -0.1; surface.userData.thermalId = 'fire'; scene.add(surface);
  const heat = await host.load(thermal); heat.add('fire'); heat.ignite('fire');
  const api = await host.load(bottles, { surfaces: [surface], audio: { play() {} } }); api.pour.settings = { ...api.pour.settings, maxFlights: 1 }; const events = []; host.on('liquid:deposit', e => events.push(e));
  api.pour.initialMl = 20;
  api.pour.emit(10, new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(), { liquidKind: 'water' });
  api.pour.emit(10, new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(), { liquidKind: 'wine' });
  for (let i = 0; i < 60; i++) physics.step(1 / 60);
  assert.equal(events.length, 1); assert.equal(events[0].kind, 'mixed'); assert.equal(events[0].ml, 20); assert.equal(heat.state('fire').burning, true); assert.ok(Math.abs(api.ledger().errorMl) < 1e-6); host.dispose();
});
test('wet material hook changes actual Cannon sliding distance', async () => {
  async function slide(wet) {
    const physics = createCannonPhysics(undefined, { friction: 0.55 }), scene = new THREE.Scene();
    const floor = physics.addBody({ type: 'box', size: [20, 0.2, 4] }, 0, { position: [0, -0.1, 0] });
    const host = createHost({ scene, physics }), m = await host.load(materials, { applySurface: (_id, state) => physics.setFriction(floor, state.friction) });
    // Zero is the ideal fully lubricated limit: tests the actual contact response, not just a stored coefficient.
    m.add('floor', { material: 'metal', dryFriction: 0.9, wetFriction: 0, dryRate: 0 }); m.wet('floor', wet ? 40 : 0);
    const box = physics.addBody({ type: 'box', size: [0.2, 0.2, 0.2] }, 1, { position: [0, 0.102, 0] }, { velocity: [2, 0, 0], linearDamping: 0, angularDamping: 1 });
    for (let i = 0; i < 120; i++) physics.step(1 / 120);
    const x = physics.pose(box).position[0]; host.dispose(); physics.remove(floor); physics.remove(box); return x;
  }
  const dry = await slide(false), wet = await slide(true); assert.ok(wet > dry * 2, `wet ${wet} must slide farther than dry ${dry}`);
});
