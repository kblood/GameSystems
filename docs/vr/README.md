# VR development guides

These notes are shared design and review principles for VR work across GameSystems,
NightfallContractsGodot and the separate WebXR projects. They explain choices to make
explicitly and failures to test for. For workspace-specific implementation notes and
links to project evidence, see the [GameDev VR development hub](../../../VR_DEVELOPMENT.md).
Each project's `AGENTS.md`, configuration and current implementation remain authoritative
for project-specific behavior. Reviewed 2026-10-13.

| Guide | Use it for |
|---|---|
| [Agent workflow](agent_workflow.md) | Planning, implementation, testing and handoff for AI-assisted VR work |
| [Godot OpenXR](godot_openxr.md) | Godot scene structure, tracking, input, export and device checks |
| [Godot ↔ WebXR ports](godot_webxr_porting.md) | Moving behavior between the native and browser projects without coupling them |
| [VR controls](controls.md) | Controllers, hands, gaze, locomotion, UI, grabbing and calibration |
| [IK and avatars](ik_avatar.md) | Tracked-pose reconstruction, body scale, animation and comfort |
| [Active ragdolls](active_ragdolls.md) | Physical characters with controllable pose goals |
| [NPC AI in VR](npc_ai.md) | Readable, safe NPC behavior around a room-scale player |
| [VR performance](performance_vr.md) | Frame budgets, rendering, physics and profiling on headsets |
| [Game performance](performance_games.md) | General performance practices shared by flat and VR games |

Hardware details and SDK behavior change. Confirm the current runtime, engine version,
interaction profiles and device capabilities before relying on any optional feature.
