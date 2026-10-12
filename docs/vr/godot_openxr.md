# Godot OpenXR development guide

This guide targets Godot 4.x projects using OpenXR. The active NightfallContractsGodot
project pins its own engine/runtime/export setup; read that project's configuration
before applying generic advice. Godot's [OpenXR setup](https://docs.godotengine.org/en/4.7/tutorials/xr/setting_up_xr.html)
and [settings reference](https://docs.godotengine.org/en/stable/tutorials/xr/openxr_settings.html)
are the API reference.

## Scene and tracking structure

Use one `XROrigin3D` as the tracked space origin. Keep the headset and hand/controller
trackers beneath it. Put the collision body and movement policy in a player-body layer
that accounts for room-scale offset; the headset's tracked local position is not the
same thing as the character capsule's center. On every frame, consume the runtime's
poses in the documented reference space and do not overwrite tracked camera transforms
with gameplay animation.

For Godot 4.7's Vulkan OpenXR path, enable OpenXR in Project Settings before startup;
the interface is initialized before project scenes load. In the startup scene, look up
the interface, check `is_initialized()`, and enable XR output on the viewport. Do not
call `initialize()` again from `_ready()` on that path. A registered interface does
not guarantee a working runtime, so handle failure with a desktop/test fallback or a
clear error. On Android/standalone export, validate the OpenXR plugin, manifest,
permissions, feature extensions and renderer in an exported build, not only in the
editor. In Project Settings, also enable **XR > Shaders > Enabled** and use **Save &
Restart**. See [Godot 4.7 setup](https://docs.godotengine.org/en/4.7/tutorials/xr/setting_up_xr.html).

## Input, hands and optional extensions

Map semantic actions such as `grab`, `select`, `use`, `move`, `turn` and `menu` to
OpenXR actions. Do not make game logic depend on a physical button name. Offer suggested
bindings for supported interaction profiles and let SteamVR/other runtimes remap where
appropriate. Treat haptics as optional feedback.

OpenXR hand tracking is capability-dependent. Godot exposes hand joints through
`XRHandTracker` and `XRHandModifier3D`; controller-inferred finger poses and camera-based
optical tracking are different sources with different confidence and loss patterns.
Keep hand presence/tracking validity separate from the last known pose. Eye gaze is an
optional target pose, not a replacement for confirmation: pair it with a deliberate
select action and avoid using gaze for sensitive choices. Body tracking and eye gaze
extensions must be checked at runtime.

Godot's hand tracking notes explain the humanoid skeleton mapping and differences among
runtimes: [OpenXR hand tracking](https://docs.godotengine.org/en/latest/tutorials/xr/openxr_hand_tracking.html).
The [OpenXR registry](https://registry.khronos.org/OpenXR/) defines core behavior and
extensions. Mark links to `latest` docs as version-sensitive and verify against the
project's pinned release.

## Session focus and recentering

Treat OpenXR focus as an input-ownership boundary. `session_visible` means the app may
still render but is not receiving XR input; `session_focussed` means XR input is
available again. On focus loss, stop accepting gameplay actions such as firing, grabbing,
and locomotion, clear pressed/edge-trigger state and pose-derived velocity, and settle
held objects according to their interaction contract. Do not synthesize a release that
throws an object or fires a weapon. On focus regain, reacquire fresh poses and require
controls to return to neutral before re-arming held actions. Handle stopping/loss-pending
the same way before tearing down session-owned state.

`pose_recentered` has no transform argument; it reports that the user queued a recenter.
The runtime may change the pose reference, so invalidate pose-history, velocity and
cached reference-space data, then rebuild from fresh tracked poses. Avoid applying a
second recenter to the tracked camera/origin. Recalibrate only app-owned state that
depends on the old reference frame.
These signals are documented by Godot's
[OpenXRInterface](https://docs.godotengine.org/en/4.7/classes/class_openxrinterface.html).

## Locomotion and interaction

Choose locomotion per experience: room-scale walking, snap/smooth turning, teleport,
dash, vehicle movement or a deliberate combination. Never move the tracked camera by
directly animating it. Move the origin/body, preserve head offset, resolve collisions,
and clamp the resulting displacement. Provide comfort settings and allow the player to
recenter. Menus should remain reachable when seated and should not require precise
pinch tracking for essential actions.

For grabbing, separate hover, selection, attachment and release. Use a stable hand
attach point and explicit object pivot. Physics joints need bounded force, break rules
and safe handling of tracking loss. Avoid allowing the render hand to drift far from
the controller or tracked hand.

## Device checks

The Steam Frame [device evidence and pending acceptance log](../../../NightfallContractsGodot/docs/STEAM_FRAME_TESTING.md)
records builds and test runs chronologically; its latest entries do not establish headset
rendering, controller feel, comfort or frame-time acceptance. Use the latest dated section
for current evidence, and the target project's own configuration for its build/export setup.
At minimum test: startup with runtime available/unavailable; left/right bindings;
controller↔hand transitions if supported; tracking loss and recovery; losing focus to a
system menu or by removing the headset while holding an object or pressing a control;
regaining focus without an unintended action; runtime recenter while holding a prop;
floor/recenter; seated reach; every export target; and actual headset performance.
Godot documents fixed/dynamic foveation and related options
in [OpenXR settings](https://docs.godotengine.org/en/stable/tutorials/xr/openxr_settings.html),
but availability and tradeoffs belong to the runtime/device. Do not assume a setting
works because the editor exposes it.
