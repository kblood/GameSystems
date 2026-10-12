# Godot native thermal/fire slice

`godot/addons/gs_thermal` adds a standalone gameplay heat/fire kernel for Godot.
It fills a platform gap: the WebXR thermal/fire extension already has rooms,
fuel pools and sprinklers, while the native `gs_bottles` addon previously provided
typed puddle storage only. This addon does not claim feature parity with WebXR.

## Public surface

- `GSThermalSystem.add_room(id, values)` creates a bounded room state with
temperature, normalized oxygen, smoke density, ventilation and heat capacity.
- `add_object(id, values)` authors position, optional room, ignition temperature,
  thermal capacity, flammability, finite fuel, burn rate and game-tuned heat yield.
- `link_objects(a, b, conductance)` creates an explicit material heat path.
  Transfers are batched simultaneously and weight-limited so a high-degree graph
  cannot amplify heat by processing order.
- `add_heat`, `ignite`, `apply_liquid`, `move_object`, and `configure_room` support
  host interactions. Room ventilation is a gameplay scalar; there is no airflow.
- `step(delta)` advances fixed 50 ms ticks, at most eight per call. A frame delta or
  retained debt beyond 400 ms is rejected without changing the clock; the host may
  split a long elapsed interval into multiple calls.
- `stats`, `object_state`, and `room_state` return bounded diagnostics or detached
  state views.

Caps are 256 objects, 64 rooms and 1,024 authored heat links. Each step is bounded by
those caps. Rooms track temperature, normalized oxygen and smoke density. Fuel depletion
adds heat to an object and its room; low room oxygen extinguishes its fire. Water
adds wetness and cools; foam suppresses burning through a separate coating amount.
Both use authored gameplay constants, not real-world material or fuel data. Runtime
object and room temperatures are clamped to the documented 1,000,000 °C state ceiling,
including heat from combustion, room coupling and authored links.

## Optional spatial spread

`godot/addons/gs_fire_spread` adds bounded proximity spread without adding per-pair work
to the thermal kernel. Register the thermal objects a host wants included, then call
`GSSpatialFireSpreadSystem.step(0.05)` once after each successful `thermal.step(0.05)` call
that reports exactly one step. Interleave
the calls; do not advance several thermal ticks in one call and apply spread only afterward,
because newly ignited objects need to become sources between ticks. The spread adapter rejects
any interval other than 50 ms. Burning objects heat dry, fueled, flammable neighbors in the
same non-empty room. The default is a 1.5 m
radius and 4 kJ/s source rate with squared linear distance falloff; newly ignited objects
only spread on the next interval. The adapter snapshots participants and preflights summed
heat before changing targets. It caps at 256 registered objects and one 50 ms tick per call.
Room IDs are authored spread barriers; this is not line-of-sight, airflow, or a fire-code
simulation. Hosts should include only objects in each fire zone and avoid registering
unrelated world props. The adapter uses a room-aware 3D cell grid and checks at most 16,384
source/target candidates per 50 ms call for 256 registered objects.

Run `godot --headless --path godot --script res://tools/benchmark_spatial_fire_spread.gd -- dense`
or replace `dense` with `sparse` to measure 128 burning sources plus 128 targets over 200
measured ticks after 20 warmups. On Windows with Godot 4.7.2 and a Ryzen 7 5700G, one local
run measured dense average/P95/max **5.15/6.23/7.97 ms** and sparse **2.63/3.93/6.36 ms**
per 50 ms spread tick in the recorded local run. Treat these headless desktop measurements
as historical diagnostics, not a headset performance gate; rerun the benchmark for current
hardware comparisons and profile on the target VR hardware and scene.

`GSPuddleFireAdapter` composes with the existing `GSPuddleStore` through its public
`components` and `withdraw` methods. The runnable fire-station demo now includes a
persistent mixed diesel/water puddle: a bounded diesel dose ignites a thermal target,
and a typed water dose wets and extinguishes it. The adapter consumes petrol before
diesel for fuel heat, accepts water or foam for extinguishing, and uses actual store
receipts. Its optional `try_auto_ignite_from_hot_source` checks same-room distance,
typed petrol/diesel auto-ignition thresholds, oxygen and target wetness before spending a
receipt. The fire-station host calls it on thermal fixed ticks, so the nearby hot pallet can
ignite the spill without a manual command. It requires a rollback-capable store; if a generic
store returns less fuel than planned, the adapter restores that receipt before changing heat.
Auto-ignition and manual ignition both stay inhibited while target wetness exceeds the small
dry threshold, so the persistent hot pallet cannot immediately relight a freshly quenched
spill. Thresholds are authored gameplay values, not real fuel specifications; unknown liquids
and colors never masquerade as fuel. This remains coarse host wiring, not a continuous
pool-fire or vapor model.

## Current limits and next work

The optional spread adapter does not include room-to-room vents, visual rendering or
headset performance results. `checkpoint()` captures rooms, objects, links and pending
fixed-step time in a versioned JSON-friendly payload. `restore_checkpoint(payload)`
validates the whole payload in a temporary system before replacing live state. Room and object
rows preserve runtime insertion order because that order also determines fixed-tick event order. Hosts must
pause their world while capturing/restoring thermal, liquid-source, supply, battery, pump
and sprinkler snapshots at the same boundary; bottle source snapshots remain separate.
The documented provider order is not a transaction: stage/preflight every provider before
swapping the active world, or keep rollback snapshots for every subsystem until commit.

The `godot/addons/gs_thermal/tests/gs_thermal_tests.gd` contract exercises ignition, fixed-step debt, oxygen/smoke,
quenching, typed puddle receipts, heat conservation through links, and the maximum
object/link population. The core checkpoint suite passed 42/42 on Godot 4.7.2 in its
last recorded run, including JSON roundtrip, malformed-payload atomicity and deterministic
next-tick restore. Adapter regressions since then extend the same script; the current
thermal/fire contract now passes 51/51 on Godot 4.7.2, including refunding a generic
fuel withdrawal when its callback changes room oxygen before heat is committed.
