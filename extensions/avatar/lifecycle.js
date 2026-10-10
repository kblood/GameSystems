// GameSystems avatar extension; fork of CharacterCreatorXR (MIT, Copyright (c) 2026 Kasper Olesen) via the Contracts
// character plugin (src/lifecycle.js; the resource owner lives in character-cc). Source of truth: GameSystems/extensions/avatar.
// A closed lifetime never accepts a late async resource. Cleanup is idempotent.
export function abortError() {
  const error = new Error('Character plugin disposed');
  error.name = 'AbortError';
  return error;
}

export function createLifetime() {
  const controller = new AbortController(), cleanups = new Set();
  return {
    signal: controller.signal,
    get disposed() { return controller.signal.aborted; },
    assertAlive() { if (controller.signal.aborted) throw abortError(); },
    onDispose(fn) {
      if (controller.signal.aborted) { fn(); return () => {}; }
      cleanups.add(fn);
      return () => cleanups.delete(fn);
    },
    dispose() {
      if (controller.signal.aborted) return;
      controller.abort();
      for (const fn of [...cleanups]) {
        try { fn(); } catch (error) { console.warn('[avatar] cleanup failed', error); }
      }
      cleanups.clear();
    },
  };
}

export const frameDelta = dt => Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
