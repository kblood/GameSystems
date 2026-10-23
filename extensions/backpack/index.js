// GameSystems backpack: public API. Engine-independent core of a detachable (take-off, hold, open, place, return) backpack.
// Phase P0 of docs/backpack_system_design.md: profile + state machine + container ledger + approach/pull rules + adapters.
// It is a NEW layer on top of an existing inventory (the injected provider); it replaces nothing and never loses the pack.
// No rendering, no physics, no three.js. Tiers: off | minimal | low | medium | high (flags in the profile, data.TIERS).
import { extension } from '../host/system.js';
import { jsonState } from '../host/state.js';
import { parseProfile, tierFlags, BACKPACK_TIERS } from './profile.js';
import { createBackpackState } from './state.js';
import { createContainerLedger } from './ledger.js';
import { createApproach } from './approach.js';
import { assertAdapter, nullAudio, audioNameFor } from './adapters.js';

export { BACKPACK_DATA, BACKPACK_TIERS, BACKPACK_STATES, PROFILE_SCHEMA, LOSS_POLICIES, parseProfile, tierFlags, thresholdsOf, canonicalSize, sizeFits } from './profile.js';
export { createBackpackState, STATE_SCHEMA, TRANSITIONS, canTransition, isHeld, OWNER_OF } from './state.js';
export { createContainerLedger, createMemoryInventory, LEDGER_SCHEMA } from './ledger.js';
export { createApproach, APPROACH } from './approach.js';
export { createPull, PULL } from './pull.js';
export { ADAPTER_METHODS, REQUIRED_ADAPTERS, assertAdapter, nullAudio, createRecordingAudio, audioNameFor } from './adapters.js';

export const SYSTEM_SCHEMA = 'gamesystems.backpack-system.v1';
const ALIASES = { mid: 'medium' };
const tierName = t => { const n = ALIASES[t] ?? t; if (!BACKPACK_TIERS.includes(n)) throw new RangeError(`Unknown backpack tier: ${t}`); return n; };

/** The whole core: state machine + container ledger + approach, wired to the injected adapters. */
export function createBackpackSystem({ profile, inventory, audio = nullAudio, quality = 'high', emit = () => {} } = {}) {
  const prof = parseProfile(profile);
  assertAdapter('inventory', inventory); assertAdapter('audio', audio);
  const out = (type, data) => {
    emit(type, data);
    const e = { type: type.replace(/^backpack:/, ''), ...data }, name = audioNameFor(e);
    if (name) audio.event(name, { side: data.side, state: data.to, itemId: data.itemId, pocketId: data.pocketId });
  };
  const bag = createBackpackState({ profile: prof, tier: tierName(quality), emit: out });
  const ledger = createContainerLedger({ profile: prof, inventory, canAccess: id => bag.canAccess(id), emit: out });
  const approach = createApproach();
  const api = {
    profile: prof, bag, ledger, approach,
    get quality() { return bag.tier; },
    get flags() { return bag.flags; },
    setQuality(tier) { const n = tierName(tier); bag.setTier(n); if (!tierFlags(prof, n).pull) approach.reset(); },
    /** One tick. Adds the over-shoulder approach observation (hands[side].bodyLocal + shoulderY) to bag.step(). */
    step(dt, input = {}) {
      if (bag.flags.pull && Number.isFinite(input.shoulderY)) for (const side of ['left', 'right']) {
        const h = input.hands?.[side];
        approach.observe(side, !!(h && h.tracked === true), h?.bodyLocal, input.shoulderY, dt);
      }
      return bag.step(dt, input);
    },
    /** Over-shoulder gate for a retrieve (see approach.js); the host still validates reach and occlusion. */
    checkApproach(side, bodyLocalHand, shoulderY) { return approach.check(side, bodyLocalHand, shoulderY); },
    capture() { return { schema: SYSTEM_SCHEMA, bag: bag.capture(), ledger: ledger.capture() }; },
    prepareRestore(raw) {
      const d = jsonState(raw);
      if (d.schema !== SYSTEM_SCHEMA) throw new Error('Backpack system checkpoint schema differs');
      const b = bag.prepareRestore(d.bag), l = ledger.prepareRestore(d.ledger);
      return { commit() { l.commit(); b.commit(); approach.reset(); }, notify() { l.notify(); b.notify(); } };
    },
    restore(raw) { const plan = api.prepareRestore(raw); plan.commit(); plan.notify(); },
    dispose() { approach.reset(); },
  };
  return api;
}

/** Host extension (host/system.js pattern). Options: { profile, inventory, audio }. The system is available as the init() result. */
export function backpackExtension(options = {}) {
  const ext = extension('backpack', opts => createBackpackSystem(opts), options);
  // The game calls system.step(dt, input) itself (hand input is the game's); the host's input-less update must not cancel a pull.
  return { ...ext, quality: [...BACKPACK_TIERS], update() {} };
}

export default backpackExtension;
