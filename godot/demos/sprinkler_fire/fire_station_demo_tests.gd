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
		and initial.battery.energy_wh == 180.0 and not initial.fuse_blown
		and not initial.room_smoke_visual.visible and not initial.adjacent_smoke_visual.visible,
		"scene composes an active fire, finite water supply and fused battery circuit")
	case_result(initial.mission.status == &"active" and initial.mission.fires_out == 2
		and initial.mission.fire_count == 3 and initial.mission.adjacent_safe,
		"scenario begins active with the burning pallet and safe adjacent compartment objectives visible")
	case_result(initial.difficulty == "standard" and initial.difficulty_profile.fire_fuel == 300.0
		and initial.supply.capacityMl == 20000.0 and initial.status_text.contains("[STANDARD]"),
		"default standard profile retains the established fire and water values and is visible")
	var training_demo: Node3D = DemoScene.instantiate()
	training_demo.difficulty = "training"
	root.add_child(training_demo)
	var high_risk_demo: Node3D = DemoScene.instantiate()
	high_risk_demo.difficulty = "high_risk"
	root.add_child(high_risk_demo)
	var training_state: Dictionary = training_demo.demo_state()
	var high_risk_state: Dictionary = high_risk_demo.demo_state()
	var training_fuel_before: float = training_state.fire.fuel
	var high_risk_fuel_before: float = high_risk_state.fire.fuel
	training_demo.advance(0.2)
	high_risk_demo.advance(0.2)
	var training_burned := training_fuel_before - float(training_demo.demo_state().fire.fuel)
	var high_risk_burned := high_risk_fuel_before - float(high_risk_demo.demo_state().fire.fuel)
	case_result(training_state.difficulty == "training" and high_risk_state.difficulty == "high_risk"
		and training_state.supply.capacityMl == 30000.0 and high_risk_state.supply.capacityMl == 14000.0
		and training_state.head.flow_ml_s == 300.0 and high_risk_state.head.flow_ml_s == 180.0
		and high_risk_burned > training_burned,
		"training and high-risk profiles change finite water and actual relative fire burn workload")
	training_demo.queue_free()
	high_risk_demo.queue_free()
	var invalid_difficulty_demo: Node3D = DemoScene.instantiate()
	invalid_difficulty_demo.difficulty = "unknown"
	root.add_child(invalid_difficulty_demo)
	case_result(invalid_difficulty_demo.demo_state().difficulty == "standard",
		"unknown scenario difficulty falls back to the verified standard profile")
	invalid_difficulty_demo.queue_free()
	var mission_demo: Node3D = DemoScene.instantiate()
	root.add_child(mission_demo)
	var mission_fire: Dictionary = mission_demo.demo_state().fire
	var cooled_fire_ml: float = mission_demo.thermal.apply_liquid(&"burning-pallet", &"water", 200.0)
	var secured_mission: Dictionary = mission_demo.mission_state()
	mission_demo._update_status()
	case_result(mission_fire.burning and cooled_fire_ml == 200.0
		and secured_mission.status == &"secured" and secured_mission.fires_out == 3
		and secured_mission.adjacent_safe and mission_demo._status_label.text.contains("MISSION: SECURED"),
		"scenario reports secured in its state and on-screen status only after all targets are out and the adjacent room is safe")
	mission_demo.queue_free()
	var unsafe_mission_demo: Node3D = DemoScene.instantiate()
	root.add_child(unsafe_mission_demo)
	unsafe_mission_demo.thermal.apply_liquid(&"burning-pallet", &"water", 200.0)
	unsafe_mission_demo.thermal.configure_room(&"adjacent-room", {"smoke": 0.3})
	var unsafe_mission: Dictionary = unsafe_mission_demo.mission_state()
	case_result(unsafe_mission.status == &"active" and not unsafe_mission.adjacent_safe,
		"mission remains active when the extinguished fire targets have an unsafe adjacent smoke level")
	unsafe_mission_demo.queue_free()
	var missing_mission_demo: Node3D = DemoScene.instantiate()
	root.add_child(missing_mission_demo)
	missing_mission_demo.thermal.apply_liquid(&"burning-pallet", &"water", 200.0)
	missing_mission_demo.thermal.remove_object(&"diesel-spill-fire")
	var missing_mission: Dictionary = missing_mission_demo.mission_state()
	case_result(missing_mission.status == &"active" and missing_mission.fires_out == 2
		and missing_mission.missing_fires == [&"diesel-spill-fire"],
		"mission fails closed when a required fire target is missing from thermal state")
	missing_mission_demo.queue_free()
	var compartments_demo: Node3D = DemoScene.instantiate()
	root.add_child(compartments_demo)
	var demo_camera := compartments_demo.get_node_or_null("DemoCamera") as Camera3D
	case_result(demo_camera != null and demo_camera.position.x < 4.0 and demo_camera.position.z > 4.0
		and is_equal_approx(demo_camera.position.x, compartments_demo._adjacent_smoke_visual.position.x),
		"front cutaway camera keeps the adjacent smoke cue clear of the opaque east wall")
	var closed_door_state: Dictionary = compartments_demo.demo_state()
	var door_panel := compartments_demo._door_visual.get_child(0) as MeshInstance3D
	var closed_geometry_ok := (is_zero_approx(compartments_demo._door_visual.rotation.y)
		and is_equal_approx(door_panel.global_position.z, 0.0)
		and is_equal_approx((door_panel.mesh as BoxMesh).size.z, 1.2))
	case_result(closed_geometry_ok, "closed door panel is centered and covers the authored wall opening")
	var closed_room_ok := true
	for _tick in 10:
		closed_room_ok = closed_room_ok and bool(compartments_demo.advance(0.1).ok)
	var isolated_room: Dictionary = compartments_demo.demo_state().adjacent_room
	case_result(closed_door_state.door.opening == 0.0 and closed_room_ok
		and is_equal_approx(float(isolated_room.smoke), 0.0)
		and is_equal_approx(float(isolated_room.temperature_c), 20.0),
		"closed compartment door isolates the adjacent room from fire smoke and heat")
	var closed_smoke_visuals: Dictionary = compartments_demo.demo_state()
	case_result(closed_smoke_visuals.room_smoke_visual.visible
		and float(closed_smoke_visuals.room_smoke_visual.opacity) > 0.0
		and not closed_smoke_visuals.adjacent_smoke_visual.visible,
		"bounded smoke visuals show fire-room smoke while a closed compartment stays clear")
	var door_key := InputEventKey.new()
	door_key.pressed = true
	door_key.keycode = KEY_H
	compartments_demo._unhandled_key_input(door_key)
	case_result(compartments_demo.demo_state().door.opening == 1.0
		and is_equal_approx(compartments_demo._door_visual.rotation.y, PI * 0.5),
		"H opens the edge-hinged panel and its portal together")
	compartments_demo._unhandled_key_input(door_key)
	case_result(compartments_demo.demo_state().door.opening == 0.0
		and is_zero_approx(compartments_demo._door_visual.rotation.y),
		"H closes the panel over the opening and disables portal exchange")
	compartments_demo._unhandled_key_input(door_key)
	var open_room_ok := true
	for _tick in 10:
		open_room_ok = open_room_ok and bool(compartments_demo.advance(0.1).ok)
	var exposed_room: Dictionary = compartments_demo.demo_state().adjacent_room
	case_result(open_room_ok and float(exposed_room.smoke) > 0.0
		and float(exposed_room.temperature_c) > 20.0,
		"open compartment door exchanges fire smoke and heat into the adjacent room")
	var open_smoke_visuals: Dictionary = compartments_demo.demo_state()
	case_result(open_smoke_visuals.room_smoke_visual.visible
		and open_smoke_visuals.adjacent_smoke_visual.visible
		and float(open_smoke_visuals.adjacent_smoke_visual.opacity) > 0.0,
		"open door activates a visible smoke cue in the adjacent compartment")
	compartments_demo.queue_free()
	case_result(initial.diesel_puddle == {"diesel": 1200.0, "water": 600.0}
		and initial.puddle_ledger.held_ml == 1800.0 and initial.diesel_spill_visible
		and not initial.spill_fire_visible and initial.spill_status == "READY",
		"scene owns a persistent visible mixed diesel/water puddle with explicit typed volume")
	var auto_demo: Node3D = DemoScene.instantiate()
	root.add_child(auto_demo)
	var auto_tick: Dictionary = auto_demo.advance(0.05)
	var auto_state: Dictionary = auto_demo.demo_state()
	case_result(auto_tick.ok and auto_state.spill_fire.burning
		and auto_state.last_puddle_result.ignited
		and auto_state.last_puddle_result.kind == &"diesel"
		and auto_state.diesel_puddle == {"diesel": 800.0, "water": 600.0}
		and auto_state.spill_fire_visible,
		"nearby hot pallet automatically ignites a typed diesel puddle and preserves its water component")
	auto_demo.queue_free()
	var runoff_demo: Node3D = DemoScene.instantiate()
	root.add_child(runoff_demo)
	var water_before: float = runoff_demo.demo_state().supply.components.water
	case_result(runoff_demo.trigger_runoff_head(), "manual floor-runoff head can be triggered")
	var runoff_tick: Dictionary = runoff_demo.advance(0.1)
	var runoff_state: Dictionary = runoff_demo.demo_state()
	var water_receipt: Dictionary = runoff_state.sprinkler_source_receipts.get(&"sprinkler:floor-head", {})
	case_result(runoff_tick.ok and runoff_state.last_spray_ml > 0.0
		and water_receipt.get("kind", &"") == &"water"
		and is_equal_approx(float(water_receipt.get("runoff_ml", -1.0)), float(water_receipt.get("emitted_ml", -2.0)))
		and is_equal_approx(float(water_receipt.get("puddle_ml", -1.0)), float(water_receipt.get("emitted_ml", -2.0)))
		and is_equal_approx(float(water_before - runoff_state.supply.components.water), float(water_receipt.get("emitted_ml", -3.0)))
		and runoff_state.sprinkler_water_puddle.water == float(water_receipt.get("puddle_ml", -4.0))
		and runoff_state.sprinkler_runoff_visible,
		"floor-head water is conserved from finite supply into a visible typed puddle with source receipt")
	var diesel_before: float = runoff_state.diesel_supply.components.diesel
	var diesel_puddle_before: float = runoff_state.diesel_puddle.get("diesel", 0.0)
	var closed_valve_triggered: bool = runoff_demo.trigger_diesel_head()
	var closed_valve_tick: Dictionary = runoff_demo.advance(0.1)
	var closed_valve_state: Dictionary = runoff_demo.demo_state()
	case_result(closed_valve_triggered and closed_valve_tick.ok
		and closed_valve_state.diesel_supply.components.diesel == diesel_before
		and not closed_valve_state.sprinkler_source_receipts.has(&"sprinkler:diesel-head"),
		"closed diesel valve blocks flow from an activated head")
	runoff_demo.set_fuel_valve(true)
	var diesel_tick: Dictionary = runoff_demo.advance(0.1)
	var diesel_state: Dictionary = runoff_demo.demo_state()
	var diesel_receipt: Dictionary = diesel_state.sprinkler_source_receipts.get(&"sprinkler:diesel-head", {})
	runoff_demo.set_fuel_valve(false)
	case_result(diesel_tick.ok and diesel_receipt.get("kind", &"") == &"diesel"
		and is_equal_approx(float(diesel_receipt.get("thermal_applied_ml", -1.0)), 0.0)
		and float(diesel_receipt.get("puddle_ml", 0.0)) > 0.0
		and is_equal_approx(float(diesel_before - diesel_state.diesel_supply.components.diesel), float(diesel_receipt.get("emitted_ml", -1.0)))
		and is_equal_approx(float(diesel_state.diesel_puddle.get("diesel", 0.0) - diesel_puddle_before), float(diesel_receipt.get("puddle_ml", -1.0)))
		and diesel_state.diesel_spill_visible,
		"diesel-head flow debits its finite typed tank and joins the persistent diesel puddle")
	runoff_demo.queue_free()
	var mixed_spray_demo: Node3D = DemoScene.instantiate()
	root.add_child(mixed_spray_demo)
	mixed_spray_demo.set_fuel_valve(true)
	mixed_spray_demo.trigger_runoff_head()
	mixed_spray_demo.trigger_diesel_head()
	var mixed_spray_tick: Dictionary = mixed_spray_demo.advance(0.1)
	var mixed_spray_state: Dictionary = mixed_spray_demo.demo_state()
	var concurrent_visuals: Dictionary = mixed_spray_state.spray_visuals
	case_result(mixed_spray_tick.ok and concurrent_visuals.has(&"sprinkler:floor-head")
		and concurrent_visuals.has(&"sprinkler:diesel-head")
		and concurrent_visuals[&"sprinkler:floor-head"].visible
		and concurrent_visuals[&"sprinkler:diesel-head"].visible
		and concurrent_visuals[&"sprinkler:floor-head"].color == mixed_spray_demo._liquid_color(&"water")
		and concurrent_visuals[&"sprinkler:diesel-head"].color == mixed_spray_demo._liquid_color(&"diesel"),
		"concurrent water and diesel heads retain separate visuals with their exact liquid colors")
	mixed_spray_demo.set_fuel_valve(false)
	mixed_spray_demo.advance(0.1)
	mixed_spray_demo.advance(0.1)
	var isolated_linger: Dictionary = mixed_spray_demo.demo_state().spray_visuals
	case_result(isolated_linger[&"sprinkler:floor-head"].visible
		and not isolated_linger[&"sprinkler:diesel-head"].visible,
		"active water spray refreshes its own linger while the stopped diesel spray expires")
	mixed_spray_demo.queue_free()
	var puddle_ignition: Dictionary = demo.ignite_diesel_spill()
	var lit_spill: Dictionary = demo.demo_state()
	case_result(puddle_ignition.ok and puddle_ignition.kind == &"diesel"
		and puddle_ignition.ml == 400.0 and is_equal_approx(puddle_ignition.energy_kj, 14.4)
		and lit_spill.spill_fire.burning and lit_spill.spill_fire_visible and lit_spill.spill_status == "BURNING"
		and lit_spill.diesel_puddle == {"diesel": 800.0, "water": 600.0}
		and lit_spill.puddle_ledger.consumed_ml == 400.0,
		"typed diesel receipt ignites the spill target and preserves its water component")
	var puddle_quench: Dictionary = demo.extinguish_diesel_spill()
	var quenched_spill: Dictionary = demo.demo_state()
	case_result(puddle_quench.ok and puddle_quench.kind == &"water" and puddle_quench.ml == 200.0
		and not quenched_spill.spill_fire.burning and not quenched_spill.spill_fire_visible and quenched_spill.spill_status == "WET"
		and quenched_spill.diesel_puddle == {"diesel": 800.0, "water": 400.0}
		and quenched_spill.puddle_ledger.consumed_ml == 600.0,
		"typed water receipt extinguishes the diesel spill without consuming its remaining fuel")
	var wet_relight: Dictionary = demo.ignite_diesel_spill()
	var refused_spill: Dictionary = demo.demo_state()
	case_result(not wet_relight.ok and refused_spill.last_puddle_result.reason == &"target_not_ignitable"
		and refused_spill.spill_status == "WET" and refused_spill.puddle_ledger.consumed_ml == 600.0,
		"wet spill refuses relight without consuming another fuel dose")
	var after_quench_tick: Dictionary = demo.advance(0.05)
	var after_quench_state: Dictionary = demo.demo_state()
	case_result(after_quench_tick.ok and not after_quench_state.spill_fire.burning
		and after_quench_state.diesel_puddle.diesel == 800.0
		and after_quench_state.spill_fire.wetness > 0.05
		and after_quench_state.spill_status == "WET",
		"automatic ignition hysteresis prevents immediate hot-source relight after water quenching")
	var sprinkler_spill_demo: Node3D = DemoScene.instantiate()
	root.add_child(sprinkler_spill_demo)
	var sprinkler_spill_ignition: Dictionary = sprinkler_spill_demo.ignite_diesel_spill()
	var sprinkler_spill_triggered: bool = sprinkler_spill_demo.trigger_head()
	var sprinkler_spill_ticks_ok := true
	for _tick in 40:
		sprinkler_spill_ticks_ok = sprinkler_spill_ticks_ok and bool(sprinkler_spill_demo.advance(0.1).ok)
	var sprinkler_spill_state: Dictionary = sprinkler_spill_demo.demo_state()
	var water_head_receipt: Dictionary = sprinkler_spill_state.sprinkler_source_receipts.get(&"sprinkler:ceiling-head", {})
	case_result(sprinkler_spill_ignition.ok and sprinkler_spill_triggered and sprinkler_spill_ticks_ok
		and not sprinkler_spill_state.spill_fire.burning and sprinkler_spill_state.spill_fire.wetness >= 0.8
		and sprinkler_spill_state.diesel_puddle.diesel == 800.0
		and water_head_receipt.get("kind", &"") == &"water"
		and float(water_head_receipt.get("thermal_applied_ml", 0.0)) > 0.0,
		"ceiling sprinkler water reaches and extinguishes burning diesel while preserving remaining fuel")
	sprinkler_spill_demo.queue_free()
	demo.puddles.withdraw(demo.diesel_puddle_id, &"diesel", 800.0)
	demo._sync_spill_visual()
	var water_only: Dictionary = demo.demo_state()
	case_result(water_only.diesel_spill_visible and water_only.diesel_puddle == {"water": 400.0},
		"persistent puddle visualization remains while typed water remains after fuel is exhausted")
	demo.puddles.withdraw(demo.diesel_puddle_id, &"water", 400.0)
	demo._sync_spill_visual()
	case_result(not demo.demo_state().diesel_spill_visible, "empty puddle hides its visual")
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
