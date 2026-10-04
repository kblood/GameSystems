"""(c) Container-to-container transfer: source wine bottle (pour model from a_pour) -> ballistic parcels -> receiving
tumbler (production v2 LUT with rim points) or the floor. Exact volume ledger: every parcel carries its volume and is
deposited exactly once (receiver, rim split, overflow, floor). Checks conservation with float64, float32 and integer uL.
Run: audio\\.venv\\Scripts\\python tests\\liquid_proto\\c_transfer.py
"""
import json
import math
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from common import OUT, ROOT, G, L, Bottle, outflow, glug_rate

RNG = np.random.default_rng(7)


def rotz(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1.0]])


class Receiver:
    def __init__(self, base):
        info = json.load(open(os.path.join(ROOT, "export", "container_tumbler.liquid.json")))
        self.lut = L.LutV2(info)
        self.cap = float(info["capacity_ml"])
        rp = np.array(info["rim_points"])
        self.rim_y = float(rp[:, 1].mean())
        self.r_rim = float(np.hypot(rp[:, 0], rp[:, 2]).mean())
        self.base = np.array(base, dtype=float)
        self.vol = 0.0

    def max_fill(self):          # upright: brim fill (spill() would clamp at the lowest rim point when tilted)
        return 1.0


def run(dtype=np.float64, jitter=False, int_ledger=False, t_end=16.0, sweep=0.035):
    src = Bottle("wine")
    rec = Receiver([0.0, 0.75, 0.0])                 # tumbler on a 75 cm table, floor at y = 0
    to_u = (lambda ml: int(round(ml * 1000))) if int_ledger else (lambda ml: dtype(ml))
    src_ml = to_u(600.0)
    rec.vol = to_u(40.0)
    floor = to_u(0.0)
    parcels = []                                      # [pos(3), vel(3), vol]
    total0 = src_ml + rec.vol
    t, k = 0.0, 0
    log = dict(t=[], src=[], rec=[], floor=[], fly=[], err=[], n=[], Q=[])
    max_alive = 0
    while t < t_end:
        dt = 1 / 72 if not jitter else float(RNG.choice([1 / 90, 1 / 72, 1 / 45, 1 / 30]))
        # source pose: tilt ramps 0 -> 125 deg over 2.5 s, held, then back to 60 at t>11; base sways in x (misses)
        th = math.radians(min(125.0, 50.0 * t)) if t < 11 else math.radians(max(60.0, 125 - 60 * (t - 11)))
        R = rotz(th)                                   # object Y -> world (-sin, cos, 0): neck swings toward -x
        lip_target = np.array([0.012 + sweep * math.sin(2 * math.pi * t / 5.0), 1.02, 0.0])
        axis_w = R @ np.array([0, 1.0, 0])
        u = R.T @ np.array([0, 1.0, 0])
        fill = (src_ml / 1000.0 if int_ledger else float(src_ml)) / src.cap_ml
        Q, plug, d = outflow(src, u, fill) if fill > 0 else (0.0, False, 0.0)
        dml = Q * 1e6 * dt
        dq = to_u(dml)
        dq = min(dq, src_ml)
        if dq > 0:
            # low lip point in object space -> world; exit velocity from continuity through the jet area
            uxz = np.array([u[0], 0, u[2]]); n = np.linalg.norm(uxz)
            low = -uxz / n * src.r_lip if n > 1e-6 else np.zeros(3)
            p_lip_obj = np.array([low[0], src.y_top, low[2]])
            base_w = lip_target - R @ np.array([0, src.y_top, 0])
            p0 = base_w + R @ p_lip_obj
            A_jet = 0.5 * src.A_min if plug else max(0.62 * math.pi * src.r_lip ** 2 * 0.3, 1e-6)
            v0 = axis_w * min(Q / A_jet, 3.0)
            parcels.append([p0.astype(dtype), v0.astype(dtype), dq])
            src_ml -= dq
        # step parcels (exact parabola per tick), test the receiver opening disc then the floor
        keep = []
        for p, v, vol in parcels:
            p1 = p + v * dt + np.array([0, -0.5 * G * dt * dt, 0], dtype=dtype)
            v1 = v + np.array([0, -G * dt, 0], dtype=dtype)
            ry = rec.base[1] + rec.rim_y
            if p[1] >= ry > p1[1]:
                a = (p[1] - ry) / (p[1] - p1[1])
                x = p + (p1 - p) * a
                dist = math.hypot(float(x[0] - rec.base[0]), float(x[2] - rec.base[2]))
                r_s = math.sqrt(max(float(vol if not int_ledger else vol / 1000.0), 1e-9) * 1e-6 / math.pi / 0.05) * 0.5
                frac = min(1.0, max(0.0, (rec.r_rim - dist) / (2 * r_s) + 0.5))      # rim split
                if frac > 0:
                    inn = vol if frac >= 1.0 else (int(round(vol * frac)) if int_ledger else dtype(vol * frac))
                    rec.vol += inn
                    vol -= inn
                    cap_u = to_u(rec.cap * rec.max_fill())
                    if rec.vol > cap_u:                  # overflow: excess leaves over the rim -> floor
                        floor += rec.vol - cap_u
                        rec.vol = cap_u
                if vol == 0:
                    continue
            if p1[1] <= 0.0:
                floor += vol
                continue
            keep.append([p1, v1, vol])
        parcels = keep
        max_alive = max(max_alive, len(parcels))
        fly = sum(pp[2] for pp in parcels)
        tot = src_ml + rec.vol + floor + fly
        sc = 1000.0 if int_ledger else 1.0
        log["t"].append(t); log["src"].append(float(src_ml) / sc); log["rec"].append(float(rec.vol) / sc)
        log["floor"].append(float(floor) / sc); log["fly"].append(float(fly) / sc)
        log["err"].append(float(tot - total0) / sc); log["n"].append(len(parcels)); log["Q"].append(Q * 1e6)
        t += dt; k += 1
    return {kk: np.array(vv) for kk, vv in log.items()}, max_alive


def main():
    res = {}
    for name, kw in [("float64", dict()), ("float32", dict(dtype=np.float32)), ("float32 + dt jitter", dict(dtype=np.float32, jitter=True)),
                     ("int uL + dt jitter", dict(int_ledger=True, jitter=True))]:
        lg, mx = run(**kw)
        res[name] = lg
        print(f"{name:22s} src {lg['src'][-1]:7.2f} rec {lg['rec'][-1]:7.2f} floor {lg['floor'][-1]:7.2f} fly {lg['fly'][-1]:5.2f} "
              f"| max |ledger err| {np.abs(lg['err']).max():.2e} ml | max parcels alive {mx}")
    lg = res["float64"]
    fig, ax = plt.subplots(1, 2, figsize=(13, 4.6))
    for k in ("src", "rec", "floor", "fly"):
        ax[0].plot(lg["t"], lg[k], label=k)
    ax[0].set(xlabel="time (s)", ylabel="ml", title="wine 600 ml -> tumbler (232 ml, 40 ml in), swaying source")
    ax[0].legend(); ax[0].grid(alpha=0.3)
    for name, l in res.items():
        ax[1].semilogy(l["t"], np.abs(l["err"]) + 1e-16, label=name)
    ax[1].set(xlabel="time (s)", ylabel="|ledger error| (ml)", title="volume conservation error")
    ax[1].legend(); ax[1].grid(alpha=0.3)
    fig.tight_layout(); fig.savefig(f"{OUT}/c_transfer.png", dpi=110)


if __name__ == "__main__":
    main()
