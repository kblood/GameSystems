# Spilled liquid system (optional ULTRA tier): research and plan

Scope: liquid that has already left a container: puddles that grow, flow over table and shelf edges and drip off them,
drips, strands, rivulets on vertical faces and bottles, splash crowns, mist, and the film left on glass. Different
viscosity and surface tension per liquid. Target: Godot 4.7 + Jolt (desktop, Quest-class native) and the three.js port
(WebXR). Existing pieces this builds on: `BottlePour` parcels and stream tube, `BottleBreakManager` droplets (MultiMesh)
and puddles (decals on HIGH, quads clipped to the surface edge below HIGH), per-liquid extras (`viscosity`, `density`,
`foam`, `carbonation`, `opacity`, `color`), and the `LiquidSubstance` sketch in `liquid_system_brainstorm.md` §7.1.

Prototype: `tests/spill_research/` (`spill_proto.gd` = the model, `spill_test.gd` = 20 numeric checks, all passing).
Run it with `Godot_v4.7.2-stable_win64_console.exe --headless --path tests/spill_research`.

## 0. Recommendation

**Use (d), a hybrid with an analytic, event-driven core (c).** Each puddle is a few numbers: centre, volume, contact radius
and the clip rectangle of the top face it lies on. It spreads with the closed-form viscous gravity-current law, overflows
edges by a pinning and flux rule, and edge **sites** turn overflow into drips, strands or ropes. Rivulets are short
splines with a volume budget. Everything that falls uses analytic flight time from one cached ray. Rendering reuses
what exists: decal or clipped quad puddles, the droplet MultiMesh, and the stream tube shader for ropes and strands.
A GPU height field (a) is an **optional cosmetic layer for desktop ULTRA only**. It never owns volume.

Why:
- It conserves volume exactly. The prototype ledger error is 1e-11 ml over 300 s for all 10 liquids.
- Cost is tiny and limited to events. One active spill takes 25-135 us per step in GDScript on the dev PC, and steps run
  on only 6-16 % of ticks over a 5-minute window (oil 55 %). At rest it costs nothing.
- It has no per-frame rays: 1 ray to find the surface, plus 1 per edge the first time that edge overflows (max 5 measured).
- The same data drives every tier. Lower tiers just stop using sites, strands and rivulets.
- It ports 1:1 to three.js as pure math.

Not feasible in realtime WebXR or on Quest, and not planned: 3D fluid simulation of spills (SPH/FLIP); screen-space
fluid surfaces (depth splat + blur, about 2-3 ms GPU per eye on Quest, and needs Godot `CompositorEffect`, which the
Compatibility/WebGL path lacks); physically accurate wetting of arbitrary trimesh geometry; a simulated honey rope
coiling on the floor (fake it); per-frame mesh rebuilds or ray storms.

## 1. Candidate approaches and cost

Measured: the prototype numbers in this section. Estimated: Quest is about 3-4x slower than the dev PC in GDScript.

| | (a) height field per surface | (b) adhesive particles | (c) analytic / event | (d) hybrid (recommended) |
|---|---|---|---|---|
| Model | 2D shallow water (virtual pipes) with implicit viscous damping on an n x n grid (5 mm cells) | 100-500 parcels with adhesion, surface friction and cohesion (SPH-lite) | disc puddle clipped to the face rectangle; Huppert spread; edge pin and flux; sites; splines | (c) owns the volume; optional (a) on the GPU only for the puddle outline and ripples near the camera |
| CPU, desktop | **measured** GDScript: 32x32 = 0.74 ms/step, 64x64 = 3.0 ms/step | 300 parcels: about 0.3-0.6 ms for rays (1 per parcel per tick) plus a neighbour grid of about 0.5 ms | **measured** 25-135 us/step per active spill, 0 when asleep | same as (c) plus about 0.05 ms dispatch |
| CPU, Quest | 32x32 about 2.5 ms: too much in GDScript; needs C++ or GPU | about 2-3 ms: too much | about 0.1-0.5 ms per active spill (3 active max) | same as (c) (no GPU field on Quest) |
| GPU | compute on Forward+/Mobile through RenderingDevice; GPGPU ping-pong in three.js; about 0.05 ms for 64x64 R16F. Readback for edge events is async with 1-2 frames of latency | metaball or screen-space surface 1.5-3 ms on Quest; instanced spheres look like beads, not a film | 1 decal + a few instances | (c) + one R16F texture per hot puddle |
| Memory | 64x64: h R16F 8 KB + 4 fluxes RGBA16F 32 KB per patch | 300 x 48 B = 15 KB + render targets (MBs) | about 1-2 KB per spill | + 40 KB per GPU patch |
| Edges, drips | cells at the border emit; needs extra logic anyway | natural but noisy; drip pinch-off is wrong without surface tension | explicit, tunable per liquid | explicit |
| Viscosity range | water needs CFL dt < dx/sqrt(gh); honey is stiff with an explicit lubrication model (dt < dx²/4D), so it needs implicit friction | honey needs tiny steps or fake damping | closed form, no stiffness | closed form |
| Look | best: fingers, merging, non-circular shapes | blobby | smooth wobbly discs (shader noise) | (c), plus organic outlines on desktop |
| Gameplay, ledger | hard (GPU owns the volume) | ok | exact, cheap queries | exact |
| WebXR (three.js) | GPGPU fine; still needs readback | screen-space fluid too heavy in stereo | trivial | (c) on WebXR, (a) layer off |

On a 1.2 m table, (a) also needs a patch that moves with the spill (5 mm cells means 240² cells for the whole top), and
one grid per face for vertical runs. That is why it is only an optional add-on.

## 2. Per-liquid parameters

Physics used (all closed form, `spill_proto.gd: derive()`):
- capillary length `l_c = sqrt(γ/(ρg))`
- equilibrium puddle thickness `h_eq = 2 l_c sin(θ/2)` (θ = static contact angle on varnished wood)
- edge pin height `h_pin = pin · h_eq` (Gibbs pinning at a sharp edge; the puddle stops at the edge until it is that thick)
- spreading `R = 0.894 (ρ g V³ / 3μ)^(1/8) t^(1/8)` (Huppert 1982), capped at 0.3 m/s and at the area `V/h_eq`; the contact line never recedes
- edge flux per metre `q' = min(0.5 sqrt(g) e^1.5  [weir],  ρ g h³ e / (3μ (d + l_c))  [film])`, with e = h − h_pin and d = centre-to-edge distance
- drip volume `V_drop = 2π l_c γ/(ρg)` (Tate's law at a flat edge)
- neck pinch-off time `τ_neck = max(0.02, 3 μ l_c/γ)`
- strand lifetime `τ_strand = 20 μ l_c/γ`; threads form when τ_strand > 0.08 s; a thread thins at `dr/dt ≈ −0.07 γ/μ`
- site spacing `λ = 2π√2 l_c` (Rayleigh-Taylor)
- drip-to-jet switch `q_jet = π l_c² sqrt(γ/(ρ l_c))` (We ≈ 1)
- rivulet speed `v = ρ g h²/(3μ)` (Nusselt film), capped at 0.25 m/s

| liquid | μ Pa·s | ρ | γ N/m | θ° | h_eq mm | h_pin mm | V_drop ml | τ_neck s | strand s | q_jet ml/s | rivulet m/s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| water | 0.001 | 1000 | 0.072 | 50 | 2.29 | 3.09 | 0.125 | 0.02 | - | 3.8 | 0.25 cap |
| beer | 0.0018 | 1010 | 0.042 | 30 | 1.07 | 1.39 | 0.055 | 0.02 | - | 1.9 | 0.25 cap |
| red wine | 0.0015 | 990 | 0.047 | 35 | 1.32 | 1.72 | 0.067 | 0.02 | - | 2.2 | 0.25 cap |
| spirits 40 % | 0.0024 | 950 | 0.030 | 15 | 0.47 | 0.56 | 0.036 | 0.02 | - | 1.3 | 0.25 cap |
| milk | 0.002 | 1030 | 0.045 | 40 | 1.44 | 1.88 | 0.059 | 0.02 | - | 2.0 | 0.25 cap |
| cola / soda | 0.0015 | 1040 | 0.065 | 45 | 1.93 | 2.61 | 0.101 | 0.02 | - | 3.2 | 0.25 cap |
| blood-like | 0.004 | 1060 | 0.058 | 45 | 1.81 | 2.53 | 0.083 | 0.02 | - | 2.7 | 0.25 cap |
| olive oil | 0.08 | 915 | 0.032 | 10 | 0.33 | 0.39 | 0.042 | 0.02 | 0.09 | 1.5 | 0.04 |
| syrup (maple) | 0.15 | 1330 | 0.070 | 60 | 2.32 | 3.47 | 0.078 | 0.02 | 0.10 | 2.5 | 0.16 |
| honey | 5.0 | 1420 | 0.060 | 70 | 2.38 | 3.81 | 0.056 | 0.52 | 3.5 | 1.9 | 0.005 |

Behaviour columns (rendering and gameplay; not used by the core):

| liquid | edge behaviour | drip shape | strand | foam on spill | stain / absorption | evaporation |
|---|---|---|---|---|---|---|
| water | pins hard, then a curtain of fast drips | round bead, clean snap | no | no | wet darkening only, dries without a trace | slow (0.002 mm/min) |
| beer | pins weakly (surfactant), many small drips | small beads | no | yes: foam ring on the puddle (extras `foam` × agitation), collapses in 20-40 s | faint sticky ring | slow; leaves a sticky ring |
| red wine | like water | beads | no | slight | **strong** (absorb into wood and fabric, coffee-ring edge darker) | slow; the stain stays |
| spirits | hardly pins, creeps thin and wide | tiny beads; legs/tears on glass | no | no | none | **fast** (0.02 mm/min), shrinking puddle |
| milk | like water, opaque | opaque beads | no | no | pale film, matt when dry | slow; leaves a residue |
| cola | like water; fizz | beads | no | yes: short-lived fizz ring (`carbonation`) | sticky | slow; sticky |
| blood-like | pins well | darker, heavier beads | no | no | strong, darkens and goes matt over about 60 s | slow; crust |
| olive oil | creeps over edges slowly for minutes | slow small drops, short threads | short (4 cm) | no | absorbs into wood (dark halo), never dries | none |
| syrup | slow sheet; thick ropes while fed | elongated drops | yes, about 5 cm | no | sticky glossy | none |
| honey | stays a mound near where it landed; rope or strand over the edge | strand, then bead; break takes seconds | **yes, reaches the floor** | no | glossy, sticky | none |

Reuse of existing data:
- **With a substance id** (brainstorm §7.1 `LiquidSubstance`), use its `viscosity_pa_s` and `density` and add a
  `spill` block: `{gamma, theta, pin, evap_mm_min, stain, absorb, sticky}`.
- **Without an id** (today's `*.liquid.json` and GLB extras):
  - `μ = 1e-3 · 10^(4 · viscosity)`, using the normalised 0..1 `viscosity` field: honey 0.92 → 4.8 Pa·s, cruet oil
    0.6 → 0.25, beer 0.1 → 2.5 mPa·s, whiskey 0.25 → 10 mPa·s (high, but harmless).
  - `ρ = density · 1000`.
  - γ is 0.07, or 0.045 when `foam > 0.3`.
  - Thresholds on `foam`, `carbonation` and `opacity` select foam, fizz and milk-like rendering.
  - `color` gives the stain colour.

Where `viscosity` is missing (most v2 designs), use water, unless the design name contains a known substance.

## 3. Drip and spill types

| type | trigger rule | cheap rendering | cost |
|---|---|---|---|
| **Edge drip** (neck + detach) | Site feed between `Q_PINNED` (0.002 ml/s) and `q_jet`, non-strand liquid. The bead grows to `V_drop`, holds `τ_neck`, then 85 % detaches and 15 % stays as a residual bead. | One instance per site in a `drips` MultiMesh. The vertex shader morphs sphere → pendant (neck cone) from a `phase` instance value (0 = small bead, 1 = necked) and stretches it along gravity. On detach, call `BottleBreakManager.emit_droplet(v=0)`; on landing it comes back through `add_liquid`. | 1 draw for all sites; 1 instance write per site per tick |
| **Curtain / rope** | Site feed > `q_jet` (water ≥ 3.8 ml/s per site; honey ropes at ≥ 1.9 ml/s) | One tube per edge run using the existing `STREAM_SHADER` (p0 = site, v0 = 0.05 m/s outward, q = feed). For wide sheets, a flat ribbon variant of the same shader. | 1 draw per overflowing edge |
| **Honey strand** | Strand liquid (τ_strand > 0.08 s), feed ≥ 0.005 ml/s per site, and the bead has reached `V_drop` | Same tube shader, vertical. Radius `r = sqrt(q/(π v))` with v = min(free fall, viscous terminal speed). After the feed stops, r thins linearly (`−0.07 γ/μ` per s) and breaks at τ_strand; the upper half retracts to the bead, the lower half falls. Floor coil (ULTRA): 3-6 stacked small torus instances at the landing point, growing with the delivered volume. | 1 draw per strand (max 4) |
| **Rivulet** (vertical face or bottle side) | (1) An edge feed below `q_rivulet ≈ 0.3 q_jet` with a rounded edge (teapot effect) follows the side face instead of dropping. (2) A droplet or parcel hits a face with n.y < 0.5 (today these are deleted). (3) A bottle after `stream_stopped` or a slow pour (lip film runs down the outside of the neck). | Head moves down the gravity-projected face direction at the Nusselt speed (cap 0.25 m/s). The trail costs `w · h_res` volume per metre (w ≈ 2 l_c, h_res ≈ 0.3 h_eq); the head stops when its volume < V_drop/2. Drawn as a strip mesh, 2 mm off the face, 16 segments, grown by a shader `length` uniform, so there are no mesh rebuilds. On bottles it is parented to the body in local space, with radius r(z) from the design JSON profile (16-entry table baked once). At the bottom edge it becomes an edge drip site or a small puddle. | 1 draw per rivulet (max 6) |
| **Splash crown** | A parcel or drop lands with `K = We^0.5 Re^0.25 > 57` (Mundo), using D = parcel diameter and v = impact speed. Water at 3 m/s with a 4 mm drop: K ≈ 235, splashes. Honey: K ≈ 40, no splash; instead a viscous buckling mound (scale-in bump). | A pool of 8 crown meshes: one ring strip with 12 spikes; the vertex shader expands r(t) = r0 + v_c t and height along a parabola; fade out in 0.15 s. Plus 4-8 droplets from the existing pool carrying 10-20 % of the parcel volume. | 1 draw, 0 rays |
| **Mist / spray** | Bottle shatter energy above a threshold, a jet hitting at We > 1000, or opening a shaken carbonated container (`carbonation · agitation > 0.5`) | A separate 64-instance soft billboard MultiMesh (or one-shot `GPUParticles3D`; three.js `Points`). No rays. Volume < 1 % goes to the `evaporated` ledger, or to one wet decal along the cone axis (1 ray). | 1 draw |
| **Creeping film on glass** | After the level drops (pour, drink, tilt back): the band between the current level and the highest wetted level over the last 10 s | Shader only (in `bottle_glass` or the liquid shell). Uniforms `wet_top`, `wet_t0`. Film thickness in closed form (Jeffreys draining film) `h(z,t) = sqrt(3 μ z / (ρ g t))` drives opacity, tint and refraction. Wine and spirits add Marangoni "legs" as noise streaks; honey keeps a thick glossy sheet for minutes; water breaks into small drops below h ≈ 20 um. | 0 draws, ~15 ALU |

## 4. Surface knowledge (cheap, cached)

- **Face lookup:** one ray at the landing point (the parcel's own landing ray in `BottlePour._step_parcels` or the droplet
  ray already gives `collider` and `shape`, so there is no extra ray). Then:
  - **BoxShape3D:** reuse `_box_top_rect` from `BottleBreakManager`. It gives the top-face rectangle and frame for any
    rotation. Cache the face as `{collider_id, shape_idx} → (face Transform3D, hx, hz, box ref)`.
  - **WorldBoundaryShape3D:** no edges.
  - **Other shapes:** fall back to HIGH behaviour (the existing puddle, no edge flow). The 8-ray probe exists, but its
    edges are approximate.
- **Edge data:** comes from the same box. The edge positions are analytic, and the side face below each edge is the
  adjacent box face (also analytic), so rivulets know their path and bottom edge without rays. The drop height under an
  edge is **one ray the first time that edge overflows**, cached (prototype: max 5 rays per spill, 0 per step).
- **Moving or held surfaces:** a box that is a RigidBody stores the spill in its local frame and re-reads its transform
  only while awake. If it tilts more than 10°, the puddle converts back to parcels that leave over the low edge. This is
  stage S3+; until then, spills on dynamic bodies use HIGH behaviour.
- **Invalidation:** the cache entry is dropped on `tree_exiting` of the collider or when its transform version changes.
  Nothing is polled.
- **Existing puddle and decal tiers:** SpillSystem does not draw puddles itself. It drives the same visuals:
  - **Decal on HIGH/ULTRA:** the box edges stop it naturally, `normal_fade` keeps it off the sides. The decal origin is
    the disc centre and its size is 2.3R.
  - **Clipped quad below HIGH:** the clip polygon is the face rectangle it already computes.
  - Needs one small API on the puddle owner later (do not add it now; other agents are editing that file):
    `set_puddle_shape(handle, centre, radius, fade)` plus a flag "owned by SpillSystem" so `_step_puddles` does not grow
    or evaporate it a second time. Merging stays as today: a landing near an existing puddle on the same face adds to it.

## 5. Idle cost and tiers

States per spill (implemented in the prototype):
- **ACTIVE:** every physics tick.
- **CREEP:** total edge flow < 0.05 ml/s and spreading < 1 mm/s. The spill is stepped at 1 Hz with dt = 1 s (stable,
  because every update is capped). It freezes after 60 s of creep.
- **FROZEN:** no processing. The decal or quad is static. Evaporation and stain darkening of frozen puddles run in one
  shared 0.2 Hz sweep (≤ 24 entries) or are folded into the next wake.

Adding liquid sets the spill back to ACTIVE. SpillSystem disables `_physics_process` when no spill is ACTIVE or
CREEPing; the prototype `Runner` verifies this with 0 calls over 60 frames at rest. The slow t^(1/8) tail of viscous
spreading can still be shown when frozen, by evaluating the closed form in the decal size tween (no CPU).

| tier | puddles | edge flow | sites, drips | strands, ropes | rivulets | crown, mist | glass film | budget per frame (Quest / desktop) | memory per active spill |
|---|---|---|---|---|---|---|---|---|---|
| ULTRA (opt-in flag) | SpillSurface + decal, foam/stain layers; desktop: optional GPU outline field | yes | 4 per edge, morphing beads | yes, floor coil | yes (box + bottle) | yes | yes | ≤ 0.6 ms CPU + 0.4 ms GPU / ≤ 1.0 + 1.0 ms (+0.1 ms GPU field) | ~2 KB (+40 KB GPU field) |
| HIGH | today's decals; SpillSurface only for overflow (no strands: ropes become drips) | yes | 2 per edge, plain droplets | rope tube only | box faces only | crown only | no | ≤ 0.3 / 0.5 ms | ~1.5 KB |
| MEDIUM | clipped quads; overflow as an event: excess over h_pin goes to 1 site that drips at a fixed rate | event | 1 per edge | no | no | no | no | ≤ 0.1 / 0.2 ms | ~0.5 KB |
| LOW | static quads (today) | no: excess is clamped (it stays) | no | no | no | no | no | ~0 | 64 B ledger |
| MINIMAL | 1 puddle (today) | no | no | no | no | no | no | 0 | 64 B |

Hard caps (ULTRA): 3 ACTIVE spills (beyond that the oldest goes to CREEP), 24 drip sites, 4 strand/rope tubes,
6 rivulets, 8 crowns, 64 mist quads. Distance and frustum: a spill more than 4 m from the camera or out of view runs at
MEDIUM logic, which uses the same ledger, so switching tiers never loses volume. ULTRA should be a **flag**
(`QualityTier.ultra_spills`, effective only at HIGH) instead of a new enum value: `QualityTier` (HIGH=0..MINIMAL=3),
`BottleBreakManager.Quality` and `BottleLiquid.quality` (3..0) are int-coupled, and renumbering would break callers.

## 6. Integration plan

### Files (new)
| file | class | role |
|---|---|---|
| `gameplay/godot/spill_liquids.gd` | `SpillLiquids` (static) | the table above, `derive()`, `from_info(extras)` mapping, register custom liquids |
| `gameplay/godot/spill_surface.gd` | `SpillSurface` (RefCounted) | the prototype model on PackedArrays: several puddles per face (merge), sites, strands, rivulet heads, states |
| `gameplay/godot/spill_system.gd` | `SpillSystem` (Node, `get_for(node)` like BottleBreakManager) | face cache, routing, ledger, tiers and caps, scheduling (ACTIVE/CREEP/FROZEN), signals |
| `gameplay/godot/spill_render.gd` | `SpillRender` | drips MultiMesh, rope/strand tube pool (shares `BottlePour.STREAM_SHADER` via a static getter), rivulet strips, crown pool, mist |
| `shaders/godot/spill_drip.gdshader`, `spill_crown.gdshader`, `spill_rivulet.gdshader` | | vertex-animated, no per-frame mesh building |
| `shaders/three/spill_system.js` | | three.js port (pure math + InstancedMesh), WebXR keeps ULTRA without the GPU field |
| `docs/spill_system.md`, `tests/spill_proj/` | | user doc, headless test (port of `tests/spill_research`) + max 2 screenshots |

### API
```gdscript
SpillSystem.get_for(node).add_liquid(pos: Vector3, normal: Vector3, volume_ml: float, liquid, velocity := Vector3.ZERO,
		hit := {}) -> int          # liquid = substance id String or BottleLiquid extras Dictionary; hit = the ray result if known
SpillSystem.add_rivulet(pos, normal, volume_ml, liquid, hit := {}) -> int    # wall hit / bottle side
SpillSystem.neck_drip(pour: BottlePour, volume_ml: float)                    # after stream_stopped (volume from the pourer's ledger)
SpillSystem.set_quality(tier: int, ultra := false)
SpillSystem.total_ml() -> float      # surfaces + edge beads + strands + falling; world_floor/evaporated statics like BottlePour
signal overflow_started(face_id, edge_world: Vector3, liquid_id)
signal dripped(pos: Vector3, ml: float, liquid_id)      # audio "drip" event hook
signal settled(spill: int)
```

### Call sites (changes for later agents; none are made now)
- `BottlePour._land()`: when `SpillSystem.enabled`, call `add_liquid(pos, n, ml - sml, _ctl._info, parcel_velocity, hit)`
  instead of `mgr.add_puddle`. Parcels need a liquid index (one more SoA `PackedInt32Array`) and the hit dictionary.
  Steep hits (n.y < 0.5) call `add_rivulet` instead of dropping straight to the floor. Splash droplets stay as they are.
- `BottleBreakManager._step_droplets()` / `splash()`: landing goes to `SpillSystem.add_liquid` (ULTRA/HIGH). Wall hits
  call `add_rivulet` instead of `_kill_droplet` with volume lost. Droplets need a liquid id (per-instance custom data).
- `BottlePour.stream_stopped`: `SpillSystem.neck_drip(self, min(0.3, last_film))`. The volume comes from the pourer's
  `body.fill` so the ledger stays exact.
- `BottleLiquid`: expose `_info` (extras) read-only as `info` for `SpillLiquids.from_info`.

### Volume conservation
Each ml lives in exactly one place:
container `fill` → parcel (`in_flight_ml`) → droplet (`_dvol`) → SpillSurface puddle / edge bead / strand / rivulet head
/ falling → floor SpillSurface or `world_evaporated_ml` (mist, evaporation).

- `BottlePour.world_puddle_ml` stays the counter for "landed on the world".
- `SpillSystem.total_ml() + world_evaporated_ml` must equal it.
- Global test invariant: Σ containers + in flight + droplets + spills + evaporated = constant (prototype holds it to 1e-11 ml).
- Drops are handed to `emit_droplet` with their volume, and come back through `add_liquid` when they land.

### Staged implementation (sizes for later agents)
| stage | content | size | done when |
|---|---|---|---|
| S1 | SpillLiquids + SpillSurface (port the prototype; rotated boxes through `_box_top_rect`; several puddles per face) + SpillSystem ledger, states, caps; headless test | M (~450 lines) | this prototype's 20 checks pass on the real classes; 0 calls at rest; ≤ 0.15 ms/step per spill |
| S2 | rendering: decal or quad driven by SpillSurface, drips MultiMesh with neck morph, rope/strand tubes; BottlePour/BreakManager call sites | M (~350) | 2 screenshots (water curtain, honey strand); ledger closes across pour → floor |
| S3 | rivulets: box side faces + bottle exterior (profile table) + neck drip; wall hits are no longer lost | M (~300) | rivulet stops by volume budget; bottle-side rivulet follows a tilted bottle |
| S4 | splash crown (K rule), mist, buckling mound | S (~150) | water splashes, honey does not (K test) |
| S5 | glass film shader (Jeffreys film, wine legs); coordinate with the glass shader owner | S (~120) | 0 extra draws; uniform-only |
| S6 | tiers, ULTRA flag, distance downgrade, Quest profile, three.js port | M (~500 JS) | budgets in §5 measured on Quest |
| S7 (optional) | GPU height-field outline layer, desktop ULTRA only | L | only if S2 visuals are judged insufficient |

## 7. Prototype results (`tests/spill_research`, 2026-10-04)

Scene: a 24 x 24 cm shelf (BoxShape3D, top at 0.9 m) over a floor. 200 ml poured 3 cm from the +x edge at 25 ml/s.
300 s at 60 Hz. Columns: first overflow (s); drops; mean drop interval (s); strand time (site-seconds); rope time (s);
t½ = seconds from the first overflow until half the floor volume has arrived; R = puddle radius; floor ml; settle time
(s); rays per spill; average and maximum step time (us).

| liquid | overflow | drops | interval | strand | rope | t½ | R at 5 s (cm) | final R (cm) | floor ml | settles | rays | avg / max us |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| water | 7.4 | 168 | 0.038 | 0 | 0 | 2.3 | 20.0 | 24.7 | 18.5 | 17.5 | 5 | 54 / 135 |
| beer | 0.8 | 1917 | 0.010 | 0 | 0 | 6.4 | 18.1 | 24.7 | 118.7 | 30.5 | 5 | 45 / 148 |
| milk | 2.9 | 1444 | 0.012 | 0 | 0 | 5.0 | 18.8 | 24.7 | 89.8 | 22.7 | 5 | 56 / 178 |
| spirits | 0.1 | 2039 | 0.022 | 0 | 42.8 | 6.2 | 15.0 | 18.7 | 171.6 | 51.3 | 4 | 37 / 137 |
| olive oil | 0.3 | 48 | 3.7 | 1071 | 47 | 6.5 | 9.5 | 13.6 | 177.1 | 225.5 | 3 | 39 / 134 |
| syrup | 1.1 | 0 | - | 119 | 0 | 6.4 | 11.0 | 18.5 | 64.4 | 51.0 | 4 | 25 / 168 |
| honey | 0.8 | 0 | - | 265 | 13.6 | 6.7 | 7.0 | 11.0 | 101.8 | 53.2 | 2 | 95 / 405 |

Checks (all pass):
- Volume is conserved for all 10 liquids (max error 1.2e-11 ml).
- Water overflows and drips (168 drops). Water stays pinned until the shelf holds h_pin: 20.2 ml went over the edge
  against a predicted 21.9 ml.
- Honey goes over the edge as a strand (265 site-seconds) and never drips in 300 s; water never forms strands.
- Honey spreads slower: R at 5 s is 7.0 cm against 20.0 cm for water.
- Edge flux at 1 mm excess, per 10 cm of edge: water 4.95 ml/s, honey 0.32 ml/s.
- Every liquid settles within 300 s. Rays per spill ≤ 5, none per step. The runner stops processing at rest.
- Option (a) cost probe: GDScript virtual-pipe grid 32x32 = 0.74 ms/step, 64x64 = 3.0 ms/step (dev PC).

Known model limits, to fix in S1/S3:
- **The puddle is a disc with uniform thickness.** A honey mound near an edge therefore overflows as a rope during the
  pour. That is plausible, but more volume goes over (102 ml) than for water (18 ml), because water spreads over the
  whole shelf before the pin height is reached. Fix: a mound profile `h(r) ∝ (1 − r²/R²)^(1/3)` for the edge thickness.
- **No momentum overflow.** Water poured fast near an edge partly shoots straight over. Add a landing rule: a fraction
  `clamp(1 − d_edge / (0.5 v_impact · 0.1 s))` goes directly to the nearest site.
- **Order-of-magnitude constants.** The jet, strand, creep and pin constants, and the `μ ← viscosity` mapping, still
  need tuning by eye. All are per-liquid data, not code.
