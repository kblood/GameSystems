import { registry, positive, extension, tierState } from '../host/system.js';
import { jsonState, stateId } from '../host/state.js';

const volume = components => Object.values(components).reduce((n, ml) => n + ml, 0);
function mixture(components) {
  if (!components || Array.isArray(components) || typeof components !== 'object') throw new TypeError('Liquid components required');
  const result = Object.create(null);
  for (const [kind, ml] of Object.entries(components)) {
    stateId(kind, 'liquid kind'); positive(ml, 'component ml', true);
    if (ml) result[kind] = ml;
  }
  return result;
}

// Engine-independent liquid storage. No pressure solver: applications own transport and delivery.
export function createSupplySystem({ emit = () => {}, quality = 'high' } = {}) {
  const tanks = registry(), tiers = tierState(quality);
  let disposed = false;
  let publishing = false;
  const batchTokens = new Set();
  const pendingNotifications = new Set();
  function live() { if (disposed) throw new Error('System is disposed'); }
  function publish(id) { emit('supply:changed', api.state(id)); }
  function changed(id) { if (batchTokens.size) pendingNotifications.add(id); else publish(id); }
  function take(tank, ml, kind = null) {
    const available = kind === null ? volume(tank.components) : tank.components[kind] ?? 0;
    const actual = Math.min(available, ml), parts = Object.create(null);
    if (available > 0) for (const [key, amount] of Object.entries(tank.components)) {
      if (kind !== null && key !== kind) continue;
      const drawn = amount * (actual / available);
      if (drawn) parts[key] = drawn;
      tank.components[key] = Math.max(0, amount - drawn);
      if (!tank.components[key]) delete tank.components[key];
    }
    return { ml: actual, components: { ...parts } };
  }
  const api = {
    get quality() { return tiers.quality; }, setQuality: tiers.setQuality,
    beginBatch() { live(); const token = Object.freeze({}); batchTokens.add(token); return token; },
    flush(token) {
      live(); if (!token || !batchTokens.delete(token)) return false;
      if (batchTokens.size || publishing) return true;
      publishing = true;
      let failed = false, firstError;
      try {
        while (batchTokens.size === 0 && pendingNotifications.size) {
          const id = pendingNotifications.values().next().value;
          pendingNotifications.delete(id);
          if (tanks.entries.has(id)) {
            try { publish(id); }
            catch (error) { if (!failed) { failed = true; firstError = error; } }
          }
        }
      } finally { publishing = false; }
      if (failed) throw firstError;
      return true;
    },
    add(id, { capacityMl = 10000, components = {} } = {}) {
      live(); positive(capacityMl, 'capacityMl'); components = mixture(components);
      const initialMl = volume(components);
      if (initialMl > capacityMl) throw new RangeError('Initial liquid exceeds capacity');
      tanks.add(id, { id, capacityMl, components, initialMl, filledMl: 0, drawnMl: 0 });
      changed(id); return api.state(id);
    },
    state(id) { live(); const t = tanks.get(id); return { ...t, components: { ...t.components }, ml: volume(t.components), freeMl: t.capacityMl - volume(t.components) }; },
    all() { live(); return [...tanks.entries.keys()].map(id => api.state(id)); },
    fill(id, ml, { kind = 'water', components = null, notify = true } = {}) {
      live(); positive(ml, 'ml', true); stateId(kind, 'liquid kind');
      const parts = mixture(components ?? { [kind]: ml });
      if (Math.abs(volume(parts) - ml) > 1e-6) throw new Error('Components must sum to ml');
      const t = tanks.get(id), acceptedMl = Math.min(ml, t.capacityMl - volume(t.components));
      const fraction = ml ? acceptedMl / ml : 0;
      for (const [key, amount] of Object.entries(parts)) if (fraction) t.components[key] = (t.components[key] ?? 0) + amount * fraction;
      t.filledMl += acceptedMl; if (notify) changed(id);
      return { acceptedMl, rejectedMl: ml - acceptedMl };
    },
    draw(id, ml, { kind = null, notify = true } = {}) {
      live(); positive(ml, 'ml', true); if (kind !== null) stateId(kind, 'liquid kind');
      const t = tanks.get(id), output = take(t, ml, kind); t.drawnMl += output.ml; if (notify) changed(id); return output;
    },
    transfer(from, to, ml) {
      live(); positive(ml, 'ml', true); if (from === to) throw new Error('Distinct tanks required');
      const source = tanks.get(from), target = tanks.get(to);
      const output = take(source, Math.min(ml, target.capacityMl - volume(target.components)));
      source.drawnMl += output.ml;
      for (const [kind, amount] of Object.entries(output.components)) target.components[kind] = (target.components[kind] ?? 0) + amount;
      target.filledMl += output.ml; changed(from); changed(to); return output;
    },
    capture() { return { schema: 'gamesystems.supply.v1', tanks: api.all() }; },
    prepareRestore(raw) {
      live(); const data = jsonState(raw);
      if (data.schema !== 'gamesystems.supply.v1' || !Array.isArray(data.tanks) || data.tanks.length !== tanks.entries.size) throw new Error('Supply topology differs');
      const prepared = new Map();
      for (const saved of data.tanks) {
        stateId(saved.id); const current = tanks.get(saved.id);
        if (prepared.has(saved.id) || saved.capacityMl !== current.capacityMl) throw new Error('Supply topology differs');
        const components = mixture(saved.components), ml = volume(components);
        for (const key of ['initialMl', 'filledMl', 'drawnMl']) positive(saved[key], key, true);
        if (ml > current.capacityMl + 1e-6 || Math.abs(saved.initialMl + saved.filledMl - saved.drawnMl - ml) > 1e-5) throw new Error('Supply ledger does not balance');
        prepared.set(saved.id, { id: saved.id, capacityMl: current.capacityMl, components, initialMl: saved.initialMl, filledMl: saved.filledMl, drawnMl: saved.drawnMl });
      }
      return {state(id){const t=prepared.get(id);if(!t)throw new Error('Unknown saved tank');const ml=volume(t.components);return {...t,components:{...t.components},ml,freeMl:t.capacityMl-ml};}, commit() { live(); for (const [id, t] of prepared) { tanks.entries.set(id, { ...t, components: mixture(t.components) }); } }, notify() { for (const id of prepared.keys()) changed(id); } };
    },
    restore(raw) { const plan = api.prepareRestore(raw); plan.commit(); plan.notify(); },
    dispose() { if (disposed) return; disposed = true; tanks.dispose(); },
  };
  return api;
}

// Vehicle interface uses litres; a wrong fuel remains stored and cannot run a petrol engine.
export function createFuelAdapter(supply, tankId, { kind = 'petrol' } = {}) {
  stateId(kind, 'fuel kind'); supply.state(tankId);
  return {
    reversible: true,
    beginBatch() { return supply.beginBatch(); },
    state() { const t = supply.state(tankId); return { amountL: (t.components[kind] ?? 0) / 1000, capacityL: t.capacityMl / 1000, kind }; },
    consume(liters) { positive(liters, 'liters', true); return supply.draw(tankId, liters * 1000, { kind }).ml / 1000; },
    refill(liters, liquidKind = kind) { positive(liters, 'liters', true); return supply.fill(tankId, liters * 1000, { kind: liquidKind }).acceptedMl / 1000; },
    flush(token) { supply.flush(token); },
  };
}
export default options => extension('supply', createSupplySystem, options);
