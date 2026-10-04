"""Shared helpers for the liquid-system feasibility experiments (sandbox, not production code).

Uses the PRODUCTION data: export/bottle_*.liquid.json (v1 axis LUT), export/*.liquid_v2.json / container_*.liquid.json
(v2 sphere map) and the Liquid meshes inside the GLBs (voxelised with scripts/liquid_lut.py, imported read-only).
Object space = glTF Y-up, metres. up_obj = world up in object space. Plane: dot(p, up_obj) = d, liquid below.
"""
import json
import math
import os
import sys

import numpy as np

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import liquid_lut as L  # noqa: E402  (pure numpy; read-only use)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)
G = 9.81

# outer profiles copied from scripts/bottles.py (that file imports bpy, so it cannot be imported here)
BOTTLES = {
    "wine": dict(outer=[(0, 0), (0.030, 0), (0.0355, 0.003), (0.0375, 0.012), (0.0375, 0.19), (0.0365, 0.205), (0.0330, 0.225),
                        (0.0270, 0.245), (0.0200, 0.262), (0.0150, 0.277), (0.0128, 0.290), (0.0125, 0.325), (0.0140, 0.331),
                        (0.0145, 0.340)], wall=0.003, cap="cork"),
    "beer": dict(outer=[(0, 0), (0.026, 0), (0.0305, 0.003), (0.0325, 0.010), (0.0325, 0.135), (0.0310, 0.150), (0.0270, 0.170),
                        (0.0200, 0.190), (0.0140, 0.205), (0.0122, 0.220), (0.0120, 0.245), (0.0132, 0.250), (0.0132, 0.256)],
                 wall=0.0025, cap="crown"),
    "soda": dict(outer=[(0, 0), (0.024, 0), (0.0305, 0.004), (0.0330, 0.014), (0.0330, 0.14), (0.0320, 0.185), (0.0270, 0.215),
                        (0.0190, 0.232), (0.0150, 0.240), (0.0140, 0.246), (0.0140, 0.262)], wall=0.0012, cap="screw"),
    "whiskey": dict(outer=[(0, 0), (0.030, 0), (0.0345, 0.003), (0.0365, 0.010), (0.0365, 0.135), (0.0350, 0.150), (0.0300, 0.168),
                           (0.0210, 0.180), (0.0155, 0.190), (0.0140, 0.200), (0.0140, 0.218), (0.0152, 0.222), (0.0152, 0.226)],
                    wall=0.004, cap="cork"),
    "jar": dict(outer=[(0, 0), (0.036, 0), (0.0420, 0.004), (0.0440, 0.012), (0.0440, 0.090), (0.0425, 0.100), (0.0385, 0.108),
                       (0.0385, 0.114), (0.0400, 0.116), (0.0400, 0.122)], wall=0.003, cap="screw"),
    "flask": dict(outer=[(0, 0), (0.050, 0), (0.0600, 0.004), (0.0650, 0.012), (0.0600, 0.045), (0.0480, 0.085), (0.0360, 0.125),
                         (0.0220, 0.155), (0.0160, 0.168), (0.0150, 0.190), (0.0165, 0.196), (0.0165, 0.202)], wall=0.002, cap="cork"),
}


def liquid_profile(name):
    """Re-creates bottles.py inner_profile + liq_prof: [(r, y)] of the Liquid mesh, base -> top."""
    spec = BOTTLES[name]
    outer, wall = spec["outer"], spec["wall"]
    lip_z = outer[-1][1]
    z_top = lip_z - 0.004 if spec["cap"] == "cork" else lip_z - 0.002
    zb = wall
    inner = [(0.0, zb)]
    for r, z in outer:
        if zb <= z <= z_top and r > 0:
            inner.append((max(r - wall, 0.0005), z))
    inner.append((inner[-1][0], z_top))
    lp = [(0.0, inner[0][1] + 0.0004)] + [(max(r - 0.0004, 0.0003), z) for r, z in inner[1:-1]] \
        + [(max(inner[-1][0] - 0.0004, 0.0003), z_top - 0.002), (0.0, z_top - 0.002)]
    return lp


class Bottle:
    """Axisymmetric bottle: production v1 LUT + profile-derived opening/neck geometry used by the flow model."""

    def __init__(self, name):
        self.name = name
        info = json.load(open(os.path.join(ROOT, "export", f"bottle_{name}.liquid.json")))
        self.info = info
        self.lut = L.LutV1(info)
        self.cap_ml = float(info["capacity_ml"])
        lp = liquid_profile(name)
        pr = np.array(lp[1:-1])                    # (r, y) without the axis poles
        self.y_top = lp[-1][1]
        self.r_lip = pr[-1, 0]
        order = np.argsort(pr[:, 1], kind="stable")
        ys = np.linspace(pr[:, 1].min(), self.y_top, 160)
        self.spine_y = ys
        self.spine_r = np.interp(ys, pr[order, 1], pr[order, 0])
        R = self.spine_r.max()
        upper = ys > ys[np.argmax(self.spine_r)]
        self.r_min = float(self.spine_r[upper].min()) if upper.any() else self.r_lip   # narrowest neck section
        self.A_min = math.pi * self.r_min ** 2
        self.R_body = R

    def up(self, theta):
        """world up in object space for a tilt theta (rad) about object Z (neck swings toward +x... low lip at +x)."""
        return np.array([-math.sin(theta), math.cos(theta), 0.0])

    def offset(self, u, fill):
        return float(self.lut.offset(u[None, :], np.array([fill]))[0])


def lip_flow(b, u, d, Cd=0.62, n=24):
    """Free (orifice/weir) outflow through the lip disc for plane offset d. Returns (Q m3/s, submerged area m2,
    low-lip s, high-lip s). Lip disc: centre (0, y_top, 0), normal = object Y, radius r_lip. s(x) = x*ux + y_top*uy."""
    sin_t = math.hypot(u[0], u[2])
    s_c = b.y_top * u[1]
    r = b.r_lip
    xs = (np.arange(n) + 0.5) / n * 2 * r - r
    w = 2 * np.sqrt(np.maximum(r * r - xs * xs, 0)) * (2 * r / n)
    s = s_c - xs * sin_t                     # x measured toward the low side
    h = np.maximum(d - s, 0.0)
    Q = Cd * float((w * np.sqrt(2 * G * h)).sum())
    A_sub = float(w[h > 0].sum())
    return Q, A_sub, s_c - r * sin_t, s_c + r * sin_t


def plugged(b, u, d):
    """True if air cannot reach the main air pocket (liquid plug in the neck) -> glug (counter-flow) regime.
    Scans the HIGH-side generatrix g(y) = y*uy + r(y)*sin from the lip downwards."""
    sin_t = math.hypot(u[0], u[2])
    g = b.spine_y * u[1] + b.spine_r * sin_t
    g = g[::-1]                              # from the lip downwards
    wet = g <= d
    if wet[0]:
        return True                          # lip fully submerged
    if not wet.any():
        return False
    first = int(np.argmax(wet))
    return bool((~wet[first:]).any())        # dry again further in = trapped air pocket behind a liquid plug


def glug_rate(b, k_g=0.37):
    """Counter-current flooding limit (Wallis-type): j_l = k_g * sqrt(g * D), Q = j_l * A_min. k_g ~ 0.37 for C = 0.725."""
    D = 2 * b.r_min
    return k_g * b.A_min * math.sqrt(G * D)


def outflow(b, u, fill, k_g=0.37, Cd=0.62):
    d = b.offset(u, fill)
    Qf, A_sub, s_lo, s_hi = lip_flow(b, u, d, Cd)
    if Qf <= 0:
        return 0.0, False, d
    p = plugged(b, u, d)
    Q = min(Qf, glug_rate(b, k_g)) if p else Qf
    return Q, p, d


def load_points(glb, node="Liquid", target=500000, seed=0):
    V, F, ex = L.read_glb_node(os.path.join(ROOT, "export", glb), node)
    pts, w, info = L.voxelize_auto(V, F, seed=seed, target_points=target)
    return pts.astype(np.float64), w, ex
