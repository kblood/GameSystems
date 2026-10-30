// Flamethrower (extensions/flamethrower): config, fuel tank and canister, trigger, pilot light, nozzle cone geometry and
// hit helpers, the weapon state machine (drain, ramp, fade, sputter, empty, backfire) and the three layer with the real
// three.js in node (procedural mesh, GLB adoption, nozzle aim, fire-fx hookup, dispose).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_FLAMETHROWER_CONFIG, resolveFlamethrowerConfig, validateFlamethrowerConfig, createFuelTank, createCanister, createTrigger,
  createPilotLight, makeCone, coneRadius, coneRadiusAt, coneExposure, pointInCone, coneBounds, createFlamethrowerCore, createFlamethrower,
  buildProceduralFlamethrower, adoptFlamethrowerModel } from '../../extensions/flamethrower/index.js';
import { createFireFX } from '../../extensions/fire-fx/index.js';

const DT = 1 / 60;
const close = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, msg ?? `${a} ≈ ${b}`);
const run = (w, seconds, aim) => { let c; for (let i = 0; i < Math.round(seconds / DT); i++) c = w.update(DT, aim); return c; };
const AIM = { origin: [0, 1.5, 0], direction: [0, 0, -2] };

test('config: defaults valid, layers merge, problems are named', () => {
  assert.deepEqual(validateFlamethrowerConfig(DEFAULT_FLAMETHROWER_CONFIG), { ok: true, errors: [] });
  const cfg = resolveFlamethrowerConfig({ nozzle: { range: 7 } }, { tank: { capacityMl: 1000 } });
  assert.equal(cfg.nozzle.range, 7); assert.equal(cfg.nozzle.spreadDeg, DEFAULT_FLAMETHROWER_CONFIG.nozzle.spreadDeg); assert.equal(cfg.tank.capacityMl, 1000);
  assert.equal(DEFAULT_FLAMETHROWER_CONFIG.nozzle.range, 5, 'defaults are not mutated');
  assert.throws(() => resolveFlamethrowerConfig({ nozzle: { range: -1 }, pilot: { enabled: 'yes' } }), /nozzle\.range.*pilot\.enabled/);
  assert.throws(() => resolveFlamethrowerConfig({ tank: { capacityMl: 100, startMl: 200 } }), /startMl must not exceed/);
  assert.throws(() => resolveFlamethrowerConfig(3), /must be objects/);
});

test('tank: drain and refill are capped and conserve fuel; canister transfer', () => {
  const t = createFuelTank({ capacityMl: 1000, fuelMl: 300 });
  assert.equal(t.drain(100), 100); assert.equal(t.fuelMl, 200);
  assert.equal(t.drain(500), 200, 'drain returns what really left'); assert.equal(t.fuelMl, 0); assert.ok(t.empty);
  assert.equal(t.refill(1500), 1000, 'refill capped at capacity'); assert.equal(t.fraction, 1);
  assert.equal(t.refill(10), 0);
  t.drain(400);
  const can = createCanister(2000);
  assert.equal(t.transferFrom(can), 400); assert.equal(can.fuelMl, 1600); assert.equal(t.fuelMl, 1000);
  assert.deepEqual(t.totals(), { drainedMl: 700, refilledMl: 1400 });
  assert.throws(() => t.refill(-1), RangeError); assert.throws(() => t.drain(NaN), RangeError);
  assert.throws(() => createFuelTank({ capacityMl: 0 }), RangeError);
  assert.throws(() => createFuelTank({ capacityMl: 10, fuelMl: 11 }), RangeError);
});

test('trigger and pilot light', () => {
  const tr = createTrigger();
  assert.equal(tr.set(true), true); assert.equal(tr.set(true), false); tr.tick(0.5); close(tr.heldSeconds, 0.5);
  tr.set(false); assert.equal(tr.pulls, 1); assert.equal(tr.releases, 1);
  const p = createPilotLight({ relightSeconds: 1 });
  assert.ok(p.lit); assert.equal(p.douse(), true); assert.ok(!p.lit && p.relighting);
  assert.equal(p.tick(0.6), false); assert.equal(p.tick(0.5), true); assert.ok(p.lit);
  p.douse(); assert.equal(p.relight(), true); assert.equal(p.tick(0), true, 'relight() lights on the next tick');
  const off = createPilotLight({ enabled: false });
  assert.ok(!off.lit); assert.equal(off.relight(), false); assert.equal(off.tick(10), false);
});

test('nozzle: cone radius, exposure falloff, bounds', () => {
  close(coneRadius(5, 90), 5, 1e-9); close(coneRadius(4, 16), 4 * Math.tan(8 * Math.PI / 180), 1e-12);
  const c = makeCone();
  Object.assign(c, { origin: [0, 0, 0], direction: [0, 0, -1], length: 4, radius: 0.5, baseRadius: 0.1, active: true, intensity: 1 });
  close(coneRadiusAt(c, 0), 0.1); close(coneRadiusAt(c, 2), 0.3); close(coneRadiusAt(c, 4), 0.5);
  close(coneExposure(c, [0, 0, 0]), 1); close(coneExposure(c, [0, 0, -4]), 0.5);
  assert.equal(coneExposure(c, [0, 0, -4.01]), 0, 'beyond the length'); assert.equal(coneExposure(c, [0, 0, 0.5]), 0, 'behind the nozzle');
  assert.ok(pointInCone(c, [0.29, 0, -2])); assert.ok(!pointInCone(c, [0.31, 0, -2]));
  close(coneExposure(c, [0.3, 0, -2]), 0.75 * 0.5, 1e-9, 'rim of the middle: axial 0.75 × radial 0.5');
  c.active = false; assert.equal(coneExposure(c, [0, 0, -1]), 0);
  const b = coneBounds({ ...c, active: true });
  assert.deepEqual(b.center, [0, 0, -2]); close(b.radius, Math.hypot(2, 0.5));
});

test('weapon: firing drains flow × time, ramps to range, cone radius follows the spread', () => {
  const events = [];
  const w = createFlamethrowerCore({ tank: { capacityMl: 2000 }, nozzle: { range: 4, spreadDeg: 20, flowMlPerSecond: 120, rampSeconds: 0.25 } },
    { onEvent: (type) => events.push(type) });
  let c = w.update(DT, AIM);
  assert.equal(c.active, false); assert.deepEqual(c.direction, [0, 0, -1], 'direction normalised');
  w.setTrigger(true);
  c = run(w, 1, AIM);
  close(w.tank.fuelMl, 2000 - 120, 1e-6, `drained ${2000 - w.tank.fuelMl}`);
  assert.ok(c.active); close(c.length, 4); close(c.radius, 4 * Math.tan(10 * Math.PI / 180), 1e-9); close(c.intensity, 1);
  assert.equal(c, w.flameCone(), 'same cone object every frame');
  assert.ok(events.includes('ignite'));
  // Ramp: after 0.1 s of burning the flame is shorter than full.
  const w2 = createFlamethrowerCore({ nozzle: { range: 4, rampSeconds: 0.25 }, pilot: { igniteDelay: 0 } });
  w2.setTrigger(true); c = run(w2, 0.1, AIM); assert.ok(c.length > 1 && c.length < 2, `ramp length ${c.length}`);
  // Release: the tail fades out in fadeSeconds and fuel stops.
  w.setTrigger(false); const fuel = w.tank.fuelMl;
  c = w.update(DT, AIM); assert.ok(c.active && c.length < 4, 'tail still active right after release');
  c = run(w, 0.3, AIM); assert.equal(c.active, false); assert.equal(c.length, 0); assert.equal(w.tank.fuelMl, fuel);
  assert.ok(events.includes('extinguish'));
  const s = w.state();
  assert.equal(s.firing, false); close(s.totals.burnedMl, 120 - 120 * 0.08, 3, `burnedMl ${s.totals.burnedMl} (ignite delay is unlit spray)`);
  assert.ok(s.totals.unlitMl > 0 && s.totals.unlitMl < 12);
});

test('weapon: sputter near empty, empty event, dry fire, refuel', () => {
  const events = [];
  const w = createFlamethrowerCore({ tank: { capacityMl: 1000, startMl: 400 }, nozzle: { range: 5, flowMlPerSecond: 200 }, sputter: { belowMl: 300, minPressure: 0.2 } },
    { onEvent: t => events.push(t) });
  w.setTrigger(true);
  let c = run(w, 0.4, AIM); close(c.length, 5, 1e-6, 'full pressure above belowMl');
  c = run(w, 1.2, AIM); // ~ 80 ml left
  assert.ok(w.state().sputtering); assert.ok(c.length < 5 && c.length > 0.2, `sputter length ${c.length}`);
  c = run(w, 1, AIM);
  assert.ok(w.tank.empty); assert.ok(events.includes('empty'));
  c = run(w, 0.5, AIM); assert.equal(c.active, false, 'no flame on an empty tank'); assert.equal(w.state().firing, false);
  w.setTrigger(false); w.setTrigger(true); assert.equal(events.at(-1), 'dry-fire');
  assert.equal(w.refuel(5000), 1000); assert.equal(events.at(-1), 'refuel');
  c = run(w, 0.5, AIM); assert.ok(c.active, 'fires again after refuel');
});

test('weapon: no pilot = unlit spray only; douse and relight', () => {
  const raw = createFlamethrowerCore({ pilot: { enabled: false } });
  raw.setTrigger(true); const c = run(raw, 1, AIM);
  assert.equal(c.active, false); const s = raw.state(); assert.ok(s.spraying); close(s.totals.unlitMl, 150, 1e-6); assert.equal(s.totals.burnedMl, 0);
  const w = createFlamethrowerCore({ pilot: { relightSeconds: 0.5 } });
  w.setTrigger(true); run(w, 0.5, AIM); assert.ok(w.flameCone().active);
  w.douse(); run(w, 0.3, AIM); assert.equal(w.flameCone().active, false, 'doused: flame dies');
  run(w, 0.6, AIM); assert.ok(w.flameCone().active, 'relit by itself after relightSeconds');
});

test('weapon: backfire is opt-in, seeded, and fires at an empty tank with the pilot lit', () => {
  const quiet = createFlamethrowerCore({ tank: { capacityMl: 100, startMl: 0 } });
  quiet.setTrigger(true); run(quiet, 5, AIM); assert.equal(quiet.state().backfire.count, 0, 'disabled by default');
  const play = seed => {
    const ev = [];
    const w = createFlamethrowerCore({ tank: { capacityMl: 100, startMl: 0 }, backfire: { enabled: true, chancePerSecond: 2, cooldownSeconds: 1, radius: 0.7 }, pilot: { relightSeconds: 0.5 } },
      { seed, onEvent: (t, d) => ev.push([t, d]) });
    w.setTrigger(true); run(w, 4, AIM); return { w, ev };
  };
  const a = play(11), b = play(11);
  assert.ok(a.w.state().backfire.count > 0);
  assert.deepEqual(a.ev, b.ev, 'same seed, same rolls');
  const bf = a.ev.find(([t]) => t === 'backfire')[1];
  assert.deepEqual(bf.origin, [0, 1.5, 0]); assert.equal(bf.radius, 0.7);
  assert.ok(a.ev.some(([t, d]) => t === 'pilot-out' && d.reason === 'backfire'));
  assert.ok(a.w.state().backfire.count <= 4, 'cooldown limits the rate');
});

test('weapon: rejects bad dt; dispose deactivates the cone', () => {
  const w = createFlamethrowerCore();
  assert.throws(() => w.update(-1), RangeError); assert.throws(() => w.update(NaN), RangeError);
  w.setTrigger(true); run(w, 0.5, AIM); assert.ok(w.flameCone().active);
  w.dispose(); assert.equal(w.flameCone().active, false); assert.equal(w.update(DT, AIM).active, false);
});

test('three layer: procedural mesh, nozzle in front, aim from the nozzle, dispose', () => {
  const built = buildProceduralFlamethrower(THREE);
  let meshes = 0; built.object.traverse(o => { if (o.isMesh) meshes++; });
  assert.equal(meshes, 7); assert.ok(built.owned.length >= 12);
  const scene = new THREE.Scene();
  const ft = createFlamethrower({ THREE, scene, range: 3, tank: 500 });
  assert.equal(ft.object.parent, scene); assert.equal(ft.mountPoint.parent, ft.object);
  const box = new THREE.Box3().setFromObject(ft.object);
  close(ft.nozzle.position.z, box.min.z, 0.03, 'nozzle at the front (-Z)');
  ft.object.position.set(1, 1.2, 0); ft.object.rotation.y = Math.PI / 2; // now points along -X
  ft.setTrigger(true);
  let c; for (let i = 0; i < 60; i++) c = ft.update(DT);
  assert.ok(c.active); close(c.direction[0], -1, 1e-6); close(c.direction[2], 0, 1e-6);
  close(c.origin[0], 1 - 0.645, 1e-6); close(c.origin[1], 1.24, 1e-6);
  close(c.length, 3); close(ft.state().fuelMl, 500 - 150, 1e-6);
  c = ft.update(DT, { origin: new THREE.Vector3(0, 2, 0), direction: new THREE.Vector3(0, -1, 0) });
  assert.deepEqual(c.origin, [0, 2, 0]); assert.deepEqual(c.direction, [0, -1, 0]);
  assert.equal(ft.refuel(1000), 150 + 150 / 60, 'refuel tops up to capacity');
  ft.dispose(); assert.equal(ft.object.parent, null); assert.equal(ft.flameCone().active, false);
});

test('three layer: GLB adoption finds named nodes or places the nozzle on the -Z face', () => {
  const glb = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.8)); body.position.z = -0.3; glb.add(body);
  const a = adoptFlamethrowerModel(THREE, glb);
  assert.equal(a.nozzle.name, 'nozzle'); close(a.nozzle.position.z, -0.7, 1e-6); assert.equal(a.mountPoint.name, 'mount');
  const named = new THREE.Group(), tip = new THREE.Object3D(), grip = new THREE.Object3D();
  tip.name = 'Muzzle_Tip'; grip.name = 'Handle'; named.add(tip, grip);
  const b = adoptFlamethrowerModel(THREE, named);
  assert.equal(b.nozzle, tip); assert.equal(b.mountPoint, grip); assert.deepEqual(b.owned, []);
  const ft = createFlamethrower({ THREE, model: named });
  assert.equal(ft.object, named); ft.dispose();
  assert.throws(() => adoptFlamethrowerModel(THREE, {}), TypeError);
});

test('three layer + fire-fx: pilot flame and flame puffs go to fx, removed on dispose', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(70, 1, 0.05, 100);
  camera.position.set(0, 1.6, 2); camera.lookAt(0, 1.2, -1);
  const fx = createFireFX({ THREE, scene, camera });
  const ft = createFlamethrower({ THREE, scene, fx, id: 'p1' });
  ft.object.position.set(0, 1.2, 0);
  ft.update(DT); fx.update(DT);
  assert.equal(fx.stats().flames.registered, 1, 'pilot flame registered');
  ft.setTrigger(true);
  for (let i = 0; i < 30; i++) { ft.update(DT); fx.update(DT); }
  const s = fx.stats();
  assert.ok(s.particles.live > 20, `puffs live: ${s.particles.live}`);
  assert.ok(s.drawCalls <= 3);
  ft.dispose(); assert.equal(fx.stats().flames.registered, 0);
  fx.dispose();
});
