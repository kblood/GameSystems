import { registry, positive, clamp, extension, tierState } from '../host/system.js';

export const MATERIAL_PRESETS = Object.freeze({
  wood: { capacityMl: 150, dryRate: 0.4, dryFriction: 0.65, wetFriction: 0.45, stainRetention: 0.8 },
  metal: { capacityMl: 40, dryRate: 0.8, dryFriction: 0.5, wetFriction: 0.15, stainRetention: 0.1 },
  concrete: { capacityMl: 250, dryRate: 0.3, dryFriction: 0.8, wetFriction: 0.55, stainRetention: 0.6 },
  fabric: { capacityMl: 350, dryRate: 0.2, dryFriction: 0.7, wetFriction: 0.6, stainRetention: 1 },
});
export function createMaterialsSystem({ emit = () => {}, quality = 'high', applySurface = () => {} } = {}) {
  const store = registry(), tiers = tierState(quality); let evaporatedMl = 0, runoffMl = 0;
  const api = {
    get quality() { return tiers.quality; }, setQuality: tiers.setQuality,
    add(id, { material = 'wood', ...overrides } = {}) {
      if (!MATERIAL_PRESETS[material]) throw new RangeError('Unknown material');
      const p = { ...MATERIAL_PRESETS[material], ...overrides };
      for (const [key, value] of Object.entries(p)) positive(value, key, key !== 'capacityMl');
      store.add(id, { id, material, ...p, waterMl: 0, liquidMl: 0, stain: 0 }); publish(id); return api.state(id);
    },
    state(id) { const s = store.get(id), wetness = clamp(s.liquidMl / s.capacityMl, 0, 1); return { ...s, wetness, friction: s.dryFriction + (s.wetFriction - s.dryFriction) * wetness }; },
    wet(id, ml, { kind = 'water', stain = 0 } = {}) {
      positive(ml, 'ml', true); positive(stain, 'stain', true); const s = store.get(id);
      const retainedMl = Math.min(ml, s.capacityMl - s.liquidMl), overflow = ml - retainedMl;
      s.liquidMl += retainedMl; if (kind === 'water') s.waterMl += retainedMl;
      s.stain = clamp(s.stain + stain * ml / s.capacityMl * s.stainRetention, 0, 1); runoffMl += overflow;
      publish(id); const result = { id, ml, kind, retainedMl, runoffMl: overflow }; emit('materials:wetted', result); return result;
    },
    clean(id, amount = 1) { const s = store.get(id); s.stain *= 1 - clamp(positive(amount, 'amount', true), 0, 1); publish(id); },
    reset() { evaporatedMl = 0; runoffMl = 0; for (const s of store.entries.values()) { s.waterMl = 0; s.liquidMl = 0; s.stain = 0; publish(s.id); } },
    ledger() { return { retainedMl: [...store.entries.values()].reduce((n, s) => n + s.liquidMl, 0), evaporatedMl, runoffMl }; },
    step(dt) {
      positive(dt, 'dt', true);
      for (const s of store.entries.values()) if (s.liquidMl > 0 && dt > 0) {
        const lost = Math.min(s.liquidMl, s.dryRate * dt), fraction = s.waterMl / s.liquidMl;
        s.liquidMl -= lost; s.waterMl = Math.max(0, s.waterMl - lost * fraction); evaporatedMl += lost; publish(s.id);
      }
    },
    remove(id) { const s = store.get(id); runoffMl += s.liquidMl; return store.remove(id); },
    dispose() { store.dispose(); },
  };
  function publish(id) { const s = api.state(id); applySurface(id, s); emit('materials:changed', s); }
  return api;
}
export default options => extension('materials', createMaterialsSystem, options, (ctx, api) => {
  ctx.on('liquid:deposit', ({ surfaceId, ml, kind, stain }) => { if (storeHas(api, surfaceId)) api.wet(surfaceId, ml, { kind, stain }); });
});
function storeHas(api, id) { try { api.state(id); return true; } catch { return false; } }
