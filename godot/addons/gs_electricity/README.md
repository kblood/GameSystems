# `gs_electricity`

Bounded Godot-native resistive DC network. It models ideal voltage sources, finite
batteries with internal resistance, wires, switches, fuses and resistive loads. The
network solves only when topology/configuration changes or a battery reaches an energy
boundary; each `step(seconds)` integrates solved energy and stops exactly at battery
empty/full boundaries.

```gdscript
var grid := GSElectricitySystem.new()
grid.add(&"battery", {"kind": &"battery", "a": &"positive", "b": &"ground",
	"voltage": 12.0, "resistance": 0.08, "capacity_wh": 600.0, "energy_wh": 400.0})
grid.add(&"wire", {"kind": &"wire", "a": &"positive", "b": &"bus", "resistance": 0.02})
grid.add(&"fuse", {"kind": &"fuse", "a": &"bus", "b": &"lamp", "rating": 5.0})
grid.add(&"lamp", {"a": &"lamp", "b": &"ground", "resistance": 12.0})
var interval: Dictionary = grid.step(1.0 / 60.0)
print(grid.state(&"lamp").volts, interval.energy_j.get(&"lamp", 0.0))
```

Public API: `add`, `state`, `all`, `configure`, `set_enabled`, `replace_fuse`, `remove`,
`evaluate`, `step`, `charge`, `draw`, `battery_adapter`, `checkpoint`,
`prepare_restore`, `restore_checkpoint` and `dispose`. `GSElectricityNetworkPump`
implements the sprinkler `power_fraction(requests, dt)` contract and owns one network
update per sprinkler fixed tick, including idle calls with no pump demand. Do not also
register that network with a host tick.

Hard limits: 256 components, 128 terminals, 10 seconds per update. The constructor may lower, but cannot raise, the component and terminal budgets. Fuse overcurrent trips
immediately; there is no thermal fuse delay, AC, inductance, capacitance, electronics or
spatial field. This is a gameplay network, not an electrical safety or installation tool.

See the [Godot electricity guide](../../../docs/godot_electricity.md) for checkpoint,
host-tick and sprinkler-integration rules.
