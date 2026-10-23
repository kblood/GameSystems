// Container ledger: groups the cells of every pocket of a BackpackProfile on top of an INJECTED inventory provider (the
// existing NightfallGearInventory-style ledger or any equivalent; adapters.js lists the methods). The backpack layer adds
// containers, capacity and accessibility; it never changes how the provider works (an addition, not a replacement).
//
// One pocket with capacity N is N provider slots, named `<profileId>/<pocketId>/<index>`; every cell holds one item.
// Item IDs are stable (the ledger never renames, copies or recreates an item). Each transfer is atomic: it either
// completes or the provider is back where it started (rollback). Rejection reasons, same cases as the Godot ledger's
// can_store() (which only answers true/false): INVALID_SIZE (item size not three positive finite axes), WRONG_ITEM (category
// not allowed), TOO_LARGE (axes sorted descending do not fit), FULL (no free cell); plus UNKNOWN_ITEM, UNKNOWN_POCKET, NOT_OWNED,
// NOT_ACCESSIBLE (bag state), EMPTY, NOT_FOUND, PROVIDER_REJECTED. Check order: UNKNOWN_POCKET, NOT_ACCESSIBLE, UNKNOWN_ITEM,
// NOT_OWNED, INVALID_SIZE, WRONG_ITEM, TOO_LARGE, FULL.
import { parseProfile, sizeFits } from './profile.js';
import { jsonState } from '../host/state.js';

export const LEDGER_SCHEMA = 'gamesystems.backpack-ledger.v1';
const validSize = s => Array.isArray(s) && s.length === 3 && s.every(v => Number.isFinite(v) && v > 0);
const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });

/** In-memory reference provider (a JS port of NightfallGearInventory's rules): owners world, hand:left, hand:right, equipped, slot. */
export function createMemoryInventory() {
  const OWNERS = ['world', 'hand:left', 'hand:right', 'equipped'];
  const slots = new Map(), items = new Map(), slotItem = new Map();
  return {
    OWNERS,
    addSlot(id, categories, maxSize) {
      if (!id || slots.has(id) || !validSize(maxSize) || !categories.length) return false;
      slots.set(id, { categories: [...categories], maxSize: [...maxSize] }); slotItem.set(id, ''); return true;
    },
    registerItem(id, category, size, owner = 'world') {
      if (!id || items.has(id) || !category || !validSize(size) || !OWNERS.includes(owner)) return false;
      items.set(id, { category, size: [...size], owner, slot: '' }); return true;
    },
    unregisterItem(id) { const it = items.get(id); if (!it || it.slot) return false; return items.delete(id); },
    itemInfo(id) { const it = items.get(id); return it ? { category: it.category, size: [...it.size], owner: it.owner } : null; },
    itemInSlot(slotId) { return slotItem.get(slotId) ?? ''; },
    slotOf(id) { return items.get(id)?.slot ?? ''; },
    store(id, expectedOwner, slotId) {
      const it = items.get(id), sl = slots.get(slotId);
      if (!it || !sl || it.owner !== expectedOwner || !OWNERS.includes(expectedOwner) || slotItem.get(slotId) !== '') return false;
      if (!sl.categories.includes(it.category) || !sizeFits(it.size, sl.maxSize)) return false;
      it.owner = 'slot'; it.slot = slotId; slotItem.set(slotId, id); return true;
    },
    retrieve(slotId, newOwner) {
      const id = slotItem.get(slotId);
      if (!id || !OWNERS.includes(newOwner)) return '';
      const it = items.get(id); it.owner = newOwner; it.slot = ''; slotItem.set(slotId, ''); return id;
    },
  };
}

export function createContainerLedger({ profile, inventory, canAccess = () => true, emit = () => {}, transitOwner = 'world' } = {}) {
  const prof = parseProfile(profile);
  for (const m of ['addSlot', 'itemInfo', 'store', 'retrieve', 'itemInSlot', 'slotOf']) if (typeof inventory?.[m] !== 'function') throw new TypeError(`inventory provider needs ${m}()`);
  const pockets = new Map(prof.pockets.map(k => [k.id, { ...k, cells: Array.from({ length: k.capacity }, (_, i) => `${prof.id}/${k.id}/${i}`) }]));
  const cellOwner = new Map(); // cell id -> pocket id
  for (const k of pockets.values()) for (const c of k.cells) {
    if (!inventory.addSlot(c, k.categories, k.maxSize)) throw new Error(`inventory provider refused slot ${c}`);
    cellOwner.set(c, k.id);
  }
  const safe = fn => { try { return fn(); } catch { return undefined; } };
  const itemsIn = id => pockets.get(id).cells.map(c => inventory.itemInSlot(c)).filter(Boolean);
  const freeCell = id => pockets.get(id).cells.find(c => !inventory.itemInSlot(c));
  const locate = itemId => { const c = inventory.slotOf(itemId); return c && cellOwner.has(c) ? { pocketId: cellOwner.get(c), cell: c } : null; };

  function check(itemId, pocketId, { expectedOwner = 'world' } = {}) {
    const k = pockets.get(pocketId);
    if (!k) return fail('UNKNOWN_POCKET');
    if (!canAccess(pocketId)) return fail('NOT_ACCESSIBLE');
    const info = inventory.itemInfo(itemId);
    if (!info) return fail('UNKNOWN_ITEM');
    if (info.owner !== expectedOwner) return fail('NOT_OWNED');
    if (!validSize(info.size)) return fail('INVALID_SIZE');
    if (!k.categories.includes(info.category)) return fail('WRONG_ITEM');
    if (!sizeFits(info.size, k.maxSize)) return fail('TOO_LARGE');
    const cell = freeCell(pocketId);
    if (!cell) return fail('FULL');
    return { ok: true, reason: '', cell };
  }
  function putBack(itemId, cell, owner) { // rollback helper: the cell was just emptied by us, so this must succeed
    if (!inventory.store(itemId, owner, cell)) throw new Error(`Backpack ledger rollback failed for ${itemId} -> ${cell}`);
  }

  const api = {
    profile: prof, check,
    pocketIds() { return [...pockets.keys()]; },
    cellIds(pocketId) { return [...pockets.get(pocketId).cells]; },
    itemsIn(pocketId) { if (!pockets.has(pocketId)) throw new Error(`Unknown pocket: ${pocketId}`); return itemsIn(pocketId); },
    contents() { return Object.fromEntries([...pockets.keys()].map(id => [id, itemsIn(id)])); },
    locate, freeCells(pocketId) { return pockets.get(pocketId).cells.filter(c => !inventory.itemInSlot(c)).length; },
    /** hand/world -> pocket. Atomic; on a provider failure nothing changed. */
    store(itemId, pocketId, opts = {}) {
      const expectedOwner = opts.expectedOwner ?? 'world', c = check(itemId, pocketId, { expectedOwner });
      if (!c.ok) return c;
      if (safe(() => inventory.store(itemId, expectedOwner, c.cell)) !== true) return fail('PROVIDER_REJECTED');
      emit('backpack:stored', { itemId, pocketId, cell: c.cell });
      return { ok: true, reason: '', cell: c.cell };
    },
    /** pocket -> hand/world. itemId optional (default: the first item in cell order). */
    retrieve(pocketId, { itemId, newOwner = 'world' } = {}) {
      const k = pockets.get(pocketId);
      if (!k) return fail('UNKNOWN_POCKET');
      if (!canAccess(pocketId)) return fail('NOT_ACCESSIBLE');
      const cell = itemId === undefined ? k.cells.find(c => inventory.itemInSlot(c)) : k.cells.find(c => inventory.itemInSlot(c) === itemId);
      if (!cell) return fail(itemId === undefined ? 'EMPTY' : 'NOT_FOUND');
      const got = safe(() => inventory.retrieve(cell, newOwner));
      if (!got) return fail('PROVIDER_REJECTED');
      emit('backpack:retrieved', { itemId: got, pocketId, cell });
      return { ok: true, reason: '', itemId: got, cell };
    },
    /** Pocket to pocket. The destination is checked first; if the provider fails midway the item is put back (rollback). */
    move(itemId, toPocketId) {
      const from = locate(itemId);
      if (!from) return fail('NOT_FOUND');
      if (!canAccess(from.pocketId)) return fail('NOT_ACCESSIBLE');
      if (from.pocketId === toPocketId) return { ok: true, reason: '', cell: from.cell };
      // an item in a cell is owned by 'slot': check it against the destination's rules directly
      const info = inventory.itemInfo(itemId);
      const to = pockets.get(toPocketId);
      if (!to) return fail('UNKNOWN_POCKET');
      if (!canAccess(toPocketId)) return fail('NOT_ACCESSIBLE');
      if (!validSize(info.size)) return fail('INVALID_SIZE');
      if (!to.categories.includes(info.category)) return fail('WRONG_ITEM');
      if (!sizeFits(info.size, to.maxSize)) return fail('TOO_LARGE');
      const cell = freeCell(toPocketId);
      if (!cell) return fail('FULL');
      if (!safe(() => inventory.retrieve(from.cell, transitOwner))) return fail('PROVIDER_REJECTED');
      if (safe(() => inventory.store(itemId, transitOwner, cell)) !== true) { putBack(itemId, from.cell, transitOwner); return fail('PROVIDER_REJECTED'); }
      emit('backpack:moved', { itemId, from: from.pocketId, to: toPocketId });
      return { ok: true, reason: '', cell };
    },
    /** All-or-nothing store of several items into one pocket. */
    storeAll(itemIds, pocketId, opts = {}) {
      const expectedOwner = opts.expectedOwner ?? 'world';
      if (new Set(itemIds).size !== itemIds.length) return fail('NOT_OWNED', { failedItem: itemIds.find((v, i) => itemIds.indexOf(v) !== i) });
      for (const id of itemIds) { const c = check(id, pocketId, { expectedOwner }); if (!c.ok && c.reason !== 'FULL') return { ...c, failedItem: id }; }
      if (itemIds.length > api.freeCells(pocketId)) return fail('FULL', { failedItem: itemIds[api.freeCells(pocketId)] });
      const done = [];
      for (const id of itemIds) {
        const cell = freeCell(pocketId);
        if (safe(() => inventory.store(id, expectedOwner, cell)) !== true) {
          for (const d of done.reverse()) if (!safe(() => inventory.retrieve(d.cell, expectedOwner))) throw new Error('Backpack ledger rollback failed');
          return fail('PROVIDER_REJECTED', { failedItem: id });
        }
        done.push({ id, cell });
      }
      return { ok: true, reason: '', cells: done.map(d => d.cell) };
    },

    // Checkpoint of the cell assignment (JSON-safe). The provider's own checkpoint restores ownership; this validates and
    // re-syncs the cell mapping on top of it.
    capture() {
      const cells = {};
      for (const k of pockets.values()) for (const c of k.cells) cells[c] = inventory.itemInSlot(c);
      return { schema: LEDGER_SCHEMA, profileId: prof.id, cells };
    },
    prepareRestore(raw) {
      const d = jsonState(raw);
      if (d.schema !== LEDGER_SCHEMA || d.profileId !== prof.id) throw new Error('Backpack ledger checkpoint differs');
      if (!d.cells || typeof d.cells !== 'object' || Object.keys(d.cells).length !== cellOwner.size) throw new Error('Backpack ledger topology differs');
      const seen = new Set();
      for (const [cell, itemId] of Object.entries(d.cells)) {
        if (!cellOwner.has(cell) || typeof itemId !== 'string') throw new Error(`Invalid backpack cell ${cell}`);
        if (!itemId) continue;
        if (seen.has(itemId)) throw new Error(`Item ${itemId} is in two cells`);
        seen.add(itemId);
        const info = inventory.itemInfo(itemId), k = pockets.get(cellOwner.get(cell));
        if (!info) throw new Error(`Unknown item in checkpoint: ${itemId}`);
        if (!k.categories.includes(info.category) || !sizeFits(info.size, k.maxSize)) throw new Error(`Item ${itemId} does not fit ${cell}`);
        const here = inventory.slotOf(itemId);
        if (!(here && cellOwner.has(here)) && info.owner !== transitOwner) throw new Error(`Item ${itemId} is not restorable (owner ${info.owner})`);
      }
      const target = Object.entries(d.cells);
      return {
        commit() {
          const before = Object.keys(d.cells).map(c => [c, inventory.itemInSlot(c)]).filter(([, id]) => id);
          for (const [c] of before) inventory.retrieve(c, transitOwner);
          const placed = [];
          for (const [c, id] of target) {
            if (!id) continue;
            if (safe(() => inventory.store(id, transitOwner, c)) !== true) {
              for (const p of placed) inventory.retrieve(p, transitOwner);
              for (const [oc, oid] of before) putBack(oid, oc, transitOwner);
              throw new Error('Backpack ledger restore rolled back');
            }
            placed.push(c);
          }
        },
        notify() { emit('backpack:ledger-restored', {}); },
      };
    },
    restore(raw) { const plan = api.prepareRestore(raw); plan.commit(); plan.notify(); },
  };
  return api;
}
