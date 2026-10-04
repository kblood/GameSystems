"""(d) Back-of-envelope cost model (GUESSES are marked). Screen coverage of a bottle in a Quest-3-class headset vs distance,
fragment counts for the liquid shader variants, memory of the tables, CPU work per pouring container.
Run: audio\\.venv\\Scripts\\python tests\\liquid_proto\\d_costs.py
"""
import math

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from common import OUT

PPD = 25.0                      # Quest 3 centre ~25 px/deg (published spec ~25 ppd), Steam-Frame class similar (guess)
EYE_PX = 2064 * 2208            # per eye
HZ = 90
GPU_GFLOPS = 1500.0             # GUESS: Adreno 740-class sustained FP32 ~1.5 TFLOPS (peak is higher; thermals lower it)
# ALU ops per liquid fragment (GUESS, hand count of bottle_liquid.gdshader; 1 op = 1 FP32 FMA/ALU slot)
VARIANTS = {
    "plane + Beer-Lambert (LOW)": 45,
    "+ 3 layers (multi-plane)": 45 + 3 * 22,
    "current full (bubbles 4 layers + foam voronoi)": 420,
    "full + 3 layers": 420 + 3 * 22,
}


def coverage(dist, h=0.34, w=0.075, liquid_frac=0.6, faces=1.6):
    """fragments per frame (both eyes) for the liquid of a bottle at distance dist (m). faces: cull_disabled front+back
    overdraw factor inside the liquid (front faces + back faces visible through the cut, GUESS 1.6)."""
    a_h = math.degrees(2 * math.atan(h / 2 / dist)) * PPD
    a_w = math.degrees(2 * math.atan(w / 2 / dist)) * PPD
    px = a_h * a_w * 0.8 * liquid_frac
    return 2 * px * faces


def main():
    ds = np.array([0.25, 0.35, 0.5, 0.75, 1.0, 2.0, 4.0])
    print("dist(m)  liquid frags/frame (2 eyes)  % of eye buffers | GPU ms per variant (GUESS ALU model)")
    rows = []
    for d in ds:
        fr = coverage(d)
        ms = {k: fr * v / (GPU_GFLOPS * 1e9) * 1e3 for k, v in VARIANTS.items()}
        rows.append((d, fr, ms))
        print(f"  {d:4.2f}   {fr / 1e3:9.0f}k            {100 * fr / (2 * EYE_PX):5.1f}%   | "
              + "  ".join(f"{k.split(' (')[0][:18]}={v:.3f}" for k, v in ms.items()))
    fig, ax = plt.subplots(figsize=(7, 4.4))
    for k in VARIANTS:
        ax.loglog(ds, [r[2][k] for r in rows], "o-", label=k)
    ax.axhline(1000 / HZ * 0.05, color="k", ls="--", lw=0.8, label="5% of an 11.1 ms frame")
    ax.set(xlabel="bottle distance (m)", ylabel="GPU ms/frame (both eyes, GUESS model)",
           title="liquid shader cost vs distance (one 34 cm bottle)")
    ax.legend(fontsize=7); ax.grid(alpha=0.3, which="both")
    fig.tight_layout(); fig.savefig(f"{OUT}/d_costs.png", dpi=110)

    print("\nmemory")
    print(f"  v1 LUT 33x64 float32            {33 * 64 * 4 / 1024:6.1f} KB (JSON ~20 KB)")
    print(f"  v2 sphere map 25x25x64 u16      {25 * 25 * 64 * 2 / 1024:6.1f} KB decoded to float32 {25 * 25 * 64 * 4 / 1024:6.1f} KB")
    print(f"  inverse cache 64 dirs x 64 d    {64 * 64 * 4 / 1024:6.1f} KB per container TYPE (shared)")
    print(f"  parcel ring 128 x (pos,vel,vol,mix id) 32 B   {128 * 32 / 1024:6.1f} KB per active stream")
    print(f"  LiquidMix 4 substances x (id u16, uL u32)   24 B per container -> save/net state")
    print("\nCPU per POURING container per physics tick (op counts; GDScript ~ 50-100x slower than C++, GUESS):")
    ops = {"LUT v2 offset (16 Catmull-Rom taps x 2 fill taps)": 16 * 2 * 3 + 40,
           "lip weir integral (16 strips)": 16 * 8,
           "plug scan (16 spine samples)": 16 * 5,
           "parcel step + disc test (30 parcels)": 30 * 25,
           "stream shape: 1 ray chain of 6 segments (physics)": 6 * 300}
    tot = 0
    for k, v in ops.items():
        tot += v
        print(f"  {k:52s} ~{v:5d} flops")
    print(f"  total ~{tot} flops -> C++ ~2-5 us, GDScript ~0.1-0.3 ms (GUESS); IDLE sealed container: 0 (no _process)")


if __name__ == "__main__":
    main()
