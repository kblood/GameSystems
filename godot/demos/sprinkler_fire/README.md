# Godot sprinkler fire-station demo

Runnable 3D composition of the native `gs_thermal`, `gs_thermal_portals`,
`gs_resource_adapters`, `gs_electricity`, `gs_fire_spread`, `gs_sprinklers` and
`gs_bottles` typed-puddle store.
The scene has two authored compartments joined by a hinged door. **H** opens or closes
the door and updates `gs_thermal_portals`; a closed door stops exchange through that portal,
while an open door transfers smoke and heat between the rooms. The status label shows the
adjacent room's temperature and smoke level.
The burning pallet can ignite a nearby crate through the room-bounded spread adapter; the
sprinkler targets both. A persistent mixed diesel/water spill demonstrates receipt-based
fuel ignition and water quenching through `GSPuddleFireAdapter`. The nearby burning pallet
automatically ignites the diesel spill once its authored gameplay threshold is met. Manual
ignition with **I** stays inhibited until the thermal target dries enough after quenching. A
targetless floor head routes water runoff into a visible water puddle, while a separately valved diesel head draws
from its own finite tank and adds typed diesel to the spill. Per-source receipts distinguish
thermal-applied volume from floor runoff deposited in persistent puddles.

The demo interleaves thermal/spread updates at 50 ms and sprinkler/grid updates at 100 ms.
Its integration contract compares one 0.3 s host frame with three 0.1 s frames while the
sprinkler is active, and verifies typed diesel ignition, water quenching, floor-head water
runoff, and diesel-head fuel deposition with source receipts. The sprinkler pump draws from
a finite battery through a switch, fuse and wires. An optional fault branch demonstrates a
fuse trip and replacement. The scene uses simple built-in meshes so it needs no external
assets and can run in a clean checkout.

Open `fire_station_demo.tscn` from the GameSystems Godot project, or run it with:

```powershell
godot --path godot res://demos/sprinkler_fire/fire_station_demo.tscn
```

Run the bounded integrated host benchmark from the GameSystems root with:

```powershell
godot --headless --xr-mode off --path godot --script res://demos/sprinkler_fire/benchmark_fire_station.gd
```

It warms up for 20 ticks, then measures 200 calls to the composed host at 50 ms each,
including thermal propagation, spatial fire spread, sprinkler/grid work, typed runoff,
and demo state/visual updates. It fills the fire-spread adapter to its 256-object limit
and prints average, P95 and maximum wall time. This headless desktop diagnostic excludes
rendering and headset/runtime costs; it is useful for regression comparisons, not a device
performance claim. The benchmark fails unless the measured window includes sprinkler spray
and newly deposited floor-head runoff. A local Godot 4.7.2 run on a Ryzen 7 5700G measured
6,717 ml of spray and 4,812 ml of floor runoff, with 1.73 ms average, 1.99 ms P95 and
2.86 ms maximum per tick.

Controls: **H** opens/closes the compartment door, **F** triggers the thermal-targeting
water head, **V** opens/closes its valve,
**T** triggers the targetless floor-runoff water head, **D** triggers the diesel head, and
**G** opens/closes its fuel valve. **B** enables/disables the finite pump battery, **S**
opens/closes the circuit switch, **X** connects an overload branch, **C** replaces the fuse,
**R** refills the finite water tank, **I** ignites the spill with a typed diesel receipt, and
**E** consumes water from the spill to cool/extinguish it. Each active head gets its own
liquid-colored spray visual, so simultaneous water and diesel sprays remain distinguishable;
each visual lingers briefly between simulation ticks. The demo does not model pool-fire
fluid dynamics, plumbing pressure, airflow, or headset performance.
