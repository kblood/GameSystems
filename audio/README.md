# Bottle sound set (procedural, original, MIT/CC0)

Everything is synthesised from maths (numpy/scipy); no samples, no third-party material.
44.1 kHz, mono, 16-bit WAV (+ Ogg Vorbis copies in `ogg/`), peak-normalised per sound (see table), 2 ms fade-in / 20 ms fade-out on one-shots.

## Regenerate
```
audio\.venv\Scripts\python audio\synth_all.py            # all sounds + metrics + previews
audio\.venv\Scripts\python audio\synth_all.py glass_shatter_small   # one sound (no catalog rewrite)
powershell -NoProfile -ExecutionPolicy Bypass -File audio\sync_godot_audio.ps1 [projectDir]
```
venv: `python -m venv audio\.venv; audio\.venv\Scripts\pip install numpy scipy matplotlib soundfile`.
Deterministic: seed = (20261004, crc32(name), variant index); re-running yields byte-identical WAVs.
Files: `synth_lib.py` (DSP blocks), `synth_sounds.py` (recipes; edit parameters here), `synth_all.py` (driver/metrics/previews),
`catalog.json` (variants, durations, loop flags), `metrics.json` (per-file peak/RMS/centroid/loop seam), `preview/sheet_*.png`.

## Building blocks
- `modal()`: sum of exponentially decaying sines (per-mode T60, +-1.2% random detune, random phase). Modes above 18.5 kHz are skipped (no aliasing).
- Glass ratios 1 : 2.32 : 4.25 : 6.63 : 9.38 : 12.5 (amps 1, .75, .5, .33, .2, .12, higher modes decay faster); metal-cap ratios 1 : 2.76 : 5.40 : 8.93 : 13.3.
- `bubble(f0)`: Minnaert bubble, damped sine, f rises ~rise*(1-exp(-t/tau)), tau = 10/f0 + 2 ms (f0 = 3260/r_mm).
- `periodic_noise()`: noise shaped in the FFT domain over exactly N samples, hence perfectly periodic (loops). Events for loops are added circularly (tails wrap).

## Recipes (variants; per-variant random values in ranges)
| sound | n | recipe |
|---|---|---|
| glass_clink_soft | 6 | glass modes base 1.5-2.3 kHz, T60 0.25-0.4 s, 5 modes with falling brightness, +0.3% twin-mode beating, 2 ms 3-8 kHz click at 0.5, dull body mode at 0.45*base. 0.45-0.65 s |
| glass_clink_hard | 6 | base 1.8-2.9 kHz, T60 0.5-0.9 s, 6 modes, beat 0.2-0.6%, 3 ms 2.5-12 kHz click, body mode 0.4*base. 0.8-1.1 s |
| glass_impact_thud | 6 | pitch-dropping sine 1.5f->f (f 120-210 Hz, 15 ms glide, 50-80 ms decay) + 2.6f partial, LP noise thump (500-900 Hz, tau 20 ms), muted high glass ring 800-1300 Hz at 0.35. ~0.5 s |
| plastic_bottle_bounce | 6 | 2-4 hollow hits (modes f, 2.07f, 3.4f; f 220-340 Hz; T60 70/50/30 ms) + LP 2.5 kHz noise tick; gap 130-190 ms shrinking x0.62, amp x0.55 per bounce. 0.7-0.95 s |
| plastic_bottle_dent | 4 | pitch-dropped 300-480 Hz body thump + 10-22 random crackle micro-modes (1.2-3.2 kHz, T60 4-12 ms), exponentially distributed over ~70 ms. ~0.3 s |
| glass_shatter_small | 6 | LF pop (110-170 Hz, 2x->1x drop) + 1.2-9 kHz noise burst (tau 50-90 ms) + 400-3k mid body + 70-110 grains (2 modes each, 2.2-8 kHz, T60 20-200 ms, onset exponential, scale 120 ms, <=600 ms) + sparse long tail of single shards + 0.3*first-difference HF emphasis. 1.4-1.6 s |
| glass_shatter_large | 6 | as small but pop 70-110 Hz, burst tau 90-140 ms, 5-9 big chunk resonances (700-2200 Hz), 150-230 grains 1.5-6.5 kHz scale 180 ms. 2.4-2.6 s |
| shard_settle | 8 | 1-3 ticks of 2-mode micro-resonators (3-7.5 kHz, T60 30-100 ms), gaps 20-70 ms, -50%/hit. 0.3 s |
| liquid_splash_small | 5 | BP 250-5500 Hz noise tau 80-140 ms + 14-26 Minnaert bubbles (500-3200 Hz, rising chirp, over 0-400 ms) + droplet patter. 0.6-0.8 s |
| liquid_splash_large | 5 | BP 250-3500 noise tau 200-300 ms + 70-200 Hz "whoomp" + 45-70 bubbles (150-1500 Hz, 0-900 ms) + patter. 1.4-1.7 s |
| liquid_glug | 6 (loop) | variant i = fill [.95 .8 .65 .5 .35 .2]. Pulse period 0.11+0.21*fill s (fuller = slower), k pulses fill exactly 2.2 s; each pulse = chirping sine (230+330*(1-fill) Hz, +60% rise) + 2.1x partial + LP noise under a sin^1.5 envelope; periodic body noise 300-2.5 kHz; small bubbles. Loops seamlessly |
| liquid_stream_loop | 3 (loop) | 4 s periodic noise 400-5000 Hz (-2 dB/oct), integer-cycle amplitude waviness, 50-90 circular bubbles 500-3500 Hz, 80-400 Hz body |
| liquid_slosh | 5 | LP noise blended between 600/2200 Hz cutoffs by a slow sine, swell envelope, 3-8 low bubbles. 0.7-1.0 s |
| fizz_loop | 2 (loop) | 3 s periodic hiss 3.5-14 kHz with slow modulation + ~330-450/s tiny bubble pops (2.5-9 kHz, tau 0.8-2.5 ms) |
| bubble_pop | 8 | one Minnaert bubble 600-3000 Hz + 1.2 ms click. 0.18 s |
| cork_pop | 5 | neck resonance 260-420 Hz dropping from 1.5x in 10 ms (tau 45 ms) + 2.9x partial + LP noise burst + click + faint HF gas sigh. 0.5-0.6 s |
| crown_cap_pop | 5 | metal modes (2.8-4.2 kHz bell ratios), click, 350-520 Hz pop, 3-10 kHz hiss tau 120-200 ms. 0.6-0.7 s |
| screw_cap_twist | 4 | accelerating stick-slip clicks (25-40/s, x1.03 per click, 1.5-2.6 kHz micro-modes) + scrape noise + final seal pop 500->330 Hz. 0.8-0.95 s |
| cap_clink | 5 | 2-4 metal-ratio bounces (2.6-4.4 kHz, T60 160/100/60/40 ms), gap x0.6, amp x0.55. 0.5-0.65 s |
| bullet_hit_glass | 5 | shatter(small, 0.8 scale) + 2.5 kHz-HP crack (tau 6 ms) + 220->140 Hz thump + ringing glass modes. 1.0-1.3 s |
| bullet_hit_plastic | 5 | 190-260->120 Hz thud + LP 3.5k noise crack + 2 resonances + 2.5-8 kHz air hiss tau 150-250 ms. 0.55-0.65 s |

Peak targets (dBFS): clink soft -9, hard -4, thud -3, shatter -2/-1.5, shard -8, splash -4/-3, glug -5, stream -8, fizz -9, pops -3.. -3.5, caps -6/-7, bullets -1.5/-3. Per-kind gain is trimmed again in `bottle_audio.gd` (`KIND_DB`).

## Godot usage
1. Copy `audio/wav/*.wav`, `audio/catalog.json` and `audio/godot/bottle_audio.gd` to `res://audio/...` of your project (`sync_godot_audio.ps1` does it), then run `godot --headless --path . --import` once.
2. Add a `BottleAudio` node (class_name) anywhere, e.g. as autoload `Sfx`. Properties: `bus` (default `SFX`, falls back to Master), `max_voices` (16), `max_loops` (6), `audio_root`, `unit_size` 1.5, `max_distance` 30, `max_db` 3, inverse-square attenuation, `auto_shard_settle`.
3. API:
```gdscript
play_event(kind, position, energy := 1.0, params := {}) -> AudioStreamPlayer3D
# kinds: clink thud dent shatter splash slosh cap_pop bullet_glass bullet_plastic shard_settle bubble_pop
#        pour_start pour_stop fizz_start fizz_stop (fizz_loop: energy>0 on / 0 off)
# params: material "glass"|"plastic" (clink/thud), size 0..1 (shatter/splash small<->large),
#         cap "cork"|"crown"|"screw"|"clink", source <any id for loops>, fill 0..1 (pour)
update_loop("pour"|"fizz", source, position, level)   # follow bottle + flow/carbonation
is_loop_active(loop, source); stop_all(); preload_all(); get_variants(name)
```
Features: random variant without immediate repeat; energy -> volume (0.8*20log10 e) and slight pitch; pooled players, quietest/oldest stolen, a much quieter new sound is dropped when pool is full of loud ones; loops get `loop_mode = FORWARD` set at runtime (`AudioStreamWAV`, `meta loop=true`), random start phase, volume slewed at 24 dB/s, freed after fade-out; shatter auto-schedules 3-12 `shard_settle` ticks (0.25-1.4 s) around the impact.

### Adapter to the breakage system and BottleLiquid (no hard dependency)
```gdscript
# somewhere in the level script / autoload; `breaker` is whatever node emits broke(position, energy, kind)
@onready var sfx: BottleAudio = $BottleAudio
func _ready():
    breaker.broke.connect(_on_broke)
func _on_broke(position: Vector3, energy: float, kind: String):
    match kind:                       # map the breakage kinds you emit onto audio kinds
        "shatter", "glass":  sfx.play_event("shatter", position, energy)
        "bullet":            sfx.play_event("bullet_glass", position, energy)
        "plastic":           sfx.play_event("thud", position, energy, {"material": "plastic"})
        "impact", "thud":    sfx.play_event("thud", position, energy)
        "clink":             sfx.play_event("clink", position, energy)
        _:                   sfx.play_event("shatter", position, energy)
    # liquid spilled? also: sfx.play_event("splash", position, energy)

# BottleLiquid: fill (0..1) and carbonation (0..1) exposed on the node
func _process(_dt):
    var p := bottle.global_position
    var flow := bottle_liquid.get("flow") if "flow" in bottle_liquid else 0.0   # or your own tilt-based flow
    if flow > 0.02:
        if not sfx.is_loop_active("pour", bottle):
            sfx.play_event("pour_start", p, flow, {"source": bottle, "fill": bottle_liquid.fill})
        sfx.update_loop("pour", bottle, p, flow)
    elif sfx.is_loop_active("pour", bottle):
        sfx.play_event("pour_stop", p, 0.0, {"source": bottle})
    var c: float = bottle_liquid.carbonation
    if c > 0.0 and not sfx.is_loop_active("fizz", bottle): sfx.play_event("fizz_start", p, c, {"source": bottle})
    if c > 0.0: sfx.update_loop("fizz", bottle, p, c)
```
Adjust the kind strings to what the breakage module actually emits (not verified against its code).

## Verification (see `metrics.json`, `preview/sheet_*.png`)
- All 111 files: no NaN, no clipping, peaks as targeted. Loop seams (|x[end]->x[0]| / p99 normal step): glug 0.14, stream 0.23, fizz 0.97 (<=1 = no larger than an ordinary step).
- Spectral centroid sanity: thud 176 Hz, plastic bounce ~570 Hz, slosh ~940 Hz, clinks 2.1-2.9 kHz, shatter 3.8-4.8 kHz, crown cap/bullet-glass ~5 kHz (bright, as intended).
- Godot headless test: `cd tests\godot_audio; godot --headless --path . --script res://test_audio.gd` prints `TEST_RESULT PASS`.
- Audition scene: run `tests\godot_audio` without `--headless` (buttons for every kind/energy, raw sounds, loops).

## Listening checklist (nobody has listened to these yet, tune by ear)
1. glass_shatter_small/large: too noisy-continuous vs. tinkly? `shatter()`: grain count, `scale` of `shard_grains` (0.12/0.18), burst `nd`, `0.3*d` HF emphasis, grain freq `fr`.
2. glass_impact_thud: body f (120-210), `thump` LP cutoff, ring gain 0.35 (too "glassy" or too dead).
3. glass_clink_soft/hard: base 1.5-2.9 kHz (pitch of bottle), `t60_base`, `beat`, `bright`; a real bottle may want a lower base (~1 kHz) plus the body mode.
4. liquid_glug: period 0.11+0.21*fill, `fbase` (230+330*(1-fill)), chirp rise 0.6, noise 0.4 gain - check it reads as "glug" not "pulsing noise".
5. liquid_splash_large: whoomp 70-200 Hz level (1.0), bubble count 45-70, noise tau 0.2-0.3.
6. fizz_loop: hiss band 3.5-14 kHz and pop density `330+120*i` per s (code: `fizz_loop`) (could be harsh in VR; lower `LOOP_DB.fizz`).
7. cork_pop/crown_cap_pop: neck frequency 260-420 Hz, gas hiss gain, crown metal ratios (cap may sound "bell"-like).
8. bullet_hit_glass/plastic: crack gain 3.0, `scale` 0.8, plastic hiss 0.3 and thud pitch; plastic_bottle_bounce hollow-ness (f 220-340 Hz).

## Limitations
No listening was possible while writing this: levels and "realism" are judged only from numbers and spectrograms. Physical models are simplified (no radiation from real bottle geometry, no per-bottle tuning; a bottle-size -> pitch mapping is not implemented, use `pitch_scale` jitter or extra variants). Glug variants are bucketed by fill (6 steps) and chosen at `pour_start`.

## License
All generated assets and the code in this folder are original; released as MIT / CC0 (use freely, no attribution needed).
