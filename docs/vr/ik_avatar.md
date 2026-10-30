# VR IK and avatar design

## Body-height observation breaks (2026-10-26, static review only)

`setPosture('auto')` now clears the forced posture choice and starts a fresh
automatic estimate; standing/seated choices retain their existing behavior.
This adds no storage setting or persistence claim. The advanced Nightfall host
uses this API for explicit local-session posture selection and remeasurement.

`extensions/avatar/body_height.js` exposes `interruptObservation()` for host tracking,
focus and raw-time discontinuities. It resets automatic estimator samples/velocity
history and seated-to-standing dwell, retaining decided posture, standing/seated eye,
virtual crouch and applied offset. `onRecentered()` also invokes it while retaining
its original stick disarm. Invalid/nonpositive/over-100-ms `observe` timing or invalid
eye cancels evidence without applying that observation; unavailable/nonfinite gaze
resets the pending estimator. Hosts that clamp dt must still report raw gaps, and
hosts that skip `observe` on tracking/focus loss must call the interruption method.
The advanced Nightfall host now does so and skips the gap/recenter observation.
No recalibration event or storage write is emitted by interruption. This is source
review, not runtime acceptance; interrupted/fresh sample windows, stand-up dwell,
preserved applied state and ordinary continuous calibration remain untested.

An avatar reconstructs an authored body from sparse measurements. It is an estimate,
not a second tracker. Treat the tracked headset pose as the camera authority and tracked
hand/controller poses as authoritative input intent. The visible hands may yield to
collision or bounded body-reach constraints, with clear feedback when presentation no
longer matches the tracked pose. Solve the untracked torso, shoulders, elbows, hips and
feet with limits and confidence-aware procedural rules. The existing
[`ikvr_implementation.md`](../ikvr_implementation.md)
documents the JavaScript/WebXR implementation in `extensions/avatar` and
`extensions/grasp`; it is not the native Godot implementation.

## Spaces and body scale

Keep tracking poses in the XR origin's local space and avatar bones in skeleton space.
Convert between them once per update and test rotated/translated parents. Track player
floor height, eye height, arm span and authored rig proportions separately. Calibrate
without changing the XR camera's tracked pose. Keep a stable avatar root and move/turn
the player through the origin/body layer.

There are two valid scale policies. **Fit the avatar to the player** for social presence
and body ownership. **Keep a fixed authored character** when the game requires a fixed
character size: convert raw tracked poses and displacements once into the character's
authored world units, then use those converted coordinates for the HMD, hands, locomotion
and interaction queries. Keep authored geometry, colliders, gravity and world-space UI in
their existing world units; do not scale them again. Evaluate UI readability at the
resulting perceived scale. Fitting the avatar can distort the authored silhouette, while
tracking-to-world conversion changes perceived reach and movement and may affect comfort
or shared-distance consistency in multiplayer. Avoid per-frame scale changes and provide
a clear recenter action.

## Solve order

1. Read the current tracked head and hands and validate age/confidence.
2. Place avatar root from the selected height/scale policy.
3. Solve spine and shoulders with bounded offsets and a stable forward direction.
4. Solve each arm with two-bone IK, a preferred elbow plane and reach clamps.
5. Drive hands from tracked hand joints when valid; otherwise infer finger pose from
   controller actions or interaction context.
6. Estimate legs and feet from root motion and gait; do not pretend the feet are tracked.
7. Apply animation/secondary motion without moving the tracked camera; keep hand input
   poses authoritative while allowing collision-limited visual hand presentation.

Use a confidence state for every input. During brief loss, smoothly hold or fade the
avatar limb; after a timeout, resolve interactions according to their lost-tracking
contract and return the avatar to a neutral estimate. Never lerp a reacquired hand
through a long path while it holds an object. Rebase or release according to the
interaction contract.

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

## Lifecycle source review — 2026-10-26

### Late avatar-provider result ownership

The child lifetime previously could dispose while avatar was still null; a later provider result then failed assertAlive, but idempotent child.dispose did not repeat the skipped avatar cleanup. Canonical GameSystems avatar and the baseline facade now register the avatar release hook immediately after acquiring the result. createLifetime.onDispose invokes it immediately for an already closed child. A local release-once flag is set before calling provider disposal, so normal parent/child cleanup, late-result rejection and reentrant disposal issue at most one wrapper-owned release.

Baseline checks lifetime validity before awaiting avatar.ready, so an already retired result is released without waiting for another readiness promise. Canonical code likewise checks before measuring/asserting the character contract. Normal root cleanup order is preserved; no shared cache resources are traversed or disposed here. CharacterCreator's own signal-linked/idempotent resource owner remains unchanged. The selected advanced avatar sync updated only index.js and SYNCED.json.

Static source review and targeted diff check only; no tests or gameplay imports/runtime. The sync tool was executed solely to copy the maintained extension. Provider-internal failure before returning an owned result remains the provider's responsibility.
