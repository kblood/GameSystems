import { registry, positive, finite, vector, unit, distance, dot, clamp, extension, tierState } from '../host/system.js';

// Geometric interaction gates. Host supplies actual tracked tool-tip pose/impact.
export function createToolsSystem({ emit = () => {}, quality = 'high' } = {}) {
  const store = registry(), tiers = tierState(quality), held = new Map(); let disposed = false;
  const api = {
    get quality() { return tiers.quality; }, setQuality: tiers.setQuality,
    add(id, { kind = 'screw', position = [0, 0, 0], axis = [0, 0, 1], radius = 0.035, angleTolerance = 0.35,
      requiredWork = 2, installed = false, partType = 'fuse' } = {}) {
      if (!['screw', 'nail', 'socket'].includes(kind)) throw new Error('Unknown assembly kind');
      if (kind === 'socket' && installed) throw new Error('Sockets become installed only when a part is inserted');
      store.add(id, { id, kind, position: vector(position), axis: unit(axis), radius: positive(radius), angleTolerance: positive(angleTolerance), requiredWork: positive(requiredWork),
        work: installed ? requiredWork : 0, installed: !!installed, partType, partId: null }); return api.state(id);
    },
    state(id) { const s = store.get(id); return { ...s, position: [...s.position], axis: [...s.axis], progress: s.work / s.requiredWork }; },
    hold(partId, owner) { if (disposed) throw new Error('System is disposed'); if (!partId || !owner) throw new Error('Part and owner required'); if ([...store.entries.values()].some(s => s.partId === partId)) return false; if (held.has(partId) && held.get(partId) !== owner) return false; held.set(partId, owner); return true; },
    release(partId, owner) { if (held.get(partId) !== owner) return false; held.delete(partId); return true; },
    use(id, { tool, position, axis, rotation = 0, energyJ = 0 } = {}) {
      const s = store.get(id); position = vector(position); axis = unit(axis); finite(rotation); positive(energyJ, 'energyJ', true);
      if (distance(position, s.position) > s.radius || dot(axis, s.axis) < Math.cos(s.angleTolerance)) return { accepted: false, reason: 'alignment' };
      if (s.kind === 'socket' || tool !== (s.kind === 'screw' ? 'screwdriver' : 'hammer')) return { accepted: false, reason: 'tool' };
      const work = s.kind === 'screw' ? rotation / (2 * Math.PI) : energyJ;
      s.work = clamp(s.work + work, 0, s.requiredWork); changed(s);
      if (s.kind === 'nail' && energyJ > 0) emit('tools:impact', { id, position: [...s.position], energy: energyJ });
      return { accepted: true, ...api.state(id) };
    },
    insert(id, { partId, partType, owner, position, axis } = {}) {
      const s = store.get(id); position = vector(position); axis = unit(axis);
      if (s.kind !== 'socket' || s.installed || partType !== s.partType || held.get(partId) !== owner || !owner) return false;
      if (distance(position, s.position) > s.radius || dot(axis, s.axis) < Math.cos(s.angleTolerance)) return false;
      if ([...store.entries.values()].some(other => other.partId === partId)) return false;
      held.delete(partId); s.partId = partId; s.work = s.requiredWork; changed(s); return true;
    },
    removePart(id, owner) { const s = store.get(id); if (s.kind !== 'socket' || !s.partId || !owner) return null; const partId = s.partId; s.partId = null; s.work = 0; held.set(partId, owner); changed(s); return partId; },
    releaseAll() { held.clear(); },
    forgetPart(partId) { held.delete(partId); for (const s of store.entries.values()) if (s.partId === partId) { s.partId = null; s.work = 0; changed(s); } },
    remove: store.remove,
    dispose() { disposed = true; held.clear(); store.dispose(); },
  };
  function changed(s) { const previous = s.installed; s.installed = s.work >= s.requiredWork; const state = api.state(s.id); emit('tools:changed', state); if (previous !== s.installed) emit(s.installed ? 'tools:installed' : 'tools:removed', state); }
  return api;
}
export default options => extension('tools', createToolsSystem, options, (ctx, api) => {
  for (const event of ['xrEnd', 'disconnect']) ctx.on(event, () => api.releaseAll());
});
