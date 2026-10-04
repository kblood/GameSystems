"""Reusable NON-lathe containers (rounded-rectangle sections, handles, open tops) with the liquid system, LUT v2.

Run:  blender.exe -b --python containers.py -- [name ...]     (no names = all)   names: square hipflask jerrycan tumbler mug tank
      python containers.py --bottles                          (no Blender needed: writes export/bottle_*.liquid_v2.json from the bottle GLBs)
Output: ../export/container_<name>.glb (+ .liquid.json sidecar = extras.liquid, version 2 sphere_map),
        ../src/container_<name>.blend, catalog.json entries (merged, atomic).

Conventions (same as bottles.py): 1 unit = 1 m, base centre at origin, +Z up in Blender (+Y in glTF), nodes
Glass | Body (opaque plastic/ceramic), Liquid (closed interior), Cap, Label, Handle, Frame. Liquid extras (JSON string,
node extras `liquid`): see docs/liquid_lut_v2.md. All table data is in glTF node space (x, z, -y of Blender).
Shapes are lofts of rounded-rectangle rings (a, b half sizes, r corner radius; a=b=r is a circle), sweeps for handles.
"""
import sys
import os
import json
import math
import zlib

import numpy as np

try:
    import bpy
    import bmesh
except ImportError:                         # plain python (--bottles only)
    bpy = bmesh = None

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import liquid_lut as LL                     # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, ".."))
GAP = 0.0004                                # liquid mesh sits 0.4 mm inside the glass, like bottles.py
N_DIR, N_FILL = 25, 64
SMOOTH_DEG = 38.0
LOD = 0                                     # 1 = coarser rings (<~2k tris), same LUT as lod0


# ----------------------------------------------------------------------------------------------------------------
# geometry helpers (numpy rings -> bmesh)


class Ring:
    __slots__ = ("z", "a", "b", "r", "cx", "cy")

    def __init__(self, z, a, b=None, r=None, cx=0.0, cy=0.0):
        b = a if b is None else b
        r = min(a, b) if r is None else r          # r defaults to a circle / stadium
        self.z, self.a, self.b, self.r, self.cx, self.cy = z, a, b, min(r, a, b), cx, cy

    def inset(self, w, z=None, rmin=0.0006):
        a, b = max(self.a - w, 0.0006), max(self.b - w, 0.0006)
        r = max(min(self.r - w, a, b), min(rmin, a, b))
        return Ring(self.z if z is None else z, a, b, r, self.cx, self.cy)

    def lerp(self, o, t, z=None):
        f = lambda p, q: p + (q - p) * t
        return Ring(f(self.z, o.z) if z is None else z, f(self.a, o.a), f(self.b, o.b), f(self.r, o.r),
                    f(self.cx, o.cx), f(self.cy, o.cy))


class Fmt:
    """Ring sampling: K points per corner arc, sx/sy extra points on the straights parallel to x / y."""

    def __init__(self, K=8, sx=0, sy=0):
        if LOD:
            K, sx, sy = max(2, K // 2 if K > 4 else K - 1), sx // 2, sy
        self.K, self.sx, self.sy = K, sx, sy

    def pts(self, ring):
        K, a, b, r = self.K, ring.a, ring.b, ring.r
        ang = (np.arange(K) + 0.5) / K * (math.pi / 2)
        arcs = []
        for q, (qx, qy) in enumerate([(1, 1), (-1, 1), (-1, -1), (1, -1)]):
            th = q * math.pi / 2 + ang
            arcs.append(np.stack([qx * (a - r) + r * np.cos(th), qy * (b - r) + r * np.sin(th)], 1))
        out, straight = [], []
        nseg = [self.sx, self.sy, self.sx, self.sy]
        for q in range(4):
            A, B = arcs[q], arcs[(q + 1) % 4]
            out.append(A)
            straight += [False] * (K - 1) + [True]            # last segment of the arc leads into the straight
            if nseg[q]:
                t = (np.arange(1, nseg[q] + 1) / (nseg[q] + 1))[:, None]
                out.append(A[-1] * (1 - t) + B[0] * t)
                straight += [True] * nseg[q]
        P = np.concatenate(out) + np.array([ring.cx, ring.cy])
        st = np.array(straight, dtype=bool)                   # st[j] = segment j -> j+1 is (part of) a straight
        chord = max(r * (math.pi / 2) / K, 1e-9)
        long_straight = max(2 * (a - r), 2 * (b - r)) > 2.5 * chord
        # vertex j flagged "crease" when segment j-1 and j differ in type and the straights are long enough
        flag = (st != np.roll(st, 1)) if long_straight else np.zeros(len(st), dtype=bool)
        return P, flag

    def ring3(self, ring, deform=None):
        P, flag = self.pts(ring)
        P3 = np.concatenate([P, np.full((len(P), 1), ring.z)], 1)
        P3 = P3[:, [0, 1, 2]]
        if deform:
            P3 = deform(P3)
        return P3, flag


def rings3(fmt, rings, deform=None):
    arr, flg = [], []
    for r in rings:
        P, f = fmt.ring3(r, deform)
        arr.append(P)
        flg.append(f)
    return np.array(arr), np.array(flg)


class Mesh:
    """Accumulates closed pieces (each recalculated for outward normals) into one bmesh."""

    def __init__(self):
        self.bm = bmesh.new()
        self.sharp = []                                       # vertex-index pairs of creases

    def piece(self, build):
        bm = bmesh.new()
        sharp, longit = build(bm)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bm.verts.index_update()
        # angle-based creases on ring-direction / cap edges; `sharp` holds explicit longitudinal creases
        keep = set(map(frozenset, sharp))
        bm.verts.ensure_lookup_table()
        thr = math.radians(SMOOTH_DEG)
        marks = []
        for e in bm.edges:
            vs = frozenset((e.verts[0].index, e.verts[1].index))
            if vs in keep:
                marks.append(vs)
            elif vs not in longit and len(e.link_faces) == 2 and e.calc_face_angle(0.0) > thr:
                marks.append(vs)
        base = len(self.bm.verts)
        vmap = {}
        for v in bm.verts:
            vmap[v.index] = self.bm.verts.new(v.co)
        for f in bm.faces:
            self.bm.faces.new([vmap[v.index] for v in f.verts])
        self.sharp += [tuple(base + i for i in m) for m in marks]
        bm.free()

    def loft(self, rings3d, flags=None, cap_first=False, cap_last=False, loop=False):
        R, M, _ = rings3d.shape

        def build(bm):
            V = [[bm.verts.new(tuple(p)) for p in ring] for ring in rings3d]
            longit, sharp = set(), []
            nr = R if loop else R - 1
            for k in range(nr):
                k2 = (k + 1) % R
                for j in range(M):
                    j2 = (j + 1) % M
                    try:
                        bm.faces.new((V[k][j], V[k][j2], V[k2][j2], V[k2][j]))
                    except ValueError:
                        pass
                    ia, ib = k * M + j, k2 * M + j
                    longit.add(frozenset((ia, ib)))
                    if flags is not None and flags[k][j] and flags[k2][j]:
                        sharp.append((ia, ib))
            if cap_first:
                bm.faces.new(V[0][::-1])
            if cap_last:
                bm.faces.new(V[-1])
            return sharp, longit
        self.piece(build)

    def box(self, center, size, rot_y=0.0):
        """Axis-aligned box (optionally rotated about Y) as a closed piece."""
        def build(bm):
            bmesh.ops.create_cube(bm, size=1.0)
            for v in bm.verts:
                p = np.array([v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]])
                c, s = math.cos(rot_y), math.sin(rot_y)
                p = np.array([c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]])
                v.co = tuple(p + np.array(center))
            bm.verts.index_update()
            return [], set()
        self.piece(build)

    def to_object(self, name, material=None):
        me = bpy.data.meshes.new(name)
        bm = self.bm
        bm.verts.index_update()
        bm.verts.ensure_lookup_table()
        bm.edges.ensure_lookup_table()
        for f in bm.faces:
            f.smooth = True
        lookup = {}
        for e in bm.edges:
            lookup[frozenset((e.verts[0].index, e.verts[1].index))] = e
        for a, b in self.sharp:
            e = lookup.get(frozenset((a, b)))
            if e is not None:
                e.smooth = False
        bm.to_mesh(me)
        bm.free()
        me.update()
        obj = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(obj)
        if material:
            me.materials.append(material)
        return obj


def tube(path, fmt, sec, deform=None):
    """Sweep of the rounded-rect section `sec(t)->Ring-like (a,b,r)` along a planar path in the XZ plane (binormal=Y).
    Returns (rings3d, flags) with end caps expected."""
    path = np.asarray(path, dtype=float)
    T = np.gradient(path, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    Y = np.array([0.0, 1.0, 0.0])
    arr, flg = [], []
    for i, (P, t) in enumerate(zip(path, T)):
        N = np.cross(Y, t)
        N /= np.linalg.norm(N)
        a, b, r = sec(i / (len(path) - 1))
        pts, f = fmt.pts(Ring(0.0, a, b, r))
        W = P + pts[:, :1] * N + pts[:, 1:2] * Y
        if deform:
            W = deform(W)
        arr.append(W)
        flg.append(f)
    return np.array(arr), np.array(flg)


def material(name, color, rough=0.05, metal=0.0, transmission=0.0, ior=1.5, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = color
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["IOR"].default_value = ior
    b.inputs["Transmission Weight"].default_value = transmission
    b.inputs["Alpha"].default_value = alpha
    return m


def trim(rings, z_top):
    """Cut a bottom->top ring list at z_top (interpolating the last ring)."""
    out = []
    for i, r in enumerate(rings):
        if r.z < z_top - 1e-9:
            out.append(r)
        else:
            if i > 0 and rings[i - 1].z < z_top - 1e-9:
                p = rings[i - 1]
                t = (z_top - p.z) / max(r.z - p.z, 1e-12)
                out.append(p.lerp(r, t, z=z_top))
            elif not out:
                out.append(Ring(z_top, r.a, r.b, r.r, r.cx, r.cy))
            else:
                out.append(Ring(z_top, out[-1].a, out[-1].b, out[-1].r, out[-1].cx, out[-1].cy))
            break
    else:
        pass
    if out and abs(out[-1].z - z_top) > 1e-9:
        l = out[-1]
        out.append(Ring(z_top, l.a, l.b, l.r, l.cx, l.cy))
    return out


def shoulder(r0, r1, z0, z1, n, rpow=0.8):
    """Dome-like transition from ring r0 (at z0, excluded) to ring r1 (at z1, included)."""
    out = []
    for i in range(1, n + 1):
        t = i / n
        z = z0 + (z1 - z0) * math.sin(t * math.pi / 2)
        k = 1 - math.cos(t * math.pi / 2)                      # 0 -> 1
        out.append(r0.lerp(r1, k, z=z))
    # keep r <= min(a,b) and make the corner radius grow towards a circle
    return out


# ----------------------------------------------------------------------------------------------------------------
# container specs. Each returns a dict: parts (list of (name, Mesh-builder result, material)), liquid rings, extras

def interior_rings(inner, gap=GAP):
    return [r.inset(gap, z=r.z + (gap if i == 0 else 0.0)) for i, r in enumerate(inner)]


def spec_square(deform=None):
    fmt = Fmt(K=6)
    base = [Ring(0.0, 0.029, 0.029, 0.006), Ring(0.0025, 0.0335, 0.0335, 0.0075), Ring(0.007, 0.0358, 0.0358, 0.008),
            Ring(0.130, 0.0360, 0.0360, 0.0085)]
    neck = Ring(0.188, 0.0135, 0.0135, 0.0135)
    outer = base + shoulder(base[-1], neck, 0.130, 0.188, 9) + [
        Ring(0.205, 0.0135), Ring(0.2125, 0.0137), Ring(0.2155, 0.0150), Ring(0.2205, 0.0152), Ring(0.2225, 0.0146)]
    w = 0.0035
    inner = [outer[2].inset(w, z=0.0045)] + [r.inset(w) for r in outer[3:13]] + [
        Ring(0.205, 0.0100), Ring(0.2205, 0.0100), Ring(0.2225, 0.0108)]
    z_top = 0.2195
    return dict(fmt=fmt, outer=outer, inner=inner, z_top=z_top, deform=deform, lip_z=0.2225, shell="Glass",
                glass=((0.70, 0.88, 0.86, 1.0), 0.03), liquid=((0.30, 0.62, 0.66, 1.0), 0.0), capacity_note="gin")


def build_square(S, mats):
    parts = {}
    fmt, outer, inner = S["fmt"], S["outer"], S["inner"]
    # Glass shell
    m = Mesh()
    shell = outer + list(reversed(inner))
    A, F = rings3(fmt, shell, S["deform"])
    m.loft(A, F, cap_first=True, cap_last=True)
    parts["Glass"] = (m, mats["glass"])
    # stopper (T-shaped cork): shaft in the bore, head above the lip
    c = Fmt(K=10)
    cork = [Ring(0.205, 0.0099), Ring(0.2215, 0.0099), Ring(0.2215, 0.0172), Ring(0.2235, 0.0178), Ring(0.2385, 0.0176),
            Ring(0.2405, 0.0160), Ring(0.2415, 0.0140)]
    m = Mesh()
    A, F = rings3(c, cork)
    m.loft(A, F, cap_first=True, cap_last=True)
    parts["Cap"] = (m, mats["cap"])
    # front label (flat plate on the -Y face = glTF +Z)
    m = Mesh()
    m.box((0, -0.0362, 0.075), (0.052, 0.0008, 0.075))
    parts["Label"] = (m, mats["label"])
    return parts


def spec_hipflask(deform=None):
    fmt = Fmt(K=6, sx=12, sy=1)
    body = [Ring(0.0, 0.0400, 0.0100, 0.0080), Ring(0.003, 0.0465, 0.0155, 0.0105), Ring(0.008, 0.0485, 0.0165, 0.0115),
            Ring(0.095, 0.0485, 0.0165, 0.0115)]
    neck = Ring(0.132, 0.0105, 0.0105, 0.0105)
    outer = body + shoulder(body[-1], neck, 0.095, 0.132, 9, 0.9) + [Ring(0.146, 0.0105), Ring(0.1505, 0.0108),
                                                                         Ring(0.1535, 0.0113), Ring(0.1555, 0.0110)]
    w = 0.0025
    inner = [outer[2].inset(w, z=0.0045)] + [r.inset(w) for r in outer[3:13]] + [
        Ring(0.146, 0.0080), Ring(0.1535, 0.0080), Ring(0.1555, 0.0085)]
    return dict(fmt=fmt, outer=outer, inner=inner, z_top=0.1500, deform=deform, lip_z=0.1555, shell="Glass",
                glass=((0.85, 0.93, 0.95, 1.0), 0.03), liquid=((0.55, 0.22, 0.05, 1.0), 0.0))


def build_hipflask(S, mats):
    parts = {}
    fmt, outer, inner, dfm = S["fmt"], S["outer"], S["inner"], S["deform"]
    m = Mesh()
    A, F = rings3(fmt, outer + list(reversed(inner)), dfm)
    m.loft(A, F, cap_first=True, cap_last=True)
    parts["Glass"] = (m, mats["glass"])
    c = Fmt(K=12)
    cap = [Ring(0.1385, 0.0122), Ring(0.1390, 0.0138), Ring(0.1590, 0.0138), Ring(0.1612, 0.0128), Ring(0.1620, 0.0110)]
    m = Mesh()
    A, F = rings3(c, cap, dfm)
    m.loft(A, F, cap_first=True, cap_last=True)
    parts["Cap"] = (m, mats["cap"])
    return parts


def spec_tumbler(deform=None):
    fmt = Fmt(K=14)
    outer = [Ring(0.0, 0.0290), Ring(0.003, 0.0325), Ring(0.008, 0.0338), Ring(0.060, 0.0366), Ring(0.0950, 0.0385),
             Ring(0.0962, 0.0381), Ring(0.0968, 0.0373)]
    inner = [Ring(0.0220, 0.0215), Ring(0.0235, 0.0255), Ring(0.0270, 0.0290), Ring(0.0450, 0.0318), Ring(0.0950, 0.0352),
             Ring(0.0962, 0.0356), Ring(0.0968, 0.0362)]
    return dict(fmt=fmt, outer=outer, inner=inner, z_top=0.0950, deform=deform, lip_z=0.0968, shell="Glass",
                glass=((0.88, 0.95, 0.92, 1.0), 0.02), liquid=((0.62, 0.30, 0.04, 1.0), 0.0), open=True)


def build_tumbler(S, mats):
    m = Mesh()
    A, F = rings3(S["fmt"], S["outer"] + list(reversed(S["inner"])), S["deform"])
    m.loft(A, F, cap_first=True, cap_last=True)
    return {"Glass": (m, mats["glass"])}


def spec_mug(deform=None):
    fmt = Fmt(K=14)
    outer = [Ring(0.0, 0.0340), Ring(0.003, 0.0385), Ring(0.010, 0.0402), Ring(0.060, 0.0412), Ring(0.090, 0.0420),
             Ring(0.0940, 0.0416), Ring(0.0952, 0.0406)]
    inner = [Ring(0.0085, 0.0300), Ring(0.0100, 0.0338), Ring(0.0125, 0.0360), Ring(0.060, 0.0378), Ring(0.090, 0.0386),
             Ring(0.0940, 0.0386), Ring(0.0952, 0.0390)]
    return dict(fmt=fmt, outer=outer, inner=inner, z_top=0.0948, deform=deform, lip_z=0.0952, shell="Body",
                glass=None, liquid=((0.28, 0.14, 0.07, 1.0), 0.0), open=True)


def build_mug(S, mats):
    m = Mesh()
    A, F = rings3(S["fmt"], S["outer"] + list(reversed(S["inner"])), S["deform"])
    m.loft(A, F, cap_first=True, cap_last=True)
    parts = {"Body": (m, mats["body"])}
    # C-shaped handle on +X (right, seen from the front)
    phi = np.linspace(math.pi / 2, -math.pi / 2, 33)
    path = np.stack([0.0405 + 0.042 * np.cos(phi), np.zeros_like(phi), 0.0505 + 0.0330 * np.sin(phi) * 1.0], 1)

    def sec(t):
        flare = 1 + 0.35 * (1 - math.sin(t * math.pi)) ** 3
        return 0.0048 * (1 + 0.15 * flare), 0.0085 * flare, 0.0038
    A, F = tube(path, Fmt(K=4, sx=1, sy=1), sec)
    h = Mesh()
    h.loft(A, F, cap_first=True, cap_last=True)
    parts["Handle"] = (h, mats["body"])
    return parts


def spec_tank(deform=None):
    A_, B_, H = 0.300, 0.150, 0.350
    fmt = Fmt(K=2)
    outer = [Ring(0.0, A_ - 0.002, B_ - 0.002, 0.0015), Ring(0.002, A_, B_, 0.0025), Ring(H - 0.002, A_, B_, 0.0025),
             Ring(H, A_ - 0.0012, B_ - 0.0012, 0.0015)]
    t = 0.006
    inner = [Ring(0.008, A_ - t, B_ - t, 0.0015), Ring(0.0095, A_ - t, B_ - t, 0.0015),
             Ring(H - 0.002, A_ - t, B_ - t, 0.0015), Ring(H, A_ - 0.0048, B_ - 0.0048, 0.0015)]
    return dict(fmt=fmt, outer=outer, inner=inner, z_top=H - 0.001, deform=deform, lip_z=H, shell="Glass",
                glass=((0.80, 0.93, 0.92, 1.0), 0.02), liquid=((0.18, 0.50, 0.55, 1.0), 0.0), open=True, dims=(A_, B_, H))


def build_tank(S, mats):
    A_, B_, H = S["dims"]
    m = Mesh()
    A, F = rings3(S["fmt"], S["outer"] + list(reversed(S["inner"])), None)
    m.loft(A, F, cap_first=True, cap_last=True)
    parts = {"Glass": (m, mats["glass"])}
    fr = Mesh()
    f = Fmt(K=2)
    for z0, z1 in ((0.0, 0.016), (H - 0.014, H + 0.002)):
        ring = [Ring(z0, A_ + 0.0020, B_ + 0.0020, 0.003), Ring(z1, A_ + 0.0020, B_ + 0.0020, 0.003),
                Ring(z1, A_ - 0.0050, B_ - 0.0050, 0.0015), Ring(z0, A_ - 0.0050, B_ - 0.0050, 0.0015)]
        P, Fl = rings3(f, ring)
        fr.loft(P, Fl, loop=True)
    parts["Frame"] = (fr, mats["frame"])
    return parts


def spec_jerrycan(deform=None):
    fmt = Fmt(K=4)
    A_, B_, H = 0.170, 0.075, 0.340
    outer = [Ring(0.0, A_ - 0.012, B_ - 0.012, 0.010), Ring(0.004, A_ - 0.004, B_ - 0.004, 0.016),
             Ring(0.010, A_, B_, 0.018), Ring(H - 0.010, A_, B_, 0.018), Ring(H - 0.004, A_ - 0.004, B_ - 0.004, 0.016),
             Ring(H, A_ - 0.012, B_ - 0.012, 0.010)]
    w = 0.003
    inner = [r.inset(w) for r in outer]
    inner[0] = outer[0].inset(w, z=w)
    inner[-1] = outer[-1].inset(w, z=H - w)
    return dict(fmt=fmt, outer=outer, inner=inner, z_top=H - w - 0.0004, deform=deform, lip_z=H, shell="Body",
                glass=None, liquid=((0.85, 0.72, 0.18, 1.0), 0.0), dims=(A_, B_, H), open=False,
                spout=dict(cx=0.110, cy=0.0, r=0.0245, z0=H - 0.002, z1=0.362))


def build_jerrycan(S, mats):
    A_, B_, H = S["dims"]
    sp = S["spout"]
    m = Mesh()
    P, Fl = rings3(S["fmt"], S["outer"], None)
    m.loft(P, Fl, cap_first=True, cap_last=True)
    # spout neck (round boss, slightly flared at the base) + collar rings
    c = Fmt(K=10)
    cx = sp["cx"]
    neck = [Ring(sp["z0"], 0.031, 0.031, 0.031, cx), Ring(H + 0.004, 0.0280, 0.0280, 0.0280, cx),
            Ring(H + 0.010, sp["r"], sp["r"], sp["r"], cx), Ring(sp["z1"] - 0.002, sp["r"], sp["r"], sp["r"], cx),
            Ring(sp["z1"], 0.0230, 0.0230, 0.0230, cx)]
    P, Fl = rings3(c, neck)
    m.loft(P, Fl, cap_first=True, cap_last=True)
    # embossed X on both big faces + two horizontal ribs
    for sy in (-1, 1):
        y = sy * (B_ + 0.0004)
        for sgn in (-1, 1):
            m.box((0.0, y, 0.170), (0.34, 0.0032, 0.012), rot_y=sgn * math.atan2(0.230, 0.250))
        m.box((0.0, y, 0.040), (0.27, 0.0032, 0.010))
        m.box((0.0, y, 0.300), (0.27, 0.0032, 0.010))
    parts = {"Body": (m, mats["body"])}
    # top grab handle: squared arch in the XZ plane, left of the spout
    phi = np.linspace(0, math.pi, 41)
    p = 0.55
    cxh, Ax, Bz, z0 = -0.060, 0.062, 0.070, H - 0.008
    path = np.stack([cxh + Ax * np.sign(np.cos(phi)) * np.abs(np.cos(phi)) ** p, np.zeros_like(phi),
                     z0 + Bz * np.abs(np.sin(phi)) ** p], 1)
    A, F = tube(path, Fmt(K=4, sx=1, sy=1), lambda t: (0.0070, 0.0210, 0.0055))
    h = Mesh()
    h.loft(A, F, cap_first=True, cap_last=True)
    parts["Handle"] = (h, mats["body"])
    # screw cap on the spout
    cp = Mesh()
    cap = [Ring(sp["z0"] + 0.020, 0.0272, 0.0272, 0.0272, cx), Ring(sp["z0"] + 0.0205, 0.0300, 0.0300, 0.0300, cx),
           Ring(sp["z1"] + 0.016, 0.0300, 0.0300, 0.0300, cx), Ring(sp["z1"] + 0.018, 0.0276, 0.0276, 0.0276, cx)]
    P, Fl = rings3(Fmt(K=12), cap)
    cp.loft(P, Fl, cap_first=True, cap_last=True)
    parts["Cap"] = (cp, mats["cap"])
    return parts


SPECS = {
    "square": (spec_square, build_square),
    "hipflask": (spec_hipflask, build_hipflask),
    "jerrycan": (spec_jerrycan, build_jerrycan),
    "tumbler": (spec_tumbler, build_tumbler),
    "mug": (spec_mug, build_mug),
    "tank": (spec_tank, build_tank),
}

BEND_R = 0.14      # hip flask curvature radius (m)


def bend(P):
    P = np.array(P, dtype=float)
    P[:, 1] -= P[:, 0] ** 2 / (2 * BEND_R)
    return P


def make_materials(name, S):
    mats = {}
    if S["glass"]:
        mats["glass"] = material("Glass", S["glass"][0], rough=S["glass"][1] or 0.03, transmission=1.0, ior=1.5)
    mats["liquid"] = material("Liquid", S["liquid"][0], rough=0.05)
    mats["cap"] = {"square": material("Cap", (0.62, 0.45, 0.28, 1), rough=0.9),
                   "hipflask": material("Cap", (0.75, 0.76, 0.78, 1), rough=0.3, metal=1.0),
                   "jerrycan": material("Cap", (0.95, 0.45, 0.05, 1), rough=0.5)}.get(name)
    mats["label"] = material("Label", (0.93, 0.90, 0.78, 1), rough=0.7)
    mats["body"] = {"mug": material("Body", (0.90, 0.88, 0.82, 1), rough=0.25),
                    "jerrycan": material("Body", (0.62, 0.07, 0.04, 1), rough=0.55)}.get(name)
    mats["frame"] = material("Frame", (0.05, 0.05, 0.06, 1), rough=0.5)
    return mats


# ----------------------------------------------------------------------------------------------------------------


def to_gltf_space(V):
    """Blender (x, y, z) -> glTF node space (x, z, -y)."""
    return np.stack([V[:, 0], V[:, 2], -V[:, 1]], 1)


def liquid_mesh_arrays(m):
    """Triangulated (V,F) of the Liquid bmesh in glTF space."""
    bm = m.bm
    bm.verts.index_update()
    bm.verts.ensure_lookup_table()
    V = np.array([tuple(v.co) for v in bm.verts], dtype=np.float64)
    F = []
    for f in bm.faces:
        idx = [v.index for v in f.verts]
        for i in range(1, len(idx) - 1):
            F.append((idx[0], idx[i], idx[i + 1]))
    return to_gltf_space(V), np.array(F, dtype=np.int64)


def rim_points_for(ring_pts_b, n_max=48):
    P = to_gltf_space(np.asarray(ring_pts_b, dtype=float))
    if len(P) > n_max:
        idx = np.unique(np.linspace(0, len(P) - 1, n_max).round().astype(int))
        P = P[idx]
    return [[round(float(v), 5) for v in p] for p in P]


def build(name, lod=0):
    global LOD
    LOD = lod
    sfx = "_lod1" if lod else ""
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for coll in (bpy.data.meshes, bpy.data.materials):
        for d in list(coll):
            coll.remove(d)
    spec_fn, build_fn = SPECS[name]
    S = spec_fn(bend if name == "hipflask" else None)
    mats = make_materials(name, S)
    parts = build_fn(S, mats)

    # liquid interior (closed), 0.4 mm inside the walls
    liq_rings = trim(interior_rings(S["inner"]), S["z_top"])
    lm = Mesh()
    A, F = rings3(S["fmt"], liq_rings, S["deform"])
    lm.loft(A, F, cap_first=True, cap_last=True)
    V, Fa = liquid_mesh_arrays(lm)

    # rim / opening points
    top_pts, _ = S["fmt"].ring3(liq_rings[-1], S["deform"])
    if name == "jerrycan":
        sp = S["spout"]
        ang = np.linspace(0, 2 * math.pi, 16, endpoint=False)
        mouth = np.stack([sp["cx"] + 0.0215 * np.cos(ang), sp["cy"] + 0.0215 * np.sin(ang), np.full(16, sp["z1"])], 1)
        rim = rim_points_for(mouth)
    elif name in ("square", "hipflask"):
        lipring = S["inner"][-1]
        pts, _ = S["fmt"].ring3(Ring(S["lip_z"], lipring.a, lipring.b, lipring.r), S["deform"])
        rim = rim_points_for(pts)
    else:                                   # open top: the real rim height (a little above the liquid lid, never coplanar)
        tp = np.array(top_pts, dtype=float)
        tp[:, 2] = S["lip_z"]
        rim = rim_points_for(tp)

    h = LL.auto_h(V, 700000)
    seed = zlib.crc32(name.encode()) & 0xFFFF
    if lod:        # LOD meshes reuse the LOD0 table (interior differs by < ~0.5 % of the volume)
        vinfo = dict(odd_columns=0, columns=1, volume=1.0, mesh_volume=LL.mesh_volume(V, Fa))
        cap_ml = vinfo["mesh_volume"] * 1e6
        info = json.load(open(os.path.join(ROOT, "export", f"container_{name}.liquid.json")))
        lut = LL.LutV2(info)
        extra = info
    else:
        pts, w, vinfo = LL.voxelize_auto(V, Fa, seed)
        assert vinfo["odd_columns"] <= 0.002 * vinfo["columns"], vinfo
        table, d0, d1, centre = LL.build_table(pts, w, N_DIR, N_FILL)
        cap_ml = vinfo["mesh_volume"] * 1e6
    is_open = bool(S.get("open", False))
    if lod:
        text = json.dumps(info, separators=(",", ":"))
    else:
        extra = {
            "color": list(S["liquid"][0]), "carbonation": 0.0, "foam": 0.0, "foam_height": 0.01, "bubble_size": 1.0,
            "open": is_open, "closed_by": None if is_open else "Cap", "rim_points": rim,
            "open_height": round(min(p[1] for p in rim), 5), "tier": "high",
            "bounds": {"min": [round(float(x), 5) for x in V.min(0)], "max": [round(float(x), 5) for x in V.max(0)]},
            "top_y": round(float(V[:, 1].max()), 5),
        }
        if name == "jerrycan":
            sp = S["spout"]
            extra["spout"] = {"center": [round(sp["cx"], 5), sp["z1"], round(-sp["cy"], 5)], "radius": 0.0215,
                              "note": "mouth ring = rim_points; liquid leaves when Cap is removed and surface passes it"}
        info = LL.make_info(table, d0, d1, cap_ml, extra, centre=centre)
        lut = LL.LutV2(info)
        info["brim_fill"] = min(round(float(lut.fill_at(np.array([0.0, 1.0, 0.0]), extra["open_height"])), 4), 1.0)
        info["verification"] = {"mesh_volume_ml": round(cap_ml, 1), "voxel_h_m": round(h, 5), "seed": seed}
        text = json.dumps(info, separators=(",", ":"))
        # LOD tiers of the table (same format, coarser grid): export/container_<name>.liquid.<tier>.json
        for tier, (nd, nfl) in LL.TIERS.items():
            if tier == "high":
                continue
            ti = LL.resample(info, nd, nfl)
            ti["tier"] = tier
            with open(os.path.join(ROOT, "export", f"container_{name}.liquid.{tier}.json"), "w", encoding="utf-8") as fh:
                fh.write(json.dumps(ti, separators=(",", ":")))
    extra = info

    # Objects
    objs = {}
    for nm, (m, mat) in parts.items():
        objs[nm] = m.to_object(nm, mat)
    liq = lm.to_object("Liquid", mats["liquid"])
    liq["liquid"] = text
    if not lod:
        with open(os.path.join(ROOT, "export", f"container_{name}.liquid.json"), "w", encoding="utf-8") as fh:
            fh.write(text)

    # Export
    for o in bpy.data.objects:
        o.select_set(True)
    os.makedirs(os.path.join(ROOT, "export"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "src"), exist_ok=True)
    out = os.path.join(ROOT, "export", f"container_{name}{sfx}.glb")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_extras=True, export_yup=True,
                              export_apply=True, use_selection=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "src", f"container_{name}{sfx}.blend"))
    tri_est = 0
    for o in bpy.data.objects:
        o.data.calc_loop_triangles()
        tri_est += len(o.data.loop_triangles)
    height = max(v.co.z for o in bpy.data.objects if o.name != "Liquid" for v in o.data.vertices)
    print(f"BUILD {name}{sfx} capacity={cap_ml:.0f}ml height={height*100:.1f}cm tris={tri_est} lut_json={len(text)//1024}KB "
          f"voxel_odd={vinfo['odd_columns']} vol_voxel_vs_mesh={vinfo['volume']/vinfo['mesh_volume']:.4f} "
          f"brim_fill={extra['brim_fill']} -> {out}")
    if lod:
        return dict(id=f"container_{name}", lod1=f"export/container_{name}_lod1.glb", lod1_tris=tri_est)
    return dict(id=f"container_{name}", family="container", file=f"export/container_{name}.glb",
                capacity_ml=round(cap_ml), height_m=round(height, 4), opaque=S["glass"] is None, license="MIT",
                liquid_lut="v2", open_top=is_open, liquid_sidecar=f"export/container_{name}.liquid.json",
                liquid_tiers={t: f"export/container_{name}.liquid.{t}.json" for t in ("mid", "low")})


def merge_catalog(entries):
    """Re-read catalog.json right before writing and merge by id (other agents edit it too); atomic replace."""
    path = os.path.join(ROOT, "catalog.json")
    cat = json.load(open(path, encoding="utf-8"))
    have = {a["id"]: a for a in cat["assets"]}
    for e in entries:
        old = have.get(e["id"], {})
        old.update(e)
        have[e["id"]] = old
    cat["assets"] = sorted(have.values(), key=lambda a: a["id"])
    tmp = path + ".tmp_containers"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(cat, fh, indent=2)
    os.replace(tmp, path)


def bottles_v2(names=None):
    """Exact-match v2 sidecars for the lathe bottles: voxelise the exported Liquid mesh with the same code path."""
    import glob
    out = []
    for p in sorted(glob.glob(os.path.join(ROOT, "export", "bottle_*.glb"))):
        n = os.path.basename(p)[len("bottle_"):-4]
        if n.endswith(("_shards", "_broken")) or (names and n not in names):
            continue
        V, F, ex = LL.read_glb_node(p, "Liquid")
        v1 = json.loads(ex["liquid"]) if isinstance(ex.get("liquid"), str) else ex["liquid"]
        h = LL.auto_h(V, 700000)
        pts, w, vi = LL.voxelize_auto(V, F, 1234)
        table, d0, d1, c = LL.build_table(pts, w, N_DIR, N_FILL)
        extra = {k: v1[k] for k in ("color", "carbonation", "foam", "foam_height", "bubble_size") if k in v1}
        extra.update(open=False, closed_by="Cap", v1_capacity_ml=v1.get("capacity_ml"),
                     bounds={"min": [round(float(x), 5) for x in V.min(0)], "max": [round(float(x), 5) for x in V.max(0)]})
        info = LL.make_info(table, d0, d1, vi["mesh_volume"] * 1e6, extra, centre=c)
        fp = os.path.join(ROOT, "export", f"bottle_{n}.liquid_v2.json")
        with open(fp, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(info, separators=(",", ":")))
        print(f"BUILD bottle_{n} v2 capacity={vi['mesh_volume']*1e6:.0f}ml (v1 said {v1.get('capacity_ml')}) "
              f"json={os.path.getsize(fp)//1024}KB")
        out.append(n)
    return out


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    if "--bottles" in argv:
        bottles_v2([a for a in argv if not a.startswith("--")])
    else:
        names = [a for a in argv if not a.startswith("--")] or list(SPECS)
        ents = [build(n) for n in names]
        if "--lod" in argv or not [a for a in argv if not a.startswith("--")]:
            ents += [build(n, 1) for n in names if n in ("square", "hipflask", "mug", "tumbler", "jerrycan", "tank")]
        merge_catalog(ents)
        print("BUILD done", len(ents))
