// ai extension, perception: sight with cone / range / occlusion, suspicion that builds and decays, hearing (radius,
// walls, localisation error, never a sight target), the time-sliced ray budget and the AI world's stimulus bus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPerceptionState, look, hear, sense, updateAwareness, sightRate, PERCEPTION_DEFAULTS, createRng, createGuardBrain, createZombieBrain, createAIWorld } from '../../extensions/ai/index.js';
import { level, run, vrPlayer, segmentHitsBox } from './ai-fixture.js';

const cfg = { ...PERCEPTION_DEFAULTS };
const player = (x, z, extra = {}) => ({ active: true, head: { x, y: 1.6, z }, floorY: 0, light: 1, speed: 0, ...extra });
const eye = { x: 0, y: 1.6, z: 0 };
const open = () => false;

test('sight: inside the cone and range a sample is seen; behind, out of range or behind a wall it is not', () => {
  const p = createPerceptionState();
  // yaw 0 faces +Z
  assert.equal(look(p, cfg, eye, 0, player(0, 5), open, 4), 1); assert.equal(p.seen, true); assert.equal(p.seenIndex, 1, 'torso is checked first');
  look(p, cfg, eye, Math.PI, player(0, 5), open, 4); assert.equal(p.seen, false, 'behind the agent');
  look(p, cfg, eye, 0, player(0, 30), open, 4); assert.equal(p.seen, false, 'out of range');
  const wall = { min: [-2, 0, 2], max: [2, 3, 2.3] };
  const rays = look(p, cfg, eye, 0, player(0, 5), (a, b) => segmentHitsBox(a, b, wall), 4);
  assert.equal(p.seen, false); assert.equal(rays, 4, 'every sample is tried before giving up');
  // a low wall hides the torso but not the head
  const low = { min: [-2, 0, 2], max: [2, 1.45, 2.3] };
  look(p, cfg, eye, 0, player(0, 5), (a, b) => segmentHitsBox(a, b, low), 4);
  assert.equal(p.seen, true); assert.equal(p.seenIndex, 0, 'head over the low wall');
  // the ray budget caps the rays of one update
  assert.equal(look(p, cfg, eye, 0, player(0, 5), (a, b) => segmentHitsBox(a, b, wall), 2), 2);
});

test('sight rate: periphery, distance, darkness and crouching slow detection; motion speeds it up', () => {
  const base = sightRate(cfg, 1, 3, 1, 1.6, 0);
  assert.ok(sightRate(cfg, Math.cos(50 * Math.PI / 180), 3, 1, 1.6, 0) < base);
  assert.ok(sightRate(cfg, 1, 20, 1, 1.6, 0) < base);
  assert.ok(sightRate(cfg, 1, 3, 0, 1.6, 0) < base);
  assert.ok(sightRate(cfg, 1, 3, 1, 0.9, 0) < base);
  assert.ok(sightRate(cfg, 1, 3, 1, 1.6, 2) > base);
});

test('suspicion builds while seen, sets last known position and memory, and decays when unseen', () => {
  const p = createPerceptionState(), at = { x: 1, y: 1.2, z: 4 };
  p.seenRate = 1;
  updateAwareness(p, cfg, 0.2, true, at);
  assert.ok(p.suspicion > 0.29 && p.suspicion < 0.31, `${p.suspicion}`);
  assert.deepEqual(p.lastKnown, at); assert.equal(p.memory, cfg.memory);
  let reached = false;
  for (let i = 0; i < 10 && !reached; i++) reached = updateAwareness(p, cfg, 0.1, true, at);
  assert.ok(reached && p.suspicion === 1, 'contact at suspicion 1');
  for (let i = 0; i < 20; i++) updateAwareness(p, cfg, 0.1, false, at);
  assert.ok(Math.abs(p.suspicion - 0.5) < 1e-9, `decays at decayRate (${p.suspicion})`);
  assert.ok(Math.abs(p.memory - (cfg.memory - 2)) < 1e-9);
  for (let i = 0; i < 200; i++) updateAwareness(p, cfg, 0.1, false, at);
  assert.equal(p.alert, false); assert.equal(p.suspicion, 0); assert.equal(p.memory, 0);
});

test('hearing: inside the radius, quieter through walls, localised with bounded error, never sets seen', () => {
  const rng = createRng(4);
  const p = createPerceptionState();
  const shot = { type: 'gunshot', position: { x: 0, y: 1.5, z: 20 }, radius: 30 };
  const loud = hear(p, cfg, shot, eye, null, rng, 0);
  assert.ok(loud > 0.3 && loud < 0.4, `${loud}`);
  assert.equal(p.seen, false); assert.equal(p.alert, true); assert.equal(p.memory, cfg.hearingMemory);
  assert.ok(Math.hypot(p.lastKnown.x - 0, p.lastKnown.z - 20) <= Math.min(cfg.hearingErrorMax, 20 * cfg.hearingErrorPerM) + 1e-9);
  const q = createPerceptionState();
  const wall = { min: [-5, 0, 10], max: [5, 3, 10.3] };
  const muffled = hear(q, cfg, shot, eye, (a, b) => segmentHitsBox(a, b, wall), rng, 0);
  assert.ok(muffled > 0 && muffled < loud * 0.5, 'quieter through a wall');
  assert.equal(hear(createPerceptionState(), cfg, { ...shot, position: { x: 0, y: 1.5, z: 40 } }, eye, null, rng, 0), 0, 'out of earshot');
  assert.equal(hear(createPerceptionState(), { ...cfg, hearing: 0.5 }, shot, eye, null, rng, 0), 0, 'a deaf listener (hearing 0.5) misses it');
  // inside the stimulus window the louder stimulus wins
  const r = createPerceptionState();
  hear(r, cfg, { type: 'gunshot', position: { x: 0, y: 1.5, z: 3 }, radius: 30 }, eye, null, rng, 1);
  assert.equal(hear(r, cfg, { type: 'footstep', position: { x: 2, y: 0, z: 1 }, radius: 4 }, eye, null, rng, 1.1), 0);
});

test('sense radius: zombies notice the player within touch range without a ray', () => {
  const p = createPerceptionState();
  assert.equal(sense(p, { ...cfg, senseRadius: 1.4 }, { x: 0, y: 0, z: 0 }, player(0, -1)), true);
  assert.equal(sense(createPerceptionState(), { ...cfg, senseRadius: 1.4 }, { x: 0, y: 0, z: 0 }, player(0, -3)), false);
  assert.equal(sense(createPerceptionState(), cfg, { x: 0, y: 0, z: 0 }, player(0, -1)), false, 'guards have none');
});

test('world: sight rays are time-sliced under a fixed per-tick budget and every agent still gets its turn', () => {
  const lvl = level({ config: { raysPerTick: 6 } });
  // 8 guards that cannot see the player (a wall), so each look spends all its rays
  lvl.boxes.push({ min: [-8, 0, 2], max: [8, 3, 2.4] });
  const guards = [];
  for (let i = 0; i < 8; i++) guards.push(lvl.add(createGuardBrain(), [-7 + i * 2, 0, -2]));
  let maxPerTick = 0, before = 0;
  const looked = new Set();
  run(lvl, 1, vrPlayer(0, 5), { onFrame: () => {
    const s = lvl.world.stats(); maxPerTick = Math.max(maxPerTick, s.raysInTick);
    for (const g of guards) if (g.perception.rays > 0) looked.add(g.id);
    before = s.sightRays;
  } });
  assert.ok(maxPerTick <= 6, `sight rays per tick ${maxPerTick}`);
  assert.equal(looked.size, 8, 'round-robin reaches every agent');
  assert.ok(before > 0);
});

test('world: stimuli are heard on the next tick, with per-type default radii', () => {
  const lvl = level();
  const near = lvl.add(createZombieBrain(), [0, 0, -5]), far = lvl.add(createZombieBrain(), [0, 0, -11]);
  const heard = [];
  lvl.world.on('heard', e => heard.push(e.agent.id + ':' + e.stimulus.type));
  lvl.world.stimulus({ type: 'footstep', position: [0, 0, -2] });
  assert.equal(heard.length, 0, 'queued until the next tick');
  lvl.world.update(1 / 30, null);
  assert.deepEqual(heard, [`${near.id}:footstep`], 'a footstep (4 m) reaches only the near zombie');
  lvl.world.stimulus({ type: 'gunshot', position: [0, 1.5, 0] });
  lvl.world.update(1 / 30, null);
  assert.ok(heard.includes(`${far.id}:gunshot`), 'a gunshot (30 m) reaches both');
  assert.throws(() => lvl.world.stimulus({ type: 'gunshot' }), /position/);
});

test('world: the player\'s own fast steps are footstep stimuli; teleports are not motion', () => {
  const world = createAIWorld({ config: { playerFootsteps: { radius: 6, minSpeed: 0.7, interval: 0.5 } } });
  const stims = [];
  world.on('heard', e => stims.push(e.stimulus));
  world.addAgent(createZombieBrain(), { position: { x: 0, y: 0, z: -3 } });
  let z = 0;
  for (let i = 0; i < 90; i++) { z -= 1.5 / 60; world.update(1 / 60, { head: { x: 0, y: 1.6, z } }); }
  assert.ok(stims.some(s => s.type === 'footstep' && s.source === 'player'), 'walking at 1.5 m/s makes noise');
  const quiet = createAIWorld();
  const q = [];
  quiet.on('heard', e => q.push(e));
  quiet.addAgent(createZombieBrain(), { position: { x: 0, y: 0, z: -3 } });
  for (let i = 0; i < 90; i++) quiet.update(1 / 60, { head: { x: 0, y: 1.6, z: i === 45 ? -1 : 0 } });
  assert.equal(q.length, 0, 'standing still (and a one-frame jump) is silent');
});
