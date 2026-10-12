extends Node3D
## Small runnable composition of the native thermal, supply, battery, pump and sprinkler kernels.

const Thermal = preload("res://addons/gs_thermal/gs_thermal_system.gd")
const SupplyTank = preload("res://addons/gs_resource_adapters/gs_supply_tank.gd")
const Battery = preload("res://addons/gs_resource_adapters/gs_battery_adapter.gd")
const Sprinklers = preload("res://addons/gs_sprinklers/gs_sprinkler_system.gd")
const BatteryPump = preload("res://addons/gs_sprinklers/gs_sprinkler_battery_pump.gd")

const ROOM_ID := &"demo-room"
const FIRE_ID := &"burning-pallet"
const HEAD_ID := &"ceiling-head"
const SUPPLY_ID := &"water-tank"
const WATER_CAPACITY_ML := 20000.0

var thermal: RefCounted
var tank: RefCounted
var battery: RefCounted
var pump: RefCounted
var sprinklers: RefCounted
var valve_open := true
var last_spray_ml := 0.0
var _spray_linger_seconds := 0.0
var _status_label: Label3D
var _spray_visual: MeshInstance3D
var _fire_visual: MeshInstance3D
var _fire_light: OmniLight3D


func _ready() -> void:
	_build_scene()
	thermal = Thermal.new()
	# A low bounded capacity makes automatic sensor activation visible in a short demo.
	thermal.add_room(ROOM_ID, {"temperature_c": 20.0, "heat_capacity_kj_c": 0.1})
	thermal.add_object(FIRE_ID, {"room_id": ROOM_ID, "position": Vector3.ZERO,
		"temperature_c": 450.0, "ignition_c": 250.0, "heat_capacity_kj_c": 8.0,
		"flammability": 0.9, "fuel": 300.0, "burn_rate": 2.0, "heat_kj_per_fuel": 18.0})
	tank = SupplyTank.new(WATER_CAPACITY_ML, {"water": WATER_CAPACITY_ML})
	battery = Battery.new(180.0, 180.0, 12.0)
	pump = BatteryPump.new(battery, 120.0, 420.0)
	sprinklers = Sprinklers.new(thermal)
	sprinklers.register_supply(SUPPLY_ID, tank)
	sprinklers.set_power_provider(pump)
	sprinklers.add_head(HEAD_ID, {"room_id": ROOM_ID, "supply_id": SUPPLY_ID,
		"target_ids": [FIRE_ID], "position": Vector3(0.0, 3.0, 0.0), "flow_ml_s": 240.0,
		"trigger_temperature_c": 70.0, "response_seconds": 1.5, "range_m": 4.0})
	_update_status()


func _process(delta: float) -> void:
	advance(delta)


func _unhandled_key_input(event: InputEvent) -> void:
	if not event is InputEventKey or not event.pressed or event.echo: return
	match event.keycode:
		KEY_F: trigger_head()
		KEY_V: set_valve(not valve_open)
		KEY_B: set_battery_enabled(not bool(battery.state().enabled))
		KEY_R: refill_water()


## Testable host tick; each kernel applies its own fixed-step budget.
func advance(delta: float) -> Dictionary:
	if thermal == null or sprinklers == null: return {"ok": false}
	if not is_finite(delta) or delta < 0.0: return {"ok": false}
	var thermal_pending := float(thermal.stats().pending_seconds)
	var sprinkler_pending := float(sprinklers.stats().pending_seconds)
	var shared_budget := minf(Thermal.MAX_FRAME_DELTA - thermal_pending,
		Sprinklers.MAX_FRAME_DELTA - sprinkler_pending)
	if delta > shared_budget: return {"ok": false, "reason": &"frame_budget"}
	var fire_result: Dictionary = thermal.step(delta)
	var sprinkler_result: Dictionary = sprinklers.step(delta)
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
		"sprinklers": sprinkler_result, "spray_ml": last_spray_ml}


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
	if battery != null: battery.set_enabled(enabled)
	_update_status()


func refill_water() -> float:
	if tank == null: return 0.0
	var state: Dictionary = tank.state()
	var added: float = tank.fill("water", WATER_CAPACITY_ML - float(state.ml))
	_update_status()
	return added


func demo_state() -> Dictionary:
	if thermal == null or sprinklers == null: return {}
	return {"fire": thermal.object_state(FIRE_ID), "room": thermal.room_state(ROOM_ID),
		"supply": tank.state(), "battery": battery.state(), "pump": pump.state(),
		"head": sprinklers.head_state(HEAD_ID), "valve_open": valve_open,
		"last_spray_ml": last_spray_ml, "spray_visible": _spray_visual.visible}


func _build_scene() -> void:
	var floor_mesh := _box(Vector3(8.0, 0.2, 8.0), Vector3(0.0, -0.1, 0.0), Color(0.22, 0.24, 0.25))
	add_child(floor_mesh)
	add_child(_box(Vector3(8.0, 4.0, 0.2), Vector3(0.0, 2.0, -4.0), Color(0.29, 0.31, 0.32)))
	add_child(_box(Vector3(0.2, 4.0, 8.0), Vector3(-4.0, 2.0, 0.0), Color(0.29, 0.31, 0.32)))
	add_child(_box(Vector3(0.2, 4.0, 8.0), Vector3(4.0, 2.0, 0.0), Color(0.29, 0.31, 0.32)))
	_fire_visual = _sphere(0.75, Vector3(0.0, 0.8, 0.0), Color(1.0, 0.26, 0.035), true)
	add_child(_fire_visual)
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
	var burning := bool(state.get("burning", false))
	_fire_visual.visible = burning
	_fire_light.visible = burning
	if burning:
		var size := 0.65 + minf(0.4, float(state.fuel) / 750.0)
		_fire_visual.scale = Vector3.ONE * size


func _update_status() -> void:
	if _status_label == null or tank == null or battery == null: return
	var head: Dictionary = sprinklers.head_state(HEAD_ID) if sprinklers != null else {}
	var battery_state: Dictionary = battery.state()
	var water_ml := float(tank.state().components.get("water", 0.0))
	_status_label.text = "F trigger  |  V valve  |  B pump power  |  R refill\nHead: %s  Valve: %s  Water: %.0f mL\nBattery: %.1f / %.1f Wh  Room smoke: %.2f" % [
		"ON" if head.get("triggered", false) else "standby", "OPEN" if valve_open else "CLOSED",
		water_ml, float(battery_state.energyWh), float(battery_state.capacityWh),
		float(thermal.room_state(ROOM_ID).get("smoke", 0.0)) if thermal != null else 0.0]


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
