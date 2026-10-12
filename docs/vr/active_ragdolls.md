# Active ragdolls in VR

An active ragdoll combines a physical skeleton with a target pose. It should preserve
useful collisions and weight while following animation or IK goals. It should not force
the player's tracked hands and head to obey a body solver. For player avatars, tracking
is authoritative at the head and hands; for NPCs, animation/AI is authoritative and
physics provides response.

## Layers

- **Target pose:** animation, IK or gameplay intent in a stable reference frame.
- **Physical rig:** bodies, joints, mass, limits and collision filters.
- **Drive controller:** bounded torques/forces or joint targets that pull the rig toward
  the target while allowing impacts and constraints to win.
- **Presentation:** skinned mesh follows the physical rig or a filtered blend of target
  and physical pose.

Keep target generation independent from the physics solver. Sample targets at a known
tick and interpolate only where needed. Apply forces in the physics step, not from an
unbounded render callback. Clamp drive strength, angular velocity and impulse; define
joint break/failsafe behavior.

## VR-specific rules

The player can physically move hands faster and farther than a plausible body can
follow. Do not use the torso to pull tracked hands back. Instead, let the avatar body
stretch within a designed limit, soften the body response, or fade to a tracked-hand
representation. Avoid camera motion from body collision or ragdoll correction. The
player's physical head remains the camera authority.

For NPCs, attacks and reactions must stay legible in the headset. Keep collision near
the face bounded, avoid sudden knockback toward the camera, and do not let a solver push
the NPC through the player. Use capsule/hand proxies for interaction and filter internal
bone collisions that add cost without gameplay value.

## State and recovery

Use explicit states such as `animated`, `braced`, `staggered`, `falling`, `recovering`
and `disabled`. Define entry/exit thresholds with hysteresis so impacts do not cause
rapid state flicker. Recover by blending the target pose and joint drives over time;
do not teleport limbs through the player or nearby geometry. If a joint breaks, tracking
is lost, or the rig becomes unstable, reduce drive and return to a safe pose.

## Validation

Test with small/large body proportions, fast arm swings, wall reach, grabbed props,
collisions, stairs, prone/fall recovery and two ragdolls nearby. Record solver time,
substeps and active body count on the target headset. Headless solver tests verify state
transitions, but only a headset can reveal camera disturbance, visual jitter and comfort
problems. Start with fewer bodies and simpler constraints; increase complexity only
when profiling shows headroom.
