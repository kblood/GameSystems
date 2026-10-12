# VR IK and avatar design

An avatar reconstructs an authored body from sparse measurements. It is an estimate,
not a second tracker. Use the head and controller/hand poses as hard targets, then solve
the untracked torso, shoulders, elbows, hips and feet with limits and confidence-aware
procedural rules. The existing [`ikvr_implementation.md`](../ikvr_implementation.md)
documents the JavaScript/WebXR implementation in `extensions/avatar` and
`extensions/grasp`; it is not the native Godot implementation.

## Spaces and body scale

Keep tracking poses in the XR origin's local space and avatar bones in skeleton space.
Convert between them once per update and test rotated/translated parents. Track player
floor height, eye height, arm span and authored rig proportions separately. Calibrate
without changing the XR camera's tracked pose. Keep a stable avatar root and move/turn
the player through the origin/body layer.

There are two valid scale policies. **Fit the avatar to the player** for social presence
and body ownership. **Fit the world/interaction model to the authored character** when
the game requires a fixed character size. Each has costs: fitting the avatar can distort
the authored silhouette; fitting the world affects reach, locomotion, collision, object
mass cues and comfort. Avoid per-frame scale changes and provide a clear recenter action.

## Solve order

1. Read the current tracked head and hands and validate age/confidence.
2. Place avatar root from the selected height/scale policy.
3. Solve spine and shoulders with bounded offsets and a stable forward direction.
4. Solve each arm with two-bone IK, a preferred elbow plane and reach clamps.
5. Drive hands from tracked hand joints when valid; otherwise infer finger pose from
   controller actions or interaction context.
6. Estimate legs and feet from root motion and gait; do not pretend the feet are tracked.
7. Apply animation/secondary motion without moving hard-tracked head/hand targets.

Use a confidence state for every input. During brief loss, smoothly hold or fade the
avatar limb; after a timeout, release interactions and return to a neutral estimate.
Never lerp a reacquired hand through a long path while it holds an object. Rebase or
release according to the interaction contract.

## Hands, IK and visible errors

Use consistent bone maps and bind-pose calibration. Validate left/right mirroring,
thumb opposition, wrist orientation and hand size on several rigs. Grip animations should
not override tracked finger articulation while the hand is visibly tracked. When the
source is only controller input, prefer authored contextual poses over guessed joint
precision.

Review the avatar from first person, mirror and external spectator views. Check hands at
maximum reach, elbows behind the torso, crouch, seated use, cross-body reach, weapon aim,
object attachment and tracking dropout. Use collision proxies for interaction; visual
skin is not a reliable collider. Keep the head mesh hidden or carefully clipped in
first-person view.

## Performance and tests

Use pooled math or reusable objects in per-frame solvers. Avoid per-bone scene searches,
allocating arrays and skinning multiple full-detail avatar copies. Update nonlocal NPC
avatars at reduced rates and quality when they are distant or occluded. Test numerical
edge cases (zero-length bones, unreachable targets, near-straight elbows), transform
spaces, scale policy, loss/reacquisition and headset frame cost.
