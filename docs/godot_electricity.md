# Native Godot electricity system

`godot/addons/gs_electricity/` is the native source for a bounded resistive DC circuit.
It mirrors the engine-independent `extensions/electricity/` gameplay model while using
Godot `RefCounted` APIs and `StringName` identifiers. It is a separate module and can be
used by vehicle, sprinkler, camera or other gameplay adapters.

## Components and solve

Components connect two distinct terminal IDs: `source`, finite `battery`, `wire`,
`switch`, `fuse` and `load`. Passive resistance is measured in ohms, voltage in volts,
current in amperes, power in watts, and battery capacity/charge in watt-hours. Battery
internal resistance is included; its chemical ledger balances as
`initial_wh + charged_wh - supplied_wh = energy_wh`.

The circuit uses modified nodal analysis for small DC networks. It rebuilds when an
electrical setting changes, treats disabled components and blown fuses as disconnected,
and trips an over-rated fuse before the interval can spend battery energy. Batteries
stop supplying at empty, stop accepting charge at full, and can recharge from a connected
higher-voltage source. `step(seconds)` integrates terminal joules and partitions time at
energy boundaries without fixed microsteps. Limits are 256 components, 128 terminals
and ten seconds per call.

## Sprinkler/host integration

`GSElectricityNetworkPump` implements `power_fraction(requests, dt)`. It maps available
network load energy to the fraction of planned liquid flow, so open wires, switches,
fuses and finite battery charge affect the same pump already used by `GSSprinklerSystem`.
The sprinkler calls the provider once each fixed tick, including an empty request list
when no head draws water. This lets the adapter disable only its own load and still
advance other circuit loads and charging during idle sprinkler intervals. The adapter
owns `network.step(dt)` for each sprinkler tick. Do not also advance that network from
the host in the same interval. Add or restore the entire circuit before installing the
pump provider.

The [fire-station scene](../godot/demos/sprinkler_fire/README.md) demonstrates the native
grid. **B** enables the battery, **S** opens the main switch, **X** connects the low-
resistance fault branch, **C** replaces a tripped fuse, and the sprinkler valve and
finite water tank remain independently controllable. The scene preflights its thermal
and sprinkler frame budgets before any subsystem advances.

## Checkpoints and limits

The network checkpoint records authored component identity/topology and mutable electrical
state: enabled states, fuse state, battery charge and ledgers. Capturing a dirty circuit solves it silently first, so an overload may trip a fuse at save time without advancing battery energy. The host must instantiate
and add the matching circuit first; `prepare_restore` validates the existing component
count, IDs, kinds, terminals and battery ledger before returning a plan. Capture/restore
this network at the same paused boundary as dependent systems; restore the circuit before
pump adapter and sprinkler state.
Cross-system restore still belongs to the host's staged transaction.

The model does not simulate AC, induction, capacitance, temperature-dependent conductors,
thermal fuse delay or circuit-breaker mechanics. Fuses trip immediately; a gameplay fault
can be represented by a low-resistance branch. This is not a real-world wiring calculator.

Focused tests: `res://addons/gs_electricity/tests/gs_electricity_tests.gd`.
