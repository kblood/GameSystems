# BlenderShared

## GameSystems

Reusable gameplay extensions now live in `extensions/`: bottles/liquid, grasp, avatar/characters, mechanics, electricity,
material reactions, thermal/fire, tools/assembly and room acoustics. The existing `host` manages lifecycle, events and quality.
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
