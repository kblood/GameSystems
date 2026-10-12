extends SceneTree
## Shared supply and battery adapter contract tests.
## Run: godot --headless --path GameSystems/godot --script res://tests/gs_resource_adapters_tests.gd

const Tank = preload("res://addons/gs_resource_adapters/gs_supply_tank.gd")
const Fuel = preload("res://addons/gs_resource_adapters/gs_fuel_adapter.gd")
const Battery = preload("res://addons/gs_resource_adapters/gs_battery_adapter.gd")
var passed := 0
var failed := 0

func _initialize() -> void:
	var tank = Tank.new(1000.0, {"petrol": 600.0, "diesel": 200.0})
	var fuel = Fuel.new(tank, "petrol")
	case_result(tank.is_valid() and fuel.is_valid(), "typed tank and fuel adapter initialize")
	case_result(fuel.reversible and is_equal_approx(fuel.state().amountL, 0.6), "fuel adapter advertises reversible petrol state in litres")
	case_result(is_equal_approx(fuel.consume(0.9), 0.6), "withdrawal is capped at actual petrol available")
	case_result(is_equal_approx(fuel.state().amountL, 0.0), "partial withdrawal leaves no petrol")
	case_result(is_equal_approx(tank.state().components.diesel, 200.0), "petrol withdrawal preserves other liquid types")
	case_result(is_equal_approx(fuel.refill(0.6), 0.6), "refund/refill accepts the exact withdrawn volume")
	case_result(is_equal_approx(fuel.state().amountL, 0.6), "fuel balance is restored after exact refund")
	case_result(is_equal_approx(fuel.refill(1.0, "kerosene"), 0.2), "tank returns exact partial fill accepted at capacity")
	case_result(is_equal_approx(fuel.state().amountL, 0.6), "foreign liquid cannot change the petrol component")
	case_result(is_zero_approx(fuel.consume(-1.0)) and is_zero_approx(fuel.refill(NAN)), "invalid fuel transfers are rejected")
	var fuel_state: Dictionary = fuel.state()
	fuel_state.components = {"petrol": 999999.0}
	case_result(is_equal_approx(fuel.state().amountL, 0.6), "state snapshots cannot mutate the tank")
	var tank_checkpoint: Dictionary = tank.checkpoint()
	tank.withdraw("diesel", 100.0)
	case_result(tank.restore_checkpoint(tank_checkpoint)
		and is_equal_approx(tank.state().components.diesel, 200.0),
		"tank checkpoint restores exact typed contents")
	var recreated_tank = Tank.new(1000.0, {})
	case_result(recreated_tank.restore_checkpoint(tank_checkpoint)
		and recreated_tank.state().components == tank.state().components,
		"tank checkpoint restores into a fresh adapter with matching authored capacity")
	var invalid_tank_checkpoint: Dictionary = tank.checkpoint()
	invalid_tank_checkpoint.components = {"petrol": 900.0, "diesel": 200.0}
	case_result(not tank.restore_checkpoint(invalid_tank_checkpoint)
		and is_equal_approx(tank.state().components.diesel, 200.0),
		"over-capacity tank checkpoint is rejected atomically")

	var battery = Battery.new(10.0, 2.0, 12.6, true)
	case_result(battery.is_valid() and battery.reversible, "battery exposes the reversible adapter contract")
	case_result(Battery.valid_configuration(10.0, 2.0, 12.6, true), "valid battery configuration is accepted")
	case_result(not Battery.valid_configuration(10.0, 2.0, 0.0, true)
		and not Battery.valid_configuration(10.0, 2.0, INF, true)
		and not Battery.valid_configuration(10.0, 11.0, 12.6, true), "invalid voltage and out-of-capacity energy are rejected")
	case_result(not Battery.valid_configuration(10.0, 2.0, 12.6, 1), "enabled state must be boolean")
	case_result(is_equal_approx(battery.state().voltage, 12.6), "enabled charged battery reports nominal voltage")
	case_result(is_equal_approx(battery.draw(3.0), 2.0), "battery draw is capped at available energy")
	case_result(is_equal_approx(battery.state().voltage, 0.0), "empty battery reports zero voltage")
	case_result(is_equal_approx(battery.charge(2.0), 2.0), "short starter draw can be refunded exactly")
	case_result(is_equal_approx(battery.state().energyWh, 2.0), "battery energy is restored after refund")
	var initially_disabled = Battery.new(10.0, 2.0, 12.6, false)
	var initially_disabled_state: Dictionary = initially_disabled.state()
	case_result(initially_disabled.is_valid() and not initially_disabled_state.enabled
		and is_equal_approx(initially_disabled_state.energyWh, 2.0)
		and is_zero_approx(initially_disabled_state.voltage), "initially disabled nonempty battery keeps its charge but exposes no voltage")
	case_result(is_zero_approx(initially_disabled.draw(1.0)) and is_zero_approx(initially_disabled.charge(3.0))
		and initially_disabled.state() == initially_disabled_state,
		"disabled battery neither supplies nor accepts charge and preserves its full state")
	initially_disabled.set_enabled(true)
	case_result(is_equal_approx(initially_disabled.draw(1.25), 1.25)
		and is_equal_approx(initially_disabled.charge(1.25), 1.25)
		and is_equal_approx(initially_disabled.state().energyWh, 2.0), "re-enabled battery supports an exact partial draw refund")
	case_result(is_equal_approx(initially_disabled.charge(20.0), 8.0)
		and is_equal_approx(initially_disabled.state().energyWh, 10.0), "re-enabled battery accepts only its remaining capacity")
	battery.set_enabled(false)
	case_result(not battery.state().enabled and is_equal_approx(battery.state().voltage, 0.0), "disabled battery reports disabled and zero voltage")
	case_result(is_zero_approx(battery.draw(1.0)), "disabled battery supplies no energy")
	var disabled_battery_state: Dictionary = battery.state()
	case_result(is_zero_approx(battery.charge(20.0)) and battery.state() == disabled_battery_state,
		"disabled battery rejects charging without changing its state")
	battery.set_enabled(true)
	case_result(is_equal_approx(battery.charge(8.0), 8.0) and is_equal_approx(battery.state().voltage, 12.6),
		"re-enabled charged battery accepts remaining capacity and restores nominal voltage")
	case_result(is_zero_approx(battery.draw(INF)) and is_zero_approx(battery.charge(-1.0)), "invalid power transfers are rejected")
	var battery_checkpoint: Dictionary = battery.checkpoint()
	battery.draw(4.0)
	battery.set_enabled(false)
	case_result(battery.restore_checkpoint(battery_checkpoint)
		and battery.state().enabled and is_equal_approx(battery.state().energyWh, 10.0),
		"battery checkpoint restores charge and enabled state")
	var recreated_battery = Battery.new(10.0, 0.0, 12.6, false)
	case_result(recreated_battery.restore_checkpoint(battery_checkpoint)
		and recreated_battery.state() == battery.state(),
		"battery checkpoint restores into a fresh adapter with matching authored configuration")
	var invalid_battery_checkpoint: Dictionary = battery.checkpoint()
	invalid_battery_checkpoint.energy_wh = INF
	case_result(not battery.restore_checkpoint(invalid_battery_checkpoint)
		and is_equal_approx(battery.state().energyWh, 10.0),
		"invalid battery checkpoint is rejected without changing live charge")

	print("GS_RESOURCE_ADAPTERS passed=%d failed=%d" % [passed, failed])
	quit(1 if failed else 0)

func case_result(ok: bool, label: String) -> void:
	if ok: passed += 1
	else:
		failed += 1
		push_error("GS_RESOURCE_ADAPTERS: " + label)
