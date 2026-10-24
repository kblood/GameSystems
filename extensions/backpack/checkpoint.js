// Backpack checkpoint v2: the backpack layer's OWN state only (container cells + optional bag state). It never contains or
// changes the inventory provider's checkpoint (NightfallGearInventory v1 stays as it is); a game keeps the provider's checkpoint
// as before and stores this payload next to it under its own key. Restoring accepts that the payload is MISSING (a checkpoint
// from before the backpack layer): nothing is touched and the cell mapping is simply what the provider's own checkpoint says.
// Accepted shapes: v2 { schema, profileId, ledger, bag|null }, the older P0 system checkpoint (gamesystems.backpack-system.v1) and a bare ledger v1.
import { jsonState } from '../host/state.js';
import { LEDGER_SCHEMA } from './ledger.js';

export const CHECKPOINT_SCHEMA = 'gamesystems.backpack-checkpoint.v2';
const SYSTEM_V1 = 'gamesystems.backpack-system.v1';

/** { schema, profileId, ledger, bag } (JSON-safe). `bag` is the BackpackState capture, or null for a container without bag state (stash). */
export function captureCheckpoint({ ledger, bag = null }) {
  return { schema: CHECKPOINT_SCHEMA, profileId: ledger.profile.id, ledger: ledger.capture(), bag: bag ? bag.capture() : null };
}

/** Validates without changing anything and returns { absent, version, commit(), notify() }. raw undefined/null = no backpack state (legacy): a no-op plan. Throws on bad data. */
export function prepareCheckpoint({ ledger, bag = null }, raw) {
  if (raw === undefined || raw === null) return { absent: true, version: 0, commit() {}, notify() {} };
  const d = jsonState(raw);
  let ledgerData, bagData = null, version;
  if (d.schema === CHECKPOINT_SCHEMA) {
    if (d.profileId !== ledger.profile.id) throw new Error('Backpack checkpoint belongs to another profile');
    if (!d.ledger || typeof d.ledger !== 'object') throw new Error('Backpack checkpoint v2 needs a ledger');
    if (d.bag !== null && (typeof d.bag !== 'object' || Array.isArray(d.bag))) throw new Error('Backpack checkpoint v2 bag must be null or an object');
    ledgerData = d.ledger; bagData = d.bag; version = 2;
  } else if (d.schema === SYSTEM_V1) { ledgerData = d.ledger; bagData = d.bag ?? null; version = 1; }
  else if (d.schema === LEDGER_SCHEMA) { ledgerData = d; version = 1; }
  else throw new Error('Backpack checkpoint schema differs');
  const l = ledger.prepareRestore(ledgerData), b = bag && bagData ? bag.prepareRestore(bagData) : null;
  return { absent: false, version, commit() { l.commit(); b?.commit(); }, notify() { l.notify(); b?.notify(); } };
}

export function restoreCheckpoint(target, raw) { const plan = prepareCheckpoint(target, raw); plan.commit(); plan.notify(); return plan; }
