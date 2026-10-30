// Flame registry, light selection and scorch ring of fire-fx. Pure. Records are allocated once at the capacity and reused;
// the dense `list` array is what the three layer walks each frame (no Map iteration, no allocation).

const vec = (v, name) => {
  const x = v?.[0] ?? v?.x, y = v?.[1] ?? v?.y, z = v?.[2] ?? v?.z;
  if (![x, y, z].every(n => typeof n === 'number' && Number.isFinite(n))) throw new RangeError(`${name} must be [x, y, z] or {x, y, z} of finite numbers`);
  return [x, y, z];
};
const positive = (v, name, fallback) => {
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new RangeError(`${name} must be a finite number >= 0`);
  return v;
};

/** Writes a vector-like (array or {x,y,z}) into out[0..2] without allocating; false when it is not finite. */
export function readVec(v, out) {
  const x = v[0] ?? v.x, y = v[1] ?? v.y, z = v[2] ?? v.z;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  out[0] = x; out[1] = y; out[2] = z; return true;
}

export function createFlameRegistry(capacity) {
  if (!Number.isInteger(capacity) || capacity < 0) throw new RangeError('capacity must be an integer >= 0');
  const records = Array.from({ length: capacity }, (_, i) => ({
    id: null, position: [0, 0, 0], normal: [0, 1, 0], size: 0.3, intensity: 1, seed: (i * 0.6180339887) % 1,
    emit: 0, visible: false, lit: false, slot: -1,
  }));
  const list = [], byId = new Map();
  let rejected = 0;
  return {
    capacity, list,
    get count() { return list.length; },
    get rejected() { return rejected; },
    has(id) { return byId.has(id); },
    get(id) { return byId.get(id) ?? null; },
    /** Adds (or, for a known id, updates) a flame. Returns false when the registry is full (hard cap). */
    add({ id, position, normal = [0, 1, 0], size = 0.3, intensity = 1 } = {}) {
      if (id === undefined || id === null) throw new TypeError('flame id is required');
      const p = vec(position, 'position'), nrm = vec(normal, 'normal');
      size = positive(size, 'size', 0.3); intensity = positive(intensity, 'intensity', 1);
      let r = byId.get(id);
      if (!r) {
        if (list.length >= capacity) { rejected++; return false; }
        r = records[list.length]; r.id = id; r.emit = 0; r.visible = false; r.lit = false;
        list.push(r); byId.set(id, r);
      }
      r.position[0] = p[0]; r.position[1] = p[1]; r.position[2] = p[2];
      const len = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1;
      r.normal[0] = nrm[0] / len; r.normal[1] = nrm[1] / len; r.normal[2] = nrm[2] / len;
      r.size = size; r.intensity = intensity;
      return true;
    },
    /** Moves a flame (and optionally resizes it / changes its intensity). No allocation. False for an unknown id. */
    move(id, position, size, intensity) {
      const r = byId.get(id);
      if (!r || !readVec(position, r.position)) return false;
      if (typeof size === 'number' && size >= 0 && Number.isFinite(size)) r.size = size;
      if (typeof intensity === 'number' && intensity >= 0 && Number.isFinite(intensity)) r.intensity = intensity;
      return true;
    },
    /** Removes a flame; its record goes back to the free end of the pool. */
    remove(id) {
      const r = byId.get(id);
      if (!r) return false;
      byId.delete(id);
      const i = list.indexOf(r), last = list.length - 1;
      // Keep records[0..count) == list members: swap the record objects in the backing array too.
      const j = records.indexOf(r);
      if (i !== last) list[i] = list[last];
      list.pop();
      const k = list.length; // first free backing slot after removal
      if (j !== k) { const tmp = records[k]; records[k] = r; records[j] = tmp; }
      r.id = null; r.visible = false; r.lit = false;
      return true;
    },
    clear() { for (const r of list) { r.id = null; r.visible = false; r.lit = false; } list.length = 0; byId.clear(); },
  };
}

/** Bounding sphere of a flame (a rising teardrop above its base): writes center into out[0..2], returns the radius. */
export function flameBounds(r, out) {
  const h = r.size * 1.6;
  out[0] = r.position[0] + r.normal[0] * r.size * 0.1;
  out[1] = r.position[1] + h * 0.5;
  out[2] = r.position[2] + r.normal[2] * r.size * 0.1;
  return Math.hypot(h * 0.5, r.size * 0.5);
}

/**
 * Picks up to n visible flames for the real lights: highest intensity × size / (1 + distance²) to the camera.
 * Writes their list indices into outIndex (Int32Array of length >= n); returns how many were picked. No allocation.
 */
export function selectLights(list, n, camera, outIndex, outScore) {
  let picked = 0;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r.visible || r.intensity <= 0 || n === 0) continue;
    const dx = r.position[0] - camera[0], dy = r.position[1] - camera[1], dz = r.position[2] - camera[2];
    const score = r.intensity * r.size / (1 + dx * dx + dy * dy + dz * dz);
    if (picked < n) { outIndex[picked] = i; outScore[picked] = score; picked++; }
    else if (score > outScore[n - 1]) { outIndex[n - 1] = i; outScore[n - 1] = score; }
    else continue;
    for (let k = picked - 1; k > 0 && outScore[k] > outScore[k - 1]; k--) { // keep sorted, best first
      const s = outScore[k]; outScore[k] = outScore[k - 1]; outScore[k - 1] = s;
      const x = outIndex[k]; outIndex[k] = outIndex[k - 1]; outIndex[k - 1] = x;
    }
  }
  return picked;
}

/** Ring of scorch decals: at most `limit` alive, the oldest replaced. Records are allocated once. */
export function createScorchRing(capacity) {
  if (!Number.isInteger(capacity) || capacity < 0) throw new RangeError('capacity must be an integer >= 0');
  const slots = Array.from({ length: capacity }, () => ({ position: [0, 0, 0], normal: [0, 1, 0], radius: 0, seed: 0, stamp: -1 }));
  let limit = capacity, cursor = 0, count = 0, stamps = 0, replaced = 0;
  return {
    capacity, slots,
    get limit() { return limit; },
    get count() { return count; },
    get replaced() { return replaced; },
    /** Stamps a scorch; returns its slot (-1 when the limit is 0). */
    add(position, normal, radius) {
      if (limit === 0) return -1;
      const s = slots[cursor], slot = cursor;
      if (!readVec(position, s.position)) throw new RangeError('scorch position must be finite');
      if (!readVec(normal ?? [0, 1, 0], s.normal)) throw new RangeError('scorch normal must be finite');
      const len = Math.hypot(s.normal[0], s.normal[1], s.normal[2]);
      if (len < 1e-9) { s.normal[0] = 0; s.normal[1] = 1; s.normal[2] = 0; } else for (let i = 0; i < 3; i++) s.normal[i] /= len;
      if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0) throw new RangeError('scorch radius must be a finite number > 0');
      s.radius = radius; s.seed = ((stamps * 0.7548776662) % 1); s.stamp = stamps++;
      if (count < limit) count++; else replaced++;
      cursor = cursor + 1 >= limit ? 0 : cursor + 1;
      return slot;
    },
    /** Changes the limit (never above capacity); keeps the newest scorches, packed into slots 0..count-1. */
    setLimit(n) {
      if (!Number.isInteger(n) || n < 0) throw new RangeError('limit must be an integer >= 0');
      n = Math.min(n, capacity);
      const live = slots.slice(0, limit).filter(s => s.stamp >= 0).sort((a, b) => b.stamp - a.stamp);
      const keep = live.slice(0, n).reverse(), rest = slots.filter(s => !keep.includes(s));
      for (const s of live.slice(n)) s.stamp = -1;
      slots.splice(0, slots.length, ...keep, ...rest);
      limit = n; count = keep.length; cursor = count >= limit ? 0 : count;
      return limit;
    },
    clear() { for (const s of slots) s.stamp = -1; count = 0; cursor = 0; },
  };
}
