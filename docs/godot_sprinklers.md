# Godot native sprinkler system

`godot/addons/gs_sprinklers` is an independent, bounded gameplay controller that joins
the existing [typed supply tank](godot_resource_adapters.md) and
[thermal/fire kernel](godot_thermal.md). Hoses and refilling stay with the host; the
core does not simulate water pressure or plumbing.

## Model and API

Create `GSSprinklerSystem` with a `GSThermalSystem`, register finite supplies, and add
heads with a thermal room, supply ID, liquid kind and position. Heads can author a set
of target object IDs, flow in ml/s, sensor trip temperature, response time, range and
initial valve state.

- `register_supply` / `unregister_supply` manage objects implementing `state()` and
  `withdraw(kind, ml)`; `GSSupplyTank` already provides this contract and accepts any
  named fluid through `fill`.
- `add_head`, `remove_head`, `head_state` and `stats` manage/query bounded state.
- `set_valve_open` controls flow separately from `trigger`, which simulates a manual
  release. Thermal activation is automatic from the room's temperature.
- `reset_head` represents replacing a spent head and succeeds only after its sensor
  cools below the trip temperature.
- `step(delta)` advances 100 ms fixed ticks, at most eight per call. Excessive frame
  debt is rejected without advancing the clock. Topology changes and recursive stepping
  are rejected while a tick is drawing from an external supply.

An automatic head uses an exponential response toward its room's current scalar
temperature. Once triggered it remains latched through cooling. The room scalar is a
gameplay approximation: there is no ceiling heat layer, airflow or thermal plume.
Water and foam are split equally among the head's explicitly assigned target IDs that
are still in the same room and within range, then applied to the thermal kernel. Water
cools those objects when there is cooling headroom; foam suppresses and coats them.
`affected_targets` lists targets to which the thermal API accepted a positive dose, and
`thermal_applied_ml` is the total dose it accepted; neither promises a particular state
change when wetness or foam is already saturated. `ml` records the full typed spray
receipt. This is not a complete mass model for surface wetting, drainage or droplets.

The step returns `spray` receipts with the exact withdrawn amount, original fluid kind,
source ID, head position, room and affected targets. Hosts can use those receipts for
visual spray, sound, network events or a typed `GSPuddleStore` deposit. Petrol, diesel
and unknown kinds are never converted into water or foam effects; the host receives
their exact identity and owns the resulting spill/deposit behavior.

## Limits and next work

The core caps at 64 heads, 16 explicit targets per head and 800 ms of accepted fixed-step
work per call. Shared heads divide each tank/component's available flow proportionally before withdrawals,
so iteration order does not give the first head the whole remaining tank. A host should
refill through the supply tank API and treat each returned spray receipt as authoritative.

This increment has no electrical pump or power fraction, persistence/checkpoint API,
automatic spatial target discovery, game scene wiring, sound/visual effects or measured
headset performance. Next, connect pump demand to the electrical system; then coordinate
thermal, supply and sprinkler checkpoint providers and add an authored fire-station
example. Stay at coarse gameplay resolution until device profiling justifies more detail.

The focused `gs_sprinkler_tests.gd` contract covers typed receipts, tank sharing,
automatic/manual activation, response, valve, range, refill, reentrancy and fixed-step
bounds. On Godot 4.7.2, **38/38 checks pass**.
