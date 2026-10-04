# Bottle design review: v1 to v2

Scope: the v1 lathe bottles (`scripts/bottles.py` → `export/bottle_{wine,beer,soda,whiskey,jar,flask}.glb`), compared against real glassware, and the v2 family that replaces them (`scripts/bottles_v2.py` + `scripts/bottle_specs_v2.py` → `export/v2/`).
v1 is unchanged. v2 is additive, and the catalog ids are `bottle_v2_<name>`.

![before / after](../tests/out/bv2_before_after.png)

## 1. v1 critique

![v1 row](../tests/out/bv2_review_v1_row.png)
![v1 wine neck](../tests/out/bv2_review_v1_wine_neck.png) ![v1 beer base](../tests/out/bv2_review_v1_beer_base.png)

| Area | v1 state | Real-world reference |
|---|---|---|
| Silhouette | 10–14 point piecewise-linear profiles. Wine reads as a generic tall bottle, and soda reads as a water bottle. | Bordeaux: high, sharp shoulder. Burgundy: sloped shoulder. Longneck: long taper neck. Contour: waist plus flutes. PET: petaloid feet. |
| Facets | Up to 40–49° turn per profile vertex. The shoulders and heel show visible kinks, worst in silhouette and in reflections. | Glass is blow-moulded and continuous. |
| Proportions / capacity | Wine holds 868 ml at brim (should be 750 + headspace). Other capacities are also off. | Nominal fill sits 55–65 mm below the lip. |
| Wall | Constant offset of ~2.5–4 mm, with a flat thick base. | The heel and base are thick (4–8 mm), the body 2–3 mm, the neck 2–3 mm, and the lip thicker. |
| Base | Flat, no punt. | Wine and champagne have a deep punt. Beer has a stippled push-up. PET has 5 petaloid feet. |
| Finish | The lip is a cylinder step. No crown bead, no threads. | Crown finish with a bead. Screw threads with a transfer bead (bague). Cork bore. |
| Seams / wobble | None. The geometry is perfectly symmetric. | Mould seams, slight ovality and lean. |
| Caps | Plain cylinders. The cork is uniform beige. | Fluted crown, knurled ROPP, foil with pleats, T-cork, swing-top bail, wire cage. |
| Material | Transmission only. No IOR or volume extension. Labels are flat strips with a 300° wrap. | KHR_materials_volume plus IOR 1.5 gives thickness-dependent tint. |
| Tris / draw calls | 3.1–4.3k tris, 3–4 draw calls, 48 segments. | Fine for VR, but no LODs. |

### Top issues ranked by visual impact

| # | Issue | Fix cost | Status in v2 |
|---|---|---|---|
| 1 | Faceted, generic silhouettes | Cheap: spline profiles plus adaptive rings | Fixed: centripetal Catmull-Rom, Douglas-Peucker ring fit at 0.33 mm tolerance (HIGH) |
| 2 | Wrong archetype shapes (wine and soda not recognisable) | Cheap: better specs | Fixed: 20 reference-based specs; the 128 px silhouette strip below |
| 3 | Missing finish (bead, threads) and toy-like caps | Medium | Fixed: per-type finish profiles, helical geometric threads or normal-map threads, 13 cap builders |
| 4 | Flat base, no punt or petaloid | Cheap | Fixed: punt, push-up, petaloid; the liquid follows the punt |
| 5 | Uniform wall thickness, so the glass reads as plastic | Cheap | Fixed: per-section thickness, blended along arc length |
| 6 | Capacity errors (the LUT is fine, but the props are wrong size) | Cheap | Fixed: brim capacities within a few % of nominal plus headspace |
| 7 | No seams, stipple or wobble | Cheap (normal map) | Fixed: seams, stipple, waviness and gradations as a baked normal map; seeded ovality and lean |
| 8 | No glass volume or IOR | Cheap | Fixed: IOR, plus KHR_materials_volume at HIGH and MEDIUM |
| 9 | No LODs | Medium | Fixed: 3 tiers |
| 10 | Labels | Out of scope | Label owner: v2 exports `label_zone` / `label_panel` only |

## 2. v2 family

![HIGH row a](../tests/out/bv2_row_high_a.png)
![HIGH row b](../tests/out/bv2_row_high_b.png)

20 shapes:

| Group | Shapes |
|---|---|
| Wine | bordeaux, burgundy, champagne (cage) |
| Beer | longneck, stubby, growler, swingtop (bail) |
| Soft drinks | pet500, pet2l (petaloid), contour, milk (pleated foil) |
| Spirits | whisky (T-cork), spirit (ROPP) |
| Pharmacy / perfume | apothecary (cobalt), perfume (overcap) |
| Kitchen | mason (band + lid), cruet (pourer) |
| Glassware | decanter (glass stopper), erlenmeyer (graduations), roundflask (+ stand) |

Silhouettes at 128 px (all recognisable):

![silhouettes](../tests/out/bv2_sil_all.png)

Close-ups (crown finish, mason thread and band, swing-top, champagne foil and cage, erlenmeyer, apothecary):

![close-ups](../tests/out/bv2_closeups.png)

### Pipeline (`scripts/bottles_v2.py`, helpers `bv2_geom.py`, `bv2_caps.py`, `bv2_lut.py`)
1. **Profile.** Knots in mm, with section tags (`base`, `body`, `shoulder`, `neck`, `finish`). A `"c"` knot is a sharp corner. Sampled densely with centripetal Catmull-Rom.
2. **Inner wall.** Normal offset by `wall[section]`, gaussian-blended along arc length, with self-intersection loops removed. The liquid is the inner wall minus 0.4 mm.
3. **Rings.** Douglas-Peucker with a tolerance searched to fit the tier's triangle budget, then densified only inside feature zones (threads, bands, ribs, petaloid).
4. **Displacement.** Features add along-normal, radial or vertical displacement: band, panel, ribs, petaloid, helical thread, spout. Normal-map-only features: seams, stipple, gradations, waviness.
5. **Wobble.** Seeded by `crc32(name)`: ovality, low-frequency noise, and lean as a shear. Deterministic.
6. **LUT.** Computed from the actual liquid mesh: ray-cast point cloud, then a histogram. Same v1 format (33×64). Petaloid bottles average 2 azimuths.
7. **Caps.** Built per type: foil, wax, crown, screw, ROPP, T-cork, champagne, swing, milkfoil, mason, perfume, stopper, pourer, cork. Cap segments match the glass segments, with area compensation, so the cap never pokes through.
8. **Export.** Writes GLB, `.liquid.json` (identical to the extras), `.profile.json`, `src/v2/bottle_<name>.blend` and catalog entries.

Build time is ~2–5 s per bottle for all 3 tiers, and the output is deterministic. To build:

```
blender -b --python scripts/bottles_v2.py -- [names] [--tiers 0,1,2] [--no-catalog]
```

### Spec format (`scripts/bottle_specs_v2.py`, documented in its docstring)
| Key | Meaning |
|---|---|
| `outer` | Knots `(r_mm, z_mm[, "c"], section)` |
| `base` | punt / pushup / petaloid / none, with parameters |
| `lip` | Lip shape |
| `wall` | Thickness per section, plus `blend` |
| `glass` | Key into `GLASS` |
| `glass_options` | Colour variants: flint, green, deadleaf, champagne, amber, brown, blue, cobalt, aqua, PET, borosilicate. Build one with `name:variant` |
| `liquid` | v1 keys: color, carbonation |
| `closure_depth` | How far the closure sits into the neck |
| `cap` | Cap type and parameters |
| `features` | Feature list |
| `wobble` | Wobble parameters |
| `seg` | Segment counts `(HIGH, MED, LOW)` |
| `label_zone`, `label_panel` | Label areas, exported for the label owner |
| `stand` | Optional stand |

### GLB contents
| Node | Content |
|---|---|
| `Glass` | Glass mesh. Extras `bv2`: label_zone, label_panel, z_top, r_bore, glass |
| `Liquid` | Liquid mesh. Extras `liquid` in v1 format (version 1: n_cos, n_fill, capacity_ml, z0, z1, color, carbonation, lut, axis) |
| `Cap` | Closure |
| Optional | `Bail`, `Cage`, `GlassCap`, `Stand` |

There is no built-in label.

## 3. Realism tiers

| Tier | File | Glass / liquid / cap budget (tris) | Normal map | Notes |
|---|---|---|---|---|
| HIGH | `bottle_<name>.glb` | 4200 / 1100 / 1300 | 1024² | KHR_materials_volume |
| MEDIUM | `bottle_<name>_lod1.glb` | 1900 / 560 / 560 | 512² | About half the rings; threads as normal map; KHR_materials_volume |
| LOW | `bottle_<name>_lod2.glb` | 760 / 240 / 240 | None | No bands or panels. Bail and Cage merged into Cap; GlassCap merged into Glass |

The volume error is the tier mesh vs the HIGH mesh. The LUT fill error is the maximum over 9 poses of |volume below the LUT plane − fill·V|, using the shared HIGH LUT on that tier's own liquid mesh.

| Bottle | HIGH tris / dc / mat | MED tris / dc / mat | LOW tris / dc / mat | Vol err M / L % | LUT fill err H / M / L % |
|---|---|---|---|---|---|
| bordeaux | 5696 / 4 / 4 | 2464 / 4 / 4 | 968 / 4 / 4 | -0.10 / +0.57 | 0.84 / 0.79 / 1.56 |
| burgundy | 5472 / 4 / 4 | 2296 / 4 / 4 | 1024 / 4 / 4 | +0.03 / -1.51 | 1.41 / 1.20 / 1.86 |
| champagne | 6528 / 6 / 6 | 2896 / 6 / 6 | 1328 / 6 / 6 | +0.17 / -1.56 | 0.53 / 0.66 / 2.10 |
| longneck | 5871 / 3 / 3 | 2368 / 3 / 3 | 1016 / 3 / 3 | +0.21 / +0.64 | 0.90 / 0.81 / 0.64 |
| stubby | 5871 / 3 / 3 | 2432 / 3 / 3 | 976 / 3 / 3 | +0.39 / -1.38 | 1.44 / 1.39 / 2.03 |
| growler | 5776 / 3 / 3 | 2436 / 3 / 3 | 944 / 3 / 3 | -2.43 / -2.43 | 0.44 / 2.48 / 2.82 |
| pet500 | 7550 / 3 / 3 | 4460 / 3 / 3 | 1060 / 3 / 3 | -0.02 / -1.30 | 0.43 / 0.25 / 1.46 |
| pet2l | **11230** / 3 / 3 | 6460 / 3 / 3 | 1180 / 3 / 3 | +0.03 / +1.29 | 0.47 / 0.64 / 0.84 |
| contour | 5743 / 3 / 3 | 2560 / 3 / 3 | 976 / 3 / 3 | -0.00 / -0.82 | 0.28 / 0.28 / 0.93 |
| whisky | 5712 / 4 / 4 | 2560 / 4 / 4 | 976 / 4 / 4 | -0.18 / -0.40 | 1.02 / 0.79 / 0.63 |
| spirit | 5936 / 3 / 3 | 2520 / 3 / 3 | 912 / 3 / 3 | +0.24 / +0.23 | 0.42 / 0.28 / 0.56 |
| swingtop | 6600 / 5 / 5 | 2708 / 5 / 5 | 1156 / 5 / 5 | -1.10 / -1.21 | 0.46 / 1.35 / 1.45 |
| apothecary | 5472 / 3 / 3 | 2376 / 3 / 3 | 1004 / 3 / 3 | -0.00 / -0.28 | 0.48 / 0.39 / 0.48 |
| perfume | 5424 / 3 / 3 | 2560 / 3 / 3 | 976 / 3 / 3 | -0.16 / -1.52 | 0.73 / 0.65 / 1.59 |
| milk | 5820 / 3 / 3 | 2624 / 3 / 3 | 1040 / 3 / 3 | -0.40 / -1.13 | 1.42 / 1.56 / 2.03 |
| mason | 5616 / 4 / 4 | 2608 / 4 / 4 | 1056 / 4 / 4 | -0.15 / -0.15 | 0.89 / 0.95 / 1.15 |
| decanter | 5656 / 3 / 2 | 2448 / 3 / 2 | 1112 / 2 / 2 | +0.71 / +0.71 | 0.89 / 1.10 / 1.55 |
| cruet | 5928 / 5 / 5 | 2366 / 5 / 5 | 1062 / 5 / 5 | +0.31 / -0.65 | 0.39 / 0.76 / 1.03 |
| erlenmeyer | 5680 / 3 / 3 | 2520 / 3 / 3 | 960 / 3 / 3 | -0.26 / -0.32 | 0.40 / 0.50 / 0.88 |
| roundflask | 6696 / 4 / 4 | 3144 / 4 / 4 | 1048 / 4 / 4 | -0.69 / -1.43 | 0.49 / 0.99 / 2.39 |

The source data is in `tests/out/bv2_build_stats.json`; `tests/bv2_glb_stats.py export/v2/*.glb` re-checks it from the GLBs. KHR_materials_volume appears in the HIGH GLB's extensionsUsed.

![tiers](../tests/out/bv2_tiers.png)

## 4. Runtime verification
- **three.js** (`shaders/three/bottle_liquid.js`, harness `tests/bv2_bottle_test.html` + `tests/bv2_shot.mjs`): all 20 bottles at fill 0.6, tilt 0/90/180. The liquid plane is correct in every pose, including the punt, petaloid and spout bottles.

  ![three contact](../tests/out/bv2_contact_three.png)
- **Godot 4.7.2** (copy at `tests/godot_bv2`, unmodified `bottle_liquid.gd` and shaders): bordeaux, pet2l and swingtop imported without errors and captured with Vulkan.

  ![godot](../tests/out/bv2_godot_sheet.png)

## 5. Weaknesses / open issues
- **pet2l HIGH is 11.2k tris and pet500 is 7.5k**, over the ~6k budget, because of the petaloid zone densification. Fix: lower the petaloid step or the segment count.
- **The LOW tier keeps separate materials** (2–6 draw calls), with Cap as its own node. This lets the Godot glass and cap overrides keep working. A true single-mesh, single-material LOW would need a texture atlas.
- **Red and foil caps render pink under the Cycles/AgX studio lighting** (metallic reflection of the softboxes). They look correct in three.js and Godot.
- **The LUT is axisymmetric.** Petaloid uses the average of 2 azimuths, and the cruet spout has no tilt-direction dependence. The fill error stays under 2.9%.
- **The growler MEDIUM/LOW volume is −2.4%** (the coarse heel).
- **Thin parts are hard to see.** The swing-top bail and champagne cage wires are barely visible at distance, and do not show in the Godot shot at default zoom.
- **Godot override.** The glass shader replaces the material, so the v2 glass normal map (seams, stipple) is lost there.
- **Glass colour variants** are buildable via `name:variant` but are not exported by default.
- **Minor intersections:** the pourer cork and the stopper wedge slightly intersect the bore.

## 6. What other owners must adapt
- **Fracture:** read `export/v2/bottle_<name>.profile.json` (`outer`, `lip`, `inner`, `liquid` simplified polylines in metres, the `wall` dict per section, `z_top`, `r_bore`, `capacity_ml`) instead of the v1 profile. Bottles can be non-axisymmetric (petaloid, ribs, wobble), so use the mesh for the shell and the profile for the radial pattern. Extra nodes (`Bail`, `Cage`, `Stand`, `GlassCap`) must be skipped or detached.
- **Label:** use `label_zone` ([z0, z1] in metres) and `label_panel` from the Glass extras `bv2` or from profile.json. The label surface follows the smooth profile, so sample r(z) from profile.json and add a 0.3 mm offset.
- **Breakage / Godot:**
  - New ids are `bottle_v2_<name>`, with `lod1` and `lod2` paths in the catalog.
  - The `Glass*` override also matches `GlassCap`.
  - The `Bail`, `Cage` and `Stand` nodes need handling: they fall off or are hidden.
  - Liquid sidecars are identical in format, so `bottle_liquid.gd` works unchanged (verified).
