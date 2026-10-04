# Liquid system brainstorm and feasibility study (bottles and containers, VR)

Status: brainstorm only, written 2026-10-04. Nothing in this document is production code. The numeric experiments are in
`tests/liquid_proto/` (run them with `audio\.venv\Scripts\python tests\liquid_proto\<script>.py`; the plots are in `tests/liquid_proto/out/`).
Targets: Godot 4.6+/OpenXR Mobile renderer (Quest 3 / Steam Frame class) and three.js WebXR.
"GUESS" marks numbers that come from my estimates rather than from measurement or the literature.

## 0. TL;DR

- The existing **world plane + volume LUT** works as a liquid simulator if we add three cheap pieces: a **volume ledger**
  (an exact count of how much liquid each container holds), **openings** (disc + axis + radius + cap state) and a **flow law**.
  The flow law is weir/Torricelli flow over the submerged part of the opening, capped by a **glug (air counter-flow) limit**
  whenever the liquid plugs the neck. It needs only forward LUT lookups (no inversion) and about 3 kflop per pouring container per tick.
- Pour calibration (experiment a): a 750 ml wine bottle turned upside down empties 95 % in **17.5 s** with the Wallis-type
  flooding constant k_g = 0.37 (12.9 s at 0.5, 25.8 s at 0.25), so it lands inside the 10-20 s target without tuning. Narrow necks
  pour at a nearly constant rate (wine 41 ml/s, beer 41, soda 88, flask 92 ml/s). The wide-mouth jar empties in 1.4 s.
- Streams are stored as **parcels**: each physics tick emits one parcel carrying its exact volume. The parcel flies on a parabola and is
  deposited exactly once (receiver, rim split, overflow or floor). Experiment c: the ledger error is 0 with an integer µL ledger,
  2.4e-3 ml with float32 and 7.7e-12 ml with float64. At most 31 parcels were alive at once, and up to about 18 ml was in flight.
- **Layers come for free from the LUT**: interface k sits at `d_k = LUT(up, F_k)`, where F_k is the cumulative fill in density order.
  With the v2 LUT the worst layer error is 2.2 ml (1 % of the layer) on the wine bottle, and 0.65 % of capacity on the non-symmetric jerrycan.
  **All interfaces must share the slosh normal.** Letting the interfaces lean on their own, even 5°, already costs 19 % of a thin
  layer's volume (experiment b). Interface waves should therefore be visual only.
- Finding: the **v1 axis LUT is biased about 1.7 % of capacity** against the real GLB mesh (up to 16.7 ml on the wine bottle; v1 says 868 ml and the
  mesh holds 886 ml). Use v2 (or v1 upgraded to v2 and re-baked from the mesh) for any gameplay volume accounting.
- Colour mixing: mix **log-absorbance by volume fraction** (Beer-Lambert). The shader already works in `log(liquid_color)` / `ref_path`,
  so mixing costs one CPU line and no shader change.
- Cost is dominated by **pixels, not physics**. A bottle held at 35 cm covers about 6.7 % of both eye buffers (about 0.6 M liquid fragments). The full
  bubble/foam shader is about 10 times the cost of a plain plane + absorption shader, and 3 layers add only about 15 % on top of the full shader. Realism tiers per container
  (HIGH/MEDIUM/LOW/MINIMAL) switch at runtime because volume state never depends on the tier. Idle containers sleep (0 CPU).
- Recommended order: phase 0 pour-out + caps + spill (LOW/MEDIUM tiers), phase 1 container-to-container transfer, phase 2 layers/mixing,
  phase 3 wetness/interactions.

## 1. Framing: the design space

Existing system: `Liquid` is a closed interior mesh, and the shader discards everything above a world-space plane `dot(p_obj, up_obj) = d`.
`d = LUT(up_obj, fill)` keeps the volume constant at any tilt (v1 = `lut[cos_tilt][fill]` for lathe bottles, v2 = octahedral sphere map for
any shape: `LiquidLutV2.offset/fill_at/spill`). Slosh is a spring on the effective up vector. Bubbles and foam are procedural. `fill` is set by
script. The breakage module already has a rudimentary Torricelli leak, a rim-clamped neck spill (rate limited to 320 ml/s) and droplet/puddle pools.

Axes of the design space:

| Axis | Cheap end | Rich end |
|---|---|---|
| Volume truth | scripted `fill` | conserved ledger (integer µL), flow law, transfer |
| Flow law | instant spill above rim | weir + Torricelli + glug + viscosity + vent logic |
| Stream | none (sound only) | parcel-driven tube mesh, breakup, splash |
| Contents | one colour | N immiscible layers, miscible mixes, diffusion, reactions |
| World effects | none | puddles, decals, wet materials, gameplay hooks |
| Cost | per-container sleep, LOW shader | full bubbles, HIGH tier near the hands only |

Guiding principles:
1. **State is separate from representation.** The ledger (mix + volumes + cap state) is the single truth. Every visual and
   every tier reads from it, so tiers switch freely.
2. **Never derive volume from a LUT round trip.** The LUT maps state to geometry (rendering, heads, rims), never back into the ledger.
3. **Event-driven where possible:** nothing runs per frame for a sealed, resting container.

## 2. Realism tiers (cost is first-class)

Each container holds one `tier` that can change at runtime. Subsystems read it. Volumes and mixes are identical at every tier.

| Subsystem | HIGH | MEDIUM | LOW | MINIMAL |
|---|---|---|---|---|
| Pour / flow | flow law at physics rate (72-90 Hz), parcels, tube stream deformed in the vertex shader, splash particles, transfer | flow law at 30 Hz, parcels, single capsule/ribbon stream, puddle on landing | flow law at 10 Hz, no visible stream: fill drops plus `pour` sound; landing point found by one raycast and volume deposited after the flight time | scripted/instant `transfer(a, b, ml)` or `fill` set by game |
| Surface | slosh spring + ripple + meniscus | slosh spring | static plane (no spring) | static plane, updated only on change |
| Bubbles / foam | 4 bubble layers + foam (current shader) | 1 bubble layer + foam band | colour band only | none |
| Layers / mix | N≤4 planes, per-layer Beer-Lambert path, interface band, visual interface waves, diffusion | N planes, flat per-layer colour, no waves | 1 plane, mixed absorption colour (CPU) | 1 fixed colour |
| Wetness / puddles | puddle meshes + decals + wet-material spheres + neck drips + droplets on glass | puddle quads (existing) + per-object wet flag | puddle quad only | none (event/sound only) |
| Carbonation | pressure + gush + fizz loss + bubbles | pressure + gush (no bubbles) | gush as event + sound | none |

Cost and loss per tier (one container; CPU numbers are op-count estimates, GPU numbers come from the ALU model in `d_costs.py`, GUESS):

| Tier | CPU / tick (C++ / GDScript) | GPU per bottle at 0.35 m / 1 m | Memory per instance | What is lost |
|---|---|---|---|---|
| HIGH | ~3 kflop: ~3 µs / ~0.2 ms | ~0.20 ms / 0.026 ms (full + 3 layers) | ~5 KB (parcel ring) | nothing |
| MEDIUM | ~1.5 kflop at 30 Hz: <1 µs / ~0.05 ms averaged | ~0.05 ms / 0.006 ms | ~5 KB | bubble detail, interface waves, stream shape detail, drips |
| LOW | ~0.3 kflop at 10 Hz | ~0.018 ms / 0.002 ms | ~0.3 KB | visible stream, splashes, slosh, layers (become one blended colour) |
| MINIMAL | 0 per frame (event) | same as LOW or a static material | ~0.1 KB | the physics of flow: transfers are scripted |
| Idle (any tier) | **0**: the node is not processing | the shader cost of the chosen tier (pixels only) | state only | n/a |

Shared per container TYPE: LUT v2 78 KB as u16 (156 KB as float32) plus an optional inverse cache of 16 KB.
GPU numbers only count ALU. On tiled mobile GPUs, `discard` also defeats early-Z/LRZ and the liquid is drawn with cull disabled,
so treat these numbers as lower bounds and profile on device.

**Automatic tier selection** (one `LiquidWorld` manager, re-evaluated at 4 Hz with hysteresis):
```
priority(c) = (held or pouring or receiving ? 1000 : 0) + 100 * agitation
            + pixel_radius(c)            # bounding radius / distance * focal_px, 0 if outside the frustum
budget: max_high = 2, max_medium = 6 (start values), lowered by 1 when the GPU or CPU frame time exceeds the budget for 30 frames,
        raised again after 300 frames under 85 % of the budget
assign in priority order: HIGH while pixel_radius > 120 px and slots are free, MEDIUM while > 40 px, LOW while visible, else MINIMAL
hysteresis: a tier changes only if the threshold is crossed by 20 % and the current tier has been held for 0.5 s or longer
```
Held and pouring containers are always at least MEDIUM, so the player's own bottle never shows a missing stream.
Switching material variants must not cause shader-compile hitches. Pre-create every variant at level load: in Godot, separate `Shader`
resources compiled during a warm-up frame; in three.js, `renderer.compile` for each variant.

**Idle at about 0 cost:** a `LiquidContainer` calls `set_process(false)` and `set_physics_process(false)` when all of these hold:
sealed or no flow, the body is sleeping (or its linear and angular speed has been below 0.05 for 0.5 s), agitation < 0.02, foam < 0.01, no parcels in flight.
It wakes on `body.sleeping_state_changed`, grab or release, an impact, a cap change or an external deposit. While asleep, its shader uniforms stay as they
were (plane and colour), so it costs only pixels. Today `BottleLiquid._process` runs every frame for every bottle; that is an integration change (see section 10).

## 3. Topic 1: emptying (pour-out, leaks, drinking, shaking)

| Option | Effort | Cost/tick | Fidelity | Robustness | Plugs into plane+LUT | Data changes |
|---|---|---|---|---|---|---|
| A. Instant clamp: excess above the lowest rim point leaves at a capped rate (the current `_process_spill`) | S | 1 inverse lookup (bisection: 14 forward lookups) | low: no glug, no head dependence | good; needs the rim | `spill()` / `max_fill_below_rim` | rim points (v2 has them) |
| B. **Weir/Torricelli over the submerged part of the opening, plus glug cap and vent check** (recommended) | M | ~350 flop (1 forward LUT + 16 strips + 16 spine samples) | good (experiment a) | handles upside down, tiny holes (capillary cutoff), multiple openings | forward LUT only: head = d - s(x) | `openings[]` with centre, axis, radius, spine |
| C. B plus viscosity (Poiseuille/film flow) and residual coating | M | +20 flop | honey, oil, syrup | needs per-substance viscosity | same | substance `viscosity`, `coating_ml_per_m2` |
| D. Grid/SPH fluid | L | ms | high | fragile, VR-unsafe | none | none |

Recommendation: B (phase 0), C as a per-substance option (phase 2). Never D.

Emptying sources, all handled as **openings** of the same container:
- **Neck/mouth:** opening at the lip, with the cap state setting the area fraction α.
- **Leaks (bullet holes):** openings created at runtime: centre = hole, axis = outward wall normal, r = caliber × 0.55 (as today).
  Vent rule (new, cheap, realistic): a sealed bottle with a single small hole should barely drain. Flow is free only if
  **another opening's high point is above the plane** (that opening vents air). Otherwise flow is glug-limited, and it is zero when
  D_hole < ~5 mm (capillary length of water ≈ 2.7 mm; the 5 mm threshold is a GUESS).
  Entry plus exit holes: the higher hole vents and the lower one jets (Torricelli), which looks and feels right.
- **Drinking:** the mouth is a receiver (section 5.6) that consumes volume. It uses the same flow law and needs no special code.
- **Shaking an open container:** (1) slosh tilts `u_eff`, and using `u_eff` in the flow law makes liquid splash out of open cups naturally.
  (2) Flick ejection for open narrow necks: if the axial acceleration exceeds 1.5 g (pointing out of the neck), eject
  `min(V, k * |a_axial| * A_neck * dt * 0.05 m)` as a burst parcel (GUESS). It is cheap and readable. Do not do it when sealed.

Edge cases found or handled:
- At fill → 0 the LUT offset is still slightly above the lip, so the formula reports about 27 ml/s of phantom flow at an empty bottle (experiment a plot).
  Clamp every outflow by the remaining ledger volume and require a minimum head of 1-2 mm. `breakable_bottle.gd` already uses 2 mm.
- Very low fill plus wide opening: the weir integral is fine. Tiny openings: the glug/capillary rule. Upside down: the plug test says "lip submerged", so glug applies.
- High viscosity: option C. Many bottles: cost is linear in **pouring** containers only; idle ones sleep.

## 4. Topic 2: caps, opening and closing

### 4.1 State machine (one per cap; drives the opening's area fraction α and the seal)

```
                 +-------------- reclose (screw/swing/stopper/cork-reinsert) ---------------+
                 v                                                                            |
 SEALED --(break seal: twist>30deg | lever torque | foil torn | corkscrew pull)--> CRACKED --> LOOSE(0<alpha<1) --> OPEN(alpha=1) --> REMOVED
   |  (alpha=0, P held)                                       (P vents)           (leaks, dribble)               (cap is a prop)
   +--(neck snap / shatter)--> BROKEN (opening = jagged rim at open_z, alpha=1, cap gone with neck)
```

| Cap type | Open interaction (VR) | States used | Reclose | α while partial | Pop / pressure |
|---|---|---|---|---|---|
| cork (wine) | corkscrew tool: insert (twist count), then pull with force > 80-120 N (GUESS, scale for VR) | SEALED, PULLING (progress 0..1), OPEN, REMOVED | push back in, seals 90 % (α_leak 0.01 inverted) | 0 until the last 3 mm, then a jump | wine: small "thup"; champagne cork = projectile |
| crown (beer) | opener tool lever: torque threshold, or edge-of-table hit | SEALED, OPEN, REMOVED | no | n/a | hiss + pop, gush if agitated |
| screw (soda, jar) | twist gesture: 0..1.5 turns; tamper ring breaks at 30° | SEALED, CRACKED (venting), LOOSE, OPEN, REMOVED | yes | α = clamp((turns - 0.25) / 1.0)^2 × 0.15 until removed | slow vent while CRACKED, so the gush shrinks |
| swing-top | lever flip | CLOSED, OPEN | yes, full seal | none | pop |
| foil | tear (pinch + pull) | SEALED → foil removed, then the cork underneath | no | n/a | none |
| stopper (flask, decanter) | lift | CLOSED, OPEN | yes, seal 95 % | small leak when inverted | none |

Exposed to physics: per opening `alpha` (0..1) and `sealed` (bool). Flow uses `A_eff = alpha * A`. Sealed means no flow, no stream, no fizz loss,
but slosh and bubbles still render. Cap events emit sound kinds that already exist (`cap_pop` with `cap: cork|crown|screw`, `clink` when the
removed cap lands).

### 4.2 Pressure and gushing (carbonated)

State per container: `co2` (volumes of CO2 dissolved: soda ~3.5-4, beer ~2.5, champagne ~5-6; literature-typical values),
headspace pressure `P` (gauge, bar), `agitation` (already computed in `BottleLiquid`: 0..1, decays at ~0.7/s).
- Sealed equilibrium (GUESS, gameplay fit): `P = co2 * 0.9 * (T / 293 K)` bar gauge, so soda is about 3.3 bar and champagne about 5 bar at 20 °C.
- Nucleation reserve: shaking builds `nuc += agitation * dt * 0.5`, which decays with τ = 60-120 s (shaken soda settles in a minute or two; GUESS).
- On a seal break with open area fraction α:
  - Vent: `dP/dt = -k_v * alpha * sqrt(P)`. A slow screw crack bleeds P over 1-3 s.
  - Gush volume (GUESS, tune by feel): `V_gush = V_liquid * min(0.35, 0.25 * nuc * co2/4 * (P/P_eq))`, released as foam parcels over 1-3 s through
    the opening at `v = 1.5..4 m/s * sqrt(P/P_eq)`. This is why cracking slowly beats ripping it open.
  - Foam visual: `foam` uniform → 1, `foam_height` grows. The foam parcels use the stream renderer with a white, high-scattering substance.
- Champagne/cork projectile: exit speed ~ `sqrt(2 * P * A_cork * L_neck / m_cork)` (for ~6 bar this gives ~12 m/s, matching the often quoted ~40 km/h).
  Spawn the cork as a RigidBody and emit `cap_pop` energy ∝ P.
- Fizz loss while open: `dco2/dt = -co2 / tau_open`. Real soda goes flat in hours (τ ~ 1-2 h, GUESS); for games use τ = 5-10 min, set per
  project. Pouring adds `-k_pour * Q * co2` (turbulence degasses), and foam on the receiving side scales with `co2 * flow_speed`.
- Carbonation drives the existing `carbonation` uniform: render `co2 / co2_max`.

## 5. Topics 3 and 4: pouring, streams and container-to-container transfer

### 5.1 Flow-rate math (derivation used in experiment a)

Inputs per container per tick: `u` = world up in object space (use the slosh-bent `u_eff` at HIGH/MEDIUM), ledger volume `V`,
capacity `C`, fill `f = V/C`, plane `d = LUT(u, f)` (one forward lookup).

Opening k: centre `c`, outward axis `a`, radius `r`, area fraction `α`, plus the narrowest section `r_min` on its spine.
1. Signed height of a point: `s(p) = p·u`. Liquid is where `s < d`.
2. Inside the opening disc, the steepest-descent direction is `e = -(u - (a·u) a)/σ` with `σ = sqrt(1-(a·u)^2)`.
   A point at offset x along e has `s(x) = c·u - x σ`, with x in [-r, r]. Low lip `s_lo = c·u - rσ`, high lip `s_hi = c·u + rσ`.
3. Local head `h(x) = max(0, d - s(x))`. Free outflow (orifice/weir over the submerged part of the disc):
   `Q_free = α Cd ∫ w(x) sqrt(2 g h(x)) dx`, with `w(x) = 2 sqrt(r^2-x^2)` and Cd ≈ 0.62, evaluated with 16 strips.
   Limits: facing straight down and fully submerged gives Torricelli `α Cd A sqrt(2 g (d - c·u))`. Partially submerged gives a weir.
4. **Plug test (air path):** along the opening's spine (the neck from lip to body, 16 samples `(c_i, r_i)` baked offline), the high
   generatrix height is `g_i = c_i·u + r_i σ_i`. Scanning from the lip inward: if the lip's `g_0 ≤ d` it is plugged. If a wet sample
   (`g_i ≤ d`) is followed by a dry one deeper in, air is trapped behind a liquid plug, so it is also plugged.
   If another opening's `s_hi > d` (a vent), it is not plugged.
5. **Glug cap (counter-current flooding, Wallis form):** `sqrt(j_l*) + sqrt(j_g*) = C`, with `j* = j sqrt(ρ/(g D Δρ))`. Equal volume
   exchange (`j_g = j_l`) and ρ_air/ρ_water = 0.0012 give `sqrt(j_l*) (1 + 0.186) = C`. With C = 0.725, `j_l* = 0.37`, so
   `Q_glug = k_g A_min sqrt(g D_min)` with `k_g ≈ 0.37`. If plugged, `Q = min(Q_free, Q_glug)`.
   (The Wallis correlation is standard for flooding in vertical tubes; applying it to bottle necks is my approximation, so treat k_g as the tuning knob.
   Swirling the bottle (vortex, an air core) roughly doubles or triples the rate in reality, so a "swirl" gesture can raise k_g.)
6. Viscous substances (option C): `Q = min(Q_inertial, Q_visc)`, with `Q_visc = π r_min^4 ρ g h_eff / (8 μ L_neck)` (Poiseuille) for a full neck,
   or the film flow `ρ g sinβ b δ^3 / (3 μ)` over a wide lip. Honey (μ ≈ 5-10 Pa·s) then pours in minutes, as it should.
7. Integrate: `dV = min(V, Q dt)` (and clamp to 0 when `h_max < 1-2 mm`). Write `dV` to the ledger, then `f = V/C`.
   For layered contents, see 7.4 (each strip draws from the layer it touches).

Experiment a results (production v1 LUT, profiles from `scripts/bottles.py`, dt = 1/72):

| Scenario | t_half (s) | t 95 % out (s) | Notes |
|---|---|---|---|
| wine 750 ml, tilt to 180 at 20 / 45 / 90 / 180 °/s / instant | 13.3 / 11.0 / 10.1 / 9.6 / 9.2 | 21.6 / 19.3 / 18.4 / 17.9 / 17.5 | plugged ~100 % of the time while flowing; linear volume vs time |
| wine instant, k_g = 0.25 / 0.37 / 0.5 | 13.6 / 9.2 / 6.8 | 25.8 / 17.5 / 12.9 | calibration range |
| wine 750 ml, hold 80° | no flow | no flow | lip above the level (correct: a near-full bottle 10° above horizontal does not pour) |
| wine 750 ml, hold 100° | 10.1 | 17.7 | free (unplugged) flow at the end; 2.4 ml stays behind the shoulder |
| beer / soda / whiskey / flask / jar (95 %, 90 °/s) | 6.6 / 4.4 / 6.3 / 6.5 / 1.0 | 11.8 / 7.7 / 11.2 / 11.6 / 1.4 | Q_glug: beer 41, soda 88, whiskey 47, flask 92, jar 1188 ml/s |

Plots: `out/a_pour_wine_rates.png` (volume and Q vs time: one short free spurt, then a flat glug plateau),
`out/a_pour_wine_hold.png`, `out/a_pour_shapes.png`. I looked at all three. Curves are linear while glugging. Real pours look like that,
but real glugging pulses at 3-8 Hz. Add the pulse to Q as a zero-mean modulation (visual and audio only), with the period from the audio
recipe `0.11 + 0.21*fill` s.
Honest caveats: the free-flow weir has not been validated against measurements. The glug constant is a correlation transplanted to bottles.
The plug test assumes a straight, axis-aligned neck spine.

### 5.2 Stream trajectory and landing

- Exit point: the low lip point `p0 = c + r e` (world). Exit velocity:
  `v0 = a_world * min(Q / A_jet, 3 m/s) + v_container(p0)`, where `v_container = v_cm + ω × (p0 - x_cm)` comes from the rigid body.
  `A_jet = Cd A_sub` (free flow) or `0.5 A_min` (glug: liquid shares the neck with air).
- Path: `p(t) = p0 + v0 t + ½ g t²`. Stream radius from continuity: `r(t) = sqrt(Q / (π |v(t)|))` (the stream thins as it falls).
  Breakup into droplets after ~`L_b ≈ 12 D0 * We^0.5`-ish (GUESS). Visually, fade the tube into droplet sprites after 15-30 cm for thin streams.
- Landing:
  1. Analytic test against every registered **receiver opening disc** (centre `c_r`, normal `n_r`, radius `r_r`): solve
     `½ (n_r·g) t² + (n_r·v0) t + n_r·(p0-c_r) = 0`, take the smallest positive root, check `|p(t*) - c_r| < r_r`. That is about 30 flops per receiver.
  2. Physics raycast chain along the parabola (6 segments up to the first analytic hit time or 1.5 s) for walls, characters and floor.
- Moving receivers or sources: per-parcel simulation (5.4) is exact for both. The per-frame analytic curve is only used for **drawing** the stream
  and for LOW-tier landing prediction.

### 5.3 Stream representation (compare)

| Option | CPU | GPU (per stream) | Look | Stereo/VR | Moving source ("hose bend") | Effort |
|---|---|---|---|---|---|---|
| **Static tube mesh (8 sides × 24 rings = 384 tris) bent in the vertex shader by uniforms (p0, v0, g, length, Q)** | ~0 (uniforms) | tiny; ~20-60 k frags close up | good, with a scrolling normal/foam texture and thinning | correct (real geometry) | no (rigid parabola) | S |
| Same tube, but the spine follows the **live parcel positions** (≤16 control points uploaded as a uniform array) | ~16 vec3 | same | best: bends when you swing the bottle | correct | **yes** | M |
| Camera-facing ribbon | CPU or VS | lowest | flat at close range | **poor**: each eye sees a different billboard twist | yes | S |
| Capsule chain (instanced MultiMesh) | n × transform | n × capsule | lumpy unless dense | correct | yes | S |
| GPU particles | GPU sim | high overdraw | good splashy breakup | correct | yes | M |
| Instanced droplets (existing `emit_droplet` MultiMesh) | n rays/tick (current: 1 ray per droplet per tick) | small | dotted | correct | yes | done |

Recommendation: HIGH = tube on the parcel spine (rigid parabola fallback) + droplets at breakup and splash. MEDIUM = rigid-parabola tube.
LOW = no stream. Glugging: modulate radius and brightness at the glug pulse, which is cheap and sells it.

### 5.4 Volume accounting: parcels (recommended) vs instant transfer

**Parcel ledger.** Each physics tick a pouring opening emits one parcel `{pos, vel, vol_uL (int), mix_id, t_emit}` into a ring (≤128 per stream).
Each tick every parcel advances on its exact parabola, and the segment (p → p') is tested against receiver discs (analytic), then against the
world (MEDIUM/HIGH: one ray per parcel per tick, or only for the head parcel plus discs for the rest, GUESS of acceptable quality) and the floor.
On a hit the parcel's volume is **deposited exactly once**:
- inside the receiver disc: `receiver.deposit(mix, vol)`. Overflow above the receiver's rim (its own flow law over its rim, or the brim fill) leaves as new parcels.
- rim straddle: split by `frac = clamp((r_r - dist)/(2 r_stream) + 0.5)`, with the remainder continuing as a splash parcel.
- surface: `LiquidWorld.spill(mix, vol, pos, normal)` → puddle / wetness / hooks.

Experiment c (wine 600 ml → production tumbler v2 LUT, 232.5 ml with 40 ml in it, the source swaying ±35 mm so that the stream crosses the rim):

| Ledger | Final src / receiver / floor (ml) | max ledger error | max parcels alive |
|---|---|---|---|
| float64 | 198.2 / 232.5 (full, overflowed) / 209.3 | 7.7e-12 ml | 31 |
| float32 | same | 2.4e-3 ml | 31 |
| float32 + dt jitter (1/90..1/30) | 198.0 / 232.5 / 209.5 | 1.2e-3 ml | 27 |
| **int µL + dt jitter** | 197.3 / 232.5 / 210.2 | **0 (exact)** | 24 |

Plot `out/c_transfer.png` (looked at): the receiver fills in steps as the stream crosses the rim, overflow goes to the floor after ~10.7 s,
and the in-flight volume peaks around 18 ml (≈0.4 s × 41 ml/s).
**Instant transfer** (MINIMAL tier: the receiver gains what the source loses in the same tick) is simpler but would be off by that in-flight
amount and ignores aim. It is fine for scripted moments.

Recommendations: an **integer µL ledger** (u32 per substance; 4.29 L max per entry, or u64 for barrels/tanks). Physics in float32 is fine
because only the deposit routing depends on it. Fixed physics tick. Parcels emitted at physics rate.

### 5.5 Avoiding LUT inversions and staying deterministic

- The flow law needs only `d = LUT(u, f)` (forward, 1 per container per tick). Heads are `d - s`. Overflow is "head over the rim" through the same
  flow law (no `fill_at`). For a receiver at its brim: `deposit` clamps to `C * brim_fill` and routes the excess out as overflow parcels.
- Where an inverse is still convenient (LOW-tier instant clamp, "is point p submerged" checks, the `BottleLut.fill_for_offset` users):
  bake a **per-type inverse cache** at load: for each direction cell (v1: 33 cos values; v2: n_dir² grid) store 64 samples of `fill(d)` on a
  uniform d grid. That is 16 KB per type and one bilinear lookup instead of 14-30 forward lookups (`fill_at` today does a 30-step
  bisection in v1 and a full 64-row scan in v2).
- Determinism: fixed tick; container-local inputs only (pose, ledger); no `randf()` in the flow law (glug phase from a hash of the
  container id); deposit order sorted by parcel id; integers in the ledger. Rendering-only quantities (slosh, ripples) may be non-deterministic.

### 5.6 Receivers ("how does the receiving container know?")

`LiquidWorld` keeps a small registry of **open openings** facing up (`a·up > 0.2`): centre, normal, radius, owner. Containers register
when opened and unregister when sealed or asleep-and-capped. Parcels test against all of them (analytic disc, ~30 flops each). This replaces Area3D
triggers: they would be tick-delayed, need the physics engine for every parcel and cannot split at the rim. Mouth (drinking), sinks, tap catchers,
fire volumes and "puddle buckets" are just receivers with custom `deposit()`.

## 6. Topic 3: liquid hitting things

### 6.1 Events API (engine-agnostic names)

```
signal stream_started(container, opening_id, mix)          # also audio pour_start
signal stream_stopped(container, opening_id)               # audio pour_stop
signal stream_hit(container, info)    # throttled to <= 10 Hz per stream, aggregates the parcels of that window:
    info = {position, normal, collider, flow_ml_s, volume_ml, mix, speed, receiver (or null)}
signal deposited(receiver, mix, volume_ml, position)       # every receiver deposit (aggregated per tick)
signal spilled(mix, volume_ml, position, normal, collider)  # world surfaces
signal glug(container, phase, fill)                        # per glug pulse (audio + haptics)
signal cap_changed(container, cap_state, alpha); signal fizz_changed(container, co2, gush_rate)
```
Gameplay objects implement an optional interface (duck typed: `has_method`):
`receive_liquid(mix: LiquidMix, volume_ml: float, at: Vector3, normal: Vector3) -> float` (returns the accepted ml; the rest becomes a puddle),
and `on_wetted(mix, amount)` for wetness, flammability or extinguishing.

### 6.2 Splashes

- Spawn rule: per stream-hit aggregate, `n = clamp(k * flow_ml_s * speed^2 / 1000, 0, 6)` droplets per tick (GUESS k ≈ 1). Direction is the reflection
  of v about the normal plus a cone. The volume is taken from the parcel (conserving; droplets that land become puddles).
- Pool budget: the existing `BottleBreakManager` MultiMesh (`max_droplets = 192`) at HIGH. MEDIUM: 64 droplets. LOW: 0, sound only.
  Note: the existing droplets that hit non-floor surfaces (`n.y ≤ 0.5`) are deleted, so their volume vanishes. With a ledger they should run
  down to the floor (one extra downward ray from the hit) or add wetness to the wall.
- Splash audio: `play_event("splash", pos, energy, {size})`. Map `size = clamp(volume_ml/150)` and energy from speed.

### 6.3 Puddles, decals, wetness

| Option | Cost | Look | Budget | Notes |
|---|---|---|---|---|
| Puddle quad (existing, `add_puddle`, radius from volume/thickness, merges, evaporates) | 1 draw each | ok on floors | 24 (existing) | keep as the base (MEDIUM/LOW) |
| Godot `Decal` / three.js DecalGeometry | Godot Mobile renderer supports decals (per-cluster cost); three.js builds geometry | follows any surface | 16-32, fade 30-60 s | for walls, tables, characters (HIGH) |
| Wet material hook | per-fragment ~10 ALU on affected materials | darker albedo, lower roughness | 8 wet spheres global | see below |
| Droplets on glass after pouring | shader only: noise mask in the band above the plane that was wetted recently | nice for close-ups | 0 extra draws | `wet_band` uniform = max d over the last 10 s, decays |
| Neck drip after pouring | 1-3 droplet parcels from the lip at 0.5-2 Hz for ~2-4 s after `stream_stopped` | a known VR "aha" | uses droplet pool | volume from the ledger (0.05 ml each) |
| Liquid running down a surface | decal strip extended downhill (gravity projected on the surface) at 5-10 cm/s | good | counts as a decal | HIGH only |

Wet material: Godot **global shader uniforms** (`liquid_wet_spheres: vec4[8]` = centre + radius, `liquid_wet_time[8]`) plus a per-material
`instance uniform float wetness`. Shared materials include a tiny function `wet_apply(albedo, roughness, world_pos)`. three.js: the same through
`onBeforeCompile` chunks plus a shared uniform object. Cost is only on materials that opt in.

### 6.4 Nightfall Contracts hooks (optional, not scope)

Its `NightfallGrabbable` interface already has `interaction_noise(at, radius)` and `receive_ballistic_hit(at, direction)`. Its `docs/INTERACTABLES.md`
says "sealed cap: no pouring" and "puddle is a small geometry stain". Hooks that fit:
- Spilled puddles tag the floor region `wet` and raise footstep noise radius (e.g. ×1.5) for player and NPCs; NPC slip is optional.
  It can also be used as an alarm: guards hear splash/glug via `interaction_noise(at, 2-9 m)`.
- Flammable substances (alcohol, fuel from the jerrycan): a puddle plus an ignition source spawns a fire area, and water extinguishes it via `receive_liquid`.
- Distraction: pouring makes noise. Poisoned or sleeping-drug drink (a substance flag) for an NPC drinking event.
- Bullets → leaks (vented or glug), which is already in `breakable_bottle.gd`. Wire the leak to the vent rule.

## 7. Topic 5: mixing and layers

### 7.1 Data model

```jsonc
// LiquidSubstance (resource / JSON, shared)
{ "id": "red_wine", "absorb_rgb": [0.35, 0.02, 0.06], "ref_path_m": 0.045,   // colour seen through ref_path (as the shader today)
  "scatter": 0.05,            // 0 clear .. 1 milky/opaque (turbidity)
  "density": 990, "viscosity_pa_s": 0.0015, "co2_max": 0.0, "foam": 0.1, "foam_height": 0.006,
  "miscible_group": "aqueous", "flammable": 0.12, "sound_set": "default", "tags": ["alcohol"] }
// LiquidMix (per container: the ledger)
{ "layers": [ { "parts": [["water", 120000], ["grenadine", 15000]] },        // bottom (densest group) first, µL
              { "parts": [["oil", 30000]] } ],
  "co2": 0.0, "temp_c": 20.0, "agitation": 0.0 }
```
A layer is a set of miscible parts. Immiscible groups (aqueous / oil / mercury-like) always become separate layers.
Same-group liquids with different densities form a **transient** layer that diffuses into the layer below (7.5).

### 7.2 Colour mixing

| Model | Formula | Cost | Correctness |
|---|---|---|---|
| RGB lerp | `C = Σ φ_i C_i` | 0 | wrong: red wine + water reads pink-grey too early, and dark + clear stays too dark |
| **Beer-Lambert (recommended)** | absorbance `σ_i = -ln(C_i)/ref_i`; `σ_mix = Σ φ_i σ_i`; shader colour `exp(-σ_mix L)` | 1 CPU line per change | physically right for dyes and solutions; dilution behaves |
| + scattering | `scatter_mix = Σ φ_i s_i`, mix toward `sqrt(C)` like the existing haze | +2 ALU | milk, juice, cloudy cocktails |

The shader already computes `lc = log(liquid_color)` and scales it with `L / ref_path`. Mixing means uploading `lc_mix = Σ φ_i ln(C_i) * (ref_path/ref_i)`.
That needs a uniform holding the log colour (or `liquid_color = exp(lc_mix)`). No shader change is required for one layer.

### 7.3 Plane offsets for N layers (algorithm)

```
# u = slosh-bent up in object space (one normal for ALL interfaces), layers sorted bottom -> top (densest first)
F = 0
for k in range(N):
    F += V_k / C               # cumulative fill
    d[k] = LUT(u, F)           # forward lookups only (v2: 16 taps each; N <= 4)
# d[N-1] is the free surface (= today's plane); d[0..N-2] are interfaces
```
Experiment b (layers 25 / 10 / 30 % + 35 % air; brute-force volume of the real GLB Liquid mesh between planes, tilts 0-180° in 10° steps, several azimuths):

| LUT | max layer error | rms | max error relative to the layer | total fill error |
|---|---|---|---|---|
| wine, v1 33×64 | 16.7 ml | 7.0 ml | 7.7 % | 14.7 ml (v1 bias vs the mesh: 868 vs 886 ml; probably the analytic profile bake vs the 48-gon mesh) |
| wine, v2 25×25×64 | 2.2 ml | 0.5 ml | 1.0 % | 1.4 ml |
| jerrycan (non-symmetric, 15.7 L), v2 | 101 ml | 15 ml | 2.2 % | 71 ml (0.45 % of capacity) |

**Slosh coupling:** if the interfaces get their own spring normals (out of phase, 0.6× lean), the layer volumes break quickly: a 5° lean gives 16.6 ml
(19 % of the thinnest layer), 10° gives 78 ml and 20° gives 175 ml. The bottle is 34 cm long, so small angles move a plane a lot at large tilts.
With a **shared normal**, the error stays ≤ 1.6 ml up to 30° lean (`out/b_layers.png`, looked at). Rule: one physical normal; interface waves only as a
zero-mean visual displacement in the shader with amplitude ≤ 0.3 × local layer thickness. They are driven by the same slosh energy but slower:
the interface frequency is `ω_k = ω_surface * sqrt(Δρ/ρ)`, which for oil/water (Δρ/ρ ≈ 0.1) is about 3× slower. That is the characteristic lazy oil-water wobble, cheap and safe.

### 7.4 Pouring from layered contents

In the flow law, each lip strip x draws from the layer whose band `[d_{k-1}, d_k]` contains `s(x)`. A gentle tilt therefore pours the
**top** layer first (cocktail floats pour off), an inverted bottle drains the **bottom** layer first, and a strip that spans two layers splits.
Emitted parcels carry a `mix_id` (an interned mix: small table of up to 64 active mixes per stream).
No extra lookups are needed, because the d_k are already computed for rendering.

### 7.5 Miscible blending over time

- Transient layer k (same group, different density) has an interface band width `w(t) = sqrt(2 D_eff t) + w0`, with D_eff a gameplay value (GUESS
  1e-5 - 1e-4 m²/s, which mixes in 5-60 s). Stirring or agitation multiplies D_eff by up to 100. When `w > 0.5 × thinner layer thickness`, merge
  the layers (parts summed, colour via 7.2). The band is rendered as a smoothstep blend of the two absorbances around d_k.
- A pour into a receiver with momentum mixes partially: a deposit at speed v into a layer of the same group mixes `min(1, v/1.5 m/s)` of the deposit immediately
  and the rest becomes a transient layer (GUESS). This gives grenadine sinking ("sunrise") when poured slowly.
- Carbonation mixes by volume (`co2 = Σ φ_i co2_i`). Foam tendency is the max of the parts scaled by co2. Pouring soda into anything foams by `co2 × speed`.
- Temperature: per container scalar, volume-weighted on mix, relaxes to ambient (τ minutes). Ice cubes add solid displacement (section 8).
- Reactions (chemistry-lite, optional): a table `recipes: [{needs: {a: [0.3,0.5], b: [...]}, conditions: {agitation>0.5, temp<10}, makes: "x", event: "fizz|smoke|glow"}]`,
  evaluated **only on change events** (deposit, cap change, agitation peak), never per frame. Its cost is O(recipes) on events.

### 7.6 Shader changes (both engines)

```glsl
uniform int   layer_count;          // 1..4 (1 = exactly today's shader)
uniform float layer_d[4];           // offsets; layer_d[layer_count-1] == plane.w
uniform vec3  layer_lc[4];          // log colour per layer (already scaled to ref_path)
uniform float layer_band[4];        // interface blur width (m), from diffusion / meniscus
// fragment: h = dot(obj_pos,u) - layer_d[top]; discard if h > 0 (unchanged, ONE discard)
// layer index: k = sum(step(layer_d[i], s)) for i < top   (counting rule, stable when planes cross)
// Beer-Lambert path: split the existing path L at the plane crossings t_i = (layer_d[i]-s)/dot(rd,u),
//   clamp to [0,L], accumulate sum_k lc_k * dt_k / ref_path  (~8 ALU per layer)
// interface band: col = mix(col_k, col_k+1, smoothstep(-band, band, s - layer_d[i])) + thin bright meniscus line
// back faces (surface view): only the top layer is visible -> unchanged except the colour of the top layer
```
Cost: +~22 ALU per layer per fragment (GUESS), no texture lookups, no extra discards. The bubble and foam layers stay keyed to the top
surface. Also clamp bubble rise to the layer of the carbonated part (optional).

## 8. Topic 6: other valuable, feasible extras

| Idea | How (cheap) | Effort | Tier |
|---|---|---|---|
| Drinking in VR | mouth receiver: a disc of radius 2.5 cm at `head * (0, -0.07, -0.08)`, active when the opening is within 4 cm and points at the face; flow law decides if anything comes out; consumed `≤ 25 ml/s` (sip cap, GUESS), gulp sound + haptic every 15 ml; over-tilt → excess misses the mouth and becomes a spill on the chest (wetness on the avatar) | S | all |
| Taps / refilling | a tap = infinite source with fixed Q and a valve 0..1 → parcels; sinks = receivers that delete volume | S | all |
| Floating objects / ice | buoyancy from the plane: submerged depth `d - s(p)`; ice = a small body constrained inside, bobbing at the plane; displaced volume added to the LUT input `f_eff = (V + V_sub)/C`, so the level visibly rises; melting adds water parts | M | HIGH/MEDIUM |
| Dipping hands/objects | point test `s(p) < d` plus inside the spine radius → `on_wetted`, ripple kick, displacement as above | S | all |
| Stream wobble | glug pulse modulates Q (zero-mean) and the stream radius; hand tremor adds a small spine noise | S | HIGH |
| Open cups while walking | flow law with the slosh-bent `u_eff` and the receiver's rim = spill when carried carelessly (a gameplay skill) | S | MEDIUM+ |
| Bottle opener interactions | opener tool = a lever with a torque threshold on a crown cap (state machine 4.1); edge-of-table trick = impact on the cap zone | M | all |
| Spillage persistence / save | puddles and decals saved as `{pos, normal, mix_id, ml, age}` (≤ 24 + 32 entries) | S | all |
| Networking | owner-authoritative ledger; replicate `{cap_state, alpha, mix (u32 µL per part), co2 (u8), stream on/off + Q (u16)}` at 5-10 Hz, delta-compressed (< 32 B per container per update); remote clients rebuild the stream visuals from the replicated pose + Q; deposits are server events | M | all |
| Breakage handoff | on shatter: the whole ledger → `spill` (splash + puddle), exact; on neck snap: the opening becomes the jagged rim at `open_z` (break JSON) with α = 1 | S | all |

## 9. Architecture

### 9.1 Components

| Component | Engine-agnostic role | Godot | three.js |
|---|---|---|---|
| `LiquidSubstance` | static properties | `Resource` (`.tres`) or JSON | plain object from JSON |
| `LiquidMix` | ledger: layers of (id, µL), co2, temp, agitation | `RefCounted` | class |
| `LiquidContainerType` | shared per asset: LUT (v1/v2), inverse cache, openings (centre, axis, radius, spine[16], cap type), capacity | `Resource` loaded from the `.liquid.json` | object, shared |
| `LiquidContainer` | per instance: mix, cap states, tier, flow law, wake/sleep, emits events; drives the renderer | `Node` child of the RigidBody (replaces the direct use of `BottleLiquid.fill`) | object with `update(dt)` |
| `LiquidRenderer` | uniforms: plane(s), layer colours, foam, bubbles; tier → material variant | existing `BottleLiquid` (extended) | existing `setupBottle` (extended) |
| `Cap` | state machine 4.1, interaction handlers, α | `Node` with signals | object |
| `PourStream` | parcel ring, stream mesh uniforms, landing | `Node3D` + tube `MeshInstance3D` | `Mesh` + `ShaderMaterial` |
| `LiquidWorld` (singleton) | receiver registry, tier assignment, budgets, spill routing, global wet uniforms, save/load | autoload | module singleton |
| `SplashPool`, `PuddleManager` | droplets, puddles, decals with budgets | reuse `BottleBreakManager` pools (split out later) | InstancedMesh pools |
| `ContainerLink` (optional) | scripted transfer A→B at rate (MINIMAL tier, cutscenes, UI "pour" button) | helper | helper |

Tick order (physics tick): containers awake → flow law → emit parcels → `PourStream` step (deposits) → receivers clamp/overflow →
`LiquidWorld` routes spills → events (throttled). Rendering (process): LUT for render planes with the slosh `u_eff`, uniforms.

### 9.2 Data schema additions (`*.liquid.json`, written by `scripts/bottles.py` / `containers.py` / `liquid_lut.py`)

```jsonc
"openings": [ { "id": "mouth", "centre": [0, 0.332, 0], "axis": [0, 1, 0], "radius": 0.0106,
                "r_min": 0.0091, "spine": [[0,0.332,0, 0.0106], [0,0.30,0, 0.0091], ... 16],   // (centre xyz, radius) lip -> body
                "cap": "cork", "closed_by": "Cap" } ],
"substance": "red_wine",          // default contents (replaces color/carbonation/foam fields, which stay for compatibility)
"inverse": { "n_d": 64, "data": "<u16 base64>" }   // optional baked fill(dir, d) cache
```
v2 files already carry `open`, `closed_by`, `rim_points`, `open_height`, `top_y`, `brim_fill`. The spine and opening axis are the missing pieces.
The break JSON already has `open_z` / `neck_z` for the broken variant's opening.

### 9.3 Runtime API (sketch)

```gdscript
container.tier = LiquidContainer.Tier.MEDIUM          # any time; no state change
container.mix.add("cola", 330_000)                    # µL
container.cap.open(0.4)                               # alpha; or interaction-driven
container.transfer_to(other, 50.0, 0.0)               # ml, seconds (0 = instant, MINIMAL)
container.get_flow_ml_s(); container.get_fill(); container.is_pouring()
LiquidWorld.spill(mix, ml, pos, normal); LiquidWorld.register_receiver(node, opening)
```

### 9.4 Exact integration points with the existing code

1. `shaders/godot/bottle_liquid.gd` (`BottleLiquid`): keep `fill` as the render input, but add `layer` uniforms, `set_mix_colors()`, a getter for the
   slosh up (`_up_eff`, needed by the flow law and spills), a `flow` property (the audio README adapter already looks for `bottle_liquid.flow`),
   `tier`, and **sleep**: `_process` currently runs for every bottle every frame, so add `set_process(false)` when idle. Use
   `LiquidLutV2` instead of `lut_offset` so v2 assets work.
2. `shaders/godot/bottle_liquid.gdshader` and `shaders/three/bottle_liquid.js`: layer uniforms (7.6), log-colour input, tier variants
   (#define-style copies: FULL / NO_BUBBLES / BASIC). Default `layer_count = 1` must render exactly as today.
3. `shaders/godot/liquid_lut_v2.gd` / `shaders/three/liquid_lut_v2.js`: add `offsets_cumulative(up, fills[])` (shares the 16 taps across N fills,
   so N layers cost about one lookup), the inverse cache, and the openings parse.
4. `gameplay/godot/breakable_bottle.gd`: `_process_leaks` → leaks become runtime openings (vent rule). `_process_spill` → the neck-snapped
   opening goes through the flow law. `set_fill` → `container.mix` writes. On `_shatter`, the ledger volume goes to `splash` (exact).
   `BottleLut` (v1 only) → `LiquidLutV2` (it handles v1 too).
5. `gameplay/godot/bottle_break_manager.gd`: `emit_droplet` / `splash` / `add_puddle` become the SplashPool/PuddleManager backend. Add a `mix_id`
   per droplet and puddle, and do not drop volume on wall hits (route to floor or wetness).
6. `audio/godot/bottle_audio.gd`: `stream_started` → `play_event("pour_start", p, flow, {source, fill})`. Glug-regime streams use the
   `liquid_glug` loop (variant by fill bucket, as the audio README describes), free streams use `liquid_stream_loop`.
   `update_loop("pour", src, p, flow)` per tick. `stream_stopped` → `pour_stop`. Splash deposits → `splash` with `size`. Cap transitions →
   `cap_pop {cap}`. co2 > 0 and open → `fizz_start` / `update_loop("fizz")`. Bubble pops on deposit into carbonated mixes → `bubble_pop`.
7. Nightfall: expose `interaction_noise` on splash, shatter and pour. `receive_ballistic_hit` → leak opening.
8. Asset pipeline: `scripts/bottles.py`, `scripts/containers.py`, `scripts/liquid_lut.py` emit `openings` with spines (lathe: trivial from the
   profile; containers: from the cap/mouth node). Re-bake v1 bottles as v2 from the mesh to remove the about 1.7 % bias.

### 9.5 Save/load and networking

Saved per container: `{type, mix (layers of [id, µL]), co2, temp, cap {state, progress, alpha}, tier_hint}`, about 64-200 B.
Not saved: slosh, parcels (flush them on save: deposit the in-flight volume where the analytic landing says, so the ledger stays exact), foam.
World: puddles/decals ≤ 56 entries. Networking: see section 8. The ledger is integer, so all peers agree exactly once the server's deposit events arrive.

## 10. Feasibility experiments (what was run, results)

| Script | What it checks | Key numbers |
|---|---|---|
| `tests/liquid_proto/common.py` | loads the production LUTs (v1/v2) and the GLB Liquid meshes (voxelised with `scripts/liquid_lut.py`, used read-only); flow law | n/a |
| `a_pour.py` → `out/a_pour_*.png` | tilt sweep, flow law, glug | wine 750 ml inverted: 17.5 s (k_g 0.37), 12.9-25.8 s for k_g 0.5-0.25; hold 80°: no pour; jar 1.4 s |
| `b_layers.py` → `out/b_layers.png` | 3 layers via cumulative LUT | v2: ≤2.2 ml (1 % of layer) wine, 2.2 % of layer jerrycan; v1: 16.7 ml (bias); independent interface normals: 5° → 19 % of a layer |
| `c_transfer.py` → `out/c_transfer.png` | parcels, rim split, overflow, conservation | int µL: 0 error; float32: 2.4e-3 ml; ≤31 parcels; ≤18 ml in flight |
| `d_costs.py` → `out/d_costs.png` | coverage and ALU model, memory, CPU op counts | 0.35 m: 6.7 % of the eye buffers, full shader ~0.17 ms vs basic 0.018 ms (GUESS model); +3 layers ≈ +0.03 ms; ~3 kflop/tick per pouring container |

Not done (honest gaps): no Godot or three.js prototype was run (another agent owns the Godot test projects, and the brief allowed only an isolated copy).
No device GPU timing was taken. The flow law has not been validated against real pour measurements. Stream breakup and splash looks are untested.

## 11. Roadmap

| Phase | Deliverables | Acceptance tests | Risks |
|---|---|---|---|
| 0: pour-out, caps, spill (LOW/MEDIUM) | `LiquidContainer` + integer ledger; openings in the JSON (lathe bottles first); flow law (weir + glug + vent + min head); cap state machines (cork, crown, screw) with α; MEDIUM rigid-parabola tube stream; spill → existing puddles; audio pour/glug/cap events; sleep when idle; tier switch with LOW = no stream | headless: wine 750 ml inverted empties in 12-22 s; hold 80° does not pour; sealed = 0 ml lost after 1000 random rotations; ledger sum constant to 0 µL over a 10 min random-motion soak; idle container: `_process` not called (counter); GDScript flow ≤ 0.2 ms per pouring bottle on the dev PC | glug feel (tune k_g); GDScript cost (move to C++/GDExtension later if needed); cap gesture UX in VR |
| 1: container to container | parcels + receiver registry + rim split + overflow; HIGH tube on the parcel spine; splash droplets; drinking receiver; taps | the `c_transfer` scenario reproduced in engine with 0 µL error; pour 100 ml into a moving cup by hand in VR; overflow lands on the floor; mouth receiver consumes when tilted to the lips | stream aiming feels hard (assist: magnetise parcels within 1 cm of a rim, keeping volume); physics ray budget |
| 2: layers and mixing | substances + mixes; Beer-Lambert colour mixing; N ≤ 4 layers (shared normal), interface band, diffusion, layered pour-out; carbonation pressure + gush + fizz loss; v1 → v2 re-bake | layer volumes within 1 % of capacity vs voxel ground truth for all assets (extend `b_layers`); a 3-layer cocktail stays layered when gently poured; shaken soda gushes 10-35 %; colour of wine+water matches a Beer-Lambert reference | shader variant count; diffusion tuning; immiscible-in-miscible edge cases |
| 3: interactions and wetness | wet-material global uniforms; decals; neck drip; droplets on glass; floating ice/objects; gameplay hooks (fire, noise, slippery); save/load; networking | budgets hold (≤ 24 puddles, ≤ 32 decals, ≤ 192 droplets); save → load restores ledger, caps and puddles exactly; two-client test shows the same receiver volumes | decal cost on Quest; art direction for wetness |

Cross-phase: an automatic tier manager from phase 0 (start with distance + held + count); device profiling at the end of each phase.

## 12. Open questions for the user

1. **Realism vs gameplay:** should pouring take realistic times (a wine bottle takes ~17 s to empty inverted) or be sped up (e.g. 2×)? Should swirling
   to pour faster be a mechanic?
2. **Conservation:** exact (integer ledger, puddles count) or "good enough" (puddles may lose volume, evaporation)? Must spilled liquid ever be recoverable?
3. **Drinking:** head-tilt drinking at the lips (physical), a "bring to mouth and hold" gesture, or a button? What happens when you drink something (effects, UI)?
4. **Caps:** how physical should opening be (a corkscrew tool and pull force vs a single grab-and-twist)? Can caps be lost or reused?
5. **Carbonation:** should shaken soda gush as a gag or as a mechanic (a weapon/distraction)? Fizz-loss time scale (real hours vs game minutes)?
6. **Layers/recipes:** do you want a cocktail/potion system with recipes, or only the visuals of layers and mixing? Maximum layers (2 or 4)?
7. **Tiers:** a target frame budget for liquids (e.g. 0.5 ms CPU, 1 ms GPU on Quest 3 / Steam Frame)? How many simultaneous HIGH containers?
8. **Wetness:** do characters and the player get wet (stains on clothing, gameplay effects) or only floors and tables?
9. **Networking:** is multiplayer a requirement (it decides the authority model now)?
10. **Engines:** parity between Godot and three.js, or Godot first with three.js at LOW/MEDIUM only?
11. **Assets:** may the pipeline agent add `openings`/`spine` to the liquid JSONs and re-bake v1 bottles as v2 from the mesh (fixes the about 1.7 % bias)?
