// The gore bake (offline, node or browser; no three.js): splits a character topology into region pieces along the authored
// seams (../seams.js), once per seam variant, and builds closed stump caps, flesh rims, physics proxies and the insides
// measures. Input is plain mesh data (tools/glb.mjs readGLB() output); output is the bake object that tools/bake_gibs.mjs
// writes as JSON + binary and ../bake_format.js reads back.
//
// Per mesh:
//   1. weld: vertices with identical positions (UV seams) count as one for adjacency and loops.
//   2. region weights per vertex from the skin (bone -> region, ../regions.js), seam fields per variant (../seams.js).
//   3. every source triangle descends the region tree: a triangle on the child side of a seam (all corners, all variants)
//      goes down; a triangle that straddles a seam (or flips between variants) is a band triangle of that seam.
//      Bands of different seams must not overlap (reported in stats.conflicts; the seams are tuned so they don't).
//   4. band triangles are cut per variant: the zero crossing of the field on each edge becomes a new vertex whose recipe
//      is (a, 1 - t) + (b, t), so it keeps skin weights, morph targets and UVs by interpolation. Snap meshes (face parts,
//      interior meshes) are never cut: their band triangles go by the field at the centroid.
//   5. caps (cap meshes only, i.e. the body): the boundary loop between child and parent pieces of each seam variant is
//      chained (welded) and closed: limb seams get a body-side and a gib-side cap (outer ring = the seam vertices, an
//      inner ring and a centre bulging outwards, all recipes over the seam vertices so they follow every morph);
//      patch seams get a flesh rim on the body side (the hole stays open onto the insides) and a closed back on the gib.
// Every new vertex is a recipe over source vertices: terms [(vertex, weight)], an optional rest-space offset, an optional
// UV override (caps: x = radial 1 at the skin -> 0 at the centre, y = around) and an optional cap id (its normal).
import { REGIONS, REGION, REGION_IDS, CHILDREN, limbSubtree, boneRegions } from '../regions.js';
import { LIMB_SEAMS, PATCH_SEAMS, seamSeed, sawPattern } from '../seams.js';
import { MPFB_GAME_ENGINE, headsFromSidecar } from '../../humanoid/index.js';
import { positionHash } from '../bake_format.js';
export { positionHash };

export const BAKE_FORMAT = 'gamesystems.gore-bake.v1';
const R = REGIONS.length;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const addv = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Two unit vectors perpendicular to axis (deterministic). */
function basis(axis) {
  const ref = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(axis, ref)), v = cross(axis, u);
  return [u, v];
}

/** Variant names of a seam, in a fixed order. */
export const seamVariants = id => Object.keys((LIMB_SEAMS[id] ?? PATCH_SEAMS[id]).variants);

/**
 * Seam geometry for one character topology (rest frame): limb axes and patch frames (patch centres are pushed onto the
 * skin of `skin`, the cap mesh). heads: canonical rest heads; extra: { teethMid } for interior rules.
 */
export function resolveSeams(heads, skin, extra = {}) {
  const seams = {};
  for (const r of REGIONS) {
    if (!r.parent) continue;
    if (r.kind === 'limb') {
      const s = LIMB_SEAMS[r.id], o = heads[s.axis[0]], axis = norm(sub(heads[s.axis[1]], o)), [u, v] = basis(axis);
      seams[r.id] = { id: r.id, kind: 'limb', parent: r.parent, origin: o, axis, u, v, threshold: s.threshold, variants: s.variants, seed: seamSeed(r.id),
        subtree: limbSubtree(r.id).map(id => REGION_IDS.indexOf(id)) };
    } else {
      const s = PATCH_SEAMS[r.id], anchor = s.anchor(heads), dir = norm(s.dir), [u, v] = basis(dir);
      // outermost skin vertex near the ray anchor + t·dir
      let best = null, bestT = -Infinity;
      const P = skin.attributes.POSITION;
      for (let i = 0; i < P.length / 3; i++) {
        const d = sub([P[3 * i], P[3 * i + 1], P[3 * i + 2]], anchor), t = dot(d, dir);
        if (t <= 0) continue;
        const off = len(sub(d, scale(dir, t)));
        if (off < 0.015 && t > bestT) { bestT = t; best = [P[3 * i], P[3 * i + 1], P[3 * i + 2]]; }
      }
      if (!best) throw new Error(`patch ${r.id}: no skin found from its anchor`);
      const interior = s.interior ? { axis: s.interior.axis, below: extra[s.interior.below] } : null;
      seams[r.id] = { id: r.id, kind: 'patch', parent: r.parent, center: best, dir, u, v, radii: s.radii, variants: s.variants, seed: seamSeed(r.id), interior };
    }
  }
  return seams;
}

/** Field value of a seam variant at a point with limb-subtree weight W (limb) or position only (patch). */
function fieldAt(seam, variant, p, W) {
  const vr = seam.variants[variant];
  if (seam.kind === 'limb') {
    const d = sub(p, seam.origin), th = Math.atan2(dot(d, seam.v), dot(d, seam.u));
    return W - seam.threshold + (vr.jag ? vr.jag * sawPattern(th, vr.teeth, seam.seed) : 0);
  }
  const d = sub(p, seam.center), du = dot(d, seam.u) / seam.radii[0], dv = dot(d, seam.v) / seam.radii[1], dn = dot(d, seam.dir) / seam.radii[2];
  const th = Math.atan2(dv, du);
  return 1 - Math.hypot(du, dv, dn) + (vr.jag ? vr.jag * sawPattern(th, vr.teeth, seam.seed) : 0);
}

/**
 * Bakes one mesh. mesh: { name, attributes: { POSITION, NORMAL, JOINTS_0, WEIGHTS_0, ... }, index, joints (bone names) };
 * options: { seams, jointOf(boneName) -> canonical joint, parentOf, caps (bool), snap (bool), interior (bool) }.
 */
/**
 * The saw pattern can pinch off a small island of one side inside the other (a second, tiny seam loop that would need its
 * own pair of caps). Every connected patch of one sign that is smaller than a fifth of the biggest patch of that sign
 * touching the same other-sign area goes over to the surrounding side. f: per vertex, flipped in place (welded twins
 * together); separate mesh pieces (a garment's loose parts) are left alone.
 */
function dropIslands(f, weld, adj) {
  const comp = new Map(), sizes = [], signOf = [], touches = [];
  for (const v of adj.keys()) {
    if (comp.has(v)) continue;
    const id = sizes.length, sign = f[v] >= 0, stack = [v], other = new Set();
    let n = 0;
    comp.set(v, id);
    while (stack.length) {
      const x = stack.pop(); n++;
      for (const y of adj.get(x)) {
        if ((f[y] >= 0) !== sign) { other.add(y); continue; }
        if (!comp.has(y)) { comp.set(y, id); stack.push(y); }
      }
    }
    sizes.push(n); signOf.push(sign); touches.push(other);
  }
  // biggest component of each sign around every boundary: compare islands against the components their neighbours touch
  const flip = new Set();
  sizes.forEach((n, id) => {
    if (!touches[id].size) return;
    let biggest = 0;
    for (const y of touches[id]) for (const z of adj.get(y)) { const c = comp.get(z); if (c !== id && signOf[c] === signOf[id]) biggest = Math.max(biggest, sizes[c]); }
    // no same-sign neighbour two steps away: compare with the largest same-sign component overall
    if (!biggest) biggest = Math.max(...sizes.filter((_, c) => c !== id && signOf[c] === signOf[id]), 0);
    if (n < 0.2 * biggest) flip.add(id);
  });
  if (!flip.size) return;
  for (let i = 0; i < f.length; i++) { const c = comp.get(weld[i]); if (c !== undefined && flip.has(c)) f[i] = (f[i] >= 0 ? -1 : 1) * 1e-6; }
}

export function bakeMesh(mesh, { seams, jointOf, parentOf = () => -1, caps = false, snap = false, interior = false }) {
  const P = mesh.attributes.POSITION, N = mesh.attributes.NORMAL, V = P.length / 3, I = mesh.index, T = I.length / 3;
  const J = mesh.attributes.JOINTS_0, Wt = mesh.attributes.WEIGHTS_0;
  const pos = i => [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
  const boneRegion = boneRegions(mesh.joints, jointOf, parentOf);

  // 1. weld
  const weld = new Int32Array(V), seen = new Map();
  for (let i = 0; i < V; i++) {
    const key = `${Math.round(P[3 * i] * 1e5)},${Math.round(P[3 * i + 1] * 1e5)},${Math.round(P[3 * i + 2] * 1e5)}`;
    const w = seen.get(key);
    if (w === undefined) { seen.set(key, i); weld[i] = i; } else weld[i] = w;
  }
  // 2. region weights
  const rw = new Float32Array(V * R);
  for (let i = 0; i < V; i++) for (let k = 0; k < 4; k++) { const w = Wt[4 * i + k]; if (w > 0) rw[i * R + boneRegion[J[4 * i + k]]] += w; }
  const seamList = Object.values(seams), fields = {};
  // welded vertex adjacency (for dropping islands of a jagged limb field below)
  const adj = new Map();
  const link = (a, b) => { if (a === b) return; (adj.get(a) ?? adj.set(a, new Set()).get(a)).add(b); };
  for (let t = 0; t < T; t++) for (let k = 0; k < 3; k++) { const a = weld[I[3 * t + k]], b = weld[I[3 * t + (k + 1) % 3]]; link(a, b); link(b, a); }
  for (const s of seamList) {
    fields[s.id] = {};
    for (const variant of Object.keys(s.variants)) {
      const f = new Float64Array(V);
      for (let i = 0; i < V; i++) {
        let W = 0;
        if (s.kind === 'limb') for (const r of s.subtree) W += rw[i * R + r];
        f[i] = interior && s.interior ? s.interior.below - P[3 * i + s.interior.axis] : fieldAt(s, variant, pos(i), W);
        if (f[i] === 0) f[i] = 1e-9;
      }
      if (s.kind === 'limb') dropIslands(f, weld, adj);
      fields[s.id][variant] = f;
    }
  }
  const variantsOf = id => Object.keys(seams[id].variants);
  // side of a triangle for one seam over all variants: 1 child, -1 parent, 0 mixed
  function sideAll(t, id, centroid = false) {
    let pos_ = 0, neg = 0;
    for (const variant of variantsOf(id)) {
      const f = fields[id][variant];
      if (centroid) { (f[I[3 * t]] + f[I[3 * t + 1]] + f[I[3 * t + 2]] >= 0 ? pos_++ : neg++); continue; }
      for (let k = 0; k < 3; k++) (f[I[3 * t + k]] >= 0 ? pos_++ : neg++);
    }
    return neg === 0 ? 1 : pos_ === 0 ? -1 : 0;
  }
  // 3. descent
  const triRegion = new Int16Array(T), triBand = new Int16Array(T).fill(-1);
  let conflicts = 0;
  const conflictPairs = {};
  for (let t = 0; t < T; t++) {
    let r = 0;
    for (;;) {
      const kids = CHILDREN[REGION_IDS[r]].filter(c => seams[c]);
      const sides = kids.map(c => sideAll(t, c));
      const into = kids.filter((c, k) => sides[k] === 1), mixed = kids.filter((c, k) => sides[k] === 0);
      if (into.length + mixed.length > 1) { conflicts++; const k = [...into, ...mixed].join('+'); conflictPairs[k] = (conflictPairs[k] ?? 0) + 1; }
      if (into.length) { r = REGION_IDS.indexOf(into[0]); continue; }
      if (mixed.length) triBand[t] = REGION_IDS.indexOf(mixed[0]);
      break;
    }
    triRegion[t] = r;   // band triangles: r = the parent region of the band's seam
  }

  // 4. pieces
  const newVerts = [];           // { terms: [[i, w]], weld: key, offset?, uv?, cap? }
  const cutCache = new Map();
  const tris = [], src = [], pieces = [];
  const loopKey = new Map();     // vertex id (>= V for new) -> weld key string
  const keyOf = v => (v < V ? `o${weld[v]}` : loopKey.get(v));
  function cutVertex(tag, a, b, t) {
    if (a > b) { [a, b] = [b, a]; t = 1 - t; }
    const key = `${tag}:${a}:${b}`;
    let id = cutCache.get(key);
    if (id === undefined) {
      id = V + newVerts.length;
      newVerts.push({ terms: [[a, 1 - t], [b, t]] });
      let wa = weld[a], wb = weld[b], tw = t;
      if (wa > wb) { [wa, wb] = [wb, wa]; tw = 1 - t; }
      loopKey.set(id, `${tag}:${wa}:${wb}:${tw.toFixed(6)}`);
      cutCache.set(key, id);
    }
    return id;
  }
  function piece(meta, list) {
    if (!list.length) return;
    pieces.push({ ...meta, start: tris.length / 3, count: list.length });
    for (const [a, b, c, s] of list) tris.push(a, b, c), src.push(s);
  }
  const core = REGION_IDS.map(() => []);
  for (let t = 0; t < T; t++) if (triBand[t] < 0) core[triRegion[t]].push([I[3 * t], I[3 * t + 1], I[3 * t + 2], t]);
  REGION_IDS.forEach((id, r) => piece({ region: id, role: 'core', seam: null, variant: null }, core[r]));

  const bandPieces = {};         // seam -> variant -> { child: [...], parent: [...] }
  for (const s of seamList) {
    const c = REGION_IDS.indexOf(s.id), band = [];
    for (let t = 0; t < T; t++) if (triBand[t] === c) band.push(t);
    bandPieces[s.id] = {};
    for (const variant of variantsOf(s.id)) {
      const f = fields[s.id][variant], child = [], parent = [], tag = `${s.id}/${variant}`;
      for (const t of band) {
        const v = [I[3 * t], I[3 * t + 1], I[3 * t + 2]], fv = v.map(i => f[i]);
        if (snap) { ((fv[0] + fv[1] + fv[2]) >= 0 ? child : parent).push([...v, t]); continue; }
        if (fv.every(x => x >= 0)) { child.push([...v, t]); continue; }
        if (fv.every(x => x < 0)) { parent.push([...v, t]); continue; }
        const pos_ = [], neg = [];
        for (let k = 0; k < 3; k++) {
          const k2 = (k + 1) % 3;
          (fv[k] >= 0 ? pos_ : neg).push(v[k]);
          if ((fv[k] >= 0) !== (fv[k2] >= 0)) { const x = cutVertex(tag, v[k], v[k2], fv[k] / (fv[k] - fv[k2])); pos_.push(x); neg.push(x); }
        }
        for (let k = 1; k + 1 < pos_.length; k++) child.push([pos_[0], pos_[k], pos_[k + 1], t]);
        for (let k = 1; k + 1 < neg.length; k++) parent.push([neg[0], neg[k], neg[k + 1], t]);
      }
      bandPieces[s.id][variant] = { child, parent };
      piece({ region: s.id, role: 'child', seam: s.id, variant }, child);
      piece({ region: s.parent, role: 'parent', seam: s.id, variant }, parent);
    }
  }

  // evaluate a vertex (source or new) position / normal at rest
  const evalAttr = (A, size, v) => {
    if (v < V) return Array.from({ length: size }, (_, k) => A[size * v + k]);
    const out = new Array(size).fill(0);
    for (const [i, w] of newVerts[v - V].terms) for (let k = 0; k < size; k++) out[k] += w * A[size * i + k];
    if (A === P && newVerts[v - V].offset) for (let k = 0; k < 3; k++) out[k] += newVerts[v - V].offset[k];
    return out;
  };
  const vpos = v => evalAttr(P, 3, v), vnorm = v => norm(evalAttr(N, 3, v));
  const termsOf = v => (v < V ? [[v, 1]] : newVerts[v - V].terms);

  // 5. caps
  const capList = [], loopStats = [];
  if (caps) {
    for (const s of seamList) for (const variant of variantsOf(s.id)) {
      const { child, parent } = bandPieces[s.id][variant];
      const c = REGION_IDS.indexOf(s.id), p = REGION_IDS.indexOf(s.parent);
      const childSet = [...child, ...core[c]], parentSet = [...parent, ...core[p]];
      const parentEdges = new Set();
      for (const [a, b, cc] of parentSet) for (const [x, y] of [[a, b], [b, cc], [cc, a]]) parentEdges.add(`${keyOf(x)}>${keyOf(y)}`);
      const next = new Map(), rep = new Map();
      for (const [a, b, cc] of childSet) for (const [x, y] of [[a, b], [b, cc], [cc, a]]) {
        const kx = keyOf(x), ky = keyOf(y);
        if (parentEdges.has(`${ky}>${kx}`)) { if (!next.has(kx)) next.set(kx, ky); rep.set(kx, x); rep.set(ky, y); }
      }
      const loops = [], used = new Set();
      for (const start of next.keys()) {
        if (used.has(start)) continue;
        const loop = [];
        let k = start, closed = false;
        while (k !== undefined && !used.has(k)) { used.add(k); loop.push(k); k = next.get(k); if (k === start) { closed = true; break; } }
        if (loop.length >= 3) loops.push({ verts: loop.map(x => rep.get(x)), closed });
      }
      loops.sort((a, b) => b.verts.length - a.verts.length);
      loopStats.push({ seam: s.id, variant, loops: loops.map(l => ({ length: l.verts.length, closed: l.closed })) });
      for (const [li, loop] of loops.entries()) {
        if (!loop.closed) continue;
        const L = loop.verts, n = L.length, lp = L.map(vpos);
        const cen = scale(lp.reduce(addv, [0, 0, 0]), 1 / n);   // true loop centroid (stats only; the cap centre uses cenTerms)
        // centre recipe over at most 8 evenly spaced loop vertices (keeps every cap vertex at <= ~20 terms)
        const pick = Array.from({ length: Math.min(8, n) }, (_, k) => L[Math.floor(k * n / Math.min(8, n))]);
        const cenTerms = mergeTerms(pick.flatMap(v => termsOf(v).map(([i, w]) => [i, w / pick.length])));
        const rad = lp.reduce((a, q) => a + len(sub(q, cen)), 0) / n;
        // Newell normal of the child boundary loop (child edges a->b): points along the child surface orientation
        let nw = [0, 0, 0];
        for (let i = 0; i < n; i++) { const a = lp[i], b = lp[(i + 1) % n]; nw = addv(nw, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]); }
        nw = norm(nw);
        // gib cap closes the child piece: triangles (centre, b, a) -> face normal = -nw. Body cap/rim: the opposite.
        for (const side of ['gib', 'body']) {
          const out = side === 'gib' ? scale(nw, -1) : nw;   // outward normal of this cap
          const capId = capList.length, triList = [];
          const mk = (terms, offset, uv) => { const id = V + newVerts.length; newVerts.push({ terms, offset, uv, cap: capId }); return id; };
          if (s.kind === 'patch' && side === 'body') {
            // flesh rim: the hole's wall, going in along -normal (skin normal and patch direction)
            const depth = s.id === 'jaw' || s.id === 'cranium' ? 0.014 : 0.024;
            const ring0 = L.map((v, i) => mk(termsOf(v), null, [1, i / n]));
            const ring1 = L.map((v, i) => { const inward = norm(addv(scale(vnorm(v), -0.5), scale(s.dir, -0.5))); return mk(termsOf(v), scale(inward, depth), [0.3, i / n]); });
            for (let i = 0; i < n; i++) { const j = (i + 1) % n; triList.push([ring0[j], ring0[i], ring1[i]], [ring0[j], ring1[i], ring1[j]]); }
          } else {
            const bulge = s.kind === 'patch' ? -0.6 * Math.min(rad, 0.03) : 0.14 * rad;
            const ring0 = L.map((v, i) => mk(termsOf(v), null, [1, i / n]));
            const ring1 = L.map((v, i) => mk(mergeTerms([...termsOf(v).map(([k, w]) => [k, w * 0.55]), ...cenTerms.map(([k, w]) => [k, w * 0.45])]),
              scale(out, bulge * 0.7), [0.55, i / n]));
            const centre = mk(cenTerms, scale(out, bulge), [0, 0]);
            for (let i = 0; i < n; i++) {
              const j = (i + 1) % n;
              // child edge L_i -> L_j; the gib cap uses it reversed, the body cap forwards
              if (side === 'gib') triList.push([ring0[j], ring0[i], ring1[i]], [ring0[j], ring1[i], ring1[j]], [centre, ring1[j], ring1[i]]);
              else triList.push([ring0[i], ring0[j], ring1[j]], [ring0[i], ring1[j], ring1[i]], [centre, ring1[i], ring1[j]]);
            }
          }
          capList.push({ seam: s.id, variant, side, loop: li, normal: out, centroid: cen, radius: rad, ring: n });
          piece({ region: side === 'gib' ? s.id : s.parent, role: side === 'gib' ? 'gibCap' : 'bodyCap', seam: s.id, variant, cap: capId }, triList.map(t => [...t, -1]));
        }
      }
    }
  }

  const vertexCount = V + newVerts.length;
  return {
    name: mesh.name, source: { vertexCount: V, triangleCount: T, positionHash: positionHash(P), indexHash: arrayHash(I) },
    vertexCount, newVerts, pieces, tris: Uint32Array.from(tris), src: Int32Array.from(src), index: Uint32Array.from(I),
    caps: capList, stats: { conflicts, conflictPairs, bands: Object.fromEntries(seamList.map(s => [s.id, [...triBand].filter(x => x === REGION_IDS.indexOf(s.id)).length])), loops: loopStats, newVertices: newVerts.length },
    _eval: { vpos, triRegion },
  };
}

/** Sums duplicate vertex terms; drops ~0 weights; stable order. */
export function mergeTerms(terms) {
  const m = new Map();
  for (const [i, w] of terms) m.set(i, (m.get(i) ?? 0) + w);
  return [...m].filter(([, w]) => Math.abs(w) > 1e-7).sort((a, b) => a[0] - b[0]);
}

export function arrayHash(A) {
  let h = 2166136261;
  for (let i = 0; i < A.length; i++) { h = Math.imul(h ^ (A[i] & 0xffff), 16777619); h = Math.imul(h ^ (A[i] >>> 16), 16777619); }
  return (h >>> 0).toString(16);
}

/**
 * Physics proxy per region (capsules from joint to tip, see regions.js `proxy`) as ratios that runtime scales by the
 * current joints: { from, to, ext (tip extrapolation factor for 'X+' tips), a, b (fractions along from->tip), radius
 * (ratio of the segment length) }. Measured from the cap mesh's vertices of each region.
 */
export function measureProxies(heads, body, regionOfVertex) {
  const P = body.attributes.POSITION, V = P.length / 3, out = {};
  for (const r of REGIONS) {
    if (r.proxy.length === 1) {
      // patch: a sphere around the region's skin centroid, following one joint
      const verts = [];
      for (let i = 0; i < V; i++) if (regionOfVertex[i] === REGION_IDS.indexOf(r.id)) verts.push([P[3 * i], P[3 * i + 1], P[3 * i + 2]]);
      const c = scale(verts.reduce(addv, [0, 0, 0]), 1 / (verts.length || 1)), ds = verts.map(q => len(sub(q, c))).sort((x, y) => x - y);
      const at = heads[r.proxy[0]];
      out[r.id] = { kind: 'sphere', joint: r.proxy[0], offset: sub(c, at).map(x => +x.toFixed(4)), radius: +(ds[Math.floor(0.8 * ds.length)] ?? 0.03).toFixed(4), vertices: verts.length };
      continue;
    }
    const [from, toRaw] = r.proxy, plus = toRaw.endsWith('+'), to = plus ? toRaw.slice(0, -1) : toRaw;
    const A = heads[from];
    let B = heads[to];
    const verts = [];
    for (let i = 0; i < V; i++) if (regionOfVertex[i] === REGION_IDS.indexOf(r.id)) verts.push([P[3 * i], P[3 * i + 1], P[3 * i + 2]]);
    let ext = 1;
    if (plus) {
      // extrapolate along parent(to) -> to so the segment reaches the far end of the region's vertices
      const base = to === from ? heads[REGION_PARENT_JOINT[from]] : heads[from];
      const dir = norm(sub(heads[to], base));
      const far = verts.reduce((m, q) => Math.max(m, dot(sub(q, heads[to]), dir)), 0);
      ext = far / (len(sub(heads[to], base)) || 1);
      B = addv(heads[to], scale(dir, far));
    }
    const axis = sub(B, A), L = len(axis) || 1, ax = scale(axis, 1 / L);
    const ts = [], ds = [];
    for (const q of verts) { const d = sub(q, A), t = dot(d, ax); ts.push(t / L); ds.push(len(sub(d, scale(ax, t)))); }
    ds.sort((x, y) => x - y); ts.sort((x, y) => x - y);
    const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0);
    out[r.id] = { kind: 'capsule', from, to, plus, ext: +ext.toFixed(4), a: +pct(ts, 0.04).toFixed(4), b: +pct(ts, 0.96).toFixed(4), radius: +(pct(ds, 0.7) / L).toFixed(4), length: +L.toFixed(4), vertices: verts.length };
  }
  return out;
}
const REGION_PARENT_JOINT = { head: 'neck', leftMiddleProximal: 'leftHand', rightMiddleProximal: 'rightHand', leftToes: 'leftFoot', rightToes: 'rightFoot' };

/** Torso / limb measures for the insides (insides.js): half widths and depths of the skin at the joint heights. */
export function measureBody(heads, body) {
  const P = body.attributes.POSITION, V = P.length / 3;
  const slab = (y, dy = 0.02, xmax = 0.25) => {
    let xl = 0, xr = 0, zf = -1, zb = 1;
    for (let i = 0; i < V; i++) {
      const x = P[3 * i], yy = P[3 * i + 1], z = P[3 * i + 2];
      if (Math.abs(yy - y) > dy || Math.abs(x) > xmax) continue;
      xl = Math.max(xl, x); xr = Math.min(xr, x); zf = Math.max(zf, z); zb = Math.min(zb, z);
    }
    return { y, halfWidth: +((xl - xr) / 2).toFixed(4), front: +zf.toFixed(4), back: +zb.toFixed(4) };
  };
  const h = heads;
  return {
    pelvis: slab(h.hips[1], 0.02, 0.2), belly: slab((h.spine[1] + h.chest[1]) / 2, 0.02, 0.2), chest: slab((h.upperChest[1] + h.neck[1]) / 2, 0.02, 0.16),
    neck: slab((h.neck[1] + h.head[1]) / 2, 0.01, 0.08), head: slab(h.head[1] + 0.03, 0.02, 0.12),
  };
}

/** Inverse of a canonical -> bone-name map. */
export function jointOfBone(map = MPFB_GAME_ENGINE) {
  const inv = new Map(Object.entries(map).map(([j, b]) => [b, j]));
  return name => inv.get(name) ?? null;
}

/**
 * Bakes a whole character topology: meshes = readGLB meshes of the body file plus garments/hair; sidecar = the joints
 * sidecar (base_body.joints.json) for the rest heads. capMesh: name of the skin mesh (caps, proxies, patch anchors).
 */
export function bakeCharacter({ meshes, sidecar, map = MPFB_GAME_ENGINE, capMesh = 'base', snap = /^(Eyebrows|Eyelashes|Eyes|Teeth|Tongue)/, interior = /^(Teeth|Tongue)/, topology = 'makehuman-cc' }) {
  const heads = headsFromSidecar(sidecar, {}, map);
  const body = meshes.find(m => m.name === capMesh);
  if (!body) throw new Error(`no cap mesh ${capMesh}`);
  const teeth = meshes.find(m => /^Teeth/.test(m.name));
  let teethMid = heads.head[1] - 0.035;
  if (teeth) { const Y = teeth.attributes.POSITION.filter((_, i) => i % 3 === 1); teethMid = (Math.min(...Y) + Math.max(...Y)) / 2; }
  const seams = resolveSeams(heads, body, { teethMid });
  const jointOf = jointOfBone(map);
  const baked = meshes.map(m => bakeMesh(m, { seams, jointOf, caps: m === body, snap: snap.test(m.name), interior: interior.test(m.name) }));
  const bodyBake = baked[meshes.indexOf(body)];
  // per source vertex region of the body (core triangles), for the proxies
  const vr = new Int16Array(body.attributes.POSITION.length / 3).fill(-1);
  for (const p of bodyBake.pieces) if (p.role === 'core') for (let t = p.start; t < p.start + p.count; t++) for (let k = 0; k < 3; k++) vr[bodyBake.tris[3 * t + k]] = REGION_IDS.indexOf(p.region);
  const proxies = measureProxies(heads, body, vr);
  const bodyMeasure = measureBody(heads, body);
  // cap centroid of each limb seam as a fraction along its axis (insides stubs)
  const capAxis = {};
  for (const c of bodyBake.caps) {
    const s = seams[c.seam];
    if (s.kind !== 'limb' || c.side !== 'gib' || c.loop !== 0) continue;
    const L = len(sub(heads[LIMB_SEAMS[c.seam].axis[1]], s.origin));
    (capAxis[c.seam] ??= {})[c.variant] = +(dot(sub(c.centroid, s.origin), s.axis) / L).toFixed(4);
  }
  return {
    format: BAKE_FORMAT, topology, heads, teethMid: +teethMid.toFixed(4),
    seams: Object.fromEntries(Object.values(seams).map(s => [s.id, { kind: s.kind, parent: s.parent, variants: Object.keys(s.variants) }])),
    proxies, body: bodyMeasure, capAxis, meshes: baked,
  };
}
