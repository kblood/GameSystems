// Fixed-capacity particle pool for embers, sparks and flame puffs. Pure. Structure of arrays (typed arrays allocated once);
// spawn() takes the next slot of a ring that wraps at the live limit, so when the pool is full the oldest-placed particle
// is recycled instead of allocating. step() integrates in place. Nothing here allocates after creation.

export const PARTICLE_KIND = Object.freeze({ ember: 0, spark: 1, puff: 2 });
// Per kind: vertical acceleration (m/s², + is up: embers and puffs are buoyant), linear drag (1/s), size growth (×/s).
const ACCEL = new Float32Array([0.9, -9.8, 1.6]);
const DRAG = new Float32Array([1.4, 0.35, 2.6]);
const GROWTH = new Float32Array([0, 0, 2.2]);

export function createParticlePool(capacity) {
  if (!Number.isInteger(capacity) || capacity < 0) throw new RangeError('capacity must be an integer >= 0');
  const pos = new Float32Array(capacity * 3), vel = new Float32Array(capacity * 3);
  const age = new Float32Array(capacity), life = new Float32Array(capacity), size = new Float32Array(capacity);
  const seed = new Float32Array(capacity), kind = new Uint8Array(capacity), alive = new Uint8Array(capacity);
  let cursor = 0, limit = capacity, live = 0, spawned = 0, recycled = 0, dropped = 0;

  const kill = i => { if (alive[i]) { alive[i] = 0; live--; } };

  return {
    capacity,
    pos, vel, age, life, size, seed, kind, alive,
    get limit() { return limit; },
    get live() { return live; },
    /** Places one particle; returns its slot, or -1 when the limit is 0. Overwrites (recycles) the slot when it is alive. */
    spawn(x, y, z, vx, vy, vz, lifeSeconds, sizeM, kindId, seedValue = 0) {
      if (limit === 0) { dropped++; return -1; }
      const i = cursor; cursor = cursor + 1 >= limit ? 0 : cursor + 1;
      if (alive[i]) recycled++; else { alive[i] = 1; live++; }
      const k = i * 3;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z; vel[k] = vx; vel[k + 1] = vy; vel[k + 2] = vz;
      age[i] = 0; life[i] = lifeSeconds > 0 ? lifeSeconds : 0.01; size[i] = sizeM; kind[i] = kindId; seed[i] = seedValue;
      spawned++;
      return i;
    },
    /** Lowers or raises the live limit (never above capacity); particles in slots >= n die. */
    setLimit(n) {
      if (!Number.isInteger(n) || n < 0) throw new RangeError('limit must be an integer >= 0');
      n = Math.min(n, capacity);
      for (let i = n; i < limit; i++) kill(i);
      limit = n; if (cursor >= limit) cursor = 0;
      return limit;
    },
    /** Ages, accelerates, drags and moves every live particle; kills the expired ones. */
    step(dt) {
      for (let i = 0; i < limit; i++) {
        if (!alive[i]) continue;
        const a = age[i] + dt;
        if (a >= life[i]) { kill(i); continue; }
        age[i] = a;
        const t = kind[i], k = i * 3, damp = Math.max(0, 1 - DRAG[t] * dt);
        vel[k] *= damp; vel[k + 1] = (vel[k + 1] + ACCEL[t] * dt) * damp; vel[k + 2] *= damp;
        pos[k] += vel[k] * dt; pos[k + 1] += vel[k + 1] * dt; pos[k + 2] += vel[k + 2] * dt;
        if (GROWTH[t]) size[i] *= 1 + GROWTH[t] * dt;
      }
    },
    clear() { alive.fill(0); live = 0; cursor = 0; },
    stats() { return { live, limit, capacity, spawned, recycled, dropped }; },
  };
}
