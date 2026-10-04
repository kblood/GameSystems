// Liquid fill table lookup, version 2 ("sphere_map") with a version 1 ("axis table") fallback.  See docs/liquid_lut_v2.md.
// Gameplay agnostic, no dependencies (plain {x,y,z} objects or THREE.Vector3 both work).
//
//   import { makeLut } from './liquid_lut_v2.js';
//   const info = JSON.parse(liquidNode.userData.liquid);      // or the .liquid.json sidecar (v1 or v2)
//   const lut  = makeLut(info);
//   const d    = lut.offset(upObj, fill);   // plane  dot(p_obj, upObj) = d  keeps `fill` of the interior below it
//   const f    = lut.fillAt(upObj, d);      // inverse: fill fraction below plane d
//   const s    = lut.spill(upObj, fill);    // { d, fill, spilled, lost }  clamps the level at the lowest rim point
// upObj = world up expressed in the node's local space (apply the inverse of the node's world rotation; uniform scale
// assumed, divide d by the scale if the node is scaled).

const _w = new Float64Array(16), _ix = new Int32Array(16);

function cr(t, out) {
  const t2 = t * t, t3 = t2 * t;
  out[0] = (-t3 + 2 * t2 - t) / 2; out[1] = (3 * t3 - 5 * t2 + 2) / 2;
  out[2] = (-3 * t3 + 4 * t2 + t) / 2; out[3] = (t3 - t2) / 2;
}
const _wx = new Float64Array(4), _wy = new Float64Array(4);

/** unit direction -> octahedral map coords in [0,1] (fold axis = +Y: upright = centre, upside down = corners). */
export function octEncode(x, y, z) {
  const l = Math.abs(x) + Math.abs(y) + Math.abs(z);
  let a = x / l, b = z / l;
  if (y < 0) { const a2 = (1 - Math.abs(b)) * (x >= 0 ? 1 : -1), b2 = (1 - Math.abs(a)) * (z >= 0 ? 1 : -1); a = a2; b = b2; }
  return [a * 0.5 + 0.5, b * 0.5 + 0.5];
}

/** inverse of octEncode (used by the offline tools; handy for debugging). */
export function octDecode(u, v) {
  let a = u * 2 - 1, b = v * 2 - 1;
  const y = 1 - Math.abs(a) - Math.abs(b);
  if (y < 0) { const a2 = (1 - Math.abs(b)) * (a >= 0 ? 1 : -1), b2 = (1 - Math.abs(a)) * (b >= 0 ? 1 : -1); a = a2; b = b2; }
  const l = Math.hypot(a, y, b);
  return [a / l, y / l, b / l];
}

function decodeB64(s) {
  if (typeof atob === 'function') { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  return new Uint8Array(Buffer.from(s, 'base64'));                         // node fallback
}

/** Catmull-Rom taps (16) in the octahedral grid; mirrors out-of-range taps across the border (octahedral fold). */
function taps(n, up) {
  const l = Math.hypot(up.x, up.y, up.z);
  const [u, v] = octEncode(up.x / l, up.y / l, up.z / l);
  const x = Math.min(1, Math.max(0, u)) * (n - 1), y = Math.min(1, Math.max(0, v)) * (n - 1);
  const x0 = Math.min(Math.floor(x), n - 2), y0 = Math.min(Math.floor(y), n - 2);
  cr(x - x0, _wx); cr(y - y0, _wy);
  let k = 0;
  for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++, k++) {
    let i = x0 + a - 1, j = y0 + b - 1;
    if (i < 0) { i = -i; j = n - 1 - j; }
    if (i > n - 1) { i = 2 * (n - 1) - i; j = n - 1 - j; }
    if (j < 0) { j = -j; i = n - 1 - i; }
    if (j > n - 1) { j = 2 * (n - 1) - j; i = n - 1 - i; }
    _ix[k] = j * n + i; _w[k] = _wx[a] * _wy[b];
  }
}

export class LutV2 {
  constructor(info) {
    if (info.version !== 2 || info.kind !== 'sphere_map') throw new Error('not a v2 sphere_map table');
    this.info = info; this.n = info.n_dir; this.F = info.n_fill;
    this.centre = info.centre || [0, 0, 0];
    const raw = decodeB64(info.data), N = this.n * this.n * this.F;
    this.t = new Float32Array(N);
    const d0 = info.d_min, sc = (info.d_max - info.d_min) / 65535;
    for (let i = 0; i < N; i++) this.t[i] = d0 + (raw[2 * i] | (raw[2 * i + 1] << 8)) * sc;
    this.rim = info.rim_points || null;
  }
  _lin(up) { const l = Math.hypot(up.x, up.y, up.z); return (up.x * this.centre[0] + up.y * this.centre[1] + up.z * this.centre[2]) / l; }
  offset(up, fill) {
    // memo: skip everything when called again with (nearly) the same orientation and fill (e.g. a resting container)
    const c = this._c || (this._c = { x: NaN, y: 0, z: 0, f: 0, d: 0 });
    if (Math.abs(c.x - up.x) + Math.abs(c.y - up.y) + Math.abs(c.z - up.z) + Math.abs(c.f - fill) < 1e-7) return c.d;
    const d = this._offset(up, fill);
    c.x = up.x; c.y = up.y; c.z = up.z; c.f = fill; c.d = d;
    return d;
  }
  _offset(up, fill) {
    const f = Math.min(1, Math.max(0, fill)), F = this.F;
    const t = Math.acos(1 - 2 * f) / Math.PI * (F - 1), k0 = Math.min(Math.floor(t), F - 2), ft = t - k0;
    taps(this.n, up);
    let acc = 0;
    for (let k = 0; k < 16; k++) { const o = _ix[k] * F + k0; acc += _w[k] * (this.t[o] * (1 - ft) + this.t[o + 1] * ft); }
    return acc + this._lin(up);
  }
  /** fill fraction below the plane dot(p, up) = d (inverse of offset). */
  fillAt(up, d) {
    const F = this.F, row = new Float64Array(F);
    taps(this.n, up);
    for (let k = 0; k < 16; k++) { const o = _ix[k] * F, w = _w[k]; for (let q = 0; q < F; q++) row[q] += w * this.t[o + q]; }
    d -= this._lin(up);
    let c = 0; for (let q = 0; q < F; q++) if (row[q] <= d) c++;
    const k0 = Math.min(Math.max(c - 1, 0), F - 2), a = row[k0], b = row[k0 + 1];
    const ft = Math.min(1, Math.max(0, (d - a) / Math.max(b - a, 1e-12)));
    return 0.5 - 0.5 * Math.cos(Math.PI * (k0 + ft) / (F - 1));
  }
  /** Open container: clamp the surface at the lowest rim point. Returns { d, fill, spilled, lost (fill fraction lost) }. */
  spill(up, fill, rim = this.rim) {
    const d = this.offset(up, fill);
    if (!rim || !rim.length) return { d, fill, spilled: false, lost: 0 };
    const l = Math.hypot(up.x, up.y, up.z);
    let dr = Infinity;
    for (const p of rim) dr = Math.min(dr, (p[0] * up.x + p[1] * up.y + p[2] * up.z) / l);
    if (d <= dr) return { d, fill, spilled: false, lost: 0 };
    const f2 = Math.min(fill, this.fillAt(up, dr));
    return { d: dr, fill: f2, spilled: true, lost: fill - f2 };
  }
}

/** Legacy version 1 axis table (bottles): lut[cos_tilt][fill], axis = object Y.  Same interface as LutV2. */
export class LutV1 {
  constructor(info) { this.info = info; this.lut = info.lut; this.nc = info.n_cos; this.nf = info.n_fill; this.rim = info.rim_points || null; }
  offset(up, fill) {
    const l = Math.hypot(up.x, up.y, up.z), c = Math.min(1, Math.max(-1, up.y / l)), f = Math.min(1, Math.max(0, fill));
    const x = (c * 0.5 + 0.5) * (this.nc - 1), y = f * (this.nf - 1);
    const x0 = Math.min(this.nc - 2, Math.floor(x)), y0 = Math.min(this.nf - 2, Math.floor(y)), fx = x - x0, fy = y - y0, L = this.lut;
    const a = L[x0][y0] * (1 - fy) + L[x0][y0 + 1] * fy, b = L[x0 + 1][y0] * (1 - fy) + L[x0 + 1][y0 + 1] * fy;
    return a * (1 - fx) + b * fx;
  }
  fillAt(up, d) {                                                     // bisection (offset is monotone in fill)
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (this.offset(up, m) < d) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
  spill(up, fill, rim = this.rim) { return LutV2.prototype.spill.call(this, up, fill, rim); }
}

/** Pick the right decoder from the liquid info (object or JSON string). */
export function makeLut(info) {
  if (typeof info === 'string') info = JSON.parse(info);
  return info.version === 2 ? new LutV2(info) : new LutV1(info);
}
