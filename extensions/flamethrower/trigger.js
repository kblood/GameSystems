// Trigger state of the flamethrower. Pure. set(on) is what the input layer calls (controller select, mouse); tick(dt)
// counts how long it has been held.

export function createTrigger() {
  let held = false, heldSeconds = 0, pulls = 0, releases = 0;
  return {
    get held() { return held; },
    get heldSeconds() { return heldSeconds; },
    get pulls() { return pulls; },
    get releases() { return releases; },
    /** Returns true when the state changed. */
    set(on) {
      on = !!on;
      if (on === held) return false;
      held = on; if (on) { pulls++; heldSeconds = 0; } else releases++;
      return true;
    },
    tick(dt) { if (held) heldSeconds += dt; },
  };
}
