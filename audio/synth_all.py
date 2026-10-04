"""Generate the whole bottle sound set. Deterministic + idempotent.
Usage:  audio\\.venv\\Scripts\\python audio\\synth_all.py [--no-ogg] [--no-preview] [name ...]
Outputs: audio/wav/<name>_NN.wav (44.1k mono 16-bit), audio/ogg/*.ogg, audio/catalog.json,
         audio/metrics.json, audio/preview/*.png. MIT/CC0 -- all sounds are generated from maths only."""
import sys, os, json, zlib
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import soundfile as sf
from synth_lib import SR, finalize, to_int16
from synth_sounds import SOUNDS

SEED = 20261004


def centroid(x):
    sp = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return float((sp * f).sum() / (sp.sum() + 1e-20))


def loop_disc(x):
    """|x[-1]->x[0] wrap step| relative to the 99th percentile of ordinary sample-to-sample steps.
    <= 1 means the loop seam is no bigger than a normal step inside the file (inaudible)."""
    step = np.percentile(np.abs(np.diff(x)), 99) + 1e-12
    return float(abs(x[0] - x[-1]) / step)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    do_ogg = "--no-ogg" not in sys.argv
    do_prev = "--no-preview" not in sys.argv
    wav_dir, ogg_dir = os.path.join(HERE, "wav"), os.path.join(HERE, "ogg")
    os.makedirs(wav_dir, exist_ok=True)
    os.makedirs(ogg_dir, exist_ok=True)
    catalog, metrics, first = {}, {}, {}
    for name, d in SOUNDS.items():
        if args and name not in args:
            continue
        files = []
        for i in range(d["count"]):
            rng = np.random.default_rng([SEED, zlib.crc32(name.encode()), i])
            x = d["fn"](rng, i, d["count"])
            x = finalize(x, d["peak_db"], loop=d["loop"])
            pcm = to_int16(x)
            fn = f"{name}_{i + 1:02d}"
            sf.write(os.path.join(wav_dir, fn + ".wav"), pcm, SR, subtype="PCM_16")
            if do_ogg:
                sf.write(os.path.join(ogg_dir, fn + ".ogg"), x * 0.999, SR, format="OGG", subtype="VORBIS")
            xf = pcm / 32768.0
            m = dict(dur=round(len(xf) / SR, 3), peak_db=round(20 * np.log10(np.abs(xf).max() + 1e-12), 2),
                     rms_db=round(20 * np.log10(np.sqrt(np.mean(xf ** 2)) + 1e-12), 2),
                     centroid_hz=round(centroid(xf)), nan=bool(np.isnan(x).any()),
                     clipped=bool(np.abs(pcm).max() >= 32767))
            if d["loop"]:
                m["loop_disc"] = round(loop_disc(xf), 2)
            metrics[fn] = m
            files.append(fn)
            if i == 0:
                first[name] = xf
        catalog[name] = dict(variants=d["count"], loop=d["loop"], doc=d["doc"],
                             duration_s=[metrics[f]["dur"] for f in files])
    if not args:
        json.dump(catalog, open(os.path.join(HERE, "catalog.json"), "w"), indent=1)
        json.dump(metrics, open(os.path.join(HERE, "metrics.json"), "w"), indent=1)
    # summary table
    print(f"{'sound':26}{'n':>3}{'dur(s)':>12}{'peak':>7}{'rms':>7}{'centroid':>9}{'loopdisc':>9}")
    for name in catalog:
        ms = [metrics[f"{name}_{i + 1:02d}"] for i in range(catalog[name]["variants"])]
        dur = f"{min(m['dur'] for m in ms):.2f}-{max(m['dur'] for m in ms):.2f}"
        ld = max((m.get("loop_disc", 0) for m in ms), default=0)
        print(f"{name:26}{len(ms):>3}{dur:>12}{max(m['peak_db'] for m in ms):7.1f}"
              f"{np.mean([m['rms_db'] for m in ms]):7.1f}{int(np.mean([m['centroid_hz'] for m in ms])):>9}"
              f"{(ld if catalog[name]['loop'] else float('nan')):9.2f}")
    bad = [k for k, m in metrics.items() if m["nan"] or m["clipped"]]
    print("NaN/clipped:", bad or "none")
    if do_prev:
        make_previews(first)


def make_previews(first):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib missing; skipping previews")
        return
    pdir = os.path.join(HERE, "preview")
    os.makedirs(pdir, exist_ok=True)
    names = list(first)

    def sheet(sel, fname):
        fig, ax = plt.subplots(len(sel), 2, figsize=(11, 2.1 * len(sel)), gridspec_kw={"width_ratios": [1, 2]})
        for r, nme in enumerate(sel):
            x = first[nme] + 1e-6 * np.random.default_rng(0).standard_normal(len(first[nme]))
            t = np.arange(len(x)) / SR
            ax[r, 0].plot(t, first[nme], lw=0.4)
            ax[r, 0].set_title(nme, fontsize=8)
            ax[r, 0].set_ylim(-1, 1)
            ax[r, 1].specgram(x, NFFT=1024, Fs=SR, noverlap=768, cmap="magma", vmin=-130, vmax=-30)
            ax[r, 1].set_ylim(0, 16000)
            ax[r, 1].set_ylabel("Hz", fontsize=7)
        fig.tight_layout()
        fig.savefig(os.path.join(pdir, fname), dpi=80)
        plt.close(fig)

    for k in range(0, len(names), 6):
        sheet(names[k:k + 6], f"sheet_{k // 6 + 1}.png")
    print("previews written to", pdir)


if __name__ == "__main__":
    main()
