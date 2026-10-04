# Handoff: label/design system for the 20 v2 bottles + 6 containers

## Verified (HIGH tier only, Godot 4.7.2 Vulkan screenshots, viewed)
- All 26 designs build (`blender -b --python scripts/bottle_designer.py -- --v2 --containers`, HIGH) and load in `tests/godot_designs` (`run.ps1 -Shots -V2 -Containers [-NoImport]`). Shots: `tests/out/godot_designs_v2/`, sheets `tests/out/godot_designs_v2_sheet1..4.png` (front/side/back of every design), close-ups `tests/out/v2_close_sheet2.png`.
- No floating or clipping labels seen on the suspects: bordeaux capsule, champagne foil, pet500/pet2l/contour sleeves, decanter, roundflask, plus square/hipflask/jerrycan/mug/tumbler. (The white rectangle on the contour/pet sleeves is the nutrition panel printed in the sleeve texture, not a separate mesh.)
- `designs/godot/bottle_design.gd` works unchanged with v2 and containers: slot swap `set_label_image` returns ok on v2_longneck_lager (front), v2_milk_dairy (wrap), container_mug_diner (front); glass tint override applied (v2_cruet_oil `#8fc79a` shows on the Glass shader).
- All 20 v2 bottles and all 6 containers have >= 1 design. Container slots: `CONTAINER_SLOTS` + `rr_slot_geometry` (rounded-rectangle rings from `scripts/containers.py`, hip-flask bend) in `scripts/design_slots.py`; provider `container` (labels merged into the untouched `export/container_<n>.glb`, placeholder `Label` node unlinked). `designs/slots.json` regenerated (32 assets).
- Docs: `docs/bottle_designs.md` (providers, tier map, adding a provider, v2 + container slot tables), `docs/bottle_design.schema.json` (`asset`, `lod_paths`, `offset`, `scale`).

## Not verified / open
- MEDIUM/LOW/MINIMAL for v2 (built earlier for the first 12 only) and for containers: not rebuilt, not checked. Add tiers through the provider `tier_paths` + `build_design`.
- Tank shots are badly framed (camera fit); the tank labels are only seen at a distance. Jerrycan/tank have no Glass node (no glass override there).
- three.js `designs/three/bottle_design.js` not tested with v2/containers.
- The first Godot import run occasionally fails to import some new GLBs ("No loader found"); a second `--import` fixes it.
- `--slots` overview renders still cover only the v1 lathes.
