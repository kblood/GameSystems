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
- `set_power_provider` optionally attaches an object implementing
  `power_fraction(requests, dt) -> float` in `[0, 1]`; pass `null` to remove it.
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

`GSSprinklerBatteryPump` is a separate bounded adapter for a battery implementing
`state()` and `draw(wh)`. Configure its rated watts and maximum ml/s. Each tick it uses
the supply-limited planned doses to calculate a common flow fraction, capped by both
pump throughput and the Wh actually delivered by the battery. The power event reports
planned ml separately from the actual volume withdrawn; a supply may return less than
its earlier state advertised. Spray events carry the applied power fraction. An empty
or disabled battery gives zero flow without withdrawing liquid. For wired circuits,
`GSElectricityNetworkPump` from [Godot electricity](godot_electricity.md) implements the
same provider contract and advances the native grid exactly once per sprinkler tick. This
is a gameplay budget, not hydraulic pressure simulation.

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

The reusable sprinkler core does not own the electrical grid, automatic spatial target discovery,
sound/visual effects or measured headset performance; the standalone demo composes the
separate native `gs_electricity` addon. Versioned
`checkpoint()` / `restore_checkpoint()` covers head configuration, latches and fixed-step
time in live head iteration order; that order affects shared-supply requests and spray events.
It requires the same registered supply IDs and the same presence/absence of a power provider. Snapshot thermal, puddle/liquid-source, supply tank, battery, pump and sprinkler at one paused
host boundary. If bottle sources are present, restore their puddle manager before the
sources. With a native circuit, restore thermal, supplies/puddle store, circuit, pump
adapter, then sprinkler.
This order is not a cross-system transaction: preflight the complete provider graph in an
isolated staged world and swap it in only after every restore succeeds, or retain live
checkpoints and roll all systems back before resuming after any failure.
A runnable authored fire-station scene is available at
[`godot/demos/sprinkler_fire`](../godot/demos/sprinkler_fire/README.md); it composes the native electrical grid and routes typed spray receipts into persistent puddles. Stay at coarse gameplay resolution until device profiling justifies more detail; next work should measure representative host/device costs and improve plumbing or runoff composition without moving those responsibilities into the sprinkler core.

The focused `gs_sprinkler_tests.gd` contract covers typed receipts, tank sharing,
automatic/manual activation, response, valve, range, refill, reentrancy, battery energy,
pump capacity, malformed providers, JSON checkpoint roundtrips, atomic rejection, coordinated
restore order, staged failure isolation, insertion-order replay and fixed-step bounds. On Godot 4.7.2, **54/54 checks pass**.
