# Porting between Godot OpenXR, Godot WebXR export and browser WebXR

There are two different WebXR targets in this workspace: a Godot project exported to
the browser through Godot's `WebXRInterface`, and the separate browser-JavaScript /
Three.js project. They do not share the same runtime or input implementation. Treat
Godot/Steam Frame, a Godot WebXR export and the standalone Three.js WebXR project as
distinct targets with an explicit shared behavior contract. The
[Godot port plan](../godot_port_plan.md) and project `AGENTS.md` define the current
boundary: browser JavaScript is reference material, not a native runtime dependency.
Port behavior and data formats; do not import a sibling project's runtime implementation
to avoid designing the native contract.

Godot provides a `WebXRInterface` for Web exports; see the
[Godot WebXR interface](https://docs.godotengine.org/en/4.7/classes/class_webxrinterface.html).
Godot 4.7's XR action map is currently part of its OpenXR module, so do not assume that
OpenXR bindings automatically cover a Godot WebXR export. Verify its input path on the
exact Godot release and target browser.

## What can be shared

Good candidates are engine-neutral state machines, typed IDs, gameplay rules, validated
JSON schemas, interaction semantics, deterministic tests and documented coordinate/unit
conventions. Keep rendering, scene nodes, physics bodies, controller binding, XR session
lifecycle, hand tracking and browser permissions behind platform adapters.

Before porting, define parity as observable outcomes: for example, “a grabbed object
remains attached while tracked hand pose is valid and releases once tracking is lost,”
not “both ports use the same class.” List intentional differences in timing, physics,
tracking features and available hardware.

## Boundary contract

For each shared system record:

- canonical units, handedness, forward axis and world/local spaces;
- stable IDs and serialized schema/version migration;
- input actions and semantic events, independent of button layout;
- lifecycle transitions and idempotent cleanup;
- who owns transforms and simulation results;
- supported and optional capabilities, including fallback behavior;
- tolerances for timing and physics differences.

Do not share a frame loop. Native Godot uses its engine frame/physics ticks and OpenXR
session. Godot WebXR goes through `WebXRInterface` and browser lifecycle callbacks; the
separate Three.js project owns its own WebXR session and browser animation frame loop.
Translate elapsed time and poses at each adapter boundary. Do not assume identical
controller poses, action bindings, hand-joint availability, haptics, eye tracking,
filesystem access or background behavior. See the
[Godot 4.7 XR action map](https://docs.godotengine.org/en/4.7/tutorials/xr/xr_action_map.html).

## Port sequence

1. Read both project contracts and the source system's current tests.
2. Extract the behavior and schema, then add engine-independent examples or fixtures.
3. Implement a target-platform adapter using that engine/runtime's lifecycle and input model.
4. Port tests around state transitions, loss/reacquisition and boundary conditions.
5. Add parity tests for shared outcomes; keep platform-specific integration tests local.
6. Test each build on its actual runtime/device and record deviations.
7. Sync generated copies only through the owning repository's established sync tool.

Never edit generated project copies as if they were canonical source. If one project
needs a local adaptation, document it in that project's adapter and provenance record.
When behavior intentionally differs, update the parity table and guide together.

## Common failure cases

The usual mistakes are copying coordinate transforms without checking axes, assuming
physics contacts are deterministic across engines, treating hand tracking as guaranteed,
using browser storage assumptions in a native game, tying UI logic to trigger names, and
claiming parity from matching unit tests while never running either headset build.
