# Native Godot supply and battery adapters

`godot/addons/gs_resource_adapters/` provides a small finite liquid tank and two Aster-compatible resource views. It is the Godot-native counterpart to the browser APIs in `extensions/supply/` and `extensions/electricity/`; it does not load JavaScript or simulate fluid/electrical fields.

```gdscript
const Tank = preload("res://addons/gs_resource_adapters/gs_supply_tank.gd")
const Fuel = preload("res://addons/gs_resource_adapters/gs_fuel_adapter.gd")
const Battery = preload("res://addons/gs_resource_adapters/gs_battery_adapter.gd")

var tank = Tank.new(52000.0, {"petrol": 28000.0}) # capacity and components in mL
var fuel = Fuel.new(tank, "petrol")               # Aster units: litres
var power = Battery.new(720.0, 540.0, 12.6, true) # Aster units: Wh and V
car.set_resource_adapters(fuel, power)
car.set_resource_modes("external", "external")
```

The tank stores named liquid components. `fill(kind, ml)` and `withdraw(kind, ml)` return the actual transferred millilitres, bounded by free capacity or the named component. A petrol adapter only consumes the configured petrol component; its `refill(litres, other_kind)` can still place an incompatible liquid into the tank, where it remains distinct and unavailable to the petrol engine. State snapshots copy their component dictionary.

The battery adapter exposes `reversible = true`, `state()`, `draw(Wh)`, and `charge(Wh)`. It validates positive finite capacity and nominal voltage, energy within capacity, reports zero voltage while empty or disabled, and returns exact partial transfers. While disabled, both `draw()` and `charge()` return zero without changing stored energy or capacity. Re-enabling resumes transfers from the preserved energy level. This matches the browser vehicle battery store, shared electricity store, and network battery adapter. A just-drawn amount can be refunded with `charge()` while the battery remains enabled and the released capacity is still free.

Neither adapter owns a scene node, starts a simulation loop, or disposes its backing store. The host owns the tank and battery lifetimes. Keep `simple`/`disabled` modes available when the host does not need shared stores. Focused test command:

```powershell
godot --headless --path GameSystems/godot --script res://tests/gs_resource_adapters_tests.gd
```
