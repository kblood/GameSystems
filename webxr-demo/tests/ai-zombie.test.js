// ai extension, zombie brain: state transitions (roam -> investigate -> chase -> windup -> lunge -> attack), the VR
// attack rules (telegraph first, shove and hit cancel, damage is an event), the horde (surround slots without stacking,
// attacker cap, escape lane), VR personal space, the gore mobility hand-off, the physical-state hook and determinism.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createZombieBrain, mobilityFromGore, chooseAttack, regionClass, createAIWorld, PHYSICAL_STATES } from '../../extensions/ai/index.js';
import { level, run, vrPlayer, record } from './ai-fixture.js';

const crawler = (arms = 2) => ({ mode: 'crawl', speedFactor: arms === 2 ? 0.32 : arms === 1 ? 0.2 : 0.12, limbs: { leftArm: arms >= 1, rightArm: arms >= 2, leftLeg: false, rightLeg: true }, dead: false, headless: false });

test('zombie: roams, investigates a gunshot, chases on sight, telegraphs, lunges and attacks', () => {
  const lvl = level();
  const z = lvl.add(createZombieBrain(), [0, 0, -9]);
  const events = record(lvl.world);
  run(lvl, 1, vrPlayer(0, 3));
  assert.equal(z.intent.state, 'roam', 'too far to see (7 m) and nothing heard');
  lvl.world.shotFired({ x: 0, y: 1.5, z: 3 }, { x: 0, y: 1.5, z: -20 });
  run(lvl, 0.2, vrPlayer(0, 3));
  assert.equal(z.intent.state, 'investigate');
  run(lvl, 30, vrPlayer(0, 3));
  const states = events.filter(e => e.type === 'state').map(e => e.to);
  for (const s of ['investigate', 'chase', 'windup', 'lunge', 'recover']) assert.ok(states.includes(s), `${s} in ${states.join(',')}`);
  const tele = events.find(e => e.type === 'telegraph'), hit = events.find(e => e.type === 'attack');
  assert.ok(tele && hit, 'telegraph and attack events');
  assert.ok(hit.t - tele.t >= 0.75 + 0.3 - 1e-6, `windup ${hit.t - tele.t}s before the damage`);
  assert.ok(events.findIndex(e => e.type === 'spotted') < events.findIndex(e => e.type === 'telegraph'));
  assert.ok(hit.damage > 0 && ['grab', 'bite'].includes(hit.kind));
});

test('zombie: a fast hand shove or a hit during the windup cancels the attack; intent never moves the player', () => {
  const lvl = level();
  const z = lvl.add(createZombieBrain(), [0, 0, -1.2]);
  const events = record(lvl.world);
  const p = vrPlayer(0, 0);
  for (let i = 0; i < 600 && z.intent.state !== 'windup'; i++) run(lvl, 1 / 60, p);
  assert.equal(z.intent.state, 'windup');
  assert.ok(z.intent.telegraph >= 0);
  // the right hand swings fast into the zombie's chest
  const hand = p.hands[1];
  for (let i = 0; i < 8; i++) {
    hand.x = z.position.x + 0.05; hand.y = 1.3; hand.z = z.position.z + 0.4 - i * 0.06;
    run(lvl, 1 / 60, p);
  }
  assert.ok(events.some(e => e.type === 'shoved'), 'shoved event');
  assert.ok(events.some(e => e.type === 'attackCancelled' && e.reason === 'shoved'));
  assert.equal(events.filter(e => e.type === 'attack').length, 0, 'no damage');
  assert.equal(z.intent.state, 'recover');
  // shooting it in the next windup cancels too, and the hit hook reports the physical inputs
  hand.x = 0.25; hand.y = 1.15; hand.z = -0.25;
  for (let i = 0; i < 600 && z.intent.state !== 'windup'; i++) run(lvl, 1 / 60, p);
  const e = lvl.world.hit(z, { region: 'leftUpperArm', point: { x: 0, y: 1.3, z: -1 }, direction: { x: 0, y: 0, z: -1 }, impulse: 2.7, damage: 30 });
  assert.deepEqual([e.type, e.region, e.impulse, e.damage, e.regionClass], ['hit', 'leftUpperArm', 2.7, 30, 'arm']);
  assert.ok(events.some(x => x.type === 'attackCancelled' && x.reason === 'hit'));
  for (const k of Object.keys(z.intent)) assert.ok(!/camera|player/i.test(k), `intent has no ${k}`);
});

test('horde: zombies take distinct surround slots, at most maxAttackers attack at once, the escape lane stays open', () => {
  const lvl = level();
  const zs = [];
  for (let i = 0; i < 6; i++) zs.push(lvl.add(createZombieBrain({ maxAttackers: 2 }), [-3 + i * 1.2, 0, -5 - (i % 2)]));
  lvl.world.stimulus({ type: 'voice', position: [0, 1.6, 0], radius: 30 });
  let maxAttacking = 0, minPair = Infinity, minHead = Infinity;
  const player = vrPlayer(0, 0);
  run(lvl, 30, player, { onFrame: t => {
    const attacking = zs.filter(z => ['windup', 'lunge'].includes(z.intent.state)).length;
    maxAttacking = Math.max(maxAttacking, attacking);
    if (t > 15) for (let i = 0; i < zs.length; i++) {
      minHead = Math.min(minHead, Math.hypot(zs[i].position.x, zs[i].position.z));
      for (let j = i + 1; j < zs.length; j++) minPair = Math.min(minPair, Math.hypot(zs[i].position.x - zs[j].position.x, zs[i].position.z - zs[j].position.z));
    }
  } });
  assert.ok(maxAttacking >= 1 && maxAttacking <= 2, `attackers at once ${maxAttacking}`);
  const slots = zs.filter(z => z.slot?.index >= 0).map(z => z.slot.index);
  assert.ok(slots.length >= 4, `slotted ${slots.length}`);
  assert.equal(new Set(slots).size, slots.length, 'no two zombies share a slot');
  assert.ok(minPair > 0.3, `no stacking, a lunge may brush past a neighbour (closest pair ${minPair.toFixed(2)} m)`);
  assert.ok(minHead > 0.45, `personal space held (closest ${minHead.toFixed(2)} m)`);
  // nobody stands in the escape lane near the player
  const lane = lvl.world.horde.laneAngle;
  for (const z of zs) {
    const d = Math.hypot(z.position.x, z.position.z);
    if (d > 1.6) continue;
    const a = Math.atan2(z.position.x, z.position.z), off = Math.abs(Math.atan2(Math.sin(a - lane), Math.cos(a - lane)));
    assert.ok(off > 30 * Math.PI / 180, `${z.id} in the escape lane (${(off * 180 / Math.PI).toFixed(0)} deg)`);
  }
  assert.ok(lvl.world.stats().attackers <= 2);
});

test('horde: against a wall the open side stays free (no pinning without an escape)', () => {
  // player with a wall right behind (+Z): the lane must point away from the wall
  const lvl = level({ boxes: [{ min: [-8, 0, 0.6], max: [8, 3, 1] }] });
  for (let i = 0; i < 5; i++) lvl.add(createZombieBrain(), [-2 + i, 0, -4]);
  lvl.world.stimulus({ type: 'voice', position: [0, 1.6, 0], radius: 30 });
  run(lvl, 15, vrPlayer(0, 0));
  const lane = lvl.world.horde.laneAngle;
  assert.ok(Math.cos(lane) < 0.2, `lane points away from the wall (cos ${Math.cos(lane).toFixed(2)})`);
});

test('personal space: zombies never come inside personalSpace of the head or handSpace of a tracked hand', () => {
  const lvl = level();
  const zs = [lvl.add(createZombieBrain({ personalSpace: 0.6 }), [0, 0, -3]), lvl.add(createZombieBrain({ personalSpace: 0.6 }), [1, 0, -3])];
  lvl.world.stimulus({ type: 'voice', position: [0, 1.6, 0], radius: 30 });
  const p = vrPlayer(0, 0);
  let minHead = Infinity, minHand = Infinity;
  run(lvl, 20, p, { onFrame: () => { for (const z of zs) {
    minHead = Math.min(minHead, Math.hypot(z.position.x - p.head.x, z.position.z - p.head.z));
    for (const h of p.hands) minHand = Math.min(minHand, Math.hypot(z.position.x - h.x, z.position.z - h.z));
  } } });
  assert.ok(minHead >= 0.6 - 0.03, `head ${minHead.toFixed(3)}`);
  assert.ok(minHand >= 0.3 - 0.03, `hands ${minHand.toFixed(3)}`);
  // the player steps into a zombie: it backs off on its own (the player is never pushed)
  const z = zs[0];
  p.head.x = z.position.x; p.head.z = z.position.z + 0.3;
  const before = Math.hypot(z.position.x - p.head.x, z.position.z - p.head.z);
  run(lvl, 1, p);
  assert.ok(Math.hypot(z.position.x - p.head.x, z.position.z - p.head.z) > before + 0.1, 'backed off');
});

test('gore hand-off: mobilityFromGore reads the gore zombie; crawlers attack low, armless zombies bite, headless is dead', () => {
  const gore = { mobility: () => 'crawl', speedFactor: () => 0.2, limbs: () => ({ leftArm: false, rightArm: true, leftLeg: false, rightLeg: true }), limpSide: () => null, lost: id => id === 'leftUpperLeg', dead: false };
  const m = mobilityFromGore(gore);
  assert.deepEqual([m.mode, m.speedFactor, m.dead, m.headless], ['crawl', 0.2, false, false]);
  assert.equal(mobilityFromGore({ ...gore, lost: id => id === 'head' }).dead, true, 'headless means dead');
  const player = { head: { x: 0, y: 1.6, z: 0 }, floorY: 0, hands: [{ side: 'left', tracked: true, x: -0.2, y: 1.1, z: -0.3 }, { side: 'right', tracked: true, x: 0.2, y: 1.1, z: -0.3 }] };
  const at = { x: 0, y: 0, z: -0.9 };
  assert.deepEqual(chooseAttack(crawler(2), player, at), { kind: 'ankle', target: 'legs' });
  assert.deepEqual(chooseAttack(crawler(0), player, at), { kind: 'legBite', target: 'legs' });
  assert.equal(chooseAttack({ mode: 'walk', limbs: { leftArm: true, rightArm: true } }, player, at).kind, 'grab');
  assert.deepEqual(chooseAttack({ mode: 'walk', limbs: { leftArm: false, rightArm: false } }, player, at), { kind: 'bite', target: 'head' });
  assert.deepEqual(['head', 'jaw', 'leftHand', 'rightLowerLeg', 'belly'].map(regionClass), ['head', 'head', 'arm', 'leg', 'chest']);
});

test('gore hand-off: a legless crawler is slower, sees less far, and still reaches the player and attacks low', () => {
  const lvl = level();
  const walker = lvl.add(createZombieBrain(), [-1, 0, -4]), crawl = lvl.add(createZombieBrain(), [1, 0, -4]);
  lvl.world.setMobility(crawl, crawler(2));
  const events = record(lvl.world);
  lvl.world.stimulus({ type: 'voice', position: [0, 1.6, 0], radius: 30 });
  let crawlSpeed = 0, walkSpeed = 0;
  run(lvl, 40, vrPlayer(0, 0), { onFrame: () => { crawlSpeed = Math.max(crawlSpeed, crawl.intent.speed); walkSpeed = Math.max(walkSpeed, walker.intent.speed); } });
  assert.equal(crawl.intent.gait, 'crawl');
  assert.ok(crawlSpeed < walkSpeed * 0.5, `crawl ${crawlSpeed.toFixed(2)} vs walk ${walkSpeed.toFixed(2)} m/s`);
  assert.ok(crawl.sense.sightRange < 7);
  assert.ok(crawl.eye.y < 0.5, 'eye near the floor');
  const low = events.filter(e => e.type === 'attack' && e.id === crawl.id);
  assert.ok(low.length > 0, 'the crawler attacked');
  assert.ok(low.every(e => e.kind === 'ankle' && e.target === 'legs'));
  // headless: dead, stops, releases its attack token
  lvl.world.setMobility(walker, { dead: true, headless: true });
  run(lvl, 0.2, vrPlayer(0, 0));
  assert.equal(walker.intent.state, 'dead'); assert.equal(walker.dead, true); assert.equal(walker.intent.speed, 0);
  assert.ok(events.some(e => e.type === 'death' && e.id === walker.id));
});

test('physical state: destabilized / downed / recovering pause movement and attacks; standing resumes', () => {
  assert.deepEqual(PHYSICAL_STATES, ['standing', 'destabilized', 'downed', 'recovering', 'inert']);
  const lvl = level();
  const z = lvl.add(createZombieBrain(), [0, 0, -1.2]);
  const events = record(lvl.world);
  const p = vrPlayer(0, 0);
  for (let i = 0; i < 600 && z.intent.state !== 'windup'; i++) run(lvl, 1 / 60, p);
  assert.equal(z.intent.state, 'windup');
  lvl.world.setPhysicalState(z, 'destabilized');
  run(lvl, 1, p);
  assert.ok(events.some(e => e.type === 'attackCancelled' && e.reason === 'physical'));
  assert.equal(z.intent.paused, true); assert.equal(z.intent.speed, 0);
  assert.equal(events.filter(e => e.type === 'attack').length, 0);
  assert.ok(events.some(e => e.type === 'physical' && e.to === 'destabilized'));
  lvl.world.setPhysicalState(z, 'standing');
  run(lvl, 6, p);
  assert.equal(z.intent.paused, false);
  assert.ok(events.some(e => e.type === 'attack'), 'resumes attacking after recovery');
  assert.throws(() => lvl.world.setPhysicalState(z, 'flying'), /standing/);
  // inert (the lab sets it on death): paused for good, no more attacks
  const attacks = events.filter(e => e.type === 'attack').length;
  lvl.world.setPhysicalState(z, 'inert'); run(lvl, 4, p);
  assert.equal(z.intent.paused, true); assert.equal(z.intent.speed, 0);
  assert.equal(events.filter(e => e.type === 'attack').length, attacks, 'inert never attacks');
});

test('determinism: the same seed gives the same decisions and paths; another seed differs', () => {
  const trace = seed => {
    const lvl = level({ seed, boxes: [{ min: [-3, 0, -3.2], max: [2, 1.2, -2.8] }] });
    for (let i = 0; i < 4; i++) lvl.add(createZombieBrain(), [-3 + i * 2, 0, -7]);
    const events = record(lvl.world);
    run(lvl, 6, vrPlayer(0, 2));
    lvl.world.stimulus({ type: 'gunshot', position: [0, 1.5, 2] });
    run(lvl, 20, vrPlayer(0, 2));
    return JSON.stringify({ events, at: lvl.world.agents.map(a => [a.position.x.toFixed(5), a.position.z.toFixed(5)]) });
  };
  assert.equal(trace(11), trace(11));
  assert.notEqual(trace(11), trace(12));
});

test('world: config validation and the API surface', () => {
  const world = createAIWorld();
  assert.throws(() => world.addAgent({}, { position: [0, 0, 0] }), /brain/);
  const brain = createZombieBrain();
  world.addAgent(brain, { position: [0, 0, 0] });
  assert.throws(() => world.addAgent(brain, { position: [1, 0, 0] }), /one brain per agent/);
  assert.throws(() => world.addAgent(createZombieBrain(), {}), /position/);
  const off = world.on('state', () => {});
  assert.equal(typeof off, 'function');
  assert.equal(world.update(1 / 30, { head: [0, 1.6, 5] }), 1);
  assert.equal(world.update(1, { head: [0, 1.6, 5] }), 4, 'a long frame catches up at most maxTicksPerUpdate ticks');
  assert.equal(world.removeAgent(world.agents[0]), true);
  assert.equal(world.stats().agents, 0);
});
