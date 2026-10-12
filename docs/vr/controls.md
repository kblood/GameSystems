# VR controls and interaction design

Build around semantic actions and tracked poses. A game action such as `grab`, `fire`,
`turn`, `confirm` or `menu` should survive controller remapping and input-source changes.
OpenXR interaction profiles and runtime bindings are the compatibility layer; physical
button layouts are hints for suggested bindings, never gameplay rules.

## Devices and input sources

| Source | Useful signals | Design notes |
|---|---|---|
| Quest Touch / Touch Plus | 6-DoF pose, trigger, grip, stick, face buttons, touch/capacitive states, haptics | Keep essential actions on clear press/squeeze inputs. Capacitive state can animate fingers but may be absent or remapped. |
| Steam Frame controllers | Valve documents 6-DoF, standard controller controls, touch states, grip, capacitive finger tracking; OpenXR profile is optional | Add its interaction profile when available and keep generic/OpenXR and Touch fallback bindings. Test actual runtime bindings. |
| Valve Index controllers | Trigger, thumbstick, trackpad, grip/force sensing and finger sensing | Finger sensing is not identical to optical hand tracking; expose a confidence/source-aware pose and a button-based fallback. |
| Optical hand tracking | Joints/poses, runtime gestures or hand interaction profile | Expect occlusion, confidence changes and hand loss. Use direct poke/pinch nearby and a pointer for distant targets. |
| Controller-inferred hands | Controller pose plus inferred finger state | Use for visuals and contextual poses; do not claim measured finger positions. |
| Eye gaze | Gaze pose/target, where extension and hardware exist | Use gaze to point or highlight; require a separate confirmation input to avoid accidental activation and reduce privacy exposure. |

Capabilities vary by runtime, version and device. For Steam Frame's OpenXR binding,
request `XR_VALVE_frame_controller_interaction` and suggest bindings for
`/interaction_profiles/valve/frame_controller_valve`. Godot's [OpenXR settings](https://docs.godotengine.org/en/stable/tutorials/xr/openxr_settings.html)
and the [Khronos registry](https://registry.khronos.org/OpenXR/) describe optional
extensions. Valve's [Steam Frame input reference](https://partner.steamgames.com/doc/steamhardware/steamframe/input)
and [Index controller page](https://www.valvesoftware.com/en/index/controllers) describe
Valve-specific hardware; Meta's [controller input](https://developers.meta.com/vr/documentation/unity/unity-tutorial-basic-controller-input/)
and [hand interaction](https://developers.meta.com/vr/documentation/unity/unity-handtracking-interactions/)
pages are useful device references, though their Unity APIs do not define Godot bindings.

## Locomotion and turning

Offer a consistent primary path and explicit comfort options:

- Room scale uses the tracked play area; gameplay movement must respect physical reach.
- Smooth stick movement should move the player body/origin while preserving the headset's
  local offset. Tune acceleration and speed in context and allow a lower-intensity option.
- Teleport should preview destination, slope, clearance and facing before commit.
- Snap turn is a practical default for sensitive players; smooth turn should be optional.
- Physical turning should not cause artificial yaw correction behind the player's back.
- Vehicles and moving platforms need a stable reference frame and an easy exit/recenter.

Never animate the camera separately from tracking to make the player “catch up.” Avoid
forced camera shake, head bob, roll and sudden acceleration. A seated mode should change
reach and UI placement, not only lower the floor marker.

## UI and gaze

Keep world-space panels within a comfortable reach and readable angular size. Provide
controller ray, direct pointer/poke and a non-gesture confirmation route. Large targets,
clear hover/focus states, dwell-free selection and immediate cancellation help across
controller, hand and accessibility inputs. Do not put an essential panel behind the
player or lock movement when it opens unless the interaction is intentionally modal.

For gaze, separate `look`, `hover` and `confirm`. Gaze data can be unavailable, stale or
permission-gated. Never log raw gaze paths by default; only collect what the feature needs.

## Grabbing, tools and physics

Use clear phases: candidate, hover, select, attach, held, release and lost tracking.
Define attachment pose and object pivot per item. Small props can follow a kinematic
attach transform; heavy objects should use bounded force/velocity control. Keep the
rendered hand aligned with the real controller and let physical constraints yield when
they cannot satisfy both hand and object motion. Prevent held-object tunneling, hand
penetration and high-energy joint explosions.

Prefer contextual two-hand behavior: the dominant hand selects, the support hand
stabilizes or adjusts. Make magazines, tools and weapons readable by touch/shape and
allow dropped objects to recover. Haptics should confirm meaningful events, not mask
ambiguous state.

## Avatar scale and calibration

Measure floor and height once, then let the player recenter or adjust. Store tracking
height separately from authored character height. Choose one explicit policy per mode:

1. **Player-sized world:** map the user's measured proportions to the avatar, clamping
   unusual values to a comfortable playable interval.
2. **Character-sized world:** keep authored character proportions and adjust reach,
   locomotion and interaction geometry so the user inhabits that body.

Never silently scale the entire world to fix a hand mismatch. Scale changes alter speed,
reach, collider size, perspective, physics and comfort. Recompute all dependent dimensions
atomically and show a calibration cue. See [IK/avatar](ik_avatar.md).
