# Godot addon contracts

Run the source-of-truth addon tests from the GameSystems Godot project with Godot 4.7+.

## One runner for all 44 scripts

```powershell
node godot/tests/run_all.mjs                      # all 44 scripts, 4 in parallel, 180 s timeout each
node godot/tests/run_all.mjs --only gs_grasp --jobs 2 --timeout 300
node godot/tests/run_all.mjs --list               # show what it discovers, run nothing
node godot/tests/run_all.mjs --godot <path-to-godot-console.exe>   # or set $GODOT
```

- It discovers every `*_tests.gd` under `godot/addons/*/tests`, `godot/tests` and `godot/demos`, so a new test file is
  included automatically (no list to forget). Helper/benchmark scripts that are not `*_tests.gd` are not run.
- It never writes to the project: `godot/` is copied to `<tmp>/gs_godot_tests/project` (override with `--workdir`, must be
  outside `godot/`) and each script runs there with `--headless --xr-mode off`. Godot's `.uid` files appear in the copy only.
- Every script has a timeout. A timed-out run is ended by its own PID (`taskkill /PID <pid> /T` on Windows); it never kills by
  process name.
- Output: a table (checks, failures, exit code, seconds) and a JSON report (`report.json` in the workdir, or `--json <file>`)
  with exit code, duration, checks, failures, errors and the last output lines per script. Exit code 1 when any script fails.
- A script fails on a non-zero exit, a timeout, `SCRIPT ERROR` / parse errors, a failure count above zero, or Godot's
  "leaked at exit / resources still in use" lines (`--ignore-leaks` demotes the last to a warning). Status 2026-10-24: 42 of 44 pass;
  `gs_backpack_container_tests.gd` and `gs_backpack_parity_tests.gd` report 0 failures but leave 7 ObjectDB instances and 2-3 resources
  alive at exit (reported, not fixed here).
- Godot is found via `--godot`, `$GODOT`, `godot` on PATH, or the Nightfall project's `.tools` copy next to this repository.

## The scripts (run one by hand)

```powershell
godot --headless --path godot --script res://addons/gs_backpack/tests/gs_backpack_container_tests.gd
godot --headless --path godot --script res://addons/gs_backpack/tests/gs_backpack_interaction_tests.gd
godot --headless --path godot --script res://addons/gs_backpack/tests/gs_backpack_parity_tests.gd
godot --headless --path godot --script res://addons/gs_backpack/tests/gs_backpack_tests.gd
godot --headless --path godot --script res://addons/gs_bottles/tests/gs_bottles_tests.gd
godot --headless --path godot --script res://addons/gs_bottles/tests/gs_pour_receiver_tests.gd
godot --headless --path godot --script res://addons/gs_bottles/tests/gs_puddle_tests.gd
godot --headless --xr-mode off --path godot --script res://addons/gs_cameras/tests/gs_camera_system_tests.gd
godot --headless --path godot --script res://addons/gs_electricity/tests/gs_electricity_tests.gd
godot --headless --path godot --script res://addons/gs_electricity_thermal/tests/gs_electricity_thermal_tests.gd
godot --headless --path godot --script res://addons/gs_fire_spread/tests/gs_spatial_fire_spread_tests.gd
godot --headless --path godot --script res://addons/gs_grasp/tests/gs_grasp_capture_tests.gd
godot --headless --path godot --script res://addons/gs_grasp/tests/gs_grasp_clamp_tests.gd
godot --headless --path godot --script res://addons/gs_grasp/tests/gs_grasp_closure_tests.gd
godot --headless --path godot --script res://addons/gs_grasp/tests/gs_grasp_held_drive_tests.gd
godot --headless --path godot --script res://addons/gs_grasp/tests/gs_grasp_merge_tests.gd
godot --headless --path godot --script res://addons/gs_grasp/tests/gs_grasp_mirror_tests.gd
godot --headless --path godot --script res://addons/gs_grasp/tests/gs_grasp_recorded_poses_tests.gd
godot --headless --path godot --script res://addons/gs_grasp/tests/gs_grasp_sdf_tests.gd
godot --headless --path godot --script res://addons/gs_grasp/tests/gs_grasp_throw_release_tests.gd
godot --headless --path godot --script res://addons/gs_grasp/tests/gs_grasp_validator_tests.gd
godot --headless --path godot --script res://addons/gs_grasp/tests/gs_grasp_variants_tests.gd
godot --headless --path godot --script res://addons/gs_grasp/tests/gs_nearest_grasp_tests.gd
godot --headless --path godot --script res://addons/gs_grasp_data/tests/gs_grasp_baked_data_tests.gd
godot --headless --path godot --script res://addons/gs_grasp_data/tests/gs_grasp_catalog_data_tests.gd
godot --headless --path godot --script res://addons/gs_grasp_data/tests/gs_grasp_closure_data_tests.gd
godot --headless --path godot --script res://addons/gs_grasp_data/tests/gs_grasp_held_drive_data_tests.gd
godot --headless --path godot --script res://addons/gs_grasp_data/tests/gs_grasp_quality_data_tests.gd
godot --headless --path godot --script res://addons/gs_grasp_data/tests/gs_grasp_recorded_data_tests.gd
godot --headless --path godot --script res://addons/gs_grasp_data/tests/gs_grasp_reference_hand_data_tests.gd
godot --headless --path godot --script res://addons/gs_grasp_data/tests/gs_grasp_validator_data_tests.gd
godot --headless --path godot --script res://addons/gs_host/tests/gs_host_tests.gd
godot --headless --path godot --script res://addons/gs_humanoid/tests/gs_humanoid_bone_maps_tests.gd
godot --headless --path godot --script res://addons/gs_sprinklers/tests/gs_sprinkler_tests.gd
godot --headless --path godot --script res://addons/gs_thermal/tests/gs_thermal_room_batch_tests.gd
godot --headless --path godot --script res://addons/gs_thermal/tests/gs_thermal_tests.gd
godot --headless --path godot --script res://addons/gs_thermal_portals/tests/gs_thermal_portal_tests.gd
godot --headless --path godot --script res://demos/sprinkler_fire/fire_station_demo_tests.gd
godot --headless --path godot --script res://tests/gs_bottle_leak_checkpoint_tests.gd
godot --headless --path godot --script res://tests/gs_gear_inventory_scene_adapter_tests.gd
godot --headless --path godot --script res://tests/gs_gear_inventory_tests.gd
godot --headless --path godot --script res://tests/gs_resource_adapters_tests.gd
godot --headless --path godot --script res://tests/gs_weapon_catalog_tests.gd
godot --headless --path godot --script res://tests/gs_weapon_loadout_tests.gd
```

(The camera suite checks API/scheduling behavior with the headless renderer; run it without `--headless` as described in
the camera addon README to verify actual SubViewport and monitor pixels.)

Run these source contracts before syncing addons to a game. A game's native suite should
then cover its integration paths, since it exercises player input, physical ownership,
weapons and scene lifecycle beyond the reusable addon API.

To check that the copies in the games and web apps are still in sync with GameSystems (read-only), run
`node scripts/check_sync.mjs` from the repository root.

## Captured grasp profiling

The focused native grasp promotion check is:

```powershell
node godot/tools/gen_golden.mjs --native-grasp --check
```

It checks eight closure fixtures and the SDF cases supported by the native
catalog, and requires those native shapes to equal current JS shapes. The
current native SDF scope is 70 cases; 45 JS cases for `barrel`, `ladder` and `pole`
are explicitly excluded because those catalog kinds have not been ported. A
change to that missing-kind set fails the check for review. This focused gate
does not claim those kinds or all other shared modules are current.

`--native-grasp --refresh-metadata` reconciles only source/probe hashes. It
compares all nine complete semantic payloads before writing any file, and
refuses changed expectations, schemas or other fields. Run the focused check
and the native SDF/closure suites after reconciliation. The unrestricted
generator/check still targets the full JS catalog and other shared systems;
its outstanding differences must not be hidden by this focused gate.

Promotion of only `gs_grasp` uses the explicit scoped sync gate:

```powershell
python godot/tools/sync_addons.py ../NightfallContractsGodot gs_grasp --golden-scope native-grasp
python godot/tools/sync_addons.py ../NightfallContractsGodot gs_grasp --golden-scope native-grasp --check
```

The scope is rejected for any other addon selection. It checks the nine fixtures
before writing generated copies and during the subsequent drift check. Default
sync checks retain the unrestricted golden check; scoped success is not a claim
that all shared systems or the complete JS catalog are synchronized.

`godot/tools/profile_grasp_capture.py` accepts a JSON fixture containing shared
closure `hand`, `shape`, `pose` and `options` inputs. The native game's offline
`experiment_bottle_thumb_replay.gd` exports this format from its saved paired
capture; the benchmark itself requires no game runtime.

From the GameSystems repository root:

```powershell
python godot/tools/profile_grasp_capture.py --godot <godot-console-executable> --fixture <captured-fixture.json> --output <profile-results.json> --samples 12
```

The tool creates instrumented source copies under ignored `godot/.godot/`,
leaving shipped addons unchanged. Every sample compares output with the original
solver and verifies input immutability. Results include source/fixture hashes,
untouched baseline timings, SDF and shape-validation calls, finger-chain and
per-digit closure costs, and actual `close_finger` loop-body executions.
Nested timings are inclusive and must not be added together. Instrumentation
overhead and host scheduling affect measurements; this is profiling evidence,
not headset performance or runtime acceptance. The initial
`godot/tools/bottle-capture-profile-results.json` records the pre-optimization
source hashes. It found 229–447 shape validations per candidate. The source now
validates once per synchronous finger-segment or palm sample batch and uses a
private SDF path that still checks every point. Public SDF calls retain shape
validation. The scoped native-grasp gate now permits this change to be synced
into NightfallContractsGodot without expanding the native catalog. The generated
manifest records the source commit, dirty state and actual file hashes.

For a separate uninstrumented comparison, use a fixed baseline commit:

```powershell
python godot/tools/compare_grasp_prevalidation.py --godot <godot-console-executable> --fixture <captured-fixture.json> --output <comparison.json> --samples 30 --baseline-ref cb976e3c32c5aca403af80f3dfa8ac667b6584dc
```

This alternates old/new call order and requires exact output equality and input
immutability on every sample. It materializes the baseline closure and SDF under
ignored `.godot/`; unchanged supporting catalog/default data comes from the
current checkout. The recorded after profile reduces shape validations from
447/309/367/229 to 78/55/60/37 for left-authored/left-native-thumb/right-authored/
right-native-thumb, while raw SDF call counts and closure loop counts remain
unchanged. `bottle-capture-prevalidation-comparison.json` records separate
uninstrumented before/after timings. These four captured inputs are a narrow
regression and profiling fixture, not general grasp or hardware qualification.

On Godot 4.7.2 headless / Ryzen 7 5700G, 30 alternating samples per case measured
median closure time before/after of 12.285/7.582, 8.491/5.124, 9.871/5.785 and
8.305/4.930 ms in that case order. Every sample preserved exact output and input
bytes. The captured cases and one host run bound this result; no native runtime
or headset performance improvement is claimed.

The scoped nine-fixture native-grasp gate now passes after a hash-only
provenance reconciliation; all case values stayed unchanged. Fresh generated
fixtures matched eight JS closure payloads and the 70 SDF cases supported by
the native catalog against both old and optimized source. The complete broad
golden check still reports stale files, and 45 additional JS SDF cases use
barrel, ladder, or pole kinds absent from the native catalog. Only `gs_grasp`
was synced to NightfallContractsGodot under the scoped gate; this does not
qualify or sync other addons.

`node godot/tools/gen_golden.mjs --classify` is a read-only inventory for the
broader gate. On 2026-10-26 it classified its 17 stale files as 13
provenance-only and 4 semantic changes. The semantic group consists of the
catalog data and golden files, the broad 115-case SDF fixture, and grasp
variants; it must be reviewed separately from the native
70-case SDF scope. The generated native catalog JSON is pinned to LF in
`.gitattributes` so its byte hash remains stable on Windows checkouts.


### Source-only cylinder-axis parity (2026-10-26)

Native catalog validation and SDF now accept optional lowercase cylinder axes
`x`, `y`, `z` (omission means Y). No eight-kind catalog promotion or generated
Nightfall addon sync was performed for this change.

Reproduce fresh JS comparison from the GameSystems repository root:

```powershell
node godot/tools/write_fresh_grasp_sdf_fixture.mjs --output godot/.godot/grasp-sdf-fresh-axis.json
& ..\NightfallContractsGodot\.tools\godot\editor\Godot_v4.7.2-stable_win64_console.exe --headless --path godot --script res://addons/gs_grasp/tests/gs_grasp_sdf_tests.gd -- --fresh-sdf-fixture=res://.godot/grasp-sdf-fresh-axis.json
```

The transient fixture records the JS catalog code/data and both generator hashes;
it embeds shapes so the 45 cases absent from the installed five-kind native catalog
can be evaluated without rewriting that catalog. It contains exactly 115 current
JS cases plus 22 dedicated axis/offset/parts probes. The source SDF run passed
1,572 checks, with distance tolerance `1e-10` metres and normal-component tolerance
`1e-7`; existing catalog validation passed 53 checks and closure passed 13,079.
Default/explicit Y equivalence and malformed-axis rejection are also covered.
Native validation deliberately rejects unknown axes that the permissive JS helper
would treat as Y.

This qualifies tested shape distances/normals, not arbitrary-axis grasp fitting:
native opposition remains around item Y, recorded-pose validation excludes
`pose.axis`, and native capture does not emit it. Hulls, mass/inertia and live
ladder use are outside this evidence. Review catalog/SDF scope and consumers
before promotion, then review variants. The broad golden gate remains separate.


### Catalog/SDF review-stage gate (implemented, execution pending)

`godot/tools/review_catalog_sdf.py` is a review-stage orchestrator. It has **not
been executed or covered by new tests** in this continuation: the current task
explicitly disallows new tests and verification runs. Earlier 1,572/53/13,079
results apply to the axis iteration above, not to this new gate.

The fixture writer now also supports read-only `--verify <fixture>`: it compares
all recorded source hashes and the entire regenerated JSON payload, including the
eight-kind catalog contract, 115 SDF cases and 22 axis probes. Previous fixture
files must be regenerated because their generator hash and payload are stale.
The standalone Godot `--fresh-sdf-fixture` consumer does not enforce these hashes;
use the new orchestrator for source-verified review.

Pending execution, from the repository root:

```powershell
node godot/tools/write_fresh_grasp_sdf_fixture.mjs --output godot/.godot/grasp-sdf-review.json
python godot/tools/review_catalog_sdf.py --fixture godot/.godot/grasp-sdf-review.json --godot ../NightfallContractsGodot/.tools/godot/editor/Godot_v4.7.2-stable_win64_console.exe --report godot/.godot/catalog-sdf-review-new.json
```

The orchestrator is designed to verify sources and semantics before creating a
temporary review project. It stages only the `gs_grasp_data` and `gs_grasp` addons,
replaces three files **inside that temporary project** (catalog data, catalog
golden and the 115-case SDF golden), then invokes the existing catalog, SDF and
closure regression scripts. A nonzero exit or an engine, script or parse error
diagnostic rejects the preflight. It records raw source/fixture/engine hashes and
rejects source drift before emitting a report. Reports must use a new path under
`godot/.godot`; existing reports cannot be overwritten. A failed run must not be
interpreted using an older report. Only exit zero plus the newly created report
would qualify the reviewed source state.

No catalog in the source tree, game addon, SOURCE.json or checked-in golden is
written by this gate. The report defines the future coordinated addon scope as
exactly `gs_grasp_data` plus `gs_grasp`, with three candidate data artifacts and
all source hashes available for review. It does not enable a new sync flag or
change the existing nine-fixture `gs_grasp`-only scope. Actual promotion needs
independent review of the candidate payloads, a deliberately updated promotion
scope and consumer impact; unrelated stale fixtures and variants remain outside
this gate. Review artifact byte hashes refer to Python JSON serialization, not
the canonical formatting produced by `gen_golden.mjs`.

Pending acceptance checks (not added or run): valid eight-kind stage; stale hash,
modified case/contract, changed kind/count and missing-input rejection; no source
or destination writes on any preflight failure; rejection when sources change
during execution; report overwrite/path rejection; all existing native regression
results; and explicit confirmation that neither game addons nor unrelated files
changed. The gate does not qualify pose-axis recording/opposition, ladder runtime
grasps, hulls, inertia or the full broad golden suite.
