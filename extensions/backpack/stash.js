// Stash (chest, locker, wardrobe): the stationary variant of the container core (profile kind "stash", see profile.js). It is the
// same pockets + container ledger as the backpack, with no carry states: only open/closed. Pockets with access "always" are always
// reachable, "open" and "worn" pockets only while the stash is open. Idea after Saints & Sinners' stash; no code taken.
import { parseProfile } from './profile.js';
import { createContainerLedger } from './ledger.js';
import { captureCheckpoint, prepareCheckpoint } from './checkpoint.js';
import { jsonState } from '../host/state.js';

export const STASH_SCHEMA = 'gamesystems.backpack-stash.v1';

export function createStash({ profile, inventory, emit = () => {}, tier = 'high' } = {}) {
  const prof = parseProfile(profile);
  if (prof.kind !== 'stash') throw new TypeError('createStash needs a profile of kind "stash"');
  let isOpen = false;
  const access = new Map(prof.pockets.map(k => [k.id, k.access]));
  const canAccess = id => { const a = access.get(id); return a === 'always' || (a !== undefined && isOpen); };
  const ledger = createContainerLedger({ profile: prof, inventory, canAccess, emit, tier });
  const api = {
    profile: prof, ledger, canAccess,
    get isOpen() { return isOpen; },
    open() { if (!isOpen) { isOpen = true; emit('backpack:stash_open', { profileId: prof.id }); ledger.refresh(); } return { ok: true, reason: '' }; },
    close() { if (isOpen) { isOpen = false; emit('backpack:stash_closed', { profileId: prof.id }); ledger.refresh(); } return { ok: true, reason: '' }; },
    capture() { return { schema: STASH_SCHEMA, profileId: prof.id, open: isOpen, backpack: captureCheckpoint({ ledger }) }; },
    prepareRestore(raw) {
      const d = jsonState(raw);
      if (d.schema !== STASH_SCHEMA) throw new Error('Stash checkpoint schema differs');
      if (d.profileId !== prof.id) throw new Error('Stash checkpoint belongs to another profile');
      if (typeof d.open !== 'boolean') throw new Error('Stash checkpoint open must be boolean');
      const plan = prepareCheckpoint({ ledger }, d.backpack);
      return { commit() { plan.commit(); isOpen = d.open; }, notify() { plan.notify(); } };
    },
    restore(raw) { const plan = api.prepareRestore(raw); plan.commit(); plan.notify(); },
  };
  return api;
}
