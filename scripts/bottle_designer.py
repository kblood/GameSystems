"""Bottle DESIGN builder: bottle shape + glass/cap + liquid settings + any number of separate label meshes -> GLB.

Run (Blender 5.2):   [-- --v2 builds only designs/v2_*.bottle.json; --tier high,medium; --all-tiers]
    blender.exe -b --python scripts/bottle_designer.py -- designs/wine_classic.bottle.json [...]     (or: -- --all)
    blender.exe -b --python scripts/bottle_designer.py -- --slots wine beer ...   (slot overview renders -> tests/out/slots_<b>.png)
Output: export/designs/<name>.glb  (+ <name>.design.json resolved sidecar, <name>.liquid.json, textures/<name>_<slot>.png)
The base bottle has NO built-in label. Label_<slot> nodes carry extras {slot, width_m, height_m, aspect, arc_deg, material_kind}.
Does not modify bottles.py or export/bottle_*.glb (the LUT is copied from export/bottle_<base>.liquid.json).
See docs/bottle_designs.md.
"""
import bpy, bmesh, sys, os, json, math, glob, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bottles as B            # reference only (lathe/material/inner_profile); never edited
import design_slots as DS
import design_labels as DL

ROOT = DS.ROOT
OUT = os.path.join(ROOT, "export", "designs")

# label material kinds: roughness, metallic, alpha-blended?
KINDS = {
    "paper_matte": dict(rough=0.85, metal=0.0, blend=False),
    "paper_gloss": dict(rough=0.25, metal=0.0, blend=False),
    "foil_metal": dict(rough=0.28, metal=1.0, blend=False),
    "clear_film": dict(rough=0.12, metal=0.0, blend=True),
    "plastic_sleeve": dict(rough=0.16, metal=0.0, blend=False),
    "tape": dict(rough=0.40, metal=0.0, blend=False),
    "handwritten_tag": dict(rough=0.95, metal=0.0, blend=False),
}
FOIL_FINISH = {"mirror": 0.10, "satin": 0.28, "brushed": 0.45}


def log(*a):
    print("DESIGN", *a, flush=True)


# ---------------------------------------------------------------- label material
def label_material(name, kind, image_path, tint, mask_path=None, rough=None, metal=None, blend=None, alpha_mode=None):
    k = KINDS[kind]
    rough = k["rough"] if rough is None else rough
    metal = k["metal"] if metal is None else metal
    blend = k["blend"] if blend is None else blend
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = True     # paper is one-sided (glTF doubleSided=false)
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    img = bpy.data.images.load(image_path, check_existing=False)
    img.name = "tex_" + name
    img.colorspace_settings.name = "sRGB"
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img; tex.interpolation = "Linear"; tex.extension = "EXTEND"
    tex.location = (-700, 200)
    tint = DL.rgba(tint, [1, 1, 1, 1])
    if any(abs(c - 1.0) > 1e-4 for c in tint[:3]):
        mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"; mix.location = (-400, 200)
        mix.inputs[0].default_value = 1.0
        mix.inputs[7].default_value = tint
        nt.links.new(tex.outputs["Color"], mix.inputs[6])
        nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    else:
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    # alpha: scan the image for transparency (Blender has no PIL; numpy is there)
    import numpy as np
    px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    has_alpha = bool(px[3::4].min() < 0.99)
    mode = alpha_mode or ("BLEND" if blend else "MASK" if has_alpha else "OPAQUE")
    m["alpha_mode"] = mode
    if mode != "OPAQUE":
        nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        m.surface_render_method = "BLENDED" if mode == "BLEND" else "DITHERED"
    if mask_path:      # wear mask: G channel = roughness (glTF metallicRoughness texture convention)
        mimg = bpy.data.images.load(mask_path, check_existing=False)
        mimg.name = "wear_" + name
        mimg.colorspace_settings.name = "Non-Color"
        mt = nt.nodes.new("ShaderNodeTexImage"); mt.image = mimg; mt.location = (-700, -200)
        sp = nt.nodes.new("ShaderNodeSeparateColor"); sp.location = (-400, -200)
        nt.links.new(mt.outputs["Color"], sp.inputs[0])
        nt.links.new(sp.outputs["Green"], bsdf.inputs["Roughness"])
    return m


def make_mesh_object(name, geo, mat):
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in geo["verts"]]
    uv = bm.loops.layers.uv.new("UVMap")
    for f in geo["faces"]:
        idx = list(f) if f[2] != f[3] else list(f[:3])
        face = bm.faces.new([vs[i] for i in idx])
        face.smooth = True
        for loop, i in zip(face.loops, idx):
            loop[uv].uv = geo["uvs"][i]
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def check_flush(spec, geo, slot):
    """numeric sanity: label verts outside the glass (>=0.25 mm), normals pointing outwards."""
    worst = 1e9
    if geo.get("disc"):
        return 0.0, 1.0
    if spec.get("rings"):          # rounded-rectangle loft (containers): gap = SDF to the ring, outward = normal along the SDF gradient
        RS = DS.RingStack(spec["rings"], spec.get("deform"))
        vs = geo["verts"]
        worst = min(RS.gap(x, y, z) for (x, y, z) in vs)
        bad = 0
        for f in geo["faces"]:
            a, b, c, d = (vs[i] for i in f)
            n = ((b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]), (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]))
            m = [(a[k] + c[k]) / 2 for k in range(3)]
            e = 1e-4
            gx = RS.gap(m[0] + e, m[1], m[2]) - RS.gap(m[0] - e, m[1], m[2]); gy = RS.gap(m[0], m[1] + e, m[2]) - RS.gap(m[0], m[1] - e, m[2])
            if n[0] * gx + n[1] * gy <= 0:
                bad += 1
        return worst, 1.0 - bad / max(1, len(geo["faces"]))
    P = DS.Profile(spec["cap_outer"] if slot.get("surface") == "cap" else spec["outer"])
    for (x, y, z) in geo["verts"]:
        r = math.hypot(x, y)
        worst = min(worst, r - P.r(z))
    bad = 0
    vs = geo["verts"]
    for f in geo["faces"]:
        a, b, c, d = (vs[i] for i in f)
        n = ((b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]), (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]), (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]))
        cx, cy = (a[0] + c[0]) / 2, (a[1] + c[1]) / 2
        if n[0] * cx + n[1] * cy <= 0:
            bad += 1
    return worst, 1.0 - bad / max(1, len(geo["faces"]))


# ---------------------------------------------------------------- base bottle (no label)
def build_base(name, bottle, design):
    spec = B.BOTTLES[bottle]
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)
    outer, wall = spec["outer"], spec["wall"]
    lip_r, lip_z = outer[-1]
    base_kind = spec["cap"][0]
    z_top = lip_z - 0.004 if base_kind == "cork" else lip_z - 0.002     # as bottles.py: the liquid LUT depends on this
    gl = design["glass"]
    tint = DL.rgba(gl.get("tint"), list(spec["glass"]))
    inner = B.inner_profile(outer, wall, z_top)
    shell = list(outer) + [(inner[-1][0], lip_z)] + [(r, z) for r, z in reversed(inner[1:])] + [(0.0, wall)]
    glass = B.lathe("Glass", shell)
    glass.data.materials.append(B.material("Glass", tint, rough=gl.get("roughness", 0.03), transmission=1.0, ior=1.5))
    glass["glass"] = json.dumps({"tint": tint, "roughness": gl.get("roughness", 0.03), "thickness_mm": gl.get("thickness_mm", wall * 1000.0),
                                 "ior": 1.5, "note": "thickness_mm is a shader hint only; the mesh wall is fixed (liquid LUT depends on it)"})
    glass["design"] = json.dumps({"name": name, "bottle": bottle, "version": 1, "meta": design.get("meta", {})})
    # liquid (same geometry as bottles.py), LUT copied from the base sidecar
    liq_prof = [(0.0, inner[0][1] + 0.0004)] + [(max(r - 0.0004, 0.0003), z) for r, z in inner[1:-1]] \
        + [(max(inner[-1][0] - 0.0004, 0.0003), z_top - 0.002), (0.0, z_top - 0.002)]
    lq = design["liquid"]
    base = json.load(open(os.path.join(ROOT, "export", "bottle_%s.liquid.json" % bottle), encoding="utf-8"))
    lcol = DL.rgba(lq.get("color"), list(spec["liquid"]))
    info = dict(base)                                   # keeps lut, n_cos, n_fill, z0, z1, capacity_ml, version, axis ...
    info["color"] = lcol
    for k in ("carbonation", "foam", "bubble_size", "foam_height"):
        if k in lq:
            info[k] = lq[k]
    info.update(opacity=lq.get("opacity", 0.0 if spec["liquid"][3] >= 1 else 0.0), viscosity=lq.get("viscosity", 0.0),
                density=lq.get("density", 1.0), fill_default=lq.get("fill", 0.6), tint_strength=lq.get("tint_strength", 1.0))
    info["mass_full_kg"] = round(info["capacity_ml"] / 1000.0 * info["density"], 4)
    liq = B.lathe("Liquid", liq_prof)
    liq.data.materials.append(B.material("Liquid", lcol, rough=0.05))
    liq["liquid"] = json.dumps(info)
    # cap
    cp = design["cap"]
    ctype = cp.get("type", base_kind)
    cap = DS.cap_params(spec, ctype)
    cmat = DL.CAP_MATERIAL[ctype]
    ccol = DL.rgba(cp.get("colour", cp.get("color")), list(cmat[0]))
    m = cp.get("material", {}) or {}
    pr = cap["profile"]
    cap_obj = B.lathe("Cap", pr)
    if not cap["closed"]:       # foil / wax skirts are open at the bottom: show both sides
        pass
    cap_obj.data.materials.append(B.material("Cap", ccol, rough=m.get("roughness", cmat[1]), metal=m.get("metallic", cmat[2])))
    cap_obj["cap"] = json.dumps({"type": ctype, "r": cap["r"], "z0": cap["z0"], "z1": cap["z1"], "top_r": cap["top_r"]})
    return spec, cap, info


def build_base_v2(name, asset, design, tier):
    """GLB-based provider: the scene stays empty (only label objects get built); Glass/Liquid/Cap/... come from the v2 GLB and are merged
    in at binary level after the labels are exported. Returns (spec, cap(None), liquid info, base glb path)."""
    import design_glb
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)
    prov = DS.provider_of(asset)[1]
    paths = prov["tier_paths"](asset, design.get("lod_paths"))
    base = os.path.join(ROOT, paths[tier])
    spec = DS.spec_for(asset)
    info = design_glb.node_extras(base, "Liquid").get("liquid", {})
    return spec, None, info, base


# ---------------------------------------------------------------- designs
TIERS = ("high", "medium", "low", "minimal")
MEDIUM_MAX_PX = 512
ATLAS_PX = 1024


def px_load(path, size=None):
    import numpy as np
    img = bpy.data.images.load(path, check_existing=False)
    if size and tuple(img.size) != tuple(size):
        img.scale(int(size[0]), int(size[1]))
    w, h = img.size
    arr = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    bpy.data.images.remove(img)
    return arr.reshape(h, w, 4)


def px_save(arr, path):
    h, w = arr.shape[:2]
    img = bpy.data.images.new("tmp_save", w, h, alpha=True)
    img.pixels.foreach_set(arr.ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def shelf_pack(sizes, aw, ah, pad=4):
    """sizes: [(w,h)] -> rects [(x,y)] or None. Simple shelf packing (tallest first)."""
    order = sorted(range(len(sizes)), key=lambda i: -sizes[i][1])
    x = y = rowh = 0
    pos = [None] * len(sizes)
    for i in order:
        w, h = sizes[i]
        if x + w + pad > aw:
            x, y, rowh = 0, y + rowh + pad, 0
        if y + h + pad > ah or w + pad > aw:
            return None
        pos[i] = (x + pad // 2, y + pad // 2)
        x += w + pad; rowh = max(rowh, h)
    return pos


def build_design(path, tier="high"):
    import numpy as np
    global ATLAS_PX
    d = DL.load_design(path)
    name = os.path.basename(path).replace(".bottle.json", "")
    fname = name if tier == "high" else "%s_%s" % (name, tier)
    bottle = d["asset"]
    pname, prov = DS.provider_of(bottle)
    glbmode = prov["base"] == "glb"
    log("build", fname, "(%s via %s, tier %s)" % (bottle, pname, tier))
    if glbmode:
        spec, cap, info, base_glb = build_base_v2(name, bottle, d, tier)
        info = dict(info)
        liq_over = {}
        for k, v in d["liquid"].items():        # design overrides on the liquid extras / material
            k2 = "fill_default" if k == "fill" else k
            liq_over[k2] = info[k2] = DL.rgba(v, None) if k == "color" else v
    else:
        spec, cap, info = build_base(name, bottle, d)
    slots = {s["name"]: s for s in DS.SLOTS[bottle]}
    labels = list(d["labels"])
    cl = d["cap"].get("label")
    if cl:      # label on the cap -> the bottle's cap_top slot
        capslot = next(s["name"] for s in DS.SLOTS[bottle] if s["kind"] == "cap_top")
        labels.append(dict(cl, slot=capslot))
    resolved = DL.resolve_labels(dict(d, labels=labels), name)
    os.makedirs(os.path.join(OUT, "textures"), exist_ok=True)
    items = []
    for r in resolved:
        e = r["entry"]; sl = slots[r["slot"]]
        kind = e.get("material_kind", sl["material"])
        flip = e.get("flip", "")
        if flip and not sl["allow_flip"] and not e.get("force_flip"):
            log("  warning: slot %s does not allow_flip (text would mirror); applying anyway" % r["slot"])
        off = e.get("offset", [0, 0]); sc = e.get("scale", 1.0)
        geo = DS.slot_geometry(spec, sl, cap, rotation_deg=e.get("rotation_deg", 0.0), offset_mm=off, scale=sc)
        if flip:
            geo["uvs"] = [((1 - u) if "h" in flip else u, (1 - v) if "v" in flip else v) for u, v in geo["uvs"]]
        gap, ok = check_flush(spec, geo, sl)
        log("  Label_%s  %.1f x %.1f mm  aspect %.3f  kind %s  min gap over glass %.2f mm  outward normals %.0f%%" % (
            r["slot"], geo["width_m"] * 1000, geo["height_m"] * 1000, geo["aspect"], kind, gap * 1000 if gap < 1e8 else 0, ok * 100))
        items.append(dict(r=r, e=e, sl=sl, kind=kind, flip=flip, off=off, sc=sc, geo=geo))
    side = []

    def entry(it, tex_rel, mask_rel, amode, **kw):
        g = it["geo"]; e = it["e"]
        return dict(slot=it["r"]["slot"], texture=tex_rel, wear_mask=mask_rel, material_kind=it["kind"], tint=e.get("tint"), flip=it["flip"] or None,
                    offset_mm=it["off"], scale=it["sc"], rotation_deg=e.get("rotation_deg", 0.0), width_m=round(g["width_m"], 5),
                    height_m=round(g["height_m"], 5), aspect=round(g["aspect"], 4), arc_deg=round(g["arc_deg"], 2), alpha_mode=amode,
                    source=("generate" if "generate" in e else "image" if "image" in e else "placeholder"), empty=False, **kw)

    def props(obj, it):
        g = it["geo"]
        obj["slot"] = it["r"]["slot"]; obj["width_m"] = round(g["width_m"], 5); obj["height_m"] = round(g["height_m"], 5)
        obj["aspect"] = round(g["aspect"], 4); obj["arc_deg"] = round(g["arc_deg"], 2); obj["material_kind"] = it["kind"]

    if tier in ("high", "medium"):
        for it in items:
            r, e = it["r"], it["e"]
            tex_rel = "textures/%s_%s.png" % (fname, r["slot"])
            src = r["image"]
            if tier == "medium":
                a = px_load(src)
                if max(a.shape[:2]) > MEDIUM_MAX_PX:
                    k = MEDIUM_MAX_PX / max(a.shape[:2])
                    a = px_load(src, (max(2, int(a.shape[1] * k)), max(2, int(a.shape[0] * k))))
                px_save(a, os.path.join(OUT, tex_rel))
            else:
                shutil.copyfile(src, os.path.join(OUT, tex_rel))
            mask_rel = None
            if r["mask"] and tier == "high":
                mask_rel = "textures/%s_%s_wear.png" % (fname, r["slot"])
                shutil.copyfile(r["mask"], os.path.join(OUT, mask_rel))
            fin = e.get("finish")
            rough = e.get("roughness", FOIL_FINISH.get(fin) if fin else None)
            mat = label_material("Label_" + r["slot"], it["kind"], os.path.join(OUT, tex_rel), e.get("tint"), os.path.join(OUT, mask_rel) if mask_rel else None,
                                 rough=rough, metal=e.get("metallic"), blend=True if it["kind"] == "clear_film" else None, alpha_mode=e.get("alpha_mode"))
            props(make_mesh_object("Label_" + r["slot"], it["geo"], mat), it)
            side.append(entry(it, tex_rel, mask_rel, mat["alpha_mode"]))
        for s in d.get("spare_slots", []):     # invisible placeholders so a runtime image can be dropped into the slot
            if s in [i["r"]["slot"] for i in items]:
                continue
            sl = slots[s]
            geo = DS.slot_geometry(spec, sl, cap)
            tex_rel = "textures/_clear.png"
            shutil.copyfile(DL.placeholder("clear"), os.path.join(OUT, tex_rel))
            kind = sl["material"] if sl["material"] != "foil_metal" else "paper_gloss"
            mat = label_material("Label_" + s, kind, os.path.join(OUT, tex_rel), None, blend=True)
            obj = make_mesh_object("Label_" + s, geo, mat)
            obj["slot"] = s; obj["width_m"] = round(geo["width_m"], 5); obj["height_m"] = round(geo["height_m"], 5)
            obj["aspect"] = round(geo["aspect"], 4); obj["arc_deg"] = round(geo["arc_deg"], 2); obj["material_kind"] = kind; obj["empty"] = True
            side.append(dict(slot=s, texture=tex_rel, wear_mask=None, material_kind=kind, width_m=round(geo["width_m"], 5), height_m=round(geo["height_m"], 5),
                             aspect=round(geo["aspect"], 4), arc_deg=round(geo["arc_deg"], 2), alpha_mode="BLEND", source="spare", empty=True))
    elif tier == "low" and items:
        # ---- ONE mesh, ONE material, ONE atlas texture (<= ATLAS_PX^2); tint multiplied in, wear/foil/film differences are lost
        arrs = [px_load(it["r"]["image"]) for it in items]
        pos = None
        for AP in (256, 512, 1024):            # smallest power-of-two atlas that holds the labels at >= 50% linear scale
            for k in (1.0, 0.75, 0.5):
                sizes = [(max(8, int(a.shape[1] * k)), max(8, int(a.shape[0] * k))) for a in arrs]
                pos = shelf_pack(sizes, AP, AP)
                if pos: break
            if pos: break
        while not pos:
            k *= 0.9
            sizes = [(max(8, int(a.shape[1] * k)), max(8, int(a.shape[0] * k))) for a in arrs]
            pos = shelf_pack(sizes, AP, AP)
        ATLAS_PX = AP
        atlas = np.zeros((ATLAS_PX, ATLAS_PX, 4), dtype=np.float32)
        atlas[..., :3] = 0.5
        verts, uvs, faces = [], [], []
        slotmap = {}
        any_alpha = any_clear = False
        for it, a, (w, h), (x0, y0) in zip(items, arrs, sizes, pos):
            if (a.shape[1], a.shape[0]) != (w, h):
                a = px_load(it["r"]["image"], (w, h))
            t = DL.rgba(it["e"].get("tint"), [1, 1, 1, 1])
            a = a.copy(); a[..., :3] *= np.array([c ** (1 / 2.2) for c in t[:3]], dtype=np.float32)   # tint is linear, pixels sRGB-encoded
            atlas[y0:y0 + h, x0:x0 + w] = a
            any_alpha |= bool(a[..., 3].min() < 0.99); any_clear |= it["kind"] == "clear_film"
            g = it["geo"]; base = len(verts)
            verts += g["verts"]
            uvs += [((x0 + 0.5 + u * (w - 1)) / ATLAS_PX, (y0 + 0.5 + v * (h - 1)) / ATLAS_PX) for u, v in g["uvs"]]
            faces += [tuple(i + base for i in f) for f in g["faces"]]
            slotmap[it["r"]["slot"]] = dict(uv_rect=[round(x0 / ATLAS_PX, 5), round(y0 / ATLAS_PX, 5), round((x0 + w) / ATLAS_PX, 5), round((y0 + h) / ATLAS_PX, 5)],
                                            width_m=round(g["width_m"], 5), height_m=round(g["height_m"], 5), px=[w, h])
        used_h = max(y0 + h for (x0, y0), (w, h) in zip(pos, sizes))
        tex_rel = "textures/%s_atlas.png" % fname
        px_save(atlas, os.path.join(OUT, tex_rel))
        amode = "BLEND" if any_clear else "MASK" if any_alpha else "OPAQUE"
        mat = label_material("Labels", "paper_matte", os.path.join(OUT, tex_rel), None, rough=0.55, alpha_mode=amode)
        obj = make_mesh_object("Labels", dict(verts=verts, uvs=uvs, faces=faces), mat)
        obj["tier"] = "low"; obj["material_kind"] = "atlas"; obj["slots"] = json.dumps(slotmap)
        log("  atlas %dx%d (content to y=%d, scale %.2f) mode %s" % (ATLAS_PX, ATLAS_PX, used_h, k, amode))
        for it in items:
            side.append(entry(it, tex_rel, None, amode, atlas_rect=slotmap[it["r"]["slot"]]["uv_rect"]))
    elif tier == "minimal" and items:
        cand = [i for i in items if i["sl"]["kind"] in ("body", "wrap", "band", "shoulder", "neck")] or items
        it = max(cand, key=lambda i: i["geo"]["width_m"] * i["geo"]["height_m"])
        a = px_load(it["r"]["image"], (32, 32))
        al = a[..., 3:4]
        col = (a[..., :3] * al).sum((0, 1)) / max(al.sum(), 1e-6)
        col_lin = [float(c) ** 2.2 for c in col] + [1.0]
        sl = dict(it["sl"], arc=360.0)
        geo = DS.slot_geometry(spec, sl, cap)
        m = B.material("Label_band", col_lin, rough=0.6)
        obj = make_mesh_object("Label_band", geo, m)
        obj["slot"] = it["sl"]["name"]; obj["width_m"] = round(geo["width_m"], 5); obj["height_m"] = round(geo["height_m"], 5)
        obj["aspect"] = round(geo["aspect"], 4); obj["arc_deg"] = 360.0; obj["material_kind"] = "band"; obj["tier"] = "minimal"
        side.append(dict(slot="band", source_slot=it["sl"]["name"], texture=None, material_kind="band", colour_linear=col_lin, width_m=round(geo["width_m"], 5),
                         height_m=round(geo["height_m"], 5), alpha_mode="OPAQUE", empty=False))
    import design_glb
    glb = os.path.join(OUT, fname + ".glb")
    if glbmode:
        tmp = None
        if bpy.data.objects:
            tmp = os.path.join(OUT, "_labels_tmp.glb")
            bpy.ops.object.select_all(action="SELECT")
            bpy.ops.export_scene.gltf(filepath=tmp, export_format="GLB", export_extras=True, export_yup=True, export_apply=True, use_selection=True,
                                      export_image_format="AUTO")
        gt = DL.rgba(d["glass"]["tint"])[:3] if d["glass"].get("tint") else None
        design_glb.merge_glb(base_glb, tmp, glb, liquid=liq_over or None, glass_tint=gt, drop_nodes=prov.get("drop_nodes", ()))
        if tmp:
            os.remove(tmp)
    else:
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_extras=True, export_yup=True, export_apply=True, use_selection=True,
                                  export_image_format="AUTO")
    keymap = {("Label_" + s["slot"]): s for s in side}
    if tier == "low" and side:
        keymap["Labels"] = dict(side[0], slot="*")
    design_glb.postprocess(glb, keymap)
    if glbmode:
        base_calls = design_glb.stats(base_glb)["draw_calls"]
        stats = design_glb.stats(glb, base_calls)
        stats["base_glb"] = os.path.relpath(base_glb, ROOT).replace("\\", "/")
        bs = design_glb.stats(base_glb)             # the v2 bottle's own textures (normal map etc.) are not label cost: report both
        stats["base_tex_mem_kb_rgba8_mips"] = bs["tex_mem_kb_rgba8_mips"]; stats["base_draw_calls"] = bs["draw_calls"]
        stats["label_tex_mem_kb_rgba8_mips"] = stats["tex_mem_kb_rgba8_mips"] - bs["tex_mem_kb_rgba8_mips"]
        stats["label_tex_mem_kb_compressed_mips"] = stats["tex_mem_kb_compressed_mips"] - bs["tex_mem_kb_compressed_mips"]
        gl_ex = design_glb.node_extras(base_glb, "Glass").get("bv2", {})
        glass_info = dict(gl_ex, tint_override=d["glass"].get("tint"))
        cap_info = dict(type=gl_ex.get("cap") or prov["cap_type"](bottle))
    else:
        stats = design_glb.stats(glb)
        glass_info = json.loads(bpy.data.objects["Glass"]["glass"]); cap_info = json.loads(bpy.data.objects["Cap"]["cap"])
    json.dump(info, open(os.path.join(OUT, fname + ".liquid.json"), "w", encoding="utf-8"))
    sidecar = dict(name=name, tier=tier, bottle=bottle, asset=bottle, provider=pname, glb=fname + ".glb", liquid_sidecar=fname + ".liquid.json", meta=d["meta"], stats=stats,
                   glass=glass_info, cap=cap_info,
                   liquid={k: v for k, v in info.items() if k != "lut"}, labels=side, tex_note="textures are relative to this file; GLB embeds copies",
                   slots_available=[s["name"] for s in DS.SLOTS[bottle]])
    json.dump(sidecar, open(os.path.join(OUT, fname + ".design.json"), "w", encoding="utf-8"), indent=1)
    log("  stats", json.dumps(stats))
    return dict(id="design_" + name, family="bottle_design", file="export/designs/%s.glb" % name, design="export/designs/%s.design.json" % name,
                liquid="export/designs/%s.liquid.json" % name, base=prov["base_id"](bottle) if glbmode else "bottle_" + bottle, asset=bottle, provider=pname,
                labels=[s["slot"] for s in side if not s.get("empty")],
                tiers={"high": "export/designs/%s.glb" % name, "medium": "export/designs/%s_medium.glb" % name,
                       "low": "export/designs/%s_low.glb" % name, "minimal": "export/designs/%s_minimal.glb" % name},
                capacity_ml=round(info["capacity_ml"]), height_m=(spec["z_top"] if glbmode else spec["outer"][-1][1]), license="MIT"), stats



def merge_catalog(entries):
    p = os.path.join(ROOT, "catalog.json")
    cat = json.load(open(p, encoding="utf-8"))          # re-read right before writing (shared file)
    have = {a["id"]: a for a in cat["assets"]}
    for e in entries:
        have[e["id"]] = e
    cat["assets"] = sorted(have.values(), key=lambda a: a["id"])
    tmp = p + ".designs.tmp"
    json.dump(cat, open(tmp, "w", encoding="utf-8"), indent=2)
    os.replace(tmp, p)


# ---------------------------------------------------------------- slot overview renders
def render_slots(bottle):
    """Build the bare bottle with every slot as a numbered coloured debug patch, render front/back/top with Workbench."""
    import design_labels
    d = dict(bottle=bottle, glass={}, cap={}, liquid={}, labels=[], meta={})
    spec, cap, info = build_base("slots_" + bottle, bottle, d)
    for o in list(bpy.data.objects):
        if o.name == "Liquid":
            bpy.data.objects.remove(o)
    for ob in bpy.data.objects:
        mt = ob.data.materials[0]
        mt.diffuse_color = (0.78, 0.82, 0.85, 1) if ob.name == "Glass" else (0.5, 0.36, 0.22, 1)
    tmpdir = os.path.join(ROOT, "tests", "out", "_slots_tmp")
    os.makedirs(tmpdir, exist_ok=True)
    for i, sl in enumerate(DS.SLOTS[bottle]):
        png = os.path.join(tmpdir, "dbg_%s_%s.png" % (bottle, sl["name"]))
        DL.generate(bottle, sl["name"], {"template": "_slotdebug", "index": i + 1}, png)
        geo = DS.slot_geometry(spec, sl, cap)
        m = label_material("Label_" + sl["name"], "paper_matte", png, None)
        make_mesh_object("Label_" + sl["name"], geo, m)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "FLAT"; sh.color_type = "TEXTURE"; sh.show_object_outline = True
    sc.view_settings.view_transform = "Standard"
    sc.render.film_transparent = False
    sc.world = bpy.data.worlds.new("w"); sc.world.color = (0.16, 0.18, 0.21)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = "ORTHO"
    H = spec["outer"][-1][1] + 0.02
    cam.data.ortho_scale = H * 1.05
    sc.render.resolution_x, sc.render.resolution_y = 520, 760
    views = {"front": ((0, -1, H / 2 - 0.01), (math.pi / 2, 0, 0)), "right": ((1, 0, H / 2 - 0.01), (math.pi / 2, 0, math.pi / 2)),
             "back": ((0, 1, H / 2 - 0.01), (math.pi / 2, 0, math.pi)), "left": ((-1, 0, H / 2 - 0.01), (math.pi / 2, 0, -math.pi / 2))}
    files = []
    for v, (loc, rot) in views.items():
        cam.location, cam.rotation_euler = loc, rot
        sc.render.filepath = os.path.join(tmpdir, "%s_%s.png" % (bottle, v))
        bpy.ops.render.render(write_still=True)
        files.append(sc.render.filepath)
    if any(s["kind"] == "cap_top" for s in DS.SLOTS[bottle]):
        cam.location, cam.rotation_euler = (0, 0, cap["top_z"] + 1), (0, 0, 0)
        cam.data.ortho_scale = cap["r"] * 2.6
        sc.render.resolution_x = sc.render.resolution_y = 520
        sc.render.filepath = os.path.join(tmpdir, "%s_top.png" % bottle)
        bpy.ops.render.render(write_still=True)
        files.append(sc.render.filepath)
    log("slots rendered", bottle, files)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if argv and argv[0] == "--slots":
        for b in argv[1:] or list(DS.SLOTS):
            render_slots(b)
        return
    if argv and argv[0] == "--slots-table":
        os.system('python "%s"' % os.path.join(HERE, "design_slots.py"))
        return
    paths = []
    for a in argv:
        if a == "--tier":
            continue
        if a in TIERS or "," in a and a.split(",")[0] in TIERS:
            continue
        if a == "--all-tiers":
            continue
        if a == "--all":
            paths += sorted(glob.glob(os.path.join(ROOT, "designs", "*.bottle.json")))
        elif a == "--v2":        # only the designs on v2 GLB assets (designs/v2_*.bottle.json)
            paths += sorted(glob.glob(os.path.join(ROOT, "designs", "v2_*.bottle.json")))
        elif a == "--containers":  # only the designs on the non-lathe containers (designs/container_*.bottle.json)
            paths += sorted(glob.glob(os.path.join(ROOT, "designs", "container_*.bottle.json")))
        else:
            paths.append(a if os.path.isabs(a) else os.path.join(ROOT, a))
    if not paths:
        print(__doc__); return
    os.makedirs(OUT, exist_ok=True)
    tiers = ["high"]
    if "--tier" in argv:
        tiers = argv[argv.index("--tier") + 1].split(",")
    if "--all-tiers" in argv:
        tiers = list(TIERS)
    entries, table = [], {}
    for p in paths:
        for tr in tiers:
            e, st = build_design(p, tr)
            table.setdefault(os.path.basename(p).replace(".bottle.json", ""), {})[tr] = st
            if tr == "high":
                entries.append(e)
    if "--all-tiers" in argv:
        tp = os.path.join(OUT, "tier_stats.json")
        old = json.load(open(tp, encoding="utf-8")) if os.path.exists(tp) else {}
        old.update(table)                  # merge: building only the v2 designs keeps the old rows
        json.dump(old, open(tp, "w", encoding="utf-8"), indent=1)
    if entries:
        merge_catalog(entries)
    log("done", len(entries))


if __name__ == "__main__":
    main()
