# BlenderShared

## GameSystems

New interactive demos: Blender-built [vehicle](webxr-demo/vehicle.html), [cameras/screens](webxr-demo/security.html),
and [fire station with refillable sprinklers](webxr-demo/fire.html).
Public APIs and limits: [vehicle](docs/vehicle_system.md), [cameras](docs/camera_system.md), [supply/sprinklers](docs/supply_sprinklers.md).
The [electricity system](docs/electricity_system.md) now includes finite network batteries, switchable wires and fuses;
the control-room demo connects its actual camera/display loads through a visible electrical cabinet.
The fire station also uses [pool interest](docs/pool_interest.md) to awaken retained liquid near heat without exceeding its simulation budget.
It now includes standalone [fire alarms](docs/alarm_system.md) and a [timed firefighting challenge](docs/mission_system.md)
with saved progress, difficulty and a protected room.

Reusable gameplay extensions now live in `extensions/`: bottles/liquid, grasp, avatar/characters, mechanics, electricity,
material reactions, thermal/fire, alarms, missions, supply/flow/pools, coatings, vehicles, cameras,
tools/assembly and room acoustics. The existing `host` manages lifecycle, events and quality.
See [new system ideas](docs/game_system_ideas.md) and [implementation/API/validation](docs/game_systems_implementation.md).
Run `webxr-demo` and open `/systems.html` for the maintenance workshop, or `/index.html` for the bottle demo.
Open `/fire.html` for a two-room firefighting prototype with bounded smoke, ventilation and persistent diesel pools;
see [fire system v2](docs/fire_system.md).

Reusable 3D assets for all game projects. Made in Blender (headless bpy scripts), exported as GLB.

- `src\`     .blend source files (one per asset family)
- `export\`  finished .glb files, ready to copy into projects
- `scripts\` bpy scripts that build the assets
- `catalog.json` list of assets (id, family, bounds, license)

## Conventions
- 1 unit = 1 metre, +Y up on export (glTF), -Z forward.
- Floor props: origin on the floor, centred. Wall props: origin on the mounting plane.
- PBR materials, GLB output, works in three.js and Godot.
- All assets original, MIT/CC0.
- Scratch work goes in `C:\Tools\BlenderWorkTemp`; finished results come here.
