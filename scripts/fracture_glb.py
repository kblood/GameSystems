"""Pre-fracture ANY exported bottle / container GLB (mesh-driven; no lathe spec needed).

    blender -b -P scripts/fracture_glb.py -- v2:bordeaux container:tumbler v1:whiskey ...   (no args = all targets)

Reads the shipped GLB (so the shards match exactly what the game renders), its sidecars (v2: <n>.profile.json for wall /
glass kind; capacity from the liquid sidecar) and writes next to the GLB:
    <stem>_shards.glb   Shard_NN nodes, origin at centroid, extras mass_fraction / radius / class / mass_kg
    <stem>_broken.glb   neck-snap variant: Glass (jagged rim) + Neck (+ Cap child) + Liquid + Label, extras open_z / neck_z
    <stem>_break.json   zones, masses, weak zones, calibration (BottleBreakProfile.apply_break_json)
Non-shattering assets (PET v2 bottles, mug, jerrycan) only get <stem>_break.json with shatters=false + a leak block.
Re-uses fracture.py helpers (voronoi_cell, boolean, islands, export, cutter_mesh). HIGH tier only; a lower tier would be a
second pass with a smaller TARGET count written to <stem>_shards_<tier>.glb (not built).
"""
import bpy, bmesh, sys, os, json, math, random
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fracture as F  # noqa: E402

ROOT = F.ROOT
EXP = os.path.join(ROOT, "export")
CALIB_V = 4.3          # m/s: full bottle, mid body, concrete -> F_peak == F_crit (v1 wine is ~4.4 m/s)
V2 = ["apothecary", "bordeaux", "burgundy", "champagne", "contour", "cruet", "decanter", "erlenmeyer", "growler",
      "longneck", "mason", "milk", "perfume", "pet2l", "pet500", "roundflask", "spirit", "stubby", "swingtop", "whisky"]
CONTAINERS = ["square", "hipflask", "tumbler", "tank", "mug", "jerrycan"]
NON_SHATTER = {"mug": ("ceramic", 2300.0), "jerrycan": ("plastic", 950.0)}   # material, density
LIQ_KG_ML = 0.001


def paths(kind, name):
    if kind == "v2":
        return os.path.join(EXP, "v2", f"bottle_{name}"), f"export/v2/bottle_{name}"
    if kind == "container":
        return os.path.join(EXP, f"container_{name}"), f"export/container_{name}"
    return os.path.join(EXP, f"bottle_{name}"), f"export/bottle_{name}"


def load_glb(path):
    F.reset()
    bpy.ops.import_scene.gltf(filepath=path)
    objs = {o.name.split(".")[0]: o for o in bpy.data.objects if o.type == "MESH"}
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o)
    return objs


def welded(obj):
    """Copy of obj's mesh with glTF seam splits welded (EXACT booleans need a closed shell)."""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=2e-5)
    me = bpy.data.meshes.new(obj.name + "_w"); bm.to_mesh(me); bm.free()
    for m in obj.data.materials:
        me.materials.append(m)
    return F.link(obj.name + "_w", me)


def mesh_stats(me):
    bm = bmesh.new(); bm.from_mesh(me)
    area = sum(f.calc_area() for f in bm.faces)
    vol = abs(bm.calc_volume())
    nm = sum(1 for e in bm.edges if not e.is_manifold)
    V = np.array([v.co[:] for v in bm.verts])
    bm.free()
    return area, vol, nm, V


def zones_from_verts(V):
    z = V[:, 2]; r = np.hypot(V[:, 0], V[:, 1]); top = float(z.max())
    nb = 80
    edges = np.linspace(0, top, nb + 1)
    outer = []
    for i in range(nb):
        m = (z >= edges[i]) & (z <= edges[i + 1])
        if m.any():
            outer.append((float(r[m].max()), float(0.5 * (edges[i] + edges[i + 1]))))
    outer[-1] = (outer[-1][0], top)
    rr = np.array([o[0] for o in outer])
    neck = rr[-max(3, nb // 10):].max() < 0.7 * rr.max()     # narrow top = has a neck
    if not neck:
        return max(0.012, 0.04 * top), top, top, top, False
    b, s, n = F.profile_zones({"outer": outer})
    z_rmax = outer[int(np.argmax(rr))][1]          # globe / decanter bodies: the body zone reaches at least the widest point
    s = max(s, min(z_rmax, 0.9 * n))
    return b, s, n, top, True


def sample_surface(V, tris, rng, n):
    a = V[tris[:, 0]]; b = V[tris[:, 1]]; c = V[tris[:, 2]]
    ar = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    k = rng.choice(len(tris), size=n, p=ar / ar.sum())
    u = rng.random(n); v = rng.random(n); f = u + v > 1
    u[f] = 1 - u[f]; v[f] = 1 - v[f]
    return a[k] + (b[k] - a[k]) * u[:, None] + (c[k] - a[k]) * v[:, None]


def make_seeds(obj, impact, zones, target, seed):
    base_z, _, neck_z, _, _ = zones
    me = obj.data
    me.calc_loop_triangles()
    V = np.array([v.co[:] for v in me.vertices]); T = np.array([t.vertices[:] for t in me.loop_triangles])
    imp = np.array(impact[:])
    k = 0.55; best = None
    while k < 8:
        rng = np.random.default_rng(seed * 1000 + int(k * 100))
        P = sample_surface(V, T, rng, 6000)
        d = np.linalg.norm(P - imp, axis=1)
        s = k * (0.0045 + 0.052 * np.minimum(d / 0.12, 1.0) ** 0.9)
        s[P[:, 2] < base_z] *= 1.5
        s[P[:, 2] > neck_z] *= 2.0
        pts = [imp]; sp = [0.0045 * k]
        for p, si in zip(P, s):
            A = np.array(pts)
            if np.all(np.linalg.norm(A - p, axis=1) > 0.5 * (si + np.array(sp))):
                pts.append(p); sp.append(si)
        best = pts
        if len(pts) <= target:
            break
        k *= 1.06
    seeds = [Vector(p.tolist()) for p in best]
    if not any(math.hypot(p.x, p.y) < 0.012 and p.z < base_z for p in seeds):
        seeds.append(Vector((0.0, 0.0, base_z * 0.5)))
    return seeds


def shards(obj, seeds, impact, R):
    gmat = obj.data.materials[0] if obj.data.materials else None
    out = []
    for i in range(len(seeds)):
        cm = F.voronoi_cell(i, seeds, R=R)
        cobj = F.link("cell", cm)
        me = F.boolean(obj, cobj, "INTERSECT")
        bpy.data.objects.remove(cobj); bpy.data.meshes.remove(cm)
        for nb in F.islands(me):
            bmesh.ops.recalc_face_normals(nb, faces=nb.faces[:])
            v = abs(nb.calc_volume())
            if v < 4e-9:
                nb.free(); continue
            out.append((nb, v))
        bpy.data.meshes.remove(me)
    out.sort(key=lambda t: -t[1])
    vsum = sum(v for _, v in out)
    objs = []; cls_n = {}
    tris = 0
    for k, (nb, v) in enumerate(out):
        co = np.array([vv.co[:] for vv in nb.verts]); c = Vector(co.mean(axis=0).tolist())
        bmesh.ops.translate(nb, verts=nb.verts[:], vec=-c)
        bmesh.ops.triangulate(nb, faces=nb.faces[:])
        me = bpy.data.meshes.new(f"Shard_{k:02d}"); nb.to_mesh(me); nb.free()
        if gmat:
            me.materials.append(gmat)
        o = F.link(f"Shard_{k:02d}", me, loc=c)
        ext = np.sort(co.max(axis=0) - co.min(axis=0))[::-1]
        mf = v / vsum
        cls = "chunk" if mf >= 0.06 else ("sliver" if (mf < 0.004 or ext[0] > 3.2 * ext[1]) else "shard")
        o["mass_fraction"] = float(mf); o["radius"] = float(np.linalg.norm(co - np.array(c), axis=1).max())
        o["class"] = cls; o["volume_m3"] = float(v); o["mass_kg"] = float(v * F.DENSITY)
        o["dist_impact"] = float((c - impact).length)
        cls_n[cls] = cls_n.get(cls, 0) + 1
        tris += len(me.polygons)
        objs.append(o)
    return objs, {"count": len(objs), "tris": tris, "classes": cls_n}, vsum


def broken(objs, gw, zones, rmax, seed, path):
    base_z, shoulder_z, neck_z, top, _ = zones
    rng = random.Random(seed)
    z0 = neck_z - 0.3 * (neck_z - shoulder_z)
    amp = min(0.008, 0.25 * (neck_z - shoulder_z) + 0.002)
    n = 26
    th = (np.linspace(0, 2 * math.pi, n, endpoint=False) + (np.array([rng.random() for _ in range(n)]) - 0.5) * 0.55 * (2 * math.pi / n)).tolist()
    ph = rng.random() * 6.28
    zs = [z0 + (0.35 + 0.65 * rng.random()) * amp * (1 if i % 2 == 0 else -0.9) + 0.25 * amp * math.sin(th[i] + ph) for i in range(n)]
    open_z = float(min(zs))
    R = rmax * 1.4 + 0.02
    down = F.link("cut_dn", F.cutter_mesh(zs, th, -F.GAP, rin=0.0008, R=R, ztop=top + 0.1))
    up = F.link("cut_up", F.cutter_mesh(zs, th, +F.GAP, rin=0.0008, R=R, ztop=top + 0.1))
    gmat = gw.data.materials[0] if gw.data.materials else None
    body_me = F.boolean(gw, down, "DIFFERENCE")
    neck_me = F.boolean(gw, up, "INTERSECT")
    out = []
    lab = objs.get("Label")
    lab_me = F.boolean(lab, down, "DIFFERENCE") if lab else None
    bpy.data.objects.remove(down); bpy.data.objects.remove(up)
    body = F.link("Glass", body_me, gmat)
    nbm = bmesh.new(); nbm.from_mesh(neck_me)
    cen = Vector(np.array([v.co[:] for v in nbm.verts]).mean(axis=0).tolist())
    bmesh.ops.translate(nbm, verts=nbm.verts[:], vec=-cen); nbm.to_mesh(neck_me); nbm.free()
    neck = F.link("Neck", neck_me, gmat, loc=cen)
    out = [body, neck]
    liq = objs.get("Liquid")
    if liq:
        liq.name = "Liquid"; liq["open_z"] = open_z; out.append(liq)
    cap = objs.get("Cap")
    if cap:
        cap.name = "Cap"
        bpy.context.view_layer.update()
        cap.parent = neck; cap.matrix_parent_inverse = neck.matrix_world.inverted()
        out.append(cap)
    if lab_me is not None:
        lab_mat = lab.data.materials[0] if lab.data.materials else None
        bpy.data.objects.remove(lab)
        out.append(F.link("Label", lab_me, lab_mat))
    for o in (body, neck):
        o["open_z"] = open_z; o["neck_z"] = neck_z
    F.export(path, out)
    return open_z, [min(zs), max(zs)]


def sidecar_capacity(stem):
    for p in (stem + ".liquid.json",):
        if os.path.exists(p):
            return float(json.load(open(p, encoding="utf-8"))["capacity_ml"])
    return None


def run(kind, name):
    stem, rel = paths(kind, name)
    objs = load_glb(stem + ".glb")
    prof = json.load(open(stem + ".profile.json", encoding="utf-8")) if kind == "v2" else {}
    glass_kind = str(prof.get("glass", "glass"))
    material, dens = ("plastic", 1380.0) if glass_kind.startswith("pet") else NON_SHATTER.get(name, ("glass", F.DENSITY))
    shell = objs.get("Glass") or objs.get("Body")
    gw = welded(shell)
    area, vol, nonman, V = mesh_stats(gw.data)
    gw.data.calc_loop_triangles()
    T = np.array([t.vertices[:] for t in gw.data.loop_triangles])
    zones = zones_from_verts(np.vstack([V, sample_surface(V, T, np.random.default_rng(1), 40000)]))
    base_z, shoulder_z, neck_z, top, has_neck = zones
    wall = float(prof.get("wall", {}).get("body", 0.0)) or (vol / max(0.5 * area, 1e-9) if nonman == 0 else 0.003)
    wall = float(np.clip(wall, 0.0015, 0.008))
    if nonman or vol < 1e-8:
        vol = 0.5 * area * wall
    cap_ml = sidecar_capacity(stem) or float(prof.get("capacity_ml", 500.0))
    shatters = material == "glass"
    seed = sum(ord(c) for c in kind + name) * 7
    rmax = float(np.hypot(V[:, 0], V[:, 1]).max())
    zi = 0.5 * (base_z + shoulder_z)
    near = np.abs(V[:, 2] - zi) < 0.006
    iv = V[near][np.argmax(V[near][:, 0])] if near.any() else np.array([rmax, 0, zi])
    impact = Vector((float(iv[0]) - wall * 0.5, float(iv[1]), float(iv[2])))
    wz = [{"name": "base", "z0": 0.0, "z1": base_z, "thinness": 1.0},
          {"name": "body", "z0": base_z, "z1": shoulder_z, "thinness": 1.0}]
    if has_neck:
        wz += [{"name": "shoulder", "z0": shoulder_z, "z1": neck_z, "thinness": 1.3},
               {"name": "neck", "z0": neck_z, "z1": top, "thinness": 0.8}]
    d = {"name": name, "family": kind, "material": material, "shatters": shatters, "source": "scripts/fracture_glb.py",
         "frame": "bottle-local, glTF Y-up, metres, base centre at origin (same frame as the shipped GLB)",
         "wall_thickness_m": wall, "density_kg_m3": dens, "glass_volume_m3": vol, "glass_mass_kg": vol * dens,
         "liquid_mass_kg_per_ml": LIQ_KG_ML, "capacity_ml": cap_ml, "height_m": top, "max_radius_m": rmax,
         "base_z": base_z, "shoulder_z": shoulder_z, "neck_z": neck_z, "has_neck": has_neck, "weak_zones": wz,
         "zone_factor": {"base": 1.15, "body": 1.0, "shoulder": 0.85, "neck": 0.55},
         "calibration": {"surface": "concrete", "fill": 1.0, "v_n": CALIB_V, "y": "mid_body",
                         "note": "f_crit_ref solved at load so this hit is exactly the break threshold"},
         "mesh": {"area_m2": area, "non_manifold_edges": nonman}}
    res = {"id": {"v2": f"bottle_v2_{name}", "container": f"container_{name}", "v1": f"bottle_{name}"}[kind],
           "break_info": rel + "_break.json"}
    if not shatters:
        d["leak"] = {"ratio": 1.0, "hole_r_m": 0.003 if material != "plastic" else 0.0025,
                     "note": "impact ratio >= ratio pierces/cracks the shell: liquid leaks through a hole (no shards)"}
        d["files"] = {}
    else:
        target = int(np.clip(22 * (area / 0.12) ** 0.5, 12, 30))
        seeds = make_seeds(gw, impact, zones, target, seed)
        sobjs, st, vsum = shards(gw, seeds, impact, R=max(0.25, top * 1.2))
        F.export(stem + "_shards.glb", sobjs)
        for o in sobjs:
            bpy.data.objects.remove(o)
        d["shards"] = st
        d["impact_point"] = list(impact[:])
        d["files"] = {"shards": rel + "_shards.glb"}
        res["shards"] = rel + "_shards.glb"
        if has_neck:
            open_z, jr = broken(objs, gw, zones, rmax, seed, stem + "_broken.glb")
            d["open_z"] = open_z
            d["files"]["broken"] = rel + "_broken.glb"
            d["broken_variant"] = {"nodes": ["Glass", "Neck", "Liquid", "Cap(child of Neck)", "Label"], "open_z": open_z,
                                   "jag_z_range": jr}
            res["broken"] = rel + "_broken.glb"
        print(f"FRACTURE_GLB {kind}:{name} shards={st['count']} tris={st['tris']} vol={vol:.3e} vsum={vsum:.3e} nonman={nonman}")
    json.dump(d, open(stem + "_break.json", "w"), indent=2)
    print(f"FRACTURE_GLB {kind}:{name} material={material} wall={wall:.4f} zones={[round(x, 4) for x in zones[:4]]} neck={has_neck}")
    return res


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    targets = [a.split(":") for a in args] or ([["v2", n] for n in V2] + [["container", n] for n in CONTAINERS] + [["v1", "whiskey"]])
    results = []
    for k, n in targets:
        try:
            results.append(run(k, n))
        except Exception as e:  # keep going; the summary lists failures
            import traceback; traceback.print_exc()
            print(f"FRACTURE_GLB FAIL {k}:{n}: {e}")
    cat_path = os.path.join(ROOT, "catalog.json")
    cat = json.load(open(cat_path, encoding="utf-8"))          # re-read right before writing (shared file)
    byid = {a["id"]: a for a in cat["assets"]}
    for r in results:
        a = byid.get(r["id"])
        if a is None:
            continue
        a["break_info"] = r["break_info"]
        for key in ("shards", "broken"):
            if key in r:
                a[key] = r[key]
            else:
                a.pop(key, None)
    json.dump(cat, open(cat_path, "w", encoding="utf-8"), indent=2)
    print("FRACTURE_GLB done", len(results), "of", len(targets))
