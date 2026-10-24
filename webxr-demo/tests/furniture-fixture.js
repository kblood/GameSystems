// Shared fixtures for the furniture tests: a mechanics system on an event bus, a fake audio recorder and a stepping helper.
import { createMechanicsSystem } from '../../extensions/mechanics/index.js';
import { createEventBus } from '../../extensions/host/events.js';
import { createMemoryInventory } from '../../extensions/backpack/index.js';
import { createFurniture } from '../../extensions/furniture/furniture.js';

export function fakeAudio() {
  const a = { contacts: [], plays: [], contact(c) { a.contacts.push({ ...c }); return true; }, play(key, o) { a.plays.push({ key, ...o }); return true; }, reset() { a.contacts.length = 0; a.plays.length = 0; } };
  return a;
}

/** A small world: bus + mechanics + optional inventory/audio. `make(spec, options)` creates a furniture piece on it. */
export function world({ quality = 'high', audio = null, inventory = true, isBlocked, powerOf, onReject, creaks } = {}) {
  const bus = createEventBus(), events = [];
  bus.on('furniture:opened', e => events.push(e)); for (const t of ['closed', 'locked', 'unlocked', 'itemStored', 'itemRemoved', 'rejected', 'clunk', 'blocked']) bus.on(`furniture:${t}`, e => events.push(e));
  const mechanics = createMechanicsSystem({ emit: bus.emit });
  const inv = inventory ? createMemoryInventory() : null;
  const host = { mechanics, on: bus.on, emit: bus.emit, audio, inventory: inv, isBlocked, powerOf, onReject, creaks, quality };
  const all = [];
  const w = {
    bus, mechanics, inv, host, events, all,
    make(spec, options = {}) { const f = createFurniture(host, spec, options); all.push(f); return f; },
    /** step furniture then mechanics for `seconds` at `hz`; perFrame(t) runs first. Returns the time simulated. */
    run(seconds, hz = 72, perFrame = null) {
      const dt = 1 / hz, n = Math.round(seconds * hz);
      for (let i = 0; i < n; i++) { perFrame?.(i * dt); for (const f of all) f.step(dt); mechanics.step(dt); }
      return n * dt;
    },
    count: type => events.filter(e => e.type === type).length,
    last: type => [...events].reverse().find(e => e.type === type),
    item(id, category = 'bottle', size = [0.26, 0.065, 0.065]) { inv.registerItem(id, category, size, 'world'); return id; },
  };
  return w;
}

/** Drag a part with one hand: grabs at its first handle, moves the hand by `delta` (world, metres) over `seconds`, optionally keeps holding. */
export function drag(w, f, partId, owner, delta, seconds = 1.2, hz = 72, { hold = false, handleIndex = 0 } = {}) {
  const start = f.handleWorld(partId, handleIndex);
  const res = f.grab(partId, owner, start);
  const n = Math.round(seconds * hz);
  for (let i = 1; i <= n; i++) { const k = Math.min(1, i / (n * 0.5)); f.moveHand(partId, owner, [start[0] + delta[0] * k, start[1] + delta[1] * k, start[2] + delta[2] * k]); w.run(1 / hz, hz); }
  if (!hold) f.release(partId, owner);
  return res;
}
