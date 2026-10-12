class_name GSElectricityThermalAdapter
extends RefCounted
## Explicitly routes dissipated circuit energy into authored thermal objects.

const MAX_BINDINGS := 256
var network: Object
var thermal: Object
var _bindings: Dictionary = {}
var _valid := false


func _init(electricity: Object, heat_system: Object) -> void:
	if electricity == null or heat_system == null or not electricity.has_method("state") \
			or not heat_system.has_method("can_add_heat") or not heat_system.has_method("add_heat"):
		return
	network = electricity
	thermal = heat_system
	_valid = true


func is_valid() -> bool:
	return _valid


## Only passive circuit elements produce routed heat; ideal sources and batteries are excluded.
func bind(electric_id: StringName, thermal_object_id: StringName) -> bool:
	if not _valid or electric_id == &"" or thermal_object_id == &"": return false
	var component: Dictionary = network.state(electric_id)
	if component.get("kind") not in [&"wire", &"switch", &"fuse", &"load"]: return false
	if not thermal.has_method("object_state") or thermal.object_state(thermal_object_id).is_empty(): return false
	if not _bindings.has(electric_id) and _bindings.size() >= MAX_BINDINGS: return false
	_bindings[electric_id] = thermal_object_id
	return true


func unbind(electric_id: StringName) -> bool:
	return _valid and _bindings.erase(electric_id)


## Accepts the `energy_j` map returned by one network step. Call before the matching thermal tick.
## All mapped heat is preflighted in aggregate before any object is changed.
func apply_energy_receipt(energy_j: Variant) -> bool:
	if not _valid or not energy_j is Dictionary or energy_j.size() > MAX_BINDINGS: return false
	var by_object: Dictionary = {}
	for key: Variant in energy_j:
		var value: Variant = energy_j[key]
		if typeof(value) not in [TYPE_INT, TYPE_FLOAT] or not is_finite(float(value)): return false
		if float(value) <= 0.0 or not _bindings.has(key): continue
		var object_id: StringName = _bindings[key]
		var heat_kj := float(value) / 1000.0
		by_object[object_id] = float(by_object.get(object_id, 0.0)) + heat_kj
	for object_id: StringName in by_object:
		if not thermal.can_add_heat(object_id, float(by_object[object_id])): return false
	for object_id: StringName in by_object:
		if not thermal.add_heat(object_id, float(by_object[object_id])): return false
	return true


func dispose() -> void:
	_bindings.clear()
	_valid = false
