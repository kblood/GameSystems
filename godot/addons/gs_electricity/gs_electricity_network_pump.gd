class_name GSElectricityNetworkPump
extends RefCounted
## Shared load adapter. It owns advancing the grid for each sprinkler fixed tick.

const CHECKPOINT_SCHEMA := "gamesystems.network-pump.v1"

var network: Object
var load_id: StringName
var rated_w: float
var total_j := 0.0
var last_energy_j := 0.0
var last_energy_receipt_j: Dictionary = {}
var last_fraction := 0.0
var last_seconds := 0.0
var request_ml := 0.0
var nominal_ml := 0.0
var last_required_j := 0.0
var _valid := false


func _init(power_grid: Object, circuit_load_id: StringName, rated_power_w := 36.0) -> void:
	if power_grid == null or not power_grid.has_method("step") or not power_grid.has_method("evaluate") \
			or not power_grid.has_method("set_enabled") or not power_grid.has_method("state") \
			or not _positive(rated_power_w):
		return
	var load: Dictionary = power_grid.state(circuit_load_id)
	if load.get("kind") != &"load": return
	network = power_grid
	load_id = circuit_load_id
	rated_w = float(rated_power_w)
	_valid = true


func is_valid() -> bool:
	return _valid


func power_fraction(requests: Array, dt: float) -> float:
	last_energy_j = 0.0
	last_energy_receipt_j.clear()
	last_fraction = 0.0
	if not _valid or not _positive(dt) or dt > 10.0: return 0.0
	var requested_ml := 0.0
	var capacity_ml := 0.0
	for request: Variant in requests:
		if not request is Dictionary: return 0.0
		var planned: Variant = request.get("planned_ml", NAN)
		var nominal: Variant = request.get("ml", NAN)
		if not _nonnegative(planned) or not _nonnegative(nominal): return 0.0
		requested_ml += float(planned)
		capacity_ml += float(nominal)
	if not is_finite(requested_ml) or not is_finite(capacity_ml) or requested_ml > capacity_ml + 1.0e-7: return 0.0
	if not network.set_enabled(load_id, requested_ml > 0.0): return 0.0
	var evaluated: Dictionary = network.evaluate()
	if not evaluated.get("ok", false): return 0.0
	var load_state: Dictionary = network.state(load_id)
	var watts := maxf(0.0, float(load_state.get("power", 0.0)))
	var required := rated_w * dt * requested_ml / capacity_ml if capacity_ml > 0.0 else 0.0
	var on_seconds := minf(dt, required / watts) if requested_ml > 0.0 and watts > 0.0 else 0.0
	if on_seconds > 0.0:
		var result: Dictionary = network.step(on_seconds)
		if not result.get("ok", false): return 0.0
		_accumulate_receipt(result.get("energy_j", {}))
		last_energy_j = maxf(0.0, float(result.get("energy_j", {}).get(load_id, 0.0)))
	if on_seconds < dt:
		network.set_enabled(load_id, false)
		var tail: Dictionary = network.step(dt - on_seconds)
		if not tail.get("ok", false): return 0.0
		_accumulate_receipt(tail.get("energy_j", {}))
	last_seconds = dt
	request_ml = requested_ml
	nominal_ml = capacity_ml
	last_required_j = required
	total_j += last_energy_j
	last_fraction = minf(1.0, last_energy_j / required) if required > 0.0 else 0.0
	return last_fraction


func state() -> Dictionary:
	return {"valid": _valid, "load_id": load_id, "rated_w": rated_w, "total_j": total_j,
		"last_energy_j": last_energy_j, "last_fraction": last_fraction, "last_seconds": last_seconds,
		"request_ml": request_ml, "nominal_ml": nominal_ml, "last_required_j": last_required_j}


## Detached per-component energy receipt from the most recent fixed interval.
func energy_receipt_j() -> Dictionary:
	return last_energy_receipt_j.duplicate(true)


func _accumulate_receipt(receipt: Variant) -> void:
	if not receipt is Dictionary: return
	for id: Variant in receipt:
		var value: Variant = receipt[id]
		if typeof(value) not in [TYPE_INT, TYPE_FLOAT] or not is_finite(float(value)): continue
		last_energy_receipt_j[id] = float(last_energy_receipt_j.get(id, 0.0)) + float(value)


func checkpoint() -> Dictionary:
	if not _valid: return {}
	var snapshot := state()
	snapshot.schema = CHECKPOINT_SCHEMA
	return snapshot


func restore_checkpoint(payload: Variant) -> bool:
	if not _valid or not payload is Dictionary or payload.get("schema") != CHECKPOINT_SCHEMA \
			or payload.get("load_id") != load_id or not _same_number(payload.get("rated_w", NAN), rated_w):
		return false
	for key: StringName in [&"total_j", &"last_energy_j", &"last_fraction", &"last_seconds", &"request_ml", &"nominal_ml", &"last_required_j"]:
		if not _nonnegative(payload.get(key, NAN)): return false
	var saved_total := float(payload.total_j)
	var saved_energy := float(payload.last_energy_j)
	var saved_fraction := float(payload.last_fraction)
	var saved_seconds := float(payload.last_seconds)
	var saved_request := float(payload.request_ml)
	var saved_nominal := float(payload.nominal_ml)
	var saved_required := float(payload.last_required_j)
	var expected := rated_w * saved_seconds * saved_request / saved_nominal if saved_nominal > 0.0 else 0.0
	if saved_fraction > 1.0 or saved_seconds > 10.0 or saved_energy > saved_total + 1.0e-7 \
			or saved_request > saved_nominal + 1.0e-7 or absf(expected - saved_required) > 1.0e-7:
		return false
	var expected_fraction := minf(1.0, saved_energy / expected) if expected > 0.0 else 0.0
	if absf(expected_fraction - saved_fraction) > 1.0e-8: return false
	total_j = saved_total
	last_energy_j = saved_energy
	last_fraction = saved_fraction
	last_seconds = saved_seconds
	request_ml = saved_request
	nominal_ml = saved_nominal
	last_required_j = saved_required
	last_energy_receipt_j.clear()
	return true


func dispose() -> void:
	last_energy_receipt_j.clear()
	_valid = false


static func _positive(value: Variant) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] and is_finite(float(value)) and float(value) > 0.0


static func _nonnegative(value: Variant) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] and is_finite(float(value)) and float(value) >= 0.0


static func _same_number(value: Variant, expected: float) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] and is_finite(float(value)) and is_equal_approx(float(value), expected)
