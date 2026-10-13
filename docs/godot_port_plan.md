# Plan: Godot-versionen af Contracts på de fælles extensions

## Current verified state — 2026-10-13

G4 currently has source ports for `GSGraspMerge.merge_poses`, `GSGraspClamp.clamp_rows`,
catalog `GSGraspShapeSdf` distance/normals, stateless `GSGraspVariants` selection,
`GSGraspHeldDrive` math/sampling and `GSGraspThrowRelease` sampling/math. Nearest,
merge, clamp, SDF, variants, held-drive and throw-release are Sol-reviewed; their source
and consumer sync are complete.
Merge preserves public JS ordering, duplicate/default policy and shallow identity,
including existing key/marker collision semantics; Sol review and Nightfall Godot
consumer sync are complete. Clamp applies the shared hard finger ranges and comfort
fallbacks without mutating inputs; parity goldens cover all 255 baked poses and edge
rows. Avatar conversion and native `recorded-only` consumer integration remain outside
these utilities. The controller-lookup experiment
recorded in the backlog rejects hot-path substitution of `GSNearestGrasp` for now:
near-tie winners differ and the cached adapter costs about 4–5.5 times as much at the
slide seam. `lookup_palm` uses a different residual model. Native integration remains
unresolved; the generic JS-parity selector is unchanged.

G4 has begun with the standalone [`gs_grasp` nearest selector](../godot/addons/gs_grasp/README.md).
The pure caller-owned-library API preserves JS distance/angle scoring, previous-ID
bonus, filters, input order and original pose identity. Its JS-generated golden has
296 cases; Godot 4.7.2 passes 2,071 assertions at `1e-10` numeric tolerance. Malformed
inputs fail closed within the typed Godot API, an explicit divergence from unchecked
JS. Sol approved the source port and it is synced into Nightfall Godot. The existing
game grab loop still uses its richer reach/contact-aware `BakedGraspLibrary` adapter;
this selector does not replace that behavior. Runtime use needs a separate adapter
that preserves those constraints. These utilities do not complete G4 or demonstrate
closure/contact, host drive/throw integration, avatar fit, runtime switching or headset parity.

This status supersedes the older worktree/branch references and historical mapping below.
`GameSystems/main` tracks `kblood/GameSystems`; the native game remains the separate
`kblood/NightfallContractsGodot` repository. There are no registered side worktrees in
either checkout. WebXR remains its own project. The older mapping below is a dated
architecture snapshot; use this section and the linked addon READMEs for current state.

`gs_host` and the reusable gear ledger are committed. The current source also contains
the scene inventory adapter, resource adapters, weapon catalog/loadout, bottles,
backpack, cameras, thermal/portals, fire spread, sprinklers, electricity and thermal
adapters. The gear ledger and scene adapter include safe consumption/unregistration,
checkpoint handling and scene-exit cleanup. The `equipped` owner is covered through
transfer, restore and reset. On Godot 4.7.2, the latest direct source tests pass:
gear ledger **59/59**, scene adapter **82/82**, sprinkler kernel **54/54**, and the
fire-station integration **36/36**. These are headless source contracts, not headset
acceptance.

`gs_bottles` has been ported as a source addon and synced to Nightfall with its adapter,
quality and `broken`-event integration. Its source contract and Nightfall sync are
separate from the older `extensions/` port plan. The source of truth for ongoing
concrete tasks is [`improvement_backlog.md`](improvement_backlog.md); remaining ports
must be assessed there rather than inferred from this historical table.

`gs_backpack` now also provides reusable approach validation, the gated inventory
interaction bridge, and the bounded local-space handle-pull policy. Its source contracts
pass 34 handle/approach checks and 10 bridge checks; Nightfall keeps collision sweeps,
body anchors, presentation, and XR input in its host adapter.

G3's data-only contract phase is complete. Humanoid canonical-to-rig maps live in
`extensions/humanoid/bone_maps.data.json`; the standalone `godot/addons/gs_humanoid`
reader loads them. A generated Godot contract and golden are checked
against the JS extension's exports; the JS test also pins all four 52-joint maps to
their pre-migration values. Validator `HARD`, `COMFORT` and `GATES` are now a second
versioned JSON contract, read by `godot/addons/gs_grasp_data`; its golden is derived
from the JS exports. Godot 4.7.2 source tests pass 10/10 for humanoid maps and 35/35
for validator data. A third contract now extracts closure defaults (`CLOSURE`,
`PAD_RADIUS`, `REFERENCE_HAND`, `THUMB_TILT`) into `extensions/grasp/data/closure.data.json`;
the separate `GSGraspClosureData` reader passes 38/38 source checks, with exact historical
values and JS mutability boundaries pinned by regression tests. Its golden comes from
the public JS exports. Held-drive's six public scalar constants now form a fourth
contract, `extensions/grasp/data/held_drive.data.json`; `GSGraspHeldDriveData` passes
55/55 source checks. JS regression pins the original constants, spring outputs and
two-sample motion window. The catalog now provides a fifth contract:
`extensions/grasp/data/catalog.data.json` preserves `DEFAULT_MASS`, five prop records
and their primitive/lathe/union shapes. `GSGraspCatalogData` passes 49/49 structural
checks; JS regression pins the original catalog and 18 SDF outputs across all five
kinds. The unchanged canonical `extensions/grasp/reference_hand.json` now has a sixth
data-only reader, `GSGraspReferenceHandData`, passing 78/78 checks for raw rest data and
direct API field correspondences. Its golden records six complete `referenceHand()`
outputs for later geometry-algorithm tests; JS regressions pin historical fixture/output
values, caching and scaling. The unchanged `recorded_grasps.json` now has a strict
`GSGraspRecordedData` reader, passing 58/58 checks. Its golden keeps the raw document
separate from the filtered public `RECORDED` export and records accepted/rejected
indices. This does not turn JS filtering into a strict runtime reader or imply
anatomical validity. The unchanged bake now has `GSGraspBakedData` with 300/300 checks,
including complete public `BAKED` equality and all 255 pose IDs/structures. It preserves
asset-specific magazine entries, raw angles and sentinel metrics; embedded asset
hashes are provenance, not asset verification. These readers do not implement Godot
closure, drive, SDF, reference-hand geometry, recording or baking algorithms.
Grasp quality policy now lives in `extensions/grasp/data/quality.data.json`, preserving
level order, frozen public arrays, default, legacy alias and private exempt-finger list.
`GSGraspQualityData` passes 46/46 source checks; its golden distinguishes public API
observations from copied private configuration. Final audit: source and consumer copies
match, all data readers/goldens and both WebXR suites pass. This completes shared-data
integration only; constants alone do not implement native quality behavior, and later
algorithm, asset-fit and headset parity remain outside G3.

Historisk status (2026-10-12): **G0 afklaret, G1 og G2 implementeret og versioneret**; G3 (fælles grebs-/skeletdata) var næste planlagte porttrin.
Status (2026-10-10): undersøgelse, ingen kode ændret i `NightfallContractsGodot*` eller i `GameSystems/extensions`. Relateret: [extensions_plan.md](extensions_plan.md) (trin 1–9), [grab_findings.md](grab_findings.md).

> **Ufuldstændig kortlægning.** Denne version blev skrevet, før de to baggrunds-kortlægninger var færdige: (1) Godot-koden pr.
> system og (2) worktrees/branches og dokumenterne. Tabellen herunder bygger på filnavne, filstørrelser, `addons/game_systems/SOURCE.json`,
> Godot-`AGENTS.md`, `git worktree list` og `docs/nightfall_handoff.md`. Godot-funktionernes signaturer, konventionerne for fingervinkler og
> worktree-status skal kontrolleres, før trin G1 starter.

## Mål

Godot-Contracts skal have **samme arkitektur** som WebXR-versionen. Bottles, avatar (VR-IK), humanoid + character-*, grasp og host
(events, kvalitetsniveauer, fysik-adapter) skal hver være et **selvstændigt, genbrugeligt Godot-addon**. De skal have samme grænser,
kontrakter og offentlige API'er som `GameSystems/extensions`. Spillet bygges oven på dem, og andre Godot-spil kan genbruge dem.
Første lag er arkitekturen. Andet lag er deling af data og algoritmer med JS-versionerne.

## Nuværende tilstand

| Del | Godot i dag | Extensions (three) | Bemærkning |
|---|---|---|---|
| Hovedprojekt | `C:\Devstuff\GameDev\NightfallContractsGodot`, branch `main` at `33a84d0`, tracking `origin/main`; Godot 4.7.2/OpenXR | — | Primærcheckout har ingen side-worktrees. De ældre `-blood` og `-npcai` kloner er fast-forwardet til samme `main`; deres gamle lokale branches er fjernet, og genererede `.uid`/cache-artefakter er bevaret i lokale stashes. |
| Motor | Godot 4.7.2, OpenXR, Mobile-renderer, 72 Hz fysik, Jolt Physics, ingen autoloads | three 0.170 + cannon-es / Contracts' egen solver | Projektets feature declaration er stadig 4.6; Steam Frame Linux ARM64 (Adreno 750) og PCVR er separate valideringsmål. |
| Flasker | `addons/game_systems/{bottles,glass,shaders}` vendoret fra GameSystems' Godot-kilde med `SOURCE.json`; adapter: `nightfall_interaction/system_bottle.gd` | Ikke en extension endnu (trin 8–9) | Den genbrugelige `gs_bottles`-port med scene hooks, physics adapter og quality wiring er stadig åben. `gs_resource_adapters` er et separat færdigt stykke. |
| Greb | Spillets fysiske greb forbliver i `addons/nightfall_interaction`; generisk ejerskab/opbevaring ligger i `gs_gear_inventory` | `extensions/grasp` (JS, ca. 1100 linjer + 127 KB data) | Godot er fortsat ophav for de spil-specifikke surface-fitted grasps; bagning, katalog og eventuel konformitetsport kræver et separat tranche. |
| Fingre/hånd | `nightfall_characters/finger_poses.gd` (1234 linjer), `hand_contact.gd`, `hand_skin_contact.gd`, `free_hand_contact.gd`, `validated_hand_fit.gd`, `wrap_fit.gd`, `hand_view.gd` | `avatar/fingers.js`, `rigdata.js`, `grasp/closure.js`, `record.js` | Det er ikke afklaret, om Godot bruger samme rækkeformat `[dyaw, pitch, bend1, bend2]`. Det er det vigtigste punkt i konformitetsarbejdet. |
| Avatar/IK | `nightfall_characters/operator_ik.gd` (1421), `operator_body.gd`, `body_height.gd`, `foot_gait.gd`, `player_motion.gd`, `rig_transport.gd` | `avatar/vrik.js` m.fl. | Godot har sin egen solver. |
| Karakter/skelet | `nightfall_characters/character_actor.gd`, `active_ragdoll*.gd`, `ragdoll_joint_profile.gd`, `character_physics.gd`. `addons/nightfall_creator/` (udseende, spejl, valg). Eksport: `tools/build_characters.mjs`, `character-export.*` (ejes af parent ifølge AGENTS.md) | `humanoid/`, `character-cc/` | Godot-AGENTS.md: "Character data/logic stays in a reusable addons/nightfall_characters component". |
| Fysik/events | `GSHost`/`GSEventBus` er flyttet til `GameSystems/godot/addons/gs_host` og integreret i Godot-spillet via core-event-broen | `host/events.js`, `host/physics.js` | Fælles host/lifecycle findes; gameplayets lokale fysikadapters og eventdækning er fortsat trinvist arbejde. |
| Inventory | `gs_gear_inventory` ledger + scene adapter findes som genbrugelige addons; Nightfall kobler dem til tasker, våben og magasiner | Ingen tilsvarende inventory-extension endnu | Source-tests kører separat i GameSystems; Nightfall dækker player-/scene-integration. Seneste lifecycle-udvidelse testes i aktuelle branches. |
| Kvalitet | `GSQuality` og `GSHost.set_quality` findes; enkelte lokale system-/menuindstillinger består | `host/quality.js` (globalt niveau 0–3 → tiers pr. extension) | Host-tier kontrakten findes; comfort-menu kobling og konsekvent brug i alle systemer mangler. |
| Test/eksport | `tests/run_native_suite.py`, `tools/fast_tests.py`, `tools/export_native.py`, `tools/verify_frame_export.mjs`, `tools/run_frame.sh` | node-tests, puppeteer-lab | Godot-tests er headless GDScript-scener. |

## Anbefalet arkitektur (lag 1: samme moduler som extensions)

Kilden til sandhed er **`GameSystems/godot/addons/gs_<navn>/`**. Kilde-addons'ene lægges ved siden af `extensions/` og flyttes ud af `gameplay/godot`.
Spillene får kopier via et sync-script med `SOURCE.json` (sha256 pr. fil, `--check`). Det er samme model, som Godot-Contracts
allerede bruger til `addons/game_systems`, og som Contracts WebXR bruger til `src/extensions`. Kopierne committes i spillet, så det kan bygges alene.
Lokale ændringer i kopier er forbudt. Spil-specifikt hører hjemme i spillets egen adapter (`addons/nightfall_*`).

```
GameSystems/godot/addons/
  gs_host/        GSHost (Node), GSExtension (Node-base), GSEventBus, GSQuality, GSPhysicsAdapter (RefCounted-interface)
  gs_humanoid/    GSHumanoid (canonical VRM-1.0-led inkl. 30 fingerled), bone maps (MPFB/VRM/Mixamo → SkeletonProfileHumanoid), skeleton_check
  gs_character_cc/ CharacterCreator-karakter bag karakter-kontrakten (krop/tøj/hår/morphs), importregler for CC-GLB
  gs_avatar/      VR-IK (Godot-port eller Godots egne IK-modifiers), kalibrering, fingermapping (OpenXR hand tracking → rækker), poser
  gs_grasp/       data (JSON), lukning-til-kontakt, validator, held-drive, kast, katalog/SDF, optagelser
  gs_bottles/     nuværende gameplay/godot + shaders/godot (allerede GDScript)
  gs_adapters/    physics_godot.gd (GodotPhysics3D/Jolt via RigidBody3D) — spillets egne adaptere ligger i spillet
```

### Kontrakterne i Godot-termer

- **Extension** (`class_name GSExtension extends Node`): `const ID`, `const REQUIRES := ["gs_grasp"]`, `const QUALITY := ["off","low","high"]`,
  `func init_extension(ctx: GSContext) -> Object` (returnerer det offentlige API-objekt), `_process`/`_physics_process` slås fra, når tier er `off`,
  `func set_quality(tier: StringName)`, oprydning i `_exit_tree`. `GSHost` (Node, ikke autoload, ejes af missionsscenen ligesom
  bottle-manageren i dag) loader extensions som `PackedScene`/script, tjekker `REQUIRES` og fanger fejl. En fejl fjerner kun den extension.
- **Context** (`GSContext extends RefCounted`): `scene_root`, `camera`/`xr_origin`, `physics: GSPhysicsAdapter`, `quality`, `asset_path()`,
  `emit(event, data)`, `on(event, callable) -> Callable` (afmeld), `get_ext(id)`.
- **Events**: `GSEventBus` med `CORE_EVENTS = [&"grab", &"release", &"broken", &"xr_start", &"xr_end", &"disconnect", &"hand_tracking_changed"]`.
  Bussen er implementeret som en `Dictionary[StringName, Array[Callable]]` med fejlisolering. Godot-`signal` bruges kun lokalt på noder.
  Payloads er `Dictionary` med samme nøgler som JS-versionen (`{owner, side, body, pose_id}` osv.).
- **Kvalitet**: `GSQuality.tier_for(tiers, level, max_level := 3)` er en 1:1-port af `quality.js`. Et globalt niveau (comfort-menuen)
  → tier pr. extension, og tiers kan pinnes.
- **Fysik-adapter** (`GSPhysicsAdapter extends RefCounted`): `add_body(shape: Dictionary, mass, xform) -> RID|Object`, `get_pose(h)`,
  `hold(h, target: Transform3D)`, `release(h, lin_vel, ang_vel)`, `on_contact(callable)` (leveret efter trinnet), `remove(h)`. Skemaet for
  shapes er det samme som i `physics.js` (box/sphere/cylinder/compound). Godot-Contracts' adapter pakker `NightfallGrabbable`'s drive og CCD-historik ind.
- **Karakter** (`GSCharacter extends Node3D`): `skeleton: Skeleton3D`, `meshes`, `humanoid: GSHumanoid`, `rest_heads() -> Dictionary`,
  `apply_pose(pose)`, `reset_pose()`, `head_bone`, `capabilities := {fingers, eyes, cloth, morphs}`, `QUALITY := ["low","high"]`.
  En karakter-provider er en `Resource` (`GSCharacterProvider`) med `create(kind, options) -> GSCharacter`.
  `rest_hand(side) -> Dictionary` har samme felter som JS-versionens `restHand()` (frame F/D/R, wrist, fingre pts/len/rest, scale, handLength, thumbTilt).
- Data som **JSON i addon'et** (ikke `.tres`), så de samme filer kan læses af begge motorer.

### Opdeling af Godot-Contracts' kode (foreløbig, skal bekræftes fil for fil)

| Fra | Til | Bliver i spillet |
|---|---|---|
| `addons/game_systems/*` (+ 4 lokale ændringer) | `gs_bottles` (ændringerne bliver til konfiguration: shader-rod, budget, pour-maske, manager-ejer) | `system_bottle.gd` som adapter |
| `baked_grasp_library.gd`, `grasp_catalog.gd`, `held_drive.gd`, `throw_release.gd`, `grasp_contact.gd`, generisk del af `grasp_feedback.gd`/`palm_proxy.gd` | `gs_grasp` | pistol/magasin (`magazine.gd`, `slide_pinch_clearance.gd`, `insertion_corridor.gd`, `reload_tilt.gd`), `door_lever`, `blood`, `bottle_cap` |
| `grabbable.gd` grab-kontrakt | den generiske del → `gs_grasp` + `GSPhysicsAdapter` | Nightfall-lag/masker, støj til vagter |
| `finger_poses.gd`, `hand_*contact.gd`, `validated_hand_fit.gd`, `wrap_fit.gd` | fingermapping → `gs_avatar`; kontakt/fit → `gs_grasp` (erstattes af lukning-til-kontakt) | — |
| `operator_ik.gd`, `operator_body.gd`, `body_height.gd`, `foot_gait.gd`, `player_motion.gd`, `rig_transport.gd` | `gs_avatar` | spillerens CharacterBody3D/locomotion |
| `character_actor.gd`, skelet/bone-map-delen | `gs_humanoid` + `gs_character_cc` | `active_ragdoll*`, `ragdoll_joint_profile.gd`, NPC/vagt-AI (kan blive et senere `gs_ragdoll`) |
| `addons/nightfall_creator` | bliver i spillet (UI) og bruger `gs_character_cc` | ja |

`addons/nightfall_characters` bliver et tyndt spil-lag oven på `gs_humanoid`/`gs_avatar`/`gs_character_cc`. Godot-`AGENTS.md`'s regel
om en "reusable addons/nightfall_characters component" skal derfor opdateres. Det kræver brugerens beslutning.

## Lag 2: deling af data og algoritmer med JS

| Strategi | Vurdering |
|---|---|
| **a) Delt data + to implementationer + konformitetstests** | **Anbefales.** GDScript kører uændret på ARM64 og PCVR uden native-builds. Algoritmerne er små (grasp ca. 1100 linjer JS, mest ren matematik). JSON er fælles i forvejen (`baked_grasps` stammer fra Godot). Golden-filer fra JS gør afvigelser målbare. |
| b) JS-runtime i Godot | **Fravælges.** Godot-`AGENTS.md`: "WebXR JS is reference only, never a native runtime dependency." Det ville også kræve en tredjeparts-GDExtension (V8/QuickJS), som skal bygges til linux-arm64 og vedligeholdes ved Godot-opgraderinger. Det giver interop-overhead pr. frame og en ekstra licens- og sikkerhedsflade. |
| c) Fælles kerne i Rust/C (GDExtension + WASM) | **Ikke nu.** Det kræver toolchain og CI til win64, linux-x64, linux-arm64 og wasm, og WebXR-siden skulle skrives om fra ren ESM til WASM. Værktøjerne (lab, studio, node-tests) skulle også om. Overvej det kun for en senere hot path (fx `high`-lukning hver frame på mange hænder), hvis profilering på Steam Frame viser behov. Interfacet fra a) holdes så rent, at kernen kan byttes. |

Detaljer for a):
- Implementeret i G3 indtil nu: humanoid bone maps (`extensions/humanoid/bone_maps.data.json`) og grasp-validatorens
  `HARD`/`COMFORT`/`GATES` (`extensions/grasp/data/validator.data.json`) samt closure-defaults
  `CLOSURE`/`PAD_RADIUS`/`REFERENCE_HAND`/`THUMB_TILT` (`extensions/grasp/data/closure.data.json`) og held-drive-modulets
  seks skalar-konstanter (`extensions/grasp/data/held_drive.data.json`) samt `DEFAULT_MASS`/`CATALOG`
  (`extensions/grasp/data/catalog.data.json`). JS bevarer eksportnavnene, og alle fem datasæt har
  Godot-readers samt golden-filer fra offentlige JS-eksporter. JSON flyttes ind i app-kopiernes runtime gennem de
  eksplicit tilladte sync-stier; `grasp/tools/` forbliver offline.
- Den eksisterende `extensions/grasp/reference_hand.json` har desuden en Godot-reader for
  rå restdata. Golden-filen optager offentlige `referenceHand()`-outputs; Godot-kontrollen
  dækker struktur og direkte felter, mens afledt geometri fortsat kræver algoritmeparitet.
- `recorded_grasps.json` har en streng Godot-reader til kanonisk data. Goldenen bevarer
  rå dokument og filtreret JS-`RECORDED` hver for sig; JS' løse schema-/metadataregler og
  filtrering er uændrede. Anatomisk kvalitet og recording-algoritmer er ikke portet.
- Kvalitetspolicyen ligger nu i `extensions/grasp/data/quality.data.json` med Godot-reader;
  offentlig rækkefølge/exempt-kinds, default/alias og privat exempt-fingerliste er bevaret.
  G3 kræver fortsat samlet kontrakt-/consumer-audit før afslutning.
  `baked_grasps.data.json` har nu en streng Godot-reader og komplet offentlig `BAKED`-golden;
  de 255 records, summary-tællinger og oprindelig metadata bevares uden anatomisk gate
  eller krav om generisk katalogmedlemskab. Avatar-assets/bagealgoritmer er ikke verificeret.
  `extensions/grasp/finger_profiles.json` fandtes ikke ved kontrol
  2026-10-13; behold det ikke som antaget input uden nyt kildebevis.
- `tools/golden/*.mjs` genererer golden-filer fra JS: `clampRows`, `validateRows`, `signedDistance` i et punktgitter pr. kind,
  `fingerChain` FK, `closeToContact` for N poser × 3 håndskalaer, `rowsFromJoints`/`mirrorPose`, `driveAcceleration`, `releaseVelocity`, `tier_for`.
  Godot-tests (headless, i `tests/run_native_suite.py`) skal ramme dem: vinkler ≤ 0,1°, positioner ≤ 0,1 mm, SDF ≤ 0,05 mm.
- Grasp Studio's optagelser (`recorded_grasps.json`, `gamesystems.recorded-grasps.v1`) er i hånd-/item-rum med `handLength`. De virker i Godot,
  så snart `gs_grasp` har `merge_poses` + `place_wrist` + lukning-til-kontakt. Det opfylder kravet om ét greb til begge spil.
- Koordinater: begge bruger +Y op og meter. JS-karakterrammen er +X venstre, +Z frem. Godot-karakterer vender typisk −Z frem, så
  konverteringen ligger ét sted (`gs_humanoid`), og golden-testene dækker den.

## Licenser

- `gs_humanoid`, `gs_avatar` og `gs_character_cc` må kun bygge på CharacterCreator-kode op til commit `0d78054` / `dc664c07` (MIT) og CharacterCreatorXR (MIT).
  CharacterCreator er GPL-3.0-or-later fra 2026-10-03. En port fra nyere CC-kode gør addon'et GPL. Hvert addon får en `LICENSE-NOTES.md` som i extensions.
- Godot-Contracts' egne GDScript-filer (fx `operator_ik.gd`, `finger_poses.gd`) skal have deres ophav afklaret, før de flyttes ind i GameSystems (MIT).

## G0-kortlægning (2026-10-10, læst fra `interaction-fix` 1b9429e)

Erstatter antagelserne ovenfor, hvor de er uenige.
- **Sprog/motor**: kun GDScript (ingen C#/GDExtension). Godot 4.7.2, Jolt, 72 Hz, Mobile renderer.
- **Fingre** (`addons/nightfall_characters/finger_poses.gd`, porteret fra WebXR-pluginet):
  - Hver finger er en række `[yaw, MCP, PIP, DIP]` i grader, samme konvention som JS-rækkerne.
  - Håndrammen er `Basis(D×F, D, F)`, og tommelrammen hælder 60°.
  - JS-konverteren (`convert_baked_grasps.mjs`) mapper allerede mellem dem.
- **Navngivne poser findes i Godot**: relaxed, pistol, trigger, support, magazine, insert, slide, object_wrap/neck/handle/pinch, open.
  De er det oplagte startsæt til extensions-trin 7 (begge veje).
- **Ledgrænser**: Godot har kun ét sæt (`DIGIT_MIN/MAX`, `THUMB_MIN/MAX`), og det afviger fra JS `HARD`. Tommel-pitch går fx til 100° i Godot mod 65° i JS.
  Godot-sættet forklarer mug-tommelen på pitch 100 (grab_findings 3.1). Der skal vælges ét fælles sæt i G3.
- **Runtime-greb**: Godot har en budgetteret (600–2000 µs) fit mod den skinnede hud.
  - Moduler: `wrap_fit.gd`, `free_hand_contact.gd`, `validated_hand_fit.gd`.
  - Bagte poser blendes ind over 0,15 s.
  - Det er mere avanceret end JS-closure på hudsiden. G6 skal sammenligne dem, ikke bare erstatte Godots version.
- **Bagning**: én fil pr. avatar (5 × ~3 MB, `nightfall.baked-grasps.v1`). Koblingen går kun Godot → web; Godot læser intet fra GameSystems/extensions.
  - `hand_local` er hånd-knoglen inkl. `operator_scale` (1,0328), ikke håndrammen.
  - Den legacy procedurale `bottle` har origin midt på kroppen. Konverteren antager bund-centreret og porterer kun `bottle_beer`/`bottle_wine`.
- **Avatar/IK**: egen `operator_ik.gd` (SkeletonModifier3D, 1421 linjer). Ingen motor-IK og **ingen optisk hand tracking**, kun controller-grip/trigger + poser.
  Karakterer bruger VRM-1.0-kanoniske aliaser (52, inkl. 30 fingerled) og +Z frem, +X venstre (samme som JS).
- **Events**: ingen event-bus og ingen grab/release-signaler. Grab/release observeres ved polling i `xr/interaction_event_log.gd` (JSONL). `gs_host` er nyt.
- **Kvalitetsniveauer**: intet globalt system, kun GameSystems' `GlassSystem.Tier` og `BottleBreakManager.default_quality` samt konstante budgetter.
- **Fysik**: held-drive er kraft-PD i `_integrate_forces` (stivhed 900, dæmpning 60, 90 m/s², 120 N). Pistol/magasin er kinematisk swept carry.
- **Tests**: `run_native_suite.py`, `fast_tests.py`, suiter i `tests/suites/*.json`. Ingen krydstest mod WebXR-data.

## G0-beslutninger (brugeren, 2026-10-10)

- **Q1 ja**: modulerne ligger i `GameSystems/godot/addons/gs_*`; `gameplay/godot` flyttes dertil, og `addons/game_systems` erstattes af synkede kopier.
- **Q2 tilføjelse**: Godot-AGENTS.md får nye linjer (Claude: Opus for Astra, Haiku for Luna; gs-addons som synkede kopier; licensreglen).
  De eksisterende regler blev stående. Tilføjet 2026-10-10.
- **Q3/Q4/Q6/Q7**: afklaret (worktrees merget, Jolt, licensreglen, Godot 4.7.2).
- **Q5**: IK som Godots egen `operator_ik.gd` bag samme API først.
- **Q8 ja**: de 4 ekstra bagefiler pr. krop slettes, når lukning-til-kontakt består i Godot (G6).
- **Worktrees**: må slettes, når de er bekræftet merget og ubrugte. Tjekket 2026-10-10: alle 16 worktrees og klonerne `-blood`/`-npcai` (alle
  lokale branches) er forfædre til `interaction-fix`. Deres ucommittede ændringer er kun Godot-reimport-støj i `*.import`, testresultater, `.pyc`
  og midlertidige testscripts (`tests/r2tmp/*`, `tests/reviewer_*.gd`, `tests/r2_trace.gd`). Ingen af dem er rørt de seneste 3 timer.
  Sletningen køres af brugeren (agentens værktøj må ikke slette).

## Rækkefølge

Trinene starter efter extensions-trin 5 (`humanoid`/`avatar`/`character-cc` flyttet). Karakter-kontrakten og rest-hånd-provideren skal være stabile først.

| # | Trin | Indhold | Færdig når |
|---|---|---|---|
| G0 | Afklaring | Brugerens svar på spørgsmålene nedenfor. Ret kortlægningen i denne fil (fingerkonvention, worktree-status, `-blood`/`-npcai`). Vælg hvilke `r2-*`/`pkg-*` der merges først | beslutninger skrevet her |
| G1 (færdig 2026-10-11) | `gs_host` + sync | `GameSystems/godot/addons/gs_host`, sync-script med `SOURCE.json` + `--check` (genbrug formatet fra `addons/game_systems`), `tier_for`-golden. Contracts-Godot får en `GSHost` i missionsscenen og sender core-events | headless-test: load/fejlisolering/tiers; `run_native_suite.py` grøn |
| G2 (færdig 2026-10-12) | `gs_bottles` | Flyt `gameplay/godot` + `shaders/godot`; sceneejet manager, asset-/quality-options, stabil API og `broken`-event i `GSHost` | Nightfall-adapter bruger den synkede addon; legacy-flaskekopi fjernet; bottle- og `--only game-systems`-suiter grønne |
| G3 (færdig 2026-10-13) | Fælles data-kontrakt | Humanoid maps, validatorens `HARD`/`COMFORT`/`GATES`, closure-defaults, held-drive-skalarer, katalog og kvalitetspolicy er versioneret JSON med Godot-readers og JS-goldens. Reference-hand, recordings og bake har strukturelle readers. Afledt geometri, recording/bake-algoritmer, avatar-fit og headsetparitet er ikke bevist og ligger i senere trin | Source/consumer-kopier og manifests matcher; alle G3-readers og goldens passerer; WebXR-suiterne passerer; G3-afgrænsningen er dokumenteret |
| G4 (påbegyndt) | `gs_grasp` kerne | Nearest, merge/default, `clamp_rows`, catalog SDF/normal, stateless variantvalg, held-drive-math og kastets sample-/release-math er source-ports og Sol-reviewed. Native hot-path-substitution er afvist indtil separat scoring/performance-kontrakt. Resterer: recording validation/conversion, validatorudfald, closure/contact og runtime-integration | Selector: 296 JS-cases, 2.071 Godot-checks; merge: 21 cases, 2.392; clamp: 259 cases, 7.008; SDF: 70 cases, 425; variants: 16 cases, 9.347; held-drive: 45 checks; throw-release: 4 JS-cases, 183 Godot-checks; målrettet suite 7/7, G4-runtime-paritet mangler |
| G5 | `gs_humanoid` + `gs_character_cc` | Canonical skelet, bone maps → `Skeleton3D`, `rest_hand()`. CC-karakter bag `GSCharacter` | karakter-kontrakt-test i Godot; `rest_hand` = JS-golden |
| G6 | Lukning-til-kontakt + optagelser | Port af `closure.js` og `record.js` (`place_wrist`, `close_to_contact`, `mirror_pose`). Erstat `baked_grasps_*.json` pr. kropstype med én bagning + lukning | golden ≤ tolerance; et Studio-greb vises i Godot; 4 af 5 bagefiler kan slettes |
| G7 | `gs_avatar` | VR-IK, kalibrering, fingermapping (OpenXR → rækker) bag samme API. Beslut port af `vrik.js` vs. Godots IK-modifiers | Godot-avatar-tests grønne; fingre fra hand tracking = JS-golden |
| G8 | Hånd-poser/-animationer | Følger extensions-trin 7 (samme format) | controller-hænder bruger optagede poser i Godot |
| G9 | Steam Frame | ARM64-eksport, profil pr. tier på enheden | målinger skrevet ind her (ikke editor-tal) |

### G2 progress (2026-10-11)

`godot/addons/gs_bottles` now contains the reusable breakable-bottle/liquid scripts,
adjacent shader resources, `GSBottleExtension`, license, README, and headless tests. It is
synced to Nightfall at `addons/gs_bottles` with `SOURCE.json`. The addon test passes 29/29;
Nightfall's `game-systems` integration passes 26/26, the bottle physics review passes
191/191, and the bullet-impact review passes 75/75. The Nightfall adapter now derives from
`GSBreakableBottle`, the extension owns scene-scoped manager/quality and forwards the core
`broken` event, and the old bottle scripts/shaders have been removed from the legacy glass
addon. Nightfall keeps only its glass-pane runtime and bottle data assets in that folder.

The VR settings now persist one effects-quality choice and apply it to both the glass-pane
tiers and the `GSHost` quality level, keeping bottle and glass tiers in sync. Mission-level
integration verifies that the choice reaches both systems together; settings persistence,
legacy-config fallback, UI cycling and host tier mapping are covered by headless tests.
Simultaneous mission-host scopes and independent teardown are covered in Nightfall's
integration suite. Headset performance/comfort evidence is still needed. Bottle creation
and scene tracking are also covered in Nightfall's integration suite.
Bottle collision stays Godot `RigidBody3D`-managed; routing those contacts through
`GSPhysicsAdapter` would duplicate or alter engine collision handling. Headset performance
and comfort remain unmeasured. Sol's review found and prompted pruning of tracking entries
on scene removal and after one-shot break delivery; the extension regression now covers both.

Det er ca. **10 trin** (G0–G9). G1 og G2 kan starte før extensions-trin 5, fordi de kun afhænger af host og bottles. G3–G7 kommer efter trin 5,
og G6 også efter trin 4's headset-test. G8 kommer efter trin 7. Extensions-trin 8–9 (bottles i three) kan bruge G2's API som model.

## G1-resultat (2026-10-11)

Implementeret af Claude (Opus i stedet for Astra, jf. Godot-AGENTS.md) og efterfølgende versioneret på GameSystems `main` (`5234a29`) med Nightfall-integrationen på Godot `main`.
- **GameSystems** `godot/addons/gs_host/`: `gs_host.gd` (`GSHost`), `gs_extension.gd`, `gs_context.gd`, `gs_event_bus.gd`, `gs_quality.gd`,
  `gs_physics_adapter.gd` (kun interface, implementeres i G2), `gs_error_trap.gd`, `data/tier_for.golden.json`, `tests/gs_host_tests.gd`, `LICENSE-NOTES.md`.
  Desuden `godot/project.godot` (minimalt projekt til test uden spil), `godot/tools/sync_addons.py` og `godot/tools/gen_golden.mjs`.
- **Kontrakt**: `ID`, `REQUIRES` og `QUALITY` læses med `Object.get()`, så de kan være konstanter eller properties. `init_extension(ctx)` skal returnere
  et api, der ikke er null. `update_extension(dt)` og `set_quality(tier)` returnerer `false` ved fejl. `dispose_extension()` er valgfri. `ctx.fail(reason)` giver op eksplicit.
  Kilden kan være et objekt, et Script, en PackedScene, en sti eller en `Callable(options)`. `init` er synkron i Godot.
- **Fejlisolering**: GDScript har ingen exceptions, og en typet `-> int` returnerer 0 efter et crash. Derfor tæller en `Logger` (`OS.add_logger`, 4.5+)
  script-fejl på main-tråden under hvert kald. Et crash, en returværdi `false`/null eller `ctx.fail` fjerner kun den extension, og en lytter, der crasher, bliver rapporteret.
  En rigtig runtime-fejl er verificeret med `-- --real-crash`. Den er ikke med i suiten, fordi suiten afviser `SCRIPT ERROR`.
  Release-eksporter rapporterer måske ikke script-fejl. Der gælder kun returværdi-reglen.
- **Tiers**: `GSQuality.tier_for` matcher alle 728 JS-golden-cases (+ 20 `normalize_tier`). Når tier er `off`, er nodens `_process`/`_physics_process` slået fra (også hvis noden først bliver ready senere).
- **Events**: snake_case-navne (`xr_start` osv.) og `JS_NAMES`-mapping til JS. Payloads: `grab {owner, side, body, pose_id}`, `release {owner, side, body}`,
  `broken {body, at}`, `disconnect {owner, handedness}`, `hand_tracking_changed {owner, handedness, hand}`.
- **Sync**: `python godot/tools/sync_addons.py <spil> [gs_x ...] [--check]` kopierer `godot/addons/gs_*` + `LICENSE` og skriver `SOURCE.json`
  (samme nøgler som `addons/game_systems`, plus `dirty`, `generator` og `sha256_text`). Tekst hashes efter CRLF → LF (autocrlf), og Godots `*.uid`/`*.import` ignoreres.
  `--check` fejler ved redigerede kopier, ekstra eller manglende filer, kopier bagud for GameSystems og forældet golden (`gen_golden.mjs --check`).
  Godot-testen tjekker desuden kopiens hashes mod `SOURCE.json`.
- **Nightfall ved G1-implementering** (siden integreret på `main`): `addons/gs_host/` (synket kopi), `runtime/gs_core_events.gd` (observatør: poller `player.objects` efter spillerens
  fysik-tick og forbinder `shattered`-signaler i missionen plus OpenXR-session-, controller- og hand-tracker-signaler), et hook på 19 linjer i
  `runtime/game.gd` (`_attach_gs_host()` i `_start_mission`), `tests/test_gs_host.gd` (wrapper), `tests/test_gs_core_events.gd` og `tests/suites/gs.json`.
  Ingen extensions er loadet endnu, og det globale niveau er ikke koblet til comfort-menuen.
- **Tests** (snapshot = HEAD 4a07605 + kun G1-ændringerne, fordi andre agenters igangværende `baked_grasp_library.gd` ikke parser i working tree):
  `gs-host` 47/47, `gs-core-events` 11/11, `fast_tests.py --tier full`: 124/127. `combat` og `review-routes` fejlede allerede ved HEAD.
  `magazine-acquisition-budget` (1 ms realtidsbudget under 8 parallelle jobs) består alene 2/2 og bruger ikke G1-kode.
  `run_native_suite.py --only gs-* --only smoke --only game-systems` er grøn.
- **Næste (G3)**: fælles grasp-data og humanoid bone maps flyttes til versionsstyrede JSON, så Godot/WebXR kan
  dele golden-testede koordinatdata uden runtime-afhængighed på hinanden. `GSPhysicsAdapter` bruges
  kun til fysik, som ikke allerede håndteres af Godots rigid-body-kontakter.

## Afklaringer og risici

- **Godot-AGENTS.md**: modelroller (Astra til implementering, Luna til tests). Som Claude bruges Opus i stedet for Astra/Sol og Haiku i stedet for Luna.
  Det skal siges til brugeren og ikke skiftes i stilhed. Reglen om "WebXR JS reference only" og reglen om `addons/nightfall_characters` kræver brugerens beslutning.
  Parent ejer `assets/characters/**` og `tools/build_characters.*`/`character-export.*`, så de stier skal koordineres.
- **Fysikmotor**: rettet efter G0-kortlægningen: `project.godot` har `3d/physics_engine="Jolt Physics"`, så spil, flasker og held-drive
  er allerede på Jolt. Adapteren skrives mod Jolt; GodotPhysics3D er ikke et krav.
- **Godot-version**: værktøjet er 4.7.2 (`.tools/godot/engine.json`), mens `project.godot` siger feature "4.6". Lås gs-addons på 4.7.2.
- **Worktrees/branches**: auditten 2026-10-11 bekræftede, at `blood`, `npc-ai`, `interaction-fix` og `worktree-opus-physical-grasp`
  alle var forfædre til kbloods Godot `main`. De to gamle kloner blev fast-forwardet og branch-navnene fjernet; stash-noten står i
  [`improvement_backlog.md`](improvement_backlog.md). GameSystems, WebXR og Steam Frame/Godot bevares som adskilte projekter.
- **Licens (brugerens beslutning 2026-10-10)**: Godot-karaktermodulet bruger kun byggede karakterer (GLB + metadata) og ingen CharacterCreator-kode
  i runtime. Byggeværktøjet (`tools/build_characters.mjs`) læser WebXR-pluginet, hvis `vendor/cc` er fra MIT-commit `dc664c07`, og CharacterCreators
  GPL-commit gør genererede filer CC0. Hvis et modul alligevel ender med at indeholde GPL-kode, licenseres det modul som GPL-3.0-or-later.
  Det blandes ikke ind i MIT-moduler. Hvert gs-addon skriver sin licens og sit ophav i `LICENSE-NOTES.md`.
- **Konventioner**: hvis Godot's `finger_poses.gd` bruger en anden fingerrepræsentation end JS-rækkerne, skal G4/G6 indeholde en konvertering, og bagningerne skal genkonverteres.
- Golden-tolerancer kan skjule drift i iterative algoritmer (lukningens bisektion), så de skal testes på mange poser, ikke kun få.
- Ingen headset-tal endnu. Editor- og headless-tests beviser ikke Steam Frame-ydelse.
