# Bottle breakage (Godot 4.7, GDScript)

Files: `bottle_break_profile.gd` (force model), `breakable_bottle.gd` (RigidBody3D), `bottle_break_manager.gd` (pools + tiers),
`bottle_shard_source.gd` (real `_shards.glb` / `_broken.glb`, placeholder fallback), `bottle_lut.gd`, `fast_impact.gd` + `path_predictor.gd`
(fast movers), `bottle_break_bench.gd`. Needs `bottle_liquid.gd` and the `export/bottle_*` assets next to the scripts (see `tests/godot_break/sync.sh`).

## Use
```gdscript
var b := BreakableBottle.create("wine", 0.6, "res://")   # add_child it, then it is a normal RigidBody3D
b.broke.connect(func(pos, energy, kind): ...)            # kind: shatter / neck_snap
b.apply_impact(point, normal, impulse_Ns, {"mass": 2.0, "speed": 6.0, "surface": "wood"})
b.hit_by_projectile(point, dir, 500.0, 0.009)            # J, caliber m
FastImpact.fire(space, from, dir, 500.0, 0.009, mask)   # hitscan / ballistic, multi-bottle, energy reduced per bottle
FastImpact.step_thrown(rigid_body, delta, mask)          # call each physics step for fast non-bottle bodies
BottleBreakManager.get_for(self).set_quality(BottleBreakManager.Quality.LOW)   # ONE setting, runtime switchable
```
Surface of a collider: meta `break_surface` (concrete, stone, metal, tile, glass, wood, plastic, dirt, character, carpet), optional `break_sharp`.

## Realism tiers (headless, 10 half-full wine bottles shattered at once, 240 frames; rendering not included)
| tier | shards | droplets | puddles | per-shard physics | cost ms/frame (peak) |
|---|---|---|---|---|---|
| HIGH | full set (~15/bottle, cap 150) | 192 | 24 growing | until rest 3 s, then frozen | 2.0 (25) |
| MEDIUM | half, largest kept (cap 80) | 96 | 12 | same | 1.6 (13) |
| LOW | ~5 big (cap 24) | 32 | 6 static | frozen after 1 s | 0.20 (8) |
| MINIMAL | none (bottle vanishes, neck pops) | 12 | 2 | none | 0.02 (2.5) |
Breaks farther than `far_distance` (25 m) or outside the camera frustum use MINIMAL automatically (0.05 ms/frame, 10 bottles).
Idle: intact sleeping bottles run no scripts (`_physics_process` off, liquid `_process` off 2 s after sleep); manager is off with no debris.
Fatigue (crack accumulation) only in HIGH/MEDIUM.

## Fast movers
`PathPredictor` caches the analytic ballistic path and re-sweeps only if velocity deviates from v0+g*dt (collision, impulse, grab) or
`PathPredictor.targets_changed()` / `invalidate()` is called. Bottles use the prediction's pre-solver speed for the break check and
fall back to assessing it themselves if the engine contact never arrives. Note: the glass system's `predict_crossing` was not present
in the tree when this was written; `FastImpact.predict_crossing(body_or_dict, dt, mask, ...)` follows the requested naming.

## Nightfall adoption (no change made to that project)
`NightfallGrabbable` (layer 9, mask 11, continuous_cd, contact_monitor) keeps working: either make it extend `BreakableBottle` (same
layers/CCD are already defaults), or forward its `_integrate_forces` and `receive_ballistic_hit(at, dir)` (already aliased) to a child
BreakableBottle. Call `set_held(true, hand_body)` on grab (hand bodies in group `bottle_hands` are ignored as strikers), `set_held(false)` on release.
Shards use layer 1<<19 / mask 1 so they never block the player. Route the `shattered` signal from `broke`.

## Tests
`godot --headless --path tests/godot_break --fixed-fps 60 -- --calibrate | --bench | --fast`; `-- --shots <dir> --only ABCDE`.
