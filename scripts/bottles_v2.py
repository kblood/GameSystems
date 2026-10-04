"""Bottle family v2: smooth spline profiles, variable wall thickness, punts/petaloid bases, finishes with beads,
real helical threads, ribs/bands/panels, normal-mapped seams/stipple/graduations, wobble, closures - in 3 tiers.

Run:  blender -b --python scripts/bottles_v2.py -- [name[:glass] ...] [--tiers 0,1,2] [--no-catalog]
      (no names = all of bottle_specs_v2.NAMES)
Out:  export/v2/bottle_<name>.glb        HIGH   (tier 0)
      export/v2/bottle_<name>_lod1.glb   MEDIUM (tier 1)
      export/v2/bottle_<name>_lod2.glb   LOW    (tier 2)
      export/v2/bottle_<name>.liquid.json  sidecar = extras.liquid (v1 format, shared by all tiers)
      export/v2/bottle_<name>.profile.json outer/inner profiles + label zone (for fracture / label tools)
      src/v2/bottle_<name>.blend (HIGH scene), catalog.json entries id bottle_v2_<name> (merged)
Nodes: Glass, Liquid, Cap (+ Bail / Cage / Stand / GlassCap). No label (label slots are another system).
"""
import bpy, sys, os, json, math, zlib, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.normpath(os.path.join(HERE, ".."))
import bv2_geom as G
import bv2_lut as LUT
import bv2_caps as CAPS
from bottle_specs_v2 import get_spec, NAMES, GLASS
import bottles as V1          # v1 module: N_COS/N_FILL and volume_lut (cross-check)

mm = 1e-3
GAP = 0.4 * mm
OUT = os.path.join(ROOT, "export", "v2")
TIERS = [
    dict(name="high", suffix="", glass=4200, liquid=1100, cap_seg=48, nm=(1024, 1024), inner_tol=2.5),
    dict(name="medium", suffix="_lod1", glass=1900, liquid=560, cap_seg=24, nm=(512, 512), inner_tol=3.0),
    dict(name="low", suffix="_lod2", glass=760, liquid=240, cap_seg=12, nm=None, inner_tol=3.0),
]
NM_ONLY = ("seams", "stipple", "grad", "waviness")


# ================================================================================================== profile
def base_knots(spec):
    b = spec["base"]
    first = next(k for k in spec["outer"] if not isinstance(k, str))
    R, zb = first[0], first[1]
    if b["type"] == "none":
        return []
    d, rr = b["depth"], b.get("r_rest", 0.8 * R)
    if b["type"] == "petaloid":
        rr = 0.8 * R
    if b["type"] == "punt":
        k = ["base", (0, d), (0.35 * rr, d * 0.93), (0.68 * rr, d * 0.62), (0.88 * rr, d * 0.22), (rr, 0.0)]
    else:
        k = ["base", (0, d), (0.5 * rr, d * 0.72), (0.86 * rr, d * 0.2), (rr, 0.0)]
    k.append("heel")
    for a in (28, 58):
        t = math.radians(a)
        k.append((rr + (R - rr) * math.sin(t), zb * (1 - math.cos(t))))
    return k


def make_profile(spec):
    items = base_knots(spec) + list(spec["outer"])
    ctrl = G.parse_controls(items)
    pts, cor, sec = G.sample_controls(ctrl, step=0.25 * mm)
    corner_ix = set(np.flatnonzero(cor[1:-1]) + 1)
    # only explicit "c" knots are hard edges: sample_controls flags chain starts (= "c" knots)
    lip = spec["lip"]
    ro, ri, rb = lip["round_o"], lip["round_i"], lip["r_bore"]
    r_o, z_l = pts[-1]
    z_top = z_l + ro
    lip_pts = CAPS.arc(r_o - ro, z_l, ro, 0, 90, 9)[1:]
    flat = [(x, z_top) for x in np.linspace(r_o - ro, rb + ri, max(2, int((r_o - ro - rb - ri) / (0.5 * mm)) + 1))[1:]]
    lip_pts += flat + CAPS.arc(rb + ri, z_top - ri, ri, 90, 180, 7)[1:]
    # inner wall: normal offset with a section thickness function (gaussian blended)
    isec = np.array([s for s in sec])
    i_f = int(np.flatnonzero(isec == "finish")[0])
    z_f = pts[i_f, 1]
    w = spec["wall"]
    t = np.array([w.get(s, w["body"]) for s in sec[:i_f]])
    s_arc = G.arclen(pts[:i_f])
    t = G.smooth_along(s_arc, t, w["blend"])
    inner = G.offset_inward(pts[:i_f], t)
    if inner[0, 0] < 0 or pts[0, 0] == 0:
        k = np.flatnonzero(inner[:, 0] >= 0)[0]
        inner = np.vstack([[0.0, inner[k, 1]], inner[k:]])
    inner = G.laplace(G.resample(inner, 0.25 * mm), iters=4)
    inner[0, 0] = 0.0
    zc = z_f - 3 * mm
    k = np.flatnonzero(inner[:, 1] <= zc)
    k = k[-1] if len(k) else len(inner) - 1
    inner = inner[:k + 1]
    r_c, z_c = inner[-1]
    zb0 = z_f + 1 * mm
    u = np.linspace(0, 1, 10)[1:]
    trans = np.stack([r_c + (rb - r_c) * G.smoothstep(0, 1, u), z_c + (zb0 - z_c) * u], 1)
    bore_z = np.arange(zb0 + 0.5 * mm, z_top - ri, 0.5 * mm)
    bore = np.stack([np.full(len(bore_z), rb), bore_z], 1)
    inner_up = np.vstack([inner, trans, bore])            # axis -> bore top (excl. lip arc)
    outer = pts
    shell = np.vstack([outer, np.array(lip_pts), inner_up[::-1]])
    n_o, n_l = len(outer), len(lip_pts)
    side = np.array([0] * n_o + [1] * n_l + [2] * len(inner_up))
    keep = set([0, n_o - 1, n_o, n_o + n_l - 1, n_o + n_l, len(shell) - 1]) | corner_ix
    secs = list(sec) + ["lip"] * n_l + ["inner"] * len(inner_up)
    zf_bague = outer[i_f:][np.argmax(outer[i_f:, 0]), 1]
    return dict(outer=outer, shell=shell, side=side, keep=sorted(keep), corners=corner_ix, inner_up=inner_up,
                z_top=z_top, z_f=z_f, r_lip=r_o, r_bore=rb, sec=secs, n_outer=n_o, n_lip=n_l, z_bague=zf_bague,
                body_r=float(outer[:, 0].max()), i_f=i_f)


# ================================================================================================== features
def rib_pattern(f, th):
    c = np.cos(f["n"] * th)
    k = math.cos(math.pi * f.get("duty", 0.45))
    p = G.smoothstep(k - 0.3, k + 0.3, c)
    if f.get("mask"):
        for cdeg, hdeg in f["mask"]:
            d = np.abs(G.wrap_pi(th - math.radians(cdeg)))
            p = p * G.smoothstep(math.radians(hdeg), math.radians(hdeg + 10), d)
    return p


def feat_height(f, th, z, r, ctx):
    """Outward height (m) of a feature at (theta, z, r); arrays broadcast (rings x seg)."""
    T = f["type"]
    if T == "band":
        return f["depth"] * G.bump(z, f["z"], f["half"], f["ramp"]) + 0 * th
    if T == "panel":
        return f["depth"] * G.window(z, f["z0"], f["z1"], f["ramp"]) + 0 * th
    if T == "ribs":
        return f["depth"] * G.window(z, f["z0"], f["z1"], f["ramp"]) * rib_pattern(f, th)
    if T == "petaloid":
        R = ctx["body_r"]
        env = G.smoothstep(f["r0"] * R, (f["r0"] + 0.3) * R, r) * (1 - G.smoothstep(f["zmax"] * 0.55, f["zmax"], z))
        foot = (0.5 + 0.5 * np.cos(f["n"] * th)) ** 1.5
        return f["depth"] * (foot - 0.35) * env
    if T == "thread":
        frac = np.mod((z - f["z0"]) / f["pitch"] - f["starts"] * th / G.TAU, 1.0)
        tri = 1 - np.abs(2 * frac - 1)
        shp = G.smoothstep(0.3, 0.7, tri)
        return f["height"] * shp * G.window(z, f["z0"] + 0.5 * f["pitch"], f["z1"] - 0.5 * f["pitch"], 0.5 * f["pitch"])
    if T == "seams":
        d = np.minimum(np.abs(G.wrap_pi(th)), np.abs(G.wrap_pi(th - math.pi))) * np.maximum(r, 1 * mm)
        zz = G.window(z, ctx["heel_z"], ctx["z_top"] - 0.6 * mm, 0.5 * mm)
        return 0.09 * mm * np.exp(-0.5 * (d / (0.22 * mm)) ** 2) * zz
    if T == "stipple":
        N = round(G.TAU * ctx["body_r"] / (0.9 * mm))
        return 0.07 * mm * (0.5 + 0.5 * np.sin(th * N)) * (0.5 + 0.5 * np.sin(z * G.TAU / (0.9 * mm))) * \
            G.window(z, f["z0"], f["z1"], 0.5 * mm)
    if T == "waviness":
        H = ctx["z_top"]
        a = f["amp"]
        return a * (np.sin(3 * th + z / H * 9.0 + 0.7) + 0.6 * np.sin(5 * th - z / H * 17.0 + 2.1) +
                    0.4 * np.sin(2 * th + z / H * 31.0)) + 0 * r
    if T == "grad":
        h = 0 * th * z
        for zk, major in ctx.get("grad_z", []):
            wdt = (11 if major else 6) * mm
            ang = np.abs(G.wrap_pi(th - math.radians(f["theta"]))) * np.maximum(r, 1 * mm)
            h = h + 0.16 * mm * np.exp(-0.5 * ((z - zk) / (0.28 * mm)) ** 2) * (1 - G.smoothstep(wdt, wdt + 0.6 * mm, ang))
        # vertical spine
        ang = np.abs(G.wrap_pi(th - math.radians(f["theta"]) + 0.0)) * np.maximum(r, 1 * mm)
        if ctx.get("grad_z"):
            z0 = min(z for z, _ in ctx["grad_z"]); z1 = max(z for z, _ in ctx["grad_z"])
            h = h + 0.12 * mm * np.exp(-0.5 * ((ang + 11 * mm) / (0.3 * mm)) ** 2) * G.window(z, z0, z1, 0.3 * mm)
        return h
    return 0 * th * z


def tier_feats(spec, tier):
    """-> (geometry features, normal-map features) for this tier."""
    geo, nm = [], []
    for f in spec["features"]:
        T = f["type"]
        if T in NM_ONLY:
            nm.append(f); continue
        if T in ("band", "panel") and tier == 2:
            continue              # LOW: axisymmetric bands/panels dropped (no rings to spend)
        if T in ("band", "panel", "petaloid", "spout"):
            geo.append(f); continue
        if T in ("ribs", "thread"):
            if tier in f.get("geo", (0,)):
                geo.append(f)
            elif T == "thread" or f.get("nm", True):
                nm.append(f)
    if tier == 2:
        nm = []
    return geo, nm


def zones_for(feats, ctx, tier=0, liquid=False):
    Z = []
    for f in feats:
        T = f["type"]
        sd = (0, 2) if f.get("inner", 0) > 0 else (0,)
        k = (1.5 if liquid else 1.0) * (1.4, 2.2, 4.0)[tier]
        if T == "band":
            Z.append((f["z"] - f["half"] - f["ramp"], f["z"] + f["half"] + f["ramp"], k * f["ramp"] / 1.2, sd))
        elif T == "panel":
            for e in (f["z0"], f["z1"]):
                Z.append((e - f["ramp"], e + f["ramp"], k * f["ramp"] / 1.2, sd))
        elif T == "ribs":
            Z.append((f["z0"] - f["ramp"], f["z0"], k * f["ramp"] / 2.5, sd)); Z.append((f["z1"], f["z1"] + f["ramp"], k * f["ramp"] / 2.5, sd))
        elif T == "petaloid":
            Z.append((-1, f["zmax"], (5.0, 6.0, 8.0)[tier] * mm * k, (0, 2)))
        elif T == "thread":
            Z.append((f["z0"], f["z1"], f["pitch"] / 6, (0,)))
        elif T == "spout":
            Z.append((ctx["z_top"] - f["zone"], ctx["z_top"] + 1, (1.5, 2.5, 4.0)[tier] * mm, (0, 1, 2)))
    return Z


# ================================================================================================== lathe
def select_rings(prof, keep, budget_rings, zones, split=None, inner_tol=2.5, side=None):
    """Adaptive ring selection: Douglas-Peucker with the smallest tolerance that fits the ring budget."""
    best = None
    for tol in np.geomspace(0.004 * mm, 3 * mm, 40):
        if split is None:
            idx = G.dp_simplify(prof, tol, keep=list(keep))
        else:
            a = G.dp_simplify(prof[:split + 1], tol, keep=[k for k in keep if k <= split])
            b = G.dp_simplify(prof[split:], tol * inner_tol, keep=[k - split for k in keep if k >= split]) + split
            idx = np.array(sorted(set(a) | set(b)))
        idx = G.densify_zones(idx, prof, zones, side) if zones else idx
        best = idx
        if len(idx) <= budget_rings:
            return idx, tol
    return best, tol


def lathe(prof_rz, nrm, seg, DN=None, DR=None, DZ=None, comp=True, v=None, shear=None, phase=0.0):
    """Revolve rings (n,2). DN/DR/DZ (n,seg) displacement along profile normal / radial / vertical."""
    n = len(prof_rz)
    k = G.area_comp(seg) if comp else 1.0
    th = phase + np.arange(seg) * G.TAU / seg
    c, s = np.cos(th), np.sin(th)
    DN = np.zeros((n, seg)) if DN is None else DN
    DR = np.zeros((n, seg)) if DR is None else DR
    DZ = np.zeros((n, seg)) if DZ is None else DZ
    verts, rings = [], []
    vi = 0
    for i in range(n):
        r, z = prof_rz[i]
        if r <= 1e-7:
            zz = z + float(np.mean(DN[i])) * nrm[i][1] + float(np.mean(DZ[i]))
            p = np.array([[0.0, 0.0, zz]])
            if shear is not None:
                p[0, :2] += shear(zz)
            verts.append(p); rings.append((vi, 1)); vi += 1
            continue
        rr = (r + DN[i] * nrm[i][0]) * k + DR[i]
        zz = z + DN[i] * nrm[i][1] + DZ[i]
        P = np.stack([rr * c, rr * s, zz], 1)
        if shear is not None:
            sx, sy = shear(zz)
            P[:, 0] += sx; P[:, 1] += sy
        verts.append(P); rings.append((vi, seg)); vi += seg
    V = np.concatenate(verts)
    F, UV = [], []
    vv = np.linspace(0, 1, n) if v is None else v
    for i in range(n - 1):
        (a0, an), (b0, bn) = rings[i], rings[i + 1]
        for j in range(seg):
            j1 = (j + 1) % seg
            u0, u1 = j / seg, (j + 1) / seg
            if an == 1 and bn == 1:
                continue
            if an == 1:
                F.append((a0, b0 + j1, b0 + j)); UV.append(((0.5 * (u0 + u1), vv[i]), (u1, vv[i + 1]), (u0, vv[i + 1])))
            elif bn == 1:
                F.append((a0 + j, a0 + j1, b0)); UV.append(((u0, vv[i]), (u1, vv[i]), (0.5 * (u0 + u1), vv[i + 1])))
            else:
                F.append((a0 + j, a0 + j1, b0 + j1, b0 + j)); UV.append(((u0, vv[i]), (u1, vv[i]), (u1, vv[i + 1]), (u0, vv[i + 1])))
    return V, F, UV, rings


def wobble_fns(spec, H, Rmax):
    wb = spec["wobble"]
    rng = np.random.default_rng(zlib.crc32(spec["name"].split("_")[0].encode()))
    ph = rng.uniform(0, G.TAU, 8)
    lean_dir = ph[0]

    def dr(th, r, z):
        f = np.clip(r / Rmax, 0, 1)
        o = wb["oval"] * f * np.cos(2 * (th - ph[1]))
        nz = wb["noise"] * f * (np.sin(3 * th + ph[2] + z / H * 5.0) + 0.7 * np.sin(4 * th + ph[3] - z / H * 8.0) +
                                0.5 * np.sin(5 * th + ph[4] + z / H * 13.0))
        return o + nz

    def shear(z):
        a = wb["lean"] * (np.asarray(z) / H) ** 2
        return (a * math.cos(lean_dir), a * math.sin(lean_dir))
    return dr, shear, rng


# ================================================================================================== blender helpers
def make_mesh(name, V, F, UV=None, smooth=True, sharp_rings=None, rings=None, mats=None, face_mat=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in V], [], [tuple(f) for f in F])
    me.update()
    if UV is not None:
        uvl = me.uv_layers.new(name="UVMap")
        flat = [c for f in UV for uv in f for c in uv]
        uvl.data.foreach_set("uv", flat)
    me.polygons.foreach_set("use_smooth", [smooth] * len(me.polygons))
    if sharp_rings and rings:
        sv = set()
        for i in sharp_rings:
            a, n = rings[i]
            if n > 1:
                for j in range(n):
                    sv.add((a + j, a + (j + 1) % n))
        att = me.attributes.new("sharp_edge", "BOOLEAN", "EDGE")
        vals = [((e.vertices[0], e.vertices[1]) in sv or (e.vertices[1], e.vertices[0]) in sv) for e in me.edges]
        att.data.foreach_set("value", vals)
    if mats:
        for m in mats:
            me.materials.append(m)
        if face_mat is not None:
            me.polygons.foreach_set("material_index", face_mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def principled(name, color, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = color
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


def nm_image(name, Hgt, S_u_m, S_v_m):
    """Height field (rows = v from 0 bottom, cols = u) in metres -> tangent-space normal map image (packed)."""
    Hh, W = Hgt.shape
    dxu = np.maximum(S_u_m, 1e-4)[:, None] / W            # metres per pixel along u (per row: 2*pi*r)
    dxv = S_v_m / Hh
    gx = (np.roll(Hgt, -1, 1) - np.roll(Hgt, 1, 1)) / (2 * dxu)
    gy = np.gradient(Hgt, axis=0) / dxv
    n = np.stack([-gx, -gy, np.ones_like(gx)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    rgba = np.concatenate([n * 0.5 + 0.5, np.ones((Hh, W, 1))], -1).astype(np.float32)
    img = bpy.data.images.new(name, W, Hh, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(rgba.ravel())
    img.file_format = "PNG"
    img.pack()
    return img


def bake_profile_nm(name, prof, side, feats, ctx, res, sides=(0,)):
    """Normal map over a lathe UV (u = theta, v = arc length / total) for features on profile sides `sides`."""
    if not feats:
        return None
    W, Hh = res
    s = G.arclen(prof); S = s[-1]
    sv = (np.arange(Hh) + 0.5) / Hh * S
    r = np.interp(sv, s, prof[:, 0]); z = np.interp(sv, s, prof[:, 1])
    sd = side[np.clip(np.searchsorted(s, sv), 0, len(side) - 1)]
    th = (np.arange(W) + 0.5) / W * G.TAU
    Hgt = np.zeros((Hh, W))
    m = np.isin(sd, sides)
    if not m.any():
        return None
    for f in feats:
        Hgt[m] += feat_height(f, th[None, :], z[m, None], r[m, None], ctx)
    if not np.any(np.abs(Hgt) > 1e-7):
        return None
    return nm_image(name, Hgt, G.TAU * r, S)


def glass_material(spec, tier, img):
    gd = spec["glass_def"]
    m = principled("Glass", gd["tint"], rough=gd["rough"])
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Transmission Weight"].default_value = 1.0
    b.inputs["IOR"].default_value = gd["ior"]
    if img is not None:
        tx = nt.nodes.new("ShaderNodeTexImage"); tx.image = img; tx.interpolation = "Linear"
        nmn = nt.nodes.new("ShaderNodeNormalMap"); nmn.inputs["Strength"].default_value = 1.0
        nt.links.new(tx.outputs["Color"], nmn.inputs["Color"]); nt.links.new(nmn.outputs["Normal"], b.inputs["Normal"])
    if tier < 2:
        # KHR_materials_volume through the exporter's "glTF Material Output" group + a Volume Absorption node
        grp = bpy.data.node_groups.get("glTF Material Output")
        if grp is None:
            grp = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
            grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
            grp.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
            grp.nodes.new("NodeGroupInput"); grp.nodes.new("NodeGroupOutput")
        gn = nt.nodes.new("ShaderNodeGroup"); gn.node_tree = grp
        gn.inputs["Thickness"].default_value = spec["wall"]["body"]
        va = nt.nodes.new("ShaderNodeVolumeAbsorption")
        at = gd["atten"]
        va.inputs["Color"].default_value = (0.5 + 0.5 * at[0], 0.5 + 0.5 * at[1], 0.5 + 0.5 * at[2], 1)   # mild: base colour already tints
        va.inputs["Density"].default_value = 1.0 / (gd["dist"] * 2.0)
        nt.links.new(va.outputs[0], nt.nodes["Material Output"].inputs["Volume"])
    return m


def cork_image():
    if "cork" in bpy.data.images:
        return bpy.data.images["cork"]
    rng = np.random.default_rng(7)
    n = 128
    a = rng.random((n, n))
    for _ in range(2):
        a = 0.5 * a + 0.125 * (np.roll(a, 1, 0) + np.roll(a, -1, 0) + np.roll(a, 1, 1) + np.roll(a, -1, 1))
    pores = (rng.random((n, n)) > 0.97).astype(float)
    v = 0.75 + 0.35 * (a - 0.5) - 0.35 * pores
    base = np.array([0.62, 0.44, 0.26])
    rgb = np.clip(base[None, None, :] * v[..., None], 0, 1)
    img = bpy.data.images.new("cork", n, n, alpha=False)
    img.pixels.foreach_set(np.concatenate([rgb, np.ones((n, n, 1))], -1).astype(np.float32).ravel())
    img.file_format = "PNG"; img.pack()
    return img


def cap_material(part, tier, img=None, glass=None):
    mk = part["mat"]
    if mk == "glass":
        return glass
    if mk == "cork":
        m = principled("Cork", (0.62, 0.45, 0.28, 1), rough=0.85)
        if tier < 2:
            nt = m.node_tree; tx = nt.nodes.new("ShaderNodeTexImage"); tx.image = cork_image()
            nt.links.new(tx.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
        return m
    m = principled(mk.capitalize(), part.get("color", (0.5, 0.5, 0.5, 1)), rough=part.get("rough", 0.4), metal=part.get("metal", 0.0))
    if mk == "wire":
        m.node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = 1.0
        m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.3
    if img is not None:
        nt = m.node_tree
        tx = nt.nodes.new("ShaderNodeTexImage"); tx.image = img
        nmn = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(tx.outputs["Color"], nmn.inputs["Color"]); nt.links.new(nmn.outputs["Normal"], nt.nodes["Principled BSDF"].inputs["Normal"])
    return m


# ================================================================================================== build
def build(name_arg, tiers=(0, 1, 2)):
    spec = get_spec(name_arg)
    name = spec["name"]
    t0 = time.time()
    P = make_profile(spec)
    shell, side = P["shell"], P["side"]
    snrm = G.normals2d(shell)
    s_shell = G.arclen(shell)
    H = P["z_top"]
    first_body = next(k for k in spec["outer"] if not isinstance(k, str))
    ctx = dict(body_r=P["body_r"], z_top=H, heel_z=first_body[1] * 0.4)
    wdr, shear, rng = wobble_fns(spec, H, P["body_r"])
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(os.path.join(ROOT, "src", "v2"), exist_ok=True)
    results = {}
    z_shift = None
    lut_info = None
    # outer finish/neck points for caps
    outer = P["outer"]
    zmin_fin = min(P["z_f"] - 25 * mm, spec["cap"].get("z0", 1e9) - 2 * mm)
    fin = outer[outer[:, 1] >= zmin_fin]
    fin = fin[np.argsort(fin[:, 1], kind="stable")]
    thr = [f for f in spec["features"] if f["type"] == "thread"]
    gctx = dict(z_top=H, r_lip=P["r_lip"], r_bore=P["r_bore"], outer=fin, z_bague=P["z_bague"],
                z_thread0=thr[0]["z0"] if thr else P["z_f"], r_thread=(float(np.interp(thr[0]["z0"] + 2 * mm, fin[:, 1], fin[:, 0])) + thr[0]["height"]) if thr else P["r_lip"])
    pet = [f for f in spec["features"] if f["type"] == "petaloid"]
    for tier in tiers:
        T = TIERS[tier]
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o)
        for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
            for d in list(coll):
                coll.remove(d)
        seg = spec["seg"][tier]
        geo, nmf = tier_feats(spec, tier)
        zones = zones_for(geo, ctx, tier)
        # ---------------- glass rings
        budget = T["glass"] // (2 * seg)
        split = P["n_outer"] + P["n_lip"] - 1
        idx, tol = select_rings(shell, P["keep"], budget, zones, split=split, inner_tol=T["inner_tol"], side=side)
        R = shell[idx]; N = snrm[idx]; sd = side[idx]
        th = np.arange(seg) * G.TAU / seg
        DN = np.zeros((len(idx), seg)); DR = np.zeros((len(idx), seg))
        zc, rc = R[:, 1:2], R[:, 0:1]
        for f in geo:
            if f["type"] == "spout":
                w = np.exp(-0.5 * (G.wrap_pi(th - math.radians(f["theta"])) / math.radians(f["width"] / 2)) ** 2)[None, :]
                DR += f["out"] * w * G.smoothstep(H - f["zone"], H, zc) ** 2
                continue
            h = feat_height(f, th[None, :], zc, rc, ctx)
            wt = np.where(sd == 0, 1.0, np.where(sd == 2, -f.get("inner", 0.0), 0.0))[:, None]
            if f["type"] == "thread":
                wt = np.where(sd == 0, 1.0, 0.0)[:, None]
            DN += h * wt
        DR += wdr(th[None, :], rc, zc)
        sharp = [i for i, k in enumerate(idx) if k in P["corners"]]
        Vg, Fg, UVg, rings_g = lathe(R, N, seg, DN=DN, DR=DR, v=s_shell[idx] / s_shell[-1], shear=shear)
        if z_shift is None:
            z_shift = float(Vg[:, 2].min())
        Vg[:, 2] -= z_shift
        # ---------------- liquid
        liq_seg = max(12, int(round(seg * 2 / 3 / 4)) * 4) if tier < 2 else 12
        if pet:
            n5 = pet[0]["n"]; liq_seg = max(n5 * 2, int(round(liq_seg / n5)) * n5)
        caps_parts, insert = CAPS.build(spec, gctx, tier, np.random.default_rng(zlib.crc32(name.encode()) + 1))
        z_lt = H - max(spec["closure_depth"], insert + 1 * mm)
        lq = G.offset_inward(P["inner_up"], np.full(len(P["inner_up"]), GAP))
        k0 = np.flatnonzero(lq[:, 0] >= 0)[0]
        lq = np.vstack([[0.0, lq[k0, 1]], lq[k0:]]) if lq[0, 0] != 0 else lq
        lq[0, 0] = 0.0
        kk = np.flatnonzero(lq[:, 1] <= z_lt)
        last = kk[-1]
        lq = lq[:last + 1]
        lq = np.vstack([lq, [[lq[-1, 0], z_lt]], [[0.0, z_lt]]])
        lq = np.vstack([G.resample(lq[:-1], 0.25 * mm), lq[-1:]])
        lnrm = G.normals2d(lq)
        lzones = zones_for([f for f in geo if f.get("inner", 0) > 0], ctx, tier, liquid=True)
        lidx, _ = select_rings(lq, [0, len(lq) - 2, len(lq) - 1], T["liquid"] // (2 * liq_seg), lzones)
        LR = lq[lidx]; LN = lnrm[lidx]
        lth = np.arange(liq_seg) * G.TAU / liq_seg
        LDN = np.zeros((len(lidx), liq_seg))
        for f in geo:
            inn = f.get("inner", 0.0)
            if inn <= 0 or f["type"] in ("spout", "thread"):
                continue
            if f["type"] == "ribs":   # envelope: full-depth dent all around (liquid seg is coarser than the ribs)
                h = min(f["depth"], 0) * G.window(LR[:, 1:2], f["z0"], f["z1"], f["ramp"]) + 0 * lth[None, :]
            else:
                h = feat_height(f, lth[None, :], LR[:, 1:2], LR[:, 0:1], ctx)
            if f["type"] == "petaloid":
                h = h * 1.0
            LDN += h * inn
        LDN[-1] = 0; LDN[-2] = np.minimum(LDN[-2], 0)
        LDR = wdr(lth[None, :], LR[:, 0:1], LR[:, 1:2])
        Vl, Fl, _, _ = lathe(LR, LN, liq_seg, DN=LDN, DR=LDR, shear=shear)
        Vl[:, 2] -= z_shift
        # ---------------- LUT (from the HIGH liquid mesh, shared by all tiers)
        if lut_info is None:
            x, y, z, w = LUT.point_cloud(Vl, Fl)
            az = (0.0, math.pi / pet[0]["n"]) if pet else (0.0,)
            vol = LUT.mesh_volume(Vl, LUT.triangulate(Fl))
            lut = LUT.lut_from_cloud(x, y, z, w, azimuths=az, V=w.sum())
            lut_info = dict(lut=lut, V=vol, Vc=w.sum(), z0=float(Vl[:, 2].min()), z1=float(Vl[:, 2].max()))
            # graduations (upright volume -> height)
            gr = [f for f in spec["features"] if f["type"] == "grad"]
            if gr:
                f = gr[0]
                o = np.argsort(z); cum = np.cumsum(w[o]) * vol / w.sum()
                ctx["grad_z"] = [(float(np.interp(ml * 1e-6, cum, z[o])) + z_shift, ml % f["major"] == 0)
                                 for ml in range(f["first"], f["last"] + 1, f["step"])]
            # v1 slicing LUT on the same liquid profile (cross-check; differs on punts by design)
            try:
                lp = [(float(a), float(b) - z_shift) for a, b in LR]
                lut1, v1ml, _, _ = V1.volume_lut(lp)
                lut_info["v1_diff_mm"] = float(np.abs(lut1 - lut).max() * 1000)
                lut_info["v1_ml"] = float(v1ml)
            except Exception as e:
                lut_info["v1_diff_mm"] = None
        vol_t = LUT.mesh_volume(Vl, LUT.triangulate(Fl))
        xt, yt, zt_, wt_ = LUT.point_cloud(Vl, Fl, ng=64, nz=160)
        fill_err = LUT.fill_error(xt, yt, zt_, wt_ * (vol_t / wt_.sum()), lut_info["lut"], lut_info["V"])
        # ---------------- textures + materials
        gimg = None
        if T["nm"] is not None:
            nm_feats = [f for f in nmf]
            if nm_feats:
                prof_shift = shell.copy()
                gimg = bake_profile_nm("glass_nm", prof_shift, side, nm_feats, ctx, T["nm"], sides=(0,))
        gmat = glass_material(spec, tier, gimg)
        glass = make_mesh("Glass", Vg, Fg, UVg, sharp_rings=sharp, rings=rings_g, mats=[gmat])
        lmat = principled("Liquid", tuple(spec["liquid"]), rough=0.05)
        liq = make_mesh("Liquid", Vl, Fl, mats=[lmat])
        info = {"version": 1, "axis": "Y", "capacity_ml": round(lut_info["V"] * 1e6, 1),
                "z0": round(lut_info["z0"], 5), "z1": round(lut_info["z1"], 5), "n_cos": LUT.N_COS, "n_fill": LUT.N_FILL,
                "color": list(spec["liquid"]), "carbonation": spec.get("carbonation", 0.0), "foam": spec.get("foam", 0.0),
                "foam_height": spec.get("foam_height", 0.022), "bubble_size": spec.get("bubble_size", 1.0),
                "lut": [[round(v, 5) for v in row] for row in lut_info["lut"].tolist()]}
        liq["liquid"] = json.dumps(info)
        if tier == 0:
            with open(os.path.join(OUT, f"bottle_{name}.liquid.json"), "w", encoding="utf-8") as fh:
                fh.write(liq["liquid"])
        # ---------------- caps
        nodes = {}
        cseg = T["cap_seg"]
        for pi, part in enumerate(caps_parts):
            if "prof" in part:
                pr = np.array(part["prof"], float)
                pr = G.resample(pr, 0.3 * mm) if tier < 2 else pr
                pr_dense = pr; s_dense = G.arclen(pr)
                pseg = part.get("seg", seg) if tier == 0 else seg
                tot_len = sum(G.arclen(np.array(p["prof"], float))[-1] for p in caps_parts if "prof" in p)
                cap_budget = (1300, 560, 240)[tier] * s_dense[-1] / max(tot_len, 1e-9)
                ii, _ = select_rings(pr, [0, len(pr) - 1], max(4, int(cap_budget // (2 * pseg))), [])
                pr = pr[ii]
                pn = G.normals2d(pr)
                cth = np.arange(pseg) * G.TAU / pseg
                DRc = part["dr"](cth[None, :], pr[:, 0:1], pr[:, 1:2]) if "dr" in part else None
                DZc = part["dz"](cth[None, :], pr[:, 0:1], pr[:, 1:2]) if "dz" in part else None
                V_, F_, UV_, _ = lathe(pr, pn, pseg, DR=DRc, DZ=DZc, comp=True, v=s_dense[ii] / max(s_dense[-1], 1e-9), shear=shear)
                img = None
                if "nm" in part and T["nm"] is not None:
                    img = bake_profile_nm(f"cap_nm_{pi}", pr_dense,
                                          np.zeros(len(pr_dense), int), [dict(type="_fn", fn=part["nm"])], ctx,
                                          (512, 128) if tier == 0 else (256, 64))
            else:
                V_, F_ = part["verts"].copy(), part["faces"]
                UV_ = None; img = None
                sh = shear(V_[:, 2]); V_[:, 0] += sh[0]; V_[:, 1] += sh[1]
            V_[:, 2] -= z_shift
            node = part["node"]
            if tier == 2 and node in ("Bail", "Cage"):
                node = "Cap"
            if tier == 2 and node == "GlassCap":
                node = "Glass"
            mat = cap_material(part, tier, img, glass=gmat)
            nodes.setdefault(node, []).append((V_, F_, UV_, mat))
        stand = spec.get("stand")
        if stand:
            sp = [(stand["r_center"] + stand["r_tube"] * math.cos(a), stand["z"] + stand["r_tube"] * math.sin(a))
                  for a in np.linspace(-math.pi, math.pi, 17 if tier < 2 else 7)]
            sp = np.array(sp)
            Vs, Fs, UVs, _ = lathe(sp, G.normals2d(sp), cseg, comp=False)
            nodes.setdefault("Stand", []).append((Vs, Fs, UVs, cap_material(dict(mat="cork"), tier)))
        # merge parts per node
        node_stats = {}
        for node, parts in nodes.items():
            mats, Vall, Fall, UVall, fm = [], [], [], [], []
            off = 0
            for V_, F_, UV_, mat in parts:
                if mat not in mats:
                    mats.append(mat)
                mi = mats.index(mat)
                Vall.append(V_); Fall += [tuple(i + off for i in f) for f in F_]
                UVall += UV_ if UV_ is not None else [tuple((0.5, 0.5) for _ in f) for f in F_]
                fm += [mi] * len(F_)
                off += len(V_)
            if node == "Glass":    # LOW: glass stopper merged into the glass mesh
                gme = glass.data
                base_v = len(gme.vertices)
                Vc = np.concatenate([np.array([v.co[:] for v in gme.vertices])] + Vall)
                Fc = [tuple(p.vertices) for p in gme.polygons] + [tuple(i + base_v for i in f) for f in Fall]
                uvl = gme.uv_layers[0].data
                UVc = []
                for p in gme.polygons:
                    UVc.append(tuple(tuple(uvl[li].uv) for li in p.loop_indices))
                UVc += UVall
                bpy.data.objects.remove(glass)
                glass = make_mesh("Glass", Vc, Fc, UVc, mats=[gmat])
                continue
            ob = make_mesh(node, np.concatenate(Vall), Fall, UVall, mats=mats, face_mat=fm)
            import bmesh
            bm = bmesh.new(); bm.from_mesh(ob.data)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bm.to_mesh(ob.data); bm.free()
        glass["bv2"] = json.dumps({"bottle": name, "tier": T["name"], "spec": "scripts/bottle_specs_v2.py",
                                   "label_zone": [round(z - z_shift, 4) for z in spec["label_zone"]] if spec.get("label_zone") else None,
                                   "label_panel": bool(spec.get("label_panel", False)), "z_top": round(H - z_shift, 4),
                                   "r_bore": round(P["r_bore"], 5), "glass": spec["glass"]})
        # ---------------- export
        bpy.ops.object.select_all(action="SELECT")
        out = os.path.join(OUT, f"bottle_{name}{T['suffix']}.glb")
        bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_extras=True, export_yup=True,
                                  export_apply=True, use_selection=True)
        tri = {}
        for ob in bpy.data.objects:
            if ob.type == "MESH":
                tri[ob.name] = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        mats_n = len({m.name for ob in bpy.data.objects if ob.type == "MESH" for m in ob.data.materials})
        dcalls = sum(len(ob.data.materials) for ob in bpy.data.objects if ob.type == "MESH")
        results[T["name"]] = dict(file=os.path.relpath(out, ROOT).replace("\\", "/"), tris=sum(tri.values()), nodes=tri,
                                  materials=mats_n, draw_calls=dcalls, glass_rings=len(idx), seg=seg, liquid_seg=liq_seg,
                                  ring_tol_mm=round(tol * 1000, 4), volume_err_pct=round((vol_t - lut_info["V"]) / lut_info["V"] * 100, 3),
                                  fill_err_pct=round(fill_err, 3), normal_map=gimg is not None)
        if tier == 0:
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "src", "v2", f"bottle_{name}.blend"), copy=True)
            # profile sidecar for fracture / label tools
            outer_r = shell[idx][sd == 0]; inner_r = shell[idx][sd == 2]
            prof = dict(name=name, units="m", axis="Z (glTF Y)", z_shift=-z_shift,
                        outer=[[round(a, 5), round(b - z_shift, 5)] for a, b in outer_r],
                        lip=[[round(a, 5), round(b - z_shift, 5)] for a, b in shell[idx][sd == 1]],
                        inner=[[round(a, 5), round(b - z_shift, 5)] for a, b in inner_r[::-1]],
                        liquid=[[round(a, 5), round(b - z_shift, 5)] for a, b in LR],
                        label_zone=[round(z - z_shift, 4) for z in spec["label_zone"]] if spec.get("label_zone") else None,
                        label_panel=bool(spec.get("label_panel", False)), z_top=round(H - z_shift, 5),
                        r_bore=P["r_bore"], wall=spec["wall"], glass=spec["glass"], glass_options=spec.get("glass_options"),
                        cap=spec["cap"]["type"], capacity_ml=round(lut_info["V"] * 1e6, 1))
            json.dump(prof, open(os.path.join(OUT, f"bottle_{name}.profile.json"), "w"), indent=0)
        print(f"BV2 {name} {T['name']}: tris={sum(tri.values())} {tri} mats={mats_n} dc={dcalls} rings={len(idx)}x{seg} "
              f"tol={tol*1000:.3f}mm vol_err={results[T['name']]['volume_err_pct']}% fill_err={fill_err:.2f}% nm={gimg is not None}")
    ml = lut_info["V"] * 1e6
    print(f"BV2 {name} done {time.time()-t0:.1f}s capacity={ml:.0f}ml (ref {spec.get('ref_ml')}) height={(H - z_shift)*1000:.1f}mm "
          f"v1-slicing-LUT diff={lut_info.get('v1_diff_mm')}mm v1_ml={lut_info.get('v1_ml')}")
    return dict(id=f"bottle_v2_{name}", family="bottle_v2", file=f"export/v2/bottle_{name}.glb",
                lod1=f"export/v2/bottle_{name}_lod1.glb", lod2=f"export/v2/bottle_{name}_lod2.glb",
                liquid_sidecar=f"export/v2/bottle_{name}.liquid.json", profile=f"export/v2/bottle_{name}.profile.json",
                capacity_ml=round(ml), height_m=round(H - z_shift, 4), glass=spec["glass"], desc=spec["desc"],
                tiers={k: dict(tris=v["tris"], draw_calls=v["draw_calls"], materials=v["materials"]) for k, v in results.items()},
                license="MIT"), results


# patch: feature type "_fn" (cap normal maps) evaluated through feat_height
_feat_height = feat_height


def feat_height(f, th, z, r, ctx):   # noqa: F811
    if f["type"] == "_fn":
        return f["fn"](th, z, r) + 0 * th * z
    return _feat_height(f, th, z, r, ctx)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    tiers = (0, 1, 2)
    cat = True
    names = []
    i = 0
    while i < len(argv):
        if argv[i] == "--tiers":
            tiers = tuple(int(x) for x in argv[i + 1].split(",")); i += 2
        elif argv[i] == "--no-catalog":
            cat = False; i += 1
        else:
            names.append(argv[i]); i += 1
    names = names or NAMES
    entries, allres = [], {}
    for n in names:
        e, r = build(n, tiers)
        entries.append(e); allres[e["id"]] = r
    json.dump(allres, open(os.path.join(ROOT, "tests", "out", "bv2_build_stats.json") if os.path.isdir(os.path.join(ROOT, "tests", "out")) else "bv2_build_stats.json", "w"), indent=1)
    if cat and tiers == (0, 1, 2):
        cat_path = os.path.join(ROOT, "catalog.json")
        c = json.load(open(cat_path, encoding="utf-8"))     # re-read right before writing (shared file)
        have = {a["id"]: a for a in c["assets"]}
        for e in entries:
            have[e["id"]] = {**have.get(e["id"], {}), **e}
        c["assets"] = sorted(have.values(), key=lambda a: a["id"])
        json.dump(c, open(cat_path, "w", encoding="utf-8"), indent=2)
    print("BV2 done", len(entries))
