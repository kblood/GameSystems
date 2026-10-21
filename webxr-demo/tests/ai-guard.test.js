// ai extension, guard brain (JS port of the NightfallContractsGodot guard): state transitions, telegraph before the
// first shot, hearing never gives a firing target, squad fire discipline (turn-taking, no volleys), a single flanker,
// cover under suppression, hit zones and magazine / reload, the physical-state pause, difficulty knobs, determinism.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuardBrain, resolveGuardConfig, spreadDeg, guardZone, GUARD_DEFAULTS, SQUAD_DEFAULTS } from '../../extensions/ai/index.js';
import { level, run, vrPlayer, record } from './ai-fixture.js';

const desk = (x = 0, z = 0) => vrPlayer(x, z, { hands: false });

test('guard: patrol -> investigate a gunshot -> engage on sight -> telegraph, fire, empty the magazine, reload', () => {
  const lvl = level();
  const g = lvl.add(createGuardBrain({ magazine: 4, reserves: 4, sightRange: 23 }), [0, 0, -10], Math.PI);   // facing away
  const events = record(lvl.world);
  run(lvl, 1, desk(0, 0));
  assert.equal(g.brain.state, 'patrol');
  lvl.world.shotFired({ x: 0, y: 1.5, z: 0 }, { x: 5, y: 1.5, z: 5 });
  run(lvl, 0.2, desk(0, 0));
  assert.equal(g.brain.state, 'investigate');
  run(lvl, 20, desk(0, 0));
  const modes = [...new Set(events.filter(e => e.type === 'fire' || e.type === 'reload').map(e => e.type))];
  assert.deepEqual(modes, ['fire', 'reload']);
  const tele = events.find(e => e.type === 'telegraph'), first = events.find(e => e.type === 'fire');
  assert.ok(tele && first.t - tele.t >= GUARD_DEFAULTS.telegraphTime - 1e-6, `telegraph ${tele?.t} -> first shot ${first.t}`);
  assert.equal(events.filter(e => e.type === 'fire').length, 8, 'magazine + reserves, never more');
  const s = g.brain.status();
  assert.equal(s.rounds + s.reserves, 0);
  assert.equal(s.state, 'exhausted', 'out of ammunition: alive, seeks cover, invents nothing');
});

test('guard: hearing alone never gives a firing target (player behind a wall)', () => {
  const lvl = level({ boxes: [{ min: [-8, 0, -3.2], max: [8, 3, -2.8] }] });
  const g = lvl.add(createGuardBrain(), [0, 0, -8]);
  const events = record(lvl.world);
  for (let i = 0; i < 10; i++) { lvl.world.shotFired({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 1.5, z: 9 }); run(lvl, 1.5, desk(0, 0)); }
  assert.notEqual(g.brain.state, 'patrol');
  assert.equal(events.filter(e => e.type === 'fire').length, 0);
});

/** Four guards in a line with a clear view of the player; returns the events. */
function firefight(seed = 3, seconds = 25, extra = {}) {
  const lvl = level({ seed, boxes: [{ min: [-2.5, 0, -6.4], max: [-1.5, 1.1, -6.0] }, { min: [1.5, 0, -6.4], max: [2.5, 1.1, -6.0] }] });
  const guards = [];
  for (let i = 0; i < 4; i++) guards.push(lvl.add(createGuardBrain({ magazine: 30, ...extra }), [-4.5 + i * 3, 0, -9]));
  const events = record(lvl.world);
  let maxFlankers = 0;
  run(lvl, seconds, desk(0, 0), { onFrame: () => { maxFlankers = Math.max(maxFlankers, lvl.world.squad.flankers.length); } });
  return { lvl, guards, events, maxFlankers };
}

test('squad: fire discipline - no synchronized volleys, at most two shooters at a time', () => {
  const { events } = firefight();
  const shots = events.filter(e => e.type === 'fire');
  assert.ok(shots.length > 10, `${shots.length} shots`);
  for (let i = 0; i < shots.length; i++) {
    const window = shots.filter(s => s.t <= shots[i].t && s.t > shots[i].t - SQUAD_DEFAULTS.shooterWindow);
    assert.ok(new Set(window.map(s => s.id)).size <= SQUAD_DEFAULTS.maxConcurrentShooters, `shooters at ${shots[i].t}`);
    if (i > 0 && shots[i].id !== shots[i - 1].id) assert.ok(shots[i].t - shots[i - 1].t >= SQUAD_DEFAULTS.minShotGap - 1e-6, `gap at ${shots[i].t}`);
  }
  assert.ok(new Set(shots.map(s => s.id)).size >= 2, 'turns rotate between guards');
});

test('squad: a single flanker at a time, and one does flank', () => {
  const { events, maxFlankers } = firefight(5, 30, { aggression: 0.8 });
  assert.equal(maxFlankers, 1);
  const flanks = events.filter(e => e.type === 'state' && e.to === 'flank');
  assert.ok(flanks.length >= 1, 'somebody flanked');
  // never two in the flank tactic at once
  const inFlank = new Set();
  for (const e of events.filter(e => e.type === 'state')) {
    if (e.to === 'flank') inFlank.add(e.id); else if (e.from === 'flank') inFlank.delete(e.id);
    assert.ok(inFlank.size <= 1);
  }
});

test('guard: near misses suppress; suppressed guards take validated cover that hides them from the player\'s head and VR lean', () => {
  const crate = { min: [-0.6, 0, -5.2], max: [0.6, 1.6, -4.8] };   // high enough to hide a crouched guard (crouch drop 0.26 m, as in Godot)
  const lvl = level({ boxes: [crate] });
  const g = lvl.add(createGuardBrain(), [2.2, 0, -7]);
  const events = record(lvl.world);
  const p = desk(0, 0);
  run(lvl, 3, p);
  assert.equal(g.brain.state, 'engage');
  for (let i = 0; i < 8; i++) { lvl.world.shotFired(p.head, { x: g.position.x + 0.3, y: 1.3, z: g.position.z - 0.5 }); run(lvl, 0.25, p); }
  assert.ok(events.some(e => e.type === 'suppressed'));
  run(lvl, 4, p);
  const s = g.brain.status();
  assert.ok(events.some(e => e.type === 'state' && e.to === 'cover'), 'went to cover');
  assert.ok(s.cover, `cover chosen (${JSON.stringify(events.filter(e => e.type === 'note').map(e => e.reason))})`);
  // the chosen spot hides the crouched head from the head and the lean / duck offsets
  const headAt = { x: s.cover.x, y: 1.6 + 0.1 - 0.26, z: s.cover.z };
  for (const [dx, dy] of [[0, 0], [0.35, 0], [-0.35, 0], [0, -0.4]]) assert.ok(lvl.raycast({ x: p.head.x + dx, y: p.head.y + dy, z: p.head.z }, headAt), `visible from offset ${dx},${dy}`);
  assert.ok(s.coverRays > 0 && s.coverRays <= 200, `cover rays ${s.coverRays}`);
});

test('guard: hit zones, stagger, death; damage overrides zone damage', () => {
  const lvl = level();
  const g = lvl.add(createGuardBrain(), [0, 0, -6]);
  const events = record(lvl.world);
  assert.deepEqual(['head', 'neck', 'chest', 'leftUpperArm', 'rightFoot'].map(guardZone), ['head', 'head', 'body', 'limb', 'limb']);
  let e = lvl.world.hit(g, { region: 'leftUpperArm' });
  assert.equal(g.brain.health, 100 - GUARD_DEFAULTS.zoneDamage.limb); assert.equal(e.zone, 'limb'); assert.ok(e.stagger > 0);
  assert.equal(g.perception.alert, true, 'a hit alerts');
  e = lvl.world.hit(g, { region: 'chest', damage: 10 });
  assert.equal(g.brain.health, 100 - 24 - 10);
  e = lvl.world.hit(g, { region: 'head', point: { x: 0, y: 1.7, z: -6 }, direction: { x: 0, y: 0, z: -1 }, impulse: 2.7 });
  assert.equal(e.killed, true); assert.equal(g.dead, true); assert.equal(e.impulse, 2.7);
  run(lvl, 1, desk(0, 0));
  assert.equal(g.intent.state, 'dead'); assert.equal(g.intent.speed, 0);
  assert.ok(events.some(x => x.type === 'death'));
});

test('guard: destabilized / downed pause tactics and fire, interrupt a reload, and resume after recovery', () => {
  const lvl = level();
  const g = lvl.add(createGuardBrain({ magazine: 3, reserves: 9 }), [0, 0, -8]);
  const events = record(lvl.world);
  const p = desk(0, 0);
  for (let i = 0; i < 1200 && g.brain.state !== 'reload'; i++) run(lvl, 1 / 60, p);
  assert.equal(g.brain.state, 'reload');
  lvl.world.setPhysicalState(g, 'downed');
  const shotsBefore = events.filter(e => e.type === 'fire').length;
  run(lvl, 3, p);
  assert.equal(g.brain.reloadClock, 0, 'reload interrupted: nothing transferred');
  assert.equal(g.brain.rounds, 0); assert.equal(g.brain.reserves, 9);
  assert.equal(g.intent.paused, true); assert.equal(g.intent.speed, 0);
  assert.equal(events.filter(e => e.type === 'fire').length, shotsBefore, 'no shots while down');
  lvl.world.setPhysicalState(g, 'recovering'); run(lvl, 1, p);
  assert.equal(events.filter(e => e.type === 'fire').length, shotsBefore);
  lvl.world.setPhysicalState(g, 'standing'); run(lvl, 8, p);
  assert.equal(g.intent.paused, false);
  assert.ok(events.filter(e => e.type === 'fire').length > shotsBefore, 'fights again after recovery');
});

test('difficulty: presets and knobs, clamped like the original; spread grows with distance, motion and suppression', () => {
  const easy = resolveGuardConfig({ difficulty: 'easy' }), hard = resolveGuardConfig({ difficulty: 'hard' });
  assert.ok(easy.reactionDelay > hard.reactionDelay && easy.telegraphTime > hard.telegraphTime && easy.baseSpread > hard.baseSpread);
  assert.equal(resolveGuardConfig({ reactionDelay: 99, aggression: -2 }).reactionDelay, 2);
  assert.equal(resolveGuardConfig({ aggression: -2 }).aggression, 0);
  assert.equal(resolveGuardConfig({ difficulty: 'hard', shotInterval: 1 }).shotInterval, 1, 'explicit knobs beat the preset');
  const cfg = resolveGuardConfig();
  assert.ok(spreadDeg(cfg, 20, 0, 0, 0) > spreadDeg(cfg, 5, 0, 0, 0));
  assert.ok(spreadDeg(cfg, 5, 2, 0, 0) > spreadDeg(cfg, 5, 0, 0, 0));
  assert.ok(spreadDeg(cfg, 5, 0, 1, 0) > spreadDeg(cfg, 5, 0, 0, 0));
  assert.ok(spreadDeg(cfg, 5, 0, 0, 5) < spreadDeg(cfg, 5, 0, 0, 0), 'a still target lets the guard settle');
});

test('determinism: a squad with the same seed fires the same shots at the same aim points', () => {
  const trace = seed => {
    const { events, guards } = firefight(seed, 12);
    return JSON.stringify({ events, guards: guards.map(g => [g.position.x.toFixed(5), g.position.z.toFixed(5), g.brain.rounds]) });
  };
  assert.equal(trace(9), trace(9));
});
