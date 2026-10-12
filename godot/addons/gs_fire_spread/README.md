# `gs_fire_spread`

Optional bounded proximity-spread composition for `GSThermalSystem`. Register the thermal
object IDs that participate, then interleave each successful `thermal.step(0.05)` call that
reports one step with `spread.step(0.05)`. Do not bulk-advance several thermal ticks and then call spread once:
new ignition sources must become visible between ticks. Burning objects heat flammable,
fueled, dry, uncoated neighbors in the same authored room. The
adapter snapshots participants before applying heat, so newly ignited objects become
spread sources on the next interval instead of cascading in the same pass.

The default radius is 1.5 m and the source heat rate is 4 kJ/s with squared linear distance
falloff. Both are constructor-configurable within hard limits. The system evaluates at most
256 registered objects (65,280 directed pairs) per 50 ms tick and preflights summed heat for every
target before mutation. It does not trace walls, model airflow or fuel chemistry, or claim
real fire-spread timing; room IDs act as authored barriers. Hosts should author a room for
each connected fire zone and bind only the objects participating in that zone.

Focused tests: `tests/gs_spatial_fire_spread_tests.gd`.
