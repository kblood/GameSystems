# Bottle liquid (Alyx-style fake liquid)

Each `export/bottle_*.glb` has nodes `Glass`, `Liquid` (closed interior), `Cap`, `Label`. No liquid geometry is
simulated: the engine shader discards the `Liquid` mesh above a plane that is fixed in WORLD space, so the level
stays horizontal at any tilt (sideways, upside down, diagonal). Volume is preserved via a table baked into
`Liquid` extras (`extras.liquid`, also `export/bottle_*.liquid.json`): `lut[cos_tilt][fill] = plane offset`.
Rebuild assets: `blender.exe -b --python scripts/bottles.py -- [wine beer soda whiskey jar flask]`.

## three.js  (`shaders/three/bottle_liquid.js`)
    const b = setupBottle(gltf.scene, { fill: 0.7 });   // once
    b.update(dt);                                       // each frame; b.fill = 0..1

## Godot 4  (`shaders/godot/`)
Copy `bottle_liquid.gd`, `bottle_liquid.gdshader`, `bottle_glass.gdshader` into the project (paths `res://`).
    var ctl := BottleLiquid.new(); bottle_root.add_child(ctl); ctl.setup(bottle_root, 0.7)   # then ctl.fill = ...
Godot drops KHR_materials_transmission, so the helper also replaces the Glass material with `bottle_glass.gdshader`.

## Notes
- Slosh = damped spring on the effective "up" vector, kicked by the bottle's acceleration; ripple on the surface.
- Uniform scale only. Fill is a fraction of the interior volume (0..1), capacity in `catalog.json`.
- Tests: `tests/shot.mjs <bottle>` (three.js, headless Chrome), `tests/godot/run.ps1` (Godot, needs import first).
