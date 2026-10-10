import test from 'node:test';
import assert from 'node:assert/strict';
import { createCannonPhysics } from '../src/vendor/extensions/adapters/physics-cannon.js';
import { assertPhysicsAdapter } from '../src/vendor/extensions/host/index.js';
import { PhysicsWorld } from '../src/physics.js';

const floor = physics => physics.addBody({ type: 'box', size: [4, 0.2, 4] }, 0, { position: [0, -0.1, 0] }, { userData: { surface: 'concrete' } });

test('cannon adapter implements the host physics interface', () => {
  assertPhysicsAdapter(createCannonPhysics());
  assertPhysicsAdapter(new PhysicsWorld().adapter);
});

test('a dropped body falls, lands and reports the contact after the step', () => {
  const physics = createCannonPhysics(), contacts = [];
  floor(physics);
  const bottle = physics.addBody({ type: 'cylinder', radius: 0.03, height: 0.25, offset: [0, 0.125, 0] }, 0.5, { position: [0, 1, 0] });
  const off = physics.onContact(c => { assert.equal(physics.stepping, false); contacts.push(c); });
  for (let i = 0; i < 90; i++) physics.step(1 / 60);
  const p = physics.pose(bottle);
  assert.ok(Math.abs(p.position[1]) < 0.02, `rests on the floor, y=${p.position[1]}`);
  const hit = contacts.find(c => c.a === bottle); // the floor is an adapter body too and gets its own report
  assert.ok(hit && hit.surface === 'concrete' && hit.speed > 3 && hit.b.userData.surface === 'concrete');
  off();
});

test('hold is kinematic at the target pose; release restores mass with velocity and spin', () => {
  const physics = createCannonPhysics();
  const b = physics.addBody({ type: 'sphere', radius: 0.05 }, 0.4, { position: { x: 0, y: 1, z: 0 } });
  physics.hold(b, { position: [0.2, 1.5, -0.3], quaternion: [0, 0, 0, 1] });
  for (let i = 0; i < 10; i++) physics.step(1 / 60);
  assert.ok(physics.isHeld(b));
  assert.deepEqual(physics.pose(b).position.map(x => +x.toFixed(4)), [0.2, 1.5, -0.3]);
  physics.release(b, [1, 0, 0], [0, 3, 0]);
  assert.equal(b.body.mass, 0.4);
  assert.deepEqual([b.body.velocity.x, b.body.angularVelocity.y], [1, 3]);
  physics.step(1 / 60);
  assert.ok(physics.pose(b).position[0] > 0.2);
});

test('contacts are delivered after the step, so a listener may remove the body', () => {
  const physics = createCannonPhysics();
  floor(physics);
  const b = physics.addBody({ type: 'sphere', radius: 0.05 }, 0.2, { position: [0, 0.5, 0] });
  let removed = 0;
  physics.onContact(c => { if (c.a === b) { physics.remove(b); removed++; } });
  for (let i = 0; i < 60; i++) physics.step(1 / 60);
  assert.equal(removed, 1);
  assert.ok(!physics.world.bodies.includes(b.body));
});

test('step order: contacts, then onStep listeners; reports carry local point/normal, velocity, other mass and impulse', () => {
  const physics = createCannonPhysics(), order = [];
  floor(physics);
  const b = physics.addBody({ type: 'cylinder', radius: 0.03, height: 0.25, offset: [0, 0.125, 0] }, 0.5, { position: [0, 0.6, 0] });
  physics.onContact(c => { if (c.a === b) order.push(['contact', c]); });
  physics.onStep(dt => order.push(['step', dt]));
  for (let i = 0; i < 60 && !order.some(([k]) => k === 'contact'); i++) physics.step(1 / 60);
  const i = order.findIndex(([k]) => k === 'contact'), c = order[i][1];
  assert.equal(order.at(-1)[0], 'step', 'onStep runs after the contact reports of its step');
  assert.ok(Math.abs(c.localPoint[1]) < 0.02 && Math.abs(c.localNormal[1] + 1) < 1e-6, 'hit at the base, normal pointing down in the body frame');
  assert.ok(c.velocity[1] < -2 && c.spin.length === 3);
  assert.equal(c.otherMass, Infinity);
  assert.ok(Math.abs(c.impulse - c.speed * 0.5) < 1e-9, 'static other: impulse = speed × own mass');
});

test('velocity, setMass while held, initial velocity/spin, contacts: false, removed handles are ignored', () => {
  const physics = createCannonPhysics(), reports = [];
  physics.onContact(c => reports.push(c));
  floor(physics);
  const quiet = physics.addBody({ type: 'box', size: [0.1, 0.1, 0.1] }, 0.1, { position: [0, 0.3, 0] }, { velocity: [1, 0, 0], spin: [0, 2, 0], contacts: false });
  assert.deepEqual(physics.velocity(quiet), { linear: [1, 0, 0], angular: [0, 2, 0] });
  for (let i = 0; i < 40; i++) physics.step(1 / 60);
  assert.ok(!reports.some(c => c.a === quiet), 'no reports for a body created with contacts: false');
  const b = physics.addBody({ type: 'sphere', radius: 0.05 }, 0.4, { position: [0, 1, 0] });
  physics.hold(b, { position: [0, 1, 0] });
  physics.setMass(b, 0.25);
  assert.equal(b.body.mass, 0, 'kinematic while held');
  assert.deepEqual(physics.velocity(b).linear, [0, 0, 0]);
  physics.release(b);
  assert.equal(b.body.mass, 0.25, 'the mass set while held applies on release');
  physics.remove(b);
  physics.hold(b, { position: [5, 5, 5] }); physics.setMass(b, 9); physics.release(b, [1, 1, 1]);
  assert.equal(b.body.mass, 0.25);
});

test('the demo world keeps its contact material and sleep settings through the adapter', () => {
  const { world } = new PhysicsWorld().adapter;
  assert.equal(world.allowSleep, true);
  assert.equal(world.defaultContactMaterial.friction, 0.55);
  assert.equal(world.defaultContactMaterial.restitution, 0.12);
});
