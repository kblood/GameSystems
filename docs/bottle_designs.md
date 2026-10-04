# Bottle designs and labels

A **design** (`designs/*.bottle.json`) = bottle + glass tint + cap + liquid + labels placed in standard **slots**.
`scripts/bottle_designer.py` (Blender, headless) builds it into `export/designs/<name>.glb` (+ `.design.json`, `.liquid.json`, `textures/`).
Schema: `docs/bottle_design.schema.json`. Existing `export/bottle_*.glb` and `scripts/bottles.py` are untouched; slots are generated from the same lathe profiles.

## Architecture

| piece | file |
|---|---|
| slot geometry (pure Python, follows the lathe profile) | `scripts/design_slots.py` -> `designs/slots.json` |
| design validation / label generation cache | `scripts/design_labels.py` |
| label art generator (Pillow, mm-based templates, ageing, wear masks) | `scripts/label_gen.py`, library in `labels/`, guides in `labels/templates/` |
| builder (Blender), tiers, catalog merge | `scripts/bottle_designer.py`, `scripts/design_glb.py` |
| runtime Godot / three.js | `designs/godot/bottle_design.gd` (`BottleDesign`), `designs/three/bottle_design.js` (`loadDesign`) |
| test viewers | `tests/godot_designs/` (`run.ps1 [-Shots]`), `tests/designs_test.html` + `tests/designs_shot.mjs`, `tests/designs_sheet.py` |

Build:

```
blender -b --python scripts\bottle_designer.py -- --all                 # HIGH
blender -b --python scripts\bottle_designer.py -- --all-tiers           # high,medium,low,minimal + tier_stats.json
blender -b --python scripts\bottle_designer.py -- designs\wine_classic.bottle.json --tier low
blender -b --python scripts\bottle_designer.py -- --slots               # slot overview PNGs tests\out\slots_<bottle>.png (v1 lathes)
blender -b --python scripts\bottle_designer.py -- --v2 --containers     # HIGH of designs\v2_* and designs\container_*
python scripts\design_slots.py                                          # rewrite designs\slots.json after slot edits
```

Tier files: `<name>.glb` (high), `<name>_medium.glb`, `<name>_low.glb`, `<name>_minimal.glb`. `catalog.json` gets `design_<name>` entries (family `bottle_design`, with a `tiers` map); it is re-read and merged on every write.

Orientation: front (angle 0) faces glTF +Z (Blender -Y); angles increase around the bottle axis; the seam of 360 deg wraps is at the back.

## Slots (mm; 0.35 mm above the glass; curve follows the profile)

| bottle | slot | kind | size WxH | arc | centre | default material | px/cm |
|---|---|---|---|---|---|---|---|
| wine | front | body | 85x105 | 130 | 0 | paper_matte | 80 |
| wine | back | body | 65x80 | 100 | 180 | paper_matte | 80 |
| wine | neck | neck | 69.5x39 | 200 | 0 | paper_gloss | 100 |
| wine | foil | band | 82x49 | 360 | 0 | foil_metal | 100 |
| beer | front / back | body | 85x90 / 68x70 | 150 / 120 | 0 / 180 | paper_gloss | 80 |
| beer | neck | neck | 43x26 | 200 | 0 | paper_gloss | 100 |
| beer | wrap | wrap | 204x110 | 360 | 0 | paper_gloss | 60 (overlaps front/back) |
| soda | sleeve | wrap | 204x183 | 360 | 0 | plastic_sleeve | 60 |
| soda | neck_seal | band | 88x12 | 360 | 0 | plastic_sleeve | 100 |
| whiskey | front / back | body | 76x90 / 64x60 | 120 / 100 | 0 / 180 | paper_matte | 80 |
| whiskey | neck | neck | 40x22 | 160 | 0 | handwritten_tag | 100 |
| whiskey | shoulder | shoulder | 69x39 | 140 | 0 | paper_gloss | 100 |
| jar | wrap | wrap | 276x68 | 360 | 0 | paper_matte | 60 |
| flask | tag | tag | 30.7x12.5 | 31 | 0 | tape | 150 |
| flask | tag_hand | tag | 44x37.6 | 48 | 58 | handwritten_tag | 100 |
| flask | grad | grad | 32.7x93 | 36 | -52 | clear_film | 100 |
| all | cap / lid | cap_top | disc, radius = cap radius (soda ~11 mm, jar lid 75 mm) | 360 | - | paper_gloss | 100-120 |

Exact values (z0/z1, arc, centre, `overlaps`) are in `designs/slots.json`. Each slot mesh carries `extras` `{slot,width_m,height_m,aspect,arc_deg,material_kind}`. Overlapping slots (`wrap` vs `front/back`) are rejected by validation.
Neck/foil/shoulder slots are unrolled cone sections, so art is slightly stretched toward the top; keep text away from the edges (the template guides mark a safe area).

## Assets and providers (v1 lathe, v2 bottles, containers)

A design names its base with `"asset"` (legacy `"bottle"` still works for wine/beer/soda/whiskey/jar/flask). `scripts/design_slots.py` maps the asset to a **provider** (`PROVIDERS`, `provider_of(asset)`, `slots_for(asset)`, `spec_for(asset)`):

| provider | assets | surface spec | base | tier map (label tier -> base GLB) |
|---|---|---|---|---|
| `lathe_v1` | wine, beer, soda, whiskey, jar, flask | lathe profile of `scripts/bottles.py` | `rebuild` (bottle rebuilt in Blender) | all tiers rebuilt |
| `lathe_v2` | `v2_<name>` (20 bottles) | ring-maximum envelope of the HIGH Glass mesh (`v2_envelope`), gated by `profile.json` | `glb`: labels exported alone and merged into the untouched `export/v2/bottle_<name>.glb` (`design_glb.merge_glb`) | HIGH = `bottle_x.glb`, MEDIUM = `_lod1`, LOW/MINIMAL = `_lod2` |
| `container` | `container_square/hipflask/jerrycan/tumbler/mug/tank` | rounded-rectangle rings from `scripts/containers.py` (`RRSurface`, hip flask with `bend_x` deform); round ones (tumbler, mug, tank) also go through it | `glb`, merged into `export/container_<name>.glb`; placeholder `Label` node unlinked (`drop_nodes`) | HIGH = `container_x.glb`, others = `_lod1` |

`"lod_paths": {"high": "...", "medium": "..."}` in a design overrides the tier map. **Only the HIGH tier is verified for v2 and containers** (Godot screenshots, `tests/out/godot_designs_v2_sheet*.png`); MEDIUM/LOW/MINIMAL builds exist for the first 12 v2 designs but are not maintained. To add a lower tier later: extend the provider's `tier_paths` and the tier branch in `bottle_designer.build_design`.

Container slot geometry (`rr_slot_geometry`): `arc` 0 means the slot is sized by width in mm along the ring perimeter; `centre` is the angle (deg) whose ray picks the perimeter start point (jerry-can `end` = 90, `panel` = 56.9 between the embossed X). Flat faces stay flat, corners wrap.

### Adding a provider

1. Write `my_spec(asset)` returning either `{"outer": [(r, z), ...]}` (surface of revolution) or `{"rings": [...], "deform": ...}` (rounded rectangles), and `my_tier_paths(asset, lod_paths)`.
2. Register it in `PROVIDERS` with `match`, `spec`, `tier_paths`, `base` (`"rebuild"` or `"glb"`), and for `glb` also `base_id`, `cap_type`, optional `drop_nodes`.
3. Add its slots (`S(...)` for lathes, `CS(...)` for ring surfaces) to `SLOTS`, run `python scripts/design_slots.py` (writes `designs/slots.json`), add a design, build, then shoot it in `tests/godot_designs` (`run.ps1 -Shots -V2 -Containers`).

### Slot tables (generated from `designs/slots.json`)
#### v2 bottles (provider lathe_v2)

| asset | slot | kind | WxH mm | arc | centre | material | px/cm | z mm |
|---|---|---|---|---|---|---|---|---|
| v2_bordeaux | front | body | 86x105 | 130 | 0 | paper_matte | 80 | 60-165 |
| v2_bordeaux | back | body | 66x80 | 100 | 180 | paper_matte | 80 | 70-150 |
| v2_bordeaux | neck | neck | 57x17 | 200 | 0 | paper_gloss | 100 | 232-248 |
| v2_bordeaux | capsule | band | 96x41 | 360 | 0 | foil_metal | 100 | 258-299 |
| v2_burgundy | front | body | 92x85 | 130 | 0 | paper_matte | 80 | 40-125 |
| v2_burgundy | back | body | 71x60 | 100 | 180 | paper_matte | 80 | 50-110 |
| v2_burgundy | neck | neck | 63x29 | 200 | 0 | paper_gloss | 100 | 215-243 |
| v2_champagne | front | body | 99x90 | 130 | 0 | paper_matte | 80 | 55-145 |
| v2_champagne | back | body | 76x65 | 100 | 180 | paper_matte | 80 | 65-130 |
| v2_champagne | neck | neck | 73x24 | 120 | 0 | paper_gloss | 100 | 185-208 |
| v2_champagne | foil | band | 128x58 | 360 | 0 | foil_metal | 100 | 226-283 |
| v2_longneck | front | body | 82x73 | 150 | 0 | paper_gloss | 80 | 35-108 |
| v2_longneck | back | body | 66x55 | 120 | 180 | paper_gloss | 80 | 45-100 |
| v2_longneck | neck | neck | 57x27 | 200 | 0 | paper_gloss | 100 | 163-190 |
| v2_longneck | wrap | wrap | 197x82 | 360 | 0 | paper_gloss | 60 | 30-112 |
| v2_stubby | front | body | 88x63 | 150 | 0 | paper_gloss | 80 | 25-88 |
| v2_stubby | back | body | 71x48 | 120 | 180 | paper_gloss | 80 | 32-80 |
| v2_stubby | wrap | wrap | 212x68 | 360 | 0 | paper_gloss | 60 | 22-90 |
| v2_growler | wrap | wrap | 317x78 | 360 | 0 | paper_matte | 45 | 30-108 |
| v2_growler | front | body | 97x70 | 110 | 0 | paper_matte | 70 | 35-105 |
| v2_growler | back | body | 79x50 | 90 | 180 | paper_matte | 70 | 45-95 |
| v2_swingtop | front | body | 78x85 | 130 | 0 | paper_gloss | 80 | 30-115 |
| v2_swingtop | back | body | 60x65 | 100 | 180 | paper_gloss | 80 | 40-105 |
| v2_swingtop | wrap | wrap | 217x92 | 360 | 0 | paper_gloss | 60 | 28-120 |
| v2_pet500 | sleeve | wrap | 207x94 | 360 | 0 | plastic_sleeve | 60 | 40-132 |
| v2_pet500 | front | body | 81x43 | 140 | 0 | paper_gloss | 80 | 49-92 |
| v2_pet500 | neck_seal | band | 99x13 | 360 | 0 | plastic_sleeve | 100 | 176-187 |
| v2_pet2l | sleeve | wrap | 325x172 | 360 | 0 | plastic_sleeve | 40 | 60-230 |
| v2_pet2l | front | body | 108x118 | 120 | 0 | paper_gloss | 60 | 80-198 |
| v2_contour | sleeve | wrap | 175x73 | 360 | 0 | plastic_sleeve | 60 | 58-128 |
| v2_contour | front | body | 46x32 | 100 | 0 | paper_gloss | 80 | 71-103 |
| v2_milk | wrap | wrap | 232x68 | 360 | 0 | paper_gloss | 50 | 30-98 |
| v2_milk | front | body | 97x70 | 150 | 0 | paper_gloss | 80 | 30-100 |
| v2_milk | back | body | 64x50 | 100 | 180 | paper_gloss | 80 | 40-90 |
| v2_whisky | front | body | 81x100 | 120 | 0 | paper_matte | 80 | 50-150 |
| v2_whisky | back | body | 67x80 | 100 | 180 | paper_matte | 80 | 60-140 |
| v2_whisky | neck | neck | 54x18 | 160 | 0 | handwritten_tag | 100 | 222-238 |
| v2_spirit | front | body | 76x135 | 120 | 0 | paper_matte | 80 | 50-185 |
| v2_spirit | back | body | 63x100 | 100 | 180 | paper_matte | 80 | 70-170 |
| v2_spirit | neck | neck | 50x22 | 200 | 0 | paper_gloss | 100 | 262-284 |
| v2_apothecary | front | body | 50x44 | 120 | 0 | paper_matte | 100 | 16-60 |
| v2_apothecary | back | body | 38x35 | 90 | 180 | paper_matte | 100 | 20-55 |
| v2_apothecary | tag | tag | 27x17 | 100 | 0 | handwritten_tag | 120 | 82-96 |
| v2_perfume | front | body | 45x28 | 90 | 0 | paper_gloss | 120 | 20-48 |
| v2_mason | front | body | 67x58 | 100 | 0 | paper_matte | 80 | 26-84 |
| v2_mason | back | body | 61x46 | 90 | 180 | paper_matte | 80 | 32-78 |
| v2_mason | wrap | wrap | 243x62 | 360 | 0 | paper_matte | 50 | 26-88 |
| v2_cruet | front | body | 56x42 | 100 | 0 | paper_matte | 100 | 20-62 |
| v2_cruet | neck | neck | 57x20 | 150 | 0 | handwritten_tag | 100 | 105-125 |
| v2_decanter | tag | tag | 35x24 | 100 | 0 | handwritten_tag | 100 | 176-200 |
| v2_decanter | front | body | 54x61 | 60 | 0 | paper_gloss | 80 | 40-95 |
| v2_erlenmeyer | front | body | 61x51 | 80 | 0 | paper_matte | 80 | 30-80 |
| v2_erlenmeyer | grad | grad | 20x97 | 30 | -50 | clear_film | 100 | 35-130 |
| v2_erlenmeyer | tag | tag | 24x12 | 40 | 38 | tape | 150 | 90-102 |
| v2_roundflask | tag | tag | 27x12 | 36 | 0 | tape | 150 | 33-45 |
| v2_roundflask | grad | grad | 20x44 | 30 | -50 | clear_film | 100 | 32-70 |
| v2_roundflask | tag_hand | tag | 28x29 | 40 | 50 | handwritten_tag | 100 | 40-66 |

#### containers (provider container)

| asset | slot | kind | WxH mm | arc | centre | material | px/cm | z mm |
|---|---|---|---|---|---|---|---|---|
| container_square | front | body | 50x88 | 0.0 | 0 | paper_matte | 80 | 28-116 |
| container_square | back | body | 46x64 | 0.0 | 180 | paper_matte | 80 | 40-104 |
| container_square | neck | neck | 47x14 | 200 | 0 | paper_gloss | 100 | 190-204 |
| container_hipflask | front | body | 64x66 | 0.0 | 0 | paper_matte | 80 | 20-86 |
| container_hipflask | back | body | 52x46 | 0.0 | 180 | paper_matte | 80 | 30-76 |
| container_jerrycan | panel | body | 46x110 | 0.0 | 56.9 | paper_gloss | 50 | 115-225 |
| container_jerrycan | end | body | 90x140 | 0.0 | 90 | paper_gloss | 50 | 100-240 |
| container_jerrycan | end_back | body | 90x140 | 0.0 | 270 | paper_gloss | 50 | 100-240 |
| container_tumbler | front | body | 63x56 | 100 | 0 | clear_film | 80 | 22-78 |
| container_mug | front | body | 86x58 | 120 | 0 | paper_gloss | 80 | 24-82 |
| container_mug | back | body | 86x58 | 120 | 180 | paper_gloss | 80 | 24-82 |
| container_tank | sticker | body | 100x60 | 0.0 | 55.7 | paper_gloss | 60 | 30-90 |
| container_tank | plate | tag | 140x20 | 0.0 | 0 | tape | 60 | 302-322 |

Designs per asset: container_hipflask: container_hipflask_engraved; container_jerrycan: container_jerrycan_fuel; container_mug: container_mug_diner; container_square: container_square_gin; container_tank: container_tank_aquavista; container_tumbler: container_tumbler_etched; v2_apothecary: v2_apothecary_tonic; v2_bordeaux: v2_bordeaux_classic; v2_burgundy: v2_burgundy_nocturne; v2_champagne: v2_champagne_brut; v2_contour: v2_contour_cola; v2_cruet: v2_cruet_oil; v2_decanter: v2_decanter_crest; v2_erlenmeyer: v2_erlenmeyer_lab; v2_growler: v2_growler_wrap; v2_longneck: v2_longneck_lager; v2_mason: v2_mason_preserves; v2_milk: v2_milk_dairy; v2_perfume: v2_perfume_atelier; v2_pet2l: v2_pet2l_cola; v2_pet500: v2_pet500_orange; v2_roundflask: v2_roundflask_lab; v2_spirit: v2_spirit_gold; v2_stubby: v2_stubby_stout; v2_swingtop: v2_swingtop_lemonade; v2_whisky: v2_whisky_cask


## Authoring a label

1. Open `labels/templates/<bottle>_<slot>_template.png` (guides: safe area, edge, centre line, orientation arrow, size in mm, target px).
2. Paint at the template size (`px = mm/10 * px_per_cm`), sRGB, **straight alpha**. Text upright in the template is upright on the bottle. Keep important content inside the safe area; 360 deg wraps meet at the back, so put no text across the left/right edge.
3. Reference it: `{"slot":"front","image":"labels/my.png"}`, optionally `"wear_mask":"labels/my_wear.png"` (G = roughness), `"material_kind"`, `"tint"`, `"rotation_deg"`, `"offset":[x,y]` (mm), `"scale"`. Or generate: `{"slot":"front","generate":{"template":"wine_classic", ...}}` (cached by spec hash in `labels/generated/`).
4. Build, then inspect in `tests/godot_designs`. No label: omit it (`wine_bare`); add `"spare_slots":["front"]` for an invisible placeholder that a runtime image can fill.

Runtime: Godot `bd.set_label_image("front", "res://x.png")`; three.js `await d.setLabelImage('front', url)`. The Godot viewer accepts a dropped image for the active slot.

## Resolution tiers per slot

| class | HIGH | MEDIUM | LOW (atlas share) |
|---|---|---|---|
| body 85x105 mm | 680x840 (80 px/cm) | 340x420 | 340x420 |
| neck / band / tag | 100-150 px/cm | max 512 | 256-512 |
| 360 wraps (200-280 mm) | 60 px/cm, e.g. 1224x660 | max 512 | needs a 1024 atlas |
| cap_top | 120 px/cm | 128-256 | 128-256 |

Guidance: author as PNG/JPG; ship as KTX2/BasisU (three.js `KTX2Loader`) or Godot VRAM compression (BPTC/S3TC desktop, ETC2/ASTC mobile) with **mipmaps on** (sources are non power of two; compressed formats want multiples of 4). sRGB for albedo, linear for roughness/wear. Memory estimate: RGBA8 = 4 B/px x 1.333 (mips); BC7/ASTC = about 1 B/px x 1.333. No normal maps are used (labels are flat; thickness is faked by the 0.35 mm offset).

## Realism tiers

| tier | content | slot swap | per-slot materials |
|---|---|---|---|
| HIGH `<name>.glb` | one mesh per slot, albedo + wear-mask roughness, foil/film/sleeve material kinds | yes | yes |
| MEDIUM `_medium.glb` | same meshes, albedo + roughness value only, textures capped at 512 px, no wear masks | yes | yes |
| LOW `_low.glb` | all labels baked into ONE atlas texture on ONE mesh (`Labels`, `extras.slots[slot].uv_rect`), tint pre-multiplied, alpha blended | no | no (foil/film/wear lost) |
| MINIMAL `_minimal.glb` | no label meshes, one tinted colour band (`Label_band`, 360 deg of the biggest slot), no textures | no | single colour |

Baking labels into the glass texture itself (an even lower tier) is **not implemented**. The atlas side is 512 or 1024 by content (wraps need 1024), so LOW can use MORE memory than HIGH for designs with a few small labels; prefer MEDIUM there.

Runtime tier swap: Godot `bd.set_tier("low")` or `BottleDesign.load_design(path, fill, true, "low")`; three.js `d = await d.setTier('low')`. Helpers `tier_path()` / `tierPath()`.

### Draw calls and texture memory (measured from the GLBs; `export/designs/tier_stats.json`)

Draw calls = mesh primitives (Cap, Glass, Liquid + label meshes). Texture KB = RGBA8 + mips / compressed (1 B/px) + mips.

| design | HIGH draws | HIGH KB | MEDIUM draws | MEDIUM KB | LOW draws | LOW KB | MINIMAL draws |
|---|---|---|---|---|---|---|---|
| wine_classic | 7 | 14370 / 3592 | 7 | 3808 / 952 | 4 | 5460 / 1365 | 4 |
| wine_reserve | 5 | 4720 / 1180 | 5 | 2221 / 555 | 4 | 5460 / 1365 | 4 |
| wine_bare | 6 (3 invisible) | 0 | 6 | 0 | 3 | 0 | 3 |
| beer_pale | 5 | 3132 / 783 | 5 | 1870 / 467 | 4 | 1365 / 341 | 4 |
| beer_wrap | 4 | 4213 / 1053 | 4 | 733 / 183 | 4 | 5460 / 1365 | 4 |
| beer_userimg | 4 | 2549 / 637 | 4 | 1288 / 322 | 4 | 1365 / 341 | 4 |
| beer_clearfilm | 4 | 2549 / 637 | 4 | 1288 / 322 | 4 | 1365 / 341 | 4 |
| soda_cherry | 6 | 7935 / 1984 | 6 | 1771 / 443 | 4 | 5460 / 1365 | 4 |
| soda_lime | 4 | 7022 / 1756 | 4 | 1224 / 306 | 4 | 5460 / 1365 | 4 |
| whiskey_tag | 6 | 4481 / 1120 | 6 | 2890 / 723 | 4 | 5460 / 1365 | 4 |
| jar_honey | 5 | 6451 / 1613 | 5 | 1698 / 424 | 4 | 5460 / 1365 | 4 |
| flask_lab | 6 | 3768 / 942 | 6 | 1789 / 447 | 4 | 5460 / 1365 | 4 |

MINIMAL texture memory is 0. GLB files are 0.3-2.4 MB, mostly the liquid LUT JSON in `extras`.

## Liquid settings: what the shaders cannot honour yet

`liquid` is written to `extras.liquid` (and `<name>.liquid.json`) like the existing bottles. Honoured today: color, fill, carbonation, foam capacity. Not honoured by `shaders/godot/bottle_liquid.*` / `shaders/three/bottle_liquid.js` (this system does not edit them):

| owner | field | needed |
|---|---|---|
| TODO(owner) | `viscosity` | slosh damping / ripple speed uniform |
| TODO(owner) | `opacity` | liquid alpha / transmission uniform |
| TODO(owner) | `foam` static head | foam layer height without a carbonation event |
| TODO(owner) | `tint_strength` | colour mixing vs refraction strength |
| TODO(owner) | `bubble_size` | runtime setter (currently read from extras at setup only) |
| TODO(owner) | `density` | `mass_kg()` uses a water-like default |

`BottleDesign.UNSUPPORTED` lists the same items.

## Fonts and licences

Label PNGs are rendered with Pillow from **Windows system fonts**, locally: Georgia, Times New Roman, Segoe UI, Impact, Bahnschrift, Segoe Script, Ink Free, Segoe Print, Gabriola, Consolas, Arial Bold. The fonts are NOT shipped or embedded, only the rasterised PNGs. The fonts are Microsoft-licensed: raster text in a product is generally allowed, but check the EULA for Ink Free, Segoe Script/Print and Gabriola before a commercial release, or re-render with OFL fonts (for example Playfair Display, Caveat, Oswald, JetBrains Mono) by changing the font table in `scripts/label_gen.py`. All brands, names and art are fictional and original (CC0 / MIT).
