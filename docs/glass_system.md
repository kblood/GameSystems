# Glass pane damage system (Godot 4.7, GDScript)

Window, door, shop-front, car and security glass that can be shot, thrown at and leaned on. It runs on desktop without VR and is
cheap when idle. Code: `gameplay/glass/godot/`. Test project: `tests/godot_glass/`. Report: `gameplay/glass/docs/glass_calibration_report.json`.

## Files

| File | Role |
|---|---|
| `glass_profile.gd` (`GlassProfile`) | Material presets (annealed, tempered, laminated, wired, resistant) x thickness; JSON overrides |
| `glass_impact.gd` (`GlassImpact`) | Striker: mass, velocity, shape (point/edge/rod/ball/flat), hardness, radius, deform; presets bb..762, stone, brick, bottle, chair, hammer, punch_tool, fist, body |
| `glass_damage_model.gd` (`GlassDamageModel`) | Pure function `assess(profile, ctx, impact)`: outcome + hole/crack/crater sizes + residual velocity |
| `glass_fracture.gd` (`GlassFracture`) | Radial+ring crack pattern, Voronoi-free cell polygons, teeth, tempered dice, curved-surface mapping, slab meshes |
| `glass_crack_mask.gd` (`GlassCrackMask`) | CPU RGBA8 mask (R crack, G frost, B hole, A crater), max-blend painting |
| `glass_pane.gdshader` | Pane/shard shader: mask + 16 analytic hole descriptors (entry/exit craters, star), frost, crazing, bulge, wire, shade band, heater lines; optional screen refraction (`USE_SCREEN_REFRACTION`) |
| `glass_pane.gd` (`GlassPane`, StaticBody3D, @tool) | One pane: API, damage state, visuals, fracture, save/load |
| `glass_system.gd` (`GlassSystem`) | One per scene (auto-created): tiers, budgets, shard pool, granules (MultiMesh), particle bursts, bullets, thrown-body prediction |
| `glass_path_predictor.gd` (`GlassPathPredictor`) | Cached ballistic sweep per thrown body, plus a one-shot `predict_crossing()` |
| `glass_prefabs.gd` (`GlassPrefabs`) | House windows (single/casement/sash/IGU), IGU, 3 m shop front, glass door, windscreen, side and rear car windows, wired partition, teller window |
| `glass_audio_adapter.gd` (`GlassAudioAdapter`) | Maps system signals to `BottleAudio.play_event(kind, pos, energy, params)` |

## API

```gdscript
var p := GlassPane.new(); p.size = Vector2(1.0, 1.2); p.glass_type = "annealed"; p.thickness_mm = 4.0; add_child(p)
p.hit_by_projectile(point, direction, energy_joules, caliber := 0.009, {speed, mass, bullet})  # -> result dict
p.apply_impact(point, normal, mass, velocity, shape := "ball", hardness := 1.0, {radius, contact, deform})
p.apply_contact(point, normal, impulse, striker_info)   # BreakableBottle.apply_impact-style signature
p.receive_ballistic_hit(at, direction)                  # Nightfall compatible (9 mm, 500 J)
p.impact_from_body(body, point, velocity, normal)       # predicted body contact: pass-through + residual
p.repair(); p.damage_percent(); p.get_damage_state() / p.set_damage_state(d)   # JSON-safe, replayed exactly
signal damaged(pane, point, outcome, energy); signal broke(pane, position, energy, kind)
signal pierced(pane, point, residual_velocity); signal impact_assessed(pane, info)
GlassSystem.get_for(node).fire_bullet(from, dir, energy, caliber, mask, speed=-1 (hitscan), max_range, exclude)
    # -> {hits:[{pane, point, result}], stop, energy, velocity}: every pane on the ray in order, continues with residual
GlassSystem.track(body) / untrack / predictor_for / invalidate_all()   # thrown bodies (pane sensors auto-track too)
```
The result dict contains outcome (NONE, CHIP, CRACKED, PUNCHED, SHATTERED), `outcome_name`, `pass_through`, `ricochet`,
`residual_velocity` (world), `hole_radius`, `crater_entry/exit`, `crack_length`, `radials`, `energy`, `energy_n`, `momentum`,
`thresholds`, `kind` (bullet, dice, punch, cobweb, collapse, shatter) and `tier`.

## Damage model

The model compares energy against thresholds. Effective normal energy is `E_n = 1/2 m v_n^2`, where `v_n` is the velocity along the pane normal. The thresholds are:

- `E_crack = crack_ref * (t/t_ref)^thickness_exp(2) * shape_factor * hardness^-0.5 * edge_factor * span_factor * flaw * (1 - weakening*D) * noise`
- `E_break = break_mult * E_crack` and `E_shatter = shatter_mult * E_crack`
- Projectiles: `E_perf = perf_ref * (t/t_ref)^perf_thickness_exp * (caliber/9 mm)`. A round passes when `E_n > E_perf` and keeps `sqrt(v_n^2 - 2 E_perf/m)` along the normal plus the tangential velocity. It is deflected by 0.6 to 5 degrees.
- Grazing hits with `cos < 0.26` and `E_n < 1.5 E_perf` ricochet.
- Tempered glass: any crack-level hit (`E_point` for point strikers, which is low) dices the whole pane. The edge zone is about 4x weaker.
- Laminated glass: a bullet makes a hole and nothing drops. A blunt impact over `E_crack` gives a cobweb, frost and a bulge. Over `punch_ref` the striker punches a flap (hinged at the top).
- Wired glass: like annealed, but the pieces are held by the wire.
- Resistant glass: rounds below `E_perf` are stopped (white splash plus radials), and `d_local += E/resist_capacity` until it is defeated.
- Cumulative damage D: each bullet adds `bullet_damage * clamp((E/(30 E_perf))^0.3, 0.6, 1.6)` (0.14 for annealed). Annealed glass collapses at D >= 1, which takes about 7 pistol rounds. Holes nearby also weaken the glass locally.
- Flaw: a seeded log-normal per pane (`pane_seed`, or a hash of the node path) with a 3% weak-pane chance. The per-hit rng is `hash(seed, hit_index)`, so outcomes are deterministic.

Default presets (reference thickness, centre of the pane):

| Type | Ref mm | Crack J | Perforate J | Notes |
|---|---|---|---|---|
| annealed | 4 | 2 | 15 | collapses after about 7 holes |
| tempered | 4 | 28 (point 0.18) | 4 | edge 0.22x, dices |
| laminated | 5 | 2.5 | 45 | punch 180 J, frost, holds |
| wired | 6 | 2.6 | 25 | punch 120 J, wire 12.5 mm |
| resistant | 30 | 60 | 2400 | capacity 3000 J, spall |

Calibration, from the 1.0 x 1.2 m pane centre. Critical speed is shown in m/s with energy in J in brackets.

| Type, mm | stone 0.2 kg crack / through | brick crack / through | bottle crack / through | body crack / through |
|---|---|---|---|---|
| annealed 4 | 4.2 / 5.6 | 1.3 / 1.7 (3.6 J) | 2.6 / 3.4 | 1.1 / 1.4 |
| annealed 6 | 6.3 / 8.4 | 1.9 / 2.6 | 3.8 / 5.1 | 1.6 / 2.1 |
| tempered 4 | 15.7 dice | 4.8 dice | 9.5 dice | 4.0 dice |
| tempered 6 | 23.5 dice | 7.2 dice | 14.3 dice | 6.0 dice |
| laminated 4 | 3.8 / 33 | 1.1 / 10 | 2.3 / 20 | 1.0 / 6.8 |
| laminated 6 | 5.6 / 45 | 1.7 / 13.5 | 3.4 / 27 | 1.4 / 9.3 |

Bullets at the default thickness:

| Type | 9 mm | 5.56 | 7.62 |
|---|---|---|---|
| annealed 4 mm | 9.4 mm hole, 27 mm exit crater, 0.23 m radials, 354 m/s left | passes | passes |
| tempered | dices | dices | dices |
| laminated | hole, nothing drops, 340 m/s left | passes | passes |
| resistant 30 mm | stopped, 7 rounds in one spot | stopped | defeats it |

## Realism tiers

There is one setting, `GlassSystem.tier`. With `auto_lod`, each hit uses a cheaper tier when it is far away: MEDIUM beyond 6 m, LOW beyond 15 m, MINIMAL beyond 40 m, and LOW when off-screen. The tier is chosen per hit, so idle panes cost nothing: no `_process` runs, which was measured on 80 of 80 panes.

| Tier | Visuals | Shards | Bullet hit cost | Brick shatter cost | Tempered dice cost | Worst frame after |
|---|---|---|---|---|---|---|
| HIGH | 384 px/m mask (0.88 MB for 1x1.2 m, 32 MB budget), true 2D fracture, teeth, physics shards (max 120), crazed clumps, granules 1600, optional refraction | about 68 per shatter | 2.9 ms | 12.0 ms | 1.1 ms (46 clumps + granules) | 3.6 ms (shard builds capped at 1.5 ms per frame) |
| MEDIUM | 192 px/m mask (0.22 MB), fewer and larger cells (radial x0.6), physics shards max 40 | about 33 | 1.2 ms | 6.7 ms | 0.3 ms (granules only) | 3.1 ms |
| LOW | no mask; analytic stars and craters (16 descriptors), cutout with a static teeth rim, CPU particle burst | 0 | 0.19 ms | 1.2 ms | 0.17 ms | under 0.1 ms |
| MINIMAL | analytic stars; broken pane disappears instantly | 0 | 0.17 ms | 0.13 ms | 0.11 ms | 0 |

Crack painting is time-sliced: 2.5 ms in the hit itself, then 1 ms per frame. Shard mesh and collider building happens under `build_budget_ms` (1.5 ms per physics frame). Shards freeze at rest, fade out after 10 s and are pooled. Granules are a single MultiMesh with a floor ray per granule at spawn. These numbers were measured on an RTX 3080 Ti desktop with a Windows CPU. Expect roughly 3x on Quest-class hardware, so use MEDIUM or LOW there.

## Fast objects: predicted crossings

- **Bullets**: `fire_bullet` uses a hitscan ray, or segments of 1/240 s with gravity when `speed > 0`. All panes along the ray are hit in distance order, and the bullet continues with the residual velocity or deflection. A non-glass collider stops it.
- **Thrown bodies**: `GlassPathPredictor` caches the analytic path `p(t)`, which includes gravity and linear damping (`v(t) = (v0 - g/k) e^-kt + g/k`). The path is swept once with sphere `cast_motion` over a 1.5 s horizon in 1/30 s segments against the pane layer (1<<20).
  - Each physics step only compares the body's velocity with the predicted one. A deviation greater than 0.05 m/s + 1% of speed triggers a recompute. Leaving the horizon extends the sweep, which is counted separately.
  - Bodies slower than 2 m/s do no prediction.
  - The crossing fires 1.5 steps early through `pane.impact_from_body`. If the glass fails, the body gets a collision exception for 0.6 s and its residual velocity; otherwise the engine bounces it.
  - `continuous_cd` is switched on as a fallback.
  - Pane sensors (an Area3D with a 0.6 m margin) auto-track bodies; `GlassSystem.track()` covers very fast bodies.
  - Call `invalidate()` or `invalidate_all()` after moving panes.
- `GlassPathPredictor.predict_crossing(body_or_ray, dt, mask, exclude, lookahead, gravity)` is a one-shot test. It uses the same keys as `FastImpact.predict_crossing`.

Randomised trials: 1000 each, on a 4 mm annealed pane at 60 Hz.

| Case | Hits | Miss | Tunnel | Notes |
|---|---|---|---|---|
| 7 g bullet, 350 m/s, 0 to 20 degrees | 1000 | 0 | 0 | all pierce; contact error up to 2 mm |
| 7 g bullet, 350 m/s, 76 to 82 degrees | 1000 | 0 | 0 | all ricochet |
| brick, 15 m/s, normal / 60 to 70 degrees | 1000 / 1000 | 0 | 0 | 2 path solves per throw (throw + after passing) |
| bottle, 25 m/s, normal / 60 to 70 degrees | 1000 / 1000 | 0 | 0 | |

Recompute counts: free flight for 1 s takes exactly 1 path solve. A bouncing ball had 11 bounces (2 of them above 2 m/s) and needed 7 solves, because the predictor stops below 2 m/s and solves again when the ball speeds up.

Limits of the predictor:

- The sweep shape is a bounding sphere, so a long thin body (a plank or bottle) may register contact up to its radius early.
- Angular motion and lift are ignored. Area-damping overrides and forces such as wind or magnets cause deviation-driven recomputes.
- Moving panes need `invalidate_all()`.
- Contact on the far side of a 0.6 m sensor is only seen if the body was tracked.
- Speeds above about 1000 m/s should use `fire_bullet`.

## Integration

- **Bottles** (`gameplay/godot`): panes accept the bottle-style `apply_contact`. A `BreakableBottle` flying through a failing pane gets `apply_impact` with surface "glass", so it can break as well. Shards use layer 1<<19 like the bottle shards. Audio goes through `GlassAudioAdapter`, which maps events to these kinds: bullet_glass, clink, thud, shatter (sized by area), shard_settle.
- **Nightfall** (do not edit there; this is the adoption recipe):
  1. Copy `gameplay/glass/godot/*` into `res://addons/glass/`. Add one `GlassSystem` node (or let it auto-create). Set `tier = MEDIUM`, `use_refraction = false` (the project uses the mobile renderer) and keep `auto_lod`.
  2. `runtime/ballistics.gd` `shoot()` already calls `receive_ballistic_hit(end, direction)` on the first collider in mask 5. Panes are on layer 1, so that works as-is: a 9 mm, 500 J hit. For bullets that continue through glass, replace the ray with `GlassSystem.get_for(self).fire_bullet(origin, dir, 500.0, 0.009, 5)` and apply the guard damage to `result.stop`.
  3. Grabbables (layer 9, mask 11, throw speed capped at 9 to 12 m/s) collide with panes on layer 1. Either call `GlassSystem.track(body)` on release in `addons/nightfall_interaction`, or rely on the pane sensors. Set meta `glass_striker` ("bottle", "brick", "stone", "chair") or a dictionary.
  4. Panes are StaticBody3D, so the guard zones (layer 3) are unaffected.

## Placeholder vs real

- **Real**: the energy and threshold model with calibrated presets, true 2D fracture geometry, matching crack mask, tempered dice, laminated flap and bulge, prediction, save/load, tiers and budgets.
- **Placeholder**:
  - frames and seals are procedural boxes (there is no Blender `glass_assets.py`)
  - no dedicated glass audio samples (the bottle kinds are reused)
  - refraction is a single screen-texture offset
  - the dice are square-ish tiles
  - IGU panes are two independent panes (no gas or spacer physics)

## Known weaknesses

- On the HIGH tier, a brick shatter still costs about 12 ms synchronously (cells, slab mesh, trimesh). It should move to a worker thread or be split over 2 frames. MEDIUM costs 7 ms.
- The model is an engineering approximation, not FEM:
  - there is no stress-wave timing
  - span and edge factors are heuristic
  - the thresholds were checked against rule-of-thumb data, not measurements
- The broken-pane collider is a trimesh. Fast small bodies can catch on teeth.
- The LOW-tier hole is visual only: bodies pass through via a temporary collision exception.
- At most 16 analytic holes per pane. Older holes are baked into the mask, or dropped on LOW and MINIMAL.
- Curved panes support cylindrical bends only, and the curvature is assumed small.

## Tests

From `tests/godot_glass/` (run `bash sync.sh` first):
- `--script res://tests/compile_all.gd`: compile check of all files.
- `--script res://tests/test_glass_model.gd`: 24 unit tests.
- `--headless --fixed-fps 60 -- --calibrate <dir>`: 29 assertions, trials, tier benchmark and JSON report.
- `--rendering-driver vulkan [--rendering-method mobile] -- --shots <dir> [--only <type>|tiers]`: contact sheet at `tests/out/glass_sheet.png`.
- Interactive (no arguments):
  - LMB shoots, RMB throws
  - 1 to 0 select the pane; T thickness; C caliber; B throwable; +/- speed
  - G tier; M slow motion; R repair; N other side
