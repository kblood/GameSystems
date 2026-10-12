# `gs_bottles` (Godot)

Reusable breakable-bottle and liquid core for Godot 4.7. The bottle is a normal
`RigidBody3D`; the consumer owns its grab/interaction adapter while each scene
owns its own `GSBottleBreakManager` pool. A consumer can create a bottle with
`GSBreakableBottle.create("wine", 0.6, "res://path/to/assets/")` and add it to
its scene.

`GSBottleExtension.create_bottle()` returns `null` for non-finite fill, missing
model assets, or a parent outside the extension's scene scope. A valid parent must
be inside the active scene so tracking, events and the scene-owned break manager
share the same lifetime.

Assets are provided by the game: `bottle_<name>.glb`, `bottle_<name>.liquid.json`
and optional shard/broken definitions. The source project has no bottle models
or liquid definitions in this addon.

The scripts are initially extracted from `gameplay/godot` and `shaders/godot`.
This is the portable core boundary; Nightfall-specific grab behavior, mission
ownership, and asset paths stay in its adapter. Pour streams follow the liquid's
current distance tier and keep a per-pour quality ceiling; lower tiers use cached,
smaller tube meshes. Volume-carrying landing splashes keep the same cadence at every
visual tier so puddle accounting stays invariant. Bottle breaking uses Godot rigid bodies and deferred contact processing
directly; a second physics implementation would duplicate engine collision handling.
`GSHost` owns the scene-scoped manager, applies quality tiers, and forwards the
`broken` event.

The `shaders/` directory must remain adjacent to these scripts. This addon does
not include the bench harness, which is a source-project tool rather than a
runtime dependency.

`GSPourReceiver` adds host-owned spatial openings without bottle geometry. Set a
local disc radius/normal and `accept_ml(ml, liquid_kind, source)` callback; the
callback returns the actual accepted mL. Pouring selects the nearest unobstructed
opening in the same `World3D`, and rejected volume continues its real flight.
`GSBottlePour.liquid_kind` defaults to `unknown` and is captured per parcel;
mixed unlike contents become unknown. Hosts explicitly author fuel identity.
No bottle style or colour is automatically fuel. The independent physics suite
is `tests/gs_pour_receiver_tests.gd`; API details are in `docs/pour_system.md`.

`GSPuddleStore` now preserves explicitly authored component amounts through
puddle merges, ballistic splash delivery, consumption, evaporation and bounded
cleanup. Fuel/foam can persist beyond the legacy water/wine fade. The manager
offers manager checkpoints for puddles, airborne droplets and active HIGH
hole-stream transport. Pair that with each bottle's source checkpoint from the
same paused/fixed tick; restore the manager before restoring bottles so stream IDs
can be rebound to their source holes. These are component checkpoints, not a full
scene save. The typed withdrawal API is the future fire/sprinkler integration seam. Focused contracts:
`tests/gs_puddle_tests.gd`; details and source-accounting limits:
`docs/native_puddles.md` in GameSystems.
