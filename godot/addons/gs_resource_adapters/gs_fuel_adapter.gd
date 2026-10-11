class_name GSFuelAdapter
extends RefCounted
## Reversible Aster-compatible fuel view over a shared GSSupplyTank.

var reversible := true
var kind: String
var _tank: Object

func _init(tank: Object, fuel_kind: String = "petrol") -> void:
	_tank = tank
	kind = fuel_kind
	if not is_instance_valid(tank) or not tank.has_method("is_valid") or not bool(tank.call("is_valid")) or kind.strip_edges().is_empty():
		push_error("GSFuelAdapter needs a valid tank and nonempty fuel kind")

func is_valid() -> bool:
	return is_instance_valid(_tank) and _tank.has_method("is_valid") and bool(_tank.call("is_valid")) and not kind.strip_edges().is_empty()

func state() -> Dictionary:
	if not is_valid(): return {}
	var tank_state: Dictionary = _tank.call("state")
	return {"amountL": float(tank_state.components.get(kind, 0.0)) / 1000.0,
		"capacityL": float(tank_state.capacityMl) / 1000.0, "kind": kind}

func consume(liters: float) -> float:
	if not is_valid() or not _finite_nonnegative(liters) or liters <= 0.0: return 0.0
	return float(_tank.call("withdraw", kind, liters * 1000.0)) / 1000.0

## `liquid_kind` may differ from this adapter's fuel kind so wrong fuel remains in the tank.
func refill(liters: float, liquid_kind: String = "") -> float:
	if not is_valid() or not _finite_nonnegative(liters) or liters <= 0.0: return 0.0
	var transfer_kind := kind if liquid_kind.is_empty() else liquid_kind
	return float(_tank.call("fill", transfer_kind, liters * 1000.0)) / 1000.0

static func _finite_nonnegative(value: Variant) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] and is_finite(float(value)) and float(value) >= 0.0
