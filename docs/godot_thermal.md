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

`GSPuddleFireAdapter` composes with the existing `GSPuddleStore` through its public
`components` and `withdraw` methods. It consumes petrol before diesel for fuel heat,
and it accepts water or foam for extinguishing. Unknown liquids and colors never
masquerade as either category. The store's receipt remains the authority for how
many millilitres actually moved.

## Current limits and next work

This slice has no spatial proximity spread, room-to-room vents, sprinkler scheduler,
visual rendering, save/restore API or headset performance result. Host projects own
fixed-tick scheduling and must coordinate any future world checkpoint with bottle
sources. The next native increment is an independently testable sprinkler head and
typed supply adapter that draws water/foam only when its trigger and optional power
gate allow a dose. Then add spatial spread and checkpoint coordination against the
bounded core.

The `godot/addons/gs_thermal/tests/gs_thermal_tests.gd` contract exercises ignition, fixed-step debt, oxygen/smoke,
quenching, typed puddle receipts, heat conservation through links, and the maximum
object/link population: 33/33 checks pass on Godot 4.7.2.
