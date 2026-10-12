# Godot sprinkler fire-station demo

Runnable 3D composition of the native `gs_thermal`, `gs_resource_adapters`,
`gs_electricity`, `gs_fire_spread` and `gs_sprinklers` kernels. The burning pallet can
ignite a nearby crate through the room-bounded spread adapter; the sprinkler targets both.
The demo interleaves thermal/spread updates at 50 ms and sprinkler/grid updates at 100 ms.
Its integration contract compares one 0.3 s host frame with three 0.1 s frames while the
sprinkler is active. The sprinkler pump draws from a finite
battery through a switch, fuse and wires. An optional fault branch demonstrates a fuse
trip and replacement. The scene uses simple built-in meshes so it needs no external
assets and can run in a clean checkout.

Open `fire_station_demo.tscn` from the GameSystems Godot project, or run it with:

```powershell
godot --path godot res://demos/sprinkler_fire/fire_station_demo.tscn
```

Controls: **F** triggers the head, **V** opens/closes its valve, **B** enables/disables
the finite pump battery, **S** opens/closes the circuit switch, **X** connects an overload
branch, **C** replaces the fuse, and **R** refills the finite water tank. The blue spray marker
appears while water flows and lingers briefly between simulation ticks. This is a composition
and interaction example; it does not model plumbing pressure, airflow, or headset performance.
