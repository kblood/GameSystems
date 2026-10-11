# `gs_bottles` (Godot)

Reusable breakable-bottle and liquid core for Godot 4.7. The bottle is a normal
`RigidBody3D`; the consumer owns its grab/interaction adapter while each scene
owns its own `GSBottleBreakManager` pool. A consumer can create a bottle with
`GSBreakableBottle.create("wine", 0.6, "res://path/to/assets/")` and add it to
its scene.

Assets are provided by the game: `bottle_<name>.glb`, `bottle_<name>.liquid.json`
and optional shard/broken definitions. The source project has no bottle models
or liquid definitions in this addon.

The scripts are initially extracted from `gameplay/godot` and `shaders/godot`.
This is the portable core boundary; Nightfall-specific grab behavior, mission
ownership, asset paths, and quality selection stay in its adapter. Bottle breaking
uses Godot rigid bodies and deferred contact processing directly; a second physics
implementation would duplicate engine collision handling. `GSHost` extension,
quality, and `broken`-event integration remain follow-up work.

The `shaders/` directory must remain adjacent to these scripts. This addon does
not include the bench harness, which is a source-project tool rather than a
runtime dependency.
