"""Volume-preserving liquid plane table (extras.liquid v1 format) computed from the ACTUAL closed Liquid mesh.

v1 (scripts/bottles.py volume_lut) slices r(z) disks of a profile; that cannot represent a punt (annular slices),
petaloid feet, ribs or a spout. Here the mesh is ray-cast column by column (parity -> inside intervals), giving a
weighted point cloud of the interior; the LUT is then the same quantity as v1: for each cos(tilt) and fill the plane
offset d with  vol{p : dot(p, up) <= d} = fill * V.  Non-axisymmetric meshes average d over several tilt azimuths.
tests/bv2_lut_check.py cross-checks against bottles.volume_lut on punt-free profiles.
"""
import math
import numpy as np

N_COS, N_FILL = 33, 64   # same as scripts/bottles.py (kept identical so shaders need no change)


def mesh_volume(verts, tris):
    v = np.asarray(verts, float)
    t = np.asarray(tris, int)
    a, b, c = v[t[:, 0]], v[t[:, 1]], v[t[:, 2]]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)


def triangulate(faces):
    out = []
    for f in faces:
        for k in range(1, len(f) - 1):
            out.append((f[0], f[k], f[k + 1]))
    return out


def point_cloud(verts, faces, ng=88, nz=200):
    """Inside points (x, y, z) + per-point weight (m^3) by vertical ray casting through the closed mesh."""
    from mathutils.bvhtree import BVHTree
    from mathutils import Vector
    v = np.asarray(verts, float)
    tris = triangulate(faces)
    bvh = BVHTree.FromPolygons([tuple(p) for p in v], tris, epsilon=0.0)
    R = float(np.sqrt((v[:, 0] ** 2 + v[:, 1] ** 2).max())) * 1.001
    zlo, zhi = float(v[:, 2].min()), float(v[:, 2].max())
    cell = 2 * R / ng
    g = -R + (np.arange(ng) + 0.5) * cell + 1.234e-6        # tiny offset: never hit the axis pole exactly
    zs = zlo + (np.arange(nz) + 0.5) * (zhi - zlo) / nz
    dz = (zhi - zlo) / nz
    xs, ys, zz = [], [], []
    up = Vector((0, 0, 1))
    for x in g:
        for y in g:
            if x * x + y * y > R * R:
                continue
            hits = []
            o = Vector((x, y, zlo - 0.01))
            for _ in range(32):
                loc, nrm, idx, dist = bvh.ray_cast(o, up)
                if loc is None:
                    break
                hits.append(loc.z)
                o = Vector((x, y, loc.z + 1e-7))
            if len(hits) < 2:
                continue
            if len(hits) % 2:
                hits = hits[:-1]
            m = np.zeros(nz, bool)
            for a, b in zip(hits[0::2], hits[1::2]):
                m |= (zs >= a) & (zs < b)
            c = int(m.sum())
            if c:
                xs.append(np.full(c, x)); ys.append(np.full(c, y)); zz.append(zs[m])
    x = np.concatenate(xs); y = np.concatenate(ys); z = np.concatenate(zz)
    w = np.full(len(x), cell * cell * dz)
    return x, y, z, w


def lut_from_cloud(x, y, z, w, azimuths=(0.0,), n_cos=N_COS, n_fill=N_FILL, bins=8192, V=None):
    cs = np.linspace(-1, 1, n_cos)
    fs = np.linspace(0, 1, n_fill)
    lut = np.zeros((n_cos, n_fill))
    Vt = w.sum() if V is None else V
    for phi in azimuths:
        h = x * math.cos(phi) + y * math.sin(phi)
        for i, c in enumerate(cs):
            th = math.acos(max(-1.0, min(1.0, c)))
            s = h * math.sin(th) + z * math.cos(th)
            lo, hi = float(s.min()), float(s.max())
            hist, edges = np.histogram(s, bins=bins, range=(lo, hi + 1e-9), weights=w)
            cum = np.concatenate([[0.0], np.cumsum(hist)]) * (Vt / w.sum())
            lut[i] += np.interp(fs * Vt, cum, edges)
    lut /= len(azimuths)
    return lut


def fill_error(x, y, z, w, lut, V_ref, checks=((1.0, 0.1), (1.0, 0.5), (1.0, 0.9), (0.0, 0.25), (0.0, 0.5),
                                                  (0.0, 0.75), (-1.0, 0.5), (0.5, 0.6), (-0.5, 0.3))):
    """Max |actual volume below the LUT plane - fill*V_ref| / V_ref over sample poses (x-tilt), in %."""
    n_cos, n_fill = lut.shape
    worst = 0.0
    for c, f in checks:
        xi = (c * 0.5 + 0.5) * (n_cos - 1)
        yi = f * (n_fill - 1)
        x0 = min(n_cos - 2, int(xi)); y0 = min(n_fill - 2, int(yi)); fx = xi - x0; fy = yi - y0
        d = (lut[x0, y0] * (1 - fy) + lut[x0, y0 + 1] * fy) * (1 - fx) + (lut[x0 + 1, y0] * (1 - fy) + lut[x0 + 1, y0 + 1] * fy) * fx
        th = math.acos(c)
        s = x * math.sin(th) + z * math.cos(th)
        vol = w[s <= d].sum() * 1.0
        worst = max(worst, abs(vol - f * V_ref) / V_ref * 100)
    return worst


def height_volume(z, w, zq):
    """Upright cumulative volume (m^3) below heights zq (for graduation marks)."""
    o = np.argsort(z)
    cum = np.cumsum(w[o])
    return np.interp(zq, z[o], cum)
