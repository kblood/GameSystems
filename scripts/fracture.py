"""Pre-fractured shard assets + neck-snapped 'broken' variants for the reusable bottles.

Run:  blender.exe -b --python fracture.py -- [name ...]      (no names = all; re-running overwrites)
Output (../export): bottle_<n>_shards.glb, bottle_<n>_broken.glb, bottle_<n>_break.json ; ../src/bottle_<n>_shards.blend
Soda (PET) never shatters: only bottle_soda_broken.glb (dented + holed) and bottle_soda_break.json.

Method: seeds (denser near an impact point, sparse at base/neck) on the mid-wall surface -> convex Voronoi cells
(cube clipped by bisector planes, each shifted 0.1 mm so neighbouring shards are 0.2 mm apart) -> Exact boolean
INTERSECT of each cell with the intact Glass shell -> loose parts -> shards (origin = centroid, node transform
puts them back in the bottle-local frame).  Fixed RNG seed per bottle -> reproducible.
Does not import-modify scripts/bottles.py; it only re-uses its lathe()/material()/BOTTLES helpers.
"""
import bpy, bmesh, sys, os, json, math, random
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bottles as B  # noqa: E402  (only defines helpers; build() is not called)

ROOT = B.ROOT
DENSITY = 2500.0
GAP = 0.0001            # each cell plane shifted 0.1 mm -> 0.2 mm between shards
TARGET = {"wine": 24, "beer": 22, "whiskey": 22, "jar": 20, "flask": 20}      # voronoi seeds (shards come out ~ +20%)
IMPACT_FRAC = {"wine": 0.5, "beer": 0.5, "whiskey": 0.5, "jar": 0.5, "flask": 0.45}  # impact z as fraction of shoulder_z
# neck-snap cut: mean z, tooth amplitude (m)
BREAK = {"wine": (0.118, 0.014), "beer": (0.092, 0.011), "whiskey": (0.150, 0.008),
         "jar": (0.108, 0.006), "flask": (0.135, 0.007)}
LIQ_KG_ML = {"wine": 0.00099, "beer": 0.00101, "soda": 0.00104, "whiskey": 0.00094, "jar": 0.00120, "flask": 0.00100}
SEEDVAL = {"wine": 11, "beer": 23, "whiskey": 37, "jar": 41, "flask": 53, "soda": 67}


# ----------------------------------------------------------------------------------------------- scene helpers
def reset():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)


def build_parts(name, spec):
    """Same Glass / Liquid / Cap / Label as bottles.build (without exporting)."""
    outer, wall = spec["outer"], spec["wall"]
    lip_r, lip_z = outer[-1]
    kind, cap_r, cap_z0, cap_z1 = spec["cap"]
    z_top = lip_z - 0.004 if kind == "cork" else lip_z - 0.002
    inner = B.inner_profile(outer, wall, z_top)
    shell = list(outer) + [(inner[-1][0], lip_z)] + [(r, z) for r, z in reversed(inner[1:])] + [(0.0, wall)]
    glass = B.lathe("Glass", shell)
    gmat = B.material("Glass", spec["glass"], rough=0.03, transmission=1.0, ior=1.5)
    glass.data.materials.append(gmat)
    liq_prof = [(0.0, inner[0][1] + 0.0004)] + [(max(r - 0.0004, 0.0003), z) for r, z in inner[1:-1]] \
        + [(max(inner[-1][0] - 0.0004, 0.0003), z_top - 0.002), (0.0, z_top - 0.002)]
    liq = B.lathe("Liquid", liq_prof)
    liq.data.materials.append(B.material("Liquid", spec["liquid"], rough=0.05, transmission=0.0))
    with open(os.path.join(ROOT, "export", f"bottle_{name}.liquid.json"), encoding="utf-8") as fh:
        liq["liquid"] = fh.read()                     # identical extras as the intact bottle
    cm = {"cork": ((0.62, 0.45, 0.28, 1), 0.9, 0.0), "crown": ((0.55, 0.55, 0.58, 1), 0.35, 1.0),
          "screw": ((0.12, 0.12, 0.14, 1), 0.4, 0.0)}[kind]
    if kind == "cork":
        cap = B.lathe("Cap", [(0, cap_z0), (cap_r, cap_z0), (cap_r, cap_z1 - 0.003), (cap_r * 0.97, cap_z1), (0, cap_z1)])
    elif kind == "crown":
        cap = B.lathe("Cap", [(0, cap_z0), (cap_r, cap_z0), (cap_r, cap_z0 + 0.006), (cap_r * 0.9, cap_z1), (0, cap_z1)])
    else:
        cap = B.lathe("Cap", [(0, cap_z0), (cap_r, cap_z0), (cap_r, cap_z1 - 0.002), (cap_r - 0.002, cap_z1), (0, cap_z1)])
    cap.data.materials.append(B.material("Cap", cm[0], rough=cm[1], metal=cm[2]))
    lab = None
    if spec["label"]:
        z0, z1, _, col = spec["label"]
        oz = [z for r, z in outer]
        body_r = max(float(np.interp(z, oz, [r for r, z in outer])) for z in np.linspace(z0, z1, 12))
        lab = B.lathe("Label", [(body_r + 0.0006, z0), (body_r + 0.0006, z1)], arc=math.radians(300))
        lab.data.materials.append(B.material("Label", col, rough=0.7))
        mod = lab.modifiers.new("Solid", "SOLIDIFY"); mod.thickness = 0.0003
        bpy.context.view_layer.objects.active = lab
        bpy.ops.object.modifier_apply(modifier="Solid")
    return dict(glass=glass, liquid=liq, cap=cap, label=lab, gmat=gmat, lip_z=lip_z, wall=wall)


def volume(mesh):
    bm = bmesh.new(); bm.from_mesh(mesh)
    v = abs(bm.calc_volume())
    bm.free()
    return v


def boolean(a, b, op):
    """Exact boolean of objects a (op) b -> new mesh datablock (a is unchanged)."""
    m = a.modifiers.new("bool", "BOOLEAN"); m.object = b; m.operation = op; m.solver = "EXACT"
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(a.evaluated_get(dg))
    a.modifiers.remove(m)
    return me


def link(name, mesh, mat=None, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    if mat is not None and not mesh.materials:
        mesh.materials.append(mat)
    return o


def profile_zones(spec):
    """base_z (top of base zone), shoulder_z (body ends), neck_z (neck starts), in metres."""
    o = np.array(spec["outer"]); r, z = o[:, 0], o[:, 1]
    rmax = r.max()
    zz = np.linspace(0, z.max(), 800)
    order = np.argsort(z, kind="stable")
    rr = np.interp(zz, z[order], r[order])
    ok = rr >= 0.9 * rmax
    i0 = int(np.argmax(ok))
    i1 = i0 + int(np.argmin(ok[i0:])) if not ok[i0:].all() else len(zz) - 1
    base_z = max(float(zz[i0]), 0.012)
    shoulder_z = float(zz[i1])
    above = zz > shoulder_z
    rmin = float(rr[above].min())
    neck_z = float(zz[above][np.argmax(rr[above] <= 1.12 * rmin)])
    neck_z = min(max(neck_z, shoulder_z + 0.008), spec["outer"][-1][1] - 0.006)
    return base_z, shoulder_z, neck_z


# ----------------------------------------------------------------------------------------------- seeds / cells
def surface_sampler(spec, rng):
    o = spec["outer"]; wall = spec["wall"]
    segs = []
    for (r0, z0), (r1, z1) in zip(o[:-1], o[1:]):
        L = math.hypot(r1 - r0, z1 - z0)
        if L < 1e-6:
            continue
        area = 2 * math.pi * 0.5 * (r0 + r1) * L
        n = np.array([(z1 - z0) / L, -(r1 - r0) / L])             # outward normal (r,z)
        segs.append((area, r0, z0, r1, z1, n))
    w = np.array([s[0] for s in segs]); w = w / w.sum()

    def sample():
        k = rng.choices(range(len(segs)), weights=w)[0]
        _, r0, z0, r1, z1, n = segs[k]
        u = rng.random()
        t = u if abs(r1 - r0) < 1e-9 else (-r0 + math.sqrt(r0 * r0 + u * (r1 * r1 - r0 * r0))) / (r1 - r0)
        r = r0 + t * (r1 - r0) - n[0] * wall * 0.5
        z = z0 + t * (z1 - z0) - n[1] * wall * 0.5
        th = rng.random() * 2 * math.pi
        return Vector((max(r, 0.0) * math.cos(th), max(r, 0.0) * math.sin(th), max(z, wall * 0.5)))
    return sample


def make_seeds(name, spec, rng, zones):
    base_z, shoulder_z, neck_z = zones
    sample = surface_sampler(spec, rng)
    r_body = max(r for r, z in spec["outer"]) - spec["wall"] * 0.5
    zi = IMPACT_FRAC[name] * shoulder_z
    impact = Vector((r_body * 0.0 + max(np.interp(zi, [z for r, z in spec["outer"]], [r for r, z in spec["outer"]]), 0.01)
                     - spec["wall"] * 0.5, 0.0, zi))
    dmax = 0.12
    target = TARGET[name]
    best = None
    k = 0.55
    while k < 6:
        st = random.Random(SEEDVAL[name] * 1000 + int(k * 100))
        rng.setstate(st.getstate())
        pts = [impact.copy()]; sp = [0.0045 * k]
        for _ in range(9000):
            p = sample()
            d = (p - impact).length
            s = k * (0.0045 + 0.052 * min(d / dmax, 1.0) ** 0.9)
            if p.z < base_z:
                s *= 1.5
            elif p.z > neck_z:
                s *= 2.0
            if all((p - q).length > 0.5 * (s + sq) for q, sq in zip(pts, sp)):
                pts.append(p); sp.append(s)
        best = pts
        if len(pts) <= target:
            break
        k *= 1.04
    # a base-centre seed keeps the base in one or two big pieces
    if not any(math.hypot(p.x, p.y) < 0.012 and p.z < base_z for p in best):
        best.append(Vector((0.0, 0.0, spec["wall"] * 0.5)))
    return best, impact


def voronoi_cell(i, seeds, R=0.25):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2 * R)
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=seeds[i])
    si = seeds[i]
    # nearest planes first -> fewer big intermediate faces
    order = sorted((j for j in range(len(seeds)) if j != i), key=lambda j: (seeds[j] - si).length)
    for j in order:
        d = seeds[j] - si
        n = d.normalized()
        co = (si + seeds[j]) * 0.5 - n * GAP
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=n, clear_outer=True, use_snap_center=False)
        bd = [e for e in bm.edges if e.is_boundary]
        if bd:
            bmesh.ops.holes_fill(bm, edges=bd, sides=len(bd))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for f in bm.faces:
        f.smooth = False
    me = bpy.data.meshes.new(f"cell{i}")
    bm.to_mesh(me); bm.free()
    return me


def islands(mesh):
    """Split mesh into connected face islands -> list of bmesh."""
    bm = bmesh.new(); bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    seen = set(); out = []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack = [f]; grp = []
        seen.add(f.index)
        while stack:
            c = stack.pop(); grp.append(c)
            for e in c.edges:
                for g in e.link_faces:
                    if g.index not in seen:
                        seen.add(g.index); stack.append(g)
        out.append(grp)
    res = []
    for grp in out:
        nb = bmesh.new()
        vm = {}
        lay = bm.faces.layers
        for f in grp:
            vs = []
            for v in f.verts:
                if v.index not in vm:
                    vm[v.index] = nb.verts.new(v.co)
                vs.append(vm[v.index])
            nf = nb.faces.new(vs)
            nf.smooth = f.smooth; nf.material_index = f.material_index
        res.append(nb)
    bm.free()
    return res


def make_shards(name, spec, parts, rng, zones):
    glass = parts["glass"]; gmat = parts["gmat"]
    seeds, impact = make_seeds(name, spec, rng, zones)
    total_v = volume(glass.data)
    shards = []
    for i in range(len(seeds)):
        cm = voronoi_cell(i, seeds)
        cm.materials.append(gmat)
        cobj = link("cell", cm)
        me = boolean(glass, cobj, "INTERSECT")
        bpy.data.objects.remove(cobj); bpy.data.meshes.remove(cm)
        for nb in islands(me):
            bmesh.ops.recalc_face_normals(nb, faces=nb.faces[:])
            v = nb.calc_volume()
            if abs(v) < 4e-9:                       # < 4 mm^3: dust, drop
                nb.free(); continue
            shards.append((nb, abs(v), i))
        bpy.data.meshes.remove(me)
    shards.sort(key=lambda t: -t[1])
    vsum = sum(s[1] for s in shards)
    objs = []; stats = []
    for k, (nb, v, ci) in enumerate(shards):
        co = np.array([vv.co[:] for vv in nb.verts])
        c = Vector(co.mean(axis=0).tolist())
        bmesh.ops.translate(nb, verts=nb.verts[:], vec=-c)
        bmesh.ops.triangulate(nb, faces=nb.faces[:])
        me = bpy.data.meshes.new(f"Shard_{k:02d}")
        nb.to_mesh(me)
        ext = co.max(axis=0) - co.min(axis=0)
        rad = float(np.linalg.norm(co - np.array(c), axis=1).max())
        nb.free()
        me.materials.append(gmat)
        o = link(f"Shard_{k:02d}", me, loc=c)
        mf = v / vsum
        s = np.sort(ext)[::-1]
        flat = float(s[2])
        cls = "chunk" if mf >= 0.06 else ("sliver" if (mf < 0.004 or s[0] > 3.2 * s[1]) else "shard")
        o["mass_fraction"] = float(mf)
        o["radius"] = rad
        o["class"] = cls
        o["volume_m3"] = float(v)
        o["mass_kg"] = float(v * DENSITY)
        o["dist_impact"] = float((c - impact).length)
        objs.append(o)
        stats.append(dict(name=o.name, mass_fraction=mf, radius=rad, cls=cls, tris=len(me.polygons)))
    return objs, stats, total_v, vsum, seeds, impact


def export(path, objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_extras=True, export_yup=True,
                              export_apply=True, use_selection=True)


# ----------------------------------------------------------------------------------------------- broken variants
def cutter_mesh(zs, thetas, shift, rin=0.005, R=0.09, ztop=0.5):
    bm = bmesh.new()
    n = len(thetas)
    A = []; Bv = []; C = []; D = []
    for th, z in zip(thetas, zs):
        c, s = math.cos(th), math.sin(th)
        A.append(bm.verts.new((rin * c, rin * s, z + shift)))
        Bv.append(bm.verts.new((R * c, R * s, z + shift)))
        C.append(bm.verts.new((R * c, R * s, ztop)))
        D.append(bm.verts.new((rin * c, rin * s, ztop)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((A[i], Bv[i], Bv[j])); bm.faces.new((A[i], Bv[j], A[j]))
        bm.faces.new((Bv[i], C[i], C[j], Bv[j])); bm.faces.new((C[i], D[i], D[j], C[j]))
        bm.faces.new((D[i], A[i], A[j], D[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new("cutter"); bm.to_mesh(me); bm.free()
    return me


def jag(name, rng):
    z0, amp = BREAK[name]
    n = 26
    th = np.linspace(0, 2 * math.pi, n, endpoint=False) + (np.array([rng.random() for _ in range(n)]) - 0.5) * 0.55 * (2 * math.pi / n)
    zs = []
    ph = rng.random() * 6.28
    for i in range(n):
        hi = (i % 2 == 0)
        a = (0.35 + 0.65 * rng.random()) * amp * (1 if hi else -0.9)
        zs.append(z0 + a + 0.25 * amp * math.sin(th[i] + ph))
    return th.tolist(), zs


def make_broken(name, spec, parts, rng, zones, shards_info):
    glass, liq, cap, lab, gmat = parts["glass"], parts["liquid"], parts["cap"], parts["label"], parts["gmat"]
    th, zs = jag(name, rng)
    open_z = float(min(zs))
    down = link("cut_dn", cutter_mesh(zs, th, -GAP))
    up = link("cut_up", cutter_mesh(zs, th, +GAP))
    body_me = boolean(glass, down, "DIFFERENCE")
    neck_me = boolean(glass, up, "INTERSECT")
    lab_me = boolean(lab, down, "DIFFERENCE") if lab else None
    lab_mat = lab.data.materials[0] if lab else None
    bpy.data.objects.remove(down); bpy.data.objects.remove(up)
    for ob in (glass, lab):
        if ob:
            bpy.data.objects.remove(ob)
    body = link("Glass", body_me, gmat)
    nbm = bmesh.new(); nbm.from_mesh(neck_me)
    cen = Vector(np.array([v.co[:] for v in nbm.verts]).mean(axis=0).tolist())
    bmesh.ops.translate(nbm, verts=nbm.verts[:], vec=-cen)
    nbm.to_mesh(neck_me); nbm.free()
    neck = link("Neck", neck_me, gmat, loc=cen)
    out = [body, neck, liq, cap]
    bpy.context.view_layer.update()
    cap.parent = neck
    cap.matrix_parent_inverse = neck.matrix_world.inverted()
    if lab_me is not None:
        out.append(link("Label", lab_me, lab_mat))
    for o in (body, neck, liq):
        o["open_z"] = open_z
    neck["neck_z"] = zones[2]; body["neck_z"] = zones[2]
    liq["open_z"] = open_z
    path = os.path.join(ROOT, "export", f"bottle_{name}_broken.glb")
    export(path, out)
    return path, open_z, th, zs, body_me, neck_me


def make_soda(spec, rng):
    """PET bottle: dent + crumple ripples + a leak hole. No shards."""
    parts = build_parts("soda", spec)
    glass, liq, cap, lab = parts["glass"], parts["liquid"], parts["cap"], parts["label"]
    th0 = math.pi                       # label has a 60 deg gap near 330 deg; dent on the opposite side
    z0 = 0.095
    depth, sz, sa = 0.014, 0.032, 0.026
    for o in (glass, liq, lab, cap):
        me = o.data
        bm = bmesh.new(); bm.from_mesh(me)
        for _ in range(6):                                   # subdivide long edges so the dent has geometry to bend
            ed = [e for e in bm.edges if e.calc_length() > 0.0045]
            if not ed:
                break
            bmesh.ops.subdivide_edges(bm, edges=ed, cuts=1, use_grid_fill=True)
        bm.to_mesh(me); bm.free()
        n = len(me.vertices)
        co = np.zeros(n * 3); me.vertices.foreach_get("co", co); co = co.reshape(n, 3)
        r = np.hypot(co[:, 0], co[:, 1]); th = np.arctan2(co[:, 1], co[:, 0])
        dth = (th - th0 + math.pi) % (2 * math.pi) - math.pi
        arc = r * dth
        g = np.exp(-(arc ** 2 / (2 * sa ** 2) + (co[:, 2] - z0) ** 2 / (2 * sz ** 2)))
        rip = 1 + 0.35 * np.sin(co[:, 2] * 420 + arc * 90) * g
        delta = np.where(r > 0.004, depth * g * rip, 0.0)
        # PET also crinkles a little on the whole lower body
        low = np.exp(-((co[:, 2] - 0.05) ** 2) / (2 * 0.03 ** 2)) * 0.0025 * np.sin(th * 5 + 1.0)
        delta = delta + np.where(r > 0.004, low, 0.0)
        s = np.maximum(r - delta, 0.002) / np.maximum(r, 1e-9)
        co[:, 0] *= np.where(r > 0.004, s, 1); co[:, 1] *= np.where(r > 0.004, s, 1)
        me.vertices.foreach_set("co", co.ravel()); me.update()
    # leak hole through the dented wall
    hz = z0 + 0.012
    cyl = bmesh.new()
    bmesh.ops.create_cone(cyl, cap_ends=True, segments=16, radius1=0.0035, radius2=0.0035, depth=0.05)
    cm = bpy.data.meshes.new("hole"); cyl.to_mesh(cm); cyl.free()
    h = link("hole", cm)
    h.rotation_euler = (0, math.pi / 2, th0)          # axis along radial direction at th0
    h.location = (math.cos(th0) * 0.037, math.sin(th0) * 0.037, hz)
    bpy.context.view_layer.update()
    gm = boolean(glass, h, "DIFFERENCE")
    old = glass.data
    glass.data = gm; glass.data.materials.clear(); glass.data.materials.append(parts["gmat"])
    bpy.data.meshes.remove(old)
    bpy.data.objects.remove(h)
    for p in glass.data.polygons:
        p.use_smooth = True
    for o in (glass, liq):
        o["open_z"] = hz
        o["leak"] = True
    liq["note"] = "liquid LUT is for the intact bottle; dent removes ~4 ml - ignore the difference"
    objs = [o for o in (glass, liq, cap, lab) if o]
    path = os.path.join(ROOT, "export", "bottle_soda_broken.glb")
    export(path, objs)
    vol = volume(glass.data)
    return path, hz, vol


# ----------------------------------------------------------------------------------------------- driver
def break_json(name, spec, zones, vol, open_z, extra):
    base_z, shoulder_z, neck_z = zones
    top = spec["outer"][-1][1]
    plastic = name == "soda"
    dens = 1380.0 if plastic else DENSITY
    d = {
        "name": name, "material": "PET" if plastic else "glass", "shatters": not plastic,
        "frame": "bottle-local, Blender Z-up (glTF Y-up after export), metres, base centre at origin",
        "wall_thickness_m": spec["wall"], "density_kg_m3": dens,
        ("shell_volume_m3" if plastic else "glass_volume_m3"): vol,
        ("shell_mass_kg" if plastic else "glass_mass_kg"): vol * dens,
        "liquid_mass_kg_per_ml": LIQ_KG_ML[name],
        "capacity_ml": None, "height_m": top,
        "open_z": open_z, "neck_z": neck_z, "base_z": base_z, "shoulder_z": shoulder_z,
        "weak_zones": [
            {"name": "base", "z0": 0.0, "z1": base_z, "thinness": 0.6},
            {"name": "body", "z0": base_z, "z1": shoulder_z, "thinness": 1.0},
            {"name": "shoulder", "z0": shoulder_z, "z1": neck_z, "thinness": 1.3},
            {"name": "neck", "z0": neck_z, "z1": top, "thinness": 0.8}],
        "thinness_note": "relative fragility factor, >1 breaks more easily; neck-snap variant cuts at ~open_z",
    }
    d.update(extra)
    return d


def run(name):
    spec = B.BOTTLES[name]
    rng = random.Random(SEEDVAL[name])
    reset()
    zones = profile_zones(spec)
    exp = os.path.join(ROOT, "export")
    parts = build_parts(name, spec)
    cap_ml = json.loads(parts["liquid"]["liquid"])["capacity_ml"]
    res = {"name": name}
    if name == "soda":
        reset()
        path, hz, vol = make_soda(spec, rng)
        info = break_json(name, spec, zones, vol, hz, {"files": {"broken": f"export/bottle_{name}_broken.glb"},
                          "broken_variant": {"kind": "dented + leak hole", "hole_z": hz, "extras": ["open_z", "leak"]}})
        info["capacity_ml"] = cap_ml
        json.dump(info, open(os.path.join(exp, f"bottle_{name}_break.json"), "w"), indent=2)
        print(f"FRACTURE soda broken -> {path}")
        return dict(name=name, broken=f"export/bottle_soda_broken.glb", info=f"export/bottle_soda_break.json")
    glass = parts["glass"]
    gv = volume(glass.data)
    objs, stats, total_v, vsum, seeds, impact = make_shards(name, spec, parts, rng, zones)
    spath = os.path.join(exp, f"bottle_{name}_shards.glb")
    export(spath, objs)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "src", f"bottle_{name}_shards.blend"))
    tris = sum(s["tris"] for s in stats)
    cls = {c: sum(1 for s in stats if s["cls"] == c) for c in ("chunk", "shard", "sliver")}
    print(f"FRACTURE {name}: seeds={len(seeds)} shards={len(objs)} tris={tris} classes={cls} "
          f"vol_intact={total_v*1e6:.1f}cm3 vol_shards={vsum*1e6:.1f}cm3 ({vsum/total_v*100:.2f}%)")
    # broken variant: rebuild a fresh scene (shards no longer needed)
    reset()
    parts = build_parts(name, spec)
    bpath, open_z, th, zs, body_me, neck_me = make_broken(name, spec, parts, rng, zones, None)
    btris = len(body_me.polygons) + len(neck_me.polygons)
    info = break_json(name, spec, zones, gv, open_z, {
        "files": {"shards": f"export/bottle_{name}_shards.glb", "broken": f"export/bottle_{name}_broken.glb"},
        "impact_point": [impact.x, impact.y, impact.z],
        "shards": {"count": len(objs), "tris": tris, "classes": cls,
                   "gap_m": 2 * GAP, "volume_ratio_vs_intact": vsum / total_v,
                   "node_pattern": "Shard_00..Shard_NN (sorted by mass, biggest first)",
                   "extras": ["mass_fraction", "radius", "class", "volume_m3", "mass_kg", "dist_impact"]},
        "broken_variant": {"nodes": ["Glass", "Neck", "Liquid", "Cap(child of Neck)", "Label"], "open_z": open_z,
                           "jag_z_range": [min(zs), max(zs)], "extras": ["open_z", "neck_z"]}})
    info["capacity_ml"] = cap_ml
    json.dump(info, open(os.path.join(exp, f"bottle_{name}_break.json"), "w"), indent=2)
    print(f"FRACTURE {name}: broken -> open_z={open_z:.4f} tris={btris}")
    return dict(name=name, shards=f"export/bottle_{name}_shards.glb", broken=f"export/bottle_{name}_broken.glb",
                info=f"export/bottle_{name}_break.json", n=len(objs), tris=tris)


if __name__ == "__main__":
    names = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    names = names or ["wine", "beer", "soda", "whiskey", "jar", "flask"]
    results = [run(n) for n in names]
    cat_path = os.path.join(ROOT, "catalog.json")
    cat = json.load(open(cat_path, encoding="utf-8"))
    byid = {a["id"]: a for a in cat["assets"]}
    for r in results:
        a = byid.get(f"bottle_{r['name']}")
        if a is None:
            continue
        if "shards" in r:
            a["shards"] = r["shards"]
        a["broken"] = r["broken"]; a["break_info"] = r["info"]
    json.dump(cat, open(cat_path, "w", encoding="utf-8"), indent=2)
    print("FRACTURE done", [r["name"] for r in results])
