# gs_thermal_portals

Bounded gameplay exchange between authored `GSThermalSystem` rooms. A portal can
represent a door, hatch or vent: opening `0` disables exchange through that portal,
while opening `1` enables its authored exchange rates. Other portals may still connect
the same rooms. There is no airflow, pressure, buoyancy, direction, geometry query or
CFD simulation.

```gdscript
const Thermal = preload("res://addons/gs_thermal/gs_thermal_system.gd")
const Portals = preload("res://addons/gs_thermal_portals/gs_thermal_portal_system.gd")

var thermal := Thermal.new()
var portals := Portals.new(thermal)

func setup() -> void:
    thermal.add_room(&"hall", {"temperature_c": 20.0})
    thermal.add_room(&"kitchen", {"temperature_c": 120.0, "smoke": 2.0})
    # Openings default to 1.0, so author a closed door explicitly.
    portals.add_portal(&"door", &"hall", &"kitchen", {"opening": 0.0})
    portals.set_opening(&"door", 0.5)

func fixed_tick() -> void:
    var result := thermal.step(0.05)
    if result.ok and result.steps == 1:
        var exchanged := portals.step(0.05)
        # Handle exchanged.ok == false at the host boundary.
```

With only this portal between the rooms, opening 0 prevents it from exchanging any
channels. Call the adapter exactly once after each successful 50 ms thermal tick. Interleave
thermal and portal ticks; advancing several thermal ticks before a single portal
call changes the result. The adapter has no accumulator and rejects intervals
other than 50 ms (within a 1 ns floating-point tolerance). It does not advance the
thermal clock, directly ignite objects, or enforce host call ordering. Other host
adapters must use a consistent order at the same fixed-tick boundary.

## Exchange model and limits

`GSThermalSystem` has no air-volume field. This addon therefore assumes every
connected room has **equal air volume**: smoke and oxygen are concentration-like
gameplay values, and their sums across the room graph are conserved by exchange.
Do not interpret this as volume-correct mixing of differently sized real rooms.
Heat uses each room's authored `heat_capacity_kj_c`, conserving the sum of
`temperature_c * heat_capacity_kj_c` across the graph.

Each portal has `smoke_fraction` and `oxygen_fraction` (default 0.1), plus
`heat_fraction` (default 0.05). Each is finite and between 0 and 0.25. A fraction
describes the progress toward pair equilibrium during one tick at full opening.
Opening multiplies the fraction. For each channel, incident weights are summed
per room; each portal's weight is reduced by the larger endpoint sum so no room's
total effective weight exceeds 0.25. Parallel portals are allowed and share this
aggregate cap. For a single equal-capacity pair with fraction 0.25, each endpoint
moves 12.5% of their initial difference toward the other endpoint in one tick.

All source room values are read before computing any transfer. Portal IDs and
undirected endpoints are sorted, and changes are accumulated using 64-bit scalar
floats. Heat moves according to both room capacities, while equal and opposite
smoke/oxygen deltas implement the equal-volume assumption. No post-transfer
clamping creates or removes a channel. A high-degree graph stays inside initial
neighbor extrema; exchange alone approaches equilibrium without overshoot.

The cap is 128 portals and the thermal kernel's 64 rooms. The constructor's second
argument may lower the portal cap; an invalid thermal reference or cap creates an
adapter for which `is_valid()` returns false. Portal/room IDs must be nonblank and at
most 128 characters; room endpoints must already exist and differ. Invalid options,
unknown keys, nonfinite numbers, booleans in numeric fields and attempts to exceed the
portal budget make `add_portal` return false without changing registrations.

The adapter uses only the thermal kernel's public `room_state` and
`configure_rooms_batch` methods. The new batch method stages and validates every
room patch, including reserved future fuel heat/smoke, before replacing any room
state. Its reserve calculation scans the object registry once. A rejected batch
leaves every room, object, link and thermal clock unchanged, and the adapter does
not count a successful tick. The failed exchange can be retried after the host
resolves its cause; it does not undo a thermal tick the host already completed.

## API and checkpoints

| Method | Result |
| --- | --- |
| `Portals.new(thermal, max_portals=128)` | Independent `RefCounted` adapter; requires the native thermal kernel. |
| `is_valid()` | Whether the adapter remains usable. |
| `add_portal(id, room_a, room_b, values={})` | Boolean; `opening` defaults to `1.0`; accepts three per-tick fractions. |
| `set_opening(id, opening)` | Boolean; finite 0 through 1. |
| `remove_portal(id)` | Boolean; removes a registration. |
| `state(id)` | Detached JSON-friendly ID, canonical endpoints, opening and fractions; `{}` when absent. |
| `step(0.05)` | `{ok, portals, rooms}`: active portals and changed rooms on success. |
| `stats()` | Registry size/cap, successful ticks, fixed interval and room weight cap. |
| `checkpoint()` | JSON-compatible topology/rates and openings. |
| `prepare_restore(payload)` | `{ok:false}` or `{ok:true, commit:Callable}`. |
| `restore_checkpoint(payload)` | Validates then commits all openings atomically. |
| `dispose()` | Idempotently releases registrations and the thermal reference. |

The schema is `gamesystems.godot.thermal_portals.v1`. Restore accepts a decoded
dictionary or JSON text up to 65,536 characters. Portal IDs, canonical room endpoints,
authored fractions, counts and currently existing room references must match
the registrations exactly. Duplicates, unknown/missing keys and invalid values
are rejected before mutation. Restore never creates rooms or portals.

A prepared plan contains copied opening values. Commit is one-shot and rejects
intervening portal registration/removal, opening changes, successful restores,
disposal or missing thermal room references. A no-op `set_opening` does not
invalidate a plan. Room temperatures, smoke, oxygen and capacities belong to the
thermal checkpoint; successful tick counts are diagnostics and are not saved.
Restore thermal state and portal state at the same paused host boundary. This
adapter does not coordinate cross-provider rollback or detect a room recreated
under the same ID inside the thermal kernel.

## Validation

Run from the GameSystems repository:

```powershell
godot --headless --xr-mode off --path godot --script res://addons/gs_thermal_portals/tests/gs_thermal_portal_tests.gd
godot --headless --xr-mode off --path godot --script res://addons/gs_thermal/tests/gs_thermal_room_batch_tests.gd
```

The portal suite includes a timing run at 64 rooms, 256 thermal objects, 1,024
thermal links and 128 portals, with 20 warmup and 200 measured ticks. It prints
mean, P95 and maximum elapsed time. Every object carries a positive fuel reserve
so the batch validation performs its headroom accounting. An isolated local run
on Godot 4.7.2 headless measured mean **2.589 ms**, P95 **4.270 ms** and maximum
**5.878 ms**: respectively **5.18%, 8.54% and 11.76%** of a 50 ms interval.
The portal suite passed 241 assertions, the atomic room-batch suite 14, and the
existing thermal suite 53. Those are local headless desktop diagnostics,
not a headset budget or guaranteed time bound; profile the host scene on target
hardware. Neither this addon nor its tests change or render scene geometry.
