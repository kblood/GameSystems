class_name GSSprinklerBatteryPump
extends RefCounted
## Optional bounded pump adapter. Energy is measured in Wh; output is a shared per-tick fraction.

var battery: Object
var rated_power_w: float
var capacity_flow_ml_s: float
var energy_used_wh := 0.0
var last_fraction := 1.0
var _valid := false


func _init(battery_adapter: Object, rated_w: float, max_flow_ml_s: float) -> void:
	if battery_adapter == null or not battery_adapter.has_method("state") or not battery_adapter.has_method("draw") \
			or not _positive_finite(rated_w) or not _positive_finite(max_flow_ml_s):
		return
	battery = battery_adapter
	rated_power_w = float(rated_w)
	capacity_flow_ml_s = float(max_flow_ml_s)
	_valid = true


func is_valid() -> bool:
	return _valid


## Called once per sprinkler fixed tick with the supply-limited planned doses.
func power_fraction(requests: Array, dt: float) -> float:
	last_fraction = 0.0
	if not _valid or not _positive_finite(dt): return 0.0
	var demand_ml := 0.0
	for request: Variant in requests:
		if not request is Dictionary: return 0.0
		var amount: Variant = request.get("planned_ml", NAN)
		if not _finite_nonnegative(amount): return 0.0
		demand_ml += float(amount)
	if demand_ml <= 0.0:
		last_fraction = 1.0
		return 1.0
	var capacity_ml := capacity_flow_ml_s * float(dt)
	var flow_fraction := minf(1.0, capacity_ml / demand_ml)
	var requested_wh := rated_power_w * float(dt) * flow_fraction / 3600.0
	if requested_wh <= 0.0: return 0.0
	var actual_wh: Variant = battery.call("draw", requested_wh)
	if not _finite_nonnegative(actual_wh) or float(actual_wh) > requested_wh:
		return 0.0
	var energy_fraction := float(actual_wh) / requested_wh
	last_fraction = clampf(flow_fraction * energy_fraction, 0.0, 1.0)
	energy_used_wh += float(actual_wh)
	return last_fraction


func state() -> Dictionary:
	return {"valid": _valid, "rated_power_w": rated_power_w, "capacity_flow_ml_s": capacity_flow_ml_s,
		"energy_used_wh": energy_used_wh, "last_fraction": last_fraction}


static func _finite_nonnegative(value: Variant) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] and is_finite(float(value)) and float(value) >= 0.0


static func _positive_finite(value: Variant) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] and is_finite(float(value)) and float(value) > 0.0
