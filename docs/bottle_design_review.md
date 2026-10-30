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

### Pending bottle spawn cancellation — source review 2026-10-26

Canonical bottle-system reset/dispose now invalidates pending spawn generations. Factory spawn checks that generation before adopt publishes scene/physics ownership; stale freshly loaded roots are released with deduplicated geometry/material/texture disposal. Original GLB materials replaced by liquid setup are retained for this cancellation cleanup. System spawn rechecks after its await before pour registration, and advanced addBottle rechecks its layout generation and factory membership before adding outlines/views. Obsolete layout completion no longer syncs old views or logs cancellation as a current load failure.

Only newly returned spawn results use discardSpawn; normal remove/shatter ownership remains unchanged. A design already removed by its existing designHandle owner is not disposed again. Shared catalog data and image-source caches are not closed. System disposal is idempotent and ignores later physics steps. Baseline has no equivalent bottle path. Canonical factory.js/system.js were synced to advanced via the selected bottles workflow, with SYNCED.json updated.

Static source review and targeted diff check only; no tests/gameplay imports/runtime. Sync tooling only was executed. This addresses asynchronous generation crossings; exceptions or reentrant host callbacks during synchronous adopt remain a separate transaction audit, and normal published-bottle material lifetime is not redesigned here.

### Synchronous bottle adoption transaction — source review 2026-10-26

Factory adoption now delays bottles-set publication until scene attach, cap/audio handling, physics registration, tags and quality setup have completed with the same live generation. System reset/dispose invalidates factory generations as well, including direct factory calls. Reentrant retirement or scene/body loss rejects adoption rather than returning success. Rollback removes the newly returned physics handle, restores only this transaction's userData tags, and restores the prior parent/local transform while the root remains under transaction control. A callback that reparents it elsewhere is not overwritten by transform rollback.

Caller-provided adopt geometry/materials remain caller-owned on rejection. Factory spawn now releases its freshly loaded resources after failed transactional adoption; normal published remove/shard material policy is unchanged. A physics adapter that allocates and then throws without returning its handle cannot be reconciled by this interface and must provide its own failed-add cleanup. Rollback still depends on the adapter's remove contract; scene-removal cleanup is attempted independently if physics removal throws. Pour registration follows a successfully committed factory adoption and remains a separate follow-up callback audit.

Canonical factory.js/system.js were synced through the selected advanced bottles workflow. Static source review and targeted diff check only; no tests/gameplay imports/runtime. Sync tooling only was executed. No runtime claim about hostile/reentrant adapters is made.

### Pour registration callback audit — 2026-10-26

Source tracing of PourSystem.register -> liquidAbsorbance -> absorbanceOfColor/absorbanceOfSRGB found no await, event emission, host callback, physics call or scene mutation. Supported bottle drivers expose ordinary fillMl/absorbance fields, plain info/uniform records and THREE.Color components. Registration increments initialMl once and initializes absorbance synchronously; reset/remove/dispose cannot interleave through the implemented path. System spawn already checks generation/factory membership immediately before it, and synchronous system adopt uses the transactional factory guard. Reset clears initialMl and the other liquid accounts together.

No concrete false-success/stale-volume defect was demonstrated in this bounded audit, so no runtime code or generated extension was changed and no sync was necessary. This conclusion is for the actual supplied drivers, not arbitrary Proxy/getter objects or monkey-patched methods. It does not redefine normal bottle removal or promise validation of all malformed external input. Static source review and targeted diff check only; no tests/imports/runtime.

Next bounded resource audit: normal catalog-GLB bottle removal/reset retains a different ownership path from designHandle disposal. Trace geometry/material lifetime through shared shard/debris use before changing that policy, especially repeated contract resets.

### Catalog bottle resource retirement — source review 2026-10-26

Confirmed leak: factory.spawn creates a fresh catalog GLB scene and liquid material, but normal factory.remove previously only detached its root/body; only designHandle bottles had resource disposal. Repeated resets therefore left raw catalog geometry/material/texture GPU allocations unreleased. Catalog spawn's owner now releases its deduplicated resource set on normal removal as well as cancellation. Release is idempotent, and the owner record is deleted before invoking cleanup.

Ownership evidence: breakBottle loads shards from a separate shard GLB rather than cloning the source bottle; pour flights/streams use their own geometry and cached materials plus copied absorbance. Advanced outlines borrow source geometry but remain children of the removed bottle root. The owned resource set is now sealed before adoption, so later host overlay materials (shared hover/held materials) are never swept into cleanup. Original imported materials replaced during liquid setup remain included. Therefore this source-root cleanup needs no delayed shard refcount: no supported remaining renderer uses its resources after the root leaves. Caller-owned procedural adopt resources and the existing designHandle removal policy are unchanged; image-source/shared catalog/character caches are not closed.

The separately loaded shard assets have their own lifetime gap (late generation cancellation and debris retirement), left for the next bounded task. Static source review and targeted diff check only; no tests/gameplay imports/runtime. Selected advanced bottles sync updated factory.js and SYNCED.json. Actual GPU allocation counts and visual shard preservation remain unverified.

### Shard GLB lifetime ownership — source review 2026-10-26

Each freshly loaded shard GLB now has a deduplicated geometry/material/texture owner. A construction reference prevents disposal while the mesh loop is still assembling siblings; each published debris record retains one reference. Expiry, quality trimming and reset all use idempotent retireDebris, removing physics/presentation before releasing that record's reference. Resources are disposed only when construction and the last debris user have finished. Unselected stride pieces are covered by the same owner, with no cache/image-source closing.

A stale load after reset/dispose releases its construction reference without publishing meshes. Generation is captured before the broken callback, so a callback-triggered reset cannot start a replacement-generation shard load. Scene/body creation checks reject a generation crossing and remove a not-yet-published mesh/returned handle; partial-loop failures leave already published debris owned until normal retirement. Reset detaches its debris list before callback-bearing removal, preventing duplicate retirement. Factory bottle assets and pour resources remain independent; existing pane-generated debris keeps its previous resource policy for a separate audit.

Canonical breakage.js was synced via the selected advanced bottles workflow, together with SYNCED.json. Static source review and targeted diff check only; no tests/gameplay imports/runtime. Actual GPU counts and active shard rendering remain unverified. Physics adapters that throw after hidden allocation without returning a handle retain their own cleanup responsibility.

### Procedural glass resource ownership — source review 2026-10-26

Confirmed separate leaks: procedural pane shards allocated one geometry per mesh plus a shared material per shatter, while debris removal only detached them; disposePanes detached authored pane sheet/frame resources without disposing them. Pane shards now attach geometry cleanup to the existing idempotent debris retirement path and reference-count their shared material, with a construction pin preventing early release during sibling creation. Failed/unpublished pieces release their own geometry. Generation checks stop an interrupted shatter from publishing into a reset generation. Normal shard counts, geometry, motion and lifetime are unchanged.

Each pane records its authored sheet/frame geometry and materials before host attachments can be added. disposePanes retires that deduplicated set and damage marks after detaching the group. Reset keeps authored pane resources alive for reuse and only clears damage/debris, preserving visuals/collision policy. Procedural shard material is independent of the pane and of shard-GLB assets; no shared catalog/character cache is touched. The GLB shard path is unchanged in this iteration.

Canonical breakage.js was synced through the selected advanced bottles workflow. Static source review and targeted diff check only; no tests/gameplay imports/runtime. Sync tooling only was executed. Actual GPU resource counts, visual continuity and unusual host callbacks remain unverified.

### Synchronous host pre-adoption clearance — source review 2026-10-26

BottleFactory.spawn accepts optional extra.beforeAdopt(), called synchronously after asset/metadata awaits and before adopt mutates scene or physics. A thrown host refusal uses the same fresh-resource cleanup as load failure; no bottle or liquid ledger entry has been published. The hook is removed from adopt options and the generation/liveness predicate is checked again after it, so a callback reset cannot publish the old spawn. It is a synchronous throwing preflight, not an asynchronous callback or new collision engine. Callers without the option retain their prior behavior.

Advanced Nightfall supplies game-local occupancy checks for late initial/retry slots, using its existing catalogue hulls, world boxes, solver bodies and observed hand/head positions. Canonical factory.js was selected-synced. Static source review/diff check only, no tests/runtime. Exact visual clearance and unusual callback behavior remain unverified.

### Structured bottle transport classification — source review 2026-10-26

New internal transport.js wraps proven transport failures in BottleTransportError with code (BOTTLE_HTTP or BOTTLE_NETWORK), phase, status, retryable and original cause. GLB/design loader failures are classified only when Three FileLoader supplies structured Response.status. Retryable HTTP statuses are 408/429/500/502/503/504; permanent HTTP errors retain structured diagnostics but retryable=false. No message parsing or vendor loader edits.

Required explicit liquid-sidecar loading separates fetch/body reading from JSON.parse. Fetch/body TypeError at a valid HTTP(S) URL receives the network code; malformed/unsupported URLs, AbortError, JSON syntax and metadata validation remain nonretryable ordinary errors. Browser network-policy failures (including opaque CORS failures) cannot be proven temporary; retry means a deliberate safe transport retry is permitted, not that success is promised. Generic GLTFLoader TypeError stays unclassified because it can originate in parsing. Optional break metadata and legacy liquid fallback keep their existing best-effort behavior.

All classification occurs before adoption. Existing resource cleanup, generation cancellation, beforeAdopt clearance and liquid-ledger publication are unchanged. Advanced consumes only recognized codes with retryable=true, plus its separate game-owned occupancy refusals. Selected bottles sync only. Static source review/diff check, no tests/gameplay imports/runtime. A fully typed primary GLB network boundary would require a separate loader integration change and is not implied by this patch.

### Primary GLB transport boundary audit — source review 2026-10-26

Reviewed the shipped upstream Three source in NightfallContractsWebXR-interaction/vendor/three/examples/jsm/loaders/GLTFLoader.js (load, parse) and vendor/three/build/three.module.js (FileLoader, LoadingManager). GLTFLoader constructs FileLoader internally rather than consulting a replaceable manager loader for the primary request. Its _onError receives both FileLoader failures and synchronous/asynchronous parse failures. The manager's itemError receives a URL, not a typed transport cause; URL modifiers/handlers do not expose a fetch-error boundary.

FileLoader owns resolved-URL cache lookup, module-private in-flight request coalescing, Request headers/credentials, streamed progress/body conversion and manager start/end/error accounting. GLTFLoader additionally tracks an item through parse and computes the resource base independently. Replacing loadAsync with fetch+parse would require reproducing these behaviors; wrapping global fetch or patching vendor/prototypes would affect unrelated consumers. A parse-start flag alone cannot identify every pre-parse TypeError as a connection failure (request construction, URL-modifier/manager/progress callbacks also run along that path). No safe narrow public hook was demonstrated.

No runtime/canonical loader change made: structured HTTP errors and explicit-sidecar transport remain eligible, generic GLB TypeError remains unclassified. Static source audit and documentation diff check only; no tests, imports, runtime or new sync. This result is specific to the currently shipped Three implementation, not a claim about all versions.
