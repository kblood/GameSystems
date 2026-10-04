"""(a) Pour-out simulation with the plane/LUT model + Torricelli/weir lip flow + glug (counter-flow) limit.

Bottle tilts at a constant angular rate omega from upright to theta_max and holds there. Each step (dt = 1/72 s):
    up_obj -> d = LUT(up, fill)  ->  Q (free weir flow over the lip; capped by the glug rate when the neck is plugged)
    fill -= Q*dt / capacity
Outputs out/a_pour_*.png and prints a table. Run: audio\\.venv\\Scripts\\python tests\\liquid_proto\\a_pour.py
"""
import math

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from common import OUT, Bottle, outflow, glug_rate

DT = 1 / 72


def simulate(b, fill0, omega_deg, theta_max_deg=180.0, t_end=60.0, k_g=0.37):
    th, f, t = 0.0, fill0, 0.0
    T, F, Q, P, TH = [], [], [], [], []
    while t < t_end:
        th = min(math.radians(theta_max_deg), th + math.radians(omega_deg) * DT)
        u = b.up(th)
        q, plug, d = outflow(b, u, f, k_g=k_g)
        dv = min(q * DT, f * b.cap_ml * 1e-6)
        f -= dv / (b.cap_ml * 1e-6)
        T.append(t); F.append(f * b.cap_ml); Q.append(q * 1e6); P.append(plug); TH.append(math.degrees(th))
        t += DT
    return np.array(T), np.array(F), np.array(Q), np.array(P), np.array(TH)


def t_to(T, F, ml):
    i = np.argmax(F <= ml)
    return T[i] if F[i] <= ml else float("nan")


def main():
    rows = []
    # 1) wine, 750 ml, several tilt rates to fully inverted
    b = Bottle("wine")
    f0 = 750 / b.cap_ml
    fig, ax = plt.subplots(1, 2, figsize=(13, 4.6))
    for om in (20, 45, 90, 180, 1e4):
        T, F, Q, P, TH = simulate(b, f0, om)
        lab = "instant" if om > 1000 else f"{om:.0f} deg/s"
        ax[0].plot(T, F, label=lab)
        if om in (45, 1e4):
            ax[1].plot(T, Q, label=f"Q {lab}")
        rows.append(("wine 750ml -> 180", lab, t_to(T, F, 750 * 0.5), t_to(T, F, 750 * 0.05), float(P[Q > 0].mean()) if (Q > 0).any() else 0.0, float(F[-1])))
    ax[0].set(xlabel="time (s)", ylabel="volume left (ml)", title="wine bottle, 750 ml, tilt to 180 deg at rate",
              xlim=(0, 30))
    ax[0].legend(); ax[0].grid(alpha=0.3)
    ax[1].set(xlabel="time (s)", ylabel="outflow (ml/s)", title="wine: flow rate (glug-capped after the first spurt)",
              xlim=(0, 30))
    ax[1].legend(); ax[1].grid(alpha=0.3)
    fig.tight_layout(); fig.savefig(f"{OUT}/a_pour_wine_rates.png", dpi=110)

    # 2) calibration sensitivity: k_g
    for kg in (0.25, 0.37, 0.5):
        T, F, Q, P, TH = simulate(b, f0, 1e4, k_g=kg)
        rows.append((f"wine 750ml instant k_g={kg}", "instant", t_to(T, F, 375), t_to(T, F, 37.5), float(P[Q > 0].mean()), float(F[-1])))

    # 3) hold angles (residual + time) for wine
    fig, ax = plt.subplots(figsize=(7, 4.4))
    for hold in (80, 100, 120, 150, 180):
        T, F, Q, P, TH = simulate(b, f0, 90, theta_max_deg=hold, t_end=40)
        ax.plot(T, F, label=f"hold {hold} deg (left {F[-1]:.0f} ml)")
        rows.append((f"wine 750ml hold {hold}", "90 deg/s", t_to(T, F, 375), t_to(T, F, 37.5), float(P[Q > 0].mean()) if (Q > 0).any() else 0.0, float(F[-1])))
    ax.set(xlabel="time (s)", ylabel="volume left (ml)", title="wine 750 ml: tilt at 90 deg/s, then hold")
    ax.legend(fontsize=8); ax.grid(alpha=0.3)
    fig.tight_layout(); fig.savefig(f"{OUT}/a_pour_wine_hold.png", dpi=110)

    # 4) all shapes, full, instant inversion and 90 deg/s
    fig, ax = plt.subplots(figsize=(7, 4.4))
    print("\nshape geometry: name cap_ml r_lip_mm r_min_mm Q_glug_ml_s")
    for n in ("wine", "beer", "soda", "whiskey", "jar", "flask"):
        bb = Bottle(n)
        print(f"  {n:8s} {bb.cap_ml:6.0f} {bb.r_lip*1e3:6.1f} {bb.r_min*1e3:6.1f} {glug_rate(bb)*1e6:7.1f}")
        T, F, Q, P, TH = simulate(bb, 0.95, 90)
        ax.plot(T, F / bb.cap_ml * 100, label=f"{n} ({bb.cap_ml:.0f} ml)")
        rows.append((f"{n} 95% -> 180", "90 deg/s", t_to(T, F, bb.cap_ml * 0.95 * 0.5), t_to(T, F, bb.cap_ml * 0.95 * 0.05),
                     float(P[Q > 0].mean()) if (Q > 0).any() else 0.0, float(F[-1])))
    ax.set(xlabel="time (s)", ylabel="fill (%)", title="all bottles, 95% full, tilt 90 deg/s to 180", xlim=(0, 30))
    ax.legend(); ax.grid(alpha=0.3)
    fig.tight_layout(); fig.savefig(f"{OUT}/a_pour_shapes.png", dpi=110)

    print("\nscenario                         rate        t_half(s)  t_95%out(s)  plugged_frac_while_flowing  left_ml_at_end")
    for r in rows:
        print(f"  {r[0]:32s} {r[1]:10s} {r[2]:8.2f}  {r[3]:9.2f}   {r[4]:.2f}   {r[5]:7.1f}")


if __name__ == "__main__":
    main()
