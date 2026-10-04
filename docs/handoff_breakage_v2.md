# Handoff: breakage v2 (v2 bottles, containers, whiskey re-run)

## What was built (HIGH tier only)
- `scripts/fracture_glb.py` (Blender 5.2 headless): `blender -b -P scripts/fracture_glb.py [-- v2:bordeaux container:tumbler v1:whiskey ...]`
  (no args = all 27 targets). Produces per asset `<stem>_shards.glb`, `<stem>_broken.glb` (neck-snap variant, only bottles with a neck)
  and `<stem>_break.json`, then re-reads `catalog.json` and merges only `break_info` / `shards` / `broken` keys.
  - 20 v2 bottles (`export/v2/`), containers square/hipflask/tumbler/tank (`export/container_*`), whiskey re-run on the fixed lathe.
  - PET v2 (pet2l, pet500), mug (ceramic), jerrycan (plastic): no shards, `shatters:false` + `leak {ratio, hole_r_m}` -> dent, or leak through a hole.
  - break.json now carries `material, shatters, density_kg_m3, has_neck, zone_factor{base,body,shoulder,neck}, weak_zones, calibration{surface:concrete, fill:1, v_n:4.3}`.
- `bottle_break_profile.gd`: `apply_break_json` reads the above; `calibrate()` solves `f_crit_ref` so a full bottle hit mid-body on concrete
  at 4.3 m/s is the threshold (v1 wine: 4.37 m/s). `has_neck=false` assets never neck-snap. `shatters=false` -> DENT / PIERCE(leak).
  Optional `h.mass_scale` in `assess()` (default 1, unused by callers right now).
- `bottle_lut.gd`: reads LUT v2 (sphere_map) sidecars by delegating to `LiquidLutV2`.
- `breakable_bottle.gd` (small edits): opaque shells named `Body` (mug, jerrycan) are used when there is no `Glass` node; break.json /
  liquid sidecar loaded from `asset_dir`; leak hole radius from the profile; **slap-down fix**: the spin part of the pre-impact point velocity is
  weighted by the point effective-mass share `(1/m)/(1/m + (r x n) I^-1 (r x n))`. Without it a bottle tipping over from 0.38 m broke on its
  second (far-end) contact (decanter r=1.64, jerrycan leaked).

## Verified (tests/breakv2_proj, Godot 4.7.2, Jolt)
- `godot --headless --path tests/breakv2_proj res://test_break.tscn` -> `BREAKV2 RESULT fails=0 of 28`: every v2 bottle, all 6 containers,
  whiskey and wine break (or leak, if non-glass) on a 2 m drop onto concrete; none break or leak from a 0.3 m upright or 0.38 m sideways drop;
  real shards load with no errors (12-29 per asset). Critical speed is 4.30 m/s for all glass assets.
- Screenshots viewed: `tests/out/breakv2/01_v2_bordeaux_shatter.png`, `02_tumbler_shatter.png`, `03_mug_leak.png`, `04_whiskey_shatter.png`,
  `05_square_shatter.png` (`... res://test_break.tscn -- --shots <dir>`, not headless).

## Not verified / known gaps
- Tank (70 kg full) and the mug use the same 4.3 m/s calibration. That is not tuned against real data.
- No bullet / thrown-object tests and no fatigue tests for the new assets. Mason/milk/tumbler/tank have no neck, so they have no `_broken.glb`.
- Shards from a 2 m drop spread more than 1 m in 0.6 s (the burst may be too strong for big containers).
- The audio test only checks that `AudioHub.watch()` is attached to containers. No sound was heard.

## Needed from other owners
- **pour agent** `gameplay/godot/bottle_pour.gd:415`: `var period := 0.11 + 0.21 * body.fill` fails to parse (`body` has no type). Change it to
  `var period: float = ...`. My test project patches its own copy after each sync.
- **pour agent** `bottle_factory.gd`: `BottleFactory.spawn("container_<n>")` still returns a BottleProp. To make containers breakable, return
  `BreakableBottle` with `bottle_name=<n>` and `asset_dir` = the container folder. The test does this by hand (`test_break.gd::spawn`).
  Glass containers need break files named `bottle_<n>_*`; `tests/breakv2_proj/sync.ps1` renames `container_*` -> `bottle_*` when it copies.
- **audio**: containers emit the same `broke` / `leaked` / `impact_assessed` signals, so `AudioHub.watch(b)` works unchanged. Factory bottles
  are only watched when `opts.audio` is true. The mug (ceramic) could use its own "clunk" kind in `audio_hub.gd` (for example, map `DENT` on
  `material=="ceramic"`). Not done.

## Adding lower tiers later
Tier branching lives in `BottleBreakManager.reduce_defs(defs, frac)` (shard count) and `BreakableBottle.use_real_assets`. Lower tiers can pass
a smaller `frac` or procedural shards. Nothing here depends on tier, and idle cost is zero (impact work only runs on contact events).
