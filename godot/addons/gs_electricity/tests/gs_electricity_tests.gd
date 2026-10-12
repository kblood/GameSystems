extends SceneTree

const Electricity = preload("res://addons/gs_electricity/gs_electricity_system.gd")
const NetworkPump = preload("res://addons/gs_electricity/gs_electricity_network_pump.gd")
const Thermal = preload("res://addons/gs_thermal/gs_thermal_system.gd")
const SupplyTank = preload("res://addons/gs_resource_adapters/gs_supply_tank.gd")
const Sprinklers = preload("res://addons/gs_sprinklers/gs_sprinkler_system.gd")

var passed := 0
var failed := 0


func _initialize() -> void:
	var circuit := _circuit()
	var solve: Dictionary = circuit.evaluate()
	case_result(solve.ok and is_equal_approx(circuit.state(&"load").current, 1.0)
		and is_equal_approx(circuit.state(&"load").power, 11.0)
		and is_equal_approx(circuit.state(&"battery").volts, 11.0),
		"finite battery solves DC load with internal resistance drop")
	var interval: Dictionary = circuit.step(1.0)
	case_result(interval.ok and is_equal_approx(interval.energy_j.load, 11.0)
		and is_equal_approx(circuit.state(&"battery").supplied_wh, 12.0 / 3600.0),
		"bounded step records load energy and chemical battery ledger")

	var depleted := _circuit(0.001)
	var depletion: Dictionary = depleted.step(1.0)
	case_result(depletion.ok and is_equal_approx(depletion.energy_j.load, 3.3)
		and depleted.state(&"battery").energy_wh == 0.0
		and depleted.state(&"load").power == 0.0,
		"empty battery stops supplying at its exact energy boundary")

	var fuse := Electricity.new()
	fuse.add(&"battery", {"kind": &"battery", "a": &"p", "b": &"g", "capacity_wh": 1.0})
	fuse.add(&"wire", {"kind": &"wire", "a": &"p", "b": &"f", "resistance": 0.1})
	fuse.add(&"fuse", {"kind": &"fuse", "a": &"f", "b": &"l", "resistance": 0.1, "rating": 1.0})
	fuse.add(&"load", {"a": &"l", "b": &"g", "resistance": 0.1})
	fuse.step(1.0)
	case_result(fuse.state(&"fuse").blown and fuse.state(&"battery").energy_wh == 1.0,
		"overcurrent fuse trips before battery energy is consumed")
	fuse.configure(&"load", {"resistance": 12.0})
	fuse.replace_fuse(&"fuse")
	fuse.set_enabled(&"wire", false)
	fuse.step(1.0)
	case_result(not fuse.state(&"fuse").blown and fuse.state(&"load").power == 0.0,
		"open wire isolates the load and a replaced fuse remains intact")

	var saved: Dictionary = circuit.checkpoint()
	circuit.draw(&"battery", 0.2)
	var restored: bool = circuit.restore_checkpoint(saved)
	case_result(restored and circuit.checkpoint() == saved,
		"checkpoint restores energy and solved circuit state")
	var invalid := saved.duplicate(true)
	invalid.components[0].supplied_wh = 99.0
	var before: Dictionary = circuit.checkpoint()
	case_result(not circuit.restore_checkpoint(invalid) and circuit.checkpoint() == before,
		"invalid battery ledger is rejected atomically")
	var json_saved: Variant = JSON.parse_string(JSON.stringify(saved))
	case_result(json_saved is Dictionary and circuit.restore_checkpoint(json_saved),
		"checkpoint survives JSON serialization and restore")
	var malformed_json: Dictionary = json_saved.duplicate(true)
	malformed_json.components[0].id = 17
	case_result(not circuit.restore_checkpoint(malformed_json),
		"checkpoint rejects malformed JSON component IDs without coercion")
	var dirty_fuse := Electricity.new()
	dirty_fuse.add(&"source", {"kind": &"source", "a": &"p", "b": &"g", "voltage": 12.0})
	dirty_fuse.add(&"fuse", {"kind": &"fuse", "a": &"p", "b": &"load", "rating": 0.5, "resistance": 0.1})
	dirty_fuse.add(&"load", {"a": &"load", "b": &"g", "resistance": 1.0})
	dirty_fuse.configure(&"load", {"resistance": 0.1})
	var dirty_saved: Dictionary = dirty_fuse.checkpoint()
	var restore_fuse := Electricity.new()
	for row: Dictionary in dirty_saved.components:
		restore_fuse.add(row.id, {"kind": row.kind, "a": row.a, "b": row.b,
			"resistance": row.resistance, "voltage": row.voltage, "rating": row.rating,
			"enabled": row.enabled})
	case_result(dirty_saved.components[1].blown and restore_fuse.restore_checkpoint(dirty_saved)
		and restore_fuse.state(&"fuse").blown,
		"checkpoint solves dirty topology before capture and restores resulting fuse state")
	var split_a := _circuit(0.001)
	var split_b := _circuit(0.001)
	var one_tick: Dictionary = split_a.step(1.0)
	var split_energy := 0.0
	for _tick in 100: split_energy += float(split_b.step(0.01).energy_j.get(&"load", 0.0))
	case_result(is_equal_approx(one_tick.energy_j.load, split_energy)
		and is_equal_approx(split_a.state(&"battery").supplied_wh, split_b.state(&"battery").supplied_wh),
		"battery boundary energy is invariant to timestep partitioning")

	var charging := Electricity.new()
	charging.add(&"charger", {"kind": &"source", "a": &"p", "b": &"g", "voltage": 14.0})
	charging.add(&"battery", {"kind": &"battery", "a": &"p", "b": &"g", "voltage": 12.0,
		"resistance": 1.0, "capacity_wh": 0.001, "energy_wh": 0.0})
	var charge_step: Dictionary = charging.step(1.0)
	case_result(charge_step.ok and is_equal_approx(charging.state(&"battery").energy_wh, 0.001)
		and is_equal_approx(charging.state(&"battery").charged_wh, 0.001),
		"higher-voltage source charges a finite battery only to its capacity")
	var charge_after: float = float(charging.state(&"battery").charged_wh)
	charging.step(1.0)
	case_result(is_equal_approx(charging.state(&"battery").charged_wh, charge_after),
		"full battery stops accepting charge on later intervals")

	var empty := Electricity.new()
	empty.add(&"battery", {"kind": &"battery", "a": &"p", "b": &"g", "energy_wh": 0.0})
	empty.add(&"fuse", {"kind": &"fuse", "a": &"p", "b": &"l", "rating": 0.1, "resistance": 0.01})
	empty.add(&"load", {"a": &"l", "b": &"g", "resistance": 0.01})
	empty.step(1.0)
	case_result(not empty.state(&"fuse").blown and empty.state(&"load").power == 0.0,
		"empty source does not trip a fuse from hypothetical current")

	var disabled := _circuit()
	var battery_view: RefCounted = disabled.battery_adapter(&"battery")
	disabled.set_enabled(&"battery", false)
	case_result(battery_view.state().voltage == 0.0 and battery_view.draw(0.1) == 0.0
		and disabled.state(&"battery").energy_wh == 1.0,
		"battery adapter exposes finite draw and honors disabled state")
	var over_budget: Dictionary = disabled.step(10.01)
	case_result(not over_budget.ok and disabled.state(&"battery").energy_wh == 1.0,
		"excessive update is rejected before state changes")

	var bounded := Electricity.new(Callable(), 2, 3)
	bounded.add(&"one", {"a": &"p", "b": &"g"})
	var topology_before: Dictionary = bounded.checkpoint()
	case_result(bounded.add(&"bad", {"a": &"x", "b": &"y"}).is_empty()
		and bounded.checkpoint() == topology_before and bounded.add(&"two", {"a": &"p", "b": &"q"}).size() > 0
		and bounded.add(&"three", {"a": &"x", "b": &"y"}).is_empty(),
		"component and terminal budgets reject topology changes before mutation")
	var hard_bounded := Electricity.new(Callable(), Electricity.MAX_COMPONENTS + 1, Electricity.MAX_NODES + 1)
	case_result(hard_bounded._max_components == Electricity.MAX_COMPONENTS
		and hard_bounded._max_nodes == Electricity.MAX_NODES,
		"constructor cannot raise the documented solver hard ceilings")
	case_result(not disabled.configure(&"load", {"resistance": 2.0, "voltage": NAN})
		and disabled.state(&"load").resistance == 11.0,
		"invalid multi-field configuration is rejected atomically")

	var multi := Electricity.new()
	for pair: Array in [[&"high", 16.0, 0.1], [&"full-low", 14.0, 0.0005],
		[&"empty-mid", 12.0, 0.0005], [&"empty-low", 10.0, 0.0005]]:
		multi.add(pair[0], {"kind": &"battery", "a": &"p", "b": &"g", "voltage": pair[1],
			"resistance": 0.1, "capacity_wh": pair[2], "energy_wh": pair[2] if pair[0] == &"high" else 0.0})
	multi.add(&"load", {"a": &"p", "b": &"g", "resistance": 1.0})
	var mixed: Dictionary = multi.step(10.0)
	var ledgers_balanced := true
	for row: Dictionary in multi.all():
		if row.kind == &"battery" and absf(float(row.initial_wh) + float(row.charged_wh)
				- float(row.supplied_wh) - float(row.energy_wh)) > 1.0e-7: ledgers_balanced = false
	case_result(mixed.ok and ledgers_balanced and multi.state(&"load").power == 0.0,
		"mixed battery voltage and charge boundaries settle without energy ledger drift")

	var net := Electricity.new()
	net.add(&"battery", {"kind": &"battery", "a": &"p", "b": &"g", "capacity_wh": 1.0,
		"energy_wh": 0.6 / 3600.0, "voltage": 12.0, "resistance": 1.0})
	net.add(&"pump-load", {"kind": &"load", "a": &"p", "b": &"g", "resistance": 11.0})
	var pump := NetworkPump.new(net, &"pump-load", 11.0)
	var fraction := pump.power_fraction([{"ml": 10.0, "planned_ml": 10.0}], 0.1)
	case_result(is_equal_approx(fraction, 0.5) and is_equal_approx(pump.state().last_energy_j, 0.55)
		and net.state(&"battery").energy_wh == 0.0,
		"network pump delivers only the volume supported by remaining battery energy")
	var pump_saved: Dictionary = pump.checkpoint()
	pump.last_energy_j = 2.0
	case_result(pump.restore_checkpoint(pump_saved) and pump.checkpoint() == pump_saved,
		"network pump checkpoint restores cumulative power receipts")
	var bad_pump: Dictionary = pump_saved.duplicate(true)
	bad_pump.last_fraction = 0.25
	var pump_before: Dictionary = pump.checkpoint()
	case_result(not pump.restore_checkpoint(bad_pump) and pump.checkpoint() == pump_before,
		"network pump rejects inconsistent energy fractions atomically")
	var thermal := Thermal.new()
	thermal.add_room(&"idle-room", {"temperature_c": 20.0})
	var idle_grid := Electricity.new()
	idle_grid.add(&"idle-battery", {"kind": &"battery", "a": &"p", "b": &"g", "capacity_wh": 1.0})
	idle_grid.add(&"idle-pump-load", {"kind": &"load", "a": &"p", "b": &"g", "resistance": 11.0, "enabled": false})
	idle_grid.add(&"other-load", {"kind": &"load", "a": &"p", "b": &"g", "resistance": 11.0})
	var idle_pump := NetworkPump.new(idle_grid, &"idle-pump-load", 11.0)
	var sprinkler := Sprinklers.new(thermal)
	sprinkler.register_supply(&"water", SupplyTank.new(100.0, {"water": 100.0}))
	sprinkler.set_power_provider(idle_pump)
	sprinkler.add_head(&"idle-head", {"room_id": &"idle-room", "supply_id": &"water"})
	var charge_before: float = idle_grid.state(&"idle-battery").energy_wh
	sprinkler.step(0.1)
	case_result(idle_grid.state(&"idle-battery").energy_wh < charge_before
		and idle_grid.state(&"other-load").power > 0.0,
		"idle sprinkler still advances other loads on its shared circuit once per tick")

	print("GS_ELECTRICITY passed=%d failed=%d" % [passed, failed])
	quit(1 if failed else 0)


func _circuit(energy_wh := 1.0) -> RefCounted:
	var network := Electricity.new()
	network.add(&"battery", {"kind": &"battery", "a": &"p", "b": &"g", "voltage": 12.0,
		"resistance": 1.0, "capacity_wh": 1.0, "energy_wh": energy_wh})
	network.add(&"load", {"a": &"p", "b": &"g", "resistance": 11.0})
	return network


func case_result(ok: bool, label: String) -> void:
	if ok:
		passed += 1
	else:
		failed += 1
		push_error("GS_ELECTRICITY: " + label)
