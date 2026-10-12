class_name GSSpatialFireSpreadSystem
extends RefCounted
## Optional, bounded proximity heating between authored thermal objects in one room.

const MAX_OBJECTS := 256
const FIXED_STEP := 0.05
const MAX_RADIUS_M := 10.0
const MAX_HEAT_KJ_S := 1000.0

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
	var snapshot: Array[Dictionary] = []
	for id: StringName in _object_ids:
		var state: Dictionary = thermal.object_state(id)
		if state.is_empty() or not state.get("position") is Vector3: return {"ok": false, "pairs": 0, "heated": 0}
		snapshot.append({"id": id, "state": state})
	var heat_by_target: Dictionary = {}
	var pairs := 0
	for source_index in range(snapshot.size()):
		var source: Dictionary = snapshot[source_index]
		var source_state: Dictionary = source.state
		if not source_state.get("burning", false): continue
		var source_room: StringName = source_state.get("room_id", &"")
		if source_room == &"": continue
		for target_index in range(snapshot.size()):
			if source_index == target_index: continue
			pairs += 1
			var target: Dictionary = snapshot[target_index]
			var target_state: Dictionary = target.state
			if target_state.get("room_id", &"") != source_room or target_state.get("burning", false) \
					or float(target_state.get("flammability", 0.0)) <= 0.0 \
					or float(target_state.get("fuel", 0.0)) <= 0.0 \
					or float(target_state.get("wetness", 0.0)) >= 0.8 \
					or float(target_state.get("foam_ml", 0.0)) > 0.0:
				continue
			var distance := (source_state.position as Vector3).distance_to(target_state.position as Vector3)
			if distance >= radius_m: continue
			var falloff := 1.0 - distance / radius_m
			var energy_kj := heat_kj_per_second * delta * falloff * falloff
			if energy_kj <= 0.0: continue
			var target_id: StringName = target.id
			heat_by_target[target_id] = float(heat_by_target.get(target_id, 0.0)) + energy_kj
	for target_id: StringName in heat_by_target:
		if not thermal.can_add_heat(target_id, float(heat_by_target[target_id])):
			return {"ok": false, "pairs": pairs, "heated": 0, "reason": &"thermal_budget"}
	for target_id: StringName in heat_by_target:
		if not thermal.add_heat(target_id, float(heat_by_target[target_id])):
			return {"ok": false, "pairs": pairs, "heated": 0, "reason": &"thermal_commit"}
	return {"ok": true, "pairs": pairs, "heated": heat_by_target.size()}


func dispose() -> void:
	_object_ids.clear()
	_valid = false


static func _positive(value: Variant) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] and is_finite(float(value)) and float(value) > 0.0
