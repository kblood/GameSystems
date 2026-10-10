// Shared lifecycle and input helpers for engine-independent gameplay extensions. MIT.
export const SYSTEM_TIERS = Object.freeze(['minimal', 'low', 'mid', 'high']);
export function finite(value, name = 'value') {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}
export function positive(value, name = 'value', zero = false) {
  finite(value, name);
  if (zero ? value < 0 : value <= 0) throw new RangeError(`${name} must be ${zero ? 'nonnegative' : 'positive'}`);
  return value;
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function vector(v, name = 'position') {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) throw new TypeError(`${name} needs three finite numbers`);
  return [...v];
}
export const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export function unit(v) { v = vector(v); const n = Math.hypot(...v); if (n < 1e-9) throw new RangeError('axis is zero'); return v.map(x => x / n); }
export function registry() {
  const entries = new Map(); let disposed = false;
  return {
    entries,
    add(id, value) {
      if (disposed) throw new Error('System is disposed');
      if (typeof id !== 'string' || !id || entries.has(id)) throw new Error(`Invalid or duplicate id: ${id}`);
      entries.set(id, value); return value;
    },
    get(id) { const v = entries.get(id); if (!v) throw new Error(`Unknown id: ${id}`); return v; },
    remove(id) { return entries.delete(id); },
    dispose() { disposed = true; entries.clear(); },
  };
}
export function extension(id, create, options = {}, connect = () => {}) {
  let api;
  return { id, quality: SYSTEM_TIERS,
    init(ctx) { api = create({ ...options, emit: ctx.emit, quality: ctx.quality }); connect(ctx, api); return api; },
    update(dt) { api.step?.(dt); },
    setQuality(tier) { api.setQuality(tier); },
    dispose() { api?.dispose(); },
  };
}
export function tierState(initial = 'high') {
  let tier = initial;
  return { get quality() { return tier; }, setQuality(value) { if (!SYSTEM_TIERS.includes(value)) throw new RangeError(`Unknown quality: ${value}`); tier = value; } };
}
