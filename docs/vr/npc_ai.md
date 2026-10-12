# NPC AI for VR and active ragdolls

VR changes how an NPC occupies space. A character can fill the player's view, block
their physical reach or appear to invade personal space even when its world coordinates
are valid. AI needs spatial, timing and presentation rules in addition to navigation and
combat behavior.

## Behavior architecture

Separate perception, intent, movement, interaction and animation/physics:

- **Perception:** bounded sensing for player pose, line of sight, sound and mission state.
- **Intent:** a small state machine or utility layer selects goals such as approach,
  communicate, help, defend, retreat or recover.
- **Movement:** path following plus local avoidance, stopping distance and facing rules.
- **Interaction:** explicit offers, accepted actions, hand/object ownership and timeout.
- **Presentation:** animation/IK/active-ragdoll response that communicates intent.

Keep the AI tick slower than rendering when the design permits. Stagger NPC updates,
cap sensing queries, reuse navigation paths and wake detailed behavior near the player.
Do not run expensive sight rays or full-body physics on every NPC every frame.

## Player-aware space

Use the headset position and room-scale bounds to keep NPCs out of the immediate body
volume. Maintain configurable personal-space distance, approach speed and face proximity.
Stop before reaching through the player or colliding with tracked hands. Use clear
turn-taking cues before handing over an item or requesting a gesture. Keep NPC faces
and hands at comfortable distances and avoid sudden appearance behind the player.

The player may be seated, unusually tall, crouching or physically offset from the
virtual capsule. Base reach and proximity on the tracked head/hands plus a tolerant
player volume, not a fixed standing capsule alone. If tracking is lost, pause close
interaction and preserve a safe distance.

## Active-ragdoll interaction

AI intent produces target poses and force limits; the ragdoll reports contacts, balance
and recovery state. The AI should react to physical outcomes rather than assuming a
planned animation completed. Bound pushes, throws and knockback. Never use NPC force to
move the player's camera, and prevent an NPC from pinning the player between a body and
wall without an explicit gameplay escape.

Hand-offs should be transactional: reserve the object, present a stable grasp pose,
wait for select/grab confirmation, transfer authority, then release the NPC hand. A
timeout cancels the offer without teleporting the object. If the player lets go, choose
a predictable drop or return behavior.

## Testing and accessibility

Test eye-level conversation, seated play, quiet/fast movement, occlusion, path blockage,
NPC knockdown, tracking loss and multiple NPCs. Measure navigation/physics cost and
inspect behavior from the headset. Provide subtitles or visual intent cues for speech,
avoid requiring eye contact, and let players skip or interrupt long close-up interactions.
