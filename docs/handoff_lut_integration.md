# LUT v2 integration handoff (bottle_liquid.gd / bottle_liquid.js)
Status: Godot part DONE and tested; three.js part NOT STARTED (bottle_liquid.js untouched, old v1 behaviour).

## Done (shaders/godot/bottle_liquid.gd)
- LiquidLutV2 created once in setup(); lut.offset(up_obj, fill) replaces lut_offset (static lut_offset kept for compat).
- Data order: explicit sidecar -> <glb>.liquid_v2.json -> <glb>.liquid.json (mid/low first per table_tier / quality) -> GLB extras.
- v2 infos lack z0/z1: taken from bounds.min/max[1].
- Spill via lut.spill() only when is_open(): info.open, cap_open (default false), or closed_by set and Cap node removed/hidden. last_spill holds the result.
- Sleep: set_process(false) when still, slosh settled, no fizz (carbonation*bubbles>0.001 keeps it awake, bubbles animate with `rise`), no foam/agitation. 10 Hz Timer polls for movement/fill/open change and refreshes the LOD tier. Property setters (fill, slosh, bubbles, carbonation, cap_open, quality) call wake(). allow_sleep=false disables.
- Foam height scale recomputed only when (up, fill, open) change.
- table_tier export (-1 auto from quality at setup); lookup cost equal across tiers so no per-distance swap.

## Tests (tests/godot_lutint, tests/lutint_volume.py)
Godot runs OK for wine, whiskey, bordeaux, pet2l, hipflask, tumbler (sheet.png viewed, fills correct at 0/90/180; open tumbler empties sideways as spec). Sleep/wake/fill-wake verified.
Volume check: upright (3 fills) errors <=0.2%; tilt 180 <=0.06%; tilt 90 shows -2..+5% in lutint_volume.py -- UNRESOLVED: could be my truth script (cap area) or a real LUT issue; verify with tests/containers_lut_test.py before trusting.

## Left
- bottle_liquid.js: use makeLut(info) from liquid_lut_v2.js, same loading/sleep ideas; then a three sheet via tests/containers_shot.mjs approach.
- Note: export/v2/bottle_*.liquid.json are v1 tables (go through the v1 path).
