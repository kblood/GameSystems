import { registry, positive, finite, vector, distance, clamp, extension, tierState } from '../host/system.js';

// Room/portal graph; choose lowest-loss path, then distance attenuation and speed-of-sound delay.
export function createAcousticsSystem({ emit = () => {}, quality = 'high', speedOfSound = 343, maxPending = 128 } = {}) {
  positive(speedOfSound); positive(maxPending); const rooms = registry(), portals = registry(), listeners = registry(), tiers = tierState(quality); let clock = 0, stepping = false; const pending = [];
  const api = {
    get quality() { return tiers.quality; }, setQuality: tiers.setQuality,
    addRoom(id) { rooms.add(id, { id }); },
    addPortal(id, { a, b, position = [0, 0, 0], open = 0, closedLossDb = 35, openLossDb = 2 } = {}) { rooms.get(a); rooms.get(b); if (a === b) throw new Error('Portal needs two rooms'); portals.add(id, { id, a, b, position: vector(position), open: clamp(finite(open), 0, 1), closedLossDb: positive(closedLossDb, 'closedLossDb', true), openLossDb: positive(openLossDb, 'openLossDb', true) }); },
    setPortal(id, open) { const p = portals.get(id); p.open = clamp(finite(open), 0, 1); },
    addListener(id, { room, position = [0, 0, 0], thresholdDb = 20, receive = () => {} } = {}) { rooms.get(room); finite(thresholdDb); if (typeof receive !== 'function') throw new TypeError('receive must be a function'); listeners.add(id, { id, room, position: vector(position), thresholdDb, receive }); },
    moveListener(id, room, position) { rooms.get(room); const l = listeners.get(id); l.room = room; l.position = vector(position); },
    path(from, to) {
      rooms.get(from); rooms.get(to); const best = new Map([[from, { lossDb: 0, portals: [] }]]), visited = new Set();
      while (true) {
        let current = null; for (const [id, p] of best) if (!visited.has(id) && (current === null || p.lossDb < best.get(current).lossDb)) current = id;
        if (current === null) return null; if (current === to) return best.get(current); visited.add(current);
        for (const p of portals.entries.values()) { const next = p.a === current ? p.b : p.b === current ? p.a : null; if (!next || visited.has(next)) continue;
          const lossDb = best.get(current).lossDb + p.closedLossDb * (1 - p.open) + p.openLossDb * p.open;
          if (!best.has(next) || lossDb < best.get(next).lossDb) best.set(next, { lossDb, portals: [...best.get(current).portals, p.id] });
        }
      }
    },
    sound({ room, position = [0, 0, 0], db = 75, kind = 'impact', sourceId = null } = {}) {
      rooms.get(room); position = vector(position); finite(db); const results = [];
      for (const l of listeners.entries.values()) {
        const path = api.path(room, l.room); if (!path) continue;
        const points = [position, ...path.portals.map(id => portals.get(id).position), l.position]; let meters = 0;
        for (let i = 1; i < points.length; i++) meters += distance(points[i - 1], points[i]);
        const receivedDb = db - path.lossDb - 20 * Math.log10(Math.max(1, meters));
        if (receivedDb < l.thresholdDb) continue;
        const event = { listenerId: l.id, room, position: [...position], db: receivedDb, gain: 10 ** ((receivedDb - db) / 20), delay: meters / speedOfSound, kind, sourceId, portals: path.portals };
        if (pending.length < maxPending) { pending.push({ at: clock + event.delay, event }); results.push(event); }
        else emit('acoustics:dropped', { sourceId, reason: 'budget' });
      }
      return results;
    },
    step(dt) { if(stepping)throw new Error('Acoustics step is reentrant');positive(dt, 'dt', true);stepping=true;let observerError,observerFailed=false;const report=callback=>{try{callback();}catch(error){if(!observerFailed){observerError=error;observerFailed=true;}}};try{clock += dt; const due = [];
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i].at <= clock) due.push(...pending.splice(i, 1));
      due.sort((a, b) => a.at - b.at); for (const { event } of due) { const l = listeners.entries.get(event.listenerId); if (l) { report(()=>l.receive(event));report(()=>emit('acoustics:heard',event)); } }
      }finally{stepping=false;}if(observerFailed)throw observerError;
    },
    removeListener(id) { for (let i = pending.length - 1; i >= 0; i--) if (pending[i].event.listenerId === id) pending.splice(i, 1); return listeners.remove(id); },
    removePortal: portals.remove,
    removeRoom(id) {
      rooms.get(id);
      for (const p of [...portals.entries.values()]) if (p.a === id || p.b === id) portals.remove(p.id);
      for (const l of [...listeners.entries.values()]) if (l.room === id) api.removeListener(l.id);
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i].event.room === id) pending.splice(i, 1);
      return rooms.remove(id);
    },
    get pendingCount() { return pending.length; },
    dispose() { pending.length = 0; listeners.dispose(); portals.dispose(); rooms.dispose(); },
  };
  return api;
}
export default options => extension('acoustics', createAcousticsSystem, options, (ctx, api) => ctx.on('sound:emit', sound => api.sound(sound)));
