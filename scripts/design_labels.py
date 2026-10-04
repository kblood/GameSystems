"""Design file loading, validation and label-image resolution (pure python, no bpy).

A label entry in a design is {slot, image | generate, material_kind, tint, offset, scale, rotation_deg, flip, wear}.
`generate` = {template, fields, seed, wear}: rendered by scripts/label_gen.py (Pillow). Blender has no Pillow, so when PIL is not
importable here the generator runs in a child python (system python / .venv).
"""
import hashlib, json, os, shutil, struct, subprocess, sys, zlib

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
MATERIAL_KINDS = ("paper_matte", "paper_gloss", "foil_metal", "clear_film", "plastic_sleeve", "tape", "handwritten_tag")
CAP_MATERIAL = {   # colour, roughness, metallic
    "cork": ((0.62, 0.45, 0.28, 1), 0.9, 0.0), "crown": ((0.55, 0.55, 0.58, 1), 0.35, 1.0), "screw": ((0.12, 0.12, 0.14, 1), 0.4, 0.0),
    "foil": ((0.78, 0.62, 0.18, 1), 0.28, 1.0), "wax": ((0.45, 0.04, 0.06, 1), 0.35, 0.0)}


def rgba(c, default=None):
    """'#rrggbb' | [r,g,b(,a)] (0..1, linear-ish authoring values as in bottles.py) -> 4-list."""
    if c is None:
        return default
    if isinstance(c, str):
        c = c.lstrip("#")
        v = [int(c[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
        v = [x ** 2.2 for x in v]            # hex is sRGB -> linear like the base-colour values in bottles.py
        return v + [1.0]
    c = list(c)
    return c + [1.0] if len(c) == 3 else c


def load_design(path):
    d = json.load(open(path, encoding="utf-8"))
    errs = validate(d, os.path.basename(path))
    if errs:
        raise ValueError("invalid design %s:\n  - %s" % (path, "\n  - ".join(errs)))
    d["asset"] = d.get("asset") or d["bottle"]       # `asset` = slot-table key (v1 lathe id like "wine", v2 "v2_bordeaux", future providers); `bottle` kept as alias
    d["bottle"] = d["asset"]
    d.setdefault("glass", {}); d.setdefault("cap", {}); d.setdefault("liquid", {}); d.setdefault("labels", []); d.setdefault("meta", {})
    return d


def validate(d, name=""):
    import design_slots as DS
    e = []
    asset = d.get("asset") or d.get("bottle")
    if asset not in DS.SLOTS:
        e.append("asset must be one of %s" % list(DS.SLOTS))
        return e
    if d.get("asset") and d.get("bottle") and d["asset"] != d["bottle"]:
        e.append("asset and bottle differ (use `asset` only)")
    names = {s["name"]: s for s in DS.SLOTS[asset]}
    v2 = DS.provider_of(asset)[1]["base"] == "glb"
    for k in d:
        if k not in ("$schema", "asset", "bottle", "lod_paths", "glass", "cap", "liquid", "labels", "meta", "spare_slots"):
            e.append("unknown key '%s'" % k)
    seen = set()
    for i, l in enumerate(d.get("labels", [])):
        if l.get("slot") not in names:
            e.append("labels[%d].slot '%s' is not a slot of %s (%s)" % (i, l.get("slot"), d["bottle"], ", ".join(names)))
            continue
        if l["slot"] in seen:
            e.append("labels[%d]: slot '%s' used twice" % (i, l["slot"]))
        seen.add(l["slot"])
        if "image" in l and "generate" in l:
            e.append("labels[%d]: use either image or generate, not both" % i)
        mk = l.get("material_kind")
        if mk and mk not in MATERIAL_KINDS:
            e.append("labels[%d].material_kind '%s' unknown (%s)" % (i, mk, ", ".join(MATERIAL_KINDS)))
        for o in names[l["slot"]]["overlaps"]:
            if any(x.get("slot") == o for x in d["labels"]):
                e.append("labels: '%s' overlaps '%s' on the glass" % (l["slot"], o))
    for s in d.get("spare_slots", []):
        if s not in names: e.append("spare_slots: unknown slot '%s'" % s)
    ct = d.get("cap", {}).get("type")
    if v2:
        if ct or d.get("cap", {}).get("label"):
            e.append("cap.type / cap.label are not supported for GLB-based assets (the v2 cap stays as exported; print on a `surface: cap` slot such as foil/capsule)")
    elif ct and ct not in ("cork", "crown", "screw", "foil", "wax"):
        e.append("cap.type '%s' unknown" % ct)
    for k, v in (d.get("lod_paths") or {}).items():
        if k not in ("high", "medium", "low", "minimal") or not isinstance(v, str):
            e.append("lod_paths: keys high|medium|low|minimal -> path string")
    return e


# ---------------------------------------------------------------- tiny PNG writer (placeholders, no PIL needed)
def write_png(path, w, h, rgba_px):
    raw = b"".join(b"\x00" + bytes(rgba_px) * w for _ in range(h))
    def chunk(t, data):
        c = struct.pack(">I", len(data)) + t + data
        return c + struct.pack(">I", zlib.crc32(t + data) & 0xffffffff)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def placeholder(kind):
    p = os.path.join(ROOT, "labels", "_placeholder_%s.png" % kind)
    if not os.path.exists(p):
        write_png(p, 4, 4, (255, 255, 255, 255) if kind == "white" else (255, 255, 255, 0))
    return p


# ---------------------------------------------------------------- generation
def _python():
    try:
        import PIL  # noqa
        return None
    except Exception:
        pass
    for c in (os.path.join(ROOT, ".venv", "Scripts", "python.exe"), shutil.which("python"), r"C:\Python313\python.exe"):
        if c and os.path.exists(c):
            return c
    raise RuntimeError("no python with Pillow found (pip install pillow, or create C:\\Tools\\BlenderShared\\.venv)")


def generate(bottle, slot, spec, out_png, mask_png=None):
    """Render a label with label_gen for (bottle, slot); returns (png, mask_png|None). Cached by spec hash."""
    key = hashlib.sha1(json.dumps([bottle, slot, spec, os.path.getmtime(os.path.join(ROOT, "scripts", "label_gen.py"))], sort_keys=True).encode()).hexdigest()[:12]
    stamp = out_png + ".stamp"
    if os.path.exists(out_png) and os.path.exists(stamp) and open(stamp).read() == key:
        return out_png, (mask_png if mask_png and os.path.exists(mask_png) else None)
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    py = _python()
    args = {"bottle": bottle, "slot": slot, "spec": spec, "out": out_png, "mask": mask_png}
    if py is None:
        sys.path.insert(0, os.path.join(ROOT, "scripts"))
        import label_gen
        label_gen.generate_from_args(args)
    else:
        r = subprocess.run([py, os.path.join(ROOT, "scripts", "label_gen.py"), "--json", json.dumps(args)], capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError("label_gen failed: " + r.stderr[-800:])
    open(stamp, "w").write(key)
    return out_png, (mask_png if mask_png and os.path.exists(mask_png) else None)


def resolve_labels(design, name):
    """-> list of dict(slot, image(abs), mask(abs|None), entry) in design order, generating images as needed."""
    out = []
    for l in design.get("labels", []):
        wear = float(l.get("wear", l.get("generate", {}).get("wear", 0.0) if "generate" in l else 0.0))
        mask = None
        if "generate" in l:
            g = dict(l["generate"]); g.setdefault("wear", wear)
            png = os.path.join(ROOT, "labels", "generated", "%s_%s.png" % (name, l["slot"]))
            mp = os.path.join(ROOT, "labels", "generated", "%s_%s_wear.png" % (name, l["slot"])) if g["wear"] > 0 else None
            png, mask = generate(design.get("asset") or design["bottle"], l["slot"], g, png, mp)
        elif "image" in l:
            png = l["image"] if os.path.isabs(l["image"]) else os.path.join(ROOT, l["image"])
            if not os.path.exists(png):
                raise FileNotFoundError("label image not found: %s" % png)
            if l.get("wear_mask"):
                mask = l["wear_mask"] if os.path.isabs(l["wear_mask"]) else os.path.join(ROOT, l["wear_mask"])
        else:
            png = placeholder("white")
        out.append(dict(slot=l["slot"], image=png, mask=mask, entry=l))
    return out
