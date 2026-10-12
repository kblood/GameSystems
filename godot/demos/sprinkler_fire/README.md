# Godot sprinkler fire-station demo

Runnable 3D composition of the native `gs_thermal`, `gs_resource_adapters` and
`gs_sprinklers` kernels. The scene uses simple built-in meshes so it needs no external
assets and can run in a clean checkout.

Open `fire_station_demo.tscn` from the GameSystems Godot project, or run it with:

```powershell
godot --path godot res://demos/sprinkler_fire/fire_station_demo.tscn
```

Controls: **F** triggers the head, **V** opens/closes its valve, **B** enables/disables
the finite pump battery, and **R** refills the finite water tank. The blue spray marker
appears while water flows and lingers briefly between simulation ticks. This is a composition and interaction
example; it does not model plumbing pressure, airflow, or headset performance.
