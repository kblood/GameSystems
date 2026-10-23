// Audio wired into the games (extensions/audio: footsteps, creaks, delay by distance, room changes for loops, bottle position).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../extensions/host/index.js';
import { createAcousticsSystem } from '../../extensions/acoustics/index.js';
import { createMechanicsSystem } from '../../extensions/mechanics/index.js';
import audioExtension, { createAudioSystem, createBottleAudioAdapter, createFootstepTracker, createCreakTrigger, SOUND_DATA } from '../../extensions/audio/index.js';
import { createFakeAudioContext, fakeFetch } from './fake-audio.js';

const make = async (quality = 'high', extra = {}) => {
  const ctx = extra.context ?? createFakeAudioContext();
  const audio = createAudioSystem({ context: ctx, quality, fetchBuffer: fakeFetch, ...extra });
  await audio.preload('all');
  audio.setListener(0, 0, 0, 0, 0, -1);
  return { ctx, audio };
};
const tick = (ctx, s = 0.2) => ctx.advance(s);
/** Panner of the newest voice on high: source -> filter -> gain -> panner. */
const pannerOf = ctx => ctx.sources.at(-1).outputs[0].outputs[0].outputs[0];

test('footsteps: one step per ~0.7 m walked, material from the floor, low gain, feet placed on the floor', async () => {
  const { ctx, audio } = await make('high');
  const calls = [];
  const spy = { footstep: o => { calls.push({ ...o, position: [...o.position] }); return audio.footstep(o); } };
  const steps = createFootstepTracker(spy, { surfaceAt: x => (x > 3 ? 'wood' : 'concrete'), gain: 0.4 });
  assert.equal(steps.stride, 0.7);
  let fired = 0;
  for (let i = 0; i <= 100; i++) { fired += steps.update([i * 0.07, 1.7, 0], 0.05); tick(ctx, 0.05); } // 7 m at 1.4 m/s
  assert.equal(fired, 10, 'floor(7.0 / 0.7) steps');
  assert.equal(steps.steps, 10);
  assert.equal(calls.length, 10);
  assert.equal(calls[0].surface, 'concrete'); assert.equal(calls.at(-1).surface, 'wood'); assert.equal(steps.lastSurface, 'wood');
  assert.ok(calls.every(c => c.gain === 0.4 && c.position[1] === 0), 'low gain, y = floor, not head height');
  assert.ok(Math.abs(calls[0].position[2] - calls[1].position[2]) > 0.1, 'alternating feet');
  assert.ok(audio.stats().played >= 9);
  // standing still, drifting, and a teleport make no steps
  const before = steps.steps;
  for (let i = 0; i < 40; i++) steps.update([7, 1.7, 0], 0.05);
  for (let i = 0; i < 40; i++) steps.update([7 + i * 0.0005, 1.7, 0], 0.05);
  steps.update([40, 1.7, 0], 0.016); steps.update([40.1, 1.7, 0], 0.05);
  assert.equal(steps.steps, before);
  // invalid input is ignored; disabled makes none
  assert.equal(steps.update(null, 0.1), 0); assert.equal(steps.update([NaN, 0, 0], 0.1), 0);
  steps.setEnabled(false);
  for (let i = 0; i < 40; i++) steps.update([41 + i * 0.07, 1.7, 0], 0.05);
  assert.equal(steps.steps, before);
  // default surface is concrete without a lookup
  const plain = createFootstepTracker(spy); calls.length = 0;
  for (let i = 0; i < 30; i++) plain.update([i * 0.07, 0, 0], 0.05);
  assert.ok(calls.length >= 2 && calls.every(c => c.surface === 'concrete'));
});

test('footsteps: every surface plays, unknown surfaces fall back to concrete', async () => {
  const { ctx, audio } = await make('mid');
  for (const surface of ['wood', 'metal', 'grass', 'concrete', 'nothing']) { tick(ctx, 0.5); assert.ok(audio.footstep({ surface, gain: 0.4 }), surface); }
  assert.equal(SOUND_DATA.footsteps.wood, 'footstep_wood');
  assert.equal(audio.stats().played, 5);
});

test('room change: running loops are re-muffled when the listener changes room, and follow the acoustics path', async () => {
  const ac = createAcousticsSystem();
  ac.addRoom('bar'); ac.addRoom('hall'); ac.addPortal('door', { a: 'bar', b: 'hall', open: 0 });
  const { ctx, audio } = await make('high', { acoustics: ac });
  audio.setListenerRoom('bar');
  const h = audio.startLoop('slide_loop_wood', { gain: 0.8, position: [2, 0, 0], room: 'bar' });
  assert.ok(h);
  const filter = ctx.sources.at(-1).outputs[0], gain = filter.outputs[0];
  const open = gain.gain.value, openHz = filter.frequency.value;
  assert.equal(openHz, SOUND_DATA.acoustics.maxHz);
  audio.setListenerRoom('hall'); // closed door (35 dB)
  assert.ok(gain.gain.value < open * 0.05, `muffled: ${gain.gain.value} vs ${open}`);
  assert.ok(filter.frequency.value < 1500 && filter.frequency.value >= SOUND_DATA.acoustics.minHz);
  assert.equal(audio.loopCount, 1);
  ac.setPortal('door', 1); // the path changes: the next housekeeping step picks it up (cache 0.25 s)
  tick(ctx, 0.5); audio.step(0.5);
  assert.ok(gain.gain.value > open * 0.5 && filter.frequency.value > 8000, 'door open: nearly back');
  audio.setListenerRoom('bar');
  assert.ok(Math.abs(gain.gain.value - open) < open * 0.01 && filter.frequency.value === SOUND_DATA.acoustics.maxHz, 'same room again');
  // updateLoop keeps the muffling (it used to ignore the room)
  ac.setPortal('door', 0); audio.setListenerRoom('hall');
  audio.updateLoop(h, { gain: 0.8, position: [3, 0, 0] });
  assert.ok(gain.gain.value < open * 0.05);
  // no path at all: the loop stays alive but silent; stop still works
  ac.addRoom('cellar'); audio.setListenerRoom('cellar'); audio.updateLoop(h, { room: 'bar' });
  assert.equal(gain.gain.value, 0); assert.equal(audio.loopCount, 1);
  assert.ok(audio.stopLoop(h)); assert.equal(audio.loopCount, 0);
  assert.ok(audio.stats().loopRefreshes >= 3);
  // a loop without room is unaffected by room changes
  const free = audio.startLoop('slide_loop_hard', { gain: 0.5 }); const g2 = ctx.sources.at(-1).outputs[0].outputs[0];
  const v = g2.gain.value; audio.setListenerRoom('hall'); audio.setListenerRoom('bar');
  assert.equal(g2.gain.value, v); assert.ok(free);
});

test('delayBySpeed: default off; on = distance / 343 m/s capped at 0.25 s; only sounds with a position; loops are not delayed', async () => {
  const off = await make('high');
  off.audio.play('cork_pop', { position: [30, 0, 0], minGap: 0 });
  assert.equal(off.ctx.sources.at(-1).started, 0, 'default: no delay');
  assert.equal(off.audio.delayBySpeed, false);
  const on = await make('high', { delayBySpeed: true });
  assert.equal(on.audio.delayBySpeed, true);
  on.audio.play('cork_pop', { position: [10, 0, 0], minGap: 0 });
  assert.ok(Math.abs(on.ctx.sources.at(-1).started - 10 / 343) < 1e-9);
  tick(on.ctx);
  on.audio.play('cork_pop', { position: [0, 0, 0.5], minGap: 0 });
  assert.ok(Math.abs(on.ctx.sources.at(-1).started - (on.ctx.currentTime + 0.5 / 343)) < 1e-9, '0.5 m: 1.5 ms');
  tick(on.ctx);
  on.audio.play('cork_pop', { minGap: 0 });
  assert.equal(on.ctx.sources.at(-1).started, on.ctx.currentTime, 'no position: at the listener, no delay');
  tick(on.ctx);
  on.audio.startLoop('slide_loop_wood', { position: [20, 0, 0] });
  assert.equal(on.ctx.sources.at(-1).started, on.ctx.currentTime);
  assert.ok(on.audio.stats().delayed >= 2);
  on.audio.delayBySpeed = false; tick(on.ctx);
  on.audio.play('cork_pop', { position: [10, 0, 0], minGap: 0 });
  assert.equal(on.ctx.sources.at(-1).started, on.ctx.currentTime, 'switched off at runtime');
  // the cap: 20 m at 10 m/s would be 2 s, never more than 0.25 s
  const cap = await make('mid', { delayBySpeed: true, speedOfSound: 10 });
  cap.audio.play('cork_pop', { position: [20, 0, 0], minGap: 0 });
  assert.equal(cap.ctx.sources.at(-1).started, 0.25, 'cap');
});

test('adapter with position: argument, focus, withFocus, held bottle (bind) and the position option', async () => {
  const { ctx, audio } = await make('high');
  const adapter = createBottleAudioAdapter(audio);
  const at = () => { const p = pannerOf(ctx); return [p.positionX.value, p.positionY.value, p.positionZ.value]; };
  assert.ok(adapter.play('clink', 90, [1, 2, 3]));
  assert.deepEqual(at(), [1, 2, 3], 'third argument');
  tick(ctx);
  adapter.play('clink', 90);
  assert.deepEqual(at(), [0, 0, 0], 'nothing known: sits on the listener (as before)');
  tick(ctx);
  const bottle = { id: 'b', root: { position: { x: 4, y: 1, z: -2 } } };
  assert.equal(adapter.withFocus(bottle, () => adapter.play('shatter', 90)), true);
  assert.deepEqual(at(), [4, 1, -2], 'focus on a bottle');
  tick(ctx);
  adapter.play('clink', 90); assert.deepEqual(at(), [0, 0, 0], 'focus is cleared after withFocus');
  tick(ctx);
  const host = createHost({ assetURL: p => p });
  const off = adapter.bind(host);
  host.emit('grab', { bottle });
  assert.equal(adapter.held, 1);
  adapter.play('pour', 90); assert.deepEqual(at(), [4, 1, -2], 'held bottle: pouring sounds come from it');
  bottle.root.position.x = 5; tick(ctx);
  adapter.play('pour', 90); assert.deepEqual(at(), [5, 1, -2], 'follows the bottle');
  tick(ctx);
  adapter.setFocus([9, 9, 9]); adapter.play('clink', 90); assert.deepEqual(at(), [9, 9, 9], 'focus beats held'); adapter.clearFocus(); tick(ctx);
  bottle.broken = true; adapter.play('clink', 90); assert.deepEqual(at(), [0, 0, 0], 'a broken bottle is no longer held'); tick(ctx);
  bottle.broken = false;
  host.emit('grab', { bottle }); host.emit('release', { bottle });
  assert.equal(adapter.held, 0);
  off(); host.dispose();
  const fn = createBottleAudioAdapter(audio, { position: key => (key === 'cap' ? [7, 0, 0] : null) });
  tick(ctx); fn.play('cap', 250); assert.deepEqual(at(), [7, 0, 0]);
});

test('creaks: hinge and slider make a creak only while moving, throttled, louder with speed; the extension wires mechanics:changed', async () => {
  const ctx = createFakeAudioContext();
  const host = createHost({ quality: 3, assetURL: p => p });
  const audio = await host.load(audioExtension, { context: ctx, fetchBuffer: fakeFetch, unlock: false });
  await audio.preload('all'); audio.setListener(0, 0, 0, 0, 0, -1);
  const mech = createMechanicsSystem({ emit: (e, d) => host.emit(e, d) });
  mech.add('door', { kind: 'hinge', axis: [0, 1, 0], origin: [1, 0, 0], max: Math.PI / 2 });
  mech.add('drawer', { kind: 'slider', axis: [1, 0, 0], origin: [0, 0, -1], max: 0.4 });
  assert.equal(audio.stats().played, 0, 'adding a mechanism is silent');
  mech.setValue('door', 0.5);
  assert.equal(audio.stats().played, 0, 'a scripted jump (velocity 0) is silent');
  mech.drive('door', 'hand', 4);
  for (let i = 0; i < 20; i++) { mech.step(0.05); host.update(0.05); ctx.advance(0.05); }
  const doorCreaks = audio.stats().played;
  assert.ok(doorCreaks >= 1 && doorCreaks <= 3, `a door moving for a second creaks a few times, not every frame: ${doorCreaks}`);
  mech.release('door', 'hand');
  mech.setLocked('door', true);
  const after = audio.stats().played;
  for (let i = 0; i < 20; i++) { mech.step(0.05); host.update(0.05); ctx.advance(0.05); }
  assert.equal(audio.stats().played, after, 'a stopped door is silent');
  mech.drive('drawer', 'hand', 5);
  for (let i = 0; i < 10; i++) { mech.step(0.05); host.update(0.05); ctx.advance(0.05); }
  assert.ok(audio.stats().played > after, 'drawer creak');
  host.dispose();
  // the trigger on its own: threshold, gap, gain by speed, position from the pose
  const calls = []; const trig = createCreakTrigger({ play: (k, o) => { calls.push([k, o]); return true; } });
  const state = (velocity, id = 'd') => ({ id, kind: 'hinge', velocity, pose: { position: [1, 0, 0] } });
  assert.equal(trig.handle(state(0.1), 0), false, 'below the threshold');
  assert.equal(trig.handle(state(1), 1), true);
  assert.equal(trig.handle(state(1), 1.2), false, 'gap');
  assert.equal(trig.handle(state(-1.6), 2), true, 'negative velocity counts');
  assert.equal(trig.handle(state(1, 'other'), 2), true, 'per mechanism');
  assert.ok(calls[1][1].gain > calls[0][1].gain && calls[1][1].rate > calls[0][1].rate);
  assert.deepEqual(calls[0][1].position, [1, 0, 0]);
  assert.equal(calls[0][0], 'door_hinge_creak');
  assert.equal(trig.handle({ id: 'v', kind: 'valve', velocity: 5 }, 9), false, 'no creak for valves');
  // creaks: false turns it off
  const h2 = createHost({ quality: 3 });
  const x = await h2.load(audioExtension, { context: createFakeAudioContext(), fetchBuffer: fakeFetch, unlock: false, creaks: false });
  h2.emit('mechanics:changed', state(2)); assert.equal(x.stats().played, 0); h2.dispose();
});

test('sharedContext: the game own AudioContext is borrowed (never created or closed here); without it the system stays silent', async () => {
  const own = createFakeAudioContext();
  let available = null;
  const audio = createAudioSystem({ sharedContext: () => available, fetchBuffer: fakeFetch, createContext: () => { throw new Error('must not create'); } });
  assert.equal(audio.play('cork_pop'), false); assert.equal(await audio.preload('all'), 0); assert.equal(audio.available, false);
  available = own;
  assert.ok(await audio.preload(['cork_pop']) > 0);
  assert.equal(audio.available, true);
  audio.setListener(0, 0, 0, 0, 0, -1);
  assert.equal(audio.play('cork_pop'), true);
  audio.dispose();
  assert.equal(own.closed, false, 'the game keeps its context');
});

test('extension options reach the system (delayBySpeed); the default stays as before', async () => {
  const host = createHost({ quality: 3, assetURL: p => p });
  const audio = await host.load(audioExtension, { context: createFakeAudioContext(), fetchBuffer: fakeFetch, unlock: false });
  assert.equal(audio.delayBySpeed, false);
  host.dispose();
  const h2 = createHost({ quality: 3, assetURL: p => p });
  const a2 = await h2.load(audioExtension, { context: createFakeAudioContext(), fetchBuffer: fakeFetch, unlock: false, delayBySpeed: true });
  assert.equal(a2.delayBySpeed, true);
  h2.dispose();
});
