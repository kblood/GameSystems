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
		and initial.battery.energy_wh == 180.0 and not initial.fuse_blown,
		"scene composes an active fire, finite water supply and fused battery circuit")
	var spread_demo: Node3D = DemoScene.instantiate()
	root.add_child(spread_demo)
	var spread_result: Dictionary = spread_demo.advance(0.3)
	case_result(spread_result.ok and spread_result.spread_steps == 6
		and spread_demo.demo_state().spread_fire.burning,
		"spatial fire adapter spreads from the burning pallet to the nearby crate on fixed ticks")
	spread_demo.queue_free()
	var batched_demo: Node3D = DemoScene.instantiate()
	var partitioned_demo: Node3D = DemoScene.instantiate()
	root.add_child(batched_demo)
	root.add_child(partitioned_demo)
	batched_demo.trigger_head()
	partitioned_demo.trigger_head()
	var batched_result: Dictionary = batched_demo.advance(0.3)
	var partitioned_ok := true
	for _frame in 3:
		partitioned_ok = partitioned_ok and bool(partitioned_demo.advance(0.1).ok)
	case_result(batched_result.ok and partitioned_ok
		and batched_demo.thermal.checkpoint() == partitioned_demo.thermal.checkpoint()
		and batched_demo.sprinklers.checkpoint() == partitioned_demo.sprinklers.checkpoint()
		and batched_demo.tank.checkpoint() == partitioned_demo.tank.checkpoint()
		and batched_demo.electricity.checkpoint() == partitioned_demo.electricity.checkpoint(),
		"thermal spread, sprinkler flow and shared grid are invariant to 0.3 s versus 3 x 0.1 s host frames")
	batched_demo.queue_free()
	partitioned_demo.queue_free()
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
		"powered circuit drives the head and debits its finite tank")
	demo.advance(0.05)
	case_result(demo.demo_state().spray_visible,
		"spray visualization persists between fixed sprinkler ticks")
	demo.set_main_switch(false)
	var disconnected: Dictionary = demo.advance(0.1)
	case_result(disconnected.ok and disconnected.spray_ml == 0.0,
		"open main switch disconnects the pump circuit")
	demo.set_main_switch(true)
	demo.set_fault_switch(true)
	var tripped: Dictionary = demo.advance(0.1)
	case_result(tripped.ok and tripped.spray_ml == 0.0 and demo.demo_state().fuse_blown,
		"short-load branch trips the pump fuse and stops sprinkler power")
	demo.set_fault_switch(false)
	case_result(demo.replace_fuse(), "fuse can be replaced after removing the fault load")
	var refill: float = demo.refill_water()
	case_result(refill > 0.0 and demo.demo_state().supply.components.water == 20000.0,
		"scene refills the same typed supply without exceeding tank capacity")
	demo.queue_free()
	var budget_demo: Node3D = DemoScene.instantiate()
	root.add_child(budget_demo)
	var fire_before_reject: Dictionary = budget_demo.thermal.checkpoint()
	var tank_before_reject: Dictionary = budget_demo.tank.checkpoint()
	var electricity_before_reject: Dictionary = budget_demo.electricity.checkpoint()
	var sprinkler_before_reject: Dictionary = budget_demo.sprinklers.checkpoint()
	var rejected_delta: Dictionary = budget_demo.advance(Thermal.MAX_FRAME_DELTA + 5.0e-10)
	case_result(not rejected_delta.ok and budget_demo.thermal.checkpoint() == fire_before_reject
		and budget_demo.tank.checkpoint() == tank_before_reject
		and budget_demo.electricity.checkpoint() == electricity_before_reject
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
