# Godot sprinkler fire-station demo

Runnable 3D composition of the native `gs_thermal`, `gs_resource_adapters`,
`gs_electricity`, `gs_fire_spread`, `gs_sprinklers` and `gs_bottles` typed-puddle store.
The burning pallet can ignite a nearby crate through the room-bounded spread adapter; the
sprinkler targets both. A persistent mixed diesel/water spill demonstrates receipt-based
fuel ignition and water quenching through `GSPuddleFireAdapter`. A targetless floor head
routes water runoff into a visible water puddle, while a separately valved diesel head draws
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

Controls: **F** triggers the thermal-targeting water head, **V** opens/closes its valve,
**T** triggers the targetless floor-runoff water head, **D** triggers the diesel head, and
**G** opens/closes its fuel valve. **B** enables/disables the finite pump battery, **S**
opens/closes the circuit switch, **X** connects an overload branch, **C** replaces the fuse,
**R** refills the finite water tank, **I** ignites the spill with a typed diesel receipt, and
**E** consumes water from the spill to cool/extinguish it. Each active head gets its own
liquid-colored spray visual, so simultaneous water and diesel sprays remain distinguishable;
each visual lingers briefly between simulation ticks. The demo does not model pool-fire
fluid dynamics, plumbing pressure, airflow, or headset performance.
