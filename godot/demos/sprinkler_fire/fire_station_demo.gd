extends Node3D
## Small runnable composition of the native thermal, supply, battery, pump and sprinkler kernels.

const Thermal = preload("res://addons/gs_thermal/gs_thermal_system.gd")
const FireSpread = preload("res://addons/gs_fire_spread/gs_spatial_fire_spread_system.gd")
const SupplyTank = preload("res://addons/gs_resource_adapters/gs_supply_tank.gd")
const Sprinklers = preload("res://addons/gs_sprinklers/gs_sprinkler_system.gd")
const Electricity = preload("res://addons/gs_electricity/gs_electricity_system.gd")
const NetworkPump = preload("res://addons/gs_electricity/gs_electricity_network_pump.gd")
const PuddleStore = preload("res://addons/gs_bottles/gs_puddle_store.gd")
const PuddleFire = preload("res://addons/gs_thermal/gs_puddle_fire_adapter.gd")

const ROOM_ID := &"demo-room"
const FIRE_ID := &"burning-pallet"
const SPREAD_FIRE_ID := &"nearby-crate"
const SPILL_FIRE_ID := &"diesel-spill-fire"
const HEAD_ID := &"ceiling-head"
const SUPPLY_ID := &"water-tank"
const BATTERY_ID := &"pump-battery"
const FUSE_ID := &"pump-fuse"
const MAIN_SWITCH_ID := &"main-switch"
const FAULT_SWITCH_ID := &"fault-switch"
const WATER_CAPACITY_ML := 20000.0

var thermal: RefCounted
var fire_spread: RefCounted
var tank: RefCounted
var battery: RefCounted
var pump: RefCounted
var electricity: RefCounted
var sprinklers: RefCounted
var puddles: RefCounted
var puddle_fire: RefCounted
var diesel_puddle_id := -1
var valve_open := true
var main_switch_on := true
var fault_switch_on := false
var last_spray_ml := 0.0
var last_puddle_result: Dictionary = {}
var _spill_spread_registered := false
var _spray_linger_seconds := 0.0
var _status_label: Label3D
var _spray_visual: MeshInstance3D
var _fire_visual: MeshInstance3D
var _fire_light: OmniLight3D
var _spread_fire_visual: MeshInstance3D
var _spill_fire_visual: MeshInstance3D
var _spill_visual: MeshInstance3D


func _ready() -> void:
	_build_scene()
	thermal = Thermal.new()
	# A low bounded capacity makes automatic sensor activation visible in a short demo.
	thermal.add_room(ROOM_ID, {"temperature_c": 20.0, "heat_capacity_kj_c": 0.1})
	thermal.add_object(FIRE_ID, {"room_id": ROOM_ID, "position": Vector3.ZERO,
		"temperature_c": 450.0, "ignition_c": 250.0, "heat_capacity_kj_c": 8.0,
		"flammability": 0.9, "fuel": 300.0, "burn_rate": 2.0, "heat_kj_per_fuel": 18.0})
	thermal.add_object(SPREAD_FIRE_ID, {"room_id": ROOM_ID, "position": Vector3(0.8, 0.0, 0.0),
		"temperature_c": 20.0, "ignition_c": 240.0, "heat_capacity_kj_c": 0.001,
		"flammability": 1.0, "fuel": 80.0, "burn_rate": 1.0, "heat_kj_per_fuel": 16.0})
	thermal.add_object(SPILL_FIRE_ID, {"room_id": ROOM_ID, "position": Vector3(-1.35, 0.0, 0.0),
		"temperature_c": 20.0, "ignition_c": 250.0, "heat_capacity_kj_c": 0.05,
		"flammability": 0.9, "fuel": 120.0, "burn_rate": 0.4, "heat_kj_per_fuel": 18.0})
	fire_spread = FireSpread.new(thermal)
	fire_spread.register_object(FIRE_ID)
	fire_spread.register_object(SPREAD_FIRE_ID)
	puddles = PuddleStore.new()
	diesel_puddle_id = puddles.create()
	puddles.deposit(diesel_puddle_id, &"diesel", 1200.0)
	puddles.deposit(diesel_puddle_id, &"water", 600.0)
	puddle_fire = PuddleFire.new(thermal)
	_sync_spill_visual()
	tank = SupplyTank.new(WATER_CAPACITY_ML, {"water": WATER_CAPACITY_ML})
	electricity = Electricity.new()
	electricity.add(BATTERY_ID, {"kind": &"battery", "a": &"battery+", "b": &"ground",
		"capacity_wh": 180.0, "energy_wh": 180.0, "voltage": 12.0, "resistance": 0.08})
	electricity.add(&"feed-wire", {"kind": &"wire", "a": &"battery+", "b": &"switch-in", "resistance": 0.02})
	electricity.add(MAIN_SWITCH_ID, {"kind": &"switch", "a": &"switch-in", "b": &"fuse-in",
		"resistance": 0.02, "enabled": true})
	electricity.add(FUSE_ID, {"kind": &"fuse", "a": &"fuse-in", "b": &"pump-bus",
		"resistance": 0.02, "rating": 16.0})
	electricity.add(&"pump-load", {"kind": &"load", "a": &"pump-bus", "b": &"ground",
		"resistance": 1.2, "enabled": false})
	electricity.add(FAULT_SWITCH_ID, {"kind": &"switch", "a": &"pump-bus", "b": &"fault-bus",
		"resistance": 0.02, "enabled": false})
	electricity.add(&"fault-load", {"kind": &"load", "a": &"fault-bus", "b": &"ground",
		"resistance": 0.1})
	battery = electricity.battery_adapter(BATTERY_ID)
	pump = NetworkPump.new(electricity, &"pump-load", 120.0)
	sprinklers = Sprinklers.new(thermal)
	sprinklers.register_supply(SUPPLY_ID, tank)
	sprinklers.set_power_provider(pump)
	sprinklers.add_head(HEAD_ID, {"room_id": ROOM_ID, "supply_id": SUPPLY_ID,
		"target_ids": [FIRE_ID, SPREAD_FIRE_ID], "position": Vector3(0.0, 3.0, 0.0), "flow_ml_s": 240.0,
		"trigger_temperature_c": 70.0, "response_seconds": 1.5, "range_m": 4.0})
	_sync_fire_visual()
	_update_status()


func _process(delta: float) -> void:
	advance(delta)


func _unhandled_key_input(event: InputEvent) -> void:
	if not event is InputEventKey or not event.pressed or event.echo: return
	match event.keycode:
		KEY_F: trigger_head()
		KEY_V: set_valve(not valve_open)
		KEY_B: set_battery_enabled(not bool(battery.state().enabled))
		KEY_S: set_main_switch(not main_switch_on)
		KEY_X: set_fault_switch(not fault_switch_on)
		KEY_C: replace_fuse()
		KEY_R: refill_water()
		KEY_I: ignite_diesel_spill()
		KEY_E: extinguish_diesel_spill()


## Testable host tick; each kernel applies its own fixed-step budget.
func advance(delta: float) -> Dictionary:
	if thermal == null or sprinklers == null: return {"ok": false}
	if not is_finite(delta) or delta < 0.0: return {"ok": false}
	var thermal_pending := float(thermal.stats().pending_seconds)
	var sprinkler_pending := float(sprinklers.stats().pending_seconds)
	var shared_budget := minf(Thermal.MAX_FRAME_DELTA - thermal_pending,
		Sprinklers.MAX_FRAME_DELTA - sprinkler_pending)
	if delta > shared_budget: return {"ok": false, "reason": &"frame_budget"}
	var fire_result := {"ok": true, "steps": 0, "pending_seconds": thermal_pending, "events": []}
	var sprinkler_result := {"ok": true, "steps": 0, "pending_seconds": sprinkler_pending, "events": []}
	var spread_steps := 0
	var remaining := delta
	var thermal_debt := thermal_pending
	var sprinkler_debt := sprinkler_pending
	while remaining > 1.0e-9:
		var slice := minf(remaining, minf(Thermal.FIXED_STEP - thermal_debt,
			Sprinklers.FIXED_STEP - sprinkler_debt))
		var tick: Dictionary = thermal.step(slice)
		if not tick.get("ok", false): return {"ok": false, "reason": &"thermal_tick"}
		fire_result.steps += int(tick.get("steps", 0))
		fire_result.pending_seconds = float(tick.get("pending_seconds", 0.0))
		fire_result.events.append_array(tick.get("events", []))
		thermal_debt = fire_result.pending_seconds
		remaining = maxf(0.0, remaining - slice)
		if int(tick.get("steps", 0)) == 1:
			var spread_tick: Dictionary = fire_spread.step(Thermal.FIXED_STEP)
			if not spread_tick.get("ok", false): return {"ok": false, "reason": &"spread_tick"}
			spread_steps += 1
		var sprinkler_tick: Dictionary = sprinklers.step(slice)
		if not sprinkler_tick.get("ok", false): return {"ok": false, "reason": &"sprinkler_tick"}
		sprinkler_result.steps += int(sprinkler_tick.get("steps", 0))
		sprinkler_result.pending_seconds = float(sprinkler_tick.get("pending_seconds", 0.0))
		sprinkler_result.events.append_array(sprinkler_tick.get("events", []))
		sprinkler_debt = sprinkler_result.pending_seconds
	last_spray_ml = 0.0
	for event: Dictionary in sprinkler_result.get("events", []):
		if event.get("type") == &"spray": last_spray_ml += float(event.ml)
	if last_spray_ml > 0.0:
		_spray_linger_seconds = 0.18
	else:
		_spray_linger_seconds = maxf(0.0, _spray_linger_seconds - delta)
	_spray_visual.visible = _spray_linger_seconds > 0.0
	_sync_fire_visual()
	_update_status()
	return {"ok": fire_result.ok and sprinkler_result.ok, "thermal": fire_result,
		"sprinklers": sprinkler_result, "spray_ml": last_spray_ml, "spread_steps": spread_steps}


func trigger_head() -> bool:
	if sprinklers == null: return false
	return sprinklers.trigger(HEAD_ID)


func set_valve(open: bool) -> bool:
	if sprinklers == null: return false
	if not sprinklers.set_valve_open(HEAD_ID, open): return false
	valve_open = open
	_update_status()
	return true


func set_battery_enabled(enabled: bool) -> void:
	if electricity != null: electricity.set_enabled(BATTERY_ID, enabled)
	_update_status()


func set_main_switch(enabled: bool) -> void:
	if electricity != null and electricity.set_enabled(MAIN_SWITCH_ID, enabled): main_switch_on = enabled
	_update_status()


func set_fault_switch(enabled: bool) -> void:
	if electricity != null and electricity.set_enabled(FAULT_SWITCH_ID, enabled): fault_switch_on = enabled
	_update_status()


func replace_fuse() -> bool:
	if electricity == null: return false
	var replaced: bool = electricity.replace_fuse(FUSE_ID)
	_update_status()
	return replaced


func refill_water() -> float:
	if tank == null: return 0.0
	var state: Dictionary = tank.state()
	var added: float = tank.fill("water", WATER_CAPACITY_ML - float(state.ml))
	_update_status()
	return added


func ignite_diesel_spill() -> Dictionary:
	if thermal == null or puddles == null or puddle_fire == null: return {"ok": false}
	var state: Dictionary = thermal.object_state(SPILL_FIRE_ID)
	if state.is_empty() or bool(state.burning) or float(state.wetness) >= 0.8:
		last_puddle_result = {"ok": false, "reason": &"target_not_ignitable",
			"kind": &"", "ml": 0.0, "energy_kj": 0.0}
		_sync_spill_visual()
		_update_status()
		return last_puddle_result
	last_puddle_result = puddle_fire.burn_fuel_puddle(puddles, diesel_puddle_id, SPILL_FIRE_ID, 400.0)
	if last_puddle_result.get("ok", false) and not _spill_spread_registered:
		_spill_spread_registered = fire_spread.register_object(SPILL_FIRE_ID)
	_sync_spill_visual()
	_update_status()
	return last_puddle_result


func extinguish_diesel_spill() -> Dictionary:
	if thermal == null or puddles == null or puddle_fire == null: return {"ok": false}
	last_puddle_result = puddle_fire.extinguish_from_puddle(
		puddles, diesel_puddle_id, SPILL_FIRE_ID, &"water", 200.0)
	_sync_spill_visual()
	_update_status()
	return last_puddle_result


func demo_state() -> Dictionary:
	if thermal == null or sprinklers == null: return {}
	return {"fire": thermal.object_state(FIRE_ID), "spread_fire": thermal.object_state(SPREAD_FIRE_ID),
		"spill_fire": thermal.object_state(SPILL_FIRE_ID),
		"room": thermal.room_state(ROOM_ID),
		"supply": tank.state(), "battery": battery.state(), "pump": pump.state(),
		"head": sprinklers.head_state(HEAD_ID), "valve_open": valve_open,
		"main_switch_on": main_switch_on, "fault_switch_on": fault_switch_on,
		"fuse_blown": electricity.state(FUSE_ID).blown,
		"last_spray_ml": last_spray_ml, "spray_visible": _spray_visual.visible,
		"diesel_puddle": puddles.components(diesel_puddle_id), "puddle_ledger": puddles.ledger(),
		"diesel_spill_visible": _spill_visual.visible, "spill_fire_visible": _spill_fire_visual.visible,
		"spill_status": _spill_status(),
		"last_puddle_result": last_puddle_result.duplicate(true)}


func _build_scene() -> void:
	var floor_mesh := _box(Vector3(8.0, 0.2, 8.0), Vector3(0.0, -0.1, 0.0), Color(0.22, 0.24, 0.25))
	add_child(floor_mesh)
	add_child(_box(Vector3(8.0, 4.0, 0.2), Vector3(0.0, 2.0, -4.0), Color(0.29, 0.31, 0.32)))
	add_child(_box(Vector3(0.2, 4.0, 8.0), Vector3(-4.0, 2.0, 0.0), Color(0.29, 0.31, 0.32)))
	add_child(_box(Vector3(0.2, 4.0, 8.0), Vector3(4.0, 2.0, 0.0), Color(0.29, 0.31, 0.32)))
	_fire_visual = _sphere(0.75, Vector3(0.0, 0.8, 0.0), Color(1.0, 0.26, 0.035), true)
	add_child(_fire_visual)
	_spread_fire_visual = _sphere(0.38, Vector3(0.8, 0.45, 0.0), Color(1.0, 0.43, 0.04), true)
	add_child(_spread_fire_visual)
	_spill_visual = MeshInstance3D.new()
	var spill_mesh := PlaneMesh.new()
	spill_mesh.size = Vector2(1.25, 0.72)
	_spill_visual.mesh = spill_mesh
	_spill_visual.position = Vector3(-1.35, 0.012, 0.0)
	var spill_material := _material(Color(0.08, 0.075, 0.055, 0.94))
	spill_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_spill_visual.material_override = spill_material
	add_child(_spill_visual)
	_spill_fire_visual = _sphere(0.42, Vector3(-1.35, 0.52, 0.0), Color(1.0, 0.34, 0.025), true)
	add_child(_spill_fire_visual)
	_fire_light = OmniLight3D.new()
	_fire_light.position = Vector3(0.0, 1.0, 0.0)
	_fire_light.light_color = Color(1.0, 0.26, 0.06)
	_fire_light.light_energy = 2.2
	_fire_light.omni_range = 7.0
	add_child(_fire_light)
	var head := _sphere(0.16, Vector3(0.0, 3.72, 0.0), Color(0.72, 0.78, 0.82))
	add_child(head)
	_spray_visual = _cylinder(0.65, 2.3, Vector3(0.0, 2.42, 0.0), Color(0.2, 0.62, 1.0, 0.32))
	_spray_visual.visible = false
	add_child(_spray_visual)
	var camera := Camera3D.new()
	camera.position = Vector3(7.5, 5.8, 9.0)
	camera.current = true
	add_child(camera)
	camera.look_at(Vector3(0.0, 1.6, 0.0), Vector3.UP)
	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-52.0, -28.0, 0.0)
	light.light_energy = 1.1
	add_child(light)
	_status_label = Label3D.new()
	_status_label.position = Vector3(0.0, 3.35, -3.86)
	_status_label.font_size = 34
	_status_label.pixel_size = 0.004
	_status_label.modulate = Color(0.9, 0.96, 1.0)
	add_child(_status_label)


func _sync_fire_visual() -> void:
	var state: Dictionary = thermal.object_state(FIRE_ID)
	var spread_state: Dictionary = thermal.object_state(SPREAD_FIRE_ID)
	var burning := bool(state.get("burning", false))
	_fire_visual.visible = burning
	_fire_light.visible = burning
	_spread_fire_visual.visible = bool(spread_state.get("burning", false))
	_sync_spill_visual()
	if burning:
		var size := 0.65 + minf(0.4, float(state.fuel) / 750.0)
		_fire_visual.scale = Vector3.ONE * size


func _sync_spill_visual() -> void:
	if not is_instance_valid(_spill_visual) or puddles == null or diesel_puddle_id < 0: return
	var components: Dictionary = puddles.components(diesel_puddle_id)
	var volume_ml: float = puddles.volume(diesel_puddle_id)
	_spill_visual.visible = volume_ml > 0.0
	if volume_ml > 0.0:
		var scale_factor := sqrt(clampf(volume_ml / 1800.0, 0.0, 1.0))
		_spill_visual.scale = Vector3(scale_factor, 1.0, scale_factor)
	var spill_material := _spill_visual.material_override as StandardMaterial3D
	if spill_material != null:
		spill_material.albedo_color = Color(0.08, 0.075, 0.055, 0.94) if float(components.get("diesel", 0.0)) > 0.0 \
			else Color(0.06, 0.22, 0.42, 0.9)
	if is_instance_valid(_spill_fire_visual) and thermal != null:
		_spill_fire_visual.visible = bool(thermal.object_state(SPILL_FIRE_ID).get("burning", false))


func _spill_status() -> String:
	if thermal == null or puddles == null: return "UNAVAILABLE"
	var state: Dictionary = thermal.object_state(SPILL_FIRE_ID)
	if state.is_empty(): return "UNAVAILABLE"
	if bool(state.burning): return "BURNING"
	if float(state.wetness) >= 0.8: return "WET"
	if float(puddles.components(diesel_puddle_id).get("diesel", 0.0)) <= 0.0: return "EMPTY"
	return "READY"


func _update_status() -> void:
	if _status_label == null or tank == null or battery == null: return
	var head: Dictionary = sprinklers.head_state(HEAD_ID) if sprinklers != null else {}
	var battery_state: Dictionary = battery.state()
	var water_ml := float(tank.state().components.get("water", 0.0))
	var spill_components: Dictionary = puddles.components(diesel_puddle_id) if puddles != null and diesel_puddle_id >= 0 else {}
	_status_label.text = "F trigger | V valve | B battery | S switch | X fault | C fuse | R refill | I ignite spill | E cool spill\nHead: %s  Valve: %s  Switch: %s  Fuse: %s  Water: %.0f mL\nBattery: %.1f / %.1f Wh  Smoke: %.2f  Diesel spill: %.0f mL (%s)" % [
		"ON" if head.get("triggered", false) else "standby", "OPEN" if valve_open else "CLOSED",
		"ON" if main_switch_on else "OFF", "BLOWN" if electricity != null and electricity.state(FUSE_ID).blown else "OK",
		water_ml, float(battery_state.energy_wh), float(battery_state.capacity_wh),
		float(thermal.room_state(ROOM_ID).get("smoke", 0.0)) if thermal != null else 0.0,
		float(spill_components.get("diesel", 0.0)), _spill_status()]


func _box(size: Vector3, location: Vector3, color: Color) -> MeshInstance3D:
	var mesh := BoxMesh.new()
	mesh.size = size
	var node := MeshInstance3D.new()
	node.mesh = mesh
	node.position = location
	node.material_override = _material(color)
	return node


func _sphere(radius: float, location: Vector3, color: Color, emission := false) -> MeshInstance3D:
	var mesh := SphereMesh.new()
	mesh.radius = radius
	mesh.height = radius * 2.0
	var node := MeshInstance3D.new()
	node.mesh = mesh
	node.position = location
	node.material_override = _material(color, emission)
	return node


func _cylinder(radius: float, height: float, location: Vector3, color: Color) -> MeshInstance3D:
	var mesh := CylinderMesh.new()
	mesh.top_radius = 0.04
	mesh.bottom_radius = radius
	mesh.height = height
	var node := MeshInstance3D.new()
	node.mesh = mesh
	node.position = location
	node.material_override = _material(color)
	return node


func _material(color: Color, emission := false) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	if color.a < 1.0:
		material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	if emission:
		material.emission_enabled = true
		material.emission = color
	return material
