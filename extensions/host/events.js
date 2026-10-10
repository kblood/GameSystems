// Small synchronous event bus for the extension host. A failing listener is reported and skipped, so one broken
// extension never stops the game from delivering an event to the others. No allocation per emit beyond the snapshot
// of the listener list (listeners may unsubscribe themselves while handling an event).

/** Events the core game sends. Extensions may emit their own names too (prefix them with their id, e.g. 'avatar:ready'). */
export const CORE_EVENTS = Object.freeze(['grab', 'release', 'broken', 'xrStart', 'xrEnd', 'disconnect', 'handTrackingChanged']);

export function createEventBus({ onError = (error, event) => console.error(`Extension event '${event}' failed`, error) } = {}) {
  const listeners = new Map(); // event -> Set<cb>
  const bus = {
    /** Subscribe; returns an unsubscribe function. */
    on(event, cb) {
      if (typeof cb !== 'function') throw new TypeError(`on('${event}') needs a function`);
      let set = listeners.get(event);
      if (!set) listeners.set(event, set = new Set());
      set.add(cb);
      return () => bus.off(event, cb);
    },
    off(event, cb) {
      const set = listeners.get(event); if (!set) return;
      set.delete(cb);
      if (!set.size) listeners.delete(event);
    },
    /** Calls every listener in subscription order. Returns how many listeners ran without throwing. */
    emit(event, data) {
      const set = listeners.get(event); if (!set) return 0;
      let ok = 0;
      for (const cb of [...set]) {
        try { cb(data); ok++; } catch (error) { onError(error, event); }
      }
      return ok;
    },
    count(event) { return listeners.get(event)?.size ?? 0; },
    clear() { listeners.clear(); },
  };
  return bus;
}
