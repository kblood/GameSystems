# BlenderShared

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
