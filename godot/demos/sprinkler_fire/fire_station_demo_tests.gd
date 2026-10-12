extends SceneTree

const DemoScene = preload("res://demos/sprinkler_fire/fire_station_demo.tscn")
const Thermal = preload("res://addons/gs_thermal/gs_thermal_system.gd")

var passed := 0
var failed := 0


func _initialize() -> void:
	call_deferred("_run_tests")


func _run_tests() -> void:
	var demo: Node3D = DemoScene.instantiate()
	root.add_child(demo)
	var initial: Dictionary = demo.demo_state()
	case_result(initial.fire.burning and initial.supply.components.water == 20000.0
		and initial.battery.energyWh == 180.0,
		"scene composes an active fire, finite water supply and charged pump")
	var automatic_demo: Node3D = DemoScene.instantiate()
	root.add_child(automatic_demo)
	for _tick in 20:
		automatic_demo.advance(0.1)
	var automatic: Dictionary = automatic_demo.demo_state()
	case_result(automatic.head.triggered and automatic.supply.components.water < 20000.0,
		"room heat trips the automatic head and draws from its finite tank")
	automatic_demo.queue_free()
	demo.set_valve(false)
	demo.trigger_head()
	var closed: Dictionary = demo.advance(0.1)
	case_result(closed.ok and closed.spray_ml == 0.0
		and demo.demo_state().supply.components.water == 20000.0,
		"closed scene valve prevents fluid flow")
	demo.set_valve(true)
	demo.set_battery_enabled(false)
	var unpowered: Dictionary = demo.advance(0.1)
	case_result(unpowered.ok and unpowered.spray_ml == 0.0
		and demo.demo_state().supply.components.water == 20000.0,
		"disabled scene battery prevents sprinkler flow")
	demo.set_battery_enabled(true)
	var flowing: Dictionary = demo.advance(0.1)
	case_result(flowing.ok and flowing.spray_ml > 0.0 and flowing.spray_ml <= 42.0
		and demo.demo_state().supply.components.water < 20000.0,
		"powered scene head sprays a bounded dose and debits its finite tank")
	demo.advance(0.05)
	case_result(demo.demo_state().spray_visible,
		"spray visualization persists between fixed sprinkler ticks")
	var refill: float = demo.refill_water()
	case_result(refill > 0.0 and demo.demo_state().supply.components.water == 20000.0,
		"scene refills the same typed supply without exceeding tank capacity")
	demo.queue_free()
	var budget_demo: Node3D = DemoScene.instantiate()
	root.add_child(budget_demo)
	var fire_before_reject: Dictionary = budget_demo.thermal.checkpoint()
	var tank_before_reject: Dictionary = budget_demo.tank.checkpoint()
	var battery_before_reject: Dictionary = budget_demo.battery.checkpoint()
	var sprinkler_before_reject: Dictionary = budget_demo.sprinklers.checkpoint()
	var rejected_delta: Dictionary = budget_demo.advance(Thermal.MAX_FRAME_DELTA + 5.0e-10)
	case_result(not rejected_delta.ok and budget_demo.thermal.checkpoint() == fire_before_reject
		and budget_demo.tank.checkpoint() == tank_before_reject
		and budget_demo.battery.checkpoint() == battery_before_reject
		and budget_demo.sprinklers.checkpoint() == sprinkler_before_reject,
		"scene preflights the stricter thermal tick budget before advancing any subsystem")
	budget_demo.queue_free()
	print("GS_FIRE_STATION_DEMO passed=%d failed=%d" % [passed, failed])
	quit(1 if failed else 0)


func case_result(ok: bool, label: String) -> void:
	if ok: passed += 1
	else:
		failed += 1
		push_error("GS_FIRE_STATION_DEMO: " + label)
