class_name GSSprinklerSystem
extends RefCounted
## Bounded gameplay sprinkler controller. It models heat response and typed flow, not hydraulics.

const FIXED_STEP := 0.1
const MAX_CATCHUP_STEPS := 8
const MAX_FRAME_DELTA := FIXED_STEP * MAX_CATCHUP_STEPS
const MAX_HEADS := 64
const MAX_TARGETS_PER_HEAD := 16
const MAX_FLOW_ML_S := 1000000.0
const MAX_RANGE_M := 50.0
const CHECKPOINT_VERSION := 1

var thermal: GSThermalSystem
var power_provider: Object
var _supplies: Dictionary = {}
var _heads: Dictionary = {}
var _accumulator := 0.0
var _clock := 0.0
var _stepping := false


func _init(thermal_system: GSThermalSystem = null) -> void:
	thermal = thermal_system


func register_supply(id: StringName, supply: Object) -> bool:
	if _stepping or id == &"" or supply == null or _supplies.has(id) or not supply.has_method("state") \
			or not supply.has_method("withdraw"):
		return false
	var state: Variant = supply.call("state")
	if not state is Dictionary or not state.has("components") or not state.components is Dictionary:
		return false
	_supplies[id] = supply
	return true


func unregister_supply(id: StringName) -> bool:
	if _stepping or not _supplies.has(id): return false
	for head: Dictionary in _heads.values():
		if head.supply_id == id: return false
	_supplies.erase(id)
	return true


## Optional adapter with power_fraction(requests, dt) -> float in [0, 1].
func set_power_provider(provider: Object) -> bool:
	if _stepping: return false
	if provider == null:
		power_provider = null
		return true
	if not provider.has_method("power_fraction"): return false
	power_provider = provider
	return true


func add_head(id: StringName, values: Dictionary) -> bool:
	if _stepping or thermal == null or id == &"" or _heads.size() >= MAX_HEADS or _heads.has(id): return false
	var room_id := StringName(values.get("room_id", &""))
	var supply_id := StringName(values.get("supply_id", &""))
	var kind := StringName(values.get("kind", &"water"))
	var target_ids: Variant = values.get("target_ids", [])
	var position: Variant = values.get("position", Vector3.ZERO)
	var flow: Variant = values.get("flow_ml_s", 60.0)
	var trigger: Variant = values.get("trigger_temperature_c", 68.0)
	var response: Variant = values.get("response_seconds", 5.0)
	var max_range: Variant = values.get("range_m", 8.0)
	if room_id == &"" or thermal.room_state(room_id).is_empty() or not _supplies.has(supply_id) \
			or kind == &"" or not position is Vector3 or not position.is_finite() \
			or not _bounded(flow, 0.01, MAX_FLOW_ML_S) or not _bounded(trigger, 20.0, 1000.0) \
			or not _bounded(response, 0.05, 3600.0) or not _bounded(max_range, 0.1, MAX_RANGE_M) \
			or typeof(values.get("valve_open", true)) != TYPE_BOOL or not target_ids is Array:
		return false
	var targets: Array[StringName] = []
	for target: Variant in target_ids:
		if not target is StringName or target == &"" or targets.has(target) or targets.size() >= MAX_TARGETS_PER_HEAD:
			return false
		targets.append(target)
	_heads[id] = {"id": id, "room_id": room_id, "supply_id": supply_id, "kind": kind,
		"position": position, "target_ids": targets, "flow_ml_s": float(flow),
		"trigger_temperature_c": float(trigger), "response_seconds": float(response),
		"range_m": float(max_range), "valve_open": bool(values.get("valve_open", true)),
		"sensor_temperature_c": GSThermalSystem.AMBIENT_C, "triggered": false, "manual": false}
	return true


func remove_head(id: StringName) -> bool:
	if _stepping: return false
	return _heads.erase(id)


func set_valve_open(id: StringName, is_open: bool) -> bool:
	if _stepping or not _heads.has(id): return false
	_heads[id].valve_open = is_open
	return true


func trigger(id: StringName) -> bool:
	if _stepping or not _heads.has(id): return false
	var head: Dictionary = _heads[id]
	head.triggered = true
	head.manual = true
	return true


## Models replacing a spent head. It can only be reset after its thermal sensor cools.
func reset_head(id: StringName) -> bool:
	if _stepping or not _heads.has(id): return false
	var head: Dictionary = _heads[id]
	if head.sensor_temperature_c >= head.trigger_temperature_c: return false
	head.triggered = false
	head.manual = false
	return true


func head_state(id: StringName) -> Dictionary:
	if not _heads.has(id): return {}
	return (_heads[id] as Dictionary).duplicate(true)


## Captures head configuration/latches and fixed-step time; dependencies are separate snapshots.
func checkpoint() -> Dictionary:
	if _stepping: return {}
	var heads: Array[Dictionary] = []
	for id: StringName in _heads:
		var head: Dictionary = (_heads[id] as Dictionary).duplicate(true)
		var position: Vector3 = head.position
		head.erase("position")
		head.id = String(id)
		head.room_id = String(head.room_id)
		head.supply_id = String(head.supply_id)
		head.kind = String(head.kind)
		head.position_xyz = [position.x, position.y, position.z]
		var targets: Array[String] = []
		for target_id: StringName in head.target_ids: targets.append(String(target_id))
		head.target_ids = targets
		heads.append(head)
	return {"version": CHECKPOINT_VERSION, "clock": _clock, "pending_seconds": _accumulator,
		"powered": power_provider != null, "heads": heads}


## Rebuilds and validates every head in isolation before committing the new head map and clock.
func restore_checkpoint(payload: Variant) -> bool:
	if _stepping or thermal == null or not payload is Dictionary \
			or payload.get("version") != CHECKPOINT_VERSION \
			or not _bounded(payload.get("clock", NAN), 0.0, INF) \
			or not _bounded(payload.get("pending_seconds", NAN), 0.0, FIXED_STEP + 1.0e-8) \
			or typeof(payload.get("powered")) != TYPE_BOOL \
			or bool(payload.powered) != (power_provider != null) \
			or not payload.get("heads") is Array or payload.heads.size() > MAX_HEADS:
		return false
	var candidate := GSSprinklerSystem.new(thermal)
	candidate._supplies = _supplies.duplicate()
	for row: Variant in payload.heads:
		if not row is Dictionary or not row.get("id") is String or String(row.id).is_empty() \
				or not row.get("room_id") is String or not row.get("supply_id") is String \
				or not row.get("kind") is String \
				or not row.get("position_xyz") is Array or row.position_xyz.size() != 3 \
				or not row.get("target_ids") is Array or typeof(row.get("triggered")) != TYPE_BOOL \
				or typeof(row.get("manual")) != TYPE_BOOL or typeof(row.get("valve_open")) != TYPE_BOOL \
				or not _bounded(row.get("sensor_temperature_c", NAN), -273.15, 1000000.0):
			return false
		var xyz: Array = row.position_xyz
		if not _bounded(xyz[0], -INF, INF) or not _bounded(xyz[1], -INF, INF) \
				or not _bounded(xyz[2], -INF, INF):
			return false
		var targets: Array[StringName] = []
		for target: Variant in row.target_ids:
			if not target is String or String(target).is_empty(): return false
			targets.append(StringName(target))
		var values := {"room_id": StringName(row.get("room_id", "")),
			"supply_id": StringName(row.get("supply_id", "")), "kind": StringName(row.get("kind", "")),
			"target_ids": targets, "position": Vector3(float(xyz[0]), float(xyz[1]), float(xyz[2])),
			"flow_ml_s": row.get("flow_ml_s", NAN),
			"trigger_temperature_c": row.get("trigger_temperature_c", NAN),
			"response_seconds": row.get("response_seconds", NAN), "range_m": row.get("range_m", NAN),
			"valve_open": bool(row.valve_open)}
		if not candidate.add_head(StringName(row.id), values): return false
		var restored_head: Dictionary = candidate._heads[StringName(row.id)]
		if bool(row.manual) and not bool(row.triggered): return false
		restored_head.sensor_temperature_c = float(row.sensor_temperature_c)
		restored_head.triggered = bool(row.triggered)
		restored_head.manual = bool(row.manual)
	_heads = candidate._heads
	_clock = float(payload.clock)
	_accumulator = float(payload.pending_seconds)
	return true


func step(delta: float) -> Dictionary:
	if _stepping or not is_finite(delta) or delta < 0.0 or delta > MAX_FRAME_DELTA \
			or _accumulator + delta > MAX_FRAME_DELTA + 1.0e-9:
		return {"ok": false, "steps": 0, "pending_seconds": _accumulator, "events": []}
	_accumulator += delta
	_stepping = true
	var events: Array[Dictionary] = []
	var steps := 0
	while _accumulator + 1.0e-9 >= FIXED_STEP and steps < MAX_CATCHUP_STEPS:
		_tick(FIXED_STEP, events)
		_accumulator -= FIXED_STEP
		_clock += FIXED_STEP
		steps += 1
	_stepping = false
	return {"ok": true, "steps": steps, "pending_seconds": _accumulator, "events": events}


func _tick(dt: float, events: Array[Dictionary]) -> void:
	var requests_by_supply: Dictionary = {}
	var requests: Array[Dictionary] = []
	for id: StringName in _heads:
		var head: Dictionary = _heads[id]
		var room: Dictionary = thermal.room_state(head.room_id)
		if room.is_empty(): continue
		var response := float(head.response_seconds)
		var blend := 1.0 - exp(-dt / response)
		head.sensor_temperature_c = lerpf(float(head.sensor_temperature_c), float(room.temperature_c), blend)
		if not head.triggered and head.sensor_temperature_c >= float(head.trigger_temperature_c):
			head.triggered = true
			head.manual = false
			events.append({"type": &"triggered", "head_id": id, "room_id": head.room_id,
				"sensor_temperature_c": float(head.sensor_temperature_c)})
		if not head.valve_open or not head.triggered: continue
		var supply: Object = _supplies.get(head.supply_id)
		if supply == null: continue
		var request_ml := float(head.flow_ml_s) * dt
		var demand: Dictionary = requests_by_supply.get(head.supply_id, {})
		demand[head.kind] = float(demand.get(head.kind, 0.0)) + request_ml
		requests_by_supply[head.supply_id] = demand
		requests.append({"head_id": id, "supply_id": head.supply_id, "kind": head.kind, "ml": request_ml})
	var shares_by_supply: Dictionary = {}
	for supply_id: StringName in requests_by_supply:
		var supply: Object = _supplies[supply_id]
		var supply_state: Variant = supply.call("state")
		if not supply_state is Dictionary or not supply_state.get("components", {}) is Dictionary: continue
		var components: Dictionary = supply_state.components
		var demand: Dictionary = requests_by_supply[supply_id]
		var shares: Dictionary = {}
		for kind: StringName in demand:
			var requested := float(demand[kind])
			var amount: Variant = components.get(String(kind), 0.0)
			if not _bounded(amount, 0.0, 1.0e18): continue
			shares[kind] = minf(1.0, float(amount) / requested) if requested > 0.0 else 0.0
		shares_by_supply[supply_id] = shares
	var allocated: Array[Dictionary] = []
	for request: Dictionary in requests:
		if not _supplies.has(request.supply_id) or not _heads.has(request.head_id) \
				or not shares_by_supply.has(request.supply_id): continue
		var share := float((shares_by_supply[request.supply_id] as Dictionary).get(request.kind, 0.0))
		if share <= 0.0: continue
		var planned := float(request.ml) * share
		if planned > 0.0:
			var allocation := request.duplicate(true)
			allocation.planned_ml = planned
			allocated.append(allocation)
	var power_scale := 1.0
	var actual_delivered_ml := 0.0
	if power_provider != null and not allocated.is_empty():
		var power_result: Variant = power_provider.call("power_fraction", allocated.duplicate(true), dt)
		if not _bounded(power_result, 0.0, 1.0):
			power_scale = 0.0
			events.append({"type": &"power_fault", "reason": &"invalid_fraction"})
		else:
			power_scale = float(power_result)
	for request: Dictionary in allocated:
		var head: Dictionary = _heads[request.head_id]
		var supply: Object = _supplies[request.supply_id]
		var planned := float(request.planned_ml) * power_scale
		if planned <= 0.0: continue
		var actual_variant: Variant = supply.call("withdraw", String(request.kind), planned)
		if not _bounded(actual_variant, 0.0, planned) or float(actual_variant) <= 0.0: continue
		var actual := float(actual_variant)
		actual_delivered_ml += actual
		var affected: Array[StringName] = []
		var thermal_applied := 0.0
		if request.kind in [&"water", &"foam"]:
			var targets: Array = head.target_ids
			for target_id: StringName in targets:
				var target: Dictionary = thermal.object_state(target_id)
				if target.is_empty() or target.room_id != head.room_id: continue
				if (target.position as Vector3).distance_to(head.position) > float(head.range_m): continue
				affected.append(target_id)
			if not affected.is_empty():
				var per_target := actual / float(affected.size())
				var applied_targets: Array[StringName] = []
				for target_id: StringName in affected:
					var applied := thermal.apply_liquid(target_id, request.kind, per_target)
					if applied > 0.0:
						thermal_applied += applied
						applied_targets.append(target_id)
				affected = applied_targets
		events.append({"type": &"spray", "head_id": request.head_id,
			"supply_id": request.supply_id, "kind": request.kind, "ml": actual,
			"power_fraction": power_scale,
			"position": head.position, "room_id": head.room_id, "affected_targets": affected,
			"thermal_applied_ml": thermal_applied,
			"source": StringName("sprinkler:" + String(request.head_id))})
	if power_provider != null and not allocated.is_empty():
		events.append({"type": &"power", "fraction": power_scale,
			"requested_ml": _sum_allocated(allocated), "delivered_ml": actual_delivered_ml})


func stats() -> Dictionary:
	var triggered := 0
	var flowing := 0
	for head: Dictionary in _heads.values():
		if head.triggered: triggered += 1
		if head.triggered and head.valve_open: flowing += 1
	return {"heads": _heads.size(), "supplies": _supplies.size(), "triggered": triggered,
		"flowing": flowing, "powered": power_provider != null, "clock": _clock,
		"pending_seconds": _accumulator}


static func _sum_allocated(requests: Array[Dictionary]) -> float:
	var total := 0.0
	for request: Dictionary in requests:
		total += float(request.planned_ml)
	return total


static func _bounded(value: Variant, low: float, high: float) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] and is_finite(float(value)) and float(value) >= low and float(value) <= high
