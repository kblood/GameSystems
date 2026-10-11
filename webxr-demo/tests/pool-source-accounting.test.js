import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHost } from '../src/vendor/extensions/host/index.js';
import thermal from '../src/vendor/extensions/thermal/index.js';
import pools from '../src/vendor/extensions/pools/index.js';
import bottles from '../src/vendor/extensions/bottles/index.js';
import { connectBottlePools } from '../src/vendor/extensions/pools/bottle-bridge.js';
import { createFakePhysics } from './fake-physics.js';

async function setup({maxPools=128,second=false}={}) {
  const scene = new THREE.Scene(), physics = createFakePhysics(), errors = [];
  const host = createHost({ scene, physics, onError: e => errors.push(e.message) });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(2, .2, 2), new THREE.MeshStandardMaterial());
  floor.position.y = -.1; floor.userData.materialId = 'floor'; scene.add(floor);
  await host.load(thermal); const p = await host.load(pools,{maxPools});
  const b = await host.load(bottles, { surfaces: [floor], audio: { play() {} } });
  const off = connectBottlePools({ host, bottles: b, pools: p });
  b.pour.initialMl = second?200:100;
  b.pour.emit(100, new THREE.Vector3(0, .5, 0), undefined, { liquidKind: 'diesel' });
  if(second)b.pour.emit(100,new THREE.Vector3(.8,.5,0),undefined,{liquidKind:'diesel'});
  for (let i = 0; i < 60; i++) physics.step(1 / 60);
  return { host, p, b, off, errors };
}
test('real bottle droplets retain dormant source volume beyond active pool budget',async()=>{
  const {host,p,b,off,errors}=await setup({maxPools:1,second:true});assert.equal(p.all().length,2);assert.equal(p.stats().active,1);assert.equal(p.ledger().remainingMl,200);
  const deferred=p.all().find(s=>!s.active);assert.ok(deferred);assert.equal(deferred.sources[b.sourceKey].diesel,100);assert.equal(b.ledger().puddleMl,200);
  p.remove(deferred.id);assert.equal(b.ledger().removedMl,100);assert.equal(b.ledger().puddleMl,100);assert.equal(p.ledger().remainingMl,100);assert.equal(b.ledger().errorMl,0);
  assert.deepEqual(errors,[]);off();host.dispose();
});

test('removing a logical pool removes source volume and VFX without labelling it burned', async () => {
  const { host, p, b, off, errors } = await setup();
  p.remove(p.all()[0].id);
  assert.equal(p.ledger().removedMl, 100); assert.equal(b.ledger().removedMl, 100);
  assert.equal(b.ledger().puddleMl, 0); assert.equal(b.ledger().burnedMl, 0);
  assert.equal(b.pour.puddles.length, 0); assert.equal(b.ledger().errorMl, 0);
  assert.deepEqual(errors, []); off(); host.dispose();
});

test('manual pool clearing consumes world volume but a source reset does not charge twice', async () => {
  const { host, p, b, off, errors } = await setup();
  p.clear(); assert.equal(b.ledger().puddleMl, 0); assert.equal(b.ledger().removedMl, 100);
  b.reset(); assert.equal(b.ledger().removedMl, 0); assert.equal(b.ledger().errorMl, 0);
  assert.equal(p.all().length, 0); assert.deepEqual(errors, []); off(); host.dispose();
});

test('resetting one bottle source preserves independent sources merged into the same pool', async () => {
  const {host,p,b,off}=await setup();
  const id=p.all()[0].id;
  p.deposit({id,ml:200,kind:'diesel',sourceKey:'vehicle:car'});
  b.reset();
  assert.equal(p.all().length,1);
  assert.equal(p.state(id).ml,200);
  assert.deepEqual(p.state(id).sources,{'vehicle:car':{diesel:200}});
  assert.equal(p.ledger().removedMl,100);
  assert.equal(p.ledger().remainingMl,200);
  assert.equal(b.ledger().removedMl,0,'the bottle reset zeroes its local ledger before source removal is reported');
  off();host.dispose();
});

test('source reset preserves a very small independent contribution', async () => {
  const {host,p,b,off}=await setup();
  const id=p.all()[0].id, tiny=1e-8;
  p.deposit({id,ml:tiny,kind:'diesel',sourceKey:'tiny-source'});
  b.reset();
  assert.equal(p.all().length,1);
  assert.ok(Math.abs(p.state(id).ml-tiny)<1e-14);
  assert.equal(p.state(id).sources['tiny-source'].diesel,tiny);
  off();host.dispose();
});

test('source reset rejects recursive removal observers without invalidating the outer sweep', async () => {
  const {host,p,b,off,errors}=await setup({second:true});
  const removed=host.on('pools:removed',()=>{
    assert.throws(()=>p.removeSource(b.sourceKey),/Cannot mutate pools during clear/);
    assert.throws(()=>p.deposit({ml:25,kind:'diesel',sourceKey:b.sourceKey}),/Cannot mutate pools during clear/);
  });
  assert.doesNotThrow(()=>b.reset());
  assert.equal(p.all().length,0);
  assert.equal(p.ledger().remainingMl,0);
  assert.deepEqual(errors,[]);
  removed();off();host.dispose();
});

test('one source cannot be bound twice and disconnect is safe across a later rebind', async () => {
  const { host, p, b, off } = await setup();
  const count = host.events.count('pools:consumed');
  assert.throws(() => connectBottlePools({ host, bottles: b, pools: p }));
  assert.equal(host.events.count('pools:consumed'), count);
  off(); const off2 = connectBottlePools({ host, bottles: b, pools: p }); off();
  assert.equal(host.events.count('pools:consumed'), count);
  p.ignite(p.all()[0].id); host.update(1);
  assert.ok(Math.abs(b.ledger().burnedMl - p.ledger().burnedMl) < 1e-5);
  off2(); host.dispose();
});

test('consumption-state rewind preserves both source sinks and refuses mismatched history', async () => {
  const { host, p, b, off } = await setup(); const saved = b.ledger();
  p.remove(p.all()[0].id); b.restorePuddleLedger(saved);
  assert.equal(b.ledger().removedMl, 0); assert.equal(b.ledger().puddleMl, 100); assert.equal(b.ledger().errorMl, 0);
  const before = b.ledger(); assert.throws(() => b.restorePuddleLedger({ ...saved, removedMl: 2 }));
  assert.deepEqual(b.ledger(), before); off(); host.dispose();
});

test('hose water in a diesel pool is not removed from the bottle source ledger', async () => {
  const { host, p, b, off } = await setup(); const id = p.all()[0].id;
  p.deposit({ id, ml: 50, kind: 'water', sourceKey: 'hose' });
  assert.equal(p.state(id).ml, 150); p.remove(id);
  assert.equal(p.ledger().removedMl, 150); assert.equal(b.ledger().removedMl, 100);
  assert.equal(b.ledger().errorMl, 0); off(); host.dispose();
});

test('unrelated hose puddle cannot drain diesel still lying on the source floor', async () => {
  const { host, p, b, off } = await setup();
  p.deposit({ id: 'hose', surfaceId: 'other', position: [5, 0, 0], ml: 50, kind: 'water', sourceKey: 'hose' });
  p.remove('hose'); assert.equal(b.ledger().puddleMl, 100); assert.equal(b.ledger().removedMl, 0);
  assert.equal(b.ledger().errorMl, 0); off(); host.dispose();
});

test('mixed combustible sources only debit the contribution belonging to bottles', async () => {
  const { host, p, b, off } = await setup(); const id = p.all()[0].id;
  p.deposit({ id, ml: 50, kind: 'oil', sourceKey: 'external' }); p.ignite(id); host.update(1);
  const dieselUsed = 100 - p.state(id).components.diesel;
  assert.ok(Math.abs(b.ledger().burnedMl - dieselUsed) < 1e-5);
  assert.ok(p.ledger().burnedMl > b.ledger().burnedMl);
  assert.ok(Math.abs(b.ledger().errorMl) < 1e-5); off(); host.dispose();
});
