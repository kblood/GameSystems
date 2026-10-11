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
	battery.set_enabled(false)
	case_result(not battery.state().enabled and is_equal_approx(battery.state().voltage, 0.0), "disabled battery reports disabled and zero voltage")
	case_result(is_zero_approx(battery.draw(1.0)), "disabled battery supplies no energy")
	case_result(is_equal_approx(battery.charge(20.0), 8.0), "charge accepts only remaining capacity")
	battery.set_enabled(true)
	case_result(is_equal_approx(battery.state().voltage, 12.6), "re-enabled charged battery restores nominal voltage")
	case_result(is_zero_approx(battery.draw(INF)) and is_zero_approx(battery.charge(-1.0)), "invalid power transfers are rejected")

	print("GS_RESOURCE_ADAPTERS passed=%d failed=%d" % [passed, failed])
	quit(1 if failed else 0)

func case_result(ok: bool, label: String) -> void:
	if ok: passed += 1
	else:
		failed += 1
		push_error("GS_RESOURCE_ADAPTERS: " + label)
