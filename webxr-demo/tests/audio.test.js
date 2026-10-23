import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHost } from '../../extensions/host/index.js';
import { createAcousticsSystem } from '../../extensions/acoustics/index.js';
import { BOTTLE_SOUNDS, BottleAudio } from '../../extensions/bottles/audio.js';
import audioExtension, { createAudioSystem, createBottleAudioAdapter, installUnlock, AUDIO_QUALITY, SOUND_DATA } from '../../extensions/audio/index.js';
import { createFakeAudioContext, fakeFetch } from './fake-audio.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalog = JSON.parse(readFileSync(`${root}audio/catalog.json`, 'utf8'));
const make = async (quality = 'high', extra = {}) => {
  const ctx = extra.context ?? createFakeAudioContext();
  const audio = createAudioSystem({ context: ctx, quality, fetchBuffer: fakeFetch, ...extra });
  await audio.preload('all');
  return { ctx, audio };
};
const tick = (ctx, s = 0.2) => ctx.advance(s); // past every rate limit

test('data: variants match audio/catalog.json, files exist, material sounds and bottle keys resolve', () => {
  for (const [name, s] of Object.entries(SOUND_DATA.sounds)) {
    assert.equal(s.variants, catalog[name]?.variants, `${name} variants differ from catalog.json`);
    for (let i = 1; i <= s.variants; i++) assert.ok(existsSync(`${root}audio/ogg/${name}_${String(i).padStart(2, '0')}.ogg`), `${name}_${i} missing`);
  }
  for (const [key, file] of Object.entries(BOTTLE_SOUNDS)) assert.equal(`${SOUND_DATA.aliases[key]}_01.ogg`, file, `alias ${key}`);
  for (const [thing, material] of Object.entries(SOUND_DATA.things)) assert.ok(SOUND_DATA.materials[material], `${thing} -> ${material}`);
  for (const group of Object.values(SOUND_DATA.groups)) for (const n of group) assert.ok(SOUND_DATA.sounds[n], n);
  for (const n of Object.values(SOUND_DATA.footsteps)) assert.ok(SOUND_DATA.sounds[n], n);
  const contacts = Object.keys(catalog).filter(n => n.startsWith('contact_'));
  assert.equal(contacts.length, 21);
  for (const n of contacts) assert.ok(catalog[n].variants >= 4 && catalog[n].variants <= 6);
});

test('tiers: voice caps 16/32/48, panner type per tier, off is silent and creates no context', async () => {
  assert.deepEqual(['off', 'low', 'mid', 'high'].map(t => AUDIO_QUALITY[t].voices), [0, 16, 32, 48]);
  for (const tier of ['low', 'mid', 'high']) {
    const { ctx, audio } = await make(tier);
    for (let i = 0; i < 200; i++) audio.play('glass_shatter_large', { minGap: 0, priority: 1 });
    const cap = AUDIO_QUALITY[tier].voices;
    assert.equal(audio.activeVoices, cap, tier);
    assert.equal(ctx.live().filter(s => s.stopped === null).length, cap, 'stolen sources are stopped, not left playing');
    assert.equal(ctx.created.panner, tier === 'high' ? cap : 0);
    assert.equal(ctx.created.stereo, tier === 'mid' ? cap : 0);
    assert.equal(ctx.created.filter, tier === 'high' ? cap : 0);
    assert.equal(audio.stats().voicesCreated, cap);
    audio.dispose();
  }
  let created = 0;
  const audio = createAudioSystem({ quality: 'off', createContext: () => { created++; return createFakeAudioContext(); } });
  assert.equal(audio.play('clink'), false);
  assert.equal(audio.contact({ material1: 'wood', speed: 5 }), false);
  assert.equal(created, 0);
  assert.equal(await audio.preload('all'), 0);
  assert.throws(() => createAudioSystem({ quality: 'ultra' }), RangeError);
});

test('tier switch at runtime stops voices, rebuilds the pool and respects the new cap', async () => {
  const { audio } = await make('high');
  for (let i = 0; i < 60; i++) audio.play('glass_shatter_large', { minGap: 0 });
  audio.setQuality('low');
  assert.equal(audio.activeVoices, 0);
  for (let i = 0; i < 60; i++) audio.play('glass_shatter_large', { minGap: 0 });
  assert.equal(audio.activeVoices, 16);
  audio.setQuality('off');
  assert.equal(audio.activeVoices, 0);
  assert.equal(audio.play('glass_shatter_large'), false);
  assert.throws(() => audio.setQuality('x'), RangeError);
});

test('voice pool: oldest of the lowest priority is stolen, lower priority is dropped, nodes are reused', async () => {
  const { ctx, audio } = await make('low');
  for (let i = 0; i < 16; i++) { assert.ok(audio.play('glass_clink_soft', { minGap: 0, priority: 0.5 })); ctx.advance(0.001); }
  const first = ctx.live()[0];
  assert.equal(audio.play('glass_clink_soft', { minGap: 0, priority: 0.2 }), false, 'lower priority than everything playing is dropped');
  assert.equal(audio.stats().culled, 1);
  assert.ok(audio.play('glass_shatter_large', { minGap: 0, priority: 1 }));
  assert.equal(audio.stats().stolen, 1);
  assert.notEqual(first.stopped, null, 'the oldest voice was the one stolen');
  assert.equal(audio.activeVoices, 16);
  tick(ctx, 5);
  assert.equal(audio.activeVoices, 0);
  const before = { ...ctx.created, source: 0 };
  for (let i = 0; i < 100; i++) { audio.play('glass_clink_soft', { minGap: 0 }); ctx.advance(0.01); }
  assert.deepEqual({ ...ctx.created, source: 0 }, before, 'no gain/panner/filter nodes are created while playing');
});

test('rate limit per sound and per source', async () => {
  const { ctx, audio } = await make('high');
  assert.ok(audio.play('glass_clink_hard'));
  assert.equal(audio.play('glass_clink_hard'), false);
  assert.equal(audio.stats().rateLimited, 1);
  assert.ok(audio.play('glass_clink_hard', { minGap: 0 }));
  tick(ctx);
  assert.ok(audio.play('cork_pop', { sourceId: 'b1' }));
  assert.equal(audio.play('glass_clink_soft', { sourceId: 'b1' }), false, 'same source within 30 ms');
  ctx.advance(0.05);
  assert.ok(audio.play('glass_clink_soft', { sourceId: 'b1' }));
});

test('contact: material pair and strength choose sound, gain and pitch', async () => {
  const { ctx, audio } = await make('high');
  const pick = (m1, m2, speed) => { const r = audio.chooseContact(m1, m2, speed); return [r.primary.name, r.secondary?.name ?? null]; };
  assert.deepEqual(pick('wood', 'concrete', 0.8), ['contact_wood_light', 'contact_concrete_light']);
  assert.deepEqual(pick('concrete', 'wood', 2), ['contact_wood_medium', 'contact_concrete_light'], 'order does not matter');
  assert.equal(pick('metal', 'wood', 6)[0], 'contact_metal_hard');
  assert.equal(pick('bottle', 'floor', 2)[0], 'glass_clink_hard', 'thing names map to materials, glass uses the bottle set');
  assert.equal(pick('bottle', 'floor', 6)[0], 'glass_impact_thud');
  assert.equal(pick('mug', 'table', 2)[0], 'contact_ceramic_medium');
  assert.equal(pick('metal', 'fabric', 6)[0], 'contact_fabric_hard', 'a damping material wins');
  assert.equal(pick('cardboard', 'fabric', 2)[0], 'contact_fabric_medium');
  assert.equal(pick('wood', 'wood', 2)[1], null, 'same material: no second layer');
  assert.equal(pick('unknown-thing', undefined, 2)[0], 'contact_concrete_medium', 'unknown falls back to the default material');
  const light = audio.chooseContact('wood', 'wood', 0.3), hard = audio.chooseContact('wood', 'wood', 9, {});
  assert.ok(light.gain < hard.gain && light.rate > hard.rate);
  const gains = [0.3, 1, 1.3, 3, 3.6, 8].map(s => audio.chooseContact('wood', 'wood', s, {}).gain);
  assert.ok(gains[0] < gains[1] && gains[2] < gains[3] && gains[4] < gains[5]);

  assert.equal(audio.contact({ material1: 'wood', material2: 'concrete', speed: 0.1 }), false, 'below minimum speed');
  assert.ok(audio.contact({ material1: 'wood', material2: 'concrete', speed: 2, position: [1, 0, 0], normal: [0, 1, 0] }));
  assert.equal(ctx.live().length, 2, 'high tier layers the second material');
  assert.equal(audio.lastContact.primary.name, 'contact_wood_medium');
  audio.dispose();
  const low = await make('low');
  assert.ok(low.audio.contact({ material1: 'wood', material2: 'concrete', speed: 2 }));
  assert.equal(low.ctx.live().length, 1, 'low tier plays one voice per contact');
});

test('variants: seed picks deterministically, unseeded avoids immediate repeats', async () => {
  const { ctx, audio } = await make('high');
  const used = [];
  for (let i = 0; i < 12; i++) { audio.play('contact_wood_light', { minGap: 0, variantSeed: i }); used.push(ctx.sources.at(-1).buffer); }
  assert.equal(new Set(used).size, 5, 'five variants cycle by seed');
  const seq = [];
  const real = ctx.sources.length;
  for (let i = 0; i < 30; i++) { audio.play('contact_metal_hard', { minGap: 0 }); seq.push(ctx.sources.at(-1).buffer); }
  assert.ok(ctx.sources.length > real);
  for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1], 'no immediate repeat');
});

test('unloaded sounds are skipped (not queued) and load for next time; suspended context drops sounds', async () => {
  const ctx = createFakeAudioContext();
  const audio = createAudioSystem({ context: ctx, fetchBuffer: fakeFetch });
  assert.equal(audio.play('cork_pop'), false);
  assert.equal(audio.stats().unloaded, 1);
  await new Promise(r => setTimeout(r, 5));
  tick(ctx);
  assert.ok(audio.play('cork_pop'), 'a variant that finished loading plays');
  const sus = createFakeAudioContext({ state: 'suspended' });
  const a2 = createAudioSystem({ context: sus, fetchBuffer: fakeFetch });
  await a2.preload(['bottles']);
  assert.equal(a2.play('cork_pop'), false);
  assert.equal(a2.stats().suspended, 1);
  assert.equal(await a2.resume(), true);
  assert.ok(a2.play('cork_pop'));
  const failing = createAudioSystem({ context: createFakeAudioContext(), fetchBuffer: async () => { throw new Error('404'); } });
  await failing.preload(['hand']);
  assert.equal(failing.stats().loadErrors, 5 + 5 + 4);
  assert.equal(failing.play('hand_grab'), false);
});

test('buffers are decoded once and cached', async () => {
  const { ctx, audio } = await make('high');
  const decoded = ctx.decoded, total = Object.values(SOUND_DATA.sounds).reduce((n, s) => n + s.variants, 0);
  assert.equal(decoded, total);
  await audio.preload('all'); await audio.preload(['contacts']);
  assert.equal(ctx.decoded, decoded);
  assert.equal(audio.stats().cached, total);
});

test('invalid numbers are ignored, never thrown: setListener keeps the last pose, a non-finite source position does not throw', async () => {
  const high = await make('high');
  high.audio.setListener(1, 2, 3, 0, 0, -1);
  for (const bad of [[NaN, 0, 0, 0, 0, -1], [0, Infinity, 0, 0, 0, -1], [0, 0, 0, undefined, 0, -1], [0, 0, 0, 0, 0, -1, 0, NaN, 0], ['a', 0, 0, 0, 0, -1]]) {
    assert.doesNotThrow(() => high.audio.setListener(...bad));
  }
  assert.deepEqual([high.ctx.listener.positionX.value, high.ctx.listener.positionY.value, high.ctx.listener.positionZ.value], [1, 2, 3], 'the last valid pose stays');
  tick(high.ctx);
  assert.doesNotThrow(() => high.audio.play('glass_clink_hard', { position: [Infinity, 1, 1], minGap: 0 }));
  assert.doesNotThrow(() => high.audio.play('glass_clink_hard', { position: [NaN, 1, 1], minGap: 0 }));
  assert.doesNotThrow(() => high.audio.play('glass_clink_hard', { position: [0, undefined, 'x'], minGap: 0 }));
  assert.doesNotThrow(() => high.audio.listenerFromMatrix(new Array(16).fill(NaN)));
});

test('spatial: HRTF panner follows the source, stereo pan sign follows the listener, distance fades and culls', async () => {
  const high = await make('high');
  high.audio.setListener(0, 1.6, 0, 0, 0, -1);
  assert.equal(high.ctx.listener.positionY.value, 1.6);
  high.audio.play('glass_clink_hard', { position: [3, 1, -2] });
  assert.equal(high.ctx.created.panner, 1);
  // source -> filter -> gain -> panner
  const hp = high.ctx.sources.at(-1).outputs[0].outputs[0].outputs[0];
  assert.equal(hp.kind, 'panner'); assert.equal(hp.panningModel, 'HRTF');
  assert.deepEqual([hp.positionX.value, hp.positionY.value, hp.positionZ.value], [3, 1, -2]);
  assert.equal(high.audio.play('glass_clink_soft', { position: [500, 0, 0] }), false, 'beyond maxDistance');
  assert.equal(high.audio.stats().culled, 1);

  const mid = await make('mid');
  mid.audio.setListener(0, 0, 0, 0, 0, -1); // looking down -z: +x is right
  const gainOfLast = () => mid.ctx.sources.at(-1).outputs[0]; // source -> gain -> stereo panner
  mid.audio.play('glass_clink_hard', { position: [4, 0, 0], minGap: 0 });
  const right = gainOfLast();
  assert.equal(right.outputs[0].kind, 'stereo');
  assert.ok(right.outputs[0].pan.value > 0.9);
  tick(mid.ctx);
  mid.audio.play('glass_clink_hard', { position: [-12, 0, 0], minGap: 0 });
  const left = gainOfLast();
  assert.ok(left.outputs[0].pan.value < -0.9);
  assert.ok(left.gain.value < right.gain.value, 'further away is quieter');
  // turn the head 90 degrees right (forward = +x): a source at +x is now straight ahead, one at -z is to the left
  mid.audio.listenerFromMatrix([0, 0, -1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1]);
  tick(mid.ctx);
  mid.audio.play('glass_clink_hard', { position: [0, 0, -4], minGap: 0 });
  assert.ok(gainOfLast().outputs[0].pan.value < -0.9);

  const low = await make('low');
  low.audio.setListener(0, 0, 0, 0, 0, -1);
  low.audio.play('glass_clink_hard', { position: [8, 0, 0] });
  const lowGain = low.ctx.sources.at(-1).outputs[0];
  assert.equal(lowGain.kind, 'gain');
  assert.ok(lowGain.gain.value < 0.2 && lowGain.gain.value > 0, 'distance gain without panning');
  assert.equal(low.ctx.created.stereo + low.ctx.created.panner, 0);
});

test('acoustics: sound from another room is muffled by the portal loss (gain + lowpass on high), culled without a path', async () => {
  const ac = createAcousticsSystem();
  ac.addRoom('bar'); ac.addRoom('hall'); ac.addRoom('cellar'); ac.addPortal('door', { a: 'bar', b: 'hall', open: 0 });
  const run = async tier => {
    const { ctx, audio } = await make(tier, { acoustics: ac });
    audio.setListenerRoom('hall');
    const vol = o => { audio.play('glass_shatter_large', { minGap: 0, ...o }); return ctx.sources.at(-1).outputs[0]; };
    return { ctx, audio, vol };
  };
  const high = await run('high');
  // on high: source -> filter -> gain
  const filterNode = high.vol({ room: 'hall' });
  const sameGain = filterNode.outputs[0].gain.value;
  assert.equal(filterNode.kind, 'filter');
  assert.equal(filterNode.frequency.value, SOUND_DATA.acoustics.maxHz);
  tick(high.ctx);
  const closedFilter = high.vol({ room: 'bar' });
  const closedGain = closedFilter.outputs[0].gain.value;
  assert.ok(closedGain < sameGain * 0.05, `closed door ~35 dB: ${closedGain} vs ${sameGain}`);
  assert.ok(closedFilter.frequency.value < 1500 && closedFilter.frequency.value >= SOUND_DATA.acoustics.minHz);
  ac.setPortal('door', 1);
  tick(high.ctx, 0.5); // path cache lives 0.25 s
  const openFilter = high.vol({ room: 'bar' });
  assert.ok(openFilter.outputs[0].gain.value > closedGain * 10 && openFilter.frequency.value > closedFilter.frequency.value * 4);
  tick(high.ctx, 0.5);
  assert.equal(high.audio.play('cork_pop', { room: 'cellar', minGap: 0 }), false, 'no path = inaudible');
  assert.equal(high.audio.stats().culled, 1);

  const mid = await run('mid');
  ac.setPortal('door', 0);
  tick(mid.ctx);
  const g0 = mid.vol({ room: 'hall' }).gain.value; tick(mid.ctx);
  const g1 = mid.vol({ room: 'bar' }).gain.value; // mid: source -> gain -> stereo
  assert.ok(g1 < g0 * 0.05);
  assert.equal(mid.ctx.created.filter, 0, 'no per-voice filter below high');
  // no acoustics api or no listener room: nothing is applied
  const plain = await make('high');
  plain.audio.play('cork_pop', { room: 'bar' });
  assert.equal(plain.ctx.sources.at(-1).outputs[0].frequency.value, SOUND_DATA.acoustics.maxHz);
});

test('loops: start, update, stop; stale handles do nothing', async () => {
  const { ctx, audio } = await make('high');
  audio.setListener(0, 0, 0, 0, 0, -1);
  const h = audio.startLoop('slide_loop_wood', { gain: 0.5, position: [1, 0, 0] });
  assert.ok(h);
  assert.equal(ctx.sources.at(-1).loop, true);
  tick(ctx, 30);
  assert.equal(audio.activeVoices, 1, 'a loop never ends by itself');
  assert.ok(audio.updateLoop(h, { gain: 0.9, rate: 1.2, position: [2, 0, 0] }));
  assert.equal(ctx.sources.at(-1).playbackRate.value, 1.2);
  assert.ok(audio.stopLoop(h));
  assert.equal(audio.stopLoop(h), false);
  assert.equal(audio.updateLoop(h, { gain: 1 }), false);
  tick(ctx, 0.2);
  assert.equal(audio.activeVoices, 0);
  assert.equal(audio.startLoop('nope'), null);
});

test('dispose: stops voices, closes an owned context, further calls are inert; double dispose is safe', async () => {
  let made = null;
  const audio = createAudioSystem({ createContext: () => (made = createFakeAudioContext()), fetchBuffer: fakeFetch });
  await audio.preload(['hand']);
  assert.ok(audio.play('hand_grab'));
  audio.startLoop('slide_loop_hard');
  audio.dispose();
  assert.equal(made.closed, true);
  assert.ok(made.sources.every(s => s.stopped !== null), 'every source was stopped');
  assert.equal(audio.play('hand_grab'), false);
  assert.equal(audio.contact({ material1: 'wood', speed: 3 }), false);
  assert.equal(audio.available, false);
  audio.dispose();
  const given = createFakeAudioContext();
  const b = createAudioSystem({ context: given, fetchBuffer: fakeFetch });
  await b.preload(['hand']); b.dispose();
  assert.equal(given.closed, false, 'a context the game supplied is left open');
});

test('without any AudioContext (node, worker) everything is silent and does not throw', async () => {
  const audio = createAudioSystem({});
  assert.equal(audio.play('clink'), false);
  assert.equal(audio.contact({ material1: 'metal', material2: 'wood', speed: 3 }), false);
  assert.equal(await audio.resume(), false);
  assert.equal(audio.startLoop('slide_loop_hard'), null);
  audio.dispose();
});

test('bottle adapter: BottleAudio keys play through the pool with the same volumes; BottleAudio itself is unchanged', async () => {
  const { ctx, audio } = await make('high');
  const bottles = createBottleAudioAdapter(audio);
  for (const key of Object.keys(BOTTLE_SOUNDS)) { tick(ctx); assert.ok(bottles.play(key), key); }
  assert.equal(bottles.play('nonsense'), false);
  tick(ctx);
  bottles.play('pour');
  const gainOf = () => ctx.sources.at(-1).outputs[0].outputs[0].gain.value;
  assert.ok(Math.abs(gainOf() - 0.25) < 1e-9, 'pour volume 0.25 as in BottleAudio');
  tick(ctx);
  bottles.play('clink', 90);
  assert.equal(bottles.play('clink', 90), false, 'minGapMs');
  assert.ok(new BottleAudio().play('clink') === undefined, 'BottleAudio stays silent without HTMLAudio');
});

test('extension: loads in the host, listens to grab/release/audio events, follows the camera, tiers via the host', async () => {
  const ctx = createFakeAudioContext();
  const camera = { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 1.7, -3, 1] } };
  const host = createHost({ camera, quality: 3, assetURL: p => p });
  const audio = await host.load(audioExtension, { context: ctx, fetchBuffer: fakeFetch, unlock: false });
  assert.ok(audio);
  await audio.preload('all');
  host.update(0.016);
  assert.equal(ctx.listener.positionX.value, 2); assert.equal(ctx.listener.positionY.value, 1.7); assert.equal(ctx.listener.forwardZ.value, -1);
  host.emit('grab', { owner: 'desktop', bottle: { id: 'b1', root: { position: { x: 1, y: 1, z: 1 } } } });
  assert.equal(audio.stats().played, 1);
  tick(ctx);
  host.emit('release', { owner: 'desktop', bottle: { id: 'b1', root: { position: { x: 1, y: 1, z: 1 } } } });
  assert.equal(audio.stats().played, 2);
  tick(ctx);
  host.emit('audio:contact', { material1: 'metal', material2: 'concrete', speed: 4, position: [0, 0, 0] });
  assert.equal(audio.lastContact.primary.name, 'contact_metal_hard');
  host.emit('audio:play', { key: 'cork_pop' });
  assert.equal(audio.stats().played, 5);
  host.setQuality(0);
  assert.equal(audio.quality, 'off');
  assert.equal(audio.activeVoices, 0);
  host.setQuality(3);
  assert.equal(audio.quality, 'high');
  host.dispose();
  assert.equal(audio.available, false);
});

test('unlock helper resumes the context on the first gesture and removes its listeners', async () => {
  const ctx = createFakeAudioContext({ state: 'suspended' });
  const audio = createAudioSystem({ context: ctx });
  const handlers = new Map();
  const target = { addEventListener: (e, h) => handlers.set(e, h), removeEventListener: e => handlers.delete(e) };
  installUnlock(audio, target);
  assert.equal(handlers.size, 4);
  handlers.get('pointerdown')();
  await new Promise(r => setTimeout(r, 5));
  assert.equal(ctx.state, 'running');
  assert.equal(handlers.size, 0);
});
