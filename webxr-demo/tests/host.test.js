import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, createEventBus, tierFor, normalizeTier, assertPhysicsAdapter, CORE_EVENTS } from '../src/vendor/extensions/host/index.js';

const quiet = () => { const errors = []; return { errors, onError: (error, id, phase) => errors.push({ error, id, phase }) }; };

test('event bus delivers in order, unsubscribes and survives a throwing listener', () => {
  const errors = [], bus = createEventBus({ onError: e => errors.push(e) }), seen = [];
  const off = bus.on('grab', d => seen.push(['a', d.owner]));
  bus.on('grab', () => { throw new Error('boom'); });
  bus.on('grab', d => seen.push(['c', d.owner]));
  assert.equal(bus.emit('grab', { owner: 0 }), 2);
  assert.deepEqual(seen, [['a', 0], ['c', 0]]);
  assert.equal(errors.length, 1);
  off();
  bus.emit('grab', { owner: 1 });
  assert.deepEqual(seen.at(-1), ['c', 1]);
  assert.equal(bus.count('grab'), 2);
  assert.equal(bus.emit('nobody', {}), 0);
  // A listener removing itself while handling does not skip the next one.
  const order = [], once = bus.on('xrEnd', () => { order.push(1); once(); });
  bus.on('xrEnd', () => order.push(2));
  bus.emit('xrEnd'); bus.emit('xrEnd');
  assert.deepEqual(order, [1, 2, 2]);
  assert.ok(['grab', 'release', 'broken', 'xrStart', 'xrEnd', 'disconnect', 'handTrackingChanged'].every(e => CORE_EVENTS.includes(e)));
});

test('quality levels map onto extension tiers; lowest level is off, highest the top tier', () => {
  const tiers = ['off', 'low', 'high'];
  assert.deepEqual([0, 1, 2, 3].map(l => tierFor(tiers, l, 3)), ['off', 'low', 'high', 'high']);
  assert.deepEqual([0, 1, 2, 3].map(l => tierFor(['off', 'on'], l, 3)), ['off', 'on', 'on', 'on']);
  assert.deepEqual([0, 1, 2, 3].map(l => tierFor(['low', 'mid', 'high'], l, 3)), ['low', 'mid', 'high', 'high']);
  assert.equal(tierFor(tiers, 99, 3), 'high');
  assert.equal(tierFor(tiers, -1, 3), 'off');
  assert.equal(normalizeTier(tiers, 1), 'low');
  assert.equal(normalizeTier(tiers, 'high'), 'high');
  assert.equal(normalizeTier(tiers, 'ultra'), null);
});

test('extension lifecycle: init gets ctx, update skips off tier, quality switches reach the extension, dispose cleans up', async () => {
  const log = [], { errors, onError } = quiet();
  const host = createHost({ quality: 2, onError, game: { name: 'demo' }, assetURL: p => `base/${p}` });
  const make = options => ({
    id: 'avatar', quality: ['off', 'low', 'high'],
    init(ctx) {
      log.push(['init', ctx.quality, ctx.game.name, ctx.assetURL('a.glb'), options.tag]);
      ctx.on('grab', d => log.push(['grab', d.owner]));
      return { hello: () => 'hi' };
    },
    update(dt) { log.push(['update', dt]); },
    setQuality(tier) { log.push(['quality', tier]); },
    dispose() { log.push(['dispose']); },
  });
  const api = await host.load(async () => ({ default: make }), { tag: 't' }); // shaped like a dynamic import() of a factory module
  assert.equal(api.hello(), 'hi');
  assert.equal(host.get('avatar'), api);
  assert.deepEqual(log.shift(), ['init', 'high', 'demo', 'base/a.glb', 't']);
  host.update(0.016); assert.deepEqual(log.shift(), ['update', 0.016]);
  host.emit('grab', { owner: 'desktop' }); assert.deepEqual(log.shift(), ['grab', 'desktop']);
  host.setQuality(0); assert.deepEqual(log.shift(), ['quality', 'off']);
  host.update(0.016); assert.equal(log.length, 0, 'off tier is not updated');
  host.setQuality(1); assert.deepEqual(log.shift(), ['quality', 'low']);
  host.setQuality(1); assert.equal(log.length, 0, 'unchanged tier is not re-sent');
  assert.equal(host.setTier('avatar', 'high'), 'high'); assert.deepEqual(log.shift(), ['quality', 'high']);
  host.setQuality(0); assert.equal(log.length, 0, 'pinned tier ignores the global level');
  host.setTier('avatar', null); assert.deepEqual(log.shift(), ['quality', 'off']);
  assert.throws(() => host.setTier('avatar', 'ultra'), RangeError);
  host.dispose('avatar');
  assert.deepEqual(log.shift(), ['dispose']);
  assert.equal(host.get('avatar'), null);
  assert.equal(host.events.count('grab'), 0, 'ctx.on listeners are removed with the extension');
  assert.equal(errors.length, 0);
});

test('disposing a dependency tears down transitive dependents and listeners first', async () => {
  const host = createHost({ onError: () => {} }), order = [], events = [];
  await host.load({ id: 'base', init: () => ({ value: 1 }), dispose() { order.push('base'); } });
  await host.load({ id: 'middle', requires: ['base'], init(ctx) {
    ctx.on('change', () => events.push('middle'));
    return { value: ctx.get('base').value + 1 };
  }, dispose() { order.push('middle'); } });
  await host.load({ id: 'leaf', requires: ['middle'], init(ctx) {
    ctx.on('change', () => events.push('leaf'));
    return { value: ctx.get('middle').value + 1 };
  }, dispose() { order.push('leaf'); } });
  assert.deepEqual([host.get('base').value, host.get('middle').value, host.get('leaf').value], [1, 2, 3]);
  assert.equal(host.events.count('change'), 2);

  host.dispose('base');

  assert.deepEqual(order, ['leaf', 'middle', 'base'], 'dependents dispose before their dependency');
  assert.deepEqual([host.state('base'), host.state('middle'), host.state('leaf')], ['absent', 'absent', 'absent']);
  assert.deepEqual([host.get('base'), host.get('middle'), host.get('leaf')], [null, null, null]);
  assert.equal(host.events.count('change'), 0, 'all dependent listeners are removed');
  host.emit('change');
  assert.deepEqual(events, [], 'disposed dependents receive no further events');
});

test('a canceled dependent disposes once when async init later resolves or rejects', async () => {
  for (const rejectInit of [false, true]) {
    const errors = [], host = createHost({ onError: (error, id, phase) => errors.push([error.message, id, phase]) });
    await host.load({ id: 'base', init: () => ({}) });
    let settle, disposed = 0;
    const pending = host.load({ id: 'dependent', requires: ['base'],
      init: () => new Promise((resolve, reject) => { settle = rejectInit ? reject : resolve; }),
      dispose() { disposed++; },
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(host.state('dependent'), 'loading');
    host.dispose('base');
    assert.equal(host.state('dependent'), 'absent');
    settle(rejectInit ? new Error('late init failure') : {});
    assert.equal(await pending, null);
    assert.equal(disposed, 1);
    assert.deepEqual(errors, rejectInit ? [['late init failure', 'dependent', 'init']] : []);
  }
});

test('a failing or missing extension never breaks the host', async () => {
  const { errors, onError } = quiet(), host = createHost({ onError });
  // Missing module (what a dynamic import of an unsynced file does).
  assert.equal(await host.load(() => Promise.reject(new Error('Cannot find module'))), null);
  assert.equal(errors.at(-1).phase, 'load');
  // init throws: disposed, listeners gone, not registered.
  let disposed = 0;
  assert.equal(await host.load({ id: 'bad', init(ctx) { ctx.on('grab', () => {}); throw new Error('nope'); }, dispose() { disposed++; } }), null);
  assert.equal(disposed, 1); assert.equal(host.state('bad'), 'absent'); assert.equal(host.events.count('grab'), 0);
  // update throws: reported once and the extension is disposed.
  let updates = 0;
  await host.load({ id: 'flaky', init() {}, update() { updates++; throw new Error('frame'); }, dispose() { disposed++; } });
  host.update(0.01); host.update(0.01);
  assert.equal(updates, 1); assert.equal(disposed, 2); assert.equal(host.get('flaky'), null);
  // requires: refused until the dependency is ready; duplicates refused.
  assert.equal(await host.load({ id: 'grasp-user', requires: ['grasp'], init() {} }), null);
  assert.ok(await host.load({ id: 'grasp', init: () => ({ v: 1 }) }));
  assert.ok(await host.load({ id: 'grasp-user', requires: ['grasp'], init: ctx => ({ dep: ctx.get('grasp').v }) }));
  assert.equal(host.get('grasp-user').dep, 1);
  assert.equal(await host.load({ id: 'grasp', init() {} }), null);
  assert.equal(await host.load({ nope: true }), null);
  host.dispose();
  assert.deepEqual(host.ids, []);
});

test('an extension disposed while loading is disposed once its init settles', async () => {
  const { onError } = quiet(), host = createHost({ onError });
  let release, disposed = 0;
  const pending = host.load({ id: 'slow', init: () => new Promise(r => { release = r; }), dispose() { disposed++; } });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(host.state('slow'), 'loading');
  host.dispose('slow');
  assert.equal(disposed, 0);
  release({});
  assert.equal(await pending, null);
  assert.equal(disposed, 1);
});

test('physics adapter interface is checked', () => {
  assert.throws(() => assertPhysicsAdapter({ addBody() {} }), /pose, velocity, setMass, hold, release, isHeld, onContact, onStep, remove/);
  assert.throws(() => createHost({ physics: {} }), TypeError);
});
