class_name GSPuddleFireAdapter
extends RefCounted
## Optional typed bridge. The passed store only needs components(id) and withdraw(id, kind, ml).

const PETROL_KJ_PER_ML := 0.032
const DIESEL_KJ_PER_ML := 0.036
## Gameplay auto-ignition thresholds, not real fuel specifications.
const AUTO_IGNITION_C := {"petrol": 280.0, "diesel": 250.0}
## Retained moisture blocks immediate reignition while the host hot source persists.
const AUTO_REIGNITION_MAX_WETNESS := 0.05
const IGNITION_ENERGY_MARGIN_KJ := 1.0e-9

var thermal: GSThermalSystem

func _init(system: GSThermalSystem = null) -> void:
	thermal = system


## A nearby hot source can ignite a typed fuel puddle within the authored room and radius.
## The thermal target is a gameplay fire proxy; actual consumed liquid remains receipt-based.
func try_auto_ignite_from_hot_source(store: Object, puddle_id: int, source_id: StringName,
		target_id: StringName, requested_ml: float, max_distance_m := 2.0) -> Dictionary:
	if thermal == null or store == null or not store.has_method("components") \
			or not store.has_method("withdraw") or not is_finite(requested_ml) or requested_ml <= 0.0 \
			or not is_finite(max_distance_m) or max_distance_m < 0.0:
		return {"ok": false, "ignited": false, "reason": &"invalid_request"}
	var source: Dictionary = thermal.object_state(source_id)
	var target: Dictionary = thermal.object_state(target_id)
	if source.is_empty() or target.is_empty():
		return {"ok": false, "ignited": false, "reason": &"missing_thermal_object"}
	if bool(target.burning):
		return {"ok": true, "ignited": false, "reason": &"already_burning"}
	var room_id: StringName = StringName(target.room_id)
	if StringName(source.room_id) != room_id or source.position.distance_to(target.position) > max_distance_m:
		return {"ok": true, "ignited": false, "reason": &"outside_ignition_zone"}
	if float(target.wetness) > AUTO_REIGNITION_MAX_WETNESS or float(target.foam_ml) > 0.0 or float(target.fuel) <= 0.0 \
			or float(target.flammability) <= 0.0 or float(target.burn_rate) <= 0.0:
		return {"ok": true, "ignited": false, "reason": &"target_not_ignitable"}
	var initial_room_state: Dictionary = thermal.room_state(room_id) if room_id != &"" else {}
	if room_id != &"" and float(initial_room_state.get("oxygen", 1.0)) < 0.08:
		return {"ok": true, "ignited": false, "reason": &"insufficient_oxygen"}
	var components: Variant = store.call("components", puddle_id)
	if not components is Dictionary:
		return {"ok": false, "ignited": false, "reason": &"invalid_puddle"}
	if not store.has_method("deposit"):
		return {"ok": false, "ignited": false, "reason": &"rollback_not_supported"}
	var kind: StringName = &""
	var first_available_kind: StringName = &""
	var eligible_but_small_kind: StringName = &""
	var planned_ml := 0.0
	var ignition_energy_kj := maxf(0.0, float(target.ignition_c) - float(target.temperature_c)) \
		* float(target.heat_capacity_kj_c)
	for fuel_kind: StringName in [&"petrol", &"diesel"]:
		var available_for_kind := float(components.get(String(fuel_kind), 0.0))
		if available_for_kind <= 0.0: continue
		if first_available_kind == &"": first_available_kind = fuel_kind
		if float(source.temperature_c) < float(AUTO_IGNITION_C[String(fuel_kind)]): continue
		var candidate_ml := minf(minf(requested_ml, 100000.0), available_for_kind)
		var candidate_yield := PETROL_KJ_PER_ML if fuel_kind == &"petrol" else DIESEL_KJ_PER_ML
		if candidate_ml * candidate_yield < ignition_energy_kj + IGNITION_ENERGY_MARGIN_KJ:
			if eligible_but_small_kind == &"": eligible_but_small_kind = fuel_kind
			continue
		kind = fuel_kind
		planned_ml = candidate_ml
		break
	if first_available_kind == &"": return {"ok": true, "ignited": false, "reason": &"no_typed_fuel"}
	if kind == &"":
		if eligible_but_small_kind != &"":
			return {"ok": true, "ignited": false, "reason": &"ignition_dose_too_small", "kind": eligible_but_small_kind}
		return {"ok": true, "ignited": false, "reason": &"fuel_below_auto_ignition", "kind": first_available_kind}
	var yield_kj := PETROL_KJ_PER_ML if kind == &"petrol" else DIESEL_KJ_PER_ML
	var actual_ml := float(store.call("withdraw", puddle_id, kind, planned_ml))
	if not is_finite(actual_ml) or actual_ml <= 0.0:
		return {"ok": false, "ignited": false, "reason": &"invalid_withdrawal_receipt",
			"kind": kind, "withdrawn_ml": 0.0, "refunded_ml": 0.0}
	if actual_ml > planned_ml:
		var invalid_refund := _refund_liquid(store, puddle_id, kind, actual_ml)
		var invalid_refund_complete := _refund_complete(invalid_refund, actual_ml)
		return {"ok": false, "ignited": false,
			"reason": &"invalid_withdrawal_refunded" if invalid_refund_complete else &"rollback_incomplete",
			"kind": kind, "withdrawn_ml": actual_ml, "refunded_ml": invalid_refund}
	var actual_energy_kj := actual_ml * yield_kj
	var latest_target: Dictionary = thermal.object_state(target_id)
	var latest_source: Dictionary = thermal.object_state(source_id)
	var latest_room_state: Dictionary = thermal.room_state(room_id) if room_id != &"" else {}
	var can_commit := latest_target == target and latest_source == source \
		and latest_room_state == initial_room_state \
		and actual_energy_kj >= ignition_energy_kj + IGNITION_ENERGY_MARGIN_KJ \
		and thermal.can_add_heat(target_id, actual_energy_kj)
	if not can_commit:
		var refunded := _refund_liquid(store, puddle_id, kind, actual_ml)
		var refund_complete := _refund_complete(refunded, actual_ml)
		var energy_sufficient := actual_energy_kj >= ignition_energy_kj + IGNITION_ENERGY_MARGIN_KJ
		return {"ok": refund_complete, "ignited": false,
			"reason": &"rollback_incomplete" if not refund_complete else \
				(&"withdrawal_under_delivered" if not energy_sufficient else &"world_state_changed_refunded"),
			"kind": kind, "ml": 0.0, "withdrawn_ml": actual_ml, "refunded_ml": refunded}
	if not thermal.add_heat(target_id, actual_energy_kj):
		var refunded_after_reject := _refund_liquid(store, puddle_id, kind, actual_ml)
		var reject_refund_complete := _refund_complete(refunded_after_reject, actual_ml)
		return {"ok": false, "ignited": false,
			"reason": &"heat_rejected_refunded" if reject_refund_complete else &"rollback_incomplete",
			"kind": kind, "ml": 0.0, "withdrawn_ml": actual_ml, "refunded_ml": refunded_after_reject}
	var ignited := bool(thermal.object_state(target_id).get("burning", false))
	return {"ok": ignited, "ignited": ignited, "reason": &"ignited" if ignited else &"ignition_rejected",
		"kind": kind, "ml": actual_ml, "energy_kj": actual_energy_kj}


func _refund_liquid(store: Object, puddle_id: int, kind: StringName, ml: float) -> float:
	if ml <= 0.0: return 0.0
	var refunded := float(store.call("deposit", puddle_id, kind, ml))
	return refunded if is_finite(refunded) and refunded >= 0.0 else 0.0


func _refund_complete(refunded_ml: float, withdrawn_ml: float) -> bool:
	return is_finite(refunded_ml) and refunded_ml == withdrawn_ml


## Burns only authored petrol/diesel and deposits the accepted gameplay heat to a target.
## The store's withdraw receipt is the authority; color is never inspected.
func burn_fuel_puddle(store: Object, puddle_id: int, target_id: StringName,
		requested_ml: float, preferred_kind: StringName = &"") -> Dictionary:
	if thermal == null or store == null or not store.has_method("components") or not store.has_method("withdraw") \
			or thermal.object_state(target_id).is_empty() or not is_finite(requested_ml) or requested_ml <= 0.0:
		return {"ok": false, "reason": &"invalid_request", "kind": &"", "ml": 0.0, "energy_kj": 0.0}
	var components: Variant = store.call("components", puddle_id)
	if not components is Dictionary: return {"ok": false, "reason": &"invalid_puddle", "kind": &"", "ml": 0.0, "energy_kj": 0.0}
	if not store.has_method("deposit"):
		return {"ok": false, "reason": &"rollback_not_supported", "kind": &"", "ml": 0.0, "energy_kj": 0.0}
	var kind: StringName = preferred_kind
	if kind not in [&"petrol", &"diesel"]:
		kind = &"petrol" if float(components.get("petrol", 0.0)) > 0.0 else &"diesel"
	var yield_kj := PETROL_KJ_PER_ML if kind == &"petrol" else DIESEL_KJ_PER_ML
	var available := float(components.get(String(kind), 0.0))
	if not is_finite(available) or available < 0.0:
		return {"ok": false, "reason": &"invalid_component_amount", "kind": kind, "ml": 0.0, "energy_kj": 0.0}
	var planned := minf(minf(requested_ml, 100000.0), available)
	if planned <= 0.0:
		return {"ok": false, "reason": &"no_fuel", "kind": kind, "ml": 0.0, "energy_kj": 0.0}
	var initial_target: Dictionary = thermal.object_state(target_id)
	if not thermal.can_add_heat(target_id, planned * yield_kj):
		return {"ok": false, "reason": &"heat_preflight_rejected", "kind": kind, "ml": 0.0, "energy_kj": 0.0}
	var actual := float(store.call("withdraw", puddle_id, kind, planned))
	if not is_finite(actual) or actual <= 0.0:
		return {"ok": false, "reason": &"invalid_withdrawal_receipt", "kind": kind, "ml": 0.0, "energy_kj": 0.0}
	if actual > planned:
		var invalid_refund := _refund_liquid(store, puddle_id, kind, actual)
		var invalid_refund_complete := _refund_complete(invalid_refund, actual)
		return {"ok": false, "reason": &"invalid_withdrawal_refunded" if invalid_refund_complete else &"rollback_incomplete",
			"kind": kind, "ml": 0.0, "withdrawn_ml": actual, "refunded_ml": invalid_refund, "energy_kj": 0.0}
	var energy := actual * yield_kj
	var latest_target: Dictionary = thermal.object_state(target_id)
	if latest_target != initial_target or not thermal.can_add_heat(target_id, energy):
		var refunded := _refund_liquid(store, puddle_id, kind, actual)
		var refund_complete := _refund_complete(refunded, actual)
		return {"ok": refund_complete, "reason": &"world_state_changed_refunded" if refund_complete else &"rollback_incomplete",
			"kind": kind, "ml": 0.0, "withdrawn_ml": actual, "refunded_ml": refunded, "energy_kj": 0.0}
	if not thermal.add_heat(target_id, energy):
		var rejected_refund := _refund_liquid(store, puddle_id, kind, actual)
		var rejected_refund_complete := _refund_complete(rejected_refund, actual)
		return {"ok": false, "reason": &"heat_rejected_refunded" if rejected_refund_complete else &"rollback_incomplete",
			"kind": kind, "ml": 0.0, "withdrawn_ml": actual, "refunded_ml": rejected_refund, "energy_kj": 0.0}
	return {"ok": true, "reason": &"burned", "kind": kind, "ml": actual, "energy_kj": energy}


## Only water and foam extinguish; fuel and unknown liquids remain untouched.
func extinguish_from_puddle(store: Object, puddle_id: int, target_id: StringName, kind: StringName, requested_ml: float) -> Dictionary:
	if thermal == null or store == null or not store.has_method("components") or not store.has_method("withdraw") \
			or thermal.object_state(target_id).is_empty() or kind not in [&"water", &"foam"] \
			or not is_finite(requested_ml) or requested_ml <= 0.0:
		return {"ok": false, "reason": &"invalid_request", "kind": kind, "ml": 0.0}
	var components: Variant = store.call("components", puddle_id)
	if not components is Dictionary: return {"ok": false, "reason": &"invalid_puddle", "kind": kind, "ml": 0.0}
	if not store.has_method("deposit"):
		return {"ok": false, "reason": &"rollback_not_supported", "kind": kind, "ml": 0.0}
	var available := float(components.get(String(kind), 0.0))
	if not is_finite(available) or available < 0.0:
		return {"ok": false, "reason": &"invalid_component_amount", "kind": kind, "ml": 0.0}
	var planned := minf(minf(requested_ml, 100000.0), available)
	if planned <= 0.0: return {"ok": false, "reason": &"no_liquid", "kind": kind, "ml": 0.0}
	var initial_target: Dictionary = thermal.object_state(target_id)
	var actual := float(store.call("withdraw", puddle_id, kind, planned))
	if not is_finite(actual) or actual <= 0.0:
		return {"ok": false, "reason": &"invalid_withdrawal_receipt", "kind": kind, "ml": 0.0}
	if actual > planned:
		var invalid_refund := _refund_liquid(store, puddle_id, kind, actual)
		var invalid_refund_complete := _refund_complete(invalid_refund, actual)
		return {"ok": false, "reason": &"invalid_withdrawal_refunded" if invalid_refund_complete else &"rollback_incomplete",
			"kind": kind, "ml": 0.0, "withdrawn_ml": actual, "refunded_ml": invalid_refund}
	if thermal.object_state(target_id) != initial_target:
		var changed_refund := _refund_liquid(store, puddle_id, kind, actual)
		var changed_refund_complete := _refund_complete(changed_refund, actual)
		return {"ok": changed_refund_complete,
			"reason": &"world_state_changed_refunded" if changed_refund_complete else &"rollback_incomplete",
			"kind": kind, "ml": 0.0, "withdrawn_ml": actual, "refunded_ml": changed_refund}
	var applied := thermal.apply_liquid(target_id, kind, actual)
	if applied != actual:
		var application_refund := _refund_liquid(store, puddle_id, kind, actual)
		var application_refund_complete := _refund_complete(application_refund, actual)
		return {"ok": false,
			"reason": &"liquid_rejected_refunded" if application_refund_complete else &"rollback_incomplete",
			"kind": kind, "ml": 0.0, "withdrawn_ml": actual, "refunded_ml": application_refund}
	return {"ok": true, "reason": &"extinguished", "kind": kind, "ml": applied}
