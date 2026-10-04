"""Sound recipes. Each generator g(rng, i, n) -> float array; i = variant index, n = variant count.
Registered in SOUNDS with count, peak level, loop flag. See README.md for recipes. MIT/CC0."""
import numpy as np
from synth_lib import *

SOUNDS = {}


def sound(name, count, peak_db=-3.0, loop=False, doc=""):
    def deco(fn):
        SOUNDS[name] = dict(fn=fn, count=count, peak_db=peak_db, loop=loop, doc=doc)
        return fn
    return deco


def jit(rng, a, b):
    return rng.uniform(a, b)


# ---------------------------------------------------------------- 1. clinks
def glass_ring(rng, base, t60_base, dur, n_modes=6, bright=1.0, beat=0.0):
    ratios = GLASS_RATIOS[:n_modes]
    amps = GLASS_AMPS[:n_modes] * bright ** np.arange(n_modes) * rng.uniform(0.7, 1.0, n_modes)
    t60 = t60_base / (1 + 0.55 * np.arange(n_modes)) * rng.uniform(0.8, 1.2, n_modes)
    x = modal(base * ratios, amps, t60, dur, rng)
    if beat:  # slightly split twin modes -> shimmering beats typical of real bottles
        x += 0.6 * modal(base * ratios * (1 + beat), amps, t60, dur, rng)
    return x


@sound("glass_clink_soft", 6, -9.0, doc="soft bottle-on-bottle/table touch")
def glass_clink_soft(rng, i, n):
    base = jit(rng, 1500, 2300)
    dur = jit(rng, 0.45, 0.65)
    x = glass_ring(rng, base, jit(rng, 0.25, 0.4), dur, 5, bright=0.8, beat=0.003)
    tr = np.zeros_like(x)
    add_at(tr, click(rng, 0.002, (3000, 8000)), 0, gain=0.5)
    low = modal([base * 0.45], [0.4], [0.05], dur, rng)  # dull body tick
    return x + tr + low


@sound("glass_clink_hard", 6, -4.0, doc="hard bottle-on-bottle clink")
def glass_clink_hard(rng, i, n):
    base = jit(rng, 1800, 2900)
    dur = jit(rng, 0.8, 1.1)
    x = glass_ring(rng, base, jit(rng, 0.5, 0.9), dur, 6, bright=1.05, beat=jit(rng, 0.002, 0.006))
    tr = zeros(dur)
    add_at(tr, click(rng, 0.003, (2500, 12000)), 0)
    return x + tr + modal([base * 0.4], [0.5], [0.04], dur, rng)


@sound("glass_impact_thud", 6, -3.0, doc="glass bottle hits floor, no break")
def glass_impact_thud(rng, i, n):
    dur = jit(rng, 0.45, 0.6)
    f = jit(rng, 120, 210)
    body = pitch_drop_sine(f * 1.5, f, 0.015, jit(rng, 0.05, 0.08), dur, 1.0)
    body += 0.5 * pitch_drop_sine(f * 2.6, f * 2.2, 0.02, 0.04, dur)
    thump = lowpass(white(rng, dur), jit(rng, 500, 900)) * np.exp(-t_axis(dur) / 0.02) * 2.0
    ring = glass_ring(rng, jit(rng, 800, 1300), 0.18, dur, 5, bright=0.7) * 0.35
    ring *= np.minimum(1, t_axis(dur) / 0.001)
    return body + thump + ring


@sound("plastic_bottle_bounce", 6, -4.0, doc="empty plastic bottle bounces (2-4 hits)")
def plastic_bounce(rng, i, n):
    dur = jit(rng, 0.7, 0.95)
    out = zeros(dur)
    t = 0.0
    amp = 1.0
    gap = jit(rng, 0.13, 0.19)
    f = jit(rng, 220, 340)
    for k in range(rng.integers(2, 5)):
        hit = modal([f, f * 2.07, f * 3.4], [1, 0.5, 0.25], [0.07, 0.05, 0.03], 0.2, rng)
        hit += lowpass(white(rng, 0.2), 2500) * np.exp(-t_axis(0.2) / 0.008) * 0.8
        add_at(out, hit * amp, t)
        t += gap
        gap *= 0.62
        amp *= 0.55
        f *= jit(rng, 0.97, 1.03)
    return out


@sound("plastic_bottle_dent", 4, -5.0, doc="plastic bottle crackly dent / squeeze")
def plastic_dent(rng, i, n):
    dur = jit(rng, 0.25, 0.4)
    out = zeros(dur)
    f = jit(rng, 300, 480)
    add_at(out, pitch_drop_sine(f * 1.3, f, 0.02, 0.05, 0.2, 0.8), 0)
    for _ in range(rng.integers(10, 22)):
        t = rng.exponential(0.07)
        c = modal([jit(rng, 1200, 3200)], [1], [jit(rng, 0.004, 0.012)], 0.03, rng)
        add_at(out, c * jit(rng, 0.2, 0.7), t)
    return out


# ---------------------------------------------------------------- 3. shatter
def shard_grains(rng, out, count, t_scale, t_max, f_range, t60_range, amp0=1.0, amp_decay=0.6, start=0.0):
    for _ in range(count):
        t = start + min(rng.exponential(t_scale), t_max)
        f = np.exp(rng.uniform(np.log(f_range[0]), np.log(f_range[1])))
        t60 = jit(rng, *t60_range)
        g = modal([f, f * jit(rng, 1.9, 2.8)], [1, 0.4], [t60, t60 * 0.5], t60 * 1.3, rng)
        g[:60] *= np.linspace(0, 1, 60)
        a = amp0 * jit(rng, 0.2, 1.0) * np.exp(-t * amp_decay / max(t_scale, 0.05))
        add_at(out, g, t, gain=a)


def shatter(rng, dur, large, scale=1.0):
    out = zeros(dur)
    t = t_axis(dur)
    f_pop = jit(rng, 70, 110) if large else jit(rng, 110, 170)
    out += pitch_drop_sine(f_pop * 2, f_pop, 0.02, 0.05 if large else 0.035, dur, 1.1 * scale)
    nd = jit(rng, 0.09, 0.14) if large else jit(rng, 0.05, 0.09)
    burst = bandpass(white(rng, dur), 1200, 9000) * np.exp(-t / nd) * np.minimum(1, t / 0.0005)
    out += burst * 1.2 * scale
    mid = bandpass(white(rng, dur), 400, 3000) * np.exp(-t / (nd * 1.6))
    out += mid * 0.6 * scale
    if large:  # a few big chunk resonances (lower, longer)
        for _ in range(rng.integers(5, 9)):
            f = jit(rng, 700, 2200)
            g = modal(f * GLASS_RATIOS[:3], GLASS_AMPS[:3], [0.2, 0.12, 0.07], 0.3, rng)
            add_at(out, g, rng.exponential(0.12), gain=jit(rng, 0.1, 0.35))
    cnt = int((rng.integers(150, 230) if large else rng.integers(70, 110)) * scale)
    fr = (1500, 6500) if large else (2200, 8000)
    shard_grains(rng, out, cnt, 0.18 if large else 0.12, 0.6, fr, (0.02, 0.2), 0.45, 1.0)
    # sparse long tinkle tail, 0-600 ms stagger + later single shards
    shard_grains(rng, out, int(cnt * 0.15), 0.5, dur - 0.3, (2500, 8000), (0.02, 0.12), 0.18, 1.5)
    # high-frequency emphasis (first difference mix)
    d = np.diff(out, prepend=0)
    return out + 0.3 * d


@sound("glass_shatter_small", 6, -2.0, doc="small bottle/glass shatters")
def shatter_small(rng, i, n):
    return shatter(rng, jit(rng, 1.3, 1.6), False)


@sound("glass_shatter_large", 6, -1.5, doc="large bottle shatters")
def shatter_large(rng, i, n):
    return shatter(rng, jit(rng, 2.2, 2.7), True)


@sound("shard_settle", 8, -8.0, doc="single small shard ticks/skitters on floor")
def shard_settle(rng, i, n):
    dur = 0.3
    out = zeros(dur)
    f = jit(rng, 3000, 7500)
    t = 0.0
    a = 1.0
    for k in range(rng.integers(1, 4)):
        g = modal([f, f * 2.4], [1, 0.4], [jit(rng, 0.03, 0.1)] * 2, 0.15, rng)
        g[:30] *= np.linspace(0, 1, 30)
        add_at(out, g, t, gain=a)
        t += jit(rng, 0.02, 0.07)
        a *= 0.5
        f *= jit(rng, 0.95, 1.05)
    return out + 0.0


# ---------------------------------------------------------------- 2/4 liquid
def splash(rng, dur, large):
    out = zeros(dur)
    t = t_axis(dur)
    nd = jit(rng, 0.2, 0.3) if large else jit(rng, 0.08, 0.14)
    noise = bandpass(white(rng, dur), 250, 5500 if not large else 3500)
    out += noise * np.exp(-t / nd) * np.minimum(1, t / 0.004) * 0.8
    if large:
        out += pitch_drop_sine(jit(rng, 140, 200), 70, 0.08, 0.12, dur, 1.0)
        nb, tmax, fr = rng.integers(45, 70), 0.9, (150, 1500)
    else:
        nb, tmax, fr = rng.integers(14, 26), 0.4, (500, 3200)
    for _ in range(nb):
        tt = min(rng.exponential(tmax / 3), tmax)
        f = np.exp(rng.uniform(np.log(fr[0]), np.log(fr[1])))
        out_b = bubble(f, rng, rise=jit(rng, 0.1, 0.5))
        add_at(out, out_b, tt, gain=jit(rng, 0.15, 0.7) * np.exp(-tt / (tmax * 0.7)))
    # droplet patter
    for _ in range(rng.integers(5, 14)):
        tt = jit(rng, 0.1, dur * 0.8)
        add_at(out, bubble(jit(rng, 1800, 4500), rng), tt, gain=jit(rng, 0.05, 0.2))
    return out


@sound("liquid_splash_small", 5, -4.0)
def splash_small(rng, i, n):
    return splash(rng, jit(rng, 0.6, 0.8), False)


@sound("liquid_splash_large", 5, -3.0)
def splash_large(rng, i, n):
    return splash(rng, jit(rng, 1.3, 1.7), True)


GLUG_FILLS = [0.95, 0.8, 0.65, 0.5, 0.35, 0.2]


@sound("liquid_glug", 6, -5.0, loop=True,
       doc="pouring glugs; variant i has fill GLUG_FILLS[i]; seamless loop of k pulses")
def liquid_glug(rng, i, n):
    fill = GLUG_FILLS[i]
    period0 = 0.11 + 0.21 * fill  # fuller bottle -> slower glugs
    k = max(4, int(round(2.2 / period0)))
    period = 2.2 / k * 1.0
    N = int(round(k * period * SR))
    dur = N / SR
    out = np.zeros(N)
    fbase = 230 + (1 - fill) * 330  # emptier -> bigger air volume change -> higher
    for p in range(k):
        t0 = p * period + rng.uniform(-0.1, 0.1) * period
        f = fbase * jit(rng, 0.9, 1.1)
        L = period * 0.85
        tt = t_axis(L)
        fr = f * (1 + 0.6 * (1 - np.exp(-tt / 0.03)))
        ph = 2 * np.pi * np.cumsum(fr) / SR
        env = np.sin(np.pi * np.clip(tt / L, 0, 1)) ** 1.5
        g = np.sin(ph) * env + 0.35 * np.sin(2.1 * ph + 1) * env
        g += lowpass(white(rng, L), 1400) * env * 0.4
        add_at(out, g, t0 % dur, circular=True, gain=jit(rng, 0.7, 1.0))
    out += periodic_noise(rng, N, 300, 2500, tilt=-3) * 0.25 / 1.0  # liquid body bed
    for _ in range(int(k * 2)):
        add_at(out, bubble(jit(rng, 600, 2500), rng), rng.uniform(0, dur), circular=True, gain=jit(rng, 0.1, 0.3))
    return out


@sound("liquid_stream_loop", 3, -8.0, loop=True, doc="seamless liquid pouring/leaking stream")
def liquid_stream_loop(rng, i, n):
    dur = 4.0
    N = int(dur * SR)
    out = periodic_noise(rng, N, 400 + 100 * i, 5000, tilt=-2.0) * 1.0
    # slow periodic amplitude waviness (integer cycles -> periodic)
    t = np.arange(N) / N
    mod = 1 + 0.25 * np.sin(2 * np.pi * (3 + i) * t + rng.uniform(0, 6)) + 0.15 * np.sin(2 * np.pi * (7 + 2 * i) * t + rng.uniform(0, 6))
    out = out / np.std(out) * mod
    for _ in range(int(25 + 10 * i) * 4 // 2):
        add_at(out, bubble(np.exp(rng.uniform(np.log(500), np.log(3500))), rng),
               rng.uniform(0, dur), circular=True, gain=jit(rng, 0.2, 0.7))
    out += periodic_noise(rng, N, 80, 400, tilt=0) * 0.25 / 1.0 * 0.5
    return out


@sound("liquid_slosh", 5, -6.0, doc="gentle wave movement in a bottle")
def liquid_slosh(rng, i, n):
    dur = jit(rng, 0.7, 1.0)
    N = int(dur * SR)
    t = t_axis(dur)
    sw = int(rng.integers(1, 3))
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 2
    env *= 0.6 + 0.4 * np.sin(2 * np.pi * sw * t / dur * 1.5 + 1)
    x = white(rng, dur)
    # sweeping low-pass: crude time-varying filter by blending two cutoffs
    a = lowpass(x, 600)
    b = lowpass(x, 2200)
    m = 0.5 + 0.5 * np.sin(2 * np.pi * t / dur * jit(rng, 1.0, 2.0) + rng.uniform(0, 6))
    out = (a * (1 - m) + b * m) * env
    for _ in range(rng.integers(3, 8)):
        add_at(out, bubble(jit(rng, 300, 1400), rng), jit(rng, 0.05, dur * 0.8), gain=jit(rng, 0.2, 0.5))
    return out


# ---------------------------------------------------------------- 5. fizz, caps
@sound("fizz_loop", 2, -9.0, loop=True, doc="carbonation fizz (hiss + tiny bubble pops), seamless")
def fizz_loop(rng, i, n):
    dur = 3.0
    N = int(dur * SR)
    hiss = periodic_noise(rng, N, 3500, 14000, tilt=-1.0)
    hiss = hiss / np.std(hiss)
    t = np.arange(N) / N
    hiss *= 0.5 * (1 + 0.3 * np.sin(2 * np.pi * (5 + i) * t + rng.uniform(0, 6)) + 0.2 * np.sin(2 * np.pi * 13 * t + rng.uniform(0, 6)))
    out = hiss * 0.6
    for _ in range(int(dur * (330 + 120 * i))):
        f = np.exp(rng.uniform(np.log(2500), np.log(9000)))
        add_at(out, bubble(f, rng, tau=jit(rng, 0.0008, 0.0025), rise=0.1), rng.uniform(0, dur),
               circular=True, gain=jit(rng, 0.1, 0.8))
    return out


@sound("bubble_pop", 8, -8.0, doc="single bubble pop at the surface")
def bubble_pop(rng, i, n):
    dur = 0.18
    out = zeros(dur)
    f = np.exp(rng.uniform(np.log(600), np.log(3000)))
    add_at(out, bubble(f, rng, rise=jit(rng, 0.1, 0.4)), 0.002)
    add_at(out, click(rng, 0.0012, (3000, 9000)), 0, gain=0.3)
    return out


@sound("cork_pop", 5, -3.0, doc="cork pulled from bottle neck")
def cork_pop(rng, i, n):
    dur = jit(rng, 0.45, 0.6)
    f = jit(rng, 260, 420)  # neck Helmholtz-ish resonance
    out = zeros(dur)
    out += pitch_drop_sine(f * 1.5, f, 0.01, 0.045, dur, 1.0)
    out += 0.4 * pitch_drop_sine(f * 2.9, f * 2.6, 0.01, 0.025, dur)
    out += lowpass(white(rng, dur), 2500) * np.exp(-t_axis(dur) / 0.006) * 0.7
    add_at(out, click(rng, 0.0015, (1500, 6000)), 0, gain=0.5)
    out += bandpass(white(rng, dur), 3500, 9000) * np.exp(-t_axis(dur) / 0.07) * 0.12  # gas sigh
    return out


@sound("crown_cap_pop", 5, -3.5, doc="crown cap levered off: tink + psst")
def crown_pop(rng, i, n):
    dur = jit(rng, 0.55, 0.75)
    out = zeros(dur)
    f = jit(rng, 2800, 4200)
    out += 0.7 * modal(f * METAL_RATIOS[:4], METAL_AMPS[:4], [0.08, 0.05, 0.03, 0.02], dur, rng)
    add_at(out, click(rng, 0.001, (4000, 12000)), 0)
    fp = jit(rng, 350, 520)
    out += 0.9 * pitch_drop_sine(fp * 1.4, fp, 0.01, 0.03, dur)
    t = t_axis(dur)
    out += bandpass(white(rng, dur), 3000, 10000) * np.exp(-t / jit(rng, 0.12, 0.2)) * np.minimum(1, t / 0.01) * 0.35
    return out


@sound("screw_cap_twist", 4, -6.0, doc="screw cap ratcheting open")
def screw_cap(rng, i, n):
    dur = jit(rng, 0.7, 0.95)
    out = zeros(dur)
    t = 0.0
    rate = jit(rng, 25, 40)
    f0 = jit(rng, 1500, 2600)
    while t < dur - 0.12:
        c = modal([f0 * jit(rng, 0.9, 1.1), f0 * 2.3], [1, 0.4], [0.01, 0.006], 0.04, rng)
        add_at(out, c, t, gain=jit(rng, 0.3, 0.8))
        t += 1.0 / rate * jit(rng, 0.7, 1.3)
        rate *= 1.03  # accelerating as the thread lets go
    scrape = bandpass(white(rng, dur), 1800, 6000) * smooth_noise_env(rng, len(out), 60, 0.8) * 0.15
    out += scrape * np.minimum(1, t_axis(dur) / 0.05)
    # final seal-break pop
    add_at(out, pitch_drop_sine(500, 330, 0.01, 0.03, 0.15, 0.9), dur - 0.14)
    return out


@sound("cap_clink", 5, -7.0, doc="metal cap dropped and rattles on a surface")
def cap_clink(rng, i, n):
    dur = jit(rng, 0.45, 0.65)
    out = zeros(dur)
    f = jit(rng, 2600, 4400)
    t = 0.0
    a = 1.0
    gap = jit(rng, 0.07, 0.11)
    for k in range(rng.integers(2, 5)):
        h = modal(f * METAL_RATIOS[:4] * jit(rng, 0.99, 1.01), METAL_AMPS[:4], [0.16, 0.1, 0.06, 0.04], 0.25, rng)
        add_at(out, h, t, gain=a)
        t += gap
        gap *= 0.6
        a *= 0.55
    return out


# ---------------------------------------------------------------- 6. bullets
@sound("bullet_hit_glass", 5, -1.5, doc="crack + start of shatter")
def bullet_glass(rng, i, n):
    dur = jit(rng, 1.0, 1.3)
    out = shatter(rng, dur, False, scale=0.8)
    t = t_axis(dur)
    crack = highpass(white(rng, dur), 2500) * np.exp(-t / 0.006) * 3.0
    out += crack
    out += pitch_drop_sine(220, 140, 0.01, 0.025, dur, 1.2)
    out += 0.7 * modal([jit(rng, 2200, 3400) * r for r in GLASS_RATIOS[:3]], [1, .6, .4], [0.12, 0.08, 0.05], dur, rng)
    return out


@sound("bullet_hit_plastic", 5, -3.0, doc="thud + air hiss through plastic")
def bullet_plastic(rng, i, n):
    dur = jit(rng, 0.45, 0.65)
    t = t_axis(dur)
    out = pitch_drop_sine(jit(rng, 190, 260), 120, 0.015, 0.045, dur, 1.0)
    out += lowpass(white(rng, dur), 3500) * np.exp(-t / 0.012) * 1.6
    out += modal([jit(rng, 600, 900), jit(rng, 1300, 1900)], [0.5, 0.3], [0.05, 0.03], dur, rng)
    out += bandpass(white(rng, dur), 2500, 8000) * np.exp(-t / jit(rng, 0.15, 0.25)) * np.minimum(1, t / 0.01) * 0.3
    return out
