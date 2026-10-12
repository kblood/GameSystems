# Native typed puddles

`gs_bottles/GSPuddleStore` is a bounded Godot component store. The bottle break
manager supplies spatial placement, the existing decal/quad rendering and
ballistic splash droplets. Identity is explicitly authored as `liquid_kind`;
models, bottle names and colors never determine chemicals.

## Storage and consumption

`manager.add_puddle(position, normal, ml, color, kind)` returns a stable puddle
ID (or -1 when rejected). Nearby coplanar puddles merge their **separate** typed
components. `manager.puddle_store.components(id)` returns a detached view such
as `{ "petrol": 80.0, "water": 25.0 }`.

`puddle_store.withdraw(id, kind, ml)` returns actual consumed mL; other components
remain intact. A future fire adapter can withdraw explicitly authored petrol or
diesel; an extinguishing adapter can withdraw actual water/foam doses. Unknown
liquid cannot satisfy these typed requests. No native ignition, heat or sprinkler
simulation is provided by this store.

`evaporate(id, kind, ml)` separately receipts evaporation. `remove(id)` and
`clear()` receipt cleanup. The manager refreshes radius from actual stored volume
on its next simulation step.

For direct standalone store use, `create()` returns a stable ID and
`deposit(id, kind, ml)` returns accepted mL. Deposit takes ownership of the whole
valid request: invalid IDs, component/volume capacity rejection and evictions are
classified as removal. Do not redeposit the rejected remainder. Non-finite,
negative, zero or greater-than-one-million-mL requests are rejected without
ownership. Use the manager for external spill deposits; directly depositing into
its internal store bypasses its transport ledger.

## Permanence, visuals and budgets

All authored component amounts are stored, including water and foam. Legacy
`unknown`, `water` and `wine` retain the existing life/fade timing, but fading now
explicitly evaporates their actual amounts into the ledger. Other authored kinds,
including petrol/diesel/foam, persist until consumption, requested evaporation,
cleanup or budget eviction. Mixed fuel/water evaporates water independently and
keeps its fuel amount. This is bounded persistence, not unbounded world storage.

The existing rendering tiers still cap live puddles at 24/12/6/2 and droplets at
192/96/32/12. Puddle records and rendered entries share that limit: the oldest
record is explicitly removed when exceeded or when quality is reduced. Each
record supports at most 16 component kinds and one million mL. No per-tick
search over an unbounded world is added. Geometry clipping remains creation/growth
work rather than a per-frame ray pass. A separate World3D owns a separate manager;
the existing per-scene lifetime boundary is preserved.

`manager.liquid_ledger()` satisfies:

```
added_ml = held_ml + airborne_ml + consumed_ml + evaporated_ml + removed_ml
```

Droplet recycling, quality downgrade, leaving reachable ground and cleanup have
explicit removal receipts. Droplet landing transfers volume instead of counting
it as fresh external liquid. Pour landing captures the parcel kind, and HIGH
hole-stream batches capture kind/color, endpoint/normal, hit-or-miss, flight delay
and splash radius before source contents or its trajectory can change. Moving
the source flushes the old accumulation before recomputing the new trajectory.
Every captured field is inserted together in due-time order. A later short fall
can land while an earlier long fall remains airborne; equal due times retain
emission order.
Pending batches are capped at 256 per stream; excess volume receives a stream
`lost_ml` receipt and cannot turn into a later physical deposit.

## Checkpoints

`puddle_store.snapshot()/restore(state)` serialize stable IDs, components and
terminal ledgers. Restore validates finite amounts, limits, duplicate IDs and
balance before changing the live store.

`manager.capture_liquid()/restore_liquid(state)` additionally include puddle
placement/color/evaporation state and airborne droplet identity, positions,
velocities and amounts. JSON round trips are supported. Invalid geometry,
missing/duplicate storage references, oversize budgets or volume imbalance reject
the whole restore without modifying live liquid. Restore leaves physics shards
outside the liquid checkpoint.

Capture returns `{}` and restore returns `false` while a live HIGH hole stream
exists. That stream has its own batched in-flight amount; a host-level bottle/stream
checkpoint must capture it before whole-scene saving can be promised. These APIs
do not serialize intact bottles, inventory, the pour transport or an entire game.

## Verified routes and remaining accounting work

`gs_puddle_tests.gd` covers 55 checks for typed merges, partial withdrawal and
evaporation, pool/volume/component limits, real ray-tested droplet landing,
pour/splash identity, HIGH leak FIFO identity/geometry, same-kind source motion,
miss-to-hit and long-to-short flight changes, captured splash doses, queue budgets, stable checkpoints,
atomic rejection and independent-world teardown. The neck-spurt route additionally
verifies source fill + emitted mL, display fill and physical mass after the debit.
Existing bottle, pour-receiver and resource-adapter
contracts remain green (29/22/29 checks).

Conservation claims apply to the manager-owned routes and explicit store transitions
covered by those contracts. Neck-snap's initial spurt now debits its actual 5%
before transferring typed volume into the manager.
Low-tier hole accumulators are now flushed into typed manager-owned droplets when a
bottle shatters; the remaining-fill splash stays separate because the accumulated leak volume was
already debited from the source. Bottle-owned sub-drop accumulators on an intact
bottle are still outside the liquid-only checkpoint and need a source checkpoint.
Native fire integration
still requires a separately implemented thermal/ignition adapter. WebXR retains
its existing separate pool/thermal implementation.
