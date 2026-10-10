// Extension host: loads extensions, gives each a ctx, routes core events and quality changes, and contains failures.
//
//   extension = { id, requires?: ['grasp'], quality?: ['off', 'low', 'high'],
//                 init(ctx) -> api | Promise<api>, update?(dt), setQuality?(tier), dispose?() }
//   ctx = { THREE, scene, renderer, camera, game, physics, assetURL(path), quality (current tier),
//           emit(event, data), on(event, cb) -> unsubscribe, get(extensionId) -> public api | null }
//
// A module may export the extension as `default`, either the object itself or a factory `options => extension`.
// Load optional extensions with a dynamic import so a missing module only disables that feature:
//   await host.load(() => import('./avatar.js'), options)   // resolves to the api, or null when it failed
// Listeners registered through ctx.on are removed when the extension is disposed. An exception from init() or
// update() is reported through onError and the extension is disposed; the game keeps running.
import { createEventBus } from './events.js';
import { tierFor, normalizeTier, isOff, DEFAULT_TIERS } from './quality.js';
import { assertPhysicsAdapter } from './physics.js';

export function createHost({ THREE = null, scene = null, renderer = null, camera = null, game = {}, physics = null,
  assetURL = path => path, quality = 3, maxLevel = 3,
  onError = (error, id, phase) => console.error(`Extension '${id}' failed in ${phase}`, error) } = {}) {
  if (physics) assertPhysicsAdapter(physics);
  const bus = createEventBus({ onError: (error, event) => onError(error, `event:${event}`, 'listener') });
  const records = new Map(); // id -> { ext, state, api, tier, pinned, unsubscribers }
  let level = quality, disposed = false;

  const tiersOf = ext => ext.quality?.length ? ext.quality : DEFAULT_TIERS;

  function contextFor(record) {
    return {
      THREE, scene, renderer, camera, game, physics, assetURL,
      get quality() { return record.tier; },
      emit: (event, data) => bus.emit(event, data),
      on(event, cb) {
        if (record.state !== 'loading' && record.state !== 'ready') return () => {}; // torn down meanwhile
        const off = bus.on(event, cb);
        record.unsubscribers.push(off);
        return off;
      },
      get: id => host.get(id),
    };
  }

  function safeDispose(record) {
    try { record.ext.dispose?.(); } catch (e) { onError(e, record.ext.id, 'dispose'); }
  }

  // ready -> disposed (dispose now); loading -> cancelled (dispose once init settles); failed init -> dispose now.
  function teardown(record, phase, error) {
    if (error) onError(error, record.ext.id, phase);
    for (const off of record.unsubscribers.splice(0)) off();
    if (record.state === 'loading' && !error) record.state = 'cancelled';
    else if (record.state === 'ready' || record.state === 'loading' || (error && record.state === 'cancelled')) { record.state = error ? 'failed' : 'disposed'; safeDispose(record); }
    if (records.get(record.ext.id) === record) records.delete(record.ext.id);
  }

  async function resolveExtension(source, options) {
    let x = typeof source === 'function' ? source(options) : source;
    x = await x;
    if (x && typeof x.init !== 'function' && 'default' in x) x = x.default; // module namespace
    if (typeof x === 'function') x = await x(options); // factory
    if (!x || typeof x.id !== 'string' || !x.id || typeof x.init !== 'function') throw new TypeError('Not an extension: needs { id, init(ctx) }');
    return x;
  }

  const host = {
    events: bus,
    emit: (event, data) => bus.emit(event, data),
    on: (event, cb) => bus.on(event, cb),
    /** Public api of a ready extension, else null. */
    get(id) { const r = records.get(id); return r?.state === 'ready' ? r.api : null; },
    state(id) { return records.get(id)?.state ?? 'absent'; },
    get ids() { return [...records.keys()]; },
    get level() { return level; },

    /** source: extension object, factory, module namespace, or a function returning a promise of one (dynamic import). */
    async load(source, options) {
      if (disposed) return null;
      let ext;
      try { ext = await resolveExtension(source, options); } catch (error) { onError(error, options?.id ?? '?', 'load'); return null; }
      if (records.has(ext.id)) { onError(new Error(`Extension '${ext.id}' is already loaded`), ext.id, 'load'); return null; }
      const missing = (ext.requires || []).filter(id => !host.get(id));
      if (missing.length) { onError(new Error(`Extension '${ext.id}' requires ${missing.join(', ')}`), ext.id, 'load'); return null; }
      const record = { ext, state: 'loading', api: null, tier: tierFor(tiersOf(ext), level, maxLevel), pinned: null, unsubscribers: [] };
      records.set(ext.id, record);
      try {
        const api = await ext.init(contextFor(record));
        if (record.state !== 'loading') { safeDispose(record); return null; } // disposed while loading
        record.api = api ?? {};
        record.state = 'ready';
        return record.api;
      } catch (error) {
        teardown(record, 'init', error);
        return null;
      }
    },

    /** Per-frame update of every ready extension whose tier is not 'off'. */
    update(dt) {
      for (const record of [...records.values()]) {
        if (record.state !== 'ready' || isOff(record.tier) || !record.ext.update) continue;
        try { record.ext.update(dt); } catch (error) { teardown(record, 'update', error); }
      }
    },

    /** Global quality level (0..maxLevel); pinned extensions keep their tier. */
    setQuality(value) {
      level = Math.min(maxLevel, Math.max(0, Number(value) || 0));
      for (const record of records.values()) if (!record.pinned) applyTier(record, tierFor(tiersOf(record.ext), level, maxLevel));
    },
    /** Pin one extension to a tier (name or index); null unpins and follows the global level again. */
    setTier(id, tier) {
      const record = records.get(id); if (!record) return null;
      if (tier == null) { record.pinned = null; applyTier(record, tierFor(tiersOf(record.ext), level, maxLevel)); return record.tier; }
      const name = normalizeTier(tiersOf(record.ext), tier);
      if (!name) throw new RangeError(`Extension '${id}' has no quality tier ${tier} (${tiersOf(record.ext).join(', ')})`);
      record.pinned = name; applyTier(record, name);
      return name;
    },
    tier(id) { return records.get(id)?.tier ?? null; },

    dispose(id) {
      if (id !== undefined) { const r = records.get(id); if (r) teardown(r, 'dispose'); return; }
      disposed = true;
      for (const record of [...records.values()].reverse()) teardown(record, 'dispose');
      bus.clear();
    },
  };

  function applyTier(record, tier) {
    if (tier === record.tier) return;
    record.tier = tier;
    if (record.state !== 'ready') return; // init() reads ctx.quality
    try { record.ext.setQuality?.(tier); } catch (error) { teardown(record, 'setQuality', error); }
  }

  return host;
}
