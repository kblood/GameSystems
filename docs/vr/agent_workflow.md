# VR work guide for AI agents

VR changes affect comfort, body ownership, physical safety, input, frame timing and
platform compatibility at once. Start by reading the target project's `AGENTS.md`,
existing architecture docs and active backlog. Record which runtime and headset the
change targets. Do not silently combine the Godot/Steam Frame and WebXR projects.

## Before changing code

Write down the user-visible action, tracking source, coordinate space, authority over
the object or body, failure behavior when tracking disappears, and the performance
budget. Reuse the project's action layer and interaction interfaces. Check whether
controllers, optical hands, controller-inferred fingers, gaze, keyboard or gamepad are
supported, optional, or deliberately out of scope.

For tracked poses, specify the reference space and time of the sample. For avatar
dimensions, specify whether world scale follows the player or the authored character.
For physical interactions, state whether the hand pose, object pose, or physics solver
owns the final transform. Never infer a real-world action from an unvalidated gesture.

## Implementation rules

- Keep simulation, input interpretation, visuals and platform adapters separable.
- Make optional tracking sources capability-gated and provide a clear fallback.
- Treat invalid, stale or lost tracking as a normal state. Release or safely hold
  interactions according to the object's contract; do not snap a hand across space.
- Use explicit units, transforms and handedness. Convert once at a boundary.
- Avoid per-frame allocations, synchronous disk/network work, large scene-tree scans
  and unbounded physics queries in headset loops.
- Do not block movement or turn input while a modal UI is open unless the design says so.
- For networked interaction, define ownership, prediction and reconciliation before
  making a hand locally authoritative.

## Verification

Test pure state logic without a headset, then run the engine/editor import check, then
exercise the target runtime. Test tracking loss, reacquisition, handedness, seated and
standing play, a small and tall player, blocked reach, rapid turns and UI dismissal.
Record real-device frame timing and reprojection; a desktop editor result is not device
evidence. Include the exact command, engine/runtime version, device, render mode and
known untested paths in the handoff.

Review the interaction from the player's eye and hand positions. Check for camera
motion unrelated to the user's movement, inaccessible controls, hand/object mismatch,
body penetration, UI behind the player, and visible one-frame discontinuities. Ask an
independent reviewer to inspect both the implementation and the guide when the change
adds a reusable VR pattern.

## Handoff

Summarize the behavior and architecture, name the files and public contract, report
focused and broader test results, state whether a headset was used, and list remaining
platform assumptions. Update the relevant guide and backlog in the same change so the
next agent does not repeat an obsolete assumption.
