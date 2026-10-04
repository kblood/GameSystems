# Bottle library integration (Godot 4.7)

One demo project (`demo/`), one spawn API (`BottleFactory.spawn`), one quality setting (`QualityTier`). Glass panes are NOT part of this assembly.

## Architecture

```
            QualityTier (autoload) --tier_changed--> BottleBinding (child of every bottle)
              |  set_tier(HIGH..MINIMAL)                |  liquid.quality + lod_distances, label tier GLB, mesh LOD GLB
              |                                         |  hooks AudioHub.watch(body)
              +--> BottleBreakManager.set_quality       |
                                                        v
BottleFactory.spawn(id, opts) ---> BreakableBottle (RigidBody3D)  v1 / v2 / designs
   resolve(catalog.json)           |- model (GLB: Glass, Liquid, Cap, Label*)
                                   |- BottleLiquid (LiquidLutV2, bubbles, slosh, sleeps at rest)
                                   |- BottleBreakProfile (break.json, or generic_profile for v2/designs of v2)
                                   '- broke / impact_assessed --> AudioHub (autoload) --> BottleAudio.play_event
                              '- BottlePour child (stream, receivers, puddles; processes only while pouring)
BottleBreakManager (auto-created): shard pool, droplets, puddles.   FastImpact + PathPredictor: bullets / fast thrown bodies.
```

## Adding the library to a game
Run `demo/sync.ps1` (`powershell -NoProfile -ExecutionPolicy Bypass -File demo/sync.ps1 [-Import]`) or copy by hand:

| from library | to project |
|---|---|
| `shaders/godot/{bottle_liquid.gd,*.gdshader,liquid_lut_v2.gd}` | `res://` root (BottleLiquid preloads `res://bottle_liquid.gdshader`) |
| `gameplay/godot/*.gd`, `designs/godot/bottle_design.gd`, `audio/godot/bottle_audio.gd`, `gameplay/common/*.gd` | `res://lib/` |
| `catalog.json` | `res://assets/catalog.json` |
| `export/bottle_<n>*` (glb, liquid*.json, shards/broken/break.json) | `res://assets/v1/` |
| `export/v2/*` | `res://assets/v2/` |
| `export/container_<n>*` | `res://assets/container/bottle_<n>*` (renamed: BreakableBottle expects `bottle_<name>.glb`) |
| `export/designs/<d>{,_medium,_low,_minimal}.glb`, `<d>.liquid.json` (+ base shards/broken/break.json for v1 bases) | `res://assets/designs/bottle_<d>*` |
| `audio/wav/*.wav` | `res://audio/wav/` |

Autoloads: `QualityTier=res://lib/quality_tier.gd`, `AudioHub=res://lib/audio_hub.gd`. Run `godot --headless --path <proj> --import` after adding assets.
Project settings (needed): `physics/jolt_physics_3d/simulation/penetration_slop = 0.002`. With Jolt's default (0.02 m) every small resting body, glass bottle or plain cylinder, sinks 1 cm into the shelf and jitters forever and never sleeps. With 0.002 all 20 demo bottles sleep within 2 s (`godot --headless --path demo -- --rest` prints it). Also recommended: bottles on layer 4 (the factory default), shards on layer 20 with mask 1 (BottleBreakManager default), so shards never hit intact bottles.

## API
```gdscript
var b := BottleFactory.spawn("bottle_v2_bordeaux", {"fill": 0.7, "design": "v2_bordeaux_classic", "position": Vector3(0, 1, 0)})
add_child(b)
```
ids = catalog ids: `bottle_<v1>`, `bottle_v2_<name>`, `container_<name>`, `design_<name>`. `opts.design` replaces the id by that design (the base bottle's break data is used).
opts: `fill` (0.6), `tier` (-1 = follow QualityTier, 0..3 per-object override), `design`, `breakable` (true), `position`, `rotation_degrees`, `carbonation` (-1 = sidecar), `lod` (-1 auto, 0/1/2), `audio` (true), `seed`, `layer`/`mask`.
Returns `BreakableBottle` (containers too), with `model`, `ctl` (BottleLiquid), `fill`, `state`, `glass_node`; metas `bottle_info`, `binding` (BottleBinding: `tier_override`, `refresh()`); group `bottles`.
Other: `BottleFactory.refresh_all(tree)` (re-evaluate mesh LOD after the camera moved; the demo calls it every ~1 m), `BottleFactory.set_label_image(bottle, "front", png)`, `BottleFactory.generic_profile(info)`.

```gdscript
QualityTier.set_tier(QualityTier.LOW)   # HIGH, MEDIUM, LOW, MINIMAL; signal tier_changed(tier)
```
One call sets: BottleLiquid.quality 3/2/1/0 + its distance LOD cut-offs, BottleBreakManager.set_quality (shards, droplets, puddles, fatigue), the label tier GLB (high / medium / low / minimal), the mesh-LOD distances (v2 `_lod1/_lod2`, container `_lod1`). Event driven, no per-frame work. Per bottle: `opts.tier` or `binding.tier_override`.

Audio events (AudioHub -> BottleAudio.play_event): shatter (size from capacity) + delayed splash, neck_snap -> small shatter + cap_pop, plastic -> bullet_plastic, harmless impacts -> clink / thud (plastic: bounce / dent), bullet pierce -> bullet_glass / bullet_plastic. Direct: `AudioHub.play(kind, pos, energy, params)`.

Demo controls: WASD+mouse, LMB shoot (FastImpact), RMB/E throw held object or a brick, G grab (wheel or Z/X roll the bottle), 1-4 tier, R reset, F overlay, P pause. `godot --path demo -- --shots <dir>` writes the PNG sequence and quits.

## Which piece works for which asset (HIGH tier; lower tiers only where noted)

| | liquid | pour / empty | label design | break | audio |
|---|---|---|---|---|---|
| v1 bottles (6) | yes | yes (uncapped; `U` in demo) | yes, designs ship for all 12 v1 designs | real shards + broken neck | yes |
| v2 bottles (20) | yes | yes | yes, all 20 (+ tiers only for the first 12) | real shards (+ neck-snap), PET leaks / dents | yes |
| containers (6) | yes | yes (open ones pour at once) | yes, 6 designs, HIGH only (tier request falls back to HIGH) | glass: shatter; mug, jerrycan: leak / dent; BreakableBottle now | hooked, untested by ear |
| three.js | yes (`shaders/three/bottle_liquid.js`, HIGH only) | no | loader untested with v2 | no | no |

Demo extras: a pour bar (right of the shelves) with tumblers, mug, open wine + bordeaux, square flask, hip flask, jerrycan, diner mug. Keys: G grab, wheel / Z / X tilt, U uncap (held or aimed bottle), LMB bullet, RMB / E brick.
`demo/sync.ps1` now copies every catalog design (all tiers that exist, base shards / break.json under the design name), container break data, `bottle_pour.gd`. Run it, then `godot --headless --path demo --import` (a second import is sometimes needed for new GLBs).

## Puddles at surface edges

Puddles never hang over shelf, bar or table edges (`BottleBreakManager`, all tiers):
- **HIGH**: each puddle is a `Decal` projected downward (one procedural soft radial mask + wet ORM, tinted via `modulate`, grown via `size`). It stops at edges by itself; `normal_fade` keeps it off vertical sides. It paints only on render layers in `puddle_decal_cull_mask` (all except layer 20): put bottles / held props on render layer 20 to keep puddles off them. `puddle_decal_depth` (8 cm) bounds the projection box. Under the Compatibility renderer (no decals) HIGH uses the clipped quad below.
- **MEDIUM / LOW / MINIMAL**: a quad clipped to the surface. One downward ray at the centre finds the collider; a `BoxShape3D` top face is clipped analytically (Sutherland-Hodgman, exact, 1 ray), a `WorldBoundaryShape3D` is not clipped, any other shape probes 8 rays beyond the radius (+3 bisection rays per miss, max 33). Volume beyond the edge is simply not drawn.
- Clipping runs only when a puddle is created or outgrows its clipped area (30 % headroom), never per frame (`puddle_rays` counts them). Tier puddle limits are unchanged (24/12/6/2, oldest recycled); with no puddles the manager does no per-frame work.
- Test: `godot --headless --path tests/puddle_proj res://puddle_test.tscn` (add `-- --shots <dir>` for screenshots).

## Known gaps
- Pour: a non-empty receiver keeps its own colour (no mixing); very high flow draws a thinner stream than it should; jerrycan / tank / flasks as pourers not checked by eye; BottleProp mass is not updated by pouring (BreakableBottle is).
- Breakage: no bullet / repeated-hit tests on the new assets; the 70 kg tank breaks like a bottle (4.3 m/s calibration, untuned); shards from large containers may fly too far; the mug has no ceramic clunk sound.
- Labels / tiers: MEDIUM / LOW / MINIMAL label GLBs exist only for the first 12 v2 designs and v1 designs; others fall back to HIGH. The jerrycan and tank have no Glass node, so no glass tint override. three.js `bottle_design.js` untested on v2 / containers.
- Container designs are breakable only through their base's break data copied by sync.ps1 (shards of designs share the base mesh; label meshes are not shattered separately).
- Mesh/label LOD swaps replace the model GLB under the body (once per tier or LOD change; a bottle that already lost its neck keeps its model).
- Carbonated liquids keep `_process` running (fizz); still, non-carbonated liquids sleep. BottleAudio runs one `_process` for voice management.
- `BottleProp` is no longer used by the factory (kept for assets with no break data).

## Glass panes in the demo (`demo/main.gd`)

`sync.ps1` also copies `gameplay/glass/godot/*.gd|*.gdshader` into `demo/lib/glass/` (scripts and `glass_pane.gdshader` must stay together). `main.gd` creates a `GlassSystem` child (tier follows `QualityTier.tier_changed`, so keys 1-4 set it) and a `GlassAudioAdapter` (finds AudioHub's BottleAudio by class name).
Panes: house window (annealed 4 mm, 1.2x1.3 m) in the back wall at x=-2.9, y=1.45 (wall rebuilt as 4 segments around the opening, left of the shelves); free-standing annealed 6 mm shop front 1.6x2.2 m at (4.4, 1.16, 0.6) yawed -49 deg beside the bar; tempered 4 mm 1.0x1.2 m pane at (-4.0, 0.66, 1.0) (dice shatter). Panes carry `break_surface=glass` so bottles hitting them use the glass surface.
Hooks: LMB `shoot()` = `GlassSystem.fire_bullet` (world + panes) then `FastImpact.fire` per segment between panes and after the last pane with the residual energy (bottles behind a pane are hit); bricks and released/thrown bottles call `glass.track(body)` (pane sensors also auto-track); R calls `GlassSystem.clear_all()` + `GlassPane.repair()` on every pane. Idle: GlassSystem process/physics stay off until something is tracked or cracking.
Verify: `godot --headless --path demo -- --glass` (PASS/FAIL lines, add `--shots <dir>` for 3 screenshots); `-- --rest` unchanged.
Note: `FastImpact.fire` hitscan mode (muzzle_speed 0) can loop forever when the last segment is long (~500 m) and a bottle is hit (segment end rounds to the same float32 position, `travelled` never reaches `max_range`); the demo calls it with a muzzle speed of 1000 m/s instead. Fix in the library: accumulate `travelled` from the requested segment length.
