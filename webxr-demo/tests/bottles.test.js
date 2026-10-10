// The bottles extension (GameSystems/extensions/bottles, extensions plan step 8) on an engine-free fake physics adapter:
// it only knows the host interface (ctx.physics) and events, never cannon-es. Plus a guard that cannon-es is imported
// nowhere but the cannon adapter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, relative, sep } from 'node:path';
import * as THREE from 'three';
import { createHost, assertPhysicsAdapter } from '../src/vendor/extensions/host/index.js';
import bottlesExtension, { BOTTLE_TIERS, BOTTLE_QUALITY, IMPACT_MIN_SPEED, liquidAbsorbance, absorbanceOfSRGB } from '../src/vendor/extensions/bottles/index.js';
import { createFakePhysics } from './fake-physics.js';


async function setup({ quality = 2 } = {}) {
  const physics = createFakePhysics(), scene = new THREE.Scene(), events = [];
  const host = createHost({ scene, physics, quality, onError: e => { throw e; } });
  host.on('broken', d => events.push(['broken', d]));
  const audio = { played: [], play(key) { this.played.push(key); } };
  const api = await host.load(bottlesExtension, { catalog: { assets: [] }, audio });
  return { physics, scene, host, api, events, audio };
}

/** A game-built glass bottle (no GLB): 25 cm cylinder, origin at the base, a driver that records what it gets. */
function model({ shatters = true, material = 'glass' } = {}) {
  const root = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.25, 12), new THREE.MeshStandardMaterial());
  glass.position.y = 0.125; glass.name = 'Glass'; root.add(glass);
  const liquid = { info: {}, fill: 0.5, capOpen: false, bubbles: 1, slosh: true, agitation: 0, updates: 0,
    agitate(k) { this.agitation += k; }, update() { this.updates++; } };
  return { id: 'test_bottle', root, liquid, asset: { height_m: 0.25, capacity_ml: 500, glass: material },
    breakInfo: { shatters, material, wall_thickness_m: 0.003 }, fill: 0.5, position: new THREE.Vector3(0, 1, 0) };
}

const hit = (body, speed, extra = {}) => ({ a: body, speed, point: [0.035, 1.1, 0], normal: [1, 0, 0], surface: 'concrete', otherMass: Infinity, ...extra });

test('the fake adapter implements the host physics interface and the extension loads on it', async () => {
  const { physics, api, host } = await setup();
  assertPhysicsAdapter(physics);
  assert.equal(host.state('bottles'), 'ready');
  assert.deepEqual([...BOTTLE_TIERS], ['minimal', 'low', 'mid', 'high']);
  assert.equal(api.tier, 'mid', 'global level 2 of 0..3 -> mid');
  assert.equal(api.factory.quality, 2);
});

test('adopt() makes a dynamic cylinder body at the base origin with the mass of the filled bottle', async () => {
  const { physics, api } = await setup();
  const b = api.adopt(model());
  const body = b.entry;
  assert.ok(physics.bodies.has(body));
  assert.equal(body.shape.type, 'cylinder');
  assert.equal(body.shape.height, 0.25);
  assert.deepEqual(body.shape.offset, [0, 0.125, 0]);
  assert.ok(body.shape.radius >= 0.025 && body.shape.radius <= 0.035);
  assert.equal(body.options.group, 4);
  assert.equal(body.userData.surface, 'bottle');
  assert.deepEqual(body.position, [0, 1, 0]);
  assert.ok(Math.abs(body.mass - b.profile.mass(0.5)) < 1e-9);
  assert.equal(api.ledger().initialMl, 250);
});

test('adopt() takes the own body of the game (shape + options) and liquid colour (Contracts, extensions plan step 9)', async () => {
  const { api } = await setup();
  const silhouette = { type: 'lathe', profile: [[0, 0.03], [0.25, 0.012]] };
  const b = api.adopt({ ...model(), color: 0x5a0d1c,
    body: { shape: silhouette, options: { userData: { kind: 'bottle_wine', name: 'wine' }, linearDamping: 0.05 } } });
  const body = b.entry;
  assert.equal(body.shape, silhouette, 'the shape of the game replaces the fitted cylinder');
  assert.equal(body.options.group, 4, 'still in the bottle collision group');
  assert.equal(body.options.linearDamping, 0.05, 'extra addBody options pass through');
  assert.deepEqual(body.userData, { surface: 'bottle', kind: 'bottle_wine', name: 'wine' }, 'userData merged, surface kept');
  const a = liquidAbsorbance(b), want = absorbanceOfSRGB([0x5a / 255, 0x0d / 255, 0x1c / 255]);
  assert.ok(a.every((v, i) => Math.abs(v - want[i]) < 1e-9), 'colour (0xRRGGBB) becomes the bottle absorbance');
  const c = api.adopt({ ...model(), color: [0.85, 0.54, 0.08] });
  assert.ok(liquidAbsorbance(c).every((v, i) => Math.abs(v - absorbanceOfSRGB([0.85, 0.54, 0.08])[i]) < 1e-9), 'sRGB array works too');
  assert.equal(c.entry.shape.type, 'cylinder', 'without body: the fitted cylinder');
});

test('each physics step syncs the root pose, updates the liquid and sets the mass from the fill', async () => {
  const { physics, api } = await setup();
  const b = api.adopt(model());
  b.entry.position = [0.2, 0.5, -0.3];
  b.entry.quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.4).toArray();
  b.fillMl = 100;
  physics.step(1 / 60);
  assert.deepEqual(b.root.position.toArray(), [0.2, 0.5, -0.3]);
  assert.ok(Math.abs(b.root.quaternion.z - Math.sin(0.2)) < 1e-9);
  assert.equal(b.liquid.updates, 1);
  assert.ok(Math.abs(b.entry.mass - b.profile.mass(0.2)) < 1e-9);
});

test('a hard contact shatters the bottle: splash, broken event before removal, body removed, ledger balanced', async () => {
  const { physics, api, events, audio } = await setup();
  const b = api.adopt(model());
  physics.contact(hit(b.entry, 2)); // weaker hit in the same step: only the strongest counts
  physics.contact(hit(b.entry, 12, { localPoint: [0.035, 0.1, 0], localNormal: [1, 0, 0], velocity: [0, -12, 0], spin: [0, 0, 0] }));
  physics.step(1 / 60);
  assert.equal(events.length, 1);
  assert.equal(events[0][1].bottle, b);
  assert.ok(b.broken);
  assert.ok(!api.bottles.has(b));
  assert.ok(b.entry.removed, 'its body is removed through the adapter');
  assert.ok(api.pour.flights.length >= 8, 'the liquid splashes as drops');
  assert.ok(Math.abs(api.ledger().errorMl) < 1e-6);
  assert.ok(audio.played.includes('smallShatter'));
});

test('optional contact fields (local point/normal, velocity) are derived from the body when an adapter leaves them out', async () => {
  const { physics, api, events } = await setup();
  const b = api.adopt(model());
  physics.contact(hit(b.entry, 12)); // point is 0.1 m above the base in world space
  physics.step(1 / 60);
  assert.equal(events.length, 1);
});

test('a moderate hit only cracks (damage mark); a held bottle ignores impacts', async () => {
  const { physics, api, events } = await setup();
  const b = api.adopt(model());
  physics.contact(hit(b.entry, 4, { localPoint: [0.035, 0.1, 0], localNormal: [1, 0, 0] }));
  physics.step(1 / 60);
  assert.equal(events.length, 0);
  assert.equal(b.damageStage, 'crack');
  assert.equal(b.damageMarks.length, 1);
  const agitation = b.liquid.agitation;
  physics.hold(b.entry, { position: [0, 1.4, 0], quaternion: [0, 0, 0, 1] });
  b.lastImpact = -Infinity;
  physics.contact(hit(b.entry, 30));
  physics.step(1 / 60);
  assert.equal(events.length, 0, 'held bottles do not break from contacts');
  assert.equal(b.liquid.agitation, agitation);
  assert.ok(Math.abs(b.root.position.y - 1.4) < 1e-9, 'the held pose is synced to the model');
});

test('contacts below the impact speed and contacts on unknown bodies are ignored', async () => {
  const { physics, api, events } = await setup();
  const b = api.adopt(model());
  const other = physics.addBody({ type: 'sphere', radius: 0.1 }, 1, {});
  physics.contact(hit(b.entry, IMPACT_MIN_SPEED));
  physics.contact(hit(other, 50));
  physics.step(1 / 60);
  assert.equal(events.length, 0);
  assert.equal(b.liquid.agitation, 0);
});

test('quality follows the host: tiers switch liquid detail, shadows and effect ceilings; a pinned tier stays', async () => {
  const { physics, api, host } = await setup({ quality: 3 });
  const b = api.adopt(model());
  const glass = b.root.children[0];
  assert.equal(api.tier, 'high');
  assert.equal(b.liquid.bubbles, 1); assert.equal(glass.castShadow, true);
  host.setQuality(0);
  assert.equal(api.tier, 'minimal');
  assert.equal(api.factory.quality, 0);
  assert.equal(b.liquid.bubbles, 0); assert.equal(b.liquid.slosh, false); assert.equal(glass.castShadow, false);
  assert.equal(api.breakage.settings.maxDebris, BOTTLE_QUALITY.minimal.maxDebris);
  // Drops over the minimal ceiling merge into the newest drop: fewer meshes, same volume.
  api.pour.initialMl += 1000;
  for (let i = 0; i < BOTTLE_QUALITY.minimal.maxFlights + 50; i++) api.pour.emit(1000 / (BOTTLE_QUALITY.minimal.maxFlights + 50), new THREE.Vector3(0, 5, 0));
  assert.equal(api.pour.flights.length, BOTTLE_QUALITY.minimal.maxFlights);
  assert.ok(Math.abs(api.ledger().errorMl) < 1e-6);
  host.setTier('bottles', 'low');
  host.setQuality(3);
  assert.equal(api.tier, 'low', 'pinned');
  host.setTier('bottles', null);
  assert.equal(api.tier, 'high');
  physics.step(1 / 60);
});

test('shattering on a low tier spawns fewer debris bodies and trims them to the ceiling', async () => {
  const { physics, api, host } = await setup({ quality: 3 });
  const pane = api.breakage.pane('test', [0, 1, -1], 0, [1, 1]);
  const before = physics.bodies.size;
  api.breakage.breakPane(pane, new THREE.Vector3(0, 1, -1), 1000, false);
  const high = physics.bodies.size - before;
  assert.equal(high, 32);
  const box = [...physics.bodies].at(-1);
  assert.equal(box.shape.type, 'box');
  assert.deepEqual([box.options.group, box.options.mask, box.options.contacts], [2, 1 | 4, false], 'debris: own group, no contact reports');
  api.reset();
  assert.equal(physics.bodies.size, before);
  host.setQuality(1); // low: every 2nd shard
  api.breakage.breakPane(pane, new THREE.Vector3(0, 1, -1), 1000, false);
  assert.equal(physics.bodies.size - before, 16);
  host.setQuality(0); // minimal: 60 debris
  for (let i = 0; i < 6; i++) { pane.broken = false; api.breakage.breakPane(pane, new THREE.Vector3(0, 1, -1), 1000, false); }
  assert.ok(api.breakage.debris.length <= BOTTLE_QUALITY.minimal.maxDebris);
  assert.equal(physics.bodies.size - before, api.breakage.debris.length);
});

test('dispose removes every body and listener', async () => {
  const { physics, api, host } = await setup();
  api.adopt(model()); api.adopt(model({ shatters: false, material: 'plastic' }));
  assert.equal(physics.listeners, 2);
  host.dispose('bottles');
  assert.equal(physics.bodies.size, 0);
  assert.equal(physics.listeners, 0);
});

// --- cannon-es only in the adapter -----------------------------------------------------------------------------------
const gameSystems = fileURLToPath(new URL('../../', import.meta.url));
const ADAPTER = /(^|[\\/])adapters[\\/]physics-cannon\.js$/;
function sources(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(e.name)) continue;
    const p = resolve(dir, e.name);
    if (e.isDirectory()) out.push(...sources(p));
    else if (/\.(m?js|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('cannon-es is imported only by extensions/adapters/physics-cannon.js (and its synced copy)', () => {
  const roots = ['extensions', 'webxr-demo/src', 'webxr-demo/tests', 'webxr-demo/scripts', 'apps'].map(d => resolve(gameSystems, d));
  const offenders = [];
  for (const file of roots.flatMap(sources)) {
    if (ADAPTER.test(file)) continue;
    const code = readFileSync(file, 'utf8');
    if (/(from\s*|import\s*\(\s*|require\s*\(\s*)['"]cannon-es['"]|\bCANNON\./.test(code)) offenders.push(relative(gameSystems, file).split(sep).join('/'));
  }
  assert.deepEqual(offenders, [], 'only the cannon adapter may use cannon-es');
});

test('the bottles extension source never mentions a physics engine', () => {
  const dir = resolve(gameSystems, 'extensions/bottles');
  for (const f of readdirSync(dir).filter(f => f.endsWith('.js'))) {
    assert.doesNotMatch(readFileSync(resolve(dir, f), 'utf8'), /cannon-es|\bCANNON\b|\.body\.(velocity|angularVelocity|mass|type|position|quaternion)\b/, f);
  }
});
