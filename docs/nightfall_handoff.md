# Nightfall integration: review handoff (2026-10-04)

The review was cut short. This file records what was found so far. Nothing in any game project was modified.
The only thing created outside this file is a throwaway probe project in the session scratchpad (`physprobe`).

## 1. Projects under C:\Devstuff\GameDev

| Project | Nightfall? | Engine | State |
|---|---|---|---|
| `NightfallContractsGodot` | **primary** | Godot 4.7.2 (`.tools/godot/editor/Godot_v4.7.2-stable_win64_console.exe`), OpenXR, **Mobile renderer** | Most developed: 20/20 test processes, candidate builds, already has bottles/liquid/shatter. Targets **Steam Frame** (Linux ARM64 standalone) + Windows/Linux PCVR. **No git repo.** |
| `NightfallContracts` | yes (older) | three.js 0.170 WebXR, vanilla JS, no bundler | Prototype (Danish README). Git is initialised but has **no commits**. No physics engine and no bottles/glass/grab of world objects (only pistol, magazine and slide). Quest browser target. |
| `NightfallHandsFixture` | yes (test fixture) | copy of the Godot project | Isolated device/hands fixture. Has its own copies of the addons. Do not integrate here. If anything, mirror into it later. |
| IWSDK, CharacterCreator*, CharacterStudio, makehuman-js, bioshock-vr | no | - | Not relevant. IWSDK is a separate Meta IWSDK sandbox. |

**Guardrail conflict to raise with the user.** `NightfallContractsGodot/AGENTS.md` says agents must use `openai-codex/gpt-6-astra`. `NightfallContracts/AGENTS.md` requires `gpt-6.1-sol`. The coordinator plans Opus/Sonnet agents, so the user must explicitly override this. The same AGENTS.md also says: no edits to sibling projects, the WebXR JS is reference only, and test in isolated fixture copies, never the shared `.godot` cache.

## 2. Godot game: key files (NightfallContractsGodot)

- `project.godot`
  - Mobile renderer, MSAA 2x, ETC2/ASTC, physics ticks **72 Hz**, **no autoloads**.
  - **No `physics/3d/physics_engine` key.**
  - Layer names: 1 World, 2 Player, 3 Guard zones, 4 Interactables.
- **Physics engine.** A probe with the same 4.7.2 binary (empty project, `features 4.6 Mobile`) gave these resting depths for a 0.5 kg cylinder:
  - DEFAULT: −10.1 mm, never sleeps
  - explicit GodotPhysics3D: −10.1 mm, never sleeps
  - explicit "Jolt Physics": −0.02 mm, sleeps
  - So **Nightfall currently runs GodotPhysics3D**, while the library is tuned on Jolt (`penetration_slop=0.002`).
  - Switching engines would invalidate the game's validated physics: 36 interaction physics checks, the grab drive, CCD, guards and the player CharacterBody3D. This is the biggest decision for the user.
- `runtime/game.gd`
  - `_start_mission()` builds `NightfallAudio`, `NightfallBallistics`, `ContractWorld`, the player (`scenes/player.tscn`), the mirror and the HUD.
  - The F5 restart reloads the scene.
  - Tree metas: `mode`, `nightfall_avatar_selection`.
- `runtime/player.gd` (`NightfallPlayer`, CharacterBody3D, layer 2, mask 1)
  - `try_grab_object(side)`: sphere probe of radius 0.075 on mask **8**, group `nightfall_grabbables`, `can_grab`, then `begin_grab`. It also special-cases `NightfallDroppedMagazine`.
  - `sample_throw`, `release_object` and the `update_grab` loop in `_physics_process`.
  - `structural_head_obstructed()` excludes `object is NightfallGrabbable`. **New bottle classes must be excluded too.**
  - `connect_noise_tree` connects every `interaction_noise` signal.
- `addons/nightfall_interaction/`
  - `grabbable.gd` (`class_name NightfallGrabbable`, RigidBody3D):
    - layer **9** (World+Interactables), mask **11**.
    - The grab contract is `can_grab`, `begin_grab`, `update_grab`, `get_grasp`, `end_grab`, `is_held_by`, `cancel_all_grabs`, `reset_interaction` (specified in `docs/UPGRADE_HANDOFF.md`, `docs/INTERACTABLES.md`).
    - The drive lives in `_integrate_forces`: 42 m/s² cap, 1.5 Nm, release clamp 9 m/s / 22 rad/s.
    - Break at 3.6 m/s.
    - `receive_ballistic_hit`.
    - Signals: `interaction_noise(at, radius)`, `shattered`.
  - `interactable_factory.gd`: `create(kind)` for bottle/mug/can/tool/carton, procedural meshes, `features` descriptors (grip regions/poses).
  - `liquid.gd` + `assets/interactables/liquid.gdshader`: CPU-clipped liquid at 20 Hz, sealed only, no pour.
  - `effects.gd`: 32 shards, 6 stains, 6 voices, synthesized sound.
  - `magazine.gd`, `geometry.gd`.
- `runtime/ballistics.gd` (`NightfallBallistics`)
  - Player shots use mask 5, enemy shots `ENEMY_MASK` 23.
  - It calls `receive_ballistic_hit(end, direction)` on the **nearest** collider only. There is no pass-through.
- `runtime/audio_bus.gd` (`NightfallAudio`)
  - 16 pooled AudioStreamPlayer3D, synthesized PCM, `play_at(id, at, volume, occluded)` with an occlusion low-pass.
  - **No bus layout** (Master only).
- `world/contract_world.gd` (`ContractWorld`)
  - Levels are built in code with `PropFactory.box/build/imported/sign_text`.
  - One depot of 26x38 m. Walls are boxes and there are **no windows/glass anywhere**.
  - `_build_interaction_bench()` places 2 bottles + mug/can/tool/carton at the dock bench (-4.35, 0, 15.8). Liquid fill/tint are set per bottle.
  - Forwards `interaction_noise` to guard hearing.
- `world/prop_factory.gd` (`PropFactory`): shared materials cache, StaticBody boxes, imported GLBs from `assets/industrial/` (SHA256.json catalogue).
- Guards: `runtime/guard.gd` is on layer 16 (layer 5). Hit zones in `addons/nightfall_characters/character_actor.gd` are on layer 4 (layer 3).
- Tests:
  - `tests/run_native_suite.py`, `tests/run_interaction_tests.py` (makes an isolated temp project).
  - `tests/test_interaction_physics.gd`, `test_interaction_world.gd`, `test_liquid_render.gd`.
  - These tests reference `NightfallGrabbable` and the factory and must keep passing or be updated.
- Save/load: only the avatar selection (`addons/nightfall_creator/avatar_selection.gd`). There is no mission save, and F5 is a full reset. So bottle/pane persistence is **not needed now**. `GlassPane.get/set_damage_state` exists. BreakableBottle has no state serialization.
- Performance: one shadowed directional light, unshadowed omnis. The docs make no FPS or headset budget claim (unmeasured).

## 3. Library facts relevant to integration (C:\Tools\BlenderShared → GameSystems)

- Remote `https://github.com/kblood/GameSystems.git`. Two commits.
- `export/` is 131 MB and `audio/wav` is 10 MB.
- Consumption today: `demo/sync.ps1` copies into fixed paths.
- **Hardcoded `res://` roots must be parameterised before the files can live in an addon folder.** These are:
  - `shaders/godot/bottle_liquid.gd:55-56` preloads `res://bottle_liquid.gdshader` and `res://bottle_glass.gdshader`.
  - `bottle_factory.gd:16` `ROOT := "res://assets/"`.
  - `breakable_bottle.gd:21,74` `asset_dir "res://"`.
  - `audio_hub.gd:14` and `bottle_audio.gd:15` use `res://audio/wav`.
  - `bottle_break_bench.gd:34`.
- Autoloads expected: `QualityTier`, `AudioHub`. Neither name collides with Nightfall (it has no autoloads).
- class_name collisions with Nightfall: **none**. Nightfall's classes are ContractWorld, GuardBrain, InputGate, MissionState, Nightfall*, PropFactory and WeaponState.
  - There are two predictors: generic `PathPredictor` and `GlassPathPredictor`. These are still to be reconciled.
- Layers and masks:
  - Bottle default layer 8 / mask 1|2|8.
  - Shards are on 1<<19.
  - Panes are on 1|(1<<20).
  - Decal cull excludes render layer 20.
  - Pour puddle rays use masks 1|2|8. **The Player layer 2 is included, so a stream could make a puddle on the player capsule.** The mask must be configurable and set to 1|8 for Nightfall.
  - Nightfall needs bottles on **9 / mask 11** (`opts.layer/mask` exist). Layers 20 and 21 are free in Nightfall.
- `BreakableBottle`:
  - It has its own `_integrate_forces` (impact assessment, prediction). The Nightfall grab drive also lives in `_integrate_forces`, so an adapter must merge them, e.g. `NightfallBreakableBottle extends BreakableBottle` overriding and calling `super`.
  - `BottleFactory.spawn` instantiates BreakableBottle directly. It needs an `opts.body_script` (or similar) hook.
  - `set_held(h, hand_body)` and the group `bottle_hands` exist.
  - `receive_ballistic_hit` is implemented (500 J, plastic leaks).
  - It does **not** emit `interaction_noise`; an adapter must map `broke`/`impact_assessed` to noise.
- `BottleBreakManager` and `GlassSystem` auto-create under `tree.root`, with a static `current`. They **survive the F5 scene reload**. Check for stale debris and references and call `clear_debris()`/`clear_all()` on reset.
- Audio:
  - `BottleAudio` uses bus `SFX` (falls back to Master), 16 voices, plus `_process`.
  - Together with NightfallAudio's 16 voices and Effects' 6, that is 38 3D voices. Reduce on Frame.
  - BottleAudio has no occlusion.
- Glass: `docs/glass_system.md` "Integration → Nightfall" already gives a 4-step recipe:
  - tier MEDIUM, `use_refraction=false` (Mobile renderer)
  - `fire_bullet` for pass-through
  - `GlassSystem.track(body)` on release
  - meta `glass_striker`
- Demo wiring reference (`demo/main.gd`):
  - `_build_glass` (GlassSystem child, tier follows `QualityTier.tier_changed`, `GlassAudioAdapter`)
  - `grab`/`release` (gravity_scale 0, velocity steering, `glass.track`)
  - `shoot()` (GlassSystem.fire_bullet, then `FastImpact.fire` per segment, muzzle 1000 m/s because hitscan can hang)
  - `uncap`/`_set_cap` (`ctl.cap_open`)
- three.js port status:
  - Only `shaders/three/bottle_liquid.js` + `liquid_lut_v2.js` exist (HIGH only, no lower tiers).
  - `designs/three/bottle_design.js` is untested on v2.
  - Missing for WebXR:
    - glass shader port
    - breakage/shards
    - pour/stream/puddles
    - leaks/hole marks
    - audio
    - glass panes
    - quality tiers
    - a physics engine (the WebXR game has none; `src/weapons/effects.js` uses a Y=0 floor only)

## 4. Conflicts spotted

1. Physics engine: Nightfall uses GodotPhysics3D (implicit), the library uses Jolt + slop 0.002. Either switch Nightfall to Jolt and re-run the whole suite, or validate the library on GodotPhysics. Resting bottles then sink about 1 cm and never sleep, which breaks the "idle = 0 cost" goal.
2. Two bottle systems: Nightfall's procedural `NightfallGrabbable` bottle + `liquid.gd` vs the library's BreakableBottle + BottleLiquid. Decide whether to replace or coexist. Tests in `tests/test_interaction_*.gd`/`test_liquid_render.gd` assume the old bottle.
3. Grab contract: library bottles lack `begin_grab/update_grab/...` and `features` descriptors (needed for hand poses `object_wrap`/`object_neck`).
4. Layer/mask defaults (8 / 1|2|8) vs Nightfall (9 / 11). Pour rays hit the Player layer. `player.gd` excludes only `NightfallGrabbable` from the head-obstruction probe.
5. Hardcoded `res://` paths in the library (see 3).
6. Root-level auto-created managers persist across F5. Autoload `AudioHub` also persists.
7. Audio voice budget, plus no shared bus/occlusion.
8. Model guardrails in AGENTS.md (Astra/Sol) vs the planned Opus/Sonnet agents.
9. The Godot project has no VCS. Recommend `git init` + commit before any integration.

## 5. NOT yet looked at (split these)

- The rest of `runtime/player.gd` (XR input actions for a possible uncap/pour gesture; free buttons in `xr/nightfall_actions.tres`, `tools/build_action_map.py`) and `docs/HANDS.md` (hand pose names, finger calibration per pose).
- `runtime/game.gd` beyond line 140 (HUD, `_process`, reset/suspend paths, the F5 code path), `core/*`, `runtime/guard.gd` hearing radius usage.
- `docs/VALIDATION.md`, `REVIEW_RESULTS.md`, `STEAM_FRAME_TESTING.md`, `EXPORTING.md`, `IMPLEMENTATION.md`; `export_presets.cfg` (include filters: new GLBs/wav/json must be packed); `tests/run_native_suite.py` (how to add tests).
- `addons/nightfall_interaction/grabbable.gd` lines 35-160 (begin_grab descriptor details), `effects.gd`, `geometry.gd` in full.
- The WebXR project beyond the grep: `src/game/world.js` level building, `src/weapons/audio.js`, `docs/DESIGN.md`, `tools/build_assets.mjs`, `tools/stage_site.mjs` (asset staging), and whether adding a physics lib (Rapier WASM) fits its "no CDN, staged static site" rule.
- Library: `bottle_binding.gd`, `bottle_factory.gd` spawn internals, `bottle_audio.gd` budget, `fast_impact.gd` hitscan bug status, `designs/three/bottle_design.js`, GLB sizes per tier (pack size on Frame).
- No Frame/Quest performance numbers exist for any library system (desktop RTX 3080 Ti only; glass doc estimates about 3x slower on Quest class).
- Level design: where glass/bottles make sense in the depot. Candidates: checkpoint booth window (wall at x=-2, z≈6), records office (x 6..13, z −18..−10) observation/teller window, wired-glass partition at the records door, bottles on the warehouse rack / locker bench / office desk. Not yet decided.

## 6. Draft stage list (Godot game first; effort; suggested model)

| # | Stage | Where | Size | Model | Test |
|---|---|---|---|---|---|
| 0 | `git init` + baseline commit of NightfallContractsGodot; run `tests/run_all.ps1` baseline | game | S | Sonnet | suite green |
| 1 | Library: parameterise `res://` roots (one `GameSystemsPaths` const or script-relative); configurable pour/puddle ray mask; `opts.body_script` hook in BottleFactory; fix the FastImpact hitscan loop | library | M | Sonnet (review Opus) | demo `--rest`, `--glass`, pour/stream tests |
| 2 | Library as Godot addon layout `addons/game_systems/{bottles,glass,audio,shaders}` + `assets/game_systems/` (or keep library repo layout and sync into it); new sync script with target-project arg | library | M | Sonnet | demo imports clean from the addon path |
| 3 | Decide the physics engine (user). If Jolt: set `3d/physics_engine="Jolt Physics"` + slop 0.002 and re-run the full suite, fix regressions. If GodotPhysics: run the library rest/break tests on GodotPhysics and tune | game | M-L | Opus | run_all + interaction tests |
| 4 | Sync addon into the game (isolated fixture copy first via `run_interaction_tests.py --prepare-only`); add autoloads QualityTier/AudioHub; QualityTier default per platform | game | S | Sonnet | headless import, no parse errors |
| 5 | `NightfallBreakableBottle` adapter: extends BreakableBottle, implements the grab contract (port the drive from grabbable.gd or extract it to a shared helper), `features`, group `nightfall_grabbables`, layer 9/mask 11, `interaction_noise` from broke/impact; player head-probe exclusion by group | game addon | M | Opus | new test_ like test_interaction_physics (grab, throw, break, noise) |
| 6 | Replace the bench bottles in `ContractWorld._build_interaction_bench` with library bottles (keep mug/can/tool/carton); update/retire old liquid tests | game | S | Sonnet | world test, visual capture (with permission) |
| 7 | Ballistics: keep nearest-hit `receive_ballistic_hit` (works now), then optional pass-through via `GlassSystem.fire_bullet` + `FastImpact` | game | S/M | Sonnet | test_interaction_world shot cases |
| 8 | Glass panes in the level (checkpoint/records windows) via `GlassPrefabs`; `GlassSystem` tier MEDIUM/LOW, refraction off; `GlassSystem.track` on release; panes emit noise | game | M | Opus | glass shots + throw test |
| 9 | Audio: BottleAudio on Master/SFX with fewer voices; optional occlusion via NightfallAudio rules | game | S | Sonnet | listen test (user) |
| 10 | VR uncap/pour: input binding (free button or twist gesture on the cap while the other hand holds), pour while tilted; bar/shelf props | game | M | Opus | desktop key + headset test |
| 11 | Reset/F5: clear BottleBreakManager/GlassSystem state on scene reset | game | S | Sonnet | F5 repeat test |
| 12 | Frame profiling + tier selection; export preset include filters for GLB/json/wav | game | M | Sonnet + user on device | device run |
| W1+ | WebXR: physics engine choice, then ports (glass shader, breakage, pour, audio, tiers) | library three/ + WebXR game | L | Opus | browser smoke + IWER |

Suggested tiers (unmeasured, to be confirmed):
- Steam Frame standalone: LOW for bottles (MEDIUM within 1 m via auto LOD); glass LOW, MEDIUM only for hero panes.
- PCVR: HIGH bottles, MEDIUM glass (HIGH costs 12 ms per brick shatter).
- WebXR on Quest: liquid only at LOW once tiers exist in the three.js port. Currently HIGH-only, so it is risky.

## 7. Consumption recommendation (draft)

The repo is public on GitHub, but it includes 131 MB of exports and a Python venv under `audio/.venv` (check that it is git-ignored), and the game has no git. Options:

- **Recommended:** a sync script with a pinned library commit. It copies `addons/game_systems/**` + needed assets into the game and writes `addons/game_systems/VERSION` (commit hash + file hashes, like the `SHA256.json` convention the game already uses). It works without git in the game and lets each game copy only the assets it uses (pack size on Frame).
- Git submodule: only after the game has git. It drags in all exports and tools, and Godot would import every GLB in the submodule unless `.gdignore` is used.
- A Godot addon folder (`addons/game_systems/`, with `plugin.cfg` registering the autoloads) is the right **target layout** whichever transport is chosen.

## 8. Open questions for the user

1. Physics: switch Nightfall to Jolt (and re-validate everything), or make the library work on GodotPhysics3D?
2. Replace Nightfall's own procedural bottles/liquid (`addons/nightfall_interaction`) or keep both?
3. Override the AGENTS.md model rule (Astra/Sol) for this work?
4. May we `git init` NightfallContractsGodot (and make a first commit in NightfallContracts)?
5. Which locations should get glass and bottles (checkpoint window, records office, a new bar/room)? Should guards react to breaking glass (noise radius)?
6. VR uncap/pour: which input (button vs twist gesture)? Should drinking or pouring matter to gameplay?
7. Is WebXR still a target, or is it frozen as a reference? If it is a target, which physics library is allowed?
8. Steam Frame vs Quest: which device is the performance reference, and what is the FPS target (72/90)?
