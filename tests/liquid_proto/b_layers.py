"""(b) Layered liquids from the EXISTING fill LUT: interface k at d_k = LUT(up, F_k), F_k = cumulative fill fraction
(densest layer first). Verified against a voxelisation of the real Liquid mesh from the GLB (brute force volume below
each plane). Also tests independently sloshing interface normals (each plane volume-correct on its own; fragments are
classified by COUNTING how many planes they lie above, which stays well defined when planes cross).
Run: audio\\.venv\\Scripts\\python tests\\liquid_proto\\b_layers.py
"""
import json
import math
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from common import OUT, ROOT, L, load_points

LAYERS = [0.25, 0.10, 0.30]          # bottom -> top fractions of capacity (e.g. syrup / juice / soda); 35% air


def rot_up(theta, phi):
    """world up in object space for tilt theta from object +Y, azimuth phi."""
    return np.array([math.sin(theta) * math.cos(phi), math.cos(theta), math.sin(theta) * math.sin(phi)])


def layer_volumes(pts, w, ups, ds):
    """ups (K,3), ds (K,) -> volume of each layer by counting planes below the point."""
    cnt = np.zeros(len(pts), dtype=np.int32)
    for u, d in zip(ups, ds):
        cnt += (pts @ u > d)
    W = w.sum()
    return np.array([w[cnt == k].sum() / W for k in range(len(ds))])   # layer k = above k planes, below the rest


def run_case(label, pts, w, lut, cap_ml, azimuths):
    F = np.cumsum(LAYERS)
    errs = []
    thetas = np.radians(np.arange(0, 181, 10))
    for phi in azimuths:
        for th in thetas:
            u = rot_up(th, phi)
            ds = np.array([float(lut.offset(u[None], np.array([f]))[0]) for f in F])
            v = layer_volumes(pts, w, [u] * 3, ds)
            errs.append([math.degrees(th), phi] + list((v - LAYERS) * cap_ml))
    E = np.array(errs)
    a = np.abs(E[:, 2:])
    print(f"{label:28s} cap {cap_ml:6.0f} ml | layer err ml: max {a.max():5.2f}  rms {np.sqrt((a**2).mean()):5.2f}"
          f" | max rel to layer {100 * (a / (np.array(LAYERS) * cap_ml)).max():4.1f}% | total-fill err max "
          f"{np.abs(E[:, 2:].sum(1)).max():.2f} ml")
    return E


def slosh_case(pts, w, lut, cap_ml, common=False):
    """top surface normal leans +alpha, the two interfaces lean -alpha*0.6 (out of phase, slower): worst-ish case."""
    F = np.cumsum(LAYERS)
    out = []
    for alpha in (0, 5, 10, 20, 30):
        worst = 0.0
        for th in np.radians([0, 45, 90, 135]):
            base = rot_up(th, 0.0)
            # lean around the object Z axis
            def lean(a):
                c, s = math.cos(a), math.sin(a)
                R = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
                return R @ base
            ia = math.radians(alpha) if common else -math.radians(alpha) * 0.6
            ups = [lean(ia), lean(ia), lean(math.radians(alpha))]
            ds = [float(lut.offset(u[None], np.array([f]))[0]) for u, f in zip(ups, F)]
            v = layer_volumes(pts, w, ups, np.array(ds))
            worst = max(worst, float(np.abs(v - LAYERS).max() * cap_ml))
        out.append((alpha, worst))
        print(f"   slosh lean {alpha:2d} deg ({'common normal' if common else 'interfaces opposite, 0.6x'}): worst layer error {worst:6.2f} ml "
              f"({100 * worst / (min(LAYERS) * cap_ml):.1f}% of the thinnest layer)")
    return out


def main():
    res = {}
    wine_pts, wine_w, _ = load_points("bottle_wine.glb")
    v1 = L.LutV1(json.load(open(os.path.join(ROOT, "export", "bottle_wine.liquid.json"))))
    v2 = L.LutV2(json.load(open(os.path.join(ROOT, "export", "bottle_wine.liquid_v2.json"))))
    res["wine v1 (33x64 axis)"] = run_case("wine v1 LUT (33x64)", wine_pts, wine_w, v1, 868.0, [0.0])
    res["wine v2 (sphere map)"] = run_case("wine v2 LUT (25x25x64)", wine_pts, wine_w, v2, 886.0, [0.0, 1.1])
    jc_pts, jc_w, _ = load_points("container_jerrycan.glb")
    jinfo = json.load(open(os.path.join(ROOT, "export", "container_jerrycan.liquid.json")))
    jv2 = L.LutV2(jinfo)
    res["jerrycan v2 (non-symmetric)"] = run_case("jerrycan v2 (non-symmetric)", jc_pts, jc_w, jv2, float(jinfo["capacity_ml"]),
                                                  [0.0, 0.8, 1.6, 2.4, 3.9, 5.2])
    print("wine v2, sloshing interfaces:")
    sl = slosh_case(wine_pts, wine_w, v2, 886.0)
    slc = slosh_case(wine_pts, wine_w, v2, 886.0, common=True)

    fig, ax = plt.subplots(1, 2, figsize=(13, 4.6))
    for k, (lab, E) in enumerate(res.items()):
        for j, name in enumerate(("bottom", "middle", "top")):
            ax[0].scatter(E[:, 0], E[:, 2 + j], s=9, marker="os^"[k], label=f"{lab}: {name}" if True else None,
                          color=f"C{3 * k + j}")
    ax[0].set(xlabel="tilt (deg)", ylabel="layer volume error (ml)", title="3 layers (25/10/30%) from the existing LUT")
    ax[0].legend(fontsize=6, ncol=1); ax[0].grid(alpha=0.3)
    a, wv = zip(*sl)
    ax[1].plot(a, wv, "o-", label="interfaces lean opposite (0.6x)")
    a2, wc = zip(*slc)
    ax[1].plot(a2, wc, "s-", label="all planes share the slosh normal")
    ax[1].legend()
    ax[1].set(xlabel="interface lean vs surface (deg)", ylabel="worst layer error (ml)",
              title="wine: independently sloshing interface planes")
    ax[1].grid(alpha=0.3)
    fig.tight_layout(); fig.savefig(f"{OUT}/b_layers.png", dpi=110)


if __name__ == "__main__":
    main()
