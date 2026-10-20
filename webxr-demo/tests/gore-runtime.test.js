// The gore runtime (extensions/gore/character.js) on a CharacterCreator character built from the synced assets
// (gore-fixture.js) with fake physics: the baked data matches, severing only switches draw ranges and spawns the baked
// gib (no triangles are cut at runtime), hits land on the right region, skin hidden under clothes stays hidden, and
// dispose gives the character back as it was. Skipped without the assets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { buildCharacter, hasAssets } from './gore-fixture.js';
import { createFakePhysics } from './fake-physics.js';
import { createGoreWorld, decodeGibs } from '../../extensions/gore/index.js';
import goreExtension from '../../extensions/gore/index.js';

const DATA = fileURLToPath(new URL('../../extensions/gore/data/', import.meta.url)), GORE = fileURLToPath(new URL('../../extensions/gore/', import.meta.url));
const skip = !hasAssets() && 'CharacterCreator assets not synced';
let gibs = null;
const load = () => (gibs ??= decodeGibs(JSON.parse(readFileSync(`${DATA}makehuman_cc.gibs.json`, 'utf8')), readFileSync(`${DATA}makehuman_cc.gibs.bin`)));
function setup(options = {}, config = {}) {
  const ch = buildCharacter(options), scene = new THREE.Scene(), physics = createFakePhysics();
  scene.add(ch.root); ch.root.updateMatrixWorld(true);
  const world = createGoreWorld({ THREE, scene, physics, gibs: load(), config, floorY: 0 });
  return { ch, scene, physics, world };
}
const ray = (o, d = [0, 0, -1]) => [new THREE.Vector3(...o), new THREE.Vector3(...d).normalize()];

test('the pure gore modules import neither three.js nor avatar, grasp or a character system', () => {
  for (const f of readdirSync(GORE).filter(f => f.endsWith('.js'))) {
    const src = readFileSync(`${GORE}${f}`, 'utf8'), imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
    assert.ok(!imports.some(i => /avatar|grasp|character-cc|character-vrm/.test(i)), `${f}: ${imports}`);
    if (['regions.js', 'config.js', 'damage.js', 'seams.js', 'bake_format.js', 'assemble.js', 'insides.js'].includes(f)) assert.ok(!imports.includes('three'), `${f} is pure`);
  }
});

test('attach matches the bake; severing an arm switches draw ranges and spawns the baked gib with a physics body', { skip }, () => {
  const { ch, physics, world } = setup({ morphs: { weight_max: 0.5 } }, { gibs: { lifetime: 1 } });
  const before = ch.body.geometry;
  const z = world.attach(ch);
  assert.equal(z.baked, true); assert.ok(z.attachMs < 2000, `attach ${z.attachMs} ms`);
  assert.equal(z.drawCalls(), ch.meshes.length, 'one draw call per mesh while intact');
  assert.notEqual(ch.body.geometry, before, 'the body got the extended (pre-split) geometry');
  const positions = ch.body.geometry.attributes.position.count;
  const ev = z.sever('leftUpperArm', { direction: new THREE.Vector3(1, 0, 0) });
  const sever = ev.find(e => e.type === 'sever');
  assert.deepEqual(sever.lost, ['leftUpperArm', 'leftLowerArm', 'leftHand']);
  assert.ok(sever.ms < 20, `sever ${sever.ms} ms`);
  assert.equal(ch.body.geometry.attributes.position.count, positions, 'no vertices made at runtime');
  assert.equal(world.gibs, 1); assert.equal(physics.bodies.size, 1);
  const body = [...physics.bodies][0];
  assert.ok(body.mass > 0.5 && body.mass < 10, `arm mass ${body.mass} kg`);
  assert.ok(ch.body.geometry.groups.some(g => g.materialIndex === 1), 'the stump cap is drawn');
  assert.ok(z.drawCalls() > ch.meshes.length);
  assert.deepEqual(z.lostRegions(), ['leftUpperArm', 'leftLowerArm', 'leftHand']);
  // lifetime: the gib and its body go away

  for (let i = 0; i < 60; i++) world.update(1 / 30);
  assert.equal(world.gibs, 0); assert.ok([...physics.bodies].every(b => b.removed) || physics.bodies.size === 0);
  z.dispose();
  assert.equal(ch.body.geometry, before, 'dispose restores the original geometry');
});

test('shots land on the right region through the skinned mesh', { skip }, () => {
  const { ch, world } = setup();
  const z = world.attach(ch);
  world.update(1 / 60);
  const h = ch.restHeads();
  const at = (j, dx = 0, dy = 0) => [h[j][0] + dx, h[j][1] + dy, 2];
  for (const [o, region] of [[at('head', 0, 0.02), 'head'], [at('upperChest', -0.03, -0.02), 'chest'], [at('leftLowerArm', 0, 0.06), 'leftUpperArm'], [at('leftLowerLeg', 0, 0.1), 'leftUpperLeg']]) {
    const hit = world.raycast(...ray(o));
    assert.equal(hit?.region, region, `${region} at ${o.map(x => x.toFixed(2))}`);
    assert.equal(hit.zombie, z);
  }
  assert.equal(world.raycast(...ray([3, 1, 2])), null);
  const shot = world.shoot(...ray(at('head', 0, 0.02)), { damage: 200 });
  assert.ok(shot.events.some(e => e.type === 'death')); assert.equal(z.dead, true);
});

test('skin CharacterCreator hides under clothes stays hidden, uncover shows it again', { skip }, () => {
  const under = (c, P) => c.every(i => P[3 * i + 1] > 1.0 && P[3 * i + 1] < 1.3);
  const count = z => z._units.find(u => u.mesh.name === 'Body').asm.triangles;
  let { ch, world } = setup({ hide: { base: under } });
  const hidden = count(world.attach(ch));
  ({ ch, world } = setup());
  const full = count(world.attach(ch));
  ({ ch, world } = setup({ hide: { base: under } }));
  const uncovered = count(world.attach(ch, { uncover: true }));
  assert.ok(hidden < full - 500, `${hidden} < ${full}`); assert.equal(uncovered, full);
});

test('gore off: nothing comes off, the zombie still dies; config errors are reported', { skip }, () => {
  const { ch, world, physics } = setup({}, { goreLevel: 'off' });
  const z = world.attach(ch);
  assert.deepEqual(z.hit({ region: 'neck', damage: 500 }).map(e => e.type), ['damage', 'death']);
  assert.equal(world.gibs, 0); assert.equal(physics.bodies.size, 0);
  assert.throws(() => world.setConfig({ goreLevel: 'extreme' }), /goreLevel/);
});

test('the host extension wraps the world with gore levels as quality tiers', () => {
  const ext = goreExtension();
  assert.equal(ext.id, 'gore'); assert.deepEqual(ext.requires, []);
  assert.ok(typeof ext.init === 'function' && typeof ext.dispose === 'function');
});
