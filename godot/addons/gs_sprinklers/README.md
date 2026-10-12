# gs_sprinklers

Bounded gameplay sprinkler controller for Godot. It composes with `GSThermalSystem`
and a typed supply implementing `state()` and `withdraw(kind, ml)`. It models head
temperature response and liquid receipts, not pipes, pressure or droplet physics.

Heads use a room-temperature sensor with an authored response time and trip threshold.
They also support manual triggering, a valve, latched activation and replacement/reset.
Multiple heads sharing one supply divide each liquid component proportionally when the
tank cannot meet their combined requested flow. Water cools and foam suppresses the
explicitly authored in-range thermal targets. Every spray returns a typed receipt so the host can
render it or deposit other fluids into the appropriate puddle store without guessing
from color.

This first slice has no pump/power adapter, checkpoint coordination, automatic target
discovery, hydraulic simulation or headset performance measurement. The host owns the
tank refill policy and must coordinate fire, supply and sprinkler checkpoints together.

See [`docs/godot_sprinklers.md`](../../../docs/godot_sprinklers.md) and run the focused
contract from the GameSystems root:

```powershell
godot --headless --path godot --script res://addons/gs_sprinklers/tests/gs_sprinkler_tests.gd
```
