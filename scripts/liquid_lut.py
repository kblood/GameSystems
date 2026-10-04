"""Generalised volume-preserving fill table ("liquid LUT v2", kind = "sphere_map"). Pure numpy, no Blender needed.

Spec: docs/liquid_lut_v2.md.  Summary:
    d = lut(up_obj, fill)   with   dot(p_obj, up_obj) = d   splitting the interior volume so that `fill` of it lies
    BELOW the plane (dot <= d).  `up_obj` = world up expressed in the node's local (glTF, Y-up) space.
    up is mapped to [0,1]^2 with an octahedral map (fold axis = object +Y, so upright = map centre, upside down =
    corners), sampled at n_dir x n_dir grid POINTS (corner-aligned, so the fold edges are exactly continuous);
    fill is sampled at n_fill points warped with a cosine (dense near empty/full).  Values are uint16 over
    [d_min, d_max], little endian, base64, layout [v][u][k].
"""
import base64
import json
import math
import numpy as np

# ----------------------------------------------------------------------------------------------------------------
# direction <-> octahedral map (fold axis Y)


def _sgn(x):
    return np.where(x >= 0, 1.0, -1.0)


def oct_decode(u, v):
    """u,v in [0,1] -> unit direction (...,3) (x,y,z)."""
    a = np.asarray(u, dtype=np.float64) * 2 - 1
    b = np.asarray(v, dtype=np.float64) * 2 - 1
    y = 1 - np.abs(a) - np.abs(b)
    neg = y < 0
    a2 = np.where(neg, (1 - np.abs(b)) * _sgn(a), a)
    b2 = np.where(neg, (1 - np.abs(a)) * _sgn(b), b)
    d = np.stack([a2, y, b2], axis=-1)
    return d / np.linalg.norm(d, axis=-1, keepdims=True)


def oct_encode(d):
    """unit direction (...,3) -> (u, v) in [0,1]."""
    d = np.asarray(d, dtype=np.float64)
    p = d / np.abs(d).sum(axis=-1, keepdims=True)
    a, b = p[..., 0], p[..., 2]
    neg = p[..., 1] < 0
    a2 = np.where(neg, (1 - np.abs(p[..., 2])) * _sgn(p[..., 0]), a)
    b2 = np.where(neg, (1 - np.abs(p[..., 0])) * _sgn(p[..., 2]), b)
    return a2 * 0.5 + 0.5, b2 * 0.5 + 0.5


def grid_dirs(n):
    g = np.linspace(0, 1, n)
    U, V = np.meshgrid(g, g, indexing="xy")          # V = row
    return oct_decode(U, V)                            # (n_v, n_u, 3)


def fill_samples(n_fill):
    k = np.arange(n_fill)
    return 0.5 - 0.5 * np.cos(math.pi * k / (n_fill - 1))


# ----------------------------------------------------------------------------------------------------------------
# voxelisation of a closed triangle mesh (columns along +Y, parity rule). V (n,3) float, F (m,3) int. Y-up space.


def mesh_volume(V, F):
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    return abs(float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0))


def voxelize(V, F, h, seed=0, hy=None, jitter_xz=False):
    """h = lateral (column) cell size, hy = spacing along the column (default h; samples are stratified-jittered).
    Returns (points (N,3) float32, weights (N,) float64 [m^3], info). Interior sampled by column parity."""
    V = np.asarray(V, dtype=np.float64)
    F = np.asarray(F, dtype=np.int64)
    hy = h if hy is None else hy
    rng = np.random.default_rng(seed)
    lo, hi = V.min(0), V.max(0)
    off = rng.uniform(0.15, 0.85, 2) * h
    ox, oz = lo[0] - off[0], lo[2] - off[1]
    nx = int(math.ceil((hi[0] - ox) / h)) + 1
    nz = int(math.ceil((hi[2] - oz) / h)) + 1
    cols, ys = [], []
    for t in F:
        p = V[t]
        x, z = p[:, 0], p[:, 2]
        den = (z[1] - z[2]) * (x[0] - x[2]) + (x[2] - x[1]) * (z[0] - z[2])
        if abs(den) < 1e-18:
            continue                                                   # parallel to the column direction
        i0 = max(int(math.ceil((x.min() - ox) / h - 0.5)), 0)
        i1 = min(int(math.floor((x.max() - ox) / h - 0.5)), nx - 1)
        k0 = max(int(math.ceil((z.min() - oz) / h - 0.5)), 0)
        k1 = min(int(math.floor((z.max() - oz) / h - 0.5)), nz - 1)
        if i1 < i0 or k1 < k0:
            continue
        gx = ox + (np.arange(i0, i1 + 1) + 0.5) * h
        gz = oz + (np.arange(k0, k1 + 1) + 0.5) * h
        PX, PZ = np.meshgrid(gx, gz, indexing="ij")
        w0 = ((z[1] - z[2]) * (PX - x[2]) + (x[2] - x[1]) * (PZ - z[2])) / den
        w1 = ((z[2] - z[0]) * (PX - x[2]) + (x[0] - x[2]) * (PZ - z[2])) / den
        w2 = 1 - w0 - w1
        m = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        if not m.any():
            continue
        ii, kk = np.nonzero(m)
        y = w0[m] * p[0, 1] + w1[m] * p[1, 1] + w2[m] * p[2, 1]
        cols.append((ii + i0) * nz + (kk + k0))
        ys.append(y)
    cols = np.concatenate(cols)
    ys = np.concatenate(ys)
    cnt = np.bincount(cols, minlength=nx * nz)
    odd = (cnt % 2) == 1
    keep = ~odd[cols]
    cols, ys = cols[keep], ys[keep]
    o = np.lexsort((ys, cols))
    cols, ys = cols[o], ys[o]
    y0, y1, c = ys[0::2], ys[1::2], cols[0::2]
    L = y1 - y0
    m = np.maximum(1, np.rint(L / hy).astype(np.int64))
    idx = np.repeat(np.arange(len(L)), m)
    start = np.cumsum(m) - m
    kk = np.arange(m.sum()) - np.repeat(start, m)
    y = y0[idx] + (kk + rng.random(len(kk))) / m[idx] * L[idx]
    jx, jz = ((rng.random(len(kk)) - 0.5) * h, (rng.random(len(kk)) - 0.5) * h) if jitter_xz else (0.0, 0.0)
    px = ox + (c[idx] // nz + 0.5) * h + jx
    pz = oz + (c[idx] % nz + 0.5) * h + jz
    pts = np.stack([px, y, pz], axis=1).astype(np.float32)
    w = (L[idx] / m[idx]) * h * h
    return pts, w, dict(odd_columns=int(odd.sum()), columns=int((cnt > 0).sum()), volume=float(w.sum()),
                        mesh_volume=mesh_volume(V, F), n_points=int(len(w)))


def auto_h(V, target_points=700000):
    ext = V.max(0) - V.min(0)
    return float((ext.prod() / target_points) ** (1 / 3))


# ----------------------------------------------------------------------------------------------------------------
# table build / pack / unpack


def build_table(pts, w, n_dir=25, n_fill=64, bins=8192, centre=None):
    """float64 table (n_dir, n_dir, n_fill) of RESIDUAL plane offsets  d' = d - dot(centre, up)  (centre = volume
    centroid by default; removes the dominant, nearly linear part so the table is smooth in `up`),
    plus d_min/d_max (symmetric +-R) and the centre used."""
    pts = np.asarray(pts, dtype=np.float32)
    if centre is None:
        centre = (pts * (w / w.sum())[:, None]).sum(0)
    centre = np.asarray(centre, dtype=np.float64)
    R = 1e-4
    dirs = grid_dirs(n_dir).reshape(-1, 3).astype(np.float32)
    fs = fill_samples(n_fill)
    out = np.zeros((len(dirs), n_fill))
    wt = w / w.sum()
    for i, up in enumerate(dirs):
        s = pts @ up
        lo, hi = float(s.min()), float(s.max())
        sc = (bins - 1e-3) / max(hi - lo, 1e-9)
        idx = ((s - lo) * sc).astype(np.int64)
        cum = np.concatenate([[0.0], np.cumsum(np.bincount(idx, weights=wt, minlength=bins))])
        edges = lo + np.arange(bins + 1) / sc
        out[i] = np.interp(fs, cum, edges)
        out[i, 0], out[i, -1] = lo, hi
        out[i] -= float(centre @ up.astype(np.float64))
    R = float(np.abs(out).max()) * 1.002 + 1e-5
    return out.reshape(n_dir, n_dir, n_fill), -R, R, centre


def pack(table, d_min, d_max):
    q = np.rint((table - d_min) / (d_max - d_min) * 65535).clip(0, 65535).astype("<u2")
    return base64.b64encode(q.tobytes()).decode("ascii")


def make_info(table, d_min, d_max, capacity_ml, extra=None, centre=(0, 0, 0)):
    n_dir, _, n_fill = table.shape
    info = {"version": 2, "kind": "sphere_map", "space": "node_yup", "capacity_ml": round(float(capacity_ml), 1),
            "n_dir": n_dir, "n_fill": n_fill, "fill_warp": "cos", "d_min": round(d_min, 6), "d_max": round(d_max, 6),
            "encoding": "u16le_base64", "layout": "vuk", "centre": [round(float(c), 6) for c in centre]}
    if extra:
        info.update(extra)
    info["data"] = pack(table, info["d_min"], info["d_max"])
    return info


# ----------------------------------------------------------------------------------------------------------------
# reference decoder (python mirror of shaders/godot/liquid_lut_v2.gd and shaders/three/liquid_lut_v2.js)


def _cr(t):
    """Catmull-Rom weights for the 4 taps (i-1, i, i+1, i+2)."""
    t2, t3 = t * t, t * t * t
    return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2]


class LutV2:
    def __init__(self, info):
        if isinstance(info, str):
            info = json.loads(info)
        assert info["version"] == 2 and info["kind"] == "sphere_map"
        self.n = int(info["n_dir"])
        self.F = int(info["n_fill"])
        q = np.frombuffer(base64.b64decode(info["data"]), dtype="<u2").astype(np.float32)
        self.c = np.array(info.get("centre", [0, 0, 0]), dtype=np.float64)
        self.t = (info["d_min"] + q / 65535.0 * (info["d_max"] - info["d_min"])).reshape(self.n, self.n, self.F)

    def _taps(self, up):
        """Catmull-Rom (4x4) taps in the octahedral grid. Returns list of (iy, ix, weight) arrays (16 entries).
        Out-of-range taps are mirrored across the map border with a flip along the border (octahedral fold)."""
        n = self.n
        up = np.asarray(up, dtype=np.float64)
        up = up / np.linalg.norm(up, axis=-1, keepdims=True)
        u, v = oct_encode(up)
        x = np.clip(u, 0, 1) * (n - 1)
        y = np.clip(v, 0, 1) * (n - 1)
        x0 = np.minimum(np.floor(x).astype(int), n - 2)
        y0 = np.minimum(np.floor(y).astype(int), n - 2)
        wx, wy = _cr(x - x0), _cr(y - y0)
        taps = []
        for b in range(4):
            for a in range(4):
                i, j = x0 + a - 1, y0 + b - 1
                f = i < 0
                i, j = np.where(f, -i, i), np.where(f, n - 1 - j, j)
                f = i > n - 1
                i, j = np.where(f, 2 * (n - 1) - i, i), np.where(f, n - 1 - j, j)
                f = j < 0
                i, j = np.where(f, n - 1 - i, i), np.where(f, -j, j)
                f = j > n - 1
                i, j = np.where(f, n - 1 - i, i), np.where(f, 2 * (n - 1) - j, j)
                taps.append((j, i, wx[a] * wy[b]))
        return taps

    def _dir_row(self, up):
        acc = 0
        for j, i, w in self._taps(up):
            acc = acc + w[..., None] * self.t[j, i]
        return acc                                                      # (..., F)

    def offset(self, up, fill):
        f = np.clip(np.asarray(fill, dtype=np.float64), 0, 1)
        t = np.arccos(1 - 2 * f) / math.pi * (self.F - 1)
        k0 = np.minimum(np.floor(t).astype(int), self.F - 2)
        ft = t - k0
        acc = 0
        for j, i, w in self._taps(up):
            acc = acc + w * (self.t[j, i, k0] * (1 - ft) + self.t[j, i, k0 + 1] * ft)
        return acc + self._lin(up)

    def _lin(self, up):
        up = np.asarray(up, dtype=np.float64)
        return (up @ self.c) / np.linalg.norm(up, axis=-1)

    def fill_at(self, up, d):
        row = self._dir_row(up)
        d = np.asarray(d, dtype=np.float64) - self._lin(up)
        k0 = np.clip((row <= d[..., None]).sum(-1) - 1, 0, self.F - 2)
        a = np.take_along_axis(row, k0[..., None], -1)[..., 0]
        b = np.take_along_axis(row, (k0 + 1)[..., None], -1)[..., 0]
        ft = np.clip((d - a) / np.maximum(b - a, 1e-12), 0, 1)
        return 0.5 - 0.5 * np.cos(math.pi * (k0 + ft) / (self.F - 1))


class LutV1:
    """Legacy axis table (bottles.py): lut[cos_tilt][fill], axis = object Y."""

    def __init__(self, info):
        if isinstance(info, str):
            info = json.loads(info)
        self.lut = np.array(info["lut"], dtype=np.float64)
        self.nc, self.nf = self.lut.shape

    def offset(self, up, fill):
        up = np.asarray(up, dtype=np.float64)
        c = np.clip(up[..., 1] / np.linalg.norm(up, axis=-1), -1, 1)
        f = np.clip(np.asarray(fill, dtype=np.float64), 0, 1)
        x = (c * 0.5 + 0.5) * (self.nc - 1)
        y = f * (self.nf - 1)
        x0 = np.minimum(np.floor(x).astype(int), self.nc - 2)
        y0 = np.minimum(np.floor(y).astype(int), self.nf - 2)
        fx, fy = x - x0, y - y0
        L = self.lut
        a = L[x0, y0] * (1 - fy) + L[x0, y0 + 1] * fy
        b = L[x0 + 1, y0] * (1 - fy) + L[x0 + 1, y0 + 1] * fy
        return a * (1 - fx) + b * fx


def upgrade_v1(info1, n_dir=17, n_fill=64):
    """Resample a v1 axis table into a v2 sphere_map (same lookup code path, rotationally symmetric about Y)."""
    if isinstance(info1, str):
        info1 = json.loads(info1)
    v1 = LutV1(info1)
    dirs = grid_dirs(n_dir)
    fs = fill_samples(n_fill)
    tab = np.zeros((n_dir, n_dir, n_fill))
    for k, f in enumerate(fs):
        tab[:, :, k] = v1.offset(dirs, np.full(dirs.shape[:2], f))
    R = float(np.abs(tab).max()) * 1.001 + 1e-4
    keep = {k: info1[k] for k in ("color", "carbonation", "foam", "foam_height", "bubble_size") if k in info1}
    keep.update(open=False, source="upgraded from version 1 axis table", z0=info1.get("z0"), z1=info1.get("z1"))
    return make_info(tab, -R, R, info1["capacity_ml"], keep)


TIERS = {"high": (25, 64), "mid": (17, 48), "low": (9, 32)}      # (n_dir, n_fill)


def resample(info, n_dir, n_fill):
    """Coarser (LOD) table derived from a finer one by evaluating the decoder on the new grid."""
    lut = LutV2(info)
    dirs = grid_dirs(n_dir)
    fs = fill_samples(n_fill)
    lin = lut._lin(dirs)
    tab = np.zeros((n_dir, n_dir, n_fill))
    for k, f in enumerate(fs):
        tab[:, :, k] = lut.offset(dirs, np.full(dirs.shape[:2], f)) - lin
    R = float(np.abs(tab).max()) * 1.002 + 1e-5
    skip = ("data", "n_dir", "n_fill", "d_min", "d_max", "centre")
    extra = {k: v for k, v in info.items() if k not in skip}
    extra.pop("verification", None)
    return make_info(tab, -R, R, info["capacity_ml"], extra, centre=lut.c)


# ----------------------------------------------------------------------------------------------------------------
# validation helpers


def random_dirs(n, rng):
    d = rng.normal(size=(n, 3))
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    return d


def volume_error(lut, pts, w, n=1500, seed=1, extra_dirs=None):
    """Brute force: for random up / fill, decode d, then integrate the voxel volume below the plane.
    Returns dict with max/rms error in percent of capacity, plus the worst case."""
    rng = np.random.default_rng(seed)
    ups = random_dirs(n, rng)
    if extra_dirs is not None:
        ups = np.concatenate([np.asarray(extra_dirs, dtype=np.float64), ups])
    fills = rng.uniform(0, 1, len(ups))
    fills[: min(len(ups), 40)] = np.linspace(0.01, 0.99, min(len(ups), 40))
    ds = lut.offset(ups, fills)
    wt = w / w.sum()
    pts = pts.astype(np.float32)
    err = np.zeros(len(ups))
    for i, (u, d) in enumerate(zip(ups, ds)):
        s = pts @ u.astype(np.float32)
        err[i] = wt[s <= d].sum() - fills[i]
    j = int(np.abs(err).argmax())
    return dict(max_pct=float(np.abs(err).max() * 100), rms_pct=float(np.sqrt((err ** 2).mean()) * 100),
                p99_pct=float(np.percentile(np.abs(err), 99) * 100),
                worst=dict(up=ups[j].tolist(), fill=float(fills[j]), err_pct=float(err[j] * 100)), n=len(ups))


AXIS_DIRS = np.array([[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
                      [1, 1, 0], [1, -1, 0], [0, 1, 1], [1, 1, 1], [-1, -1, 1], [1, -1, -1]], dtype=np.float64)
AXIS_DIRS = AXIS_DIRS / np.linalg.norm(AXIS_DIRS, axis=1, keepdims=True)


# ----------------------------------------------------------------------------------------------------------------
# minimal GLB reader (for tests): returns (V, F, extras) of the first node with the given name, node-local space


def read_glb_node(path, name):
    import struct
    with open(path, "rb") as fh:
        data = fh.read()
    ln, = struct.unpack_from("<I", data, 12)
    js = json.loads(data[20:20 + ln])
    off = 20 + ln
    bl, = struct.unpack_from("<I", data, off)
    binc = data[off + 8: off + 8 + bl]
    node = next(n for n in js["nodes"] if n.get("name") == name)
    mesh = js["meshes"][node["mesh"]]
    Vs, Fs, base = [], [], 0

    def acc(i):
        a = js["accessors"][i]
        bv = js["bufferViews"][a["bufferView"]]
        dt = {5126: "<f4", 5125: "<u4", 5123: "<u2", 5121: "u1"}[a["componentType"]]
        nc = {"SCALAR": 1, "VEC3": 3, "VEC2": 2, "VEC4": 4}[a["type"]]
        o = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = bv.get("byteStride", 0)
        item = np.dtype(dt).itemsize * nc
        if stride and stride != item:
            raw = np.frombuffer(binc, dtype="u1", count=stride * a["count"], offset=o).reshape(a["count"], stride)[:, :item]
            return np.ascontiguousarray(raw).view(dt).reshape(a["count"], nc)
        return np.frombuffer(binc, dtype=dt, count=a["count"] * nc, offset=o).reshape(a["count"], nc)

    for pr in mesh["primitives"]:
        P = acc(pr["attributes"]["POSITION"]).astype(np.float64)
        I = acc(pr["indices"]).astype(np.int64).reshape(-1, 3)
        Vs.append(P)
        Fs.append(I + base)
        base += len(P)
    V = np.concatenate(Vs)
    F = np.concatenate(Fs)
    # weld duplicate vertices (split normals) so the mesh is watertight for parity/volume purposes
    key = np.round(V / 1e-7).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    V = V[first]
    F = inv.reshape(-1)[F]
    ex = node.get("extras") or {}
    return V, F, ex


def voxelize_auto(V, F, seed=0, target_points=700000, lateral=2.2, jitter_axis=4.0, jitter_xz=True):
    """Column grid finer laterally (h0/lateral), coarser along the column (h0*jitter_axis), same point budget."""
    h0 = auto_h(V, target_points)
    return voxelize(V, F, h0 / lateral, seed, hy=h0 * jitter_axis, jitter_xz=jitter_xz)
