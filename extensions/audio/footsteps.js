// Footstep tracker: turns the player's movement into footstep sounds. Feed it the head/rig position each frame
// (`update(pos, dt)`); every `stride` metres walked (horizontal, default 0.7 m) it calls audio.footstep() with the floor
// material and a low gain. Pure JS (no three.js, no DOM); works with any object that has footstep(), e.g. the audio api.
// Teleports and fast jumps (the frame moved faster than maxSpeed, default 6 m/s) restart the stride instead of firing steps.
// Steps are placed at the feet (y = `floorY`, default 0), alternating a little left/right of the walking line.
//
//   const steps = createFootstepTracker(audio, { surfaceAt: (x, z) => 'wood', gain: 0.45 });
//   steps.update([x, y, z], dt)  -> number of steps fired this call (0 or 1)
const px = p => (p ? (p.x ?? p[0]) : NaN), pz = p => (p ? (p.z ?? p[2]) : NaN);

export function createFootstepTracker(audio, { stride = 0.7, gain = 0.4, defaultSurface = 'concrete', surfaceAt = null, floorY = 0,
  maxSpeed = 6, minSpeed = 0.15, footOffset = 0.09 } = {}) {
  let lx = NaN, lz = NaN, walked = 0, count = 0, side = 1, enabled = true, lastSurface = null;
  const at = [0, floorY, 0];
  return {
    update(position, dt) {
      const x = px(position), z = pz(position);
      if (!(x === x && z === z)) return 0;
      const dx = lx === lx ? x - lx : 0, dz = lz === lz ? z - lz : 0;
      lx = x; lz = z;
      const d = Math.hypot(dx, dz);
      if (!enabled || !(dt > 0) || !(d > 0)) return 0;
      const speed = d / dt;
      if (speed > maxSpeed) { walked = 0; return 0; } // teleport / snap turn of the rig: not walking
      if (speed < minSpeed) return 0;                  // drift or standing still
      walked += d;
      if (walked < stride) return 0;
      walked -= stride; if (walked > stride) walked = 0;
      const surface = surfaceAt?.(x, z) ?? defaultSurface;
      // alternate feet: sideways = perpendicular to the movement direction
      side = -side;
      at[0] = x - (dz / d) * footOffset * side; at[1] = typeof floorY === 'function' ? floorY(x, z) : floorY; at[2] = z + (dx / d) * footOffset * side;
      lastSurface = surface;
      count++;
      audio.footstep({ surface, position: at, speed, gain });
      return 1;
    },
    /** Forget the last position (after a teleport the caller knows about). */
    reset() { lx = lz = NaN; walked = 0; },
    setEnabled(on) { enabled = !!on; },
    get steps() { return count; },
    get lastSurface() { return lastSurface; },
    get stride() { return stride; },
  };
}
