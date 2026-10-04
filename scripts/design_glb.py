"""GLB post-processing helpers (pure python): read/write a .glb, patch materials."""
import json, struct


def read_glb(path):
    b = open(path, "rb").read()
    magic, ver, total = struct.unpack_from("<4sII", b, 0)
    assert magic == b"glTF"
    off = 12
    js, bin_ = None, b""
    while off < total:
        ln, tp = struct.unpack_from("<I4s", b, off)
        data = b[off + 8: off + 8 + ln]
        if tp == b"JSON": js = json.loads(data.decode("utf-8"))
        elif tp.startswith(b"BIN"): bin_ = data
        off += 8 + ln
    return js, bin_


def write_glb(path, js, bin_):
    j = json.dumps(js, separators=(",", ":")).encode("utf-8")
    j += b" " * (-len(j) % 4)
    bin_ += b"\x00" * (-len(bin_) % 4)
    total = 12 + 8 + len(j) + (8 + len(bin_) if bin_ else 0)
    out = struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(j), b"JSON") + j
    if bin_:
        out += struct.pack("<I4s", len(bin_), b"BIN\x00") + bin_
    open(path, "wb").write(out)


def postprocess(path, labels):
    """labels: {"Label_<slot>": sidecar entry}. Forces glTF alphaMode per label material (MASK/BLEND/OPAQUE)."""
    js, bin_ = read_glb(path)
    for m in js.get("materials", []):
        e = labels.get(m["name"])
        if not e:
            continue
        mode = e.get("alpha_mode", "OPAQUE")
        m.pop("alphaCutoff", None)
        if mode == "OPAQUE":
            m.pop("alphaMode", None)
        else:
            m["alphaMode"] = mode
            if mode == "MASK":
                m["alphaCutoff"] = 0.5
        m["extras"] = {"material_kind": e.get("material_kind"), "slot": e["slot"]}
    write_glb(path, js, bin_)

def _shift_tex(o, n):
    if isinstance(o, dict):
        for k, v in o.items():
            if k.endswith("Texture") and isinstance(v, dict) and "index" in v:
                v["index"] += n
            else:
                _shift_tex(v, n)
    elif isinstance(o, list):
        for v in o:
            _shift_tex(v, n)


def merge_glb(base_path, add_path, out_path, liquid=None, glass_tint=None, drop_nodes=()):
    """Append all nodes/meshes/materials/textures of `add_path` (labels, from Blender) to the untouched base GLB (a v2 bottle) and write
    `out_path`. Base nodes (Glass, Liquid, Cap, Bail, Cage, Stand, GlassCap) are not modified, except the optional design overrides:
    liquid = {color, fill_default, carbonation, ...} -> Liquid material colour + extras.liquid fields; glass_tint = [r,g,b] -> Glass attenuationColor."""
    a, ba = read_glb(base_path)
    if add_path is None:
        b, bb = dict(bufferViews=[], accessors=[], meshes=[], materials=[], nodes=[], scenes=[dict(nodes=[])]), b""
    else:
        b, bb = read_glb(add_path)
    pad = (-len(ba)) % 4
    ba = ba + bytes(pad)
    shift = len(ba)
    n = dict(bv=len(a["bufferViews"]), acc=len(a["accessors"]), mesh=len(a["meshes"]), mat=len(a["materials"]), tex=len(a.get("textures", [])),
             img=len(a.get("images", [])), smp=len(a.get("samplers", [])), node=len(a["nodes"]))
    for bv in b["bufferViews"]:
        bv["byteOffset"] = bv.get("byteOffset", 0) + shift; bv["buffer"] = 0
    for ac in b["accessors"]:
        if "bufferView" in ac: ac["bufferView"] += n["bv"]
    for m in b["meshes"]:
        for p in m["primitives"]:
            p["attributes"] = {k: v + n["acc"] for k, v in p["attributes"].items()}
            if "indices" in p: p["indices"] += n["acc"]
            if "material" in p: p["material"] += n["mat"]
    for im in b.get("images", []):
        if "bufferView" in im: im["bufferView"] += n["bv"]
    for t in b.get("textures", []):
        if "sampler" in t: t["sampler"] += n["smp"]
        t["source"] += n["img"]
    _shift_tex(b["materials"], n["tex"])
    for nd in b["nodes"]:
        if "mesh" in nd: nd["mesh"] += n["mesh"]
        if "children" in nd: nd["children"] = [c + n["node"] for c in nd["children"]]
    a["bufferViews"] += b["bufferViews"]; a["accessors"] += b["accessors"]; a["meshes"] += b["meshes"]; a["materials"] += b["materials"]
    for k in ("textures", "images", "samplers"):
        if b.get(k): a.setdefault(k, []); a[k] += b[k]
    if drop_nodes:      # unlink base placeholder nodes (e.g. a plain "Label" plate) from the scene; data stays, nothing renders it
        gone = {i for i, nd in enumerate(a["nodes"]) if nd.get("name") in drop_nodes}
        for sc in a["scenes"]:
            sc["nodes"] = [i for i in sc["nodes"] if i not in gone]
        for nd in a["nodes"]:
            if "children" in nd:
                nd["children"] = [i for i in nd["children"] if i not in gone]
                if not nd["children"]: nd.pop("children")
    a["nodes"] += b["nodes"]
    roots = b["scenes"][b.get("scene", 0)]["nodes"]
    a["scenes"][a.get("scene", 0)]["nodes"] += [r + n["node"] for r in roots]
    ext = set(a.get("extensionsUsed", [])) | set(b.get("extensionsUsed", []))
    if ext: a["extensionsUsed"] = sorted(ext)
    out_bin = ba + bb
    a["buffers"] = [dict(byteLength=len(out_bin))]
    if liquid or glass_tint:
        for nd in a["nodes"][:n["node"]]:
            if nd["name"] == "Liquid" and liquid:
                ex = json.loads(nd["extras"]["liquid"]); ex.update({k: v for k, v in liquid.items() if k in ex or k in ("opacity", "viscosity", "density", "tint_strength")})
                nd["extras"]["liquid"] = json.dumps(ex)
                if liquid.get("color"):
                    mat = a["materials"][a["meshes"][nd["mesh"]]["primitives"][0]["material"]]
                    mat["pbrMetallicRoughness"]["baseColorFactor"] = list(liquid["color"])
            if nd["name"] == "Glass" and glass_tint:
                mat = a["materials"][a["meshes"][nd["mesh"]]["primitives"][0]["material"]]
                v = mat.get("extensions", {}).get("KHR_materials_volume")
                if v: v["attenuationColor"] = list(glass_tint[:3])
                # runtimes without volume support (Godot's BottleLiquid glass shader reads the albedo) take the tint from baseColorFactor
                pbr = mat.setdefault("pbrMetallicRoughness", {})
                pbr["baseColorFactor"] = list(glass_tint[:3]) + [pbr.get("baseColorFactor", [1, 1, 1, 1])[3]]
    write_glb(out_path, a, out_bin)


def node_extras(path, name):
    js, _ = read_glb(path)
    for nd in js["nodes"]:
        if nd["name"] == name:
            return {k: (json.loads(v) if isinstance(v, str) and v[:1] in "{[" else v) for k, v in nd.get("extras", {}).items()}
    return {}


def stats(path, base_calls=3):
    """draw-call / texture-memory estimate for a built GLB (labels + glass/liquid/cap)."""
    import os, struct
    js, bin_ = read_glb(path)
    calls = sum(len(m["primitives"]) for m in js.get("meshes", []))
    px = 0
    sizes = []
    for im in js.get("images", []):
        bv = js["bufferViews"][im["bufferView"]]
        o = bv.get("byteOffset", 0)
        w, h = struct.unpack(">II", bin_[o + 16:o + 24])
        px += w * h; sizes.append([w, h])
    return dict(draw_calls=calls, label_draw_calls=max(0, calls - base_calls), textures=len(sizes), texture_sizes=sizes,
                tex_mem_kb_rgba8_mips=round(px * 4 * 1.333 / 1024), tex_mem_kb_compressed_mips=round(px * 1.0 * 1.333 / 1024),
                glb_kb=round(os.path.getsize(path) / 1024))
