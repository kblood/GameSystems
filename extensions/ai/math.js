// GameSystems ai extension: small vector helpers and the seeded random generator. Pure (no three.js). Points are
// {x, y, z} objects (a THREE.Vector3 fits); hosts may pass [x, y, z] arrays wherever a point is read (readPoint).
// Yaw is about +Y with forward = (sin yaw, 0, cos yaw), the canonical +Z forward of the avatar extension.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const point = (x = 0, y = 0, z = 0) => ({ x, y, z });

/** Copies an {x,y,z} or [x,y,z] into out; returns out, or null when the source is missing or not finite. */
export function readPoint(src, out) {
  if (!src) return null;
  const x = src.x ?? src[0], y = src.y ?? src[1], z = src.z ?? src[2];
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  out.x = x; out.y = y; out.z = z;
  return out;
}
export const copy = (out, p) => { out.x = p.x; out.y = p.y; out.z = p.z; return out; };
export const set = (out, x, y, z) => { out.x = x; out.y = y; out.z = z; return out; };
export const flatDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const yawTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  return (a < 0 ? a + TAU : a) - Math.PI;
}
/** Cosine of the angle between the yaw's forward and the flat direction from -> to (1 when on top of each other). */
export function facingCos(yaw, from, to) {
  const dx = to.x - from.x, dz = to.z - from.z, d = Math.hypot(dx, dz);
  return d < 1e-6 ? 1 : (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / d;
}

/** FNV-1a over the string forms of the parts: a stable 32-bit seed from ids. */
export function hashSeed(...parts) {
  let h = 2166136261;
  for (const c of parts.join('|')) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) || 1;
}

/** Deterministic generator (mulberry32). Same seed, same sequence, on every platform. */
export function createRng(seed = 1) {
  let s = (seed >>> 0) || 1;
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    angle: () => next() * TAU,
    get state() { return s; },
    set state(v) { s = v >>> 0; },
  };
}
