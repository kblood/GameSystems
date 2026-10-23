"""Material contact, hand, slide, footstep and creak sounds for the audio system (extensions/audio). Registered in the
same SOUNDS table as synth_sounds.py (synth_all.py imports this module). See README.md. MIT/CC0."""
import numpy as np
from synth_lib import *
from synth_sounds import sound, jit

# ---------------------------------------------------------------- 7. material contacts
# One recipe per material, three strengths (0 light, 1 medium, 2 hard). Light = higher/shorter/quieter, hard = lower,
# longer, thump-heavy and (for rigid materials) a small rebound. Peak targets rise with strength so the files keep
# their natural loudness order; the engine adds gain/pitch from the contact speed on top.
LEVELS = ("light", "medium", "hard")
LEVEL_PEAK = (-14.0, -9.0, -4.0)
FREQ_MULT = (1.25, 1.0, 0.82)
T60_MULT = (0.6, 1.0, 1.5)
NOISE_G = (0.5, 1.0, 1.7)
MATERIALS = {
    # f: base mode range, ratios/amps: modes, t60: first-mode T60 range, lp: noise lowpass, tau: noise decay,
    # click: band of the transient, cg: click gain, body: low thump (Hz range, gain), bounce: hard-level rebound
    "wood": dict(f=(190, 400), ratios=[1, 2.4, 4.1, 6.3], amps=[1, .6, .35, .2], t60=(.07, .16), lp=(900, 1800), tau=.012,
                 click=(1500, 5000), cg=.35, body=((80, 140), .5), bounce=True),
    "metal": dict(f=(800, 1900), ratios=list(METAL_RATIOS), amps=list(METAL_AMPS), t60=(.3, .9), lp=(3000, 6000), tau=.004,
                  click=(3000, 11000), cg=.7, body=None, bounce=True),
    "concrete": dict(f=(420, 1100), ratios=[1, 1.9, 3.3], amps=[.6, .4, .25], t60=(.03, .07), lp=(1200, 2600), tau=.014,
                     click=(2000, 7000), cg=.5, body=((70, 120), .8), bounce=False, grit=True),
    "ceramic": dict(f=(1300, 2500), ratios=[1, 2.7, 5.1, 8.2], amps=[1, .6, .4, .25], t60=(.18, .45), lp=(3000, 6000), tau=.005,
                    click=(3500, 10000), cg=.6, body=((200, 320), .3), bounce=True),
    "cardboard": dict(f=(150, 290), ratios=[1, 2.2], amps=[1, .4], t60=(.05, .1), lp=(700, 1500), tau=.016,
                      click=(1000, 3500), cg=.2, body=None, bounce=False, rattle=True),
    "plastic": dict(f=(420, 900), ratios=[1, 2.07, 3.4], amps=[1, .55, .3], t60=(.045, .1), lp=(2000, 4000), tau=.008,
                    click=(2500, 8000), cg=.45, body=((140, 220), .35), bounce=True),
    "fabric": dict(f=None, ratios=None, amps=None, t60=(.04, .06), lp=(350, 700), tau=.03,
                   click=None, cg=0, body=((70, 130), 1.0), bounce=False, rustle=True),
}


def _hit(rng, m, level, dur, scale=1.0):
    t = t_axis(dur)
    out = zeros(dur)
    t60 = jit(rng, *m["t60"]) * T60_MULT[level]
    if m["ratios"] is not None:
        f0 = jit(rng, *m["f"]) * FREQ_MULT[level]
        n = len(m["ratios"])
        t60s = t60 / (1 + 0.5 * np.arange(n)) * rng.uniform(0.8, 1.2, n)
        out += modal(f0 * np.array(m["ratios"]), np.array(m["amps"]) * rng.uniform(0.7, 1, n), t60s, dur, rng)
    lp = jit(rng, *m["lp"]) * (FREQ_MULT[level] ** 0.5)
    out += lowpass(white(rng, dur), lp) * np.exp(-t / (m["tau"] * (0.8 + 0.4 * level))) * (1.5 * NOISE_G[level])
    if m["click"]:
        add_at(out, click(rng, 0.003, m["click"]), 0, gain=m["cg"] * (0.7 + 0.3 * level))
    if m["body"]:
        (blo, bhi), bg = m["body"]
        fb = jit(rng, blo, bhi) * FREQ_MULT[level]
        out += pitch_drop_sine(fb * 1.5, fb, 0.012, 0.03 + 0.03 * level, dur, bg * (0.6 + 0.4 * level))
    if m.get("grit"):  # gritty scatter of stone/concrete
        for _ in range(rng.integers(6, 14)):
            g = bandpass(white(rng, 0.004), 2500, 9000) * np.hanning(int(0.004 * SR))
            add_at(out, g, rng.exponential(0.012), gain=0.5 * rng.uniform(0.3, 1.0) * NOISE_G[level])
    if m.get("rattle"):  # loose cardboard flaps
        for _ in range(rng.integers(3, 8)):
            add_at(out, bandpass(white(rng, 0.012), 900, 4000) * np.exp(-t_axis(0.012) / 0.004), rng.uniform(0.005, 0.07), gain=0.25 * NOISE_G[level])
    if m.get("rustle"):  # cloth/leather rubbing
        out += bandpass(white(rng, dur), 1200, 5000) * np.exp(-t / 0.05) * np.minimum(1, t / 0.006) * 0.18 * NOISE_G[level]
    return out * scale


def _contact(mat, level):
    m = MATERIALS[mat]

    def fn(rng, i, n):
        t60 = m["t60"][1] * T60_MULT[level]
        dur = min(1.1 * t60 + 0.1, 0.7) * jit(rng, 0.88, 1.0) + (0.05 if m["ratios"] is None else 0)
        out = _hit(rng, m, level, dur)
        if level == 2 and m["bounce"]:  # hard drops rebound once or twice, ever smaller
            gap, amp = jit(rng, 0.07, 0.13), 0.32
            out = np.concatenate([out, zeros(0.3)])
            for _ in range(rng.integers(1, 3)):
                add_at(out, _hit(rng, m, 1, dur * 0.8, 0.9), gap, gain=amp)
                gap += gap * 0.7
                amp *= 0.5
        return out
    return fn


for _mat in MATERIALS:
    for _lv, _name in enumerate(LEVELS):
        sound(f"contact_{_mat}_{_name}", 5, LEVEL_PEAK[_lv],
              doc=f"{_mat} contact, {_name} strength (object hits/drops on {_mat})")(_contact(_mat, _lv))


# ---------------------------------------------------------------- 8. hand grab / release, fold, slide loops
@sound("hand_grab", 5, -10.0, doc="hand closes on an object: skin pat + fabric/rubber rustle")
def hand_grab(rng, i, n):
    dur = jit(rng, 0.16, 0.26)
    t = t_axis(dur)
    out = lowpass(white(rng, dur), jit(rng, 400, 900)) * np.exp(-t / 0.022) * 2.0
    out += pitch_drop_sine(jit(rng, 160, 240), 100, 0.015, 0.04, dur, 0.8)
    out += bandpass(white(rng, dur), 1800, 5500) * np.exp(-t / jit(rng, 0.03, 0.06)) * np.minimum(1, t / 0.008) * 0.35
    return out


@sound("hand_release", 5, -14.0, doc="fingers open: short light rustle, softer than the grab")
def hand_release(rng, i, n):
    dur = jit(rng, 0.12, 0.2)
    t = t_axis(dur)
    out = bandpass(white(rng, dur), 1500, 6000) * np.exp(-t / jit(rng, 0.03, 0.05)) * np.minimum(1, t / 0.01)
    out += lowpass(white(rng, dur), 500) * np.exp(-t / 0.012) * 0.8
    return out


@sound("cardboard_fold", 4, -8.0, doc="cardboard/paper folds and crinkles")
def cardboard_fold(rng, i, n):
    dur = jit(rng, 0.3, 0.5)
    t = t_axis(dur)
    out = bandpass(white(rng, dur), 1200, 6000) * np.exp(-t / 0.12) * np.minimum(1, t / 0.03) * 0.5
    for _ in range(rng.integers(30, 60)):
        c = bandpass(white(rng, 0.006), jit(rng, 1500, 4000), jit(rng, 5000, 9000)) * np.exp(-t_axis(0.006) / jit(rng, 0.001, 0.003))
        add_at(out, c, rng.exponential(0.1), gain=rng.uniform(0.3, 1.0))
    return out


def _stickslip(rng, n, rate, depth=0.8):
    """Periodic positive stick-slip envelope with an integer number of cycles in n samples."""
    cycles = max(1, int(round(rate * n / SR)))
    t = np.arange(n) / n
    ph = 2 * np.pi * cycles * t + 1.5 * np.sin(2 * np.pi * 3 * t + rng.uniform(0, 6))
    return 1 - depth + depth * (0.5 + 0.5 * np.sin(ph)) ** 2


@sound("slide_loop_hard", 3, -9.0, loop=True, doc="metal/stone scrape across a hard surface (loop)")
def slide_hard(rng, i, n):
    N = int(2.0 * SR)
    return periodic_noise(rng, N, 900 + 300 * i, 8000, tilt=-1.0) * _stickslip(rng, N, 9 + 5 * i, 0.5)


@sound("slide_loop_wood", 3, -10.0, loop=True, doc="wood/crate dragged over a floor (loop)")
def slide_wood(rng, i, n):
    N = int(2.0 * SR)
    x = periodic_noise(rng, N, 120, 1800, tilt=-2.0) * _stickslip(rng, N, 6 + 3 * i, 0.8)
    return x + 0.3 * periodic_noise(rng, N, 1800, 5000) * _stickslip(rng, N, 11 + 2 * i, 0.9)


@sound("slide_loop_soft", 3, -14.0, loop=True, doc="cloth/leather/cardboard drag (loop)")
def slide_soft(rng, i, n):
    N = int(2.0 * SR)
    return periodic_noise(rng, N, 200, 3000, tilt=-3.0) * _stickslip(rng, N, 4 + 2 * i, 0.4)


# ---------------------------------------------------------------- 9. footsteps
def _step(rng, kind):
    dur = jit(rng, 0.28, 0.4)
    out = zeros(dur)
    gap = jit(rng, 0.07, 0.11)
    for start, gain in ((0.0, 1.0), (gap, 0.55)):  # heel, then toe
        seg = dur - start
        ts = t_axis(seg)
        if kind == "concrete":
            h = bandpass(white(rng, seg), 1500, 5500) * np.exp(-ts / 0.008) * 1.2
            h += pitch_drop_sine(jit(rng, 130, 180), 85, 0.012, 0.035, seg, 1.0)
            h += 0.3 * lowpass(white(rng, seg), 900) * np.exp(-ts / 0.02)
        elif kind == "wood":
            h = modal([jit(rng, 150, 260) * r for r in (1, 2.4, 4.1)], [1, .5, .25], [.14, .08, .05], seg, rng)
            h += lowpass(white(rng, seg), 1500) * np.exp(-ts / 0.012) * 1.2
            h += pitch_drop_sine(jit(rng, 100, 130), 70, 0.012, 0.04, seg, 0.8)
        elif kind == "metal":
            h = modal([jit(rng, 420, 900) * r for r in METAL_RATIOS[:4]], METAL_AMPS[:4], [.35, .2, .12, .08], seg, rng)
            h += bandpass(white(rng, seg), 2500, 9000) * np.exp(-ts / 0.004) * 1.3
            h += pitch_drop_sine(jit(rng, 120, 160), 90, 0.01, 0.03, seg, 0.7)
        else:  # grass / dirt: soft thump and crunch
            h = lowpass(white(rng, seg), jit(rng, 600, 1200)) * np.exp(-ts / 0.03) * 1.5
            h += pitch_drop_sine(jit(rng, 90, 120), 60, 0.015, 0.05, seg, 1.0)
            for _ in range(rng.integers(12, 26)):
                add_at(h, bandpass(white(rng, 0.004), 1500, 6000) * 0.35, rng.exponential(0.04), gain=rng.uniform(0.3, 1.0))
        add_at(out, h, start, gain=gain)
    return out


for _k, _pk in (("concrete", -6.0), ("wood", -6.0), ("metal", -7.0), ("grass", -9.0)):
    sound(f"footstep_{_k}", 6, _pk, doc=f"one footstep (heel + toe) on {_k}")(lambda rng, i, n, _k=_k: _step(rng, _k))


# ---------------------------------------------------------------- 10. creaks
def _creak(rng, f_lo, f_hi, dur, rough, rumble):
    n = int(round(dur * SR))
    t = np.arange(n) / SR
    f = np.interp(t, [0, dur * rng.uniform(0.3, 0.7), dur], [f_lo, f_hi * rng.uniform(0.8, 1.0), f_lo * rng.uniform(1.0, 1.3)])
    f = f * (1 + 0.04 * lowpass(rng.standard_normal(n), 30))
    ph = 2 * np.pi * np.cumsum(f) / SR
    tone = sum(np.sin(k * ph) / k ** 1.2 for k in range(1, 9))
    slip = np.clip(lowpass(rng.standard_normal(n), rough, order=2), 0, None)
    slip = slip / (slip.max() + 1e-9)
    env = np.minimum(1, t / 0.04) * np.minimum(1, (dur - t) / 0.08)
    out = tone * (0.15 + slip) * env
    out += rumble * lowpass(white(rng, dur), 600) * slip * env
    return bandpass(out, 200, 6000)


@sound("door_hinge_creak", 4, -9.0, doc="rusty door hinge creak, 1 s")
def door_creak(rng, i, n):
    return _creak(rng, jit(rng, 380, 520), jit(rng, 800, 1200), jit(rng, 0.8, 1.3), 45, 0.15)


@sound("drawer_creak", 4, -10.0, doc="wooden drawer slides open with a low creak")
def drawer_creak(rng, i, n):
    return _creak(rng, jit(rng, 140, 220), jit(rng, 320, 520), jit(rng, 0.5, 0.9), 30, 0.7)
