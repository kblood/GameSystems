extends SceneTree

const Thermal = preload("res://addons/gs_thermal/gs_thermal_system.gd")
const FireSpread = preload("res://addons/gs_fire_spread/gs_spatial_fire_spread_system.gd")

var passed := 0
var failed := 0


func _initialize() -> void:
	var thermal := Thermal.new()
	thermal.add_room(&"kitchen")
	thermal.add_room(&"hall")
	thermal.add_object(&"fire", {"room_id": &"kitchen", "position": Vector3.ZERO,
		"temperature_c": 300.0, "ignition_c": 200.0, "fuel": 100.0, "burn_rate": 0.01})
	thermal.add_object(&"near", {"room_id": &"kitchen", "position": Vector3(0.5, 0.0, 0.0),
		"temperature_c": 20.0, "ignition_c": 21.0, "heat_capacity_kj_c": 0.001,
		"flammability": 1.0, "fuel": 1.0, "burn_rate": 0.01})
	thermal.add_object(&"far", {"room_id": &"kitchen", "position": Vector3(3.0, 0.0, 0.0),
		"temperature_c": 20.0, "ignition_c": 21.0, "flammability": 1.0, "fuel": 1.0, "burn_rate": 0.01})
	thermal.add_object(&"other-room", {"room_id": &"hall", "position": Vector3(0.25, 0.0, 0.0),
		"temperature_c": 20.0, "ignition_c": 21.0, "flammability": 1.0, "fuel": 1.0, "burn_rate": 0.01})
	var spread := FireSpread.new(thermal, 1.5, 4.0)
	case_result(spread.register_object(&"fire") and spread.register_object(&"near")
		and spread.register_object(&"far") and spread.register_object(&"other-room"),
		"bounded spread system registers authored thermal objects")
	var report: Dictionary = spread.step(0.05)
	case_result(report.ok and report.pairs == 3 and report.heated == 1
		and thermal.object_state(&"near").burning
		and thermal.object_state(&"far").temperature_c == 20.0
		and thermal.object_state(&"other-room").temperature_c == 20.0,
		"burning object heats only nearby flammable objects in the same room")

	var chain := Thermal.new()
	chain.add_room(&"room")
	for row: Array in [[&"source", 0.0, 300.0, 200.0], [&"middle", 1.0, 20.0, 21.0], [&"end", 2.0, 20.0, 21.0]]:
		chain.add_object(row[0], {"room_id": &"room", "position": Vector3(float(row[1]), 0.0, 0.0),
			"temperature_c": float(row[2]), "ignition_c": float(row[3]), "heat_capacity_kj_c": 0.001,
			"flammability": 1.0, "fuel": 1.0, "burn_rate": 0.01})
	var chain_spread := FireSpread.new(chain, 1.1, 10.0)
	for id: StringName in [&"source", &"middle", &"end"]: chain_spread.register_object(id)
	chain_spread.step(0.05)
	case_result(chain.object_state(&"middle").burning and not chain.object_state(&"end").burning,
		"newly ignited object cannot cascade spread in the same pass")
	chain_spread.step(0.05)
	case_result(chain.object_state(&"end").burning, "newly burning object spreads on the following interval")
	var before := float(chain.object_state(&"end").temperature_c)
	case_result(not chain_spread.step(FireSpread.FIXED_STEP * 2.0).ok
		and is_equal_approx(chain.object_state(&"end").temperature_c, before),
		"nonmatching spread interval is rejected before state changes")

	var guarded := Thermal.new()
	guarded.add_room(&"room")
	guarded.add_object(&"source", {"room_id": &"room", "position": Vector3.ZERO,
		"temperature_c": 300.0, "ignition_c": 200.0, "fuel": 1.0, "burn_rate": 0.01})
	guarded.add_object(&"safe", {"room_id": &"room", "position": Vector3(0.1, 0.0, 0.0),
		"temperature_c": 20.0, "heat_capacity_kj_c": 1.0, "fuel": 1.0, "burn_rate": 0.01})
	guarded.add_object(&"ceiling", {"room_id": &"room", "position": Vector3(0.2, 0.0, 0.0),
		"temperature_c": 999999.75, "ignition_c": 1000000.0, "heat_capacity_kj_c": 100.0,
		"fuel": 1.0, "burn_rate": 0.01})
	var guarded_spread := FireSpread.new(guarded, 1.5, 1000.0)
	for id: StringName in [&"source", &"safe", &"ceiling"]: guarded_spread.register_object(id)
	var guarded_report: Dictionary = guarded_spread.step(0.05)
	case_result(not guarded_report.ok and guarded.object_state(&"safe").temperature_c == 20.0,
		"target thermal cap failure rejects all spread heat without a partial update")
	print("GS_SPATIAL_FIRE_SPREAD passed=%d failed=%d" % [passed, failed])
	quit(1 if failed else 0)


func case_result(ok: bool, label: String) -> void:
	if ok:
		passed += 1
	else:
		failed += 1
		push_error("GS_SPATIAL_FIRE_SPREAD: " + label)
