// GameSystems gore extension: the baked gib data format (written by tools/bake_gibs.mjs, read by the runtime). Pure.
//
// One bake per character topology: <name>.gibs.json (metadata) + <name>.gibs.bin (little-endian arrays the JSON points
// into: { buffer: { offset, length, type } }). Per source mesh (matched at runtime by vertex count + positionHash):
//   index       the source mesh's full triangle index (to match the triangles a character currently shows)
//   tris        triangle list of all pieces (indices into source vertices 0..V-1 and new vertices V..)
//   src         source triangle of each piece triangle (NONE for caps): the runtime drops triangles whose source triangle
//               the character currently hides (CharacterCreator hides body skin under clothes)
//   pieces      [{ region, role: 'core' | 'child' | 'parent' | 'gibCap' | 'bodyCap', seam, variant, cap, start, count }]
//               core: always part of `region`; child/parent: the two sides of a seam band for one variant; caps: closed
//               stump faces (gib side, body side; patch body side = a flesh rim around the hole)
//   new vertex k (vertex V + k) = Σ termWeight · source vertex termIndex  (termStart[k] .. termStart[k + 1])
//               + offset[k] (rest frame) — every attribute and morph target follows by the same weights; caps
//               (cap[k] >= 0) take the cap's normal and uv[k] (x: 1 at the skin -> 0 at the centre, y: around)
import { REGION_IDS } from './regions.js';

export const GIBS_FORMAT = 'gamesystems.gore-gibs.v1';
export const NONE = 0xffffffff;
const TYPES = { u8: Uint8Array, u16: Uint16Array, u32: Uint32Array, i16: Int16Array, i32: Int32Array, f32: Float32Array };
const typeName = a => Object.keys(TYPES).find(k => a instanceof TYPES[k]);

/** Bake (tools/bake_core.mjs bakeCharacter output) -> { json, bin: Uint8Array }. Deterministic. */
export function encodeGibs(bake) {
  const chunks = [];
  let size = 0;
  const put = arr => {
    const pad = (4 - (size % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); size += pad; }
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    chunks.push(bytes);
    const ref = { offset: size, length: arr.length, type: typeName(arr) };
    size += bytes.byteLength;
    return ref;
  };
  const meshes = bake.meshes.map(m => {
    const V = m.source.vertexCount, n = m.newVerts.length, big = m.vertexCount > 65535;
    const termStart = new Uint32Array(n + 1);
    let M = 0;
    m.newVerts.forEach((v, k) => { termStart[k] = M; M += v.terms.length; });
    termStart[n] = M;
    const termIndex = V > 65535 ? new Uint32Array(M) : new Uint16Array(M), termWeight = new Float32Array(M);
    const offset = new Float32Array(3 * n), uv = new Float32Array(2 * n), cap = new Int16Array(n).fill(-1);
    m.newVerts.forEach((v, k) => {
      v.terms.forEach(([i, w], j) => { termIndex[termStart[k] + j] = i; termWeight[termStart[k] + j] = w; });
      if (v.offset) offset.set(v.offset, 3 * k);
      if (v.uv) uv.set(v.uv, 2 * k);
      if (v.cap !== undefined) cap[k] = v.cap;
    });
    const tris = big ? Uint32Array.from(m.tris) : Uint16Array.from(m.tris);
    const src = m.source.triangleCount >= 65535 ? Uint32Array.from(m.src, s => (s < 0 ? NONE : s)) : Uint16Array.from(m.src, s => (s < 0 ? 0xffff : s));
    return {
      name: m.name, source: m.source, vertexCount: m.vertexCount, newVertexCount: n,
      pieces: m.pieces.map(p => ({ region: p.region, role: p.role, seam: p.seam, variant: p.variant, ...(p.cap !== undefined ? { cap: p.cap } : {}), start: p.start, count: p.count })),
      caps: m.caps.map(c => ({ seam: c.seam, variant: c.variant, side: c.side, loop: c.loop, ring: c.ring, normal: c.normal.map(round), centroid: c.centroid.map(round), radius: round(c.radius) })),
      stats: { conflicts: m.stats.conflicts, bands: m.stats.bands, loops: m.stats.loops },
      buffers: { index: put(V > 65535 ? Uint32Array.from(m.index) : Uint16Array.from(m.index)), tris: put(tris), src: put(src), termStart: put(termStart), termIndex: put(termIndex), termWeight: put(termWeight), offset: put(offset), uv: put(uv), cap: put(cap) },
    };
  });
  const bin = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { bin.set(c, o); o += c.byteLength; }
  const json = {
    format: GIBS_FORMAT, topology: bake.topology, regions: REGION_IDS, heads: roundDeep(bake.heads), teethMid: bake.teethMid,
    seams: bake.seams, proxies: bake.proxies, body: bake.body, capAxis: bake.capAxis, binBytes: size, meshes,
  };
  return { json, bin };
}
const round = x => +(+x).toFixed(6);
const roundDeep = o => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'number' ? round(v) : v)));

/** { json, bin (ArrayBuffer | Uint8Array) } -> the bake with typed arrays in place of buffer refs. */
export function decodeGibs(json, bin) {
  if (json?.format !== GIBS_FORMAT) throw new TypeError(`not a gore gibs file (${json?.format})`);
  const u8 = bin instanceof Uint8Array ? bin : new Uint8Array(bin);
  const base = u8.byteOffset, buf = u8.buffer;
  const view = ref => {
    const T = TYPES[ref.type];
    if ((base + ref.offset) % T.BYTES_PER_ELEMENT === 0) return new T(buf, base + ref.offset, ref.length);
    return new T(buf.slice(base + ref.offset, base + ref.offset + ref.length * T.BYTES_PER_ELEMENT));
  };
  return { ...json, meshes: json.meshes.map(m => ({ ...m, ...Object.fromEntries(Object.entries(m.buffers).map(([k, r]) => [k, view(r)])) })) };
}

/** Interpolates a per-vertex attribute (itemSize n, source values V × n) onto the new vertices; returns (V + newVertexCount) × n. */
export function extendAttribute(mesh, src, n, { offsets = false } = {}) {
  const V = mesh.source.vertexCount, N = mesh.newVertexCount, out = new (src.constructor === Float64Array ? Float64Array : Float32Array)((V + N) * n);
  out.set(src.subarray(0, V * n));
  const { termStart, termIndex, termWeight, offset } = mesh;
  for (let k = 0; k < N; k++) {
    const o = (V + k) * n;
    for (let j = termStart[k]; j < termStart[k + 1]; j++) {
      const i = termIndex[j] * n, w = termWeight[j];
      for (let c = 0; c < n; c++) out[o + c] += w * src[i + c];
    }
    if (offsets) for (let c = 0; c < 3; c++) out[o + c] += offset[3 * k + c];
  }
  return out;
}

/**
 * Skin of the new vertices: bone weights summed over the recipe terms, top 4 renormalized. joints/weights: V × 4.
 * Returns { joints: Uint16Array, weights: Float32Array } of (V + N) × 4.
 */
export function extendSkin(mesh, joints, weights) {
  const V = mesh.source.vertexCount, N = mesh.newVertexCount;
  const J = new Uint16Array((V + N) * 4), W = new Float32Array((V + N) * 4);
  for (let i = 0; i < V * 4; i++) { J[i] = joints[i]; W[i] = weights[i]; }
  const acc = new Map();
  for (let k = 0; k < N; k++) {
    acc.clear();
    for (let j = mesh.termStart[k]; j < mesh.termStart[k + 1]; j++) {
      const i = mesh.termIndex[j], w = mesh.termWeight[j];
      for (let c = 0; c < 4; c++) { const bw = weights[4 * i + c] * w; if (bw > 0) acc.set(joints[4 * i + c], (acc.get(joints[4 * i + c]) ?? 0) + bw); }
    }
    const top = [...acc].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4), sum = top.reduce((s, [, w]) => s + w, 0) || 1;
    top.forEach(([b, w], c) => { J[4 * (V + k) + c] = b; W[4 * (V + k) + c] = w / sum; });
  }
  return { joints: J, weights: W };
}

/** Integer attributes (zone flags etc.): each new vertex takes the value of its heaviest term. */
export function extendNearest(mesh, src, n = 1) {
  const V = mesh.source.vertexCount, N = mesh.newVertexCount, out = new src.constructor((V + N) * n);
  out.set(src.subarray(0, V * n));
  for (let k = 0; k < N; k++) {
    let best = -1, bw = -Infinity;
    for (let j = mesh.termStart[k]; j < mesh.termStart[k + 1]; j++) if (mesh.termWeight[j] > bw) { bw = mesh.termWeight[j]; best = mesh.termIndex[j]; }
    for (let c = 0; c < n; c++) out[(V + k) * n + c] = src[best * n + c];
  }
  return out;
}

/** FNV-1a fingerprint of a position array (every ~V/997-th vertex, 0.1 mm grid): matches a runtime mesh to its bake. */
export function positionHash(P) {
  let h = 2166136261;
  const step = Math.max(1, Math.floor(P.length / 3 / 997));
  for (let i = 0; i < P.length / 3; i += step) for (let k = 0; k < 3; k++) {
    const q = Math.round(P[3 * i + k] * 1e4) | 0;
    h = Math.imul(h ^ (q & 0xffff), 16777619); h = Math.imul(h ^ (q >>> 16), 16777619);
  }
  return (h >>> 0).toString(16);
}
