# Handoff: pour / empty system

Files (owned): `gameplay/godot/bottle_pour.gd` (new), `shaders/godot/bottle_liquid.gd` (signal `opened`, `drain_driven`),
`gameplay/common/bottle_factory.gd` + `bottle_binding.gd` (opts.pour, meta "pour", binding.pour). `breakable_bottle.gd`
needed no hook (pour reads `fill`, `ctl`, `state`; stops when state != intact). Test project: `tests/pour_proj`.

Verified (headless numbers, `pour_test.gd -- --numeric`, 0 fails):
- upright open tumbler/mug lose 0.000 ml over 5 s; resting containers: 0 pour nodes processing.
- full tumbler (232.5 ml) tipped 0->180 deg in 1 s: empty at 0.75 s, 232.5 ml on the floor.
- uncapped wine (704 ml) 100-180 deg: 100 ml in 0.70 s (glug limited, ~145 ml/s).
- wine -> empty tumbler: tumbler takes wine colour, fills to 232.5 ml, overflow + misses to puddles, error 0.000 ml;
  tumbler -> empty wine bottle: 72.9 ml in, 159.6 ml missed the 9 mm mouth onto the floor (realistic without a funnel), error 0.
- knocked-over dynamic mug spills into a puddle, ledger within 2%.
Screenshots viewed: tests/out/pour/01-07 (bottle into tumbler rising 7%->64%->100%, tumbler tipping/puddle, mug pour, stream close-up).

Not done / for others:
- Colour mixing of non-empty receivers (keeps its own colour). Liquid type/viscosity per liquid (cd, glug_k are per node exports).
- Flow rate is glug-limited at every tilt for narrow necks (no tilt dependence once the neck is submerged).
- Mug/tumbler stream at high flow can exceed `r_max` (14 mm) visually.
- demo/ sync: add `gameplay/godot/bottle_pour.gd` to demo/sync.ps1 (owner of demo). Puddle evaporation/merge not touched.
- Rigid body mass is updated via set_fill (breakable_bottle); BottleProp mass not updated.
