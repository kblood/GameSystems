// GameSystems furniture extension (G1, docs/furniture_system.md): data-driven furniture and interactive objects (cabinets, drawers, doors,
// safes, lockers, chests ...) on top of the mechanics, audio, grasp and backpack extensions. Opt-in: nothing changes in a game until it loads this.
//
//   spec.js       FurnitureSpec data model, validation, 12 built-in types + building blocks (data/types.data.json)
//   furniture.js  createFurniture(host, spec): runtime (mechanics, locks, audio hooks, contents, checkpoint). No three.js.
//   grips.js      handle grips (grasp pole/grip poses read-only, descriptors)
//   mesh.js       buildFurnitureMesh(spec): the three.js builder. NOT exported here (this index stays engine-free): import './mesh.js'.
//
// Extension: host.load(furnitureExtension, { inventory?, isBlocked?, powerOf?, onReject?, audio? }) -> manager { add(specOrTypeId, { id, position, yaw }),
// get(id), remove(id), ids, step(dt), capture(), restore(raw), setQuality(tier) }. Needs 'mechanics' (loaded first); uses 'audio' when loaded
// (clunk by material; creaks come from the audio extension's own listener). The host calls manager.step through update(dt).
import { jsonState } from '../host/state.js';
import { createFurniture } from './furniture.js';
import { FURNITURE_TIERS } from './spec.js';

export { FURNITURE_DATA, FURNITURE_TIERS, TYPE_IDS, BLOCKS, SPEC_SCHEMA, SOUND_MATERIALS, parseSpec, typeSpec, allTypes, variantOf, movingParts, bodyPanels, hingeFrom, expandBlock, mergeBlock, cellLayout } from './spec.js';
export { createFurniture, STATE_SCHEMA } from './furniture.js';
export { handleGrip, partGrips, frameQuaternion } from './grips.js';

export const SET_SCHEMA = 'gamesystems.furniture-set.v1';

/** A set of furniture on one host adapter (what the extension returns). Usable without the extension host in tests: createFurnitureSet(hostAdapter). */
export function createFurnitureSet(hostAdapter) {
  const items = new Map();
  const api = {
    get quality() { return hostAdapter.quality; },
    add(spec, options = {}) {
      if (options.id !== undefined && items.has(options.id)) throw new Error(`Duplicate furniture id: ${options.id}`);
      const f = createFurniture(hostAdapter, spec, options);
      if (items.has(f.id)) { f.dispose(); throw new Error(`Duplicate furniture id: ${f.id}`); }
      items.set(f.id, f); return f;
    },
    get(id) { return items.get(id) ?? null; },
    remove(id) { const f = items.get(id); if (!f) return false; f.dispose(); return items.delete(id); },
    get ids() { return [...items.keys()]; },
    all() { return [...items.values()]; },
    step(dt) { for (const f of items.values()) f.step(dt); },
    setQuality(tier) { for (const f of items.values()) f.setQuality(tier); },
    capture() { return { schema: SET_SCHEMA, items: Object.fromEntries([...items].map(([id, f]) => [id, f.capture()])) }; },
    prepareRestore(raw) {
      const d = jsonState(raw);
      if (d.schema !== SET_SCHEMA || !d.items || Object.keys(d.items).length !== items.size) throw new Error('Furniture set checkpoint topology differs');
      const plans = [...items].map(([id, f]) => { if (!d.items[id]) throw new Error(`Missing furniture ${id}`); return f.prepareRestore(d.items[id]); });
      return { commit() { for (const p of plans) p.commit(); }, notify() { for (const p of plans) p.notify(); } };
    },
    restore(raw) { const plan = api.prepareRestore(raw); plan.commit(); plan.notify(); },
    dispose() { for (const f of items.values()) f.dispose(); items.clear(); },
  };
  return api;
}

export function furnitureExtension(options = {}) {
  return {
    id: 'furniture', requires: ['mechanics'], quality: [...FURNITURE_TIERS],
    init(ctx) {
      const audio = options.audio ?? ctx.get('audio');
      const adapter = { mechanics: ctx.get('mechanics'), on: (e, cb) => ctx.on(e, cb), emit: ctx.emit, audio: audio ?? null, inventory: options.inventory ?? null,
        isBlocked: options.isBlocked, powerOf: options.powerOf, onReject: options.onReject, creaks: options.audio ? 'own' : ctx.get('audio') ? 'host' : 'own',
        get quality() { return ctx.quality; } };
      this.set = createFurnitureSet(adapter);
      return this.set;
    },
    update(dt) { this.set?.step(dt); },
    setQuality(tier) { this.set?.setQuality(tier); },
    dispose() { this.set?.dispose(); this.set = null; },
  };
}
export default furnitureExtension;
