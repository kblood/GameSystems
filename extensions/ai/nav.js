// GameSystems ai extension: navigation on a walkable grid baked from the level's static boxes. Pure (no three.js;
// three-adapters.js turns static meshes into boxes). Obstacles are inflated by the agent radius at bake time, so a path
// through free cells is clear for the agent's body. Paths are A* over 8 neighbours (no diagonal corner cutting), then
// string-pulled to the few corners an agent actually has to turn at.
//
// Why a grid and not a recast navmesh: the rooms these games use are flat floors with box props, the grid needs no WASM
// or package in either game (the extension is synced as plain files), and it runs in node tests unchanged. Anything
// with the same methods can replace it as the AI world's `navmesh` (a recast adapter, for example):
//
//   navmesh = {
//     floorY,
//     version,                         // bumps on every rebake: agents re-plan their paths
//     findPath(from, to, out) -> bool, // out: array filled with corner points (from excluded, to included); false = partial
//     closest(p, out) -> out | null,   // nearest walkable point
//     walkable(x, z) -> bool,
//     segmentClear(a, b) -> bool,      // straight walk from a to b stays on walkable ground
//   }
import { point } from './math.js';

const SQRT2 = Math.SQRT2;
const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]];

/** Defaults: 0.2 m cells, agent radius 0.3 m, boxes lower than stepHeight are walked over, boxes above headroom pass. */
export const NAV_DEFAULTS = Object.freeze({ cell: 0.2, agentRadius: 0.3, floorY: 0, stepHeight: 0.3, headroom: 1.7, margin: 0.5 });

const boxCorners = b => {
  const min = b.min, max = b.max;
  return [min.x ?? min[0], min.y ?? min[1], min.z ?? min[2], max.x ?? max[0], max.y ?? max[1], max.z ?? max[2]];
};

/**
 * A grid over bounds { minX, minZ, maxX, maxZ } (default: the boxes' extent plus `margin`). Boxes are { min, max } in
 * world space ([x,y,z] arrays or {x,y,z}). Everything outside the bounds is blocked.
 */
export function createNavGrid(options = {}) {
  const o = { ...NAV_DEFAULTS, ...options };
  let bounds = o.bounds;
  if (!bounds) {
    bounds = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
    for (const b of o.boxes ?? []) {
      const [x0, , z0, x1, , z1] = boxCorners(b);
      bounds.minX = Math.min(bounds.minX, x0); bounds.minZ = Math.min(bounds.minZ, z0);
      bounds.maxX = Math.max(bounds.maxX, x1); bounds.maxZ = Math.max(bounds.maxZ, z1);
    }
    if (!Number.isFinite(bounds.minX)) throw new TypeError('createNavGrid: give bounds or boxes');
    bounds = { minX: bounds.minX - o.margin, minZ: bounds.minZ - o.margin, maxX: bounds.maxX + o.margin, maxZ: bounds.maxZ + o.margin };
  }
  const cell = o.cell, cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cell)), rows = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / cell));
  const count = cols * rows;
  const blocked = new Uint8Array(count);
  // A* scratch, allocated once
  const g = new Float32Array(count), f = new Float32Array(count), parent = new Int32Array(count);
  const seen = new Uint32Array(count), closed = new Uint32Array(count), heap = new Int32Array(count);
  let stamp = 0, heapSize = 0;
  const cellPath = [];
  const scratch = point(), scratchB = point();

  const ix = x => Math.floor((x - bounds.minX) / cell), iz = z => Math.floor((z - bounds.minZ) / cell);
  const inside = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows;
  const cx = c => bounds.minX + (c + 0.5) * cell, cz = r => bounds.minZ + (r + 0.5) * cell;
  const free = (c, r) => inside(c, r) && !blocked[r * cols + c];

  function addBox(b) {
    const [x0, y0, z0, x1, y1, z1] = boxCorners(b);
    if (y1 <= o.floorY + o.stepHeight || y0 >= o.floorY + o.headroom) return false;
    const R = o.agentRadius;
    const c0 = Math.max(0, ix(x0 - R)), c1 = Math.min(cols - 1, ix(x1 + R)), r0 = Math.max(0, iz(z0 - R)), r1 = Math.min(rows - 1, iz(z1 + R));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      // the cell centre against the box grown by the radius (rounded corners)
      const px = cx(c), pz = cz(r), dx = Math.max(x0 - px, 0, px - x1), dz = Math.max(z0 - pz, 0, pz - z1);
      if (dx * dx + dz * dz <= R * R) blocked[r * cols + c] = 1;
    }
    nav.version++;
    return true;
  }

  function heapPush(i) {
    let k = heapSize++;
    heap[k] = i;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (f[heap[p]] <= f[i]) break;
      heap[k] = heap[p]; heap[p] = i; k = p;
    }
  }
  function heapPop() {
    const top = heap[0], last = heap[--heapSize];
    let k = 0;
    if (heapSize > 0) {
      heap[0] = last;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heapSize && f[heap[l]] < f[heap[m]]) m = l;
        if (r < heapSize && f[heap[r]] < f[heap[m]]) m = r;
        if (m === k) break;
        const t = heap[m]; heap[m] = heap[k]; heap[k] = t; k = m;
      }
    }
    return top;
  }
  const octile = (c, r, gc, gr) => { const dx = Math.abs(c - gc), dz = Math.abs(r - gr); return (dx + dz) + (SQRT2 - 2) * Math.min(dx, dz); };

  /** Nearest free cell index to (x, z) within maxCells rings, or -1. */
  function nearestFree(x, z, maxCells = 40) {
    const c = ix(x), r = iz(z);
    if (free(c, r)) return r * cols + c;
    let best = -1, bestD = Infinity;
    for (let ring = 1; ring <= maxCells; ring++) {
      for (let dr = -ring; dr <= ring; dr++) for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring || !free(c + dc, r + dr)) continue;
        const d = (cx(c + dc) - x) ** 2 + (cz(r + dr) - z) ** 2;
        if (d < bestD) { bestD = d; best = (r + dr) * cols + c + dc; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  function segmentClear(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz), steps = Math.max(1, Math.ceil(len / (cell * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!free(ix(a.x + dx * t), iz(a.z + dz * t))) return false;
    }
    return true;
  }

  const nav = {
    kind: 'grid', floorY: o.floorY, cell, cols, rows, bounds, agentRadius: o.agentRadius, version: 0,
    /** Raw blocked flags (row-major, cols x rows) for debug drawing. */
    blocked,
    addBox,
    addBoxes(list) { let n = 0; for (const b of list) n += addBox(b) ? 1 : 0; return n; },
    clear() { blocked.fill(0); nav.version++; },
    walkable: (x, z) => free(ix(x), iz(z)),
    segmentClear,
    cellCenter(i, out = point()) { out.x = cx(i % cols); out.y = o.floorY; out.z = cz(Math.floor(i / cols)); return out; },
    closest(p, out = point()) {
      if (free(ix(p.x), iz(p.z))) { out.x = p.x; out.y = o.floorY; out.z = p.z; return out; }
      const i = nearestFree(p.x, p.z);
      return i < 0 ? null : nav.cellCenter(i, out);
    },
    /**
     * Fills out with the corners from `from` to `to` (from not included; the last point is `to`, or its closest walkable
     * point). Returns true when `to` was reached, false for a partial path that ends at the closest reachable point.
     * Reuses the point objects already in out.
     */
    findPath(from, to, out = []) {
      const start = nearestFree(from.x, from.z), goalCell = nearestFree(to.x, to.z);
      out.length = 0;
      if (start < 0 || goalCell < 0) return false;
      const goal = nav.closest(to, scratchB);
      if (start === goalCell || segmentClear(from, goal)) { pushPoint(out, goal.x, goal.z); return true; }
      if (++stamp === 0xffffffff) { seen.fill(0); closed.fill(0); stamp = 1; }
      const gc = goalCell % cols, gr = Math.floor(goalCell / cols);
      heapSize = 0;
      g[start] = 0; f[start] = octile(start % cols, Math.floor(start / cols), gc, gr); parent[start] = -1; seen[start] = stamp; heapPush(start);
      let best = start, bestH = f[start], reached = false;
      while (heapSize > 0) {
        const cur = heapPop();
        if (closed[cur] === stamp) continue;
        closed[cur] = stamp;
        if (cur === goalCell) { reached = true; best = cur; break; }
        const c = cur % cols, r = Math.floor(cur / cols), h = f[cur] - g[cur];
        if (h < bestH) { bestH = h; best = cur; }
        for (const [dc, dr, cost] of N8) {
          const nc = c + dc, nr = r + dr;
          if (!free(nc, nr)) continue;
          if (dc && dr && (!free(c + dc, r) || !free(c, r + dr))) continue;   // no corner cutting
          const ni = nr * cols + nc;
          if (closed[ni] === stamp) continue;
          const ng = g[cur] + cost;
          if (seen[ni] === stamp && ng >= g[ni]) continue;
          seen[ni] = stamp; g[ni] = ng; f[ni] = ng + octile(nc, nr, gc, gr); parent[ni] = cur;
          heapPush(ni);
        }
      }
      cellPath.length = 0;
      for (let i = best; i >= 0; i = parent[i]) cellPath.push(i);
      cellPath.reverse();
      // string pulling: from each anchor jump to the farthest cell still in straight walkable sight
      let anchorX = from.x, anchorZ = from.z, k = 1;
      while (k < cellPath.length) {
        let far = k;
        for (let j = cellPath.length - 1; j > k; j--) {
          nav.cellCenter(cellPath[j], scratch);
          scratchB.x = anchorX; scratchB.z = anchorZ;
          if (segmentClear(scratchB, scratch)) { far = j; break; }
        }
        nav.cellCenter(cellPath[far], scratch);
        anchorX = scratch.x; anchorZ = scratch.z;
        pushPoint(out, anchorX, anchorZ);
        k = far + 1;
      }
      if (reached) {
        const end = out[out.length - 1];
        const target = nav.closest(to, scratch);
        if (end && target) { end.x = target.x; end.z = target.z; }
      }
      return reached;
    },
  };
  function pushPoint(out, x, z) {
    // corner objects are pooled on the array, so re-planning into the same array allocates nothing
    if (!out.pool) Object.defineProperty(out, 'pool', { value: [] });
    const p = out.pool[out.length] ?? (out.pool[out.length] = point());
    p.x = x; p.y = o.floorY; p.z = z;
    out.push(p);
  }
  if (o.boxes) nav.addBoxes(o.boxes);
  return nav;
}

/** Sum of the corner-to-corner lengths of a path starting at from. */
export function pathLength(from, path) {
  let total = 0, px = from.x, pz = from.z;
  for (const p of path) { total += Math.hypot(p.x - px, p.z - pz); px = p.x; pz = p.z; }
  return total;
}
