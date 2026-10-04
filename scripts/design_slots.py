"""Label SLOT table + pure-python slot geometry for the bottle design system (no bpy, no PIL).

The slot table is DATA: SLOTS below (bottle id -> list of slot dicts). `python scripts/design_slots.py` writes the
resolved table (with measured width/height/aspect, texture size, cap-top radii) to designs/slots.json; engines and
label_gen.py read that file. The bottle profiles are read from scripts/bottles.py with `ast` (never imported/edited).

Slot fields
  name          node suffix: Label_<name>
  kind          body | neck | shoulder | band | wrap | tag | grad | cap_top
  z0, z1        height range on the outer lathe profile (m, base centre = 0)
  arc           degrees around the axis (360 = full wrap, u wraps 0..1 over 360, seam at the BACK)
  centre        centre angle in degrees: 0 = front (towards the viewer in glTF/Godot/three, +Z), 90 = bottle's right (+X), 180 = back
  offset_mm     height above the glass along the profile normal (thin paper ~0.35 mm)
  material      default label material kind (see design_materials in bottle_designer.py)
  allow_flip    UV mirroring is allowed (e.g. for symmetrical art); text labels should not be flipped
  px_per_cm     recommended texture resolution (pixels per centimetre of the physical label)
  overlaps      slots that occupy the same surface (use one or the other)
UV: u = 0..1 along +theta (viewed from outside: left -> right), v = 0..1 bottom -> top, stretched by SLANT length
(arc length along the profile), so an image with aspect = width_m/height_m is not distorted (circles stay circles;
on the conical neck/shoulder it is exact in v and exact per row in u, the unrolled cone is a fan - mean width is used).
cap_top slots are flat discs on the cap: u -> +X, v -> back (+glTF -Z), i.e. upright when seen from above with the
bottle front at the bottom of the picture.
"""
import ast, json, math, os, sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OFFSET_MM = 0.35


def load_bottles():
    src = open(os.path.join(ROOT, "scripts", "bottles.py"), encoding="utf-8").read()
    for node in ast.parse(src).body:
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", "") == "BOTTLES":
            def conv(n):
                if isinstance(n, ast.Call) and getattr(n.func, "id", "") == "dict":   # dict(outer=..., wall=...)
                    return {k.arg: conv(k.value) for k in n.keywords}
                if isinstance(n, ast.Dict):
                    return {ast.literal_eval(k): conv(v) for k, v in zip(n.keys, n.values)}
                return ast.literal_eval(n)
            return conv(node.value)
    raise RuntimeError("BOTTLES not found in bottles.py")


def S(name, kind, z0, z1, arc, centre, material, ppcm=80, overlaps=(), flip=False, notes="", offset_mm=OFFSET_MM, surface=None):
    d = dict(name=name, kind=kind, z0=z0, z1=z1, arc=arc, centre=centre, offset_mm=offset_mm, material=material,
             allow_flip=flip, px_per_cm=ppcm, overlaps=list(overlaps), notes=notes)
    if surface:
        d["surface"] = surface
    return d


SLOTS = {
    "wine": [
        S("front", "body", 0.050, 0.155, 130, 0, "paper_matte", 80, ["wrap"], notes="main label"),
        S("back", "body", 0.060, 0.140, 100, 180, "paper_matte", 80, notes="back label (centre 180 deg)"),
        S("neck", "neck", 0.245, 0.282, 200, 0, "paper_gloss", 100, notes="small collar on the tapered neck, follows the taper"),
        S("foil", "band", 0.290, 0.339, 360, 0, "foil_metal", 100, notes="capsule band around the neck, seam at the back"),
        S("cap", "cap_top", 0, 0, 360, 0, "paper_gloss", 100, notes="flat disc on top of the cork/capsule"),
    ],
    "beer": [
        S("front", "body", 0.035, 0.125, 150, 0, "paper_gloss", 80, ["wrap"]),
        S("back", "body", 0.045, 0.115, 120, 180, "paper_gloss", 80, ["wrap"]),
        S("neck", "neck", 0.212, 0.238, 200, 0, "paper_gloss", 100, notes="neck label"),
        S("wrap", "wrap", 0.020, 0.130, 360, 0, "paper_gloss", 60, ["front", "back"], notes="optional full wrap, seam at the back"),
        S("cap", "cap_top", 0, 0, 360, 0, "paper_gloss", 120, notes="flat disc on top of the crown cap"),
    ],
    "soda": [
        S("sleeve", "wrap", 0.022, 0.205, 360, 0, "plastic_sleeve", 60, notes="shrink sleeve, follows the shoulder, seam at the back"),
        S("neck_seal", "band", 0.246, 0.258, 360, 0, "plastic_sleeve", 100, notes="tamper band round the neck"),
        S("cap", "cap_top", 0, 0, 360, 0, "paper_gloss", 120, notes="flat disc on top of the cap"),
    ],
    "whiskey": [
        S("front", "body", 0.030, 0.120, 120, 0, "paper_matte", 80, notes="main label"),
        S("back", "body", 0.045, 0.105, 100, 180, "paper_matte", 80),
        S("neck", "neck", 0.192, 0.214, 160, 0, "handwritten_tag", 100, notes="neck tag / collar"),
        S("shoulder", "shoulder", 0.150, 0.185, 140, 0, "paper_gloss", 100, notes="strip over the shoulder curve"),
        S("cap", "cap_top", 0, 0, 360, 0, "paper_gloss", 100, notes="flat disc on top of the cork/stopper"),
    ],
    "jar": [
        S("wrap", "wrap", 0.022, 0.090, 360, 0, "paper_matte", 60, notes="full wrap label, seam at the back"),
        S("lid", "cap_top", 0, 0, 360, 0, "paper_gloss", 100, notes="flat disc on the lid"),
    ],
    "flask": [
        S("tag", "tag", 0.050, 0.062, 31, 0, "tape", 150, notes="label-printer strip ~30x12 mm"),
        S("tag_hand", "tag", 0.052, 0.088, 48, 58, "handwritten_tag", 100, notes="hand-written tag"),
        S("grad", "grad", 0.025, 0.115, 36, -52, "clear_film", 100, notes="graduation marks / white marking patch"),
        S("cap", "cap_top", 0, 0, 360, 0, "paper_gloss", 100, notes="flat disc on top of the stopper"),
    ],
}


# ---------------------------------------------------------------- v2 lathe bottles (provider "lathe_v2")
# asset id = "v2_<name>"; geometry from export/v2/bottle_<name>.glb (envelope of the Glass mesh rings, see v2_envelope()).
# `surface="cap"` slots wrap the Cap node (foil capsule) instead of the glass. Ribbed PET / contour use a bigger offset (0.9 mm).
RIB = 0.9
V2_SLOTS = {
    "v2_bordeaux": [
        S("front", "body", 0.060, 0.165, 130, 0, "paper_matte", 80, notes="main label, cylinder r~38 mm"),
        S("back", "body", 0.070, 0.150, 100, 180, "paper_matte", 80),
        S("neck", "neck", 0.232, 0.248, 200, 0, "paper_gloss", 100, notes="small collar below the capsule"),
        S("capsule", "band", 0.258, 0.299, 360, 0, "foil_metal", 100, notes="printed band on the foil capsule (surface = Cap)", surface="cap"),
    ],
    "v2_burgundy": [
        S("front", "body", 0.040, 0.125, 130, 0, "paper_matte", 80),
        S("back", "body", 0.050, 0.110, 100, 180, "paper_matte", 80),
        S("neck", "neck", 0.215, 0.243, 200, 0, "paper_gloss", 100, notes="collar on the sloping neck"),
    ],
    "v2_champagne": [
        S("front", "body", 0.055, 0.145, 130, 0, "paper_matte", 80),
        S("back", "body", 0.065, 0.130, 100, 180, "paper_matte", 80),
        S("neck", "neck", 0.185, 0.208, 120, 0, "paper_gloss", 100, notes="neck label under the foil"),
        S("foil", "band", 0.226, 0.283, 360, 0, "foil_metal", 100, notes="printed foil over the cork (surface = Cap); Cage stays untouched", surface="cap"),
    ],
    "v2_longneck": [
        S("front", "body", 0.035, 0.108, 150, 0, "paper_gloss", 80, ["wrap"]),
        S("back", "body", 0.045, 0.100, 120, 180, "paper_gloss", 80, ["wrap"]),
        S("neck", "neck", 0.163, 0.190, 200, 0, "paper_gloss", 100),
        S("wrap", "wrap", 0.030, 0.112, 360, 0, "paper_gloss", 60, ["front", "back"], notes="optional full wrap, seam at the back"),
    ],
    "v2_stubby": [
        S("front", "body", 0.025, 0.088, 150, 0, "paper_gloss", 80, ["wrap"]),
        S("back", "body", 0.032, 0.080, 120, 180, "paper_gloss", 80, ["wrap"]),
        S("wrap", "wrap", 0.022, 0.090, 360, 0, "paper_gloss", 60, ["front", "back"]),
    ],
    "v2_growler": [
        S("wrap", "wrap", 0.030, 0.108, 360, 0, "paper_matte", 45, ["front", "back"], notes="full wrap, 314 mm round the belly, seam at the back"),
        S("front", "body", 0.035, 0.105, 110, 0, "paper_matte", 70, ["wrap"]),
        S("back", "body", 0.045, 0.095, 90, 180, "paper_matte", 70, ["wrap"]),
    ],
    "v2_swingtop": [
        S("front", "body", 0.030, 0.115, 130, 0, "paper_gloss", 80, ["wrap"]),
        S("back", "body", 0.040, 0.105, 100, 180, "paper_gloss", 80, ["wrap"]),
        S("wrap", "wrap", 0.028, 0.120, 360, 0, "paper_gloss", 60, ["front", "back"]),
    ],
    "v2_pet500": [
        S("sleeve", "wrap", 0.040, 0.132, 360, 0, "plastic_sleeve", 60, ["front"], notes="shrink sleeve over the panel zone, seam at the back", offset_mm=RIB),
        S("front", "body", 0.0487, 0.0917, 140, 0, "paper_gloss", 80, ["sleeve"], notes="label inside the recessed panel only", offset_mm=RIB),
        S("neck_seal", "band", 0.176, 0.187, 360, 0, "plastic_sleeve", 100, notes="tamper band under the screw cap"),
    ],
    "v2_pet2l": [
        S("sleeve", "wrap", 0.060, 0.230, 360, 0, "plastic_sleeve", 40, ["front"], notes="shrink sleeve (327 x 170 mm), seam at the back", offset_mm=RIB),
        S("front", "body", 0.0795, 0.1975, 120, 0, "paper_gloss", 60, ["sleeve"], offset_mm=RIB),
    ],
    "v2_contour": [
        S("sleeve", "wrap", 0.058, 0.128, 360, 0, "plastic_sleeve", 60, ["front"], notes="sleeve follows the waist, seam at the back", offset_mm=RIB),
        S("front", "body", 0.0711, 0.1031, 100, 0, "paper_gloss", 80, ["sleeve"], notes="small panel label on the waist", offset_mm=RIB),
    ],
    "v2_milk": [
        S("wrap", "wrap", 0.030, 0.098, 360, 0, "paper_gloss", 50, ["front", "back"], notes="front wrap, seam at the back"),
        S("front", "body", 0.030, 0.100, 150, 0, "paper_gloss", 80, ["wrap"]),
        S("back", "body", 0.040, 0.090, 100, 180, "paper_gloss", 80, ["wrap"]),
    ],
    "v2_whisky": [
        S("front", "body", 0.050, 0.150, 120, 0, "paper_matte", 80),
        S("back", "body", 0.060, 0.140, 100, 180, "paper_matte", 80),
        S("neck", "neck", 0.222, 0.238, 160, 0, "handwritten_tag", 100, notes="tag / collar on the neck under the T-cork"),
    ],
    "v2_spirit": [
        S("front", "body", 0.050, 0.185, 120, 0, "paper_matte", 80),
        S("back", "body", 0.070, 0.170, 100, 180, "paper_matte", 80),
        S("neck", "neck", 0.262, 0.284, 200, 0, "paper_gloss", 100),
    ],
    "v2_apothecary": [
        S("front", "body", 0.016, 0.060, 120, 0, "paper_matte", 100, notes="small front label"),
        S("back", "body", 0.020, 0.055, 90, 180, "paper_matte", 100),
        S("tag", "tag", 0.082, 0.096, 100, 0, "handwritten_tag", 120, notes="hang tag on the shoulder/neck"),
    ],
    "v2_perfume": [
        S("front", "body", 0.020, 0.048, 90, 0, "paper_gloss", 120, notes="small front label"),
    ],
    "v2_mason": [
        S("front", "body", 0.026, 0.084, 100, 0, "paper_matte", 80, ["wrap"]),
        S("back", "body", 0.032, 0.078, 90, 180, "paper_matte", 80, ["wrap"]),
        S("wrap", "wrap", 0.026, 0.088, 360, 0, "paper_matte", 50, ["front", "back"]),
    ],
    "v2_cruet": [
        S("front", "body", 0.020, 0.062, 100, 0, "paper_matte", 100),
        S("neck", "neck", 0.105, 0.125, 150, 0, "handwritten_tag", 100),
    ],
    "v2_decanter": [
        S("tag", "tag", 0.176, 0.200, 100, 0, "handwritten_tag", 100, notes="hang tag on the neck"),
        S("front", "body", 0.040, 0.095, 60, 0, "paper_gloss", 80, notes="small crest on the conical body"),
    ],
    "v2_erlenmeyer": [
        S("front", "body", 0.030, 0.080, 80, 0, "paper_matte", 80),
        S("grad", "grad", 0.035, 0.130, 30, -50, "clear_film", 100, notes="graduation patch"),
        S("tag", "tag", 0.090, 0.102, 40, 38, "tape", 150, notes="label-printer strip"),
    ],
    "v2_roundflask": [
        S("tag", "tag", 0.033, 0.045, 36, 0, "tape", 150, notes="label-printer strip on the sphere"),
        S("grad", "grad", 0.032, 0.070, 30, -50, "clear_film", 100),
        S("tag_hand", "tag", 0.040, 0.066, 40, 50, "handwritten_tag", 100),
    ],
}
SLOTS.update(V2_SLOTS)


# ---------------------------------------------------------------- non-lathe containers (provider "container")
# asset id = "container_<name>" (export/container_<name>.glb, built by scripts/containers.py). The surface is a loft of rounded-rectangle
# rings (z, a, b, r, cx, cy) (+ the hip flask's bend), so these slots give `width_mm` (physical width along the ring perimeter) instead of
# relying on `arc`; `centre` is still an angle (0 front, 90 = +X): the label centre is where a ray from the axis at that angle meets the ring.
def CS(name, kind, z0, z1, width_mm, centre, material, ppcm=80, overlaps=(), notes="", offset_mm=OFFSET_MM, arc=None):
    d = S(name, kind, z0, z1, arc if arc is not None else 0.0, centre, material, ppcm, overlaps, notes=notes, offset_mm=offset_mm)
    if width_mm is not None:
        d["width_mm"] = width_mm
    return d


CONTAINER_SLOTS = {
    "container_square": [
        CS("front", "body", 0.028, 0.116, 50, 0, "paper_matte", 80, notes="front face (flat 55 mm between the 8.5 mm corners); replaces the base GLB's plain Label plate"),
        CS("back", "body", 0.040, 0.104, 46, 180, "paper_matte", 80),
        CS("neck", "neck", 0.1895, 0.2035, None, 0, "paper_gloss", 100, arc=200, notes="collar on the round neck under the T-cork"),
    ],
    "container_hipflask": [
        CS("front", "body", 0.020, 0.086, 64, 0, "paper_matte", 80, notes="front face, follows the 140 mm bend"),
        CS("back", "body", 0.030, 0.076, 52, 180, "paper_matte", 80),
    ],
    "container_jerrycan": [
        CS("panel", "body", 0.115, 0.225, 46, 56.9, "paper_gloss", 50, notes="front face, between the arms of the embossed X (x 92..138 mm)"),
        CS("end", "body", 0.100, 0.240, 90, 90, "paper_gloss", 50, notes="hazard / contents sticker on the +X end face (spout side)"),
        CS("end_back", "body", 0.100, 0.240, 90, 270, "paper_gloss", 50, notes="-X end face (handle side)"),
    ],
    "container_tumbler": [
        CS("front", "body", 0.022, 0.078, None, 0, "clear_film", 80, arc=100, notes="printed / etched decal on the tapered wall"),
    ],
    "container_mug": [
        CS("front", "body", 0.024, 0.082, None, 0, "paper_gloss", 80, arc=120, notes="ceramic decal, handle is at +X (90 deg), keep arc <= ~140"),
        CS("back", "body", 0.024, 0.082, None, 180, "paper_gloss", 80, arc=120),
    ],
    "container_tank": [
        CS("sticker", "body", 0.030, 0.090, 100, 55.7, "paper_gloss", 60, notes="maker / price sticker, lower right of the front pane"),
        CS("plate", "tag", 0.302, 0.322, 140, 0, "tape", 60, notes="name strip under the top frame"),
    ],
}
SLOTS.update(CONTAINER_SLOTS)


# ---------------------------------------------------------------- profile helpers
class Profile:
    """r(z) of the outer lathe profile (monotone in z; on equal z the larger r wins), slant length S(z)."""

    def __init__(self, outer):
        pts = sorted(((z, r) for r, z in outer), key=lambda p: (p[0], -p[1]))
        zs, rs = [], []
        for z, r in pts:
            if zs and abs(z - zs[-1]) < 1e-9:
                continue
            zs.append(z); rs.append(r)
        self.zs, self.rs = zs, rs
        self.zmin, self.zmax = zs[0], zs[-1]
        # fine slant table
        n = 2000
        self.tz = [self.zmin + (self.zmax - self.zmin) * i / n for i in range(n + 1)]
        self.ts = [0.0]
        for a, b in zip(self.tz[:-1], self.tz[1:]):
            self.ts.append(self.ts[-1] + math.hypot(self.r(b) - self.r(a), b - a))

    def r(self, z):
        z = min(max(z, self.zmin), self.zmax)
        zs, rs = self.zs, self.rs
        lo, hi = 0, len(zs) - 1
        while hi - lo > 1:
            m = (lo + hi) // 2
            if zs[m] <= z: lo = m
            else: hi = m
        t = (z - zs[lo]) / (zs[hi] - zs[lo])
        return rs[lo] + (rs[hi] - rs[lo]) * t

    def slope(self, z, d=0.0003):
        a, b = max(z - d, self.zmin), min(z + d, self.zmax)
        return (self.r(b) - self.r(a)) / (b - a)

    def S(self, z):
        z = min(max(z, self.zmin), self.zmax)
        i = min(int((z - self.zmin) / (self.zmax - self.zmin) * 2000), 1999)
        z0 = self.tz[i]; f = (z - z0) / (self.tz[i + 1] - z0)
        return self.ts[i] + (self.ts[i + 1] - self.ts[i]) * f

    def Zinv(self, s):
        s = min(max(s, 0.0), self.ts[-1])
        lo, hi = 0, len(self.ts) - 1
        while hi - lo > 1:
            m = (lo + hi) // 2
            if self.ts[m] <= s: lo = m
            else: hi = m
        f = (s - self.ts[lo]) / max(self.ts[hi] - self.ts[lo], 1e-12)
        return self.tz[lo] + (self.tz[hi] - self.tz[lo]) * f

    def breakpoints(self, z0, z1):
        return [z for z in self.zs if z0 + 1e-6 < z < z1 - 1e-6]


# ---------------------------------------------------------------- caps
CAP_TYPES = ("cork", "crown", "screw", "foil", "wax")


def cap_params(spec, ctype=None):
    """Cap geometry for bottle spec `spec` (an entry of BOTTLES) and a cap type. Returns dict(profile, r, z0, z1, top_r, top_z)."""
    lip_r, lip_z = spec["outer"][-1]
    nk, nr, nz0, nz1 = spec["cap"]
    ctype = ctype or nk
    if ctype == nk:
        r, z0, z1 = nr, nz0, nz1
    elif ctype == "cork":
        r, z0, z1 = 0.9 * lip_r, lip_z - 0.018, lip_z + 0.010
    elif ctype == "crown":
        r, z0, z1 = lip_r + 0.0023, lip_z - 0.006, lip_z + 0.0055
    elif ctype == "screw":
        r, z0, z1 = lip_r + 0.0012, lip_z - 0.012, lip_z + 0.005
    elif ctype == "foil":
        r, z0, z1 = lip_r + 0.0007, lip_z - 0.014, lip_z + 0.0035
    else:  # wax
        r, z0, z1 = lip_r + 0.0010, lip_z - 0.030, lip_z + 0.006
    if ctype == "cork":
        prof = [(0, z0), (r, z0), (r, z1 - 0.003), (r * 0.97, z1), (0, z1)]; top_r = r * 0.97 - 0.001
    elif ctype == "crown":
        prof = [(0, z0), (r, z0), (r, z0 + 0.006), (r * 0.9, z1), (0, z1)]; top_r = r * 0.9 - 0.0015
    elif ctype == "screw":
        prof = [(0, z0), (r, z0), (r, z1 - 0.002), (r - 0.002, z1), (0, z1)]; top_r = r - 0.004
    elif ctype == "foil":
        prof = [(r, z0), (r, z1 - 0.0012), (r - 0.0008, z1), (0, z1)]; top_r = r - 0.002
    else:
        prof = [(r * 0.985, z0), (r * 1.02, z0 + 0.004), (r * 1.03, z0 + 0.015), (r, z1 - 0.003), (r * 0.9, z1), (0, z1)]
        top_r = r * 0.9 - 0.001
    return dict(type=ctype, profile=prof, r=r, z0=z0, z1=z1, top_r=top_r, top_z=z1, closed=ctype not in ("foil", "wax"))


# ---------------------------------------------------------------- slot geometry
def slot_geometry(spec, slot, cap=None, rotation_deg=0.0, offset_mm=(0.0, 0.0), scale=(1.0, 1.0), max_step=0.002):
    """Return a dict(verts=[(x,y,z)], uvs=[(u,v)], faces=[(a,b,c,d)], width_m, height_m, aspect, ...) for a slot.
    Blender-space coordinates (Z up, front = -Y). Faces are quads with outward normals (CCW seen from outside)."""
    if spec.get("rings") and slot["kind"] != "cap_top":
        return rr_slot_geometry(spec, slot, rotation_deg, offset_mm, scale, max_step)
    outer = spec["outer"]
    sx, sy = (scale, scale) if isinstance(scale, (int, float)) else scale
    if slot["kind"] == "cap_top":
        cap = cap or cap_params(spec)
        R = cap["top_r"] * sx
        z = cap["top_z"] + slot["offset_mm"] * 0.001
        nseg, nrad = 48, 3
        verts, uvs, faces = [], [], []
        c = math.cos(math.radians(rotation_deg)); s = math.sin(math.radians(rotation_deg))
        ox, oy = offset_mm[0] * 0.001, offset_mm[1] * 0.001
        # rings from centre out; ring 0 is a single pole
        def put(x, y):
            verts.append((x * c - y * s + ox, x * s + y * c + oy, z)); uvs.append((0.5 + x / (2 * R), 0.5 + y / (2 * R)))
        put(0.0, 0.0)
        for k in range(1, nrad + 1):
            for i in range(nseg):
                a = 2 * math.pi * i / nseg
                put(R * k / nrad * math.cos(a), R * k / nrad * math.sin(a))
        for i in range(nseg):
            j = (i + 1) % nseg
            faces.append((0, 1 + i, 1 + j, 1 + j))   # tri encoded as degenerate quad
        for k in range(1, nrad):
            b0 = 1 + (k - 1) * nseg; b1 = 1 + k * nseg
            for i in range(nseg):
                j = (i + 1) % nseg
                faces.append((b0 + i, b0 + j, b1 + j, b1 + i))
        return dict(verts=verts, uvs=uvs, faces=faces, width_m=2 * R, height_m=2 * R, aspect=1.0, arc_deg=360.0, disc=True,
                    radius_m=R, z=z)
    if slot.get("surface") == "cap":
        outer = spec["cap_outer"]
    P = Profile(outer)
    z0, z1 = slot["z0"], slot["z1"]
    arc = slot["arc"]
    full = arc >= 359.999
    off = slot["offset_mm"] * 0.001
    zc = 0.5 * (z0 + z1) + offset_mm[1] * 0.001
    Sc = P.S(zc)
    H0 = P.S(z1) - P.S(z0)
    H = H0 * sy
    rows_t = None
    rot = 0.0 if full else rotation_deg
    # mean radius over the slot -> physical width
    zz = [z0 + (z1 - z0) * i / 20 for i in range(21)]
    rmean = sum(P.r(z) for z in zz) / 21
    W = math.radians(arc) * rmean * sx
    theta_c = math.radians(slot["centre"]) + offset_mm[0] * 0.001 / max(P.r(zc), 1e-4)
    verts, uvs, faces = [], [], []
    if abs(rot) < 1e-6:
        n_t = max(2, int(math.ceil(H / max_step)))
        ts = [(-0.5 + i / n_t) * H for i in range(n_t + 1)]
        bp = [P.S(z) - Sc for z in P.breakpoints(P.Zinv(Sc - 0.5 * H), P.Zinv(Sc + 0.5 * H))]
        ts = sorted(set([round(t, 7) for t in ts + bp]))
        n_u = max(4, int(math.ceil(math.radians(arc) * sx / math.radians(2.0))))
        for t in ts:
            z = P.Zinv(Sc + t)
            r = P.r(z); sl = P.slope(z)
            nr_, nz_ = 1.0 / math.hypot(1, sl), -sl / math.hypot(1, sl)
            rr, zo = r + off * nr_, z + off * nz_
            for i in range(n_u + 1):
                u = i / n_u
                th = theta_c + (u - 0.5) * math.radians(arc) * sx
                verts.append((rr * math.sin(th), -rr * math.cos(th), zo))
                uvs.append((u, t / H + 0.5))
        cols = n_u + 1
        for j in range(len(ts) - 1):
            for i in range(n_u):
                a = j * cols + i
                faces.append((a, a + 1, a + 1 + cols, a + cols))
    else:
        a_ = math.radians(rot); ca, sa = math.cos(a_), math.sin(a_)
        n_s = max(2, int(math.ceil(W / max_step))); n_t = max(2, int(math.ceil(H / max_step)))
        cols = n_s + 1
        for j in range(n_t + 1):
            for i in range(n_s + 1):
                s_ = (-0.5 + i / n_s) * W; t_ = (-0.5 + j / n_t) * H
                s2 = s_ * ca - t_ * sa; t2 = s_ * sa + t_ * ca
                z = P.Zinv(Sc + t2)
                r = P.r(z); sl = P.slope(z)
                nr_, nz_ = 1.0 / math.hypot(1, sl), -sl / math.hypot(1, sl)
                rr, zo = r + off * nr_, z + off * nz_
                th = theta_c + s2 / max(r, 1e-4)
                verts.append((rr * math.sin(th), -rr * math.cos(th), zo))
                uvs.append((i / n_s, j / n_t))
        for j in range(n_t):
            for i in range(n_s):
                a = j * cols + i
                faces.append((a, a + 1, a + 1 + cols, a + cols))
    return dict(verts=verts, uvs=uvs, faces=faces, width_m=W, height_m=H, aspect=W / H, arc_deg=arc * sx if not full else 360.0,
                z0=P.Zinv(Sc - 0.5 * H), z1=P.Zinv(Sc + 0.5 * H), disc=False)


# ---------------------------------------------------------------- rounded-rectangle ring surfaces (non-lathe containers)
class RingStack:
    """Loft of rounded-rectangle rings [(z, a, b, r, cx, cy)] (Blender space, half sizes a along X, b along Y), params lerped in z exactly like
    containers.py lofts them. Optional deform {"bend_x": R}: y -= x^2 / (2R) (hip flask). Perimeter parameter s: 0 at the front middle (-Y),
    increasing towards +X (CCW seen from above = left -> right seen from outside the front)."""

    def __init__(self, rings, deform=None):
        self.rings = sorted([tuple(r) + (0.0,) * (6 - len(r)) for r in rings], key=lambda r: r[0])
        self.R = (deform or {}).get("bend_x")

    def at(self, z):
        rs = self.rings
        if z <= rs[0][0]: return rs[0][1:]
        for p, q in zip(rs[:-1], rs[1:]):
            if z <= q[0]:
                t = (z - p[0]) / max(q[0] - p[0], 1e-12)
                return tuple(p[i] + (q[i] - p[i]) * t for i in range(1, 6))
        return rs[-1][1:]

    def breakpoints(self, z0, z1):
        return [r[0] for r in self.rings if z0 + 1e-6 < r[0] < z1 - 1e-6]

    @staticmethod
    def perimeter(a, b, r):
        return 4 * (a - r) + 4 * (b - r) + 2 * math.pi * r

    @staticmethod
    def point(a, b, r, s):
        """(x, y, nx, ny) at perimeter length s (any real; wraps)."""
        ar, br, q = a - r, b - r, 0.5 * math.pi * r
        segs = [("L", ar, (0.0, -b), (1, 0), (0, -1)), ("A", q, (ar, -br), -0.5 * math.pi), ("L", 2 * br, (a, -br), (0, 1), (1, 0)),
                ("A", q, (ar, br), 0.0), ("L", 2 * ar, (ar, b), (-1, 0), (0, 1)), ("A", q, (-ar, br), 0.5 * math.pi),
                ("L", 2 * br, (-a, br), (0, -1), (-1, 0)), ("A", q, (-ar, -br), math.pi), ("L", ar, (-ar, -b), (1, 0), (0, -1))]
        s %= RingStack.perimeter(a, b, r)
        for sg in segs:
            if s <= sg[1] + 1e-12 or sg is segs[-1]:
                if sg[0] == "L":
                    _, _, p0, d, n = sg
                    return p0[0] + d[0] * s, p0[1] + d[1] * s, n[0], n[1]
                _, _, c, f0 = sg
                f = f0 + s / max(r, 1e-9)
                return c[0] + r * math.cos(f), c[1] + r * math.sin(f), math.cos(f), math.sin(f)
            s -= sg[1]

    def s_of_angle(self, z, deg):
        """perimeter position where the ray from the ring centre at `deg` (0 front, 90 +X) meets the ring."""
        a, b, r, cx, cy = self.at(z)
        P = self.perimeter(a, b, r)
        best, bs = 1e9, 0.0
        n = 2048
        for i in range(n):
            s = P * i / n
            x, y, _, _ = self.point(a, b, r, s)
            d = (math.degrees(math.atan2(x, -y)) - deg + 180.0) % 360.0 - 180.0
            if abs(d) < best: best, bs = abs(d), s
        return bs

    def surf(self, z, frac, off):
        """point at perimeter fraction `frac` of ring z, pushed `off` metres out along the (deformed) surface normal."""
        a, b, r, cx, cy = self.at(z)
        P = self.perimeter(a, b, r)
        x, y, nx, ny = self.point(a, b, r, frac * P)
        # z tilt of the wall (tapered rings): finite difference at the same perimeter fraction
        dz = 0.0005
        a1, b1, r1, _, _ = self.at(z + dz); a0, b0, r0, _, _ = self.at(z - dz)
        p1 = self.point(a1, b1, r1, frac * self.perimeter(a1, b1, r1)); p0 = self.point(a0, b0, r0, frac * self.perimeter(a0, b0, r0))
        k = ((p1[0] - p0[0]) * nx + (p1[1] - p0[1]) * ny) / (2 * dz)
        nz = -k
        x += cx; y += cy
        if self.R:                       # bend: (x, y) -> (x, y - x^2/2R); normals transform with the inverse transpose
            nx, ny = nx + x / self.R * ny, ny
            y -= x * x / (2 * self.R)
        L = math.sqrt(nx * nx + ny * ny + nz * nz)
        return x + off * nx / L, y + off * ny / L, z + off * nz / L

    def gap(self, x, y, z):
        """signed distance (m) of a point to the surface in the ring plane (positive = outside); bend inverted approximately."""
        a, b, r, cx, cy = self.at(z)
        if self.R:
            y += x * x / (2 * self.R)
        qx, qy = abs(x - cx) - (a - r), abs(y - cy) - (b - r)
        return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r


def rr_slot_geometry(spec, slot, rotation_deg=0.0, offset_mm=(0.0, 0.0), scale=(1.0, 1.0), max_step=0.002):
    """slot_geometry() for RingStack specs. u along the perimeter (left -> right seen from outside), v bottom -> top by wall length.
    rotation_deg is not supported on these surfaces (ignored)."""
    RS = RingStack(spec["rings"], spec.get("deform"))
    sx, sy = (scale, scale) if isinstance(scale, (int, float)) else scale
    off = slot["offset_mm"] * 0.001
    z0, z1 = slot["z0"], slot["z1"]
    zc = 0.5 * (z0 + z1) + offset_mm[1] * 0.001
    hz0, hz1 = zc - 0.5 * (z1 - z0) * sy, zc + 0.5 * (z1 - z0) * sy        # scale in z (walls are near-vertical where slots go)
    a, b, r, _, _ = RS.at(zc)
    Pc = RS.perimeter(a, b, r)
    full = slot.get("arc", 0) >= 359.999
    if full:
        W = Pc
    elif slot.get("width_mm"):
        W = slot["width_mm"] * 0.001 * sx
    else:
        W = slot["arc"] / 360.0 * Pc * sx
    fc = (RS.s_of_angle(zc, slot["centre"]) + offset_mm[0] * 0.001) / Pc
    n_t = max(2, int(math.ceil((hz1 - hz0) / max_step)))
    zs = sorted(set([round(hz0 + (hz1 - hz0) * i / n_t, 7) for i in range(n_t + 1)] + [round(z, 7) for z in RS.breakpoints(hz0, hz1)]))
    n_u = max(4, int(math.ceil(W / max_step)))
    verts, uvs, faces, rowlen = [], [], [], [0.0]
    for j, z in enumerate(zs):
        a, b, r, _, _ = RS.at(z)
        P = RS.perimeter(a, b, r)
        for i in range(n_u + 1):
            u = i / n_u
            verts.append(RS.surf(z, fc + (u - 0.5) * W / P, off))
        if j:   # wall length along the centre column -> v
            c0 = verts[(j - 1) * (n_u + 1) + n_u // 2]; c1 = verts[j * (n_u + 1) + n_u // 2]
            rowlen.append(rowlen[-1] + math.dist(c0, c1))
    H = rowlen[-1]
    for j in range(len(zs)):
        for i in range(n_u + 1):
            uvs.append((i / n_u, rowlen[j] / H))
    cols = n_u + 1
    for j in range(len(zs) - 1):
        for i in range(n_u):
            q = j * cols + i
            faces.append((q, q + 1, q + 1 + cols, q + cols))
    return dict(verts=verts, uvs=uvs, faces=faces, width_m=W, height_m=H, aspect=W / H, arc_deg=360.0 if full else 360.0 * W / Pc,
                z0=hz0, z1=hz1, disc=False)


# ---------------------------------------------------------------- providers (extension point)
V2_DIR = os.path.join(ROOT, "export", "v2")


def v2_names():
    return [a[3:] for a in V2_SLOTS]


import numpy as np


def _ring_envelope(positions, tol=0.00003):
    """(N,3) glTF positions -> [(r, z)] ring-maximum radius per height cluster (0.25 mm), collinear points dropped."""
    z = positions[:, 1]; r = np.hypot(positions[:, 0], positions[:, 2])
    key = np.round(z / 0.00025).astype(int)
    pts = []
    for k in np.unique(key):
        m = key == k
        pts.append((float(r[m].max()), float(z[m].mean())))
    pts.sort(key=lambda p: p[1])
    out = [pts[0]]
    for i in range(1, len(pts) - 1):      # drop points within `tol` of the chord of their neighbours
        (r0, z0), (r1, z1), (r2, z2) = out[-1], pts[i], pts[i + 1]
        t = (z1 - z0) / max(z2 - z0, 1e-9)
        if abs(r0 + (r2 - r0) * t - r1) > tol:
            out.append(pts[i])
    out.append(pts[-1])
    return [(round(a, 5), round(b, 5)) for a, b in out]


def v2_envelope(name, node="Glass"):
    """Outer radius envelope of a v2 GLB node, [(r, z)] metres. profile.json `outer` is a coarse polyline (up to ~2 mm off on curves), so the
    slots follow the actual mesh rings (max over azimuth: labels never sink into ribs; grooves leave < 1 mm air)."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from design_v2_probe import mesh_positions
    pn = mesh_positions(os.path.join(V2_DIR, "bottle_%s.glb" % name), node, normals=True)
    P, N = pn[:, :3], pn[:, 3:]
    rad = N[:, 0] * P[:, 0] + N[:, 2] * P[:, 2]            # outer wall: normal has a positive radial part (inner wall faces the axis)
    keep = rad > 0.02 * np.hypot(P[:, 0], P[:, 2]) if node == "Glass" else np.ones(len(P), bool)
    # gate with the (coarse) profile.json outer: drops punt / underside / feet points that are far from the body surface
    prof = json.load(open(os.path.join(V2_DIR, "bottle_%s.profile.json" % name), encoding="utf-8"))
    o = prof["outer"] if node == "Glass" else None
    if o is not None:
        k = len(o) - 1
        while k > 0 and o[k - 1][1] <= o[k][1] + 1e-9:
            k -= 1
        suf = sorted((z, r) for r, z in o[k:])
        rp = np.interp(P[:, 1], [a for a, b in suf], [b for a, b in suf])
        keep &= (np.abs(np.hypot(P[:, 0], P[:, 2]) - rp) < 0.004) & (P[:, 1] >= suf[0][0])
    if node != "Glass":      # cap: keep only vertices outside the glass envelope (drops the cork inside a foil, inner skirt faces)
        ge = np.array(v2_envelope(name, "Glass"))
        gr = np.interp(P[:, 1], ge[:, 1], ge[:, 0])
        keep &= np.hypot(P[:, 0], P[:, 2]) > gr - 0.0003
    return _ring_envelope(P[keep])


def v2_spec(asset):
    name = asset[3:]
    prof = json.load(open(os.path.join(V2_DIR, "bottle_%s.profile.json" % name), encoding="utf-8"))
    spec = dict(outer=v2_envelope(name), z_top=prof["z_top"], label_zone=prof.get("label_zone"), label_panel=prof.get("label_panel"),
                capacity_ml=prof.get("capacity_ml"), profile_json="export/v2/bottle_%s.profile.json" % name)
    if any(s.get("surface") == "cap" for s in SLOTS[asset]):
        spec["cap_outer"] = v2_envelope(name, "Cap")
    return spec


def v2_tier_paths(asset, lod_paths=None):
    """label tier -> GLB path (relative to ROOT). HIGH = full v2 mesh, MEDIUM = lod1, LOW and MINIMAL = lod2."""
    n = asset[3:]
    d = {"high": "export/v2/bottle_%s.glb" % n, "medium": "export/v2/bottle_%s_lod1.glb" % n,
         "low": "export/v2/bottle_%s_lod2.glb" % n, "minimal": "export/v2/bottle_%s_lod2.glb" % n}
    d.update(lod_paths or {})
    return d


def lathe_v1_spec(asset):
    return load_bottles()[asset]


def lathe_v1_tier_paths(asset, lod_paths=None):
    d = {t: "export/bottle_%s.glb" % asset for t in ("high", "medium", "low", "minimal")}
    d.update(lod_paths or {})
    return d


def container_spec(asset):
    """rings of the container's outer shell straight from scripts/containers.py (pure python import, no bpy)."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import containers as CT
    name = asset[len("container_"):]
    S_ = CT.SPECS[name][0](None)
    rings = [[round(v, 6) for v in (r.z, r.a, r.b, r.r, r.cx, r.cy)] for r in S_["outer"]]
    deform = {"bend_x": CT.BEND_R} if name == "hipflask" else None
    return dict(rings=rings, deform=deform, z_top=S_["lip_z"], shell=S_["shell"], source="scripts/containers.py spec_%s" % name)


def container_tier_paths(asset, lod_paths=None):
    """HIGH = container_<n>.glb; the containers only have one LOD (lod1), used for MEDIUM, LOW and MINIMAL."""
    d = {"high": "export/%s.glb" % asset}
    d.update({t: "export/%s_lod1.glb" % asset for t in ("medium", "low", "minimal")})
    d.update(lod_paths or {})
    return d


CONTAINER_CAPS = {"container_square": "cork", "container_hipflask": "screw", "container_jerrycan": "screw"}

# A provider turns an asset id into (a) slot geometry data and (b) the base GLB per tier. See docs/bottle_designs.md "Adding a provider".
#   match(asset)       -> bool, claims an asset id (asset must also have rows in SLOTS)
#   spec(asset)        -> dict with EITHER "outer" [(r, z)] (surface of revolution; optional "cap_outer")
#                         OR "rings" [(z, a, b, r, cx, cy)] (+ optional "deform") (rounded-rectangle loft, see RingStack); plus "z_top"
#   tier_paths(asset, lod_paths=None) -> {"high","medium","low","minimal": path relative to ROOT of the base GLB}
#   base               -> "rebuild" (lathe_v1: designer rebuilds glass/cap/liquid) | "glb" (labels merged into the untouched GLB)
#   base_id(asset)     -> catalog id of the base asset (glb providers)
#   cap_type(asset)    -> informational cap type for the sidecar (glb providers)
#   drop_nodes         -> base GLB nodes hidden in a design (e.g. the square flask's plain placeholder "Label" plate)
PROVIDERS = {
    "lathe_v1": dict(match=lambda a: not a.startswith(("v2_", "container_")), spec=lathe_v1_spec, tier_paths=lathe_v1_tier_paths, base="rebuild"),
    "lathe_v2": dict(match=lambda a: a.startswith("v2_"), spec=v2_spec, tier_paths=v2_tier_paths, base="glb",
                     base_id=lambda a: "bottle_v2_" + a[3:],
                     cap_type=lambda a: json.load(open(os.path.join(V2_DIR, "bottle_%s.profile.json" % a[3:]), encoding="utf-8")).get("cap"),
                     drop_nodes=()),
    "container": dict(match=lambda a: a.startswith("container_"), spec=container_spec, tier_paths=container_tier_paths, base="glb",
                      base_id=lambda a: a, cap_type=lambda a: CONTAINER_CAPS.get(a), drop_nodes=("Label",)),
}


def provider_of(asset):
    for k, p in PROVIDERS.items():
        if asset in SLOTS and p["match"](asset):
            return k, p
    raise KeyError("unknown asset %r (known: %s)" % (asset, ", ".join(SLOTS)))


def slots_for(asset):
    """Resolved slot table of one asset (== designs/slots.json -> bottles[asset]):
    {provider, height_m, slots:[{name, kind, z0, z1, arc, centre, offset_mm, material, allow_flip, px_per_cm, overlaps, width_m, height_m,
    aspect, tex_w, tex_h, [surface], [radius_m]}], [outer, cap_outer, label_zone, label_panel, profile_json for glb providers]}"""
    pname, prov = provider_of(asset)
    spec = prov["spec"](asset)
    cap = cap_params(spec) if pname == "lathe_v1" else None
    res = []
    for sl in SLOTS[asset]:
        g = slot_geometry(spec, sl, cap)
        d = dict(sl)
        d.update(width_m=round(g["width_m"], 5), height_m=round(g["height_m"], 5), aspect=round(g["aspect"], 4),
                 tex_w=int(round(g["width_m"] * 100 * sl["px_per_cm"] / 2) * 2),
                 tex_h=int(round(g["height_m"] * 100 * sl["px_per_cm"] / 2) * 2))
        if sl["kind"] == "cap_top":
            d.update(z0=round(cap["top_z"], 5), z1=round(cap["top_z"], 5), radius_m=round(g["radius_m"], 5))
        else:
            d.update(z0=round(sl["z0"], 5), z1=round(sl["z1"], 5))
        res.append(d)
    out = dict(provider=pname, height_m=spec["outer"][-1][1] if pname == "lathe_v1" else spec["z_top"], slots=res)
    if "rings" in spec:
        out.update(surface="rings", rings=spec["rings"], deform=spec["deform"], shell=spec["shell"], source=spec["source"])
    if pname == "lathe_v2":
        out["outer"] = spec["outer"]
        if "cap_outer" in spec:
            out["cap_outer"] = spec["cap_outer"]
        out.update(label_zone=spec["label_zone"], label_panel=spec["label_panel"], profile_json=spec["profile_json"])
    return out


def spec_for(asset):
    """Geometry spec used by slot_geometry() at build time: lathe_v1 reads bottles.py, GLB providers read designs/slots.json (no GLB parsing)."""
    pname, prov = provider_of(asset)
    if pname == "lathe_v1":
        return prov["spec"](asset)
    t = json.load(open(os.path.join(ROOT, "designs", "slots.json"), encoding="utf-8"))["bottles"][asset]
    if "rings" in t:
        return dict(rings=[tuple(r) for r in t["rings"]], deform=t.get("deform"), z_top=t["height_m"])
    return dict(outer=[tuple(p) for p in t["outer"]], cap_outer=[tuple(p) for p in t.get("cap_outer", [])] or None, z_top=t["height_m"])


def resolve_table():
    out = {"version": 2, "angle_convention": "centre angle 0 = front (+Z in glTF), 90 = +X (bottle's right as seen from the front), 180 = back",
           "uv_convention": "u 0..1 along +angle (left->right seen from outside), v 0..1 bottom->top; cap_top: u=+X, v=back",
           "texture": "sRGB PNG/JPG, alpha straight (not premultiplied); size = round(width_cm*px_per_cm) x round(height_cm*px_per_cm)",
           "bottles": {}}
    for b in SLOTS:
        out["bottles"][b] = slots_for(b)
    return out


if __name__ == "__main__":
    t = resolve_table()
    p = os.path.join(ROOT, "designs", "slots.json")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    json.dump(t, open(p, "w", encoding="utf-8"), indent=1)
    for b, v in t["bottles"].items():
        for s in v["slots"]:
            print(f"{b:14s} {s['name']:10s} {s['kind']:9s} {s['width_m']*1000:6.1f} x {s['height_m']*1000:6.1f} mm  aspect {s['aspect']:.3f}  tex {s['tex_w']}x{s['tex_h']}")
    print("wrote", p)
