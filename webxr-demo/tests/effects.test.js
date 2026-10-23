import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
// Bottle effects (damage, pouring, breakage) from the bottles extension as synced into the demo.
import { BottleDamageProfile, assessPane, puddlePolygon, holeHydraulics, PourSystem, BreakageSystem, makeLut, BottleBodies, bottleDischargeScale, BOTTLE_QUALITY }
  from '../src/vendor/extensions/bottles/index.js';
import { createCannonPhysics } from '../src/vendor/extensions/adapters/physics-cannon.js';

// Breakage's view of physics (BottleBodies) for bottles that never touch an engine.
const stillBodies = () => ({ remove() {}, shard() {}, isHeld: () => false, velocity: () => ({ linear: new THREE.Vector3(), angular: new THREE.Vector3() }) });

test('calibrated plastic impact pierces without shattering', () => {
  const p = new BottleDamageProfile({
    material: 'plastic', shatters: false, wall_thickness_m: 0.0015,
    glass_mass_kg: 0.026, capacity_ml: 500, liquid_mass_kg_per_ml: 0.001,
    calibration: { surface: 'concrete', fill: 1, v_n: 4.3 },
    leak: { ratio: 1, hole_r_m: 0.0025 },
  });
  const result = p.assess({ speed: 4.3, y: 0.08, fill: 1, surface: 'concrete' });
  assert.equal(result.outcome, 'pierce');
  assert.ok(result.ratio >= 1);
});

test('puddle polygon is clipped to the hit box face', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 0.5));
  mesh.position.set(0, 0, 0); mesh.updateMatrixWorld(true);
  const hit = { point: new THREE.Vector3(0.48, 0.05, 0), normal: new THREE.Vector3(0, 1, 0),
    localNormal: new THREE.Vector3(0, 1, 0), object: mesh };
  const polygon = puddlePolygon(hit, 0.3);
  assert.ok(polygon.length >= 3);
  assert.ok(polygon.every(p => p.x <= 0.50001 && p.x >= -0.50001));
  assert.ok(polygon.every(p => p.z <= 0.25001 && p.z >= -0.25001));
});

function liquidFor(root, level = 0.14) {
  const liquid = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.04));
  liquid.position.y = 0.1; root.add(liquid); root.updateWorldMatrix(true, true);
  return { liquid, fill: 0.7, info: { rim_points: [[0, 0.2, 0]] },
    lut: { offset: () => level, fillAt: () => 0.01, spill: (_up, fill) => ({ fill }) },
    agitate() {} };
}

test('hole flow follows the liquid level and shuts off above it', () => {
  const root = new THREE.Group(), liquid = liquidFor(root);
  const bottle = { root, liquid, fillMl: 350, capacity: 500 };
  const wet = holeHydraulics(bottle, { point: new THREE.Vector3(0, 0.05, 0), normal: new THREE.Vector3(1, 0, 0), radius: 0.0025 });
  const dry = holeHydraulics(bottle, { point: new THREE.Vector3(0, 0.31, 0), normal: new THREE.Vector3(1, 0, 0), radius: 0.0025 });
  assert.ok(wet.rateMl > 0);
  assert.equal(dry.rateMl, 0);
});

test('viscosity is opt-in: the default outflow is bit-identical to the plain cd 0.62 formula, viscosity on adds the discharge scale', () => {
  const hole = { point: new THREE.Vector3(0, 0.05, 0), normal: new THREE.Vector3(1, 0, 0), radius: 0.0025 };
  for (const kind of ['water', 'beer', 'spirits', 'honey']) {
    const root = new THREE.Group(), liquid = liquidFor(root);
    const bottle = { root, liquid, fillMl: 350, capacity: 500, liquidKind: kind };
    const plain = holeHydraulics(bottle, hole), explicit = holeHydraulics(bottle, hole, { viscosity: false }), viscous = holeHydraulics(bottle, hole, { viscosity: true });
    // the formulas before the viscosity table: v = 0.62 * sqrt(2 g h), rate = pi r^2 v
    const oldSpeed = 0.62 * Math.sqrt(2 * 9.81 * plain.head), oldRate = Math.PI * hole.radius ** 2 * oldSpeed * 1e6;
    assert.equal(plain.exitSpeed, oldSpeed, kind); assert.equal(plain.rateMl, oldRate, kind);
    assert.equal(explicit.exitSpeed, oldSpeed, kind); assert.equal(explicit.rateMl, oldRate, kind);
    const scale = bottleDischargeScale(bottle);
    assert.equal(viscous.exitSpeed, 0.62 * scale * Math.sqrt(2 * 9.81 * plain.head), kind);
    if (kind === 'water') assert.equal(viscous.rateMl, plain.rateMl); else assert.ok(viscous.rateMl < plain.rateMl, `${kind} drains slower with viscosity on`);
  }
});

test('PourSystem: liquidViscosity follows the tier flag (false everywhere), setLiquidViscosity overrides, null follows the tier again', () => {
  for (const tier of Object.values(BOTTLE_QUALITY)) assert.equal(tier.liquidViscosity, false);
  const pour = new PourSystem(new THREE.Scene(), { quality: 3 }, { play() {} });
  assert.equal(pour.liquidViscosity, false);
  pour.setLiquidViscosity(true); assert.equal(pour.liquidViscosity, true);
  pour.setLiquidViscosity(null); assert.equal(pour.liquidViscosity, false);
});

test('real PET liquid LUT gives head pressure only to submerged holes', () => {
  const info = JSON.parse(readFileSync(new URL('../../export/v2/bottle_pet500.liquid.json', import.meta.url), 'utf8'));
  const root = new THREE.Group(), liquid = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.05));
  root.add(liquid); root.updateMatrixWorld(true);
  const bottle = { root, liquid: { liquid, lut: makeLut(info) }, fillMl: info.capacity_ml * 0.65, capacity: info.capacity_ml };
  const wet = holeHydraulics(bottle, { point: new THREE.Vector3(0, 0.04, 0), normal: new THREE.Vector3(1, 0, 0), radius: 0.0025 });
  const dry = holeHydraulics(bottle, { point: new THREE.Vector3(0, 0.18, 0), normal: new THREE.Vector3(1, 0, 0), radius: 0.0025 });
  assert.ok(wet.rateMl > 0);
  assert.equal(dry.rateMl, 0);
});

test('an annealed pane takes staged damage while tempered glass shatters', () => {
  const annealed = assessPane('annealed', { energy: 2, contact: 0.02 });
  const tempered = assessPane('tempered', { energy: 100, contact: 0.02 });
  assert.ok(['chip', 'cracked', 'punched'].includes(annealed.outcome));
  assert.equal(tempered.outcome, 'shattered');
});

test('shooting a plastic shell leaves visible entry and exit leaks', () => {
  const scene = new THREE.Scene(), root = new THREE.Group(); root.position.y = 1;
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.05, 24, 16), new THREE.MeshPhysicalMaterial({ side: THREE.FrontSide }));
  root.add(shell); root.updateWorldMatrix(true, true);
  const profile = new BottleDamageProfile({ material: 'plastic', shatters: false, wall_thickness_m: 0.0015,
    glass_mass_kg: 0.026, capacity_ml: 500, liquid_mass_kg_per_ml: 0.001,
    calibration: { surface: 'concrete', fill: 1, v_n: 4.3 }, leak: { ratio: 1, hole_r_m: 0.0025 } });
  const bottle = { root, height: 0.2, radius: 0.05, fillMl: 350, capacity: 500, profile, breakInfo: { leak: { hole_r_m: 0.0025 } },
    asset: {}, isPlastic: true, shatters: false, broken: false, holes: [], liquid: { agitate() {} } };
  root.traverse(o => { if (o.isMesh) o.userData.bottle = bottle; });
  const factory = { bottles: new Set([bottle]), quality: 2 };
  const audio = { play() {} };
  const pour = { spill() {}, splash() {} };
  const breakage = new BreakageSystem(scene, stillBodies(), factory, pour, audio);
  const hit = breakage.shoot(new THREE.Vector3(0, 1, 0.4), new THREE.Vector3(0, 0, -1));
  assert.ok(hit);
  assert.equal(bottle.holes.length, 2);
  assert.ok(bottle.holes.every(h => h.mark.parent === root));
});

test('a shot that punches plastic continues to the next pane', () => {
  const scene = new THREE.Scene(), root = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.05, 24, 16), new THREE.MeshPhysicalMaterial());
  root.add(shell); root.updateMatrixWorld(true);
  const profile = new BottleDamageProfile({ material: 'plastic', shatters: false, wall_thickness_m: 0.0015,
    glass_mass_kg: 0.026, capacity_ml: 500, liquid_mass_kg_per_ml: 0.001,
    calibration: { surface: 'concrete', fill: 1, v_n: 4.3 }, leak: { ratio: 1, hole_r_m: 0.0025 } });
  const bottle = { root, height: 0.2, radius: 0.05, fillMl: 350, capacity: 500, profile, breakInfo: {}, asset: {},
    isPlastic: true, shatters: false, broken: false, holes: [], liquid: { agitate() {} } };
  root.traverse(o => { if (o.isMesh) o.userData.bottle = bottle; });
  const factory = { bottles: new Set([bottle]), quality: 2 };
  const breakage = new BreakageSystem(scene, stillBodies(), factory, { spill() {}, splash() {} }, { play() {} });
  const pane = breakage.pane('behind', [0, 0, -0.5], 0, [1, 1]);
  const shot = breakage.shoot(new THREE.Vector3(0, 0, 0.4), new THREE.Vector3(0, 0, -1));
  assert.ok(shot);
  assert.equal(bottle.holes.length, 2);
  assert.ok(pane.holes.length > 0);
});

test('flight volume is conserved when it lands on a registered surface', () => {
  const scene = new THREE.Scene();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2)); floor.position.y = -0.05; scene.add(floor);
  const factory = { bottles: new Set(), quality: 2 };
  const audio = { play() {} };
  const pour = new PourSystem(scene, factory, audio, [floor]);
  pour.initialMl = 10;
  pour.emit(5, new THREE.Vector3(0, 1, 0));
  pour.emit(5, new THREE.Vector3(0.01, 1, 0));
  for (let i = 0; i < 60; i++) pour.step(1 / 60);
  const ledger = pour.ledger();
  assert.ok(ledger.puddleMl > 9.99);
  assert.equal(pour.puddles.length, 1);
  assert.ok(Math.abs(pour.puddles[0].ml - 10) < 1e-6);
  assert.ok(Math.abs(ledger.errorMl) < 1e-6);
  pour.clear();
});

test('real PET liquid LUT pours at quarter and half turns without rim metadata', () => {
  const info = JSON.parse(readFileSync(new URL('../../export/v2/bottle_pet500.liquid.json', import.meta.url), 'utf8'));
  assert.equal(info.rim_points, undefined);
  for (const tilt of [Math.PI / 2, Math.PI]) {
    const scene = new THREE.Scene(), root = new THREE.Group(); root.rotation.z = tilt;
    const liquidMesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.05)); root.add(liquidMesh);
    root.updateMatrixWorld(true);
    const liquid = { liquid: liquidMesh, lut: makeLut(info), info, fill: 0.8, agitate() {} };
    const bottle = { root, liquid, fillMl: info.capacity_ml * 0.8, capacity: info.capacity_ml,
      height: info.z1 - info.z0, radius: 0.035, open: true, broken: false, holes: [], lastPour: 0 };
    const factory = { bottles: new Set([bottle]), quality: 2 }, pour = new PourSystem(scene, factory, { play() {} });
    pour._drain(bottle, 1 / 60);
    assert.ok(bottle.fillMl < info.capacity_ml * 0.8, `tilt ${tilt} should spill through the fallback rim`);
    assert.ok(pour.flights.length > 0, `tilt ${tilt} should create liquid flights`);
    pour.clear();
  }
});

test('shard physics keeps its collider centered on an offset mesh origin', () => {
  const physics = createCannonPhysics(), bodies = new BottleBodies(physics), mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.01));
  mesh.position.set(1, 2, 3); mesh.rotation.y = 0.7;
  const center = new THREE.Vector3(0.08, -0.01, 0.002);
  const entry = bodies.shard(mesh, { size: new THREE.Vector3(0.2, 0.04, 0.01), center, mass: 0.02,
    velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3() });
  physics.step(1 / 120);
  bodies.sync();
  mesh.updateMatrixWorld(true);
  const visualCenter = mesh.localToWorld(center.clone());
  assert.ok(visualCenter.distanceTo(new THREE.Vector3(...physics.pose(entry).position)) < 1e-5);
  bodies.remove(entry);
  assert.ok(!physics.world.bodies.includes(entry.body));
});
