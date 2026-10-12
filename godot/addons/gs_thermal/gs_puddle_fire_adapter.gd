class_name GSPuddleFireAdapter
extends RefCounted
## Optional typed bridge. The passed store only needs components(id) and withdraw(id, kind, ml).

const PETROL_KJ_PER_ML := 0.032
const DIESEL_KJ_PER_ML := 0.036

var thermal: GSThermalSystem

func _init(system: GSThermalSystem = null) -> void:
	thermal = system


## Burns only authored petrol/diesel and deposits the accepted gameplay heat to a target.
## The store's withdraw receipt is the authority; color is never inspected.
func burn_fuel_puddle(store: Object, puddle_id: int, target_id: StringName, requested_ml: float) -> Dictionary:
	if thermal == null or store == null or not store.has_method("components") or not store.has_method("withdraw") \
			or thermal.object_state(target_id).is_empty() or not is_finite(requested_ml) or requested_ml <= 0.0:
		return {"ok": false, "kind": &"", "ml": 0.0, "energy_kj": 0.0}
	var components: Variant = store.call("components", puddle_id)
	if not components is Dictionary: return {"ok": false, "kind": &"", "ml": 0.0, "energy_kj": 0.0}
	var kind: StringName = &"petrol" if float(components.get("petrol", 0.0)) > 0.0 else &"diesel"
	var yield_kj := PETROL_KJ_PER_ML if kind == &"petrol" else DIESEL_KJ_PER_ML
	var available := float(components.get(String(kind), 0.0))
	var planned := minf(minf(requested_ml, 100000.0), available)
	if planned <= 0.0 or not thermal.can_add_heat(target_id, planned * yield_kj):
		return {"ok": false, "kind": &"", "ml": 0.0, "energy_kj": 0.0}
	var actual := float(store.call("withdraw", puddle_id, kind, planned))
	if actual <= 0.0: return {"ok": false, "kind": kind, "ml": 0.0, "energy_kj": 0.0}
	var energy := actual * yield_kj
	if not thermal.add_heat(target_id, energy):
		push_error("GSPuddleFireAdapter: heat commit rejected after typed fuel withdrawal")
		return {"ok": false, "kind": kind, "ml": actual, "energy_kj": 0.0}
	return {"ok": true, "kind": kind, "ml": actual, "energy_kj": energy}


## Only water and foam extinguish; fuel and unknown liquids remain untouched.
func extinguish_from_puddle(store: Object, puddle_id: int, target_id: StringName, kind: StringName, requested_ml: float) -> Dictionary:
	if thermal == null or store == null or not store.has_method("components") or not store.has_method("withdraw") \
			or thermal.object_state(target_id).is_empty() or kind not in [&"water", &"foam"] \
			or not is_finite(requested_ml) or requested_ml <= 0.0:
		return {"ok": false, "kind": kind, "ml": 0.0}
	var components: Variant = store.call("components", puddle_id)
	if not components is Dictionary: return {"ok": false, "kind": kind, "ml": 0.0}
	var planned := minf(minf(requested_ml, 100000.0), float(components.get(String(kind), 0.0)))
	if planned <= 0.0: return {"ok": false, "kind": kind, "ml": 0.0}
	var actual := float(store.call("withdraw", puddle_id, kind, planned))
	if actual <= 0.0: return {"ok": false, "kind": kind, "ml": 0.0}
	var applied := thermal.apply_liquid(target_id, kind, actual)
	return {"ok": applied > 0.0, "kind": kind, "ml": applied}
