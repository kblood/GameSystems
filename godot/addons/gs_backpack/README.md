# gs_backpack

`GSBackpackApproach` is a small, reusable policy object for deliberate
over-shoulder backpack access. Feed it body-local hand positions at the host's
tracking cadence, then ask `check()` when a retrieve action occurs. It bounds
sample time, movement discontinuities and history lifetime, and rejects paths
that cross behind the shoulder below a clearance plane.

The component does not own inventory, scene nodes, collision queries, audio,
haptics, or a bag model. Pair it with `gs_gear_inventory` for item ownership and
let the game decide when to query visibility or play feedback.

`GSBackpackInteraction` composes this policy with the scene adapter's gated
`request_retrieve()` API. By default, the `back` slot requires the deliberate
approach; other slots use the adapter's normal tracking, reach and occlusion
checks. The bridge never changes ownership or reparents an item itself, so it
can be used with the same gear inventory as holsters and tool belts.

```gdscript
var approach := GSBackpackApproach.new()
approach.observe("right", tracked, backpack_local_hand, shoulder_y, delta)
var result := approach.check("right", backpack_local_hand, shoulder_y)
if result.allowed:
	# The host still validates its slot and item transition.
	pass
```

Reset a side on tracking loss, hand ownership changes, teleport, or pack reset.
The tests cover both mirrored hands, tracking loss, jumps, hitches, expiry and
body-crossing rejection. `gs_backpack_interaction_tests.gd` verifies the
composition and confirms rejected reaches never call the host adapter.
