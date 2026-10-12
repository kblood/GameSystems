extends SceneTree

const Electricity = preload("res://addons/gs_electricity/gs_electricity_system.gd")
const NetworkPump = preload("res://addons/gs_electricity/gs_electricity_network_pump.gd")
const Thermal = preload("res://addons/gs_thermal/gs_thermal_system.gd")
const Adapter = preload("res://addons/gs_electricity_thermal/gs_electricity_thermal_adapter.gd")

var passed := 0
var failed := 0


func _initialize() -> void:
	var grid := Electricity.new()
	grid.add(&"battery", {"kind": &"battery", "a": &"p", "b": &"g", "voltage": 12.0,
		"resistance": 1.0, "capacity_wh": 1.0})
	grid.add(&"wire", {"kind": &"wire", "a": &"p", "b": &"load", "resistance": 0.1})
	grid.add(&"load", {"kind": &"load", "a": &"load", "b": &"g", "resistance": 10.9})
	var heat := Thermal.new()
	heat.add_room(&"room")
	heat.add_object(&"wire-object", {"room_id": &"room", "temperature_c": 20.0, "heat_capacity_kj_c": 0.001})
	heat.add_object(&"load-object", {"room_id": &"room", "temperature_c": 20.0, "heat_capacity_kj_c": 0.001})
	var adapter := Adapter.new(grid, heat)
	case_result(adapter.bind(&"wire", &"wire-object") and adapter.bind(&"load", &"load-object"),
		"adapter binds passive circuit components to authored thermal objects")
	case_result(not adapter.bind(&"battery", &"wire-object"), "finite battery is not treated as a passive heat source")
	var receipt: Dictionary = grid.step(0.1)
	case_result(receipt.ok and adapter.apply_energy_receipt(receipt.energy_j)
		and is_equal_approx(heat.object_state(&"load-object").temperature_c, 21.09)
		and is_equal_approx(heat.object_state(&"wire-object").temperature_c, 20.01),
		"dissipated joules convert to kilojoules and heat the mapped objects")
	var room_overflow := Thermal.new()
	room_overflow.add_object(&"safe", {"temperature_c": 20.0, "heat_capacity_kj_c": 1.0})
	room_overflow.add_object(&"at-ceiling", {"temperature_c": 1000000.0, "heat_capacity_kj_c": 1.0})
	var guarded := Adapter.new(grid, room_overflow)
	guarded.bind(&"wire", &"safe")
	guarded.bind(&"load", &"at-ceiling")
	case_result(not guarded.apply_energy_receipt({&"wire": 1.0, &"load": 1.0})
		and room_overflow.object_state(&"safe").temperature_c == 20.0,
		"aggregate thermal preflight rejects the receipt without partially heating earlier objects")
	case_result(not adapter.apply_energy_receipt({&"load": NAN}), "malformed energy receipt is rejected")
	var shared_grid := Electricity.new()
	shared_grid.add(&"battery", {"kind": &"battery", "a": &"p", "b": &"g", "voltage": 12.0,
		"resistance": 1.0, "capacity_wh": 1.0})
	shared_grid.add(&"pump-load", {"kind": &"load", "a": &"p", "b": &"g", "resistance": 11.0})
	shared_grid.add(&"other-load", {"kind": &"load", "a": &"p", "b": &"g", "resistance": 11.0})
	var shared_heat := Thermal.new()
	shared_heat.add_object(&"pump-heater", {"heat_capacity_kj_c": 0.001})
	shared_heat.add_object(&"other-heater", {"heat_capacity_kj_c": 0.001})
	var shared_adapter := Adapter.new(shared_grid, shared_heat)
	shared_adapter.bind(&"pump-load", &"pump-heater")
	shared_adapter.bind(&"other-load", &"other-heater")
	var pump := NetworkPump.new(shared_grid, &"pump-load", 4.0)
	var fraction: float = pump.power_fraction([{"ml": 10.0, "planned_ml": 10.0}], 0.1)
	var shared_receipt := pump.energy_receipt_j()
	case_result(fraction > 0.0 and float(shared_receipt.get(&"other-load", 0.0)) > 0.8
		and shared_adapter.apply_energy_receipt(shared_receipt)
		and shared_heat.object_state(&"other-heater").temperature_c > 20.0,
		"pump-owned interval receipt includes other-load heat before and after pump shutoff")
	print("GS_ELECTRICITY_THERMAL passed=%d failed=%d" % [passed, failed])
	quit(1 if failed else 0)


func case_result(ok: bool, label: String) -> void:
	if ok:
		passed += 1
	else:
		failed += 1
		push_error("GS_ELECTRICITY_THERMAL: " + label)
