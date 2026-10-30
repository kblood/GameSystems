// Pilot light / ignition of the flamethrower. Pure. While lit, fuel leaving the nozzle ignites (after igniteDelay, handled
// by the weapon). douse() puts it out (water, a backfire); it relights by itself after relightSeconds, or never when the
// pilot is disabled (a fuel-sprayer variant).

export function createPilotLight({ enabled = true, startLit = true, relightSeconds = 1.2 } = {}) {
  let lit = enabled && startLit, relightIn = enabled && !startLit ? relightSeconds : -1, douses = 0;
  return {
    get enabled() { return enabled; },
    get lit() { return lit; },
    get relighting() { return relightIn >= 0; },
    get relightIn() { return Math.max(0, relightIn); },
    get douses() { return douses; },
    /** Puts the pilot out; it relights after relightSeconds. Returns true when it was lit. */
    douse() { const was = lit; lit = false; if (enabled) relightIn = relightSeconds; if (was) douses++; return was; },
    /** Skips the wait: the pilot lights on the next tick (an igniter button). False when disabled or already lit. */
    relight() { if (!enabled || lit) return false; relightIn = 0; return true; },
    /** Advances the relight timer; returns true on the frame the pilot lights. */
    tick(dt) {
      if (relightIn < 0) return false;
      relightIn -= dt;
      if (relightIn > 0) return false;
      relightIn = -1; lit = true; return true;
    },
  };
}
