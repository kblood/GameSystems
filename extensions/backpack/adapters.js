// Adapter interfaces of the backpack core (design doc 3.1). The core never touches an engine: the host implements these
// and passes them in. Only the body anchor is needed to place the bag; the others are optional with null defaults.
//
//   bodyAnchor  wornPose(side) strapPoints() shoulderHeight() bodyFrame() posture() handedness()
//               -> JS default: derived from vrik.joints (hips/spine/chest + offsets); Godot: get_gear_anchor("holster"/"magazine").
//   inventory   addSlot(id, categories, maxSize) itemInfo(id) store(id, expectedOwner, slotId) retrieve(slotId, newOwner)
//               itemInSlot(slotId) slotOf(id)   (ledger.js createMemoryInventory() is the reference; Godot: a thin wrapper
//               around NightfallGearInventory, P2)
//   input       hand(side) -> { pose, tracked, grip, interact }   (the game's own actions; the bag reads no device)
//   audio       event(name, { side, state, itemId, pocketId })    names: bag_strap_grab bag_unzip bag_clasp bag_set_down item_rustle
export const ADAPTER_METHODS = Object.freeze({
  bodyAnchor: ['wornPose', 'strapPoints', 'shoulderHeight', 'bodyFrame', 'posture', 'handedness'],
  inventory: ['addSlot', 'itemInfo', 'store', 'retrieve', 'itemInSlot', 'slotOf'],
  input: ['hand'],
  audio: ['event'],
});
export const REQUIRED_ADAPTERS = Object.freeze(['inventory']);

/** Throws when `adapter` lacks a method of interface `name`. Returns the adapter. */
export function assertAdapter(name, adapter) {
  const methods = ADAPTER_METHODS[name];
  if (!methods) throw new RangeError(`Unknown adapter interface: ${name}`);
  for (const m of methods) if (typeof adapter?.[m] !== 'function') throw new TypeError(`${name} adapter needs ${m}()`);
  return adapter;
}

export const nullAudio = Object.freeze({ event() {} });
/** Audio adapter that records calls (tests, debugging). */
export function createRecordingAudio() { const calls = []; return { calls, event(name, data) { calls.push({ name, ...data }); } }; }

/** State event -> audio event name (or null). */
export function audioNameFor(e) {
  if (e.type === 'detached' || (e.type === 'state' && e.reason === 'grab_placed') || (e.type === 'state' && e.reason === 'call_to_hand')) return 'bag_strap_grab';
  if (e.type === 'state' && e.reason === 'opened') return 'bag_unzip';
  if (e.type === 'state' && (e.reason === 'closed' || e.reason === 'returned')) return 'bag_clasp';
  if (e.type === 'state' && e.reason === 'placed') return 'bag_set_down';
  if (e.type === 'stored' || e.type === 'retrieved' || e.type === 'moved') return 'item_rustle';
  return null;
}
