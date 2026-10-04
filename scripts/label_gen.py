"""Procedural label art for the bottle design system (Python + Pillow). All brands/emblems are ORIGINAL and fictional.

    python scripts/label_gen.py --library          # starter library -> labels/*.png (+ .meta.json, wear masks)
    python scripts/label_gen.py --templates        # authoring templates with safe-area guides -> labels/templates/<bottle>_<slot>_template.png
    python scripts/label_gen.py --one wine front wine_classic [--fields '{"brand":"X"}'] [--wear 0.4] [--out f.png]
    python scripts/label_gen.py --list

Driven from a design: "label": {"slot": "front", "generate": {"template": "wine_classic", "fields": {...}, "seed": 3, "wear": 0.3}}.
Texture size = slot physical size (designs/slots.json) x px_per_cm, so aspect is exact. Authoring unit inside templates = millimetres.
Fonts: Windows system fonts are used ONLY to rasterise the PNGs locally; font files are never copied/embedded (see docs).
"""
import os, sys, json, math, random, hashlib
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
FD = r"C:\Windows\Fonts"
FONTS = {  # role -> file (Microsoft system fonts, used locally to render PNGs only)
    "serif": "georgia.ttf", "serif_b": "georgiab.ttf", "serif_i": "georgiai.ttf", "serif_bi": "georgiaz.ttf",
    "times": "times.ttf", "times_b": "timesbd.ttf", "times_i": "timesi.ttf",
    "sans": "segoeui.ttf", "sans_b": "segoeuib.ttf", "sans_l": "segoeuil.ttf", "impact": "impact.ttf", "bahn": "bahnschrift.ttf",
    "script": "segoesc.ttf", "script_b": "segoescb.ttf", "hand": "Inkfree.ttf", "print": "segoepr.ttf", "display": "Gabriola.ttf",
    "mono": "consola.ttf", "mono_b": "consolab.ttf", "arial_b": "arialbd.ttf",
}
ROUGH = {"paper_matte": 0.85, "paper_gloss": 0.25, "foil_metal": 0.28, "clear_film": 0.12, "plastic_sleeve": 0.16, "tape": 0.40, "handwritten_tag": 0.95}


def _font(role, px):
    px = max(4, int(px))
    for name in (FONTS.get(role, role), "segoeui.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(os.path.join(FD, name), px)
        except Exception:
            continue
    return ImageFont.load_default()


# ================================================================== canvas
class Ctx:
    def __init__(self, W, H, ppcm, fields, rng, ss=1):
        self.ss, self.rng, self.f = ss, rng, fields
        self.W, self.H = W * ss, H * ss
        self.px = ppcm * ss / 10.0          # pixels per mm
        self.w, self.h = W / ppcm * 10.0, H / ppcm * 10.0   # physical size in mm
        self.img = Image.new("RGBA", (self.W, self.H), (255, 255, 255, 255))
        self.d = ImageDraw.Draw(self.img)
        self.paper = (240, 232, 214)

    def p(self, mm): return mm * self.px
    def xy(self, *v): return [self.p(a) for a in v]

    def fill(self, col): self.d.rectangle([0, 0, self.W, self.H], fill=col)

    def rect(self, x0, y0, x1, y1, fill=None, outline=None, w=0.3, r=0):
        b = self.xy(x0, y0, x1, y1)
        if r:
            self.d.rounded_rectangle(b, radius=self.p(r), fill=fill, outline=outline, width=max(1, int(self.p(w))) if outline else 0)
        else:
            self.d.rectangle(b, fill=fill, outline=outline, width=max(1, int(self.p(w))) if outline else 0)

    def ell(self, cx, cy, rx, ry=None, fill=None, outline=None, w=0.3):
        ry = rx if ry is None else ry
        self.d.ellipse(self.xy(cx - rx, cy - ry, cx + rx, cy + ry), fill=fill, outline=outline, width=max(1, int(self.p(w))) if outline else 0)

    def poly(self, pts, fill=None, outline=None, w=0.3):
        self.d.polygon([(self.p(x), self.p(y)) for x, y in pts], fill=fill, outline=outline)

    def line(self, x0, y0, x1, y1, fill=(0, 0, 0), w=0.3):
        self.d.line(self.xy(x0, y0, x1, y1), fill=fill, width=max(1, int(self.p(w))))

    def border(self, inset, w, col, double=0.0, r=0):
        self.rect(inset, inset, self.w - inset, self.h - inset, outline=col, w=w, r=r)
        if double:
            self.rect(inset + double, inset + double, self.w - inset - double, self.h - inset - double, outline=col, w=w * 0.45, r=max(0, r - double))

    def text(self, x, y, s, role="serif", size=5.0, fill=(0, 0, 0), anchor="mm", spacing=0.0, maxw=None, stroke=0, stroke_fill=None):
        """size = em height in mm; maxw (mm) shrinks to fit. spacing = extra letter spacing (em fractions)."""
        def width(sz):
            fnt = _font(role, self.p(sz))
            if spacing:
                return sum(fnt.getlength(c) for c in s) + spacing * self.p(sz) * (len(s) - 1)
            return fnt.getlength(s)
        if maxw:
            while width(size) > self.p(maxw) and size > 0.5:
                size *= 0.96
        fnt = _font(role, self.p(size))
        if not spacing:
            self.d.text((self.p(x), self.p(y)), s, font=fnt, fill=fill, anchor=anchor, stroke_width=int(self.p(stroke)), stroke_fill=stroke_fill)
            return size
        tw = width(size)
        x0 = self.p(x) - (tw / 2 if anchor[0] == "m" else tw if anchor[0] == "r" else 0)
        for c in s:
            self.d.text((x0, self.p(y)), c, font=fnt, fill=fill, anchor="l" + anchor[1])
            x0 += fnt.getlength(c) + spacing * self.p(size)
        return size

    def para(self, x, y, lines, role="sans", size=2.2, fill=(0, 0, 0), lead=1.35, anchor="la", maxw=None):
        for i, ln in enumerate(lines):
            self.text(x, y + i * size * lead, ln, role, size, fill, anchor, maxw=maxw)

    def rot_text(self, x, y, s, role, size, fill, angle):
        """text on a rotated layer (angle in degrees, ccw)."""
        fnt = _font(role, self.p(size))
        tw = int(fnt.getlength(s)) + 8; th = int(self.p(size) * 1.6)
        lay = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
        ImageDraw.Draw(lay).text((tw / 2, th / 2), s, font=fnt, fill=fill, anchor="mm")
        lay = lay.rotate(angle, expand=True, resample=Image.BICUBIC)
        self.img.alpha_composite(lay, (int(self.p(x) - lay.width / 2), int(self.p(y) - lay.height / 2)))

    # ---- decorative pieces
    def stripes(self, x0, y0, x1, y1, step, w, col, angle=0):
        lay = Image.new("RGBA", (int(self.p(x1 - x0)), int(self.p(y1 - y0))), (0, 0, 0, 0)); dd = ImageDraw.Draw(lay)
        n = int((x1 - x0 + y1 - y0) / step) + 2
        for i in range(-n, n):
            dd.line([(self.p(i * step), 0), (self.p(i * step) + lay.height * math.tan(math.radians(angle)), lay.height)], fill=col, width=max(1, int(self.p(w))))
        self.img.alpha_composite(lay, (int(self.p(x0)), int(self.p(y0))))

    def dots(self, x0, y0, x1, y1, step, r, col, stagger=True):
        j = 0; y = y0
        while y < y1:
            x = x0 + (step / 2 if (stagger and j % 2) else 0)
            while x < x1:
                self.ell(x, y, r, fill=col); x += step
            y += step * (0.87 if stagger else 1); j += 1

    def hexgrid(self, x0, y0, x1, y1, s, col, w=0.25):
        dy = s * 1.5; dx = s * math.sqrt(3); j = 0; y = y0
        while y < y1 + s:
            x = x0 + (dx / 2 if j % 2 else 0)
            while x < x1 + s:
                pts = [(x + s * math.cos(math.radians(60 * k + 30)), y + s * math.sin(math.radians(60 * k + 30))) for k in range(6)]
                self.d.line([(self.p(a), self.p(b)) for a, b in pts + [pts[0]]], fill=col, width=max(1, int(self.p(w)))); x += dx
            y += dy; j += 1

    def gingham(self, x0, y0, x1, y1, step, c1, c2):
        for j in range(int((y1 - y0) / step) + 1):
            for i in range(int((x1 - x0) / step) + 1):
                a, b = (i % 2), (j % 2)
                col = c1 if a == 0 and b == 0 else c2 if a + b == 1 else tuple(int(v * 0.8) for v in c2)
                self.rect(x0 + i * step, y0 + j * step, x0 + (i + 1) * step, y0 + (j + 1) * step, fill=col)

    def grad_v(self, x0, y0, x1, y1, top, bot):
        w, h = int(self.p(x1 - x0)), int(self.p(y1 - y0))
        g = Image.new("RGBA", (w, h))
        for yy in range(h):
            t = yy / max(1, h - 1)
            g.paste(tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,), (0, yy, w, yy + 1))
        self.img.alpha_composite(g, (int(self.p(x0)), int(self.p(y0))))

    def wave(self, y0, amp, length, col, y1=None, phase=0.0, x0=0, x1=None):
        x1 = self.w if x1 is None else x1; y1 = self.h if y1 is None else y1
        pts = [(x, y0 + amp * math.sin((x / length) * 2 * math.pi + phase)) for x in [x0 + i * 0.5 for i in range(int((x1 - x0) / 0.5) + 1)]]
        self.poly(pts + [(x1, y1), (x0, y1)], fill=col)

    def barcode(self, x, y, w, h, col=(0, 0, 0)):
        rr = random.Random(7); xx = x
        while xx < x + w:
            bw = rr.choice([0.3, 0.3, 0.6, 0.9]); self.rect(xx, y, min(xx + bw, x + w), y + h, fill=col); xx += bw + rr.choice([0.3, 0.6])

    # ---- emblems (cx, cy centre, r radius in mm)
    def em_vineyard(self, cx, cy, r, c1, c2, c3):
        self.ell(cx, cy, r, fill=c2, outline=c1, w=0.5)
        self.ell(cx, cy - r * 0.25, r * 0.32, fill=c3)
        for k in range(12):
            a = k * math.pi / 6
            self.line(cx + math.cos(a) * r * 0.38, cy - r * 0.25 + math.sin(a) * r * 0.38, cx + math.cos(a) * r * 0.52, cy - r * 0.25 + math.sin(a) * r * 0.52, fill=c3, w=0.35)
        lay = Image.new("L", self.img.size, 0); ImageDraw.Draw(lay).ellipse(self.xy(cx - r, cy - r, cx + r, cy + r), fill=255)
        hl = Image.new("RGBA", self.img.size, (0, 0, 0, 0)); hd = ImageDraw.Draw(hl)
        for k, col in enumerate((c1, tuple(int(v * 0.8) for v in c1))):
            pts = [(cx - r, cy + r * 0.25 + k * r * 0.22)]
            for i in range(21):
                x = cx - r + 2 * r * i / 20
                pts.append((x, cy + r * (0.05 + 0.2 * k) + math.sin(i / 20 * math.pi * 2 + k) * r * 0.12))
            pts += [(cx + r, cy + r), (cx - r, cy + r)]
            hd.polygon([(self.p(a), self.p(b)) for a, b in pts], fill=col)
        for i in range(-3, 4):    # vine rows
            hd.line([(self.p(cx + i * r * 0.1), self.p(cy + r * 0.45)), (self.p(cx + i * r * 0.38), self.p(cy + r))], fill=c3, width=max(1, int(self.p(0.3))))
        hl.putalpha(ImageChops.multiply(hl.getchannel("A"), lay)); self.img.alpha_composite(hl)
        self.ell(cx, cy, r, outline=c1, w=0.6)

    def em_hops(self, cx, cy, r, col, leaf):
        for dx, s in ((-0.5, 0.8), (0.5, 0.8), (0, 1.0)):
            x = cx + dx * r; yy = cy - r * 0.1 * (1 if dx else 0)
            for k in range(5):
                self.ell(x + (k % 2 - 0.5) * r * 0.16 * s, yy - r * 0.45 * s + k * r * 0.2 * s, r * 0.2 * s, r * 0.15 * s, fill=col, outline=leaf, w=0.25)
            self.poly([(x, yy - r * 0.55 * s), (x + r * 0.35 * s, yy - r * 0.8 * s), (x + r * 0.2 * s, yy - r * 0.45 * s)], fill=leaf)
        self.ell(cx, cy, r, outline=col, w=0.7)

    def em_crest(self, cx, cy, r, c1, c2):
        pts = [(cx - r * 0.8, cy - r), (cx + r * 0.8, cy - r), (cx + r * 0.8, cy + r * 0.1), (cx, cy + r * 1.1), (cx - r * 0.8, cy + r * 0.1)]
        self.poly(pts, fill=c2); self.d.line([(self.p(a), self.p(b)) for a, b in pts + [pts[0]]], fill=c1, width=max(1, int(self.p(0.7))))
        self.rect(cx - r * 0.1, cy - r, cx + r * 0.1, cy + r * 1.0, fill=c1)
        self.rect(cx - r * 0.8, cy - r * 0.3, cx + r * 0.8, cy - r * 0.1, fill=c1)
        for sx, sy in ((-0.45, -0.65), (0.45, -0.65), (-0.45, 0.2), (0.45, 0.2)):
            self.star(cx + sx * r, cy + sy * r, r * 0.17, c1)

    def star(self, cx, cy, r, col, n=5):
        pts = []
        for i in range(2 * n):
            a = -math.pi / 2 + i * math.pi / n; rr = r if i % 2 == 0 else r * 0.42
            pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
        self.poly(pts, fill=col)

    def em_bee(self, cx, cy, r, body, stripe, wing):
        self.ell(cx - r * 0.35, cy - r * 0.45, r * 0.38, r * 0.22, fill=wing); self.ell(cx + r * 0.25, cy - r * 0.5, r * 0.38, r * 0.22, fill=wing)
        self.ell(cx, cy, r * 0.55, r * 0.38, fill=body)
        for i in (-1, 0, 1):
            self.rect(cx + i * r * 0.22 - r * 0.06, cy - r * 0.34, cx + i * r * 0.22 + r * 0.06, cy + r * 0.34, fill=stripe)
        self.ell(cx + r * 0.55, cy - r * 0.05, r * 0.2, fill=stripe)
        self.line(cx - r * 0.55, cy, cx - r * 0.8, cy + r * 0.05, fill=stripe, w=0.5)

    def em_moon(self, cx, cy, r, c1, bg):
        self.ell(cx, cy, r, fill=c1); self.ell(cx + r * 0.38, cy - r * 0.12, r * 0.86, fill=bg)

    def em_bubbles(self, x0, y0, x1, y1, n, col, outline=None, seed=3):
        rr = random.Random(seed)
        for _ in range(n):
            r = rr.uniform(0.5, 2.4) * (self.h / 100.0 + 0.6)
            self.ell(rr.uniform(x0, x1), rr.uniform(y0, y1), r, fill=col, outline=outline, w=0.25)

    def banner(self, cx, cy, w, h, fill, outline=None):
        x0, x1 = cx - w / 2, cx + w / 2
        self.poly([(x0 - h * 0.6, cy), (x0, cy - h / 2 + h * 0.2), (x0, cy + h / 2 + h * 0.2)], fill=tuple(int(v * 0.7) for v in fill[:3]))
        self.poly([(x1 + h * 0.6, cy), (x1, cy - h / 2 + h * 0.2), (x1, cy + h / 2 + h * 0.2)], fill=tuple(int(v * 0.7) for v in fill[:3]))
        self.rect(x0, cy - h / 2, x1, cy + h / 2, fill=fill, outline=outline, w=0.35)

    def ornament(self, cx, cy, w, col, w_line=0.3):
        self.line(cx - w / 2, cy, cx - 2.2, cy, col, w_line); self.line(cx + 2.2, cy, cx + w / 2, cy, col, w_line)
        self.poly([(cx, cy - 1.3), (cx + 1.3, cy), (cx, cy + 1.3), (cx - 1.3, cy)], fill=col)


# ================================================================== helpers
def C(h):
    h = h.lstrip("#"); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def paper_tex(c, base, grain=6, fibres=True):
    """noisy paper base over the whole canvas."""
    im = c.img
    n = Image.effect_noise(im.size, 38).convert("L")
    n = n.point(lambda v: int((v - 128) * grain / 128.0 * 2 + 128))
    base_l = Image.new("RGBA", im.size, tuple(base) + (255,))
    c.img.paste(base_l)
    ov = Image.merge("RGBA", (n, n, n, Image.new("L", im.size, 255)))
    c.img = ImageChops.add(c.img, ov, 1.0, -128)
    c.img.putalpha(255)
    c.d = ImageDraw.Draw(c.img)


def age(img, wear, rng, base_tone=(235, 226, 205), alpha_safe=False):
    """stains, creases, edge scuffs and grain. Returns (img, mask_L) with mask 0..255 = scuff amount (for the roughness map)."""
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    if wear <= 0:
        return img, mask
    px = max(w, h) / 600.0
    a = img.getchannel("A")
    rgb = img.convert("RGB")
    # soft stains
    st = Image.new("L", (w, h), 0); sd = ImageDraw.Draw(st)
    for _ in range(int(3 + wear * 8)):
        x, y, r = rng.uniform(0, w), rng.uniform(0, h), rng.uniform(10, 60) * px * (0.5 + wear)
        sd.ellipse([x - r, y - r * rng.uniform(0.5, 1.2), x + r, y + r], fill=int(rng.uniform(25, 90) * wear))
    st = st.filter(ImageFilter.GaussianBlur(14 * px))
    tone = Image.new("RGB", (w, h), (120, 88, 50))
    rgb = Image.composite(ImageChops.multiply(rgb, Image.blend(Image.new("RGB", (w, h), (255, 255, 255)), tone, 0.55)), rgb, st)
    # creases: thin light/dark lines
    cr = Image.new("L", (w, h), 128); cd = ImageDraw.Draw(cr)
    for _ in range(int(wear * 6)):
        x0, y0 = rng.uniform(0, w), rng.uniform(0, h); ang = rng.uniform(0, math.pi); ln = rng.uniform(0.25, 0.8) * max(w, h)
        x1, y1 = x0 + math.cos(ang) * ln, y0 + math.sin(ang) * ln
        cd.line([(x0, y0), (x1, y1)], fill=170, width=max(1, int(px * 1.2))); cd.line([(x0 + px * 1.5, y0 + px * 1.5), (x1 + px * 1.5, y1 + px * 1.5)], fill=90, width=max(1, int(px)))
    cr = cr.filter(ImageFilter.GaussianBlur(0.8 * px))
    ca = Image.merge("RGB", (cr, cr, cr))
    rgb = ImageChops.add(rgb, ca, 1.0, -128)
    # edge scuff: noisy mask near the border, lightens colour to bare paper / dust
    yy, xx = None, None
    d = Image.new("L", (w, h), 0)
    dd = ImageDraw.Draw(d)
    for k in range(int(10 * px) + 2):
        v = int(255 * (1 - k / (10 * px + 2)) ** 1.5)
        dd.rectangle([k, k, w - 1 - k, h - 1 - k], outline=v)
    n = Image.effect_noise((w, h), 60 * px if px < 1 else 60).convert("L")
    n = n.resize((w, h)).filter(ImageFilter.GaussianBlur(1.5 * px))
    sc = ImageChops.multiply(d, n.point(lambda v: 255 if v > 150 - 70 * wear else 0))
    sc = sc.point(lambda v: int(min(255, v * (0.4 + wear))))
    rgb = Image.composite(Image.new("RGB", (w, h), base_tone), rgb, sc.point(lambda v: v // 2))
    # scratches (mask only + slight light line)
    sd2 = ImageDraw.Draw(sc)
    for _ in range(int(wear * 12)):
        x0, y0 = rng.uniform(0, w), rng.uniform(0, h); ang = rng.uniform(0, math.pi); ln = rng.uniform(10, 70) * px
        sd2.line([(x0, y0), (x0 + math.cos(ang) * ln, y0 + math.sin(ang) * ln)], fill=255, width=max(1, int(px * 0.8)))
    mask = ImageChops.lighter(sc, st.point(lambda v: min(255, v * 2)))
    # grain
    g = Image.effect_noise((w, h), 25).convert("L").point(lambda v: int((v - 128) * 0.08 * wear * 4 + 128))
    rgb = ImageChops.add(rgb, Image.merge("RGB", (g, g, g)), 1.0, -128)
    out = rgb.convert("RGBA"); out.putalpha(a)
    return out, mask


def roughness_map(mask, kind, wear):
    """RGB image: G = roughness (base + scuff), R=255 (no AO), B = 0 (metallic comes from the factor / see designer)."""
    base = ROUGH.get(kind, 0.6)
    g = mask.point(lambda v: int(255 * min(1.0, base + (1.0 - base) * (v / 255.0) * min(1.0, 0.4 + wear))))
    r = Image.new("L", mask.size, 255)
    b = Image.new("L", mask.size, 255 if kind == "foil_metal" else 0)
    return Image.merge("RGB", (r, g, b))


# ================================================================== templates
def T_wine_classic(c):
    f = c.f; W, H = c.w, c.h
    paper_tex(c, (241, 232, 210))
    gold, wine, ink = C("#9a7a2e"), C("#6b1424"), C("#2a1e16")
    c.border(3, 0.5, wine, double=1.4)
    c.text(W / 2, 11, f["tagline"], "serif", 2.4, ink, spacing=0.25, maxw=W - 14)
    c.em_vineyard(W / 2, 33, 14, gold, C("#efe0b4"), C("#d9a441"))
    c.ornament(W / 2, 52, W - 20, gold)
    c.text(W / 2, 61, f["brand"], "serif_b", 9, wine, maxw=W - 12)
    c.text(W / 2, 70.5, f["product"], "serif_i", 5, ink, maxw=W - 14)
    c.text(W / 2, 79, f["year"], "serif_b", 8, gold, spacing=0.15)
    c.ornament(W / 2, 87, W - 30, gold)
    c.text(W / 2, 93, f["origin"], "serif", 2.6, ink, spacing=0.1, maxw=W - 12)
    c.text(W / 2, 98, f["abv"] + "   " + f["volume"], "serif", 2.4, ink, maxw=W - 12)


def T_wine_modern(c):
    f = c.f; W, H = c.w, c.h
    c.fill(C("#15171c")); gold = C("#c8a65a")
    c.border(3.5, 0.3, gold)
    c.em_moon(W / 2, 24, 10, gold, C("#15171c"))
    for i in range(7): c.star(W / 2 - 15 + i * 5 + (i % 2) * 0.6, 42 + (i % 3) * 1.5, 0.8, gold)
    c.text(W / 2, 56, f["brand"], "sans_l", 8.2, (240, 236, 224), spacing=0.35, maxw=W - 10)
    c.line(W / 2 - 14, 64, W / 2 + 14, 64, gold, 0.3)
    c.text(W / 2, 72, f["product"], "serif_i", 4.6, gold, maxw=W - 12)
    c.text(W / 2, 82, f["year"], "sans", 6, (240, 236, 224), spacing=0.3)
    c.text(W / 2, 96, f["abv"] + " · " + f["volume"] + " · " + f["origin"], "sans", 2.0, (170, 170, 170), spacing=0.1, maxw=W - 10)


def T_wine_back(c):
    f = c.f; W, H = c.w, c.h
    paper_tex(c, (241, 232, 210)); ink = C("#2a1e16"); wine = C("#6b1424")
    c.border(3, 0.4, wine)
    c.text(W / 2, 10, f["brand"], "serif_b", 4.2, wine, maxw=W - 10)
    c.line(8, 15, W - 8, 15, wine, 0.25)
    c.para(7, 19, f["blurb"], "serif_i", 2.5, ink, 1.4, maxw=W - 14)
    c.para(7, 48, f["small"], "sans", 1.7, ink, 1.4, maxw=W - 14)
    c.barcode(W / 2 - 13, H - 25, 26, 11)
    c.text(W / 2, H - 11.5, "5 901234 123457", "mono", 2.0, ink)
    c.text(W / 2, H - 6.5, "Contains sulphites", "sans", 1.7, ink)


def T_wine_neck(c):
    f = c.f; W, H = c.w, c.h
    paper_tex(c, (241, 232, 210)); wine = C("#6b1424"); gold = C("#9a7a2e")
    c.border(2.5, 0.4, wine, double=1)
    c.text(W / 2, H * 0.3, f["year"], "serif_b", 8, wine)
    c.text(W / 2, H * 0.68, f["product"], "serif_i", 4, C("#2a1e16"), maxw=W - 14)
    c.star(10, H / 2, 2.5, gold); c.star(W - 10, H / 2, 2.5, gold)


def T_foil_capsule(c):
    f = c.f; W, H = c.w, c.h
    col = C(f["foil"])
    c.grad_v(0, 0, W, H, tuple(min(255, int(v * 1.15)) for v in col), tuple(int(v * 0.75) for v in col))
    c.fill(col) if False else None
    n = Image.effect_noise(c.img.size, 20).convert("L").filter(ImageFilter.GaussianBlur(0.6))
    nn = Image.merge("RGB", (n, n, n)); rgb = ImageChops.add(c.img.convert("RGB"), nn, 1.0, -128)
    c.img = rgb.convert("RGBA"); c.d = ImageDraw.Draw(c.img)
    for i in range(0, int(W), 3):    # pleats
        c.line(i, 0, i, H, tuple(int(v * 0.8) for v in col), 0.25)
    c.rect(0, H - 2.2, W, H, fill=tuple(int(v * 0.65) for v in col))
    c.text(W / 2, H * 0.45, f["brand"], "serif_b", 6, tuple(int(v * 0.55) for v in col), spacing=0.2, maxw=W * 0.5)


def T_beer_pale(c):
    f = c.f; W, H = c.w, c.h
    paper_tex(c, C("#e9d9ab"), 7); brown, green, cream = C("#4a2a10"), C("#4d6b24"), C("#f6ecd0")
    c.rect(0, 0, W, 14, fill=brown); c.rect(0, H - 12, W, H, fill=brown)
    c.text(W / 2, 7.5, f["brand"], "serif_b", 6.5, cream, spacing=0.12, maxw=W - 10)
    c.ell(W / 2, 42, 22, fill=cream, outline=brown, w=0.9); c.em_hops(W / 2, 42, 16, C("#b88a1c"), green)
    c.banner(W / 2, 66, 52, 9, brown); c.text(W / 2, 66, f["product"], "serif_b", 5, cream, maxw=48)
    c.text(W / 2, 74.5, f["tagline"], "serif_i", 3.2, brown, maxw=W - 12)
    c.text(W / 2, H - 6, f["abv"] + "  ·  " + f["volume"], "sans_b", 3.2, cream, spacing=0.08, maxw=W - 10)


def T_beer_dark(c):
    f = c.f; W, H = c.w, c.h
    c.fill(C("#1d1511")); cop = C("#c4753a")
    c.border(3, 0.5, cop, double=1.2)
    c.text(W / 2, 13, f["brand"], "impact", 7.5, cop, spacing=0.1, maxw=W - 14)
    c.em_hops(W / 2, 40, 17, cop, C("#7a8f3a"))
    c.text(W / 2, 64, f["product"], "serif_bi", 8, (240, 225, 200), maxw=W - 12)
    c.line(14, 72, W - 14, 72, cop, 0.35)
    c.text(W / 2, 78, f["tagline"], "serif_i", 3.2, (200, 180, 150), maxw=W - 14)
    c.text(W / 2, 85, f["abv"] + " · " + f["volume"], "sans_b", 3, cop, maxw=W - 14)


def T_beer_neck(c):
    f = c.f; W, H = c.w, c.h
    paper_tex(c, C("#e9d9ab")); brown = C("#4a2a10")
    c.rect(0, 0, W, 2.5, fill=brown); c.rect(0, H - 2.5, W, H, fill=brown)
    c.text(W / 2, H / 2, f["batch"], "serif_b", 8, brown, maxw=W - 8)


def T_beer_wrap(c):
    f = c.f; W, H = c.w, c.h
    c.fill(C(f["bg"])); acc = C(f["accent"]); cream = C("#f6ecd0")
    c.stripes(0, 0, W, H, 9, 1.2, tuple(min(255, v + 18) for v in C(f["bg"])), 0)
    c.rect(0, 0, W, 8, fill=acc); c.rect(0, H - 8, W, H, fill=acc)
    cx = W / 2                                    # FRONT panel at u = 0.5
    c.ell(cx, H / 2, 40, fill=cream, outline=acc, w=1.1); c.em_hops(cx, H / 2 - 4, 22, C("#b88a1c"), C("#4d6b24"))
    c.banner(cx, H / 2 + 24, 62, 11, acc); c.text(cx, H / 2 + 24, f["product"], "serif_b", 6, cream, maxw=58)
    c.text(cx, 14, f["brand"], "impact", 6.5, cream, spacing=0.15, maxw=90)
    c.text(cx, H - 4.2, f["abv"] + " · " + f["volume"], "sans_b", 3.2, cream, spacing=0.1)
    for sx in (W * 0.20, W * 0.80):               # side panels (keep the back seam, u = 0 / 1, clear)
        c.rect(sx - 24, 18, sx + 24, H - 18, fill=cream, outline=acc, w=0.5)
        c.para(sx - 21, 23, f["small"], "sans", 2.4, C("#4a2a10"), 1.35, maxw=42)
        c.text(sx, H - 25, f["batch"], "mono_b", 3.2, C("#4a2a10"))


def T_soda_sleeve(c):
    f = c.f; W, H = c.w, c.h
    c.fill(C(f["bg"])); acc = C(f["accent"]); white = (255, 255, 255)
    c.dots(0, 0, W, H, 9, 1.4, tuple(min(255, v + 25) for v in C(f["bg"])))
    c.wave(H * 0.62, 6, 55, acc, phase=0.3); c.wave(H * 0.72, 5, 40, white, phase=1.2); c.wave(H * 0.79, 5, 40, C(f["bg2"]), phase=1.2)
    cx = W / 2
    c.em_bubbles(cx - 55, 12, cx + 55, H * 0.6, 22, tuple(min(255, v + 70) for v in C(f["bg"])), white)
    c.text(cx, H * 0.27, f["brand"], "impact", 26, white, maxw=95, stroke=0.8, stroke_fill=C(f["bg2"]))
    c.text(cx, H * 0.46, f["product"], "script_b", 12, C(f["accent2"]), maxw=90, stroke=0.5, stroke_fill=C(f["bg2"]))
    c.text(cx, H * 0.90, f["volume"] + "   ·   " + f["tagline"], "sans_b", 5, white, spacing=0.12, maxw=100)
    for sx in (W * 0.18, W * 0.82):
        c.rect(sx - 22, H * 0.25, sx + 22, H * 0.7, fill=white, outline=C(f["bg2"]), w=0.6)
        c.text(sx, H * 0.30, "NUTRITION", "sans_b", 3.4, C(f["bg2"]))
        c.para(sx - 19, H * 0.36, f["small"], "sans", 2.6, (40, 40, 40), 1.4, maxw=38)


def T_soda_cap(c):
    f = c.f; W, H = c.w, c.h
    c.fill(C(f["bg"])); c.ell(W / 2, H / 2, W * 0.46, outline=(255, 255, 255), w=0.6)
    c.text(W / 2, H / 2, f["brand"][0], "impact", W * 0.5, (255, 255, 255))


def T_neck_seal(c):
    f = c.f; W, H = c.w, c.h
    c.fill(C(f["bg"])); c.stripes(0, 0, W, H, 4, 1.6, (255, 255, 255), 35)
    c.rect(0, 0, W, 1.2, fill=(255, 255, 255)); c.rect(0, H - 1.2, W, H, fill=(255, 255, 255))


def T_clear_sticker(c):
    """transparent film with a printed (white + accent) design."""
    f = c.f; W, H = c.w, c.h
    c.img = Image.new("RGBA", c.img.size, (0, 0, 0, 0)); c.d = ImageDraw.Draw(c.img)
    col = C(f["ink"]); acc = C(f["accent"])
    c.border(3, 0.7, col, double=1.2, r=3)
    c.em_hops(W / 2, 28, 15, col, acc)
    c.text(W / 2, 54, f["brand"], "impact", 8, col, spacing=0.12, maxw=W - 14)
    c.line(12, 62, W - 12, 62, acc, 0.5)
    c.text(W / 2, 71, f["product"], "serif_bi", 6, col, maxw=W - 14)
    c.text(W / 2, 82, f["abv"] + " · " + f["volume"], "sans_b", 3, acc, maxw=W - 14)


def T_whiskey_classic(c):
    f = c.f; W, H = c.w, c.h
    paper_tex(c, C("#1e2a3a"), 5); gold = C("#d2ae5a"); cream = C("#efe3c4")
    c.border(3, 0.5, gold, double=1.5)
    c.text(W / 2, 11, f["tagline"], "serif", 2.4, gold, spacing=0.3, maxw=W - 12)
    c.em_crest(W / 2, 30, 11, gold, C("#14202e"))
    c.text(W / 2, 54, f["brand"], "serif_b", 8.5, cream, maxw=W - 10)
    c.line(10, 62, W - 10, 62, gold, 0.3)
    c.text(W / 2, 70, f["product"], "serif_i", 4.4, gold, maxw=W - 12)
    c.text(W / 2, 77, f["age"], "serif_b", 5.2, cream, maxw=W - 14)
    c.text(W / 2, 83.5, f["abv"] + " · " + f["volume"], "serif", 2.5, gold, maxw=W - 14)


def T_whiskey_gold(c):
    f = c.f; W, H = c.w, c.h
    paper_tex(c, C("#efe3c4"), 6); ink = C("#1b1b1b"); red = C("#8e1f1a")
    c.rect(0, 0, W, 16, fill=ink); c.rect(0, H - 14, W, H, fill=ink)
    c.text(W / 2, 8.5, f["brand"], "times_b", 7.5, C("#d9b86a"), spacing=0.14, maxw=W - 10)
    c.ell(W / 2, 40, 17, fill=C("#d9b86a"), outline=ink, w=1); c.star(W / 2, 40, 12, ink); c.star(W / 2, 40, 6, red)
    c.text(W / 2, 64, f["product"], "serif_bi", 6.5, red, maxw=W - 10)
    c.text(W / 2, 74, f["age"], "serif_b", 4.2, ink, maxw=W - 12)
    c.text(W / 2, H - 7, f["abv"] + " · " + f["volume"], "serif", 2.8, C("#d9b86a"), maxw=W - 10)


def T_whiskey_back(c):
    f = c.f; W, H = c.w, c.h
    paper_tex(c, C("#1e2a3a")); gold = C("#d2ae5a"); cream = C("#efe3c4")
    c.border(3, 0.4, gold)
    c.text(W / 2, 9, f["brand"], "serif_b", 4, gold, maxw=W - 10)
    c.para(7, 15, f["blurb"], "serif_i", 2.4, cream, 1.4, maxw=W - 14)
    c.para(7, 36, f["small"], "sans", 1.7, cream, 1.4, maxw=W - 14)


def T_whiskey_shoulder(c):
    f = c.f; W, H = c.w, c.h
    c.fill(C("#8e1f1a")); gold = C("#e0c070")
    c.rect(2, 2, W - 2, H - 2, outline=gold, w=0.4)
    c.text(W / 2, H / 2, f["tagline"], "serif_b", 5.6, gold, spacing=0.2, maxw=W - 14)


def T_handwritten_tag(c):
    """kraft hanging tag with a punched hole; transparent outside the cut shape."""
    f = c.f; W, H = c.w, c.h
    c.img = Image.new("RGBA", c.img.size, (0, 0, 0, 0)); c.d = ImageDraw.Draw(c.img)
    cut = 0.2 * min(W, H)
    pts = [(cut, 0), (W - cut, 0), (W, cut), (W, H), (0, H), (0, cut)] if f.get("shape", "tag") == "tag" else [(0, 0), (W, 0), (W, H), (0, H)]
    mask = Image.new("L", c.img.size, 0); ImageDraw.Draw(mask).polygon([(c.p(x), c.p(y)) for x, y in pts], fill=255)
    paper = Image.new("RGBA", c.img.size, C(f["paper"]) + (255,))
    n = Image.effect_noise(c.img.size, 50).convert("L").point(lambda v: int((v - 128) * 0.18 + 128))
    paper = ImageChops.add(paper, Image.merge("RGBA", (n, n, n, Image.new("L", c.img.size, 255))), 1.0, -128)
    c.img.paste(paper, (0, 0), mask); c.d = ImageDraw.Draw(c.img)
    c.ell(W / 2, cut * 0.9, cut * 0.3, fill=(0, 0, 0, 0)); c.d.ellipse(c.xy(W / 2 - cut * 0.3, cut * 0.9 - cut * 0.3, W / 2 + cut * 0.3, cut * 0.9 + cut * 0.3), fill=(0, 0, 0, 0))
    c.ell(W / 2, cut * 0.9, cut * 0.42, outline=C("#8a6a40"), w=0.35)
    ink = C(f["ink"])
    lines = f["lines"]; sz = min(H * 0.17, W * 0.14)
    for i, ln in enumerate(lines):
        c.rot_text(W / 2 + (i % 2) * 0.8, cut * 2.0 + (H - cut * 2.4) * (i + 0.5) / len(lines), ln, f.get("font", "hand"), sz, ink, f.get("angle", 2.0) - i * 0.6)
    c.mask_alpha = mask


def T_labelwriter(c):
    """label-printer strip (Dymo/Brother style): 12 mm tape, black mono text."""
    f = c.f; W, H = c.w, c.h
    col = {"white": (250, 250, 248), "yellow": (250, 226, 70), "clear": None}[f["tape"]]
    if col is None:
        c.img = Image.new("RGBA", c.img.size, (0, 0, 0, 0)); c.d = ImageDraw.Draw(c.img)
        c.rect(0, 0, W, H, fill=(255, 255, 255, 40))
    else:
        c.fill(col)
    ink = (20, 20, 20) if f["tape"] != "clear" else (15, 15, 15)
    c.line(0, 0.4, W, 0.4, (200, 200, 200) if col else (255, 255, 255, 90), 0.3)
    n = len(f["lines"]); sz = H * 0.55 / n * (1.0 if n > 1 else 1.1)
    for i, ln in enumerate(f["lines"]):
        c.text(2, H * (i + 0.5) / n, ln, "mono_b", sz, ink, "lm", maxw=W - 4)


def T_flask_grad(c):
    f = c.f; W, H = c.w, c.h
    c.img = Image.new("RGBA", c.img.size, (0, 0, 0, 0)); c.d = ImageDraw.Draw(c.img)
    ink = (245, 245, 240, 255)
    c.rect(2, 2, W - 2, 16, fill=(245, 245, 240, 235))                # white marking patch
    c.text(W / 2, 9, f["patch"], "print", 3.2, (30, 30, 30), maxw=W - 6)
    ymax = f.get("max", 1000)
    for i in range(0, 11):
        y = H - 4 - (H - 26) * i / 10.0
        big = i % 2 == 0
        c.line(W - 14 if big else W - 9, y, W - 3, y, ink, 0.55 if big else 0.35)
        if big and i > 0:
            c.text(W - 16, y, str(int(ymax * i / 10)), "sans", 2.6, ink, "rm")
    c.text(4, H - 3, "ml", "sans", 2.6, ink, "lm")


def T_jar_honey(c):
    f = c.f; W, H = c.w, c.h
    c.fill(C(f["bg"])); amber = C(f["accent"]); brown = C("#4a2c0a")
    c.hexgrid(0, 0, W, H, 4.2, tuple(min(255, v + 20) for v in C(f["bg"])), 0.35)
    cx = W / 2
    c.ell(cx, H / 2, 29, fill=C("#fbf0cc"), outline=brown, w=1)
    c.em_bee(cx, H / 2 - 12, 13, amber, brown, (235, 245, 250, 255))
    c.text(cx, H / 2 + 5, f["product"], "serif_b", 6, brown, maxw=48)
    c.text(cx, H / 2 + 13, f["brand"], "serif_i", 3.4, brown, maxw=48)
    c.text(cx, H - 6, f["volume"], "sans_b", 3.2, brown)
    for sx in (W * 0.18, W * 0.82):
        c.rect(sx - 24, 9, sx + 24, H - 9, fill=C("#fbf0cc"), outline=brown, w=0.5)
        c.para(sx - 21, 14, f["small"], "sans", 2.6, brown, 1.4, maxw=42)


def T_jar_jam(c):
    f = c.f; W, H = c.w, c.h
    c.gingham(0, 0, W, H, 4.5, C("#f4f0e6"), C("#e5b4b4")); red = C("#9e1f33")
    cx = W / 2
    c.rect(cx - 36, 6, cx + 36, H - 6, fill=C("#fff8ea"), outline=red, w=0.8, r=4)
    c.ell(cx, H * 0.37, 11, fill=red); c.ell(cx + 2, H * 0.37 - 10, 4, 3, fill=C("#3d7a2a"))
    for k in range(9): c.ell(cx - 6 + (k % 3) * 6, H * 0.37 - 5 + (k // 3) * 5, 0.6, fill=C("#f3c6a0"))
    c.text(cx, H * 0.67, f["product"], "script_b", 7, red, maxw=66)
    c.text(cx, H * 0.84, f["brand"], "serif_i", 3.2, C("#4a2a10"), maxw=66)
    for sx in (W * 0.17, W * 0.83):
        c.para(sx - 22, 12, f["small"], "sans_b", 2.6, red, 1.4, maxw=44)


def T_jar_lid(c):
    f = c.f; W, H = c.w, c.h
    if f["style"] == "gingham":
        c.gingham(0, 0, W, H, 6, C("#f4f0e6"), C("#e5b4b4"))
    else:
        c.fill(C(f["bg"])); c.hexgrid(0, 0, W, H, 4.2, tuple(min(255, v + 25) for v in C(f["bg"])), 0.4)
    c.ell(W / 2, H / 2, W * 0.34, fill=C("#fff8ea"), outline=C("#4a2a10"), w=0.7)
    c.text(W / 2, H / 2, f["brand"], "serif_b", W * 0.075, C("#4a2a10"), maxw=W * 0.55)
    alpha = Image.new("L", c.img.size, 0); ImageDraw.Draw(alpha).ellipse([0, 0, c.W - 1, c.H - 1], fill=255)
    c.img.putalpha(alpha)


def T_wine_cap(c):
    f = c.f; W, H = c.w, c.h
    c.fill(C(f["bg"])); c.ell(W / 2, H / 2, W * 0.4, outline=C("#d9b86a"), w=0.6); c.text(W / 2, H / 2, f["brand"][0], "serif_b", W * 0.5, C("#d9b86a"))
    alpha = Image.new("L", c.img.size, 0); ImageDraw.Draw(alpha).ellipse([0, 0, c.W - 1, c.H - 1], fill=255); c.img.putalpha(alpha)


def T_champagne(c):
    f = c.f; W, H = c.w, c.h
    c.grad_v(0, 0, W, H, C("#1d2b3d"), C("#101a28")); gold = C("#d4b15c"); cream = C("#f4ead0")
    c.border(2.5, 0.4, gold, double=1.2)
    c.text(W / 2, H * 0.12, f["tagline"], "serif", H * 0.04, gold, spacing=0.3, maxw=W - 14)
    for i in range(9): c.star(W / 2 - 24 + i * 6, H * 0.21, 1.0 + (i % 2) * 0.5, gold)
    c.text(W / 2, H * 0.40, f["brand"], "display", H * 0.17, cream, maxw=W - 14)
    c.ornament(W / 2, H * 0.55, W - 24, gold)
    c.text(W / 2, H * 0.66, f["product"], "serif_bi", H * 0.085, gold, maxw=W - 14)
    c.text(W / 2, H * 0.79, f["year"], "serif_b", H * 0.09, cream, spacing=0.2)
    c.text(W / 2, H * 0.91, f["abv"] + "   " + f["volume"], "serif", H * 0.03, cream, maxw=W - 12)


def T_pet_sleeve(c):
    f = c.f; W, H = c.w, c.h
    c.fill(C(f["bg"])); acc = C(f["accent"]); white = (255, 255, 255)
    c.dots(0, 0, W, H, 8, 1.2, tuple(min(255, v + 22) for v in C(f["bg"])))
    c.wave(H * 0.78, 4, 38, acc, phase=0.4); c.wave(H * 0.86, 3.5, 30, C(f["bg2"]), phase=1.0)
    cx = W / 2                                       # front at u = 0.5, seam (u = 0 / 1) at the back stays plain
    c.text(cx, H * 0.30, f["brand"], "impact", H * 0.30, white, maxw=W * 0.42, stroke=0.7, stroke_fill=C(f["bg2"]))
    c.text(cx, H * 0.58, f["product"], "script_b", H * 0.17, C(f["accent2"]), maxw=W * 0.38, stroke=0.4, stroke_fill=C(f["bg2"]))
    c.text(cx, H * 0.93, f["volume"], "sans_b", H * 0.06, white, spacing=0.12)
    for sx in (W * 0.2, W * 0.8):
        c.rect(sx - 22, H * 0.12, sx + 22, H * 0.70, fill=(255, 255, 255, 235), outline=C(f["bg2"]), w=0.4, r=2)
        c.para(sx - 19, H * 0.17, f["small"], "sans", 2.2, C(f["bg2"]), 1.35, maxw=38)


def T_milk(c):
    f = c.f; W, H = c.w, c.h
    paper_tex(c, C("#fbf7ec"), 3, fibres=False); blue = C(f["blue"]); ink = C("#23324a")
    c.rect(0, 0, W, H * 0.16, fill=blue); c.rect(0, H * 0.86, W, H, fill=blue)
    cx = W / 2
    c.text(cx, H * 0.08, f["brand"], "serif_b", H * 0.11, (255, 255, 255), spacing=0.12, maxw=W * 0.3)
    c.ell(cx, H * 0.5, H * 0.27, fill=C("#e8f1fa"), outline=blue, w=0.8)
    c.poly([(cx, H * 0.27), (cx - H * 0.14, H * 0.55), (cx + H * 0.14, H * 0.55)], fill=blue)    # milk drop
    c.ell(cx, H * 0.55, H * 0.14, fill=blue)
    c.text(cx, H * 0.71, f["product"], "serif_bi", H * 0.09, ink, maxw=W * 0.2)
    c.text(cx, H * 0.93, f["volume"] + "  ·  " + f["tagline"], "sans_b", H * 0.06, (255, 255, 255), maxw=W * 0.3)
    for sx in (W * 0.2, W * 0.8):                       # side panels, back seam clear
        c.para(sx - 26, H * 0.24, f["small"], "sans", 2.3, ink, 1.4, maxw=52)
        c.barcode(sx - 10, H * 0.62, 20, 11)


def T_apothecary(c):
    f = c.f; W, H = c.w, c.h
    paper_tex(c, C("#eadfc4")); ink = C("#2b2118"); red = C("#7d2118")
    c.border(1.8, 0.4, ink, double=0.9)
    c.text(W / 2, H * 0.17, f["head"], "serif_b", H * 0.085, red, spacing=0.2, maxw=W - 8)
    c.ornament(W / 2, H * 0.28, W - 14, ink)
    c.text(W / 2, H * 0.46, f["product"], "serif_bi", H * 0.15, ink, maxw=W - 8)
    c.text(W / 2, H * 0.62, f["sub"], "serif_i", H * 0.075, ink, maxw=W - 8)
    c.ornament(W / 2, H * 0.72, W - 14, ink)
    c.text(W / 2, H * 0.85, f["dose"], "serif", H * 0.06, red, maxw=W - 8)


def T_preserve(c):
    f = c.f; W, H = c.w, c.h
    c.gingham(0, 0, W, H * 0.22, 3.5, C("#f4f0e6"), C("#c9b3d6")); c.gingham(0, H * 0.82, W, H, 3.5, C("#f4f0e6"), C("#c9b3d6"))
    c.rect(0, H * 0.22, W, H * 0.82, fill=C("#fff8ea")); plum = C("#5b2a6b")
    c.text(W / 2, H * 0.40, f["product"], "script_b", H * 0.2, plum, maxw=W - 8)
    c.text(W / 2, H * 0.63, f["brand"], "serif_i", H * 0.085, C("#4a2a10"), maxw=W - 8)
    c.text(W / 2, H * 0.92, f["volume"], "sans_b", H * 0.07, plum)


def T_perfume(c):
    f = c.f; W, H = c.w, c.h
    c.fill(C("#f3e9df")); gold = C("#b08d4a"); ink = C("#2a2420")
    c.border(1.4, 0.3, gold, double=0.7)
    c.text(W / 2, H * 0.16, f["brand"], "sans_l", H * 0.055, ink, spacing=0.4, maxw=W - 6)
    c.ell(W / 2, H * 0.43, W * 0.3, outline=gold, w=0.4)
    c.text(W / 2, H * 0.43, f["no"], "display", H * 0.26, gold, maxw=W * 0.5)
    c.text(W / 2, H * 0.72, f["product"], "serif_i", H * 0.065, ink, maxw=W - 6)
    c.text(W / 2, H * 0.88, f["volume"], "sans", H * 0.045, ink, spacing=0.2)


def T_growler(c):
    f = c.f; W, H = c.w, c.h
    paper_tex(c, C("#c9a56e"), 8); dark = C("#2b1a0c"); cream = C("#f3e6c4")
    c.rect(0, 0, W, H * 0.10, fill=dark); c.rect(0, H * 0.90, W, H, fill=dark)
    cx = W / 2
    c.ell(cx, H / 2, H * 0.40, fill=cream, outline=dark, w=1.0); c.ell(cx, H / 2, H * 0.35, outline=dark, w=0.4)
    c.em_hops(cx, H * 0.43, H * 0.2, C("#b88a1c"), C("#4d6b24"))
    c.text(cx, H * 0.70, f["product"], "serif_b", H * 0.1, dark, maxw=H * 0.62)
    c.text(cx, H * 0.05, f["brand"], "impact", H * 0.075, cream, spacing=0.2, maxw=W * 0.4)
    c.text(cx, H * 0.95, f["abv"] + "  ·  " + f["volume"], "sans_b", H * 0.05, cream, spacing=0.1)
    for sx in (W * 0.2, W * 0.8):                       # side text, back seam clear
        c.text(sx, H * 0.30, f["side"], "serif_bi", H * 0.12, dark, maxw=70)
        c.para(sx - 30, H * 0.48, f["small"], "sans", 2.4, dark, 1.4, maxw=60)


def T_gin(c):
    """botanical gin label (square flask front)."""
    f = c.f; W, H = c.w, c.h
    paper_tex(c, C(f["paper"]), 4); ink = C(f["ink"]); acc = C(f["accent"])
    c.border(2.2, 0.45, ink, double=1.0)
    c.text(W / 2, H * 0.10, f["tagline"], "serif", H * 0.035, ink, spacing=0.35, maxw=W - 8)
    for i in range(7):                                    # juniper sprig: stem + berries
        y = H * 0.20 + i * H * 0.022
        c.line(W / 2, y, W / 2 + (5 if i % 2 else -5), y - 3, C("#3d6b3a"), 0.6)
    c.line(W / 2, H * 0.19, W / 2, H * 0.36, C("#3d6b3a"), 0.7)
    for dx, dy in ((-4, 0.30), (4, 0.27), (0, 0.33), (5, 0.34)):
        c.ell(W / 2 + dx, H * dy, 1.6, fill=acc)
    c.text(W / 2, H * 0.48, f["brand"], "serif_b", H * 0.09, ink, spacing=0.15, maxw=W - 8)
    c.ornament(W / 2, H * 0.56, W - 16, ink)
    c.text(W / 2, H * 0.65, f["product"], "serif_i", H * 0.06, acc, maxw=W - 8)
    c.para(6, H * 0.72, f["small"], "sans", 2.2, ink, 1.35, maxw=W - 12)
    c.text(W / 2, H * 0.94, f["abv"] + "  ·  " + f["volume"], "sans_b", H * 0.032, ink, spacing=0.12, maxw=W - 8)


def T_hazard(c):
    """fuel / contents sticker: coloured header, big product word, pictogram diamond, small print."""
    f = c.f; W, H = c.w, c.h
    c.fill((248, 246, 238)); band = C(f["band"]); ink = (20, 20, 20)
    c.rect(0, 0, W, H * 0.2, fill=band)
    c.text(W / 2, H * 0.1, f["product"], "impact", H * 0.13, (255, 255, 255) if f.get("light", True) else ink, spacing=0.12, maxw=W - 6)
    cx, cy, r = W / 2, H * 0.46, min(W, H) * 0.22
    c.poly([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], fill=(255, 255, 255), outline=(200, 20, 20), w=1.6)
    c.poly([(cx, cy - r * 0.55), (cx + r * 0.3, cy + r * 0.35), (cx - r * 0.3, cy + r * 0.35)], fill=ink)    # flame-ish glyph
    c.ell(cx, cy + r * 0.1, r * 0.16, fill=(255, 255, 255))
    c.text(W / 2, H * 0.76, f["warn"], "sans_b", H * 0.045, ink, maxw=W - 6)
    c.para(4, H * 0.82, f["small"], "sans", 2.4, ink, 1.35, maxw=W - 8)


def T_mug_logo(c):
    """diner mug decal: transparent background, round badge + script name."""
    f = c.f; W, H = c.w, c.h
    c.img = Image.new("RGBA", c.img.size, (0, 0, 0, 0)); c.d = ImageDraw.Draw(c.img)
    red, ink = C(f["color"]), C(f["ink"])
    cx, cy = W / 2, H * 0.42
    c.ell(cx, cy, H * 0.33, fill=red); c.ell(cx, cy, H * 0.29, outline=(255, 255, 255), w=0.8)
    c.text(cx, cy - H * 0.06, f["brand"], "script_b", H * 0.16, (255, 255, 255), maxw=H * 0.56)
    c.text(cx, cy + H * 0.13, f["since"], "sans_b", H * 0.06, (255, 255, 255), spacing=0.25)
    c.text(cx, H * 0.88, f["tagline"], "sans_b", H * 0.075, ink, spacing=0.2, maxw=W - 6)


def T_etched(c):
    """white/frosted print for clear glass (tumbler): transparent background."""
    f = c.f; W, H = c.w, c.h
    c.img = Image.new("RGBA", c.img.size, (0, 0, 0, 0)); c.d = ImageDraw.Draw(c.img)
    ink = (250, 250, 250, 230)
    c.ell(W / 2, H * 0.40, H * 0.30, outline=ink, w=0.7); c.ell(W / 2, H * 0.40, H * 0.26, outline=ink, w=0.3)
    c.text(W / 2, H * 0.40, f["mono"], "serif_b", H * 0.28, ink)
    c.text(W / 2, H * 0.84, f["brand"], "serif", H * 0.10, ink, spacing=0.3, maxw=W - 6)


def T_tank_sticker(c):
    f = c.f; W, H = c.w, c.h
    c.fill(C(f["bg"])); white = (255, 255, 255)
    c.wave(H * 0.80, 3, 25, C(f["accent"]), phase=0.2)
    c.text(W * 0.06, H * 0.30, f["brand"], "impact", H * 0.30, white, "lm", maxw=W * 0.6)
    c.text(W * 0.06, H * 0.58, f["product"], "sans_b", H * 0.12, white, "lm", maxw=W * 0.6)
    c.ell(W * 0.83, H * 0.42, H * 0.30, fill=white)
    c.text(W * 0.83, H * 0.40, f["volume"], "impact", H * 0.17, C(f["bg"]), maxw=H * 0.5)


def T_slotdebug(c):
    f = c.f; W, H = c.w, c.h
    pal = [C(x) for x in ("#e6504b", "#3b82c4", "#3fae6a", "#e0a82e", "#9a5bc0", "#2ab3b3", "#d8668f")]
    col = pal[(f["index"] - 1) % len(pal)]
    c.fill(col)
    step = 10
    for x in range(0, int(W) + 1, step): c.line(x, 0, x, H, tuple(min(255, v + 45) for v in col), 0.25)
    for y in range(0, int(H) + 1, step): c.line(0, y, W, y, tuple(min(255, v + 45) for v in col), 0.25)
    c.rect(0.5, 0.5, W - 0.5, H - 0.5, outline=(255, 255, 255), w=max(0.6, min(W, H) * 0.02))
    c.text(W / 2, H / 2, str(f["index"]), "impact", min(W, H) * 0.55, (255, 255, 255), stroke=0.4, stroke_fill=(0, 0, 0))
    c.text(W / 2, H * 0.12, f["name"], "sans_b", min(W / 8, H * 0.1, 7), (255, 255, 255), maxw=W - 4, stroke=0.3, stroke_fill=(0, 0, 0))
    c.text(W / 2, H * 0.88, "%.0f x %.0f mm" % (W, H), "sans_b", min(W / 10, H * 0.07, 5), (255, 255, 255), maxw=W - 4, stroke=0.3, stroke_fill=(0, 0, 0))
    c.ell(W * 0.5, H * 0.72 if H > W * 0.6 else H * 0.5, min(W, H) * 0.12, outline=(255, 255, 255), w=0.5)   # circle test
    c.text(W * 0.08, H * 0.5, ">", "impact", min(W, H) * 0.12, (255, 255, 255), "lm")


ALPHA_T = {"clear_sticker", "tag_whiskey", "tag_hand", "tag_hand_script", "flask_grad", "labelwriter_clear", "mug_logo", "etched"}

# defaults per template: template -> (function, default fields)
TEMPLATES = {
    "wine_classic": (T_wine_classic, dict(tagline="ESTATE BOTTLED", brand="Château Lunelle", product="Réserve du Vallon", year="2019", origin="Product of Vallon Valley", abv="13.5% vol", volume="750 ml")),
    "wine_modern": (T_wine_modern, dict(brand="NOCTURNE", product="Cuvée de Minuit", year="2021", origin="Vallon Valley", abv="14% vol", volume="750 ml")),
    "wine_back": (T_wine_back, dict(brand="Château Lunelle", blurb=["Ripened on the south slopes of the", "fictional Vallon Valley, this red", "shows dark cherry, cedar and a", "long, gently spiced finish.", "", "Serve at 16-18 C with roast", "meats and hard cheeses."],
                                    small=["Estate bottled by Lunelle Cellars,", "Vallon Valley. Contains sulphites.", "Please recycle this bottle."])),
    "wine_neck": (T_wine_neck, dict(year="2019", product="Réserve")),
    "foil_capsule": (T_foil_capsule, dict(foil="#c9a13a", brand="LUNELLE")),
    "foil_capsule_red": (T_foil_capsule, dict(foil="#9b1c26", brand="NOCTURNE")),
    "wine_cap": (T_wine_cap, dict(bg="#6b1424", brand="L")),
    "beer_pale": (T_beer_pale, dict(brand="MOORFIELD BREWING", product="PALE ALE", tagline="Brewed with three fictional hops", abv="5.2% ABV", volume="500 ml")),
    "beer_dark": (T_beer_dark, dict(brand="OLD MOOR", product="Stout", tagline="Roasted malt · cocoa · coffee", abv="6.0% ABV", volume="500 ml")),
    "beer_neck": (T_beer_neck, dict(batch="No. 7")),
    "beer_wrap": (T_beer_wrap, dict(brand="HARBOR LANTERN", product="Amber Lager", bg="#7b3b16", accent="#3b2010", abv="4.8% ABV", volume="500 ml", batch="BATCH 0412 · BB 03/27",
                                    small=["Brewed & bottled by", "Harbor Lantern Brewing Co.", "(fictional), Moorfield.", "Contains barley malt.", "Please recycle."])),
    "clear_sticker": (T_clear_sticker, dict(brand="FOGHORN", product="Session IPA", ink="#f4f1e6", accent="#e8b53a", abv="4.2% ABV", volume="440 ml")),
    "soda_sleeve": (T_soda_sleeve, dict(brand="FIZZ-O", product="Cherry Pop", bg="#c41f2e", bg2="#6b0f1a", accent="#f26a6a", accent2="#ffe27a", volume="660 ml", tagline="ICE COLD & BUBBLY",
                                        small=["Per 100 ml:", "Energy 180 kJ", "Sugars 10 g", "Fat 0 g", "Salt 0 g"])),
    "soda_lime": (T_soda_sleeve, dict(brand="ZESTA", product="Lime Fizz", bg="#2f9e44", bg2="#0e4d1c", accent="#b6e35a", accent2="#fff3a8", volume="500 ml", tagline="SHAKE UP THE DAY",
                                      small=["Per 100 ml:", "Energy 150 kJ", "Sugars 8 g", "Fat 0 g", "Salt 0 g"])),
    "soda_cap": (T_soda_cap, dict(bg="#c41f2e", brand="FIZZ-O")),
    "soda_cap_lime": (T_soda_cap, dict(bg="#2f9e44", brand="ZESTA")),
    "neck_seal": (T_neck_seal, dict(bg="#c41f2e")),
    "whiskey_classic": (T_whiskey_classic, dict(tagline="DISTILLED & CASK AGED", brand="Glenvorrow", product="Single Malt Whisky", age="AGED 12 YEARS", abv="43% vol", volume="700 ml")),
    "whiskey_gold": (T_whiskey_gold, dict(brand="BLACKWATER", product="Reserve Bourbon", age="BATCH 24", abv="45% vol", volume="700 ml")),
    "whiskey_back": (T_whiskey_back, dict(brand="Glenvorrow", blurb=["Matured in oak above the loch,", "this fictional single malt offers", "orchard fruit, honey and a", "whisper of peat smoke."], small=["Distilled and bottled at", "Glenvorrow Distillery (fictional).", "Please drink responsibly."])),
    "whiskey_shoulder": (T_whiskey_shoulder, dict(tagline="DISTILLER'S CUT")),
    "tag_whiskey": (T_handwritten_tag, dict(paper="#c9a46a", ink="#3a2410", lines=["Cask 114", "bottled 03.21"], font="hand", angle=3.0)),
    "jar_honey": (T_jar_honey, dict(bg="#f0b830", accent="#e8a317", product="Wildflower Honey", brand="Meadowbrook Apiary", volume="NET WT 450 g",
                                    small=["Raw & unfiltered.", "Pure honey from", "meadow blossoms.", "May crystallise;", "warm gently."])),
    "jar_jam": (T_jar_jam, dict(product="Strawberry", brand="Granny Pim's Preserves", small=["Strawberries, sugar,", "lemon juice, pectin.", "Made in small batches.", "Best before see lid."])),
    "jar_lid": (T_jar_lid, dict(style="gingham", bg="#f0b830", brand="Meadowbrook")),
    "jar_lid_honey": (T_jar_lid, dict(style="hex", bg="#f0b830", brand="Meadowbrook")),
    "labelwriter": (T_labelwriter, dict(tape="white", lines=["ETHANOL 96%", "LOT 17  2026-03"])),
    "labelwriter_yellow": (T_labelwriter, dict(tape="yellow", lines=["CAUTION", "FLAMMABLE"])),
    "labelwriter_clear": (T_labelwriter, dict(tape="clear", lines=["NaCl 0.9 M", "K.S. 12/10"])),
    "tag_hand": (T_handwritten_tag, dict(paper="#d2b27a", ink="#27323f", lines=["Sample 4", "12/10 - K.S."], font="hand", angle=2.0)),
    "tag_hand_script": (T_handwritten_tag, dict(paper="#e7d6b0", ink="#1f3a6b", lines=["Stock", "A  0.5 M"], font="script", angle=-2.0)),
    "flask_grad": (T_flask_grad, dict(patch="Fiole 1000", max=1000)),
    "champagne": (T_champagne, dict(tagline="CUVEE DE PRESTIGE", brand="Maison Aurèle", product="Brut Réserve", year="2016", abv="12% vol", volume="750 ml")),
    "pet_sleeve": (T_pet_sleeve, dict(brand="ZESTA", product="Orange Spark", bg="#f08a1c", bg2="#8a3b00", accent="#ffd24a", accent2="#fff3b0", volume="500 ml",
                                      small=["Carbonated water, sugar,", "orange juice (3%), acid.", "Please recycle.", "Best before: see cap"])),
    "milk": (T_milk, dict(brand="WILLOWBROOK", product="Whole Milk", blue="#2d6aa8", volume="568 ml", tagline="FRESH FROM THE FARM",
                          small=["Pasteurised, homogenised.", "Keep refrigerated below 5 C.", "Willowbrook Dairy (fictional).", "Please rinse and recycle."])),
    "apothecary": (T_apothecary, dict(head="DR. HALLORAN'S", product="Tinctura Menthae", sub="Peppermint Tonic", dose="Ten drops in water")),
    "preserve": (T_preserve, dict(product="Blackberry", brand="Plumtree Preserves", volume="NET 340 g")),
    "perfume": (T_perfume, dict(brand="ATELIER VÉRANE", no="N°7", product="Eau de Parfum", volume="50 ml")),
    "growler": (T_growler, dict(brand="HARBOR LANTERN", product="Amber Lager", side="Fill me up", abv="4.8% ABV", volume="1.9 L",
                                small=["Fresh draught, filled on", "the day of purchase. Keep", "cold and drink within 5", "days. Please return."])),
    "gin": (T_gin, dict(paper="#f1ede2", ink="#1f3a3a", accent="#3b5f8a", tagline="SMALL BATCH · DISTILLED", brand="JUNIPER & HARE", product="London Dry Gin",
                        abv="41.5% vol", volume="500 ml", small=["Juniper, coriander, angelica,", "orris and a twist of lemon.", "Distilled by Juniper & Hare (fictional)."])),
    "hazard": (T_hazard, dict(band="#c0201a", product="DIESEL", warn="FLAMMABLE · KEEP AWAY FROM HEAT", small=["Contents: diesel fuel, 20 L max.", "Do not fill above the shoulder.", "Store upright, cap closed."])),
    "hazard_water": (T_hazard, dict(band="#1f5fa8", product="WATER", warn="DRINKING WATER ONLY", small=["Rinse before first use.", "Refill weekly. Store in shade."])),
    "mug_logo": (T_mug_logo, dict(color="#c4342b", ink="#2a2a2a", brand="Rosie's", since="EST. 1958", tagline="BOTTOMLESS COFFEE")),
    "etched": (T_etched, dict(mono="H", brand="HALDEN & CO")),
    "tank_sticker": (T_tank_sticker, dict(bg="#11698e", accent="#19a7ce", brand="AQUAVISTA", product="Glass Aquarium", volume="60 L")),
    "_slotdebug": (T_slotdebug, dict(index=1, name="slot")),
}

# ================================================================== library definition
LIBRARY = [  # (file stem, bottle, slot, template, fields, wear, seed, material_kind)
    ("wine_classic_front", "wine", "front", "wine_classic", {}, 0.2, 1, "paper_matte"),
    ("wine_modern_front", "wine", "front", "wine_modern", {}, 0.0, 2, "paper_gloss"),
    ("wine_classic_back", "wine", "back", "wine_back", {}, 0.2, 3, "paper_matte"),
    ("wine_classic_neck", "wine", "neck", "wine_neck", {}, 0.15, 4, "paper_gloss"),
    ("wine_foil_gold", "wine", "foil", "foil_capsule", {}, 0.0, 5, "foil_metal"),
    ("wine_foil_red", "wine", "foil", "foil_capsule_red", {}, 0.0, 6, "foil_metal"),
    ("wine_cap_disc", "wine", "cap", "wine_cap", {}, 0.0, 7, "paper_gloss"),
    ("beer_pale_front", "beer", "front", "beer_pale", {}, 0.25, 1, "paper_gloss"),
    ("beer_dark_front", "beer", "front", "beer_dark", {}, 0.1, 2, "paper_gloss"),
    ("beer_pale_neck", "beer", "neck", "beer_neck", {}, 0.2, 3, "paper_gloss"),
    ("beer_amber_wrap", "beer", "wrap", "beer_wrap", {}, 0.2, 4, "paper_gloss"),
    ("beer_clear_film", "beer", "front", "clear_sticker", {}, 0.0, 5, "clear_film"),
    ("soda_cherry_sleeve", "soda", "sleeve", "soda_sleeve", {}, 0.0, 1, "plastic_sleeve"),
    ("soda_lime_sleeve", "soda", "sleeve", "soda_lime", {}, 0.0, 2, "plastic_sleeve"),
    ("soda_cherry_cap", "soda", "cap", "soda_cap", {}, 0.0, 3, "paper_gloss"),
    ("soda_lime_cap", "soda", "cap", "soda_cap_lime", {}, 0.0, 4, "paper_gloss"),
    ("soda_neck_seal", "soda", "neck_seal", "neck_seal", {}, 0.0, 5, "plastic_sleeve"),
    ("whiskey_classic_front", "whiskey", "front", "whiskey_classic", {}, 0.15, 1, "paper_matte"),
    ("whiskey_bourbon_front", "whiskey", "front", "whiskey_gold", {}, 0.2, 2, "paper_matte"),
    ("whiskey_classic_back", "whiskey", "back", "whiskey_back", {}, 0.15, 3, "paper_matte"),
    ("whiskey_shoulder_strip", "whiskey", "shoulder", "whiskey_shoulder", {}, 0.0, 4, "paper_gloss"),
    ("whiskey_neck_tag", "whiskey", "neck", "tag_whiskey", {}, 0.4, 5, "handwritten_tag"),
    ("jar_honey_wrap", "jar", "wrap", "jar_honey", {}, 0.1, 1, "paper_matte"),
    ("jar_jam_wrap", "jar", "wrap", "jar_jam", {}, 0.1, 2, "paper_matte"),
    ("jar_lid_gingham", "jar", "lid", "jar_lid", {}, 0.0, 3, "paper_gloss"),
    ("jar_lid_honey", "jar", "lid", "jar_lid_honey", {}, 0.0, 4, "paper_gloss"),
    ("flask_labelwriter_white", "flask", "tag", "labelwriter", {}, 0.1, 1, "tape"),
    ("flask_labelwriter_yellow", "flask", "tag", "labelwriter_yellow", {}, 0.1, 2, "tape"),
    ("flask_labelwriter_clear", "flask", "tag", "labelwriter_clear", {}, 0.0, 3, "clear_film"),
    ("flask_tag_hand", "flask", "tag_hand", "tag_hand", {}, 0.35, 4, "handwritten_tag"),
    ("flask_tag_script", "flask", "tag_hand", "tag_hand_script", {}, 0.2, 5, "handwritten_tag"),
    ("flask_graduation", "flask", "grad", "flask_grad", {}, 0.0, 6, "clear_film"),
]


# ================================================================== core
def slot_info(bottle, slot):
    t = json.load(open(os.path.join(ROOT, "designs", "slots.json"), encoding="utf-8"))
    for s in t["bottles"][bottle]["slots"]:
        if s["name"] == slot:
            return s
    raise KeyError((bottle, slot))


def render(bottle, slot, spec, material_kind=None):
    """-> (RGBA image, wear mask image or None, meta)"""
    si = slot_info(bottle, slot)
    tname = spec["template"]
    fn, defaults = TEMPLATES[tname]
    fields = dict(defaults); fields.update(spec.get("fields", {}))
    if tname == "_slotdebug":
        fields.update(index=spec.get("index", 1), name=slot)
    W, H = spec.get("size_px", [si["tex_w"], si["tex_h"]])
    ppcm = W / (si["width_m"] * 100.0)
    ss = 2 if W * H < 1.5e6 else 1
    seed = int(spec.get("seed", 1)); rng = random.Random(seed)
    c = Ctx(W, H, ppcm, fields, rng, ss)
    fn(c)
    img = c.img.convert("RGBA")
    if tname not in ALPHA_T:
        img.putalpha(255)
    else:   # transparent pixels get the mean opaque colour (no dark fringes from bilinear filtering / mip-maps)
        from PIL import ImageStat
        al = img.getchannel("A"); hard = al.point(lambda v: 255 if v > 128 else 0)
        mean = tuple(int(v) for v in ImageStat.Stat(img.convert("RGB"), mask=hard).mean) if hard.getextrema()[1] else (255, 255, 255)
        solid = Image.new("RGB", img.size, mean)
        rgb = Image.composite(img.convert("RGB"), solid, al.point(lambda v: 255 if v > 8 else 0))
        img = rgb.convert("RGBA"); img.putalpha(al)
    if ss > 1:
        img = img.resize((W, H), Image.LANCZOS)
    wear = float(spec.get("wear", 0.0))
    tone = tuple(int(v) for v in img.convert("RGB").resize((1, 1), Image.BOX).getpixel((0, 0)))
    mask = None
    if wear > 0:
        img, m = age(img, wear, rng, tuple(min(255, v + 25) for v in tone))
        mask = roughness_map(m, material_kind or si["material"], wear)
        if hasattr(c, "mask_alpha"):   # keep tag cut-out transparent
            pass
    a = img.getchannel("A")
    meta = dict(template=tname, bottle=bottle, slot=slot, size_px=[W, H], px_per_cm=round(ppcm, 1), alpha=a.getextrema()[0] < 255,
                wear=wear, seed=seed, fields=fields if tname != "_slotdebug" else {})
    return img, mask, meta


def generate_from_args(a):
    img, mask, meta = render(a["bottle"], a["slot"], a["spec"], a["spec"].get("material_kind"))
    os.makedirs(os.path.dirname(os.path.abspath(a["out"])), exist_ok=True)
    img.save(a["out"], optimize=True)
    json.dump(meta, open(a["out"] + ".meta.json", "w", encoding="utf-8"), indent=1)
    if a.get("mask") and mask is not None:
        mask.save(a["mask"], optimize=True)


def make_template(bottle, slot_name):
    si = slot_info(bottle, slot_name)
    W, H = si["tex_w"], si["tex_h"]; ppcm = si["px_per_cm"]
    ss = 1
    c = Ctx(W, H, ppcm, {}, random.Random(1), 1)
    wm, hm = c.w, c.h
    c.fill((252, 252, 250))
    for x in range(0, int(wm) + 1, 5):
        c.line(x, 0, x, hm, (225, 232, 240) if x % 10 else (190, 205, 225), 0.12 if x % 10 else 0.2)
    for y in range(0, int(hm) + 1, 5):
        c.line(0, y, wm, y, (225, 232, 240) if y % 10 else (190, 205, 225), 0.12 if y % 10 else 0.2)
    disc = si["kind"] == "cap_top"
    bleed, safe = 1.0, min(3.0, min(wm, hm) * 0.08)
    c.rect(bleed, bleed, wm - bleed, hm - bleed, outline=(230, 60, 60), w=0.25)                      # trim / bleed line
    c.rect(safe, safe, wm - safe, hm - safe, outline=(30, 150, 80), w=0.35)                          # safe area
    c.line(wm / 2, 0, wm / 2, hm, (150, 90, 200), 0.2); c.line(0, hm / 2, wm, hm / 2, (150, 90, 200), 0.2)
    rr = min(wm, hm) * 0.3
    c.ell(wm / 2, hm / 2, rr, outline=(220, 40, 160), w=0.35)                                         # circle test: must look round on the bottle
    f = min(wm / 20, hm / 12, 4.5)
    full = si["arc"] >= 359.9 and not disc
    c.text(wm / 2, safe + f, "TOP (up on the bottle)", "sans_b", f, (60, 60, 60), maxw=wm - 2 * safe)
    c.text(wm / 2, hm - safe - f, "BOTTOM", "sans_b", f, (60, 60, 60), maxw=wm - 2 * safe)
    if disc:
        c.text(wm / 2, hm - safe - 2 * f - 1, "FRONT of bottle (bottom edge)", "sans", f * 0.8, (60, 60, 60), maxw=wm - 2 * safe)
        c.text(wm / 2, safe + 2 * f + 1, "BACK", "sans", f * 0.8, (60, 60, 60))
    else:
        c.text(wm / 2, hm / 2 + rr + f, ("centre = FRONT (centre angle %d deg)" % si["centre"]) if si["centre"] == 0 else "centre = angle %d deg" % si["centre"], "sans", f * 0.8, (60, 60, 60), maxw=wm - 2 * safe)
    if full:
        for x in (1.0, wm - 1.0):
            c.line(x, 0, x, hm, (230, 60, 60), 0.5)
        c.text(wm * 0.06, hm / 2, "SEAM", "sans_b", f, (230, 60, 60), maxw=wm * 0.1)
        c.text(wm * 0.94, hm / 2, "SEAM", "sans_b", f, (230, 60, 60), maxw=wm * 0.1)
        c.text(wm * 0.5, hm * 0.25, "keep important art away from the seam (back of bottle): content must be continuous across left/right edge", "sans", f * 0.55, (60, 60, 60), maxw=wm * 0.8)
    c.text(wm / 2, hm / 2, "%s / %s   %.1f x %.1f mm   %dx%d px   (%d px/cm)" % (bottle, slot_name, wm, hm, W, H, ppcm), "mono", f * 0.6, (20, 20, 20), maxw=wm - 2 * safe)
    c.text(safe + 0.5, hm / 2 - f * 1.6, "u >", "sans_b", f * 0.8, (150, 90, 200), "lm")
    c.text(wm - safe - 0.5, hm / 2 - f * 1.6, "< 1", "sans_b", f * 0.8, (150, 90, 200), "rm")
    if disc:
        al = Image.new("L", c.img.size, 0); ImageDraw.Draw(al).ellipse([0, 0, W - 1, H - 1], fill=255)
        c.img.putalpha(al)
    out = os.path.join(ROOT, "labels", "templates", "%s_%s_template.png" % (bottle, slot_name))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    c.img.save(out, optimize=True)
    return out


def slots_sheet(bottle):
    """compose tests/out/slots_<bottle>.png from the Blender workbench renders (front/right/back/left/top) + a legend."""
    tmp = os.path.join(ROOT, "tests", "out", "_slots_tmp")
    views = [v for v in ("front", "right", "back", "left", "top") if os.path.exists(os.path.join(tmp, "%s_%s.png" % (bottle, v)))]
    ims = [Image.open(os.path.join(tmp, "%s_%s.png" % (bottle, v))).convert("RGB") for v in views]
    si = json.load(open(os.path.join(ROOT, "designs", "slots.json"), encoding="utf-8"))["bottles"][bottle]["slots"]
    pal = [C(x) for x in ("#e6504b", "#3b82c4", "#3fae6a", "#e0a82e", "#9a5bc0", "#2ab3b3", "#d8668f")]
    top_h = max(i.height for i in ims)
    W = sum(i.width for i in ims); leg_h = 34 + 26 * len(si)
    S = Image.new("RGB", (W, top_h + 28 + leg_h), (28, 31, 36)); d = ImageDraw.Draw(S)
    x = 0
    for v, im in zip(views, ims):
        S.paste(im, (x, 28)); d.text((x + 8, 6), v.upper() + (" (looking down, front at bottom)" if v == "top" else ""), font=_font("sans_b", 16), fill=(230, 230, 230)); x += im.width
    y = top_h + 36
    d.text((10, y - 4), "bottle: %s    centre angle 0 = front, 90 = right (+X), 180 = back" % bottle, font=_font("sans_b", 15), fill=(255, 255, 255)); y += 26
    for i, s in enumerate(si):
        d.rectangle([10, y, 30, y + 18], fill=pal[i % len(pal)]); d.text((36, y), "%d  %-10s %-9s %5.1f x %5.1f mm  arc %3d  centre %4d  z %.0f-%.0f mm  %s" % (
            i + 1, s["name"], s["kind"], s["width_m"] * 1000, s["height_m"] * 1000, s["arc"], s["centre"], s["z0"] * 1000, s["z1"] * 1000, s["material"]), font=_font("mono", 14), fill=(230, 230, 230)); y += 26
    out = os.path.join(ROOT, "tests", "out", "slots_%s.png" % bottle)
    S.save(out); print(out)


def build_library():
    os.makedirs(os.path.join(ROOT, "labels"), exist_ok=True)
    idx = []
    for stem, bottle, slot, tname, fields, wear, seed, kind in LIBRARY:
        out = os.path.join(ROOT, "labels", stem + ".png")
        spec = dict(template=tname, fields=fields, wear=wear, seed=seed, material_kind=kind)
        mask = os.path.join(ROOT, "labels", stem + "_wear.png") if wear > 0 else None
        generate_from_args(dict(bottle=bottle, slot=slot, spec=spec, out=out, mask=mask))
        m = json.load(open(out + ".meta.json"))
        idx.append(dict(file="labels/%s.png" % stem, bottle=bottle, slot=slot, template=tname, material_kind=kind, size_px=m["size_px"], alpha=m["alpha"],
                        wear_mask=("labels/%s_wear.png" % stem) if mask else None, seed=seed, license="CC0 (original, fictional brand)"))
        print("label", stem, m["size_px"])
    json.dump(idx, open(os.path.join(ROOT, "labels", "library.json"), "w", encoding="utf-8"), indent=1)


def main():
    a = sys.argv[1:]
    if not a or a[0] in ("-h", "--help"):
        print(__doc__); return
    if a[0] == "--json":
        generate_from_args(json.loads(a[1])); return
    if a[0] == "--library":
        build_library(); return
    if a[0] == "--templates":
        t = json.load(open(os.path.join(ROOT, "designs", "slots.json"), encoding="utf-8"))
        for b, v in t["bottles"].items():
            for s in v["slots"]:
                print(make_template(b, s["name"]))
        return
    if a[0] == "--slots-sheet":
        for b in a[1:]: slots_sheet(b)
        return
    if a[0] == "--list":
        for k in TEMPLATES: print(k)
        return
    if a[0] == "--one":
        bottle, slot, tname = a[1:4]
        fields = json.loads(a[a.index("--fields") + 1]) if "--fields" in a else {}
        wear = float(a[a.index("--wear") + 1]) if "--wear" in a else 0.0
        out = a[a.index("--out") + 1] if "--out" in a else os.path.join(ROOT, "tests", "out", "label_%s_%s.png" % (bottle, slot))
        generate_from_args(dict(bottle=bottle, slot=slot, spec=dict(template=tname, fields=fields, wear=wear), out=out, mask=None))
        print(out)


if __name__ == "__main__":
    main()
