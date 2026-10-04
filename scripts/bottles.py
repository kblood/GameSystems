"""Build reusable bottle assets (glass + liquid interior + cap + label) and export GLB.

Run:  blender.exe -b --python bottles.py -- [name ...]      (no names = all)
Output: ../export/bottle_<name>.glb, ../src/bottles.blend (last one built is not kept; see BUILD markers)

Each bottle is a surface of revolution around +Z in Blender (+Y after glTF export), base centre at the origin.
Objects: Glass (shell with wall thickness), Liquid (closed interior volume, 0.4 mm inside the glass),
Cap, Label. The Liquid node carries `extras.liquid` with a volume-preserving fill table:
    d = lut[ci][fi]   ->  plane  dot(p_obj, up_obj) = d   holds `fill` of the interior volume,
    ci indexes cos(tilt) in [-1,1] (tilt = angle between bottle axis and world up), fi indexes fill fraction [0,1].
The liquid is meant to be rendered with an engine shader that discards above that plane (see ../shaders).
"""
import bpy, bmesh, sys, json, math, os
import numpy as np

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SEG = 48
N_COS, N_FILL = 33, 64

# outer profile (radius, height) in metres, from base centre up to the lip
BOTTLES = {
    "wine": dict(
        outer=[(0, 0), (0.030, 0), (0.0355, 0.003), (0.0375, 0.012), (0.0375, 0.19), (0.0365, 0.205), (0.0330, 0.225),
               (0.0270, 0.245), (0.0200, 0.262), (0.0150, 0.277), (0.0128, 0.290), (0.0125, 0.325), (0.0140, 0.331),
               (0.0145, 0.340)],
        wall=0.003, glass=(0.05, 0.22, 0.08, 1.0), liquid=(0.35, 0.02, 0.06, 1.0), foam=0.1, foam_height=0.006,
        cap=("cork", 0.0128, 0.322, 0.350), label=(0.06, 0.15, 0.82, (0.95, 0.92, 0.82, 1.0))),
    "beer": dict(
        outer=[(0, 0), (0.026, 0), (0.0305, 0.003), (0.0325, 0.010), (0.0325, 0.135), (0.0310, 0.150), (0.0270, 0.170),
               (0.0200, 0.190), (0.0140, 0.205), (0.0122, 0.220), (0.0120, 0.245), (0.0132, 0.250), (0.0132, 0.256)],
        wall=0.0025, glass=(0.25, 0.14, 0.03, 1.0), liquid=(0.85, 0.52, 0.06, 1.0),
        carbonation=0.45, foam=1.0, foam_height=0.026, cap=("crown", 0.0155, 0.250, 0.2615), label=(0.02, 0.12, 0.46, (0.90, 0.85, 0.65, 1.0))),
    "soda": dict(
        outer=[(0, 0), (0.024, 0), (0.0305, 0.004), (0.0330, 0.014), (0.0330, 0.14), (0.0320, 0.185), (0.0270, 0.215),
               (0.0190, 0.232), (0.0150, 0.240), (0.0140, 0.246), (0.0140, 0.262)],
        wall=0.0012, glass=(0.85, 0.92, 0.95, 1.0), liquid=(0.12, 0.05, 0.02, 1.0),
        carbonation=0.7, foam=0.7, foam_height=0.014, bubble_size=0.8, cap=("screw", 0.0150, 0.250, 0.267), label=(0.06, 0.15, 0.57, (0.75, 0.08, 0.08, 1.0))),
    "whiskey": dict(
        outer=[(0, 0), (0.030, 0), (0.0345, 0.003), (0.0365, 0.010), (0.0365, 0.135), (0.0350, 0.150), (0.0300, 0.168),
               (0.0210, 0.180), (0.0155, 0.190), (0.0140, 0.200), (0.0140, 0.218), (0.0152, 0.222), (0.0152, 0.226)],
        wall=0.004, glass=(0.85, 0.92, 0.88, 1.0), liquid=(0.62, 0.30, 0.04, 1.0), foam=0.08, foam_height=0.005,
        cap=("cork", 0.0138, 0.208, 0.236), label=(0.05, 0.11, 0.57, (0.92, 0.88, 0.74, 1.0))),
    "jar": dict(
        outer=[(0, 0), (0.036, 0), (0.0420, 0.004), (0.0440, 0.012), (0.0440, 0.090), (0.0425, 0.100), (0.0385, 0.108),
               (0.0385, 0.114), (0.0400, 0.116), (0.0400, 0.122)],
        wall=0.003, glass=(0.85, 0.95, 0.92, 1.0), liquid=(0.75, 0.55, 0.12, 1.0),
        cap=("screw", 0.0415, 0.112, 0.130), label=(0.03, 0.075, 0.88, (0.95, 0.93, 0.85, 1.0))),
    "flask": dict(
        outer=[(0, 0), (0.050, 0), (0.0600, 0.004), (0.0650, 0.012), (0.0600, 0.045), (0.0480, 0.085), (0.0360, 0.125),
               (0.0220, 0.155), (0.0160, 0.168), (0.0150, 0.190), (0.0165, 0.196), (0.0165, 0.202)],
        wall=0.002, glass=(0.85, 0.95, 0.98, 1.0), liquid=(0.10, 0.55, 0.20, 1.0), foam=0.35, foam_height=0.01,
        cap=("cork", 0.0148, 0.185, 0.215), label=None),
}


def lathe(name, profile, closed_axis=True, arc=2 * math.pi, caps_axis=True):
    """Revolve (r,z) profile around Z. Points with r==0 become single pole vertices."""
    bm = bmesh.new()
    full = abs(arc - 2 * math.pi) < 1e-6
    n = SEG if full else int(SEG * arc / (2 * math.pi)) + 1
    rings = []
    for r, z in profile:
        if r <= 1e-9:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            cnt = n if full else n
            rings.append([bm.verts.new((r * math.cos(i * arc / (n if full else n - 1)),
                                        r * math.sin(i * arc / (n if full else n - 1)), z)) for i in range(cnt)])
    for a, b in zip(rings[:-1], rings[1:]):
        for i in range(max(len(a), len(b))):
            j = i + 1
            if not full and j >= max(len(a), len(b)):
                break
            j %= max(len(a), len(b))
            if len(a) == 1:
                bm.faces.new((a[0], b[i], b[j]))
            elif len(b) == 1:
                bm.faces.new((a[i], b[0], a[j]))
            else:
                bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if full:
        # recalc_face_normals can pick the inward orientation on some profiles (whiskey Liquid); enforce outward
        # winding by signed volume (positive = outward normals for a closed mesh).
        vol = sum(f.verts[0].co.dot(f.verts[k].co.cross(f.verts[k + 1].co))
                  for f in bm.faces for k in range(1, len(f.verts) - 1)) / 6.0
        if vol < 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


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


def inner_profile(outer, wall, z_top):
    zb = wall
    pts = [(0.0, zb)]
    for r, z in outer:
        if z >= zb and z <= z_top and r > 0:
            pts.append((max(r - wall, 0.0005), z))
    pts.append((pts[-1][0], z_top))
    return pts


def volume_lut(profile):
    """Volume-preserving plane offset table for a surface of revolution (profile = [(r,z)] with r(z) monotone in z)."""
    pr = np.array(profile)
    z0, z1 = pr[0, 1], pr[-1, 1]
    nz, ng = 220, 96
    zs = z0 + (np.arange(nz) + 0.5) * (z1 - z0) / nz
    # r(z): profile may repeat z (vertical segments); sort by z, keep max r on ties
    order = np.argsort(pr[:, 1], kind="stable")
    rz = np.interp(zs, pr[order, 1], pr[order, 0])
    R = rz.max()
    g = (np.arange(ng) + 0.5) / ng * 2 * R - R
    X, Y = np.meshgrid(g, g, indexing="ij")
    cell = (2 * R / ng) ** 2
    dz = (z1 - z0) / nz
    xs, zz, ww = [], [], []
    for k in range(nz):
        m = X ** 2 + Y ** 2 <= rz[k] ** 2
        c = int(m.sum())
        if c:
            xs.append(X[m]); zz.append(np.full(c, zs[k])); ww.append(np.full(c, cell * dz))
    x = np.concatenate(xs); z = np.concatenate(zz); w = np.concatenate(ww)
    cs = np.linspace(-1, 1, N_COS)
    fs = np.linspace(0, 1, N_FILL)
    lut = np.zeros((N_COS, N_FILL))
    for i, c in enumerate(cs):
        th = math.acos(max(-1, min(1, c)))
        s = x * math.sin(th) + z * math.cos(th)
        o = np.argsort(s)
        cum = np.cumsum(w[o])
        V = cum[-1]
        lut[i] = np.interp(fs * V, np.concatenate([[0], cum]), np.concatenate([[s[o][0]], s[o]]))
    return lut, float(w.sum()) * 1e6, cs, fs


def build(name, spec):
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)
    outer, wall = spec["outer"], spec["wall"]
    lip_r, lip_z = outer[-1]
    kind, cap_r, cap_z0, cap_z1 = spec["cap"]
    z_top = lip_z - 0.004 if kind == "cork" else lip_z - 0.002

    inner = inner_profile(outer, wall, z_top)
    # glass shell: outer up, across the lip, inner down to the base
    shell = list(outer) + [(inner[-1][0], lip_z)] + [(r, z) for r, z in reversed(inner[1:])] + [(0.0, wall)]
    # drop the zero-width segment at the lip inner edge when inner top < lip
    glass = lathe("Glass", [(r, z) for r, z in shell])
    glass.data.materials.append(material("Glass", spec["glass"], rough=0.03, transmission=1.0, ior=1.5))

    # liquid: slightly inside the glass, closed
    liq_prof = [(0.0, inner[0][1] + 0.0004)] + [(max(r - 0.0004, 0.0003), z) for r, z in inner[1:-1]] \
        + [(max(inner[-1][0] - 0.0004, 0.0003), z_top - 0.002), (0.0, z_top - 0.002)]
    liq = lathe("Liquid", liq_prof)
    liq.data.materials.append(material("Liquid", spec["liquid"], rough=0.05, transmission=0.0))
    lut, vol_ml, cs, fs = volume_lut(liq_prof)
    liq["liquid"] = json.dumps({
        "version": 1, "axis": "Y", "capacity_ml": round(vol_ml, 1),
        "z0": round(liq_prof[0][1], 5), "z1": round(liq_prof[-1][1], 5),
        "n_cos": N_COS, "n_fill": N_FILL, "color": list(spec["liquid"]), "carbonation": spec.get("carbonation", 0.0),
        "foam": spec.get("foam", 0.0), "foam_height": spec.get("foam_height", 0.022), "bubble_size": spec.get("bubble_size", 1.0),
        "lut": [[round(v, 5) for v in row] for row in lut.tolist()]})
    with open(os.path.join(ROOT, "export", f"bottle_{name}.liquid.json"), "w", encoding="utf-8") as fh:
        fh.write(liq["liquid"])   # sidecar copy of the extras, for engines that drop glTF extras
    cap_obj = None
    cap_mat = {"cork": ((0.62, 0.45, 0.28, 1), 0.9, 0.0), "crown": ((0.55, 0.55, 0.58, 1), 0.35, 1.0),
               "screw": ((0.12, 0.12, 0.14, 1), 0.4, 0.0)}[kind]
    if kind == "cork":
        cap_obj = lathe("Cap", [(0, cap_z0), (cap_r, cap_z0), (cap_r, cap_z1 - 0.003), (cap_r * 0.97, cap_z1), (0, cap_z1)])
    elif kind == "crown":
        cap_obj = lathe("Cap", [(0, cap_z0), (cap_r, cap_z0), (cap_r, cap_z0 + 0.006), (cap_r * 0.9, cap_z1), (0, cap_z1)])
    else:
        cap_obj = lathe("Cap", [(0, cap_z0), (cap_r, cap_z0), (cap_r, cap_z1 - 0.002), (cap_r - 0.002, cap_z1), (0, cap_z1)])
    cap_obj.data.materials.append(material("Cap", cap_mat[0], rough=cap_mat[1], metal=cap_mat[2]))

    if spec["label"]:
        z0, z1, _, col = spec["label"]
        # label wraps the straight part of the body
        oz = [z for r, z in outer]
        body_r = max(float(np.interp(z, oz, [r for r, z in outer])) for z in np.linspace(z0, z1, 12))
        lab = lathe("Label", [(body_r + 0.0006, z0), (body_r + 0.0006, z1)], arc=math.radians(300))
        # strip needs both faces visible
        lab.data.materials.append(material("Label", col, rough=0.7))
        mod = lab.modifiers.new("Solid", "SOLIDIFY"); mod.thickness = 0.0003
        bpy.context.view_layer.objects.active = lab
        bpy.ops.object.modifier_apply(modifier="Solid")

    bpy.ops.object.select_all(action="SELECT")
    os.makedirs(os.path.join(ROOT, "export"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "src"), exist_ok=True)
    out = os.path.join(ROOT, "export", f"bottle_{name}.glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_extras=True, export_yup=True,
                              export_apply=True, use_selection=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "src", f"bottle_{name}.blend"))
    print(f"BUILD {name} capacity={vol_ml:.0f}ml height={lip_z*100:.1f}cm -> {out}")
    return dict(id=f"bottle_{name}", family="bottle", file=f"export/bottle_{name}.glb", capacity_ml=round(vol_ml),
                height_m=lip_z, license="MIT")


if __name__ == "__main__":
    names = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    names = names or list(BOTTLES)
    entries = [build(n, BOTTLES[n]) for n in names]
    cat_path = os.path.join(ROOT, "catalog.json")
    cat = json.load(open(cat_path, encoding="utf-8"))
    have = {a["id"]: a for a in cat["assets"]}
    for e in entries:
        have[e["id"]] = e
    cat["assets"] = sorted(have.values(), key=lambda a: a["id"])
    json.dump(cat, open(cat_path, "w", encoding="utf-8"), indent=2)
    print("BUILD done", len(entries))
