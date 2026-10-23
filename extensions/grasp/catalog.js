// Data-driven grabbable prop catalogue (web port of the Godot grasp_catalog.gd rows used here; GameSystems grasp extension).
// Item-local metres, +Y up. Adding a prop is a data row: shape, mass, flags. Pure: no three.js objects.
//
// Shapes:
//   lathe    profile [[y, radius], ...] around +Y (bottles, can)
//   cylinder {radius, half} centred at the origin (optional axis: 'x' | 'z', the cylinder then runs along that axis instead of +Y: a ladder rung)
//   box      {size:[x,y,z]} centred at the origin
//   parts    union of the above with an `at` offset (mug: body + handle)
// Bottle profiles are the GameSystems bottle_beer/bottle_wine glass silhouettes (MIT, Kasper Olesen),
// measured offline from the bottle_beer/bottle_wine GLB glass vertices (max radius per height); origin at the base centre, like the bake.

import CATALOG_DATA from './data/catalog.data.json' with { type: 'json' };

export const DEFAULT_MASS = CATALOG_DATA.DEFAULT_MASS;
export const CATALOG = CATALOG_DATA.CATALOG;
export const KINDS = Object.keys(CATALOG);
export function entry(kind) { const e = CATALOG[kind]; if (!e) throw new Error(`Unknown prop kind ${kind}`); return e; }

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function radiusAt(profile, y) {
  if (y <= profile[0][0]) return profile[0][1];
  for (let i = 1; i < profile.length; i++) {
    const [y0, r0] = profile[i - 1], [y1, r1] = profile[i];
    if (y <= y1) return r0 + (r1 - r0) * (y - y0) / Math.max(1e-9, y1 - y0);
  }
  return profile.at(-1)[1];
}

/** Approximate signed distance (m) from an item-local point to one primitive (negative inside). */
function primitiveDistance(s, p) {
  const at = s.at || [0, 0, 0], x = p[0] - at[0], y = p[1] - at[1], z = p[2] - at[2];
  if (s.type === 'box') {
    const q = [Math.abs(x) - s.size[0] / 2, Math.abs(y) - s.size[1] / 2, Math.abs(z) - s.size[2] / 2];
    const outside = Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0));
    return outside + Math.min(Math.max(q[0], q[1], q[2]), 0);
  }
  if (s.type === 'cylinder') {
    // axis 'x' / 'z': swap that axis into the +Y slot (a rigid permutation, distances are unchanged); no axis: as before
    const [u, v, w] = s.axis === 'x' ? [y, x, z] : s.axis === 'z' ? [x, z, y] : [x, y, z];
    const d = [Math.hypot(u, w) - s.radius, Math.abs(v) - s.half];
    return Math.min(Math.max(d[0], d[1]), 0) + Math.hypot(Math.max(d[0], 0), Math.max(d[1], 0));
  }
  if (s.type === 'lathe') {
    const pr = s.profile, y0 = pr[0][0], y1 = pr.at(-1)[0], rr = Math.hypot(x, z);
    const yc = clamp(y, y0, y1), radial = rr - radiusAt(pr, yc), axial = Math.max(y0 - y, y - y1);
    // Slope-corrected radial distance (the silhouette is not vertical at the shoulder).
    const i = pr.findIndex(row => row[0] >= yc), a = pr[Math.max(0, i - 1)], b = pr[Math.max(0, i)];
    const slope = b && a && b[0] > a[0] ? (b[1] - a[1]) / (b[0] - a[0]) : 0;
    const rad = radial / Math.sqrt(1 + slope * slope);
    return Math.min(Math.max(rad, axial), 0) + Math.hypot(Math.max(rad, 0), Math.max(axial, 0));
  }
  throw new Error(`Unknown primitive ${s.type}`);
}
export function signedDistance(shape, p) {
  if (shape.type === 'parts') return Math.min(...shape.parts.map(s => primitiveDistance(s, p)));
  return primitiveDistance(shape, p);
}
/** Outward normal (finite differences of the SDF). */
export function surfaceNormal(shape, p, h = 1e-4) {
  const n = [0, 1, 2].map(k => {
    const a = [...p], b = [...p]; a[k] += h; b[k] -= h;
    return signedDistance(shape, a) - signedDistance(shape, b);
  });
  const l = Math.hypot(...n) || 1; return n.map(v => v / l);
}

function ring(y, r, n, at = [0, 0, 0]) {
  return Array.from({ length: n }, (_, k) => [at[0] + Math.cos(2 * Math.PI * k / n) * r, at[1] + y, at[2] + Math.sin(2 * Math.PI * k / n) * r]);
}
function boxCorners(size, at = [0, 0, 0]) {
  const out = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push([at[0] + sx * size[0] / 2, at[1] + sy * size[1] / 2, at[2] + sz * size[2] / 2]);
  return out;
}
/** Collision sample points on the convex silhouette (item-local). 16 facets per ring keeps a lying bottle from rolling. */
export function hullPoints(shape, segments = 16) {
  if (shape.type === 'parts') return shape.parts.flatMap(s => hullPoints({ ...s, at: s.at }, segments));
  if (shape.type === 'box') return boxCorners(shape.size, shape.at);
  if (shape.type === 'cylinder') {
    if (shape.axis === 'x' || shape.axis === 'z') {
      const at = shape.at || [0, 0, 0], pts = [...ring(-shape.half, shape.radius, segments), ...ring(shape.half, shape.radius, segments)];
      return pts.map(([a, b, c]) => (shape.axis === 'x' ? [b + at[0], a + at[1], c + at[2]] : [a + at[0], c + at[1], b + at[2]]));
    }
    return [...ring(-shape.half, shape.radius, segments, shape.at), ...ring(shape.half, shape.radius, segments, shape.at)];
  }
  if (shape.type === 'lathe') {
    // Keep the outermost silhouette: base, widest body ends, shoulder and top.
    const pr = shape.profile, rows = [pr[0], ...pr.filter((row, i) => i > 0 && i < pr.length - 1 && (row[1] >= pr[i - 1][1] || row[1] >= pr[i + 1][1])), pr.at(-1)];
    return rows.flatMap(([y, r]) => r < 5e-4 ? [[0, y, 0]] : ring(y, r, segments));
  }
  throw new Error(`Unknown shape ${shape.type}`);
}

/** Volume, centre of mass and principal inertia (per unit mass) by voxel-free slicing / analytic boxes. */
export function massProperties(shape, mass) {
  const pieces = [];
  const add = s => {
    const at = s.at || [0, 0, 0];
    if (s.type === 'box') {
      const [a, b, c] = s.size; pieces.push({ v: a * b * c, c: at, i: [(b * b + c * c) / 12, (a * a + c * c) / 12, (a * a + b * b) / 12] });
    } else if (s.type === 'cylinder') {
      const r = s.radius, h = 2 * s.half; const t = (3 * r * r + h * h) / 12;
      pieces.push({ v: Math.PI * r * r * h, c: at, i: s.axis === 'x' ? [r * r / 2, t, t] : s.axis === 'z' ? [t, t, r * r / 2] : [t, r * r / 2, t] });
    } else if (s.type === 'lathe') {
      const pr = s.profile, n = 64, y0 = pr[0][0], y1 = pr.at(-1)[0], dy = (y1 - y0) / n;
      for (let k = 0; k < n; k++) {
        const y = y0 + (k + .5) * dy, r = radiusAt(pr, y), v = Math.PI * r * r * dy;
        pieces.push({ v, c: [at[0], at[1] + y, at[2]], i: [r * r / 4 + dy * dy / 12, r * r / 2, r * r / 4 + dy * dy / 12] });
      }
    } else if (s.type === 'parts') s.parts.forEach(add);
  };
  add(shape);
  const volume = pieces.reduce((sum, p) => sum + p.v, 0);
  const com = [0, 1, 2].map(k => pieces.reduce((sum, p) => sum + p.v * p.c[k], 0) / volume);
  const inertia = [0, 0, 0];
  for (const p of pieces) {
    const d = p.c.map((v, k) => v - com[k]), w = p.v / volume;
    inertia[0] += w * (p.i[0] + d[1] * d[1] + d[2] * d[2]);
    inertia[1] += w * (p.i[1] + d[0] * d[0] + d[2] * d[2]);
    inertia[2] += w * (p.i[2] + d[0] * d[0] + d[1] * d[1]);
  }
  return { volume, com, inertia: inertia.map(v => v * mass) };
}

/** Local bounding radius around the centre of mass (raycast broad phase). */
export function boundingRadius(shape, com = [0, 0, 0]) {
  return Math.max(...hullPoints(shape, 8).map(p => Math.hypot(p[0] - com[0], p[1] - com[1], p[2] - com[2]))) + 0.02;
}
