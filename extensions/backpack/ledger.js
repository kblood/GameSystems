// Container ledger: groups the cells of every pocket of a BackpackProfile on top of an INJECTED inventory provider (the
// existing NightfallGearInventory-style ledger or any equivalent; adapters.js lists the methods). The backpack layer adds
// containers, capacity and accessibility; it never changes how the provider works (an addition, not a replacement).
//
// One pocket with capacity N is N provider slots, named `<profileId>/<pocketId>/<index>`; every cell holds one item.
// Item IDs are stable (the ledger never renames, copies or recreates an item). Each transfer is atomic: it either
// completes or the provider is back where it started (rollback). Rejection reasons, same cases as the Godot ledger's
// can_store() (which only answers true/false): INVALID_SIZE (item size not three positive finite axes), WRONG_ITEM (category
// not allowed), TOO_LARGE (axes sorted descending do not fit), FULL (no free cell); plus UNKNOWN_ITEM, UNKNOWN_POCKET, NOT_OWNED,
// NOT_ACCESSIBLE (bag state), EMPTY, NOT_FOUND, PROVIDER_REJECTED; mounts add NOT_ACCEPTED (acceptOnly filter), VETOED (a validator said no),
// SNAP_DISABLED / NOT_RELEASED (offer()). Check order: UNKNOWN_POCKET, NOT_ACCESSIBLE, UNKNOWN_ITEM, NOT_OWNED, INVALID_SIZE, WRONG_ITEM,
// NOT_ACCEPTED, TOO_LARGE, FULL, then the validators (VETOED), then the provider (PROVIDER_REJECTED).
//
// BackpackMount (a pocket with an optional `mount` block, see profile.js): acceptOnly item-id/tag filter, snapMode, returnDelayS, and the
// UltimateXR-style event pairs placing/placed and removing/removed (pre events can be vetoed by validators, post events follow the commit).
//
// Materialisation limit and ONE refresh path (design doc 3.4, research 1.11): the ledger is the truth; physical proxies are only a view.
// view() lists at most N items of the selected tab/page (N = physicalItemsMax on a tier with physicalItems, else a slot view without cap);
// items held in a hand are left out; every change (store, retrieve, move, restore, hold, tab/page choice) goes through refresh(), which is
// guarded against re-entrancy: a change made by a listener during a refresh is applied at once but its refresh is coalesced into one extra
// pass (the Gothic Unity VR #319 lesson: two update paths drift apart).
import { parseProfile, sizeFits, materialLimit, BACKPACK_DATA } from './profile.js';
import { jsonState } from '../host/state.js';

export const LEDGER_SCHEMA = 'gamesystems.backpack-ledger.v1';
const validSize = s => Array.isArray(s) && s.length === 3 && s.every(v => Number.isFinite(v) && v > 0);
const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
const EPS = 1e-9;
const ALL = BACKPACK_DATA.VIEW.ALL_TAB;

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
    registerItem(id, category, size, owner = 'world', tags) {
      if (!id || items.has(id) || !category || !validSize(size) || !OWNERS.includes(owner)) return false;
      items.set(id, { category, size: [...size], owner, slot: '', tags: Array.isArray(tags) ? [...tags] : undefined }); return true;
    },
    /** Hand/world <-> hand/world (NightfallGearInventory.transfer); an item in a slot cannot be transferred. */
    transfer(id, expectedOwner, newOwner) {
      const it = items.get(id);
      if (!it || it.slot || it.owner !== expectedOwner || !OWNERS.includes(expectedOwner) || !OWNERS.includes(newOwner)) return false;
      it.owner = newOwner; return true;
    },
    unregisterItem(id) { const it = items.get(id); if (!it || it.slot) return false; return items.delete(id); },
    itemInfo(id) { const it = items.get(id); return it ? { category: it.category, size: [...it.size], owner: it.owner, ...(it.tags ? { tags: [...it.tags] } : {}) } : null; },
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

/** Tags of an item for mount filters: the provider's optional `tags`, else just its category. */
const tagsOf = info => (Array.isArray(info.tags) && info.tags.length ? info.tags : [info.category]);

export function createContainerLedger({ profile, inventory, canAccess = () => true, emit = () => {}, transitOwner = 'world', tier = 'high' } = {}) {
  const prof = parseProfile(profile);
  for (const m of ['addSlot', 'itemInfo', 'store', 'retrieve', 'itemInSlot', 'slotOf']) if (typeof inventory?.[m] !== 'function') throw new TypeError(`inventory provider needs ${m}()`);
  let tierName = typeof tier === 'function' ? null : tier;
  const getTier = () => (tierName === null ? tier() : tierName);
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

  // ---- mount events, validators, held items, the one refresh path
  const validators = [], listeners = [], held = new Map(), pending = new Map();
  const stats = { refreshes: 0, deferred: 0 };
  let sel = { tab: ALL, page: 0 }, refreshing = false, again = false;
  const gate = (kind, itemId, pocketId) => {
    for (const v of validators) { let r; try { r = v({ kind, itemId, pocketId }); } catch { r = false; } if (r === false || (typeof r === 'string' && r)) return false; }
    return true;
  };
  function refresh() {
    if (refreshing) { again = true; stats.deferred++; return false; }
    refreshing = true;
    try {
      let passes = 0;
      do {
        again = false; passes++; stats.refreshes++;
        if (listeners.length) { const v = api.view(); for (const l of [...listeners]) l(v); }
      } while (again && passes < BACKPACK_DATA.VIEW.MAX_REFRESH_PASSES);
    } finally { refreshing = false; again = false; }
    return true;
  }

  function accepts(k, itemId, info) {
    const only = k.mount?.acceptOnly;
    return !only || only.includes(itemId) || tagsOf(info).some(t => only.includes(t));
  }
  function check(itemId, pocketId, { expectedOwner = 'world' } = {}) {
    const k = pockets.get(pocketId);
    if (!k) return fail('UNKNOWN_POCKET');
    if (!canAccess(pocketId)) return fail('NOT_ACCESSIBLE');
    const info = inventory.itemInfo(itemId);
    if (!info) return fail('UNKNOWN_ITEM');
    if (info.owner !== expectedOwner) return fail('NOT_OWNED');
    if (!validSize(info.size)) return fail('INVALID_SIZE');
    if (!k.categories.includes(info.category)) return fail('WRONG_ITEM');
    if (!accepts(k, itemId, info)) return fail('NOT_ACCEPTED');
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
    /** The mount block of a pocket with defaults filled in (snapMode, returnDelayS), or null when the pocket has none. */
    mountOf(pocketId) { const m = pockets.get(pocketId)?.mount; return m ? { ...m, ...(m.acceptOnly ? { acceptOnly: [...m.acceptOnly] } : {}) } : null; },
    /** Validator for placing/removing (UltimateXR AddPlacingValidator): fn({kind, itemId, pocketId}) -> false or a reason string vetoes. Returns the remover. */
    addValidator(fn) { validators.push(fn); return () => { const i = validators.indexOf(fn); if (i >= 0) validators.splice(i, 1); }; },

    /** hand/world -> pocket. Atomic; on a provider failure nothing changed. */
    store(itemId, pocketId, opts = {}) {
      const expectedOwner = opts.expectedOwner ?? 'world', c = check(itemId, pocketId, { expectedOwner });
      if (!c.ok) return c;
      if (!gate('placing', itemId, pocketId)) return fail('VETOED');
      emit('backpack:placing', { itemId, pocketId, cell: c.cell });
      if (safe(() => inventory.store(itemId, expectedOwner, c.cell)) !== true) return fail('PROVIDER_REJECTED');
      held.delete(itemId);
      emit('backpack:stored', { itemId, pocketId, cell: c.cell });
      emit('backpack:placed', { itemId, pocketId, cell: c.cell });
      refresh();
      return { ok: true, reason: '', cell: c.cell };
    },
    /** pocket -> hand/world. itemId optional (default: the first item in cell order). */
    retrieve(pocketId, { itemId, newOwner = 'world' } = {}) {
      const k = pockets.get(pocketId);
      if (!k) return fail('UNKNOWN_POCKET');
      if (!canAccess(pocketId)) return fail('NOT_ACCESSIBLE');
      const cell = itemId === undefined ? k.cells.find(c => inventory.itemInSlot(c)) : k.cells.find(c => inventory.itemInSlot(c) === itemId);
      if (!cell) return fail(itemId === undefined ? 'EMPTY' : 'NOT_FOUND');
      const target = inventory.itemInSlot(cell);
      if (!gate('removing', target, pocketId)) return fail('VETOED');
      emit('backpack:removing', { itemId: target, pocketId, cell });
      const got = safe(() => inventory.retrieve(cell, newOwner));
      if (!got) return fail('PROVIDER_REJECTED');
      held.delete(got);
      emit('backpack:retrieved', { itemId: got, pocketId, cell });
      emit('backpack:removed', { itemId: got, pocketId, cell });
      refresh();
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
      if (!accepts(to, itemId, info)) return fail('NOT_ACCEPTED');
      if (!sizeFits(info.size, to.maxSize)) return fail('TOO_LARGE');
      const cell = freeCell(toPocketId);
      if (!cell) return fail('FULL');
      if (!gate('removing', itemId, from.pocketId) || !gate('placing', itemId, toPocketId)) return fail('VETOED');
      emit('backpack:removing', { itemId, pocketId: from.pocketId, cell: from.cell });
      emit('backpack:placing', { itemId, pocketId: toPocketId, cell });
      if (!safe(() => inventory.retrieve(from.cell, transitOwner))) return fail('PROVIDER_REJECTED');
      if (safe(() => inventory.store(itemId, transitOwner, cell)) !== true) { putBack(itemId, from.cell, transitOwner); return fail('PROVIDER_REJECTED'); }
      emit('backpack:moved', { itemId, from: from.pocketId, to: toPocketId });
      emit('backpack:removed', { itemId, pocketId: from.pocketId, cell: from.cell });
      emit('backpack:placed', { itemId, pocketId: toPocketId, cell });
      refresh();
      return { ok: true, reason: '', cell };
    },
    /** All-or-nothing store of several items into one pocket. */
    storeAll(itemIds, pocketId, opts = {}) {
      const expectedOwner = opts.expectedOwner ?? 'world';
      if (new Set(itemIds).size !== itemIds.length) return fail('NOT_OWNED', { failedItem: itemIds.find((v, i) => itemIds.indexOf(v) !== i) });
      for (const id of itemIds) { const c = check(id, pocketId, { expectedOwner }); if (!c.ok && c.reason !== 'FULL') return { ...c, failedItem: id }; }
      if (itemIds.length > api.freeCells(pocketId)) return fail('FULL', { failedItem: itemIds[api.freeCells(pocketId)] });
      for (const id of itemIds) if (!gate('placing', id, pocketId)) return fail('VETOED', { failedItem: id });
      const done = [];
      for (const id of itemIds) {
        const cell = freeCell(pocketId);
        if (safe(() => inventory.store(id, expectedOwner, cell)) !== true) {
          for (const d of done.reverse()) if (!safe(() => inventory.retrieve(d.cell, expectedOwner))) throw new Error('Backpack ledger rollback failed');
          return fail('PROVIDER_REJECTED', { failedItem: id });
        }
        done.push({ id, cell });
      }
      for (const d of done) { held.delete(d.id); emit('backpack:placed', { itemId: d.id, pocketId, cell: d.cell }); }
      refresh();
      return { ok: true, reason: '', cells: done.map(d => d.cell) };
    },

    // ---- mount behaviour: snap on offer, timed return
    /** An item is brought to a mount. snapMode none never snaps, dropped only once released, range snaps when offered (the host decides "in range"). */
    offer(itemId, pocketId, { released = false } = {}) {
      const k = pockets.get(pocketId);
      if (!k) return fail('UNKNOWN_POCKET');
      const info = inventory.itemInfo(itemId);
      if (!info) return fail('UNKNOWN_ITEM');
      const snap = k.mount?.snapMode ?? BACKPACK_DATA.MOUNT.DEFAULT_SNAP_MODE;
      if (snap === 'none') return fail('SNAP_DISABLED');
      if (snap === 'dropped' && released !== true) return fail('NOT_RELEASED');
      return api.store(itemId, pocketId, { expectedOwner: info.owner });
    },
    /** A released world item gets sent into this mount after the mount's returnDelayS (timeout return, XRToolsReturnToSnapZone style). */
    scheduleReturn(itemId, pocketId) {
      if (!pockets.has(pocketId)) return fail('UNKNOWN_POCKET');
      const info = inventory.itemInfo(itemId);
      if (!info) return fail('UNKNOWN_ITEM');
      if (info.owner !== 'world') return fail('NOT_OWNED');
      pending.set(itemId, { pocketId, t: 0 });
      return { ok: true, reason: '' };
    },
    pendingReturns() { return [...pending.keys()]; },
    /** Advances the return timers. A pending item that was picked up meanwhile is forgotten. Returns [{itemId, ok, reason}] for the returns attempted now. */
    tick(dt) {
      const out = [];
      if (!Number.isFinite(dt) || dt < 0) return out;
      for (const [itemId, e] of [...pending]) {
        const info = inventory.itemInfo(itemId);
        if (!info || info.owner !== 'world') { pending.delete(itemId); continue; }
        e.t += dt;
        if (e.t + EPS < (pockets.get(e.pocketId).mount?.returnDelayS ?? 0)) continue;
        pending.delete(itemId);
        const r = api.store(itemId, e.pocketId, { expectedOwner: 'world' });
        emit('backpack:mount_return', { itemId, pocketId: e.pocketId, ok: r.ok });
        out.push({ itemId, ok: r.ok, reason: r.reason });
      }
      return out;
    },

    // ---- the view (materialisation limit) and its single refresh path
    setTier(name) { tierName = name; refresh(); },
    get tier() { return getTier(); },
    /** Max physical proxies at once for the current tier (0 = slot view). */
    get materialLimit() { return materialLimit(prof, getTier()); },
    /** Items to show for a tab ('*' = all bag pockets, or a pocket id) and a page: at most materialLimit items (physical) or every cell of the tab (slots).
     *  Held items are left out. Pure: it does not change the selection (selectView does). */
    view(opts = {}) {
      const limit = api.materialLimit, mode = limit > 0 ? 'physical' : 'slots';
      const bagPockets = [...pockets.values()].filter(k => k.container === 'bag' && canAccess(k.id));
      const tabs = [ALL, ...bagPockets.map(k => k.id)];
      const want = opts.tab ?? sel.tab, tab = want === ALL || pockets.has(want) ? want : ALL;
      const shown = tab === ALL ? bagPockets : (canAccess(tab) ? [pockets.get(tab)] : []);
      const skip = new Set([...held.keys(), ...(opts.exclude ?? [])]);
      const rows = [];
      for (const k of shown) for (const cell of k.cells) {
        let id = inventory.itemInSlot(cell);
        if (id && (skip.has(id) || String(inventory.itemInfo(id)?.owner ?? '').startsWith('hand:'))) id = '';
        if (id || mode === 'slots') rows.push({ itemId: id, pocketId: k.id, cell });
      }
      const pageSize = mode === 'physical' ? limit : Math.max(1, rows.length), pages = Math.max(1, Math.ceil(rows.length / pageSize));
      const raw = Number(opts.page ?? sel.page), page = Number.isFinite(raw) ? Math.max(0, Math.min(pages - 1, Math.trunc(raw))) : 0;
      const items = rows.slice(page * pageSize, (page + 1) * pageSize);
      return { mode, tab, tabs, page, pages, pageSize, total: rows.length, items, truncated: rows.length > items.length };
    },
    /** Chooses tab and page. This and every ledger change reach listeners through refresh() and nowhere else. */
    selectView({ tab = ALL, page = 0 } = {}) { sel = { tab, page }; refresh(); return api.view(); },
    /** Subscribes to the view (called with api.view() after every change). Returns the unsubscribe function. */
    onRefresh(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    refresh,
    refreshStats() { return { ...stats }; },
    /** An item in a hand (or being grabbed as a proxy before the retrieve commits) is left out of the view so it never shows in two places. */
    hold(itemId, side = 'right') {
      if (side !== 'left' && side !== 'right') return fail('NOT_OWNED');
      if (!inventory.itemInfo(itemId)) return fail('UNKNOWN_ITEM');
      held.set(itemId, side); refresh(); return { ok: true, reason: '' };
    },
    unhold(itemId) { const had = held.delete(itemId); if (had) refresh(); return { ok: had, reason: had ? '' : 'NOT_FOUND' }; },
    heldItems() { return [...held.keys()]; },

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
          held.clear(); pending.clear();
        },
        notify() { emit('backpack:ledger-restored', {}); refresh(); },
      };
    },
    restore(raw) { const plan = api.prepareRestore(raw); plan.commit(); plan.notify(); },
  };
  return api;
}
