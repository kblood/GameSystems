"""v2 closures: returns a list of parts. Each part = dict(node, mat, prof | mesh, disp...) consumed by bottles_v2.

Lathe parts: prof = list of (r, z) (metres, axis-first or open), seg, optional dr(theta, r, z) -> radial offset,
dz(theta, r, z) -> vertical offset, nm = height function for the cap normal map (theta, z, r) -> metres.
Mesh parts: verts (n,3), faces (wires: bail, cage).
Material keys: see bottles_v2.cap_material().
"""
import math
import numpy as np
from bv2_geom import tube, smoothstep, TAU


def arc(cx, cz, rad, a0, a1, n):
    a = np.linspace(math.radians(a0), math.radians(a1), n)
    return [(cx + rad * math.cos(t), cz + rad * math.sin(t)) for t in a]


def outer_r_at(outer, z):
    """outer: dense (n,2) outer profile, finish part; max r at height z (nearest samples)."""
    o = outer[np.argsort(outer[:, 1])]
    return float(np.interp(z, o[:, 1], o[:, 0]))


def cork_shank(r, z0, z1, rnd=0.0008):
    return [(0, z0), (r - rnd, z0), (r, z0 + rnd), (r, z1)]


def build(spec, g, tier, rng):
    """g: geometry context dict(z_top, r_lip, r_bore, outer (dense finish/neck outer pts), body_r, closure_depth).
    Returns (parts, insert_depth)."""
    c = spec["cap"]; t = c["type"]
    zt, rl, rb = g["z_top"], g["r_lip"], g["r_bore"]
    outer = g["outer"]
    hi = tier == 0
    P = []
    insert = 0.0
    mm = 1e-3

    def foil_prof(z0, off, top_extra=0.0):
        pts = outer[(outer[:, 1] >= z0)]
        # outward offset along +r (finish is near vertical); keep it monotone in z
        prof = [(pts[0, 0] + 0.05 * mm, z0)]
        zprev = -1
        for r, z in pts[::max(1, len(pts) // 60)]:
            if z > zprev + 0.3 * mm:
                prof.append((r + off, z)); zprev = z
        prof += arc(rl - 1.5 * mm, zt - 1.0 * mm + top_extra, 1.5 * mm + off, 0, 90, 5)[1:]
        prof.append((0, zt + off + top_extra + 0.5 * mm))
        return prof[::-1]

    if t in ("foil", "wax"):
        thick = c.get("thick", 0.3 * mm) if t == "wax" else 0.3 * mm
        prof = foil_prof(c["z0"], thick)
        part = dict(node="Cap", mat="foil" if t == "foil" else "wax", prof=prof, color=c["color"],
                    metal=c.get("metal", 0.0), rough=c.get("rough", 0.5))
        if t == "wax":
            nd = c.get("drips", 6)
            th0 = rng.uniform(0, TAU, nd); ln = rng.uniform(4, 14, nd) * mm; wd = rng.uniform(0.12, 0.3, nd)
            zmin = c["z0"]

            def dz(theta, r, z, th0=th0, ln=ln, wd=wd, zmin=zmin):
                d = np.zeros_like(theta)
                for a, l, w in zip(th0, ln, wd):
                    dd = np.angle(np.exp(1j * (theta - a)))
                    d += l * np.exp(-0.5 * (dd / w) ** 2)
                wgt = 1 - smoothstep(zmin, zmin + 6 * mm, z)
                return -d * wgt
            part["dz"] = dz

            def dr(theta, r, z, zmin=zmin):   # wax bulges a bit where it ran
                return 0.6 * mm * (1 - smoothstep(zmin, zmin + 8 * mm, z)) * (0.5 + 0.5 * np.sin(3 * theta + 1.3))
            part["dr"] = dr
        else:
            def nm(theta, z, r, zt=zt):   # rolled tear ring + fine crimp lines on the foil top area
                return 0.12 * mm * np.exp(-0.5 * ((z - (zt - 9 * mm)) / (0.35 * mm)) ** 2) + \
                    0.03 * mm * np.sin(theta * 64) * smoothstep(zt - 5 * mm, zt, z)
            part["nm"] = nm
        P.append(part)
        insert = spec["closure_depth"] - 2 * mm
        P.append(dict(node="Cap", mat="cork", prof=cork_shank(rb - 0.1 * mm, zt - insert, zt - 0.3 * mm)))
    elif t == "crown":
        rs = rl + 1.05 * mm
        prof = [(rl - 0.4 * mm, zt - 6.2 * mm), (rs + 0.5 * mm, zt - 6.1 * mm), (rs + 0.35 * mm, zt - 4.8 * mm),
                (rs, zt - 3.6 * mm), (rs, zt - 1.6 * mm)] + arc(rs - 1.3 * mm, zt - 0.5 * mm, 1.3 * mm, 0, 80, 5)[1:] + \
            [(rl * 0.6, zt + 0.95 * mm), (0, zt + 1.0 * mm)]
        prof = prof[::-1]

        def flutes(theta, r, z, zt=zt):
            w = 1 - smoothstep(zt - 1.8 * mm, zt - 0.8 * mm, z)
            return 0.55 * mm * w * (np.abs(np.cos(theta * 21 / 2)) ** 0.6 * 2 - 1.0) * 0.5
        part = dict(node="Cap", mat="crown", prof=prof, color=c["color"], metal=c.get("metal", 0.6), rough=c.get("rough", 0.3))
        if hi:
            part["dr"] = flutes; part["seg"] = 63   # 3 verts per flute
        else:
            part["nm"] = lambda theta, z, r, f=flutes: f(theta, r, z)
        P.append(part)
        insert = 0.0
    elif t in ("screw", "ropp"):
        r = c["r"]; h = c["h"]; z0 = c["z0"]
        band = c.get("band", t == "screw")
        prof = [(r - 1.7 * mm, z0), (r - 0.1 * mm, z0), (r, z0 + 0.3 * mm)]
        if band:
            prof += [(r, z0 + 3.0 * mm), (r - 0.35 * mm, z0 + 3.2 * mm), (r - 0.35 * mm, z0 + 3.7 * mm), (r, z0 + 3.9 * mm)]
        if t == "ropp":
            prof += [(r, z0 + 4.5 * mm), (r - 0.25 * mm, z0 + 4.8 * mm), (r, z0 + 5.1 * mm)]
        prof += [(r, z0 + h - 1.2 * mm)] + arc(r - 1.2 * mm, z0 + h - 1.2 * mm, 1.2 * mm, 0, 90, 5)[1:] + [(0, z0 + h)]
        prof = prof[::-1]
        zk0 = z0 + (4.2 * mm if band else 1 * mm) if t == "screw" else z0 + h - 9 * mm

        def knurl(theta, z, r, zk0=zk0, zk1=z0 + h - 1.6 * mm, n=(120 if t == "screw" else 96)):
            w = smoothstep(zk0, zk0 + 0.6 * mm, z) * (1 - smoothstep(zk1 - 0.6 * mm, zk1, z))
            return 0.22 * mm * w * (0.5 + 0.5 * np.cos(theta * n))
        P.append(dict(node="Cap", mat="plastic" if t == "screw" else "alu", prof=prof, color=c["color"],
                      metal=c.get("metal", 0.0), rough=c.get("rough", 0.4), nm=knurl))
        insert = 0.0
    elif t == "tcork":
        hr, hh = c["head_r"], c["head_h"]
        prof = [(0, zt), (hr - 1.2 * mm, zt), (hr, zt + 1.2 * mm), (hr, zt + hh - 2.5 * mm)] + \
            arc(hr - 2.5 * mm, zt + hh - 2.5 * mm, 2.5 * mm, 0, 90, 6)[1:] + [(0, zt + hh)]
        P.append(dict(node="Cap", mat="wood", prof=prof, color=c["color"], rough=c.get("rough", 0.45)))
        insert = spec["closure_depth"] - 1 * mm
        P.append(dict(node="Cap", mat="cork", prof=cork_shank(rb - 0.15 * mm, zt - insert, zt)))
    elif t == "champagne":
        z0 = c["z0"]; dome = c["dome"]
        prof = foil_prof(z0, 0.35 * mm)[::-1]        # bottom -> lip
        prof = [p for p in prof if p[1] <= zt - 1.0 * mm]
        prof += [(rl + 0.8 * mm, zt + 0.5 * mm), (rl + 1.5 * mm, zt + 3 * mm), (rl + 1.3 * mm, zt + dome - 5 * mm)] + \
            arc(rl - 3.7 * mm, zt + dome - 5 * mm, 5.0 * mm, 0, 90, 6)[1:] + [(0, zt + dome)]
        prof = prof[::-1]

        def crinkle(theta, z, r, zt=zt):
            return 0.08 * mm * np.sin(theta * 40 + 3 * np.sin(z * 900)) * (1 - smoothstep(zt - 2 * mm, zt + 2 * mm, z))
        P.append(dict(node="Cap", mat="foil", prof=prof, color=c["color"], metal=c.get("metal", 0.9),
                      rough=c.get("rough", 0.3), nm=crinkle))
        insert = 24 * mm
        P.append(dict(node="Cap", mat="cork", prof=cork_shank(rb - 0.1 * mm, zt - insert, zt - 0.4 * mm)))
        # wire cage (muselet): ring under the bague, 4 legs, top plaque
        zr = g["z_bague"] - 0.8 * mm
        rr = outer_r_at(outer, zr) + 0.9 * mm
        sides = 4 if hi else 3
        wv, wf = [], []

        def add(v, f):
            o = sum(len(x) for x in wv); wv.append(v); wf.extend([tuple(i + o for i in ff) for ff in f])
        ring = [(rr * math.cos(a), rr * math.sin(a), zr) for a in np.linspace(0, TAU, 48 if hi else 16, endpoint=False)]
        add(*tube(ring, 0.45 * mm, sides, closed=True))
        ztp = zt + dome + 0.6 * mm
        for k in range(4):
            a = k * TAU / 4 + math.pi / 4
            pts = []
            for u in np.linspace(0, 1, 14 if hi else 5):
                z = zr + (ztp - 3 * mm - zr) * u
                rad = outer_r_at(outer, min(z, zt)) + 1.0 * mm if z < zt else rl + 1.9 * mm
                pts.append((rad * math.cos(a), rad * math.sin(a), z))
            pts.append((9 * mm * math.cos(a), 9 * mm * math.sin(a), ztp))
            add(*tube(pts, 0.4 * mm, sides))
        V = np.concatenate(wv)
        P.append(dict(node="Cage", mat="wire", verts=V, faces=wf, color=(0.75, 0.75, 0.77, 1)))
        plq = [(0, ztp + 0.5 * mm), (15 * mm, ztp + 0.5 * mm), (15 * mm, ztp - 0.3 * mm), (12 * mm, ztp - 0.4 * mm), (0, ztp - 0.4 * mm)]
        P.append(dict(node="Cage", mat="plaque", prof=plq, color=c["color"], metal=0.9, rough=0.25))
    elif t == "swing":
        plug = 9 * mm
        cer = [(0, zt - plug), (rb - 1.0 * mm, zt - plug), (rb - 0.5 * mm, zt - plug + 1.0 * mm), (rb - 0.3 * mm, zt - 0.2 * mm),
               (rb + 0.2 * mm, zt + 2.0 * mm), (rl + 0.3 * mm, zt + 2.4 * mm), (rl + 0.9 * mm, zt + 3.4 * mm),
               (rl + 0.9 * mm, zt + 7.5 * mm)] + arc(rl - 3.1 * mm, zt + 7.5 * mm, 4.0 * mm, 0, 60, 4)[1:] + \
            [(rl * 0.45, zt + 13.2 * mm), (0, zt + 13.4 * mm)]
        P.append(dict(node="Cap", mat="ceramic", prof=cer, color=c["color"], rough=0.18))
        gas = [(rb - 0.2 * mm, zt + 0.05 * mm), (rl - 0.2 * mm, zt + 0.05 * mm)] + \
            arc(rl - 0.2 * mm, zt + 1.15 * mm, 1.1 * mm, -90, 90, 5)[1:] + [(rb + 0.1 * mm, zt + 2.25 * mm)]
        P.append(dict(node="Cap", mat="rubber", prof=gas, color=c["gasket"], rough=0.6, closed=True))
        insert = plug + 1 * mm
        # wire bail: neck ring under the bead, two side wires up to the pivots, U-loop over the stopper
        zr = g["z_bague"] - 2.0 * mm
        rr = outer_r_at(outer, zr) + 0.8 * mm
        sides = 6 if hi else 3
        wv, wf = [], []

        def add(v, f):
            o = sum(len(x) for x in wv); wv.append(v); wf.extend([tuple(i + o for i in ff) for ff in f])
        ring = [(rr * math.cos(a), rr * math.sin(a), zr) for a in np.linspace(0, TAU, 40 if hi else 12, endpoint=False)]
        add(*tube(ring, 0.8 * mm, sides, closed=True))
        zp = zt + 6.0 * mm
        xp = rl + 2.6 * mm
        for sgn in (1, -1):
            pts = [(sgn * (rr + 0.4 * mm), 0, zr), (sgn * (xp + 1.5 * mm), 0, zr + 8 * mm), (sgn * xp, 0, zp)]
            add(*tube(pts, 0.8 * mm, sides))
        loop = [(xp * math.cos(a), 0.0, zp + 8.5 * mm * math.sin(a)) for a in np.linspace(0, math.pi, 13 if hi else 5)]
        add(*tube(loop, 0.8 * mm, sides))
        # lever (cam) wire: hangs down on one side
        lev = [(0, rr + 0.5 * mm, zr), (0, rr + 4 * mm, zr - 4 * mm), (0, rr + 3.2 * mm, zr - 16 * mm)]
        add(*tube(lev, 0.8 * mm, sides))
        P.append(dict(node="Bail", mat="wire", verts=np.concatenate(wv), faces=wf, color=c["wire"]))
    elif t == "milkfoil":
        prof = [(rl + 0.35 * mm, zt - 7.5 * mm), (rl + 0.4 * mm, zt - 1.0 * mm)] + \
            arc(rl - 1.3 * mm, zt - 0.6 * mm, 1.75 * mm, 0, 90, 5)[1:] + [(rl * 0.6, zt + 1.6 * mm), (0, zt + 1.8 * mm)]
        prof = prof[::-1]
        n = c.get("pleats", 28)

        def pleat(theta, r, z, zt=zt, n=n):
            w = 1 - smoothstep(zt - 1.6 * mm, zt - 0.4 * mm, z)
            return 0.5 * mm * w * np.abs(np.sin(theta * n / 2 + 0.4 * np.sin(theta * 3)))
        part = dict(node="Cap", mat="foil", prof=prof, color=c["color"], metal=1.0, rough=c.get("rough", 0.3))
        if hi:
            part["dr"] = pleat; part["seg"] = 84
        else:
            part["nm"] = lambda theta, z, r, f=pleat: f(theta, r, z)
        P.append(part)
        insert = 3 * mm
    elif t == "mason":
        zb0 = g["z_thread0"] - 1.2 * mm
        rbnd = g["r_thread"] + 0.9 * mm
        band = [(rl - 4.5 * mm, zt + 1.0 * mm), (rl - 4.5 * mm, zt + 1.9 * mm), (rbnd - 0.6 * mm, zt + 1.9 * mm)] + \
            arc(rbnd - 0.6 * mm, zt + 1.3 * mm, 0.6 * mm, 90, 0, 3)[1:] + \
            [(rbnd, zb0 + 1.0 * mm), (rbnd + 0.4 * mm, zb0 + 0.5 * mm), (rbnd + 0.4 * mm, zb0), (rbnd - 0.6 * mm, zb0)]

        def ribs(theta, z, r):
            return 0.15 * mm * (0.5 + 0.5 * np.cos(theta * 90))
        P.append(dict(node="Cap", mat="band", prof=band, color=c["band_color"], metal=1.0, rough=0.3, nm=ribs, closed=False))
        lid = [(0, zt + 1.0 * mm), (rl + 0.4 * mm, zt + 0.95 * mm), (rl + 0.4 * mm, zt + 0.35 * mm), (rl - 1.0 * mm, zt + 0.1 * mm),
               (rl - 4.0 * mm, zt + 0.55 * mm), (0, zt + 0.55 * mm)]
        P.append(dict(node="Cap", mat="lid", prof=lid, color=c["lid_color"], metal=1.0, rough=0.25))
        insert = 2 * mm
    elif t == "perfume":
        r = c["r"]; h = c["h"]; z0 = c["z0"]
        prof = [(r - 1.8 * mm, z0), (r - 0.6 * mm, z0), (r, z0 + 0.6 * mm), (r, z0 + h - 0.8 * mm), (r - 0.8 * mm, z0 + h),
                (0, z0 + h)][::-1]
        P.append(dict(node="Cap", mat="plastic", prof=prof, color=c["color"], metal=c.get("metal", 0.0), rough=c.get("rough", 0.15)))
        insert = 2 * mm
    elif t == "stopper":
        br = c["ball_r"]; L = c["shank_len"]
        zc = zt + br * 0.82
        prof = [(0, zt - L), (c["shank_r1"] - 0.6 * mm, zt - L), (c["shank_r1"], zt - L + 0.8 * mm), (c["shank_r0"], zt - 0.5 * mm),
                (c["shank_r0"] - 0.3 * mm, zt + 1.5 * mm), (c["shank_r0"] * 0.75, zt + 4 * mm)]
        a0 = math.degrees(math.asin(max(-1, min(1, (zt + 6 * mm - zc) / br))))
        prof += arc(0, zc, br, a0, 90, 20 if hi else 8)[1:]
        prof[-1] = (0.0, prof[-1][1])
        P.append(dict(node="GlassCap", mat="glass", prof=prof))
        insert = L + 1 * mm
    elif t == "pourer":
        cl = c["cork_len"]
        P.append(dict(node="Cap", mat="cork", prof=cork_shank(rb + 0.1 * mm, zt - cl + 2 * mm, zt + 1.5 * mm)))
        col = [(c["spout_r0"] + 0.4 * mm, zt + 7 * mm), (c["collar_r"] - 1.5 * mm, zt + 6.5 * mm),
               (c["collar_r"], zt + 4.5 * mm), (c["collar_r"], zt + 2.0 * mm), (c["collar_r"] - 0.5 * mm, zt + 1.5 * mm),
               (0, zt + 1.5 * mm)][::-1]
        P.append(dict(node="Cap", mat="steel", prof=col, color=(0.8, 0.8, 0.82, 1), metal=1.0, rough=0.2))
        path = [(0, 0, zt + 6 * mm), (0, 0, zt + 14 * mm)]
        for a in np.linspace(0, math.radians(35), 5)[1:]:
            path.append((0 + 18 * mm * (1 - math.cos(a)), 0, zt + 14 * mm + 18 * mm * math.sin(a)))
        last = np.array(path[-1]); d = np.array([math.sin(math.radians(35)), 0, math.cos(math.radians(35))])
        path.append(tuple(last + d * (c["spout_len"] - 22 * mm)))
        v, f = tube(path, 0.5 * (c["spout_r0"] + c["spout_r1"]), 12 if hi else 5)
        P.append(dict(node="Cap", mat="steel", verts=v, faces=f, color=(0.8, 0.8, 0.82, 1), metal=1.0, rough=0.2))
        insert = cl - 1 * mm
    elif t == "cork":
        L, pr = c["length"], c["protrude"]
        z0 = zt - (L - pr)
        prof = [(0, z0), (c["r_bot"] - 0.8 * mm, z0), (c["r_bot"], z0 + 0.8 * mm), (c["r_top"], zt + pr - 1.0 * mm),
                (c["r_top"] - 1.0 * mm, zt + pr), (0, zt + pr)]
        P.append(dict(node="Cap", mat="cork", prof=prof))
        insert = L - pr + 1 * mm
    else:
        raise ValueError(t)
    return P, insert
