class_name GSSpatialFireSpreadSystem
extends RefCounted
## Optional, bounded proximity heating between authored thermal objects in one room.

const MAX_OBJECTS := 256
const FIXED_STEP := 0.05
const MAX_RADIUS_M := 10.0
const MAX_HEAT_KJ_S := 1000.0
# Missing-cell buckets are shared lookups; never append to this fallback array.
const EMPTY_BUCKET: Array = []

var thermal: Object
var radius_m := 1.5
var heat_kj_per_second := 4.0
var _object_ids: Array[StringName] = []
var _valid := false


func _init(thermal_system: Object, spread_radius_m := 1.5, heat_rate_kj_s := 4.0) -> void:
	if thermal_system == null or not thermal_system.has_method("object_state") \
			or not thermal_system.has_method("can_add_heat") or not thermal_system.has_method("add_heat") \
			or not _positive(spread_radius_m) or spread_radius_m > MAX_RADIUS_M \
			or not _positive(heat_rate_kj_s) or heat_rate_kj_s > MAX_HEAT_KJ_S:
		return
	thermal = thermal_system
	radius_m = float(spread_radius_m)
	heat_kj_per_second = float(heat_rate_kj_s)
	_valid = true


func is_valid() -> bool:
	return _valid


func register_object(id: StringName) -> bool:
	if not _valid or id == &"" or id in _object_ids or _object_ids.size() >= MAX_OBJECTS:
		return false
	if thermal.object_state(id).is_empty(): return false
	_object_ids.append(id)
	return true


func unregister_object(id: StringName) -> bool:
	var index := _object_ids.find(id)
	if index < 0: return false
	_object_ids.remove_at(index)
	return true


## Call once per matching thermal interval, after its thermal step. Newly ignited targets
## become spread sources on the next call, preventing same-pass cascading.
func step(delta: float) -> Dictionary:
	if not _valid or not is_finite(delta) or absf(delta - FIXED_STEP) > 1.0e-9:
		return {"ok": false, "pairs": 0, "heated": 0}
	var source_ids: Array[StringName] = []
	var source_positions: Array[Vector3] = []
	var source_rooms: Array[StringName] = []
	var target_ids: Array[StringName] = []
	var target_positions: Array[Vector3] = []
	var target_rooms: Array[StringName] = []
	for id: StringName in _object_ids:
		var state: Dictionary = thermal.object_state(id)
		if state.is_empty() or not state.get("position") is Vector3: return {"ok": false, "pairs": 0, "heated": 0}
		var room_id := StringName(state.get("room_id", &""))
		if room_id == &"": continue
		var position: Vector3 = state.position
		if state.get("burning", false):
			source_ids.append(id)
			source_positions.append(position)
			source_rooms.append(room_id)
		elif float(state.get("flammability", 0.0)) > 0.0 and float(state.get("fuel", 0.0)) > 0.0 \
				and float(state.get("wetness", 0.0)) < 0.8 and float(state.get("foam_ml", 0.0)) <= 0.0:
			target_ids.append(id)
			target_positions.append(position)
			target_rooms.append(room_id)
	var target_grid: Dictionary = {}
	for target_index in range(target_ids.size()):
		var room_id: StringName = target_rooms[target_index]
		var room_cells: Dictionary = target_grid.get(room_id, {})
		var cell := _cell(target_positions[target_index])
		var bucket: Array = room_cells.get(cell, [])
		bucket.append(target_index)
		room_cells[cell] = bucket
		target_grid[room_id] = room_cells
	var heat_by_target: Array[float] = []
	for _target_index in range(target_ids.size()): heat_by_target.append(0.0)
	var pairs := 0
	var radius_squared := radius_m * radius_m
	var empty_room_grid: Dictionary = {}
	for source_index in range(source_ids.size()):
		var room_cells: Dictionary = target_grid.get(source_rooms[source_index], empty_room_grid)
		var source_position: Vector3 = source_positions[source_index]
		var source_cell := _cell(source_position)
		for x in range(-1, 2):
			for y in range(-1, 2):
				for z in range(-1, 2):
					var bucket: Array = room_cells.get(source_cell + Vector3i(x, y, z), EMPTY_BUCKET)
					for target_index: int in bucket:
						pairs += 1
						var distance_squared := source_position.distance_squared_to(target_positions[target_index])
						if distance_squared >= radius_squared: continue
						var falloff := 1.0 - sqrt(distance_squared) / radius_m
						var energy_kj := heat_kj_per_second * delta * falloff * falloff
						if energy_kj > 0.0: heat_by_target[target_index] += energy_kj
	var heated := 0
	for target_index in range(target_ids.size()):
		if heat_by_target[target_index] <= 0.0: continue
		if not thermal.can_add_heat(target_ids[target_index], heat_by_target[target_index]):
			return {"ok": false, "pairs": pairs, "heated": 0, "reason": &"thermal_budget"}
	for target_index in range(target_ids.size()):
		if heat_by_target[target_index] <= 0.0: continue
		if not thermal.add_heat(target_ids[target_index], heat_by_target[target_index]):
			return {"ok": false, "pairs": pairs, "heated": 0, "reason": &"thermal_commit"}
		heated += 1
	return {"ok": true, "pairs": pairs, "heated": heated}


func dispose() -> void:
	_object_ids.clear()
	_valid = false


static func _positive(value: Variant) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] and is_finite(float(value)) and float(value) > 0.0


func _cell(position: Vector3) -> Vector3i:
	return Vector3i(floori(position.x / radius_m), floori(position.y / radius_m), floori(position.z / radius_m))
