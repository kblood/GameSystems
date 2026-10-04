# three.js liquid parity + volume check (handoff)

## shaders/three/bottle_liquid.js (rewritten, HIGH tier only)
Port of shaders/godot/bottle_liquid.gd + .gdshader (Godot files untouched).
- `setupBottleFromUrl(root, glbUrl, opts)` (async): data order `<glb>.liquid_v2.json` -> `<glb>.liquid.json` -> GLB `extras.liquid`.
  `setupBottle(root, { info })` is the sync variant (explicit info, else extras). Decoding is always `makeLut()` from liquid_lut_v2.js (v1 and v2 tables, bottles and containers).
- Open containers (`info.open`, `capOpen`, or `closed_by` with the `Cap` node removed/hidden) use `lut.spill()`; result in `b.lastSpill`.
- Bubbles (3 rising shells + glass-wall bubbles), foam head (cellular, volume-kept via LUT area), surface foam/ripples, Beer-Lambert body, flow frame parallel transport, slosh spring, agitation/foam build-up: same constants as Godot.
- `flip_faces` auto-detected from the signed volume of the Liquid geometry.
- Sleep: when at rest (same rules as Godot: no fizz, no foam/agitation, slosh settled) `update()` returns at once; every 0.1 s it compares `matrixWorld`, open state and fill and wakes on change. Setters (`fill`, `slosh`, `bubbles`, `carbonation`, `capOpen`) wake it. `b.agitate(a)` injects a shake.
- Lower tiers: add a `TIER_DEFINES` entry and `#ifdef` the cheaper paths in `LIQUID_FRAG`; `quality` != 3 renders HIGH for now.
- Differences: Godot BACKLIGHT approximated by extra emission; `uTime` (surface ripples) stops while asleep (Godot's TIME keeps going). Glass keeps its GLB material (no bottle_glass port); Glass meshes get `renderOrder = 1`.
- Missing sidecars log harmless 404s in the browser console.

## Tests: tests/three_liquid (`node tests/three_liquid/run.mjs`)
8 assets (wine/beer/soda/whiskey v2 sidecars, v2/bottle_champagne v1 sidecar, square/hipflask/tumbler) at tilts 0/45/90/180, oblique, shaken; 3 close-ups. Viewed: shot_1, shot_3, shot_4, shot_5, close_0..2. Levels, spill (tumbler empties sideways/upside down), bubbles, foam head all render. Idle: non-fizzy bottles do 0 work frames in 10 s; fizzy ones stay awake (as in Godot). Not verified: flip_faces on a truly inverted mesh (none in the set), real GPU, pixel parity against Godot.

## Volume discrepancy (tilt 90, -2..+5 %)
The bug was in the test, not the LUT. The old truth script summed a cap polygon using the cut points in list order, which flips the edge direction for some clip cases. tests/lutint_volume.py now uses tetrahedra fanned from an apex on the plane, so the cap adds nothing. With that, tilt 90 errors are at most 0.03 % (v2 tables) and 0.45 % (bordeaux v1 table, within the documented v1 accuracy). No change needed in scripts/liquid_lut.py or liquid_lut_v2.gd/.js.
