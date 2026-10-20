// GameSystems gore extension: runtime assembly of a baked mesh (bake_format.js). Pure (no three.js): index order, region
// ranges and the draw ranges (geometry groups) for any set of lost regions. Done once per zombie at spawn; severing only
// recomputes the draw ranges (a few dozen numbers), never triangles.
//
// Index order: the regions depth first (regions.js), each region = its core triangles + the chosen variant's band pieces
// on its side of every seam it touches, so a region's whole subtree is one contiguous range; then the caps (body side,
// gib side) of the chosen variant of every seam. A triangle whose source triangle the character hides (CharacterCreator
// hides skin under clothes, garments under garments) is dropped.
import { REGIONS, REGION_IDS, REGION, subtree } from './regions.js';

/**
 * mesh: a decoded bake mesh; variantOf(seam) -> variant name; keep(sourceTriangle) -> bool (default: all).
 * Returns { index: Uint32Array, triangles, region: { id: [start, count] }, tree: { id: [start, end) of the subtree },
 * bodyCap: { seam: [start, count] }, gibCap: { seam: [start, count] }, regionOfTriangle(t) -> id }. Units: triangles.
 */
export function assembleMesh(mesh, { variantOf = () => null, keep = () => true } = {}) {
  const NONE16 = 0xffff, NONE32 = 0xffffffff;
  const out = [], region = {}, tree = {}, bodyCap = {}, gibCap = {};
  const variants = {};
  for (const p of mesh.pieces) if (p.seam) (variants[p.seam] ??= new Set()).add(p.variant);
  const chosen = seam => {
    const v = variantOf(seam), set = variants[seam];
    return set?.has(v) ? v : set ? [...set][0] : null;
  };
  const push = p => {
    for (let t = p.start; t < p.start + p.count; t++) {
      const s = mesh.src[t];
      if (s !== NONE16 && s !== NONE32 && !keep(s)) continue;
      out.push(mesh.tris[3 * t], mesh.tris[3 * t + 1], mesh.tris[3 * t + 2]);
    }
  };
  const byRegion = new Map(REGION_IDS.map(id => [id, []])), caps = [];
  for (const p of mesh.pieces) {
    if (p.seam && p.variant !== chosen(p.seam)) continue;
    if (p.role === 'bodyCap' || p.role === 'gibCap') caps.push(p);
    else byRegion.get(p.region).push(p);
  }
  for (const r of REGIONS) {
    const start = out.length / 3;
    for (const p of byRegion.get(r.id)) push(p);
    region[r.id] = [start, out.length / 3 - start];
  }
  for (const id of REGION_IDS) {
    const ids = subtree(id), first = region[ids[0]][0], last = region[ids[ids.length - 1]];
    tree[id] = [first, last[0] + last[1]];
  }
  for (const p of caps) {
    const start = out.length / 3;
    push(p);
    const table = p.role === 'bodyCap' ? bodyCap : gibCap, prev = table[p.seam];
    // several loops of one seam come out adjacent: merge
    table[p.seam] = prev ? [prev[0], prev[1] + out.length / 3 - start] : [start, out.length / 3 - start];
  }
  const starts = REGION_IDS.map(id => region[id][0]);
  const regionOfTriangle = t => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= t) lo = mid; else hi = mid - 1; }
    return t < region[REGION_IDS[lo]][0] + region[REGION_IDS[lo]][1] ? REGION_IDS[lo] : null;
  };
  return { index: Uint32Array.from(out), triangles: out.length / 3, region, tree, bodyCap, gibCap, regionOfTriangle, variant: Object.fromEntries(Object.keys(variants).map(s => [s, chosen(s)])) };
}

/** Sorted, merged draw ranges [{ start, count, materialIndex }] in index units (3 × triangles), adjacent ones joined. */
export function toGroups(ranges) {
  const sorted = ranges.filter(r => r[1] > 0).map(([s, c, m]) => [s, c, m ?? 0]).sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  const out = [];
  for (const [s, c, m] of sorted) {
    const last = out[out.length - 1];
    if (last && last.materialIndex === m && last.start + last.count === 3 * s) last.count += 3 * c;
    else out.push({ start: 3 * s, count: 3 * c, materialIndex: m });
  }
  return out;
}

/**
 * Draw ranges of the body (what stays on the character): every region not lost (material 0) and the body-side cap of
 * every severed seam whose parent is still there (material 1). lost: Set of region ids; severed: Set of seam ids that
 * were cut (a region lost with its parent has no visible cap).
 */
export function bodyRanges(asm, lost, severed) {
  const ranges = [];
  for (const id of REGION_IDS) if (!lost.has(id)) ranges.push([...asm.region[id], 0]);
  for (const s of severed) if (!lost.has(REGION[s].parent) && asm.bodyCap[s]) ranges.push([...asm.bodyCap[s], 1]);
  return toGroups(ranges);
}

/**
 * Draw ranges of a gib cut at `seam`: the regions that came off with it (`lostNow`, the sever event's list) with
 * material 0, its gib-side cap and the body-side caps of seams inside it that were severed earlier (material 1).
 */
export function gibRanges(asm, seam, lostNow, severedBefore = new Set()) {
  const now = new Set(lostNow), ranges = [];
  for (const id of lostNow) ranges.push([...asm.region[id], 0]);
  if (asm.gibCap[seam]) ranges.push([...asm.gibCap[seam], 1]);
  for (const s of severedBefore) if (s !== seam && now.has(REGION[s].parent) && asm.bodyCap[s]) ranges.push([...asm.bodyCap[s], 1]);
  return toGroups(ranges);
}
