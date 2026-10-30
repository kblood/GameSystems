// fire-fx (extensions/fire-fx): quality tiers and hard budgets, the particle pool (ring recycling, limits), the flame
// registry, light choice and scorch ring (pure), and createFireFX with the real three.js in node: instance and draw-call
// counts, frustum culling, light cap, budget caps under spam, no reallocation across frames, setQuality, dispose.
// Shaders are not compiled here (no WebGL in node).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FIRE_FX_TIERS, FIRE_FX_LIMITS, resolveQuality, resolveBudget, tierLimits, createParticlePool, PARTICLE_KIND, createFlameRegistry,
  createScorchRing, selectLights, flameBounds, createFireFX, FLAME_FRAGMENT } from '../../extensions/fire-fx/index.js';

const DT = 1 / 72;
function rig(options = {}) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(80, 1, 0.05, 60);
  camera.position.set(0, 1.6, 3); camera.lookAt(0, 1, 0);
  return { scene, camera, fx: createFireFX({ THREE, scene, camera, ...options }) };
}

test('quality: tier mapping, aliases, targets (high <= 2000 particles, <= 4 lights; lower tiers fewer)', () => {
  assert.equal(resolveQuality('mid'), 'medium'); assert.equal(resolveQuality('minimal'), 'low'); assert.equal(resolveQuality('high'), 'high');
  assert.throws(() => resolveQuality('ultra'), RangeError);
  assert.equal(FIRE_FX_TIERS.high.particles, 2000); assert.equal(FIRE_FX_TIERS.high.lights, 4);
  for (const key of ['particles', 'lights', 'flames', 'scorches', 'octaves']) {
    assert.ok(FIRE_FX_TIERS.low[key] < FIRE_FX_TIERS.medium[key] || key === 'lights' && FIRE_FX_TIERS.low[key] <= FIRE_FX_TIERS.medium[key], key);
    assert.ok(FIRE_FX_TIERS.medium[key] < FIRE_FX_TIERS.high[key], key);
  }
  const b = resolveBudget({ particles: 99999, lights: 10 });
  assert.equal(b.particles, FIRE_FX_LIMITS.particles); assert.equal(b.lights, 4, 'hard caps clamp the budget');
  assert.deepEqual(tierLimits('low', resolveBudget({ particles: 100 })).particles, 100, 'a budget below the tier wins');
  assert.equal(tierLimits('medium', resolveBudget()).octaves, 3);
  assert.throws(() => resolveBudget({ particles: -1 }), RangeError); assert.throws(() => resolveBudget({ sprites: 3 }), /not a fire-fx budget/);
});

test('pool: fixed capacity, ring recycling when full, limit, step kills expired', () => {
  const p = createParticlePool(4), arrays = [p.pos, p.vel, p.age];
  for (let i = 0; i < 4; i++) assert.equal(p.spawn(i, 0, 0, 0, 0, 0, 1, 0.1, PARTICLE_KIND.spark), i);
  assert.equal(p.live, 4);
  assert.equal(p.spawn(9, 0, 0, 0, 0, 0, 1, 0.1, PARTICLE_KIND.spark), 0, 'full: the oldest slot is recycled');
  assert.equal(p.live, 4); assert.equal(p.pos[0], 9); assert.equal(p.stats().recycled, 1);
  p.setLimit(2); assert.equal(p.live, 2); assert.equal(p.limit, 2);
  p.setLimit(99); assert.equal(p.limit, 4, 'limit never above capacity');
  p.step(0.5); assert.equal(p.live, 2); p.step(0.6); assert.equal(p.live, 0, 'expired');
  // Embers rise, sparks fall.
  const e = p.spawn(0, 0, 0, 0, 0, 0, 5, 0.1, PARTICLE_KIND.ember), s = p.spawn(0, 0, 0, 0, 0, 0, 5, 0.1, PARTICLE_KIND.spark);
  for (let i = 0; i < 30; i++) p.step(DT);
  assert.ok(p.pos[e * 3 + 1] > 0 && p.pos[s * 3 + 1] < 0);
  assert.deepEqual([p.pos, p.vel, p.age], arrays, 'no reallocation');
  const zero = createParticlePool(0); assert.equal(zero.spawn(0, 0, 0, 0, 0, 0, 1, 1, 0), -1); assert.equal(zero.stats().dropped, 1);
});

test('flame registry: hard cap, update by id, move without allocation, remove keeps records consistent', () => {
  const r = createFlameRegistry(3);
  assert.ok(r.add({ id: 'a', position: [0, 0, 0] })); assert.ok(r.add({ id: 'b', position: { x: 1, y: 0, z: 0 }, size: 0.5 })); assert.ok(r.add({ id: 'c', position: [2, 0, 0] }));
  assert.equal(r.add({ id: 'd', position: [3, 0, 0] }), false, 'full'); assert.equal(r.rejected, 1);
  assert.ok(r.add({ id: 'a', position: [5, 5, 5], intensity: 0.3 }), 'known id updates when full'); assert.equal(r.count, 3);
  const rec = r.get('b'), posArray = rec.position;
  assert.ok(r.move('b', [7, 8, 9], 0.9)); assert.equal(rec.position, posArray); assert.deepEqual(rec.position, [7, 8, 9]); assert.equal(rec.size, 0.9);
  assert.equal(r.move('zzz', [0, 0, 0]), false);
  assert.ok(r.remove('a')); assert.equal(r.remove('a'), false);
  assert.ok(r.add({ id: 'd', position: [3, 0, 0] })); assert.equal(r.count, 3);
  assert.deepEqual(new Set(r.list.map(x => x.id)), new Set(['b', 'c', 'd']));
  assert.throws(() => r.add({ id: 'e', position: [NaN, 0, 0] }), RangeError);
  const out = [0, 0, 0]; const radius = flameBounds({ position: [0, 0, 0], normal: [0, 1, 0], size: 1 }, out);
  assert.deepEqual(out, [0, 0.8, 0]); assert.ok(radius > 0.8);
});

test('lights: picks the n best visible flames, best first, no allocation', () => {
  const list = [
    { visible: true, intensity: 1, size: 1, position: [0, 0, -10] },
    { visible: true, intensity: 1, size: 1, position: [0, 0, -1] },
    { visible: false, intensity: 5, size: 5, position: [0, 0, 0] },
    { visible: true, intensity: 0.5, size: 1, position: [0, 0, -2] },
    { visible: true, intensity: 1, size: 2, position: [0, 0, -1] },
  ];
  const idx = new Int32Array(4), score = new Float32Array(4);
  assert.equal(selectLights(list, 2, [0, 0, 0], idx, score), 2);
  assert.deepEqual([...idx.slice(0, 2)], [4, 1]);
  assert.equal(selectLights(list, 4, [0, 0, 0], idx, score), 4, 'only visible flames');
  assert.ok(![...idx].includes(2));
  assert.equal(selectLights(list, 0, [0, 0, 0], idx, score), 0);
});

test('scorch ring: cap, oldest replaced, setLimit keeps the newest packed', () => {
  const s = createScorchRing(4);
  for (let i = 0; i < 6; i++) s.add([i, 0, 0], [0, 2, 0], 0.2);
  assert.equal(s.count, 4); assert.equal(s.replaced, 2);
  assert.deepEqual(s.slots.slice(0, 4).map(x => x.position[0]).sort(), [2, 3, 4, 5]);
  assert.deepEqual(s.slots[0].normal, [0, 1, 0], 'normal normalised');
  s.setLimit(2); assert.equal(s.count, 2); assert.deepEqual(s.slots.slice(0, 2).map(x => x.position[0]), [4, 5]);
  s.add([9, 0, 0], [0, 1, 0], 0.2); assert.equal(s.count, 2); assert.deepEqual(s.slots.slice(0, 2).map(x => x.position[0]).sort(), [5, 9]);
  assert.throws(() => s.add([0, 0, 0], [0, 1, 0], 0), RangeError);
});

test('createFireFX: one InstancedMesh each, allocation = budget, <= 3 draw calls, lights pooled', () => {
  const { scene, fx } = rig();
  const { flames, particles, scorches, lights } = fx.objects;
  assert.ok(flames.isInstancedMesh && particles.isInstancedMesh && scorches.isInstancedMesh);
  assert.equal(particles.instanceMatrix.count, 2000); assert.equal(flames.instanceMatrix.count, 96); assert.equal(scorches.instanceMatrix.count, 64);
  assert.equal(lights.length, 4); assert.ok(lights.every(l => l.isPointLight && l.parent === scene));
  assert.ok(flames.material.isShaderMaterial && flames.material.blending === THREE.AdditiveBlending && flames.material.defines.OCTAVES === 4);
  assert.match(FLAME_FRAGMENT, /OCTAVES/); assert.match(FLAME_FRAGMENT, /uTime/);
  fx.update(DT, 0);
  assert.deepEqual(fx.stats().drawCalls, 0, 'nothing to draw');
  for (let i = 0; i < 6; i++) assert.ok(fx.addFlame({ id: `f${i}`, position: [i - 3, 0, -1], size: 0.4, intensity: 1 }));
  fx.scorch([0, 0, -1], [0, 1, 0], 0.4);
  for (let i = 1; i <= 20; i++) fx.update(DT, i * DT);
  const s = fx.stats();
  assert.equal(s.drawCalls, 3); assert.equal(s.instances.flames, 6); assert.equal(s.instances.scorches, 1);
  assert.equal(s.lights.active, 4, 'max 4 real lights'); assert.equal(lights.filter(l => l.intensity > 0).length, 4);
  const glow = fx.objects.flames.geometry.attributes.flameParams.array;
  assert.equal([0, 1, 2, 3, 4, 5].filter(i => glow[i * 4 + 2] === 1).length, 2, 'the other 2 fake their light in the shader');
  assert.ok(s.particles.live > 0, 'embers rise from visible flames');
  fx.dispose();
});

test('createFireFX: frustum check skips flames behind the camera', () => {
  const { fx } = rig();
  fx.addFlame({ id: 'front', position: [0, 0.5, -1], size: 0.5 });
  fx.addFlame({ id: 'behind', position: [0, 1, 20], size: 0.5 });
  fx.addFlame({ id: 'far-left', position: [-60, 1, 0], size: 0.5 });
  for (let i = 0; i < 30; i++) fx.update(DT);
  const s = fx.stats();
  assert.equal(s.flames.registered, 3); assert.equal(s.flames.drawn, 1); assert.equal(s.lights.active, 1, 'only visible flames get lights');
  assert.ok(s.particles.live > 0);
  fx.moveFlame('behind', [0.5, 0.5, -1]); fx.update(DT);
  assert.equal(fx.stats().flames.drawn, 2);
  fx.dispose();
});

test('createFireFX: budgets are hard caps under spam; no reallocation across frames', () => {
  const { fx } = rig({ budget: { particles: 300, flames: 5, scorches: 3, lights: 2 } });
  const arrays = [fx.objects.particles.instanceMatrix.array, fx.objects.flames.instanceMatrix.array, fx.objects.particles.geometry.attributes.pData.array];
  let added = 0; for (let i = 0; i < 20; i++) added += fx.addFlame({ id: i, position: [i * 0.1, 0, -1], size: 1 }) ? 1 : 0;
  assert.equal(added, 5);
  for (let i = 0; i < 10; i++) fx.scorch([i * 0.1, 0, -1], [0, 1, 0], 0.3);
  let maxLive = 0;
  for (let f = 0; f < 300; f++) {
    fx.spark([0, 1, -1], [0, 1, 0], 200);
    fx.update(DT);
    maxLive = Math.max(maxLive, fx.stats().particles.live);
  }
  const s = fx.stats();
  assert.ok(maxLive <= 300, `live ${maxLive}`); assert.equal(s.particles.capacity, 300); assert.ok(s.particles.recycled > 0, 'full pool recycles');
  assert.ok(s.instances.particles <= 300); assert.equal(s.scorches.live, 3); assert.equal(s.lights.capacity, 2); assert.ok(s.lights.active <= 2);
  assert.ok(fx.spark([0, 0, 0], [1, 0, 0], 10000) <= FIRE_FX_LIMITS.sparksPerCall, 'per-call cap');
  assert.deepEqual([fx.objects.particles.instanceMatrix.array, fx.objects.flames.instanceMatrix.array, fx.objects.particles.geometry.attributes.pData.array], arrays);
  fx.dispose();
});

test('createFireFX: setQuality lowers live caps inside the allocation, changes octaves and lights; stats', () => {
  const { scene, fx } = rig();
  for (let i = 0; i < 6; i++) fx.addFlame({ id: i, position: [i * 0.3 - 1, 0, -1], size: 0.5 });
  for (let i = 0; i < 40; i++) fx.scorch([i * 0.05, 0, -1], [0, 1, 0], 0.2);
  for (let f = 0; f < 120; f++) { fx.spark([0, 1, -1], [0, 1, 0], 40); fx.update(DT); }
  assert.ok(fx.stats().particles.live > 400);
  assert.equal(fx.setQuality('low'), 'low');
  fx.update(DT);
  let s = fx.stats();
  assert.equal(s.quality, 'low'); assert.equal(s.octaves, 2); assert.equal(fx.objects.flames.material.defines.OCTAVES, 2);
  assert.ok(s.particles.live <= 400); assert.equal(s.particles.capacity, 2000, 'allocation unchanged');
  assert.equal(s.lights.active, 1); assert.equal(fx.objects.lights.filter(l => l.visible).length, 1);
  assert.equal(s.scorches.live, 16); assert.equal(s.instances.scorches, 16);
  fx.setQuality('mid'); fx.update(DT); s = fx.stats();
  assert.equal(s.quality, 'medium'); assert.equal(s.lights.active, 2); assert.equal(s.particles.limit, 1000);
  assert.deepEqual(Object.keys(s).sort(), ['budget', 'drawCalls', 'flames', 'instances', 'lights', 'octaves', 'particles', 'quality', 'scorches']);
  assert.throws(() => fx.setQuality('ultra'), RangeError);
  const before = scene.children.length;
  fx.dispose();
  assert.equal(scene.children.length, before - 3 - 4, 'meshes and lights removed');
  assert.equal(fx.moveFlame(0, [0, 0, 0]), false); assert.throws(() => fx.addFlame({ id: 'x', position: [0, 0, 0] }), /disposed/);
  fx.update(DT); fx.dispose();
});

test('createFireFX: argument checks', () => {
  assert.throws(() => createFireFX({}), TypeError);
  assert.throws(() => createFireFX({ THREE, scene: new THREE.Scene() }), /camera/);
  assert.throws(() => createFireFX({ THREE, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), quality: 'ultra' }), RangeError);
});
