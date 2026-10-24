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
