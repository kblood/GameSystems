"""Procedural DSP building blocks for the bottle sound set (numpy/scipy only). MIT/CC0."""
import numpy as np
from scipy import signal

SR = 44100

# Glass-bottle-ish inharmonic mode ratios (ring modes of a thin shell, measured-like, not harmonic).
GLASS_RATIOS = np.array([1.0, 2.32, 4.25, 6.63, 9.38, 12.5])
GLASS_AMPS = np.array([1.0, 0.75, 0.5, 0.33, 0.2, 0.12])
# Bell/metal-cap ratios.
METAL_RATIOS = np.array([1.0, 2.76, 5.40, 8.93, 13.3])
METAL_AMPS = np.array([1.0, 0.7, 0.45, 0.3, 0.15])


def t_axis(dur):
    return np.arange(int(round(dur * SR))) / SR


def zeros(dur):
    return np.zeros(int(round(dur * SR)))


def add_at(buf, sig, start_s, circular=False, gain=1.0):
    """Mix sig into buf at start_s. If circular the tail wraps (seamless loops)."""
    i = int(round(start_s * SR))
    n = len(buf)
    if circular:
        i %= n
        m = len(sig)
        idx = (i + np.arange(m)) % n
        np.add.at(buf, idx, sig * gain)
        return
    if i >= n:
        return
    m = min(len(sig), n - i)
    buf[i:i + m] += sig[:m] * gain


def decay_env(dur, t60):
    """Exponential envelope reaching -60 dB at t60 seconds."""
    t = t_axis(dur)
    return np.exp(-6.9078 * t / t60)


def modal(freqs, amps, t60s, dur, rng, detune=0.012, phase_rand=True):
    """Sum of exponentially decaying sine modes. t60s: per-mode -60 dB time."""
    t = t_axis(dur)
    out = np.zeros_like(t)
    for f, a, d in zip(freqs, amps, t60s):
        f = f * (1 + rng.uniform(-detune, detune))
        if f > 0.42 * SR:  # keep modes below ~18.5 kHz (no aliasing)
            continue
        ph = rng.uniform(0, 2 * np.pi) if phase_rand else 0.0
        out += a * np.sin(2 * np.pi * f * t + ph) * np.exp(-6.9078 * t / d)
    return out


def white(rng, dur):
    return rng.standard_normal(int(round(dur * SR)))


def bandpass(x, lo, hi, order=2):
    hi = min(hi, SR / 2 * 0.98)
    sos = signal.butter(order, [lo, hi], btype="band", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def lowpass(x, fc, order=2):
    sos = signal.butter(order, min(fc, SR / 2 * 0.98), btype="low", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def highpass(x, fc, order=2):
    sos = signal.butter(order, fc, btype="high", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def periodic_noise(rng, n, lo, hi, tilt=0.0, edge=0.25):
    """Exactly periodic (loopable) band-limited noise via FFT shaping.
    lo/hi: band edges in Hz (soft log-edges); tilt: dB per octave above lo."""
    w = rng.standard_normal(n)
    F = np.fft.rfft(w)
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = 1e-3
    lf = np.log2(f)
    g = 1 / (1 + np.exp(-(lf - np.log2(lo)) / edge)) * 1 / (1 + np.exp((lf - np.log2(hi)) / edge))
    g = g * 10 ** (tilt * np.clip(lf - np.log2(lo), 0, None) / 20)
    F *= g
    F[0] = 0
    return np.fft.irfft(F, n)


def click(rng, dur=0.004, fc=(2000, 9000)):
    n = int(dur * SR)
    x = rng.standard_normal(n) * np.hanning(2 * n)[n:]
    return bandpass(np.concatenate([x, np.zeros(200)]), fc[0], fc[1])


def bubble(f0, rng=None, amp=1.0, tau=None, rise=0.25, attack=0.0008):
    """Minnaert bubble: damped sine at f0 whose frequency rises ~rise while decaying."""
    if tau is None:
        tau = 10.0 / f0 + 0.002
    dur = tau * 5.5
    t = t_axis(dur)
    f = f0 * (1 + rise * (1 - np.exp(-t / tau)))
    ph = 2 * np.pi * np.cumsum(f) / SR
    env = np.exp(-t / tau) * np.minimum(1.0, t / attack)
    return amp * np.sin(ph) * env


def minnaert_f(radius_mm):
    return 3260.0 / radius_mm


def pitch_drop_sine(f_start, f_end, tau_f, tau_a, dur, amp=1.0):
    t = t_axis(dur)
    f = f_end + (f_start - f_end) * np.exp(-t / tau_f)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return amp * np.sin(ph) * np.exp(-t / tau_a)


def smooth_noise_env(rng, n, rate_hz, depth=1.0):
    """Slow positive envelope (not periodic)."""
    k = max(2, int(SR / rate_hz))
    pts = rng.uniform(1 - depth, 1.0, n // k + 3)
    env = np.interp(np.arange(n), np.arange(len(pts)) * k, pts)
    return env


def finalize(x, peak_db=-3.0, fade_in=0.002, fade_out=0.02, loop=False):
    x = np.nan_to_num(np.asarray(x, dtype=np.float64))
    if loop:
        x = x - np.mean(x)  # DC removal keeps the loop periodic
    p = np.max(np.abs(x)) + 1e-12
    x = x / p * 10 ** (peak_db / 20)
    if not loop:
        fi = int(fade_in * SR)
        fo = int(fade_out * SR)
        if fi:
            x[:fi] *= np.linspace(0, 1, fi) ** 2
        if fo:
            x[-fo:] *= np.linspace(1, 0, fo) ** 2
        x = x / (np.max(np.abs(x)) + 1e-12) * 10 ** (peak_db / 20)  # re-normalise after fades
    return x


def to_int16(x):
    return np.clip(np.round(x * 32767), -32768, 32767).astype(np.int16)
