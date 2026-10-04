
## Containers (non-lathe) - `scripts/containers.py`

Same node conventions as the bottles (1 unit = 1 m, base centre at the origin, +Y up in glTF). Fill tables are LUT v2
(`docs/liquid_lut_v2.md`). Rebuild: `blender.exe -b --python scripts/containers.py -- [names]` (also writes LOD1 meshes and the
mid/low table tiers); `python scripts/containers.py --bottles` writes v2 sidecars for the lathe bottles.

| asset | nodes | material | capacity | height | opening | tris LOD0 / LOD1 |
|---|---|---|---|---|---|---|
| `container_square` rounded-square gin bottle, T-cork | Glass Liquid Cap Label | glass | 693 ml | 24.2 cm | capped | 2720 / 1360 |
| `container_hipflask` curved flat glass flask, metal cap | Glass Liquid Cap | glass | 287 ml | 16.2 cm | capped | 4868 / 2516 |
| `container_jerrycan` fuel can, grab handle + spout | **Body** Handle Cap Liquid | opaque plastic, no Glass node | 15.7 L | 40.9 cm | spout (capped) | 2884 / 1904 |
| `container_tumbler` whisky tumbler, thick base | Glass Liquid | glass | 232 ml | 9.7 cm | open | 2120 / 1056 |
| `container_mug` mug with C-handle | **Body** Handle Liquid | opaque ceramic | 368 ml | 9.5 cm | open | 3660 / 2088 |
| `container_tank` aquarium, black frame | Glass Liquid Frame | glass | 57.4 L | 35.2 cm | open | 312 / 312 |

Files per container: `export/container_<n>.glb` (+ `_lod1.glb`), `export/container_<n>.liquid.json` (+ `.mid.json`, `.low.json`),
`src/container_<n>.blend`. Opaque containers have no Glass node: draw `Body` (+`Handle`) opaque; the liquid is only visible through the
open top (mug) - the jerry can liquid is hidden by design (use the LUT for weight/slosh/pour logic). The `Liquid` mesh is the closed
interior (0.4 mm inside the wall) cut by the same world-fixed plane shader as the bottles (back faces show the surface).
Spill: see `docs/liquid_lut_v2.md` (`rim_points`, `open_height`, `spill()`).
Accuracy: volume error vs brute-force voxels < 1 % (high tier) for all of them; tiers in the spec.
Visual check: `node tests/containers_shot.mjs` -> `tests/out/containers_sheet.png` (`--lod` for the LOD1 meshes).
