"""v2 bottle geometry helpers (pure numpy, no bpy): smooth profiles, wall offset, lathe grids, displacement fields.

Profile conventions (2D, metres): points (r, z), r = distance from the +Z axis, z up, base resting plane z = 0.
A profile "control list" is a list of items:
    (r, z)            smooth Catmull-Rom knot
    (r, z, "c")       corner knot (tangent break, edge stays sharp)
    "section"         string: following knots belong to this section (base, heel, body, shoulder, neck, finish, lip, ...)
"""
import math
import numpy as np

TAU = 2 * math.pi


# ----------------------------------------------------------------------------------------------------------- splines
def parse_controls(items, unit=1.0):
    """-> list of (np.array([r,z]), corner:bool, section:str)"""
    out, sec = [], "body"
    for it in items:
        if isinstance(it, str):
            sec = it
            continue
        corner = len(it) > 2 and it[2] == "c"
        out.append((np.array([it[0] * unit, it[1] * unit], float), corner, sec))
    return out


def _cr_span(p0, p1, p2, p3, n, alpha=0.5):
    """Centripetal Catmull-Rom between p1 and p2, n samples (excluding p2)."""
    def tj(ti, a, b):
        return ti + max(np.linalg.norm(b - a), 1e-9) ** alpha
    t0 = 0.0; t1 = tj(t0, p0, p1); t2 = tj(t1, p1, p2); t3 = tj(t2, p2, p3)
    t = np.linspace(t1, t2, n, endpoint=False)[:, None]
    a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
    a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
    a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
    b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
    b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
    return (t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2


def sample_controls(ctrl, step=0.0004):
    """Dense polyline through the knots. Returns pts (n,2), corner flag (n,), section names list (n)."""
    pts, cor, sec = [], [], []
    # split into chains at corners (a corner knot ends one chain and starts the next)
    chains, cur = [], [ctrl[0]]
    for k in ctrl[1:]:
        cur.append(k)
        if k[1]:
            chains.append(cur); cur = [k]
    if len(cur) > 1:
        chains.append(cur)
    for ci, ch in enumerate(chains):
        P = [k[0] for k in ch]
        if len(P) == 2:
            P = [P[0], P[1]]
        ext = [2 * P[0] - P[1]] + P + [2 * P[-1] - P[-2]]
        if ci == 0 and abs(P[0][0]) < 1e-12 and len(P) > 2:
            ext[0] = np.array([-P[1][0], P[1][1]])   # mirror across the axis: horizontal tangent at the pole
        for i in range(len(P) - 1):
            L = np.linalg.norm(P[i + 1] - P[i])
            n = max(2, int(math.ceil(L / step)))
            if len(P) == 2:
                seg = P[i] + (P[i + 1] - P[i]) * np.linspace(0, 1, n, endpoint=False)[:, None]
            else:
                seg = _cr_span(ext[i], ext[i + 1], ext[i + 2], ext[i + 3], n)
            for j, q in enumerate(seg):
                pts.append(q); cor.append(j == 0 and (ch[i][1] or (i == 0 and ci > 0))); sec.append(ch[i + 1][2])
    last = chains[-1][-1]
    pts.append(last[0]); cor.append(True); sec.append(last[2])
    pts = np.array(pts)
    cor = np.array(cor, bool); cor[0] = True
    # drop exact duplicates
    keep = np.ones(len(pts), bool)
    keep[1:] = np.linalg.norm(np.diff(pts, axis=0), axis=1) > 1e-9
    return pts[keep], cor[keep], [s for s, k in zip(sec, keep) if k]


def arclen(p):
    return np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))])


def normals2d(p):
    """Outward normals for a profile traversed axis-bottom -> up (material on the left of travel = inside...)."""
    t = np.gradient(p, axis=0)
    t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-12)
    return np.stack([t[:, 1], -t[:, 0]], 1)


def smooth_along(s, vals, sigma):
    """Gaussian smoothing of per-point values along arc length s."""
    if sigma <= 0:
        return vals.copy()
    ds = np.gradient(s)
    d = s[:, None] - s[None, :]
    w = np.exp(-0.5 * (d / sigma) ** 2) * ds[None, :]
    return (w @ vals) / w.sum(1)


# ------------------------------------------------------------------------------------------------- polyline cleanup
def _seg_inter(a, b, c, d):
    r = b - a; s = d - c
    den = r[0] * s[1] - r[1] * s[0]
    if abs(den) < 1e-15:
        return None
    t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den
    u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den
    if 0 < t < 1 and 0 < u < 1:
        return a + t * r
    return None


def remove_loops(p, window=400):
    """Cut self-intersection loops (swallowtails) produced by offsetting a concave/convex profile."""
    p = np.asarray(p, float)
    i = 0
    while i < len(p) - 3:
        j1 = min(len(p) - 2, i + window)
        js = np.arange(i + 2, j1 + 1)
        if len(js):
            a, b = p[i], p[i + 1]
            c, d = p[js], p[js + 1]
            r = b - a; s = d - c
            den = r[0] * s[:, 1] - r[1] * s[:, 0]
            ok = np.abs(den) > 1e-18
            den = np.where(ok, den, 1.0)
            t = ((c[:, 0] - a[0]) * s[:, 1] - (c[:, 1] - a[1]) * s[:, 0]) / den
            u = ((c[:, 0] - a[0]) * r[1] - (c[:, 1] - a[1]) * r[0]) / den
            hit = ok & (t > 0) & (t < 1) & (u > 0) & (u < 1)
            if hit.any():
                k = np.flatnonzero(hit)[-1]           # farthest crossing: cut the whole loop
                q = a + t[k] * r
                p = np.vstack([p[:i + 1], q[None], p[js[k] + 1:]])
        i += 1
    return p


def resample(p, step):
    s = arclen(p)
    n = max(2, int(math.ceil(s[-1] / step)) + 1)
    ss = np.linspace(0, s[-1], n)
    return np.stack([np.interp(ss, s, p[:, 0]), np.interp(ss, s, p[:, 1])], 1)


def laplace(p, iters=2, fix_ends=True, lam=0.5):
    p = p.copy()
    for _ in range(iters):
        q = p.copy()
        q[1:-1] = p[1:-1] + lam * (0.5 * (p[:-2] + p[2:]) - p[1:-1])
        p = q
    return p


def offset_inward(p, t):
    """Offset profile inward (against the outward normal) by per-point thickness t; loops removed."""
    n = normals2d(p)
    q = p - n * np.asarray(t)[:, None]
    q = remove_loops(q)
    return q


# ------------------------------------------------------------------------------------------------ simplification
def dp_simplify(p, tol, keep=None, max_len=None):
    """Douglas-Peucker on a polyline, always keeping indices in `keep`; optional max span length."""
    n = len(p)
    mark = np.zeros(n, bool); mark[0] = mark[-1] = True
    if keep is not None:
        mark[np.asarray(keep, bool) if np.asarray(keep).dtype == bool else keep] = True
    idx = np.flatnonzero(mark)
    stack = list(zip(idx[:-1], idx[1:]))
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        seg = p[b] - p[a]
        L = np.linalg.norm(seg)
        q = p[a + 1:b] - p[a]
        if L < 1e-12:
            d = np.linalg.norm(q, axis=1)
        else:
            d = np.abs(q[:, 0] * seg[1] - q[:, 1] * seg[0]) / L
        k = int(np.argmax(d))
        if d[k] > tol or (max_len is not None and L > max_len):
            m = a + 1 + k if d[k] > tol else (a + b) // 2
            mark[m] = True
            stack += [(a, m), (m, b)]
    return np.flatnonzero(mark)


def densify_zones(idx, p, zones, side=None):
    """Add indices so that inside z-zones [(z0,z1,max_step)] spans are <= max_step (for 3D features: threads, ribs)."""
    s = arclen(p)
    out = set(int(i) for i in idx)
    for zn in zones:
        z0, z1, ms = zn[:3]
        m = (p[:, 1] >= z0) & (p[:, 1] <= z1)
        if side is not None and len(zn) > 3:
            m &= np.isin(side, zn[3])
        inz = np.flatnonzero(m)
        if not len(inz):
            continue
        # contiguous runs of in-zone points; inside each run keep a point every `ms` of arc length
        runs = np.split(inz, np.flatnonzero(np.diff(inz) > 1) + 1)
        for run in runs:
            last = -1e9
            for i in run:
                if s[i] - last >= ms * 0.999:
                    out.add(int(i)); last = s[i]
            out.add(int(run[-1]))
    return np.array(sorted(out))


# ---------------------------------------------------------------------------------------------- lathe grid (numpy)
def area_comp(seg):
    """Radius factor so an N-gon has the same area as the circle (keeps volume/LUT consistent across LODs)."""
    return math.sqrt(TAU / (seg * math.sin(TAU / seg)))


def lathe_grid(prof, nrm, seg, disp=None, comp=True, uv_v=None, phase=0.0, pole_eps=1e-7, shear=None):
    """Revolve profile (n,2) around Z with `seg` segments.
    disp(theta[seg], ring_index) -> (seg,) displacement along the 3D normal (nr cos, nr sin, nz) of that ring.
    shear(z) -> (dx, dy) translation per height (lean wobble).
    Returns verts (m,3), faces list, face_uvs list (per corner (u,v)), ring vertex index ranges."""
    k = area_comp(seg) if comp else 1.0
    th = phase + np.arange(seg) * TAU / seg
    c, s = np.cos(th), np.sin(th)
    verts, rings = [], []
    vi = 0
    for i, (q, nn) in enumerate(zip(prof, nrm)):
        r, z = q
        if r <= pole_eps:
            dz = 0.0
            if disp is not None:
                dz = float(np.mean(disp(th, i))) * nn[1]
            p0 = np.array([[0.0, 0.0, z + dz]])
            if shear is not None:
                p0[0, :2] += shear(z)
            verts.append(p0); rings.append((vi, 1)); vi += 1
            continue
        d = disp(th, i) if disp is not None else 0.0
        rr = (r + d * nn[0]) * k
        zz = z + d * nn[1] + 0 * th
        P = np.stack([rr * c, rr * s, zz], 1)
        if shear is not None:
            P[:, :2] += np.asarray(shear(z))[None, :]
        verts.append(P); rings.append((vi, seg)); vi += seg
    verts = np.concatenate(verts)
    faces, fuv = [], []
    v = uv_v if uv_v is not None else np.linspace(0, 1, len(prof))
    for i in range(len(prof) - 1):
        (a0, an), (b0, bn) = rings[i], rings[i + 1]
        va, vb = v[i], v[i + 1]
        for j in range(seg):
            j1 = (j + 1) % seg
            u0, u1 = j / seg, (j + 1) / seg
            if an == 1 and bn == 1:
                continue
            if an == 1:
                faces.append((a0, b0 + j1, b0 + j)); fuv.append(((0.5 * (u0 + u1), va), (u1, vb), (u0, vb)))
            elif bn == 1:
                faces.append((a0 + j, a0 + j1, b0)); fuv.append(((u0, va), (u1, va), (0.5 * (u0 + u1), vb)))
            else:
                faces.append((a0 + j, a0 + j1, b0 + j1, b0 + j)); fuv.append(((u0, va), (u1, va), (u1, vb), (u0, vb)))
    return verts, faces, fuv, rings


def tube(path, radius, sides=6, closed=False):
    """Sweep a circle along a 3D polyline. Returns verts, faces (quads), for wires (bail, cage)."""
    path = np.asarray(path, float)
    n = len(path)
    T = np.gradient(path, axis=0)
    if closed:
        T = np.roll(path, -1, 0) - np.roll(path, 1, 0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    ref = np.array([0.0, 0.0, 1.0]) if abs(T[0, 2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    N = np.cross(T[0], ref); N /= np.linalg.norm(N)
    verts, faces = [], []
    for i in range(n):
        if i > 0:   # parallel transport
            N = N - T[i] * np.dot(N, T[i]); N /= np.linalg.norm(N)
        B = np.cross(T[i], N)
        for j in range(sides):
            a = TAU * j / sides
            verts.append(path[i] + radius * (math.cos(a) * N + math.sin(a) * B))
    rng = range(n) if closed else range(n - 1)
    for i in rng:
        i1 = (i + 1) % n
        for j in range(sides):
            j1 = (j + 1) % sides
            faces.append((i * sides + j, i * sides + j1, i1 * sides + j1, i1 * sides + j))
    if not closed:   # end caps
        verts.append(path[0]); verts.append(path[-1])
        c0, c1 = len(verts) - 2, len(verts) - 1
        for j in range(sides):
            j1 = (j + 1) % sides
            faces.append((c0, j1, j))
            faces.append((c1, (n - 1) * sides + j, (n - 1) * sides + j1))
    return np.array(verts), faces


# ---------------------------------------------------------------------------------------------- shape functions
def smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, float) - e0) / (e1 - e0 + 1e-15), 0, 1)
    return t * t * (3 - 2 * t)


def window(x, a, b, ramp):
    """1 inside [a,b], smooth ramps of width `ramp` outside."""
    return smoothstep(a - ramp, a, x) * (1 - smoothstep(b, b + ramp, x))


def bump(x, c, half, ramp):
    """flat-top raised-cosine bump centred at c, flat half-width `half`, edge ramp `ramp`."""
    d = np.abs(np.asarray(x, float) - c)
    return 1 - smoothstep(half, half + ramp, d)


def wrap_pi(a):
    return (np.asarray(a) + math.pi) % TAU - math.pi
