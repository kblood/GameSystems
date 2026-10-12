# gs_thermal

Bounded, engine-independent gameplay heat and fire state for Godot projects. The
system owns rooms, authored thermal objects, explicit heat links and a capped 20 Hz
fixed-step clock. It does not simulate airflow, pressure, voxel heat transfer or
real material chemistry.

Objects can warm and ignite from authored energy, burn a finite fuel budget, heat
their room, consume normalized room oxygen and add room smoke. Cooling, water and
foam provide simple gameplay extinguishing. All material, rate and energy values
are authored gameplay units; `heat_kj_per_fuel`, `PETROL_KJ_PER_ML` and
`DIESEL_KJ_PER_ML` are not real-world fuel specifications.

`GSPuddleFireAdapter` optionally accepts a store implementing `components(id)` and
`withdraw(id, kind, ml)`. It burns only explicitly typed petrol or diesel, and
extinguishes only with water or foam. It never uses liquid color to infer identity.
Hosts may call `try_auto_ignite_from_hot_source` on fixed ticks. It checks the authored
room, source-to-proxy distance, oxygen and target wetness before spending a real typed
receipt, using explicit gameplay auto-ignition thresholds. Those values are not real fuel
specifications. It requires a `deposit` method so under-delivered withdrawals can be refunded
before heat is committed. Repeated calls do not spend another dose once the thermal target is
burning, and moisture above the small dry threshold prevents immediate reignition.
Keep this adapter outside `gs_bottles` so the bottle/puddle addon does not depend
on fire gameplay.

This native slice provides versioned thermal `checkpoint()` / `restore_checkpoint()`
for rooms, objects, links and fixed-step time. It does not coordinate snapshots from
liquid sources, supplies, batteries or sprinklers; the host must pause the world and
restore those dependencies at the same save boundary. More complete fluid/vapor fire
behavior and headset profiling remain follow-up tasks. The shared Godot guide and validation limits are
documented in [`docs/godot_thermal.md`](../../../docs/godot_thermal.md).

Run the focused contract from the GameSystems repository:

```powershell
godot --headless --path godot --script res://addons/gs_thermal/tests/gs_thermal_tests.gd
```
