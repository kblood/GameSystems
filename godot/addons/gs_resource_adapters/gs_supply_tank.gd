class_name GSSupplyTank
extends RefCounted
## Small finite, typed liquid store. Amounts are millilitres; no fluid simulation.

const CHECKPOINT_VERSION := 1

var capacity_ml: float
var _components: Dictionary = {}
var _valid := false

func _init(capacity: float = 0.0, components: Dictionary = {}) -> void:
	if not _finite_nonnegative(capacity) or capacity <= 0.0:
		push_error("GSSupplyTank capacity_ml must be finite and positive")
		return
	var normalized: Dictionary = {}
	var total := 0.0
	for key: Variant in components:
		if not key is String or String(key).strip_edges().is_empty() or not _finite_nonnegative(components[key]):
			push_error("GSSupplyTank components need nonempty string kinds and finite nonnegative amounts")
			return
		var amount := float(components[key])
		if amount > 0.0:
			normalized[String(key)] = amount
			total += amount
	if total > capacity:
		push_error("GSSupplyTank contents exceed capacity")
		return
	capacity_ml = capacity
	_components = normalized
	_valid = true

func is_valid() -> bool:
	return _valid

func state() -> Dictionary:
	if not _valid: return {}
	var total := _total_ml()
	return {"capacityMl": capacity_ml, "components": _components.duplicate(true), "ml": total,
		"freeMl": maxf(0.0, capacity_ml - total)}


## Captures exact typed contents. Restore requires the same authored capacity.
func checkpoint() -> Dictionary:
	if not _valid: return {}
	return {"version": CHECKPOINT_VERSION, "capacity_ml": capacity_ml,
		"components": _components.duplicate(true)}


## Validates the full payload before replacing any contents.
func restore_checkpoint(payload: Variant) -> bool:
	if not _valid or not payload is Dictionary or payload.get("version") != CHECKPOINT_VERSION \
			or not _finite_nonnegative(payload.get("capacity_ml", NAN)) \
			or not is_equal_approx(float(payload.capacity_ml), capacity_ml) \
			or not payload.get("components") is Dictionary:
		return false
	var candidate: Dictionary = {}
	var total := 0.0
	for key: Variant in payload.components:
		var amount: Variant = payload.components[key]
		if not key is String or String(key).strip_edges().is_empty() or not _finite_nonnegative(amount):
			return false
		if float(amount) > 0.0:
			candidate[String(key)] = float(amount)
			total += float(amount)
	if not is_finite(total) or total > capacity_ml: return false
	_components = candidate
	return true

## Returns the actual amount withdrawn. Other components are left untouched.
func withdraw(kind: String, amount_ml: float) -> float:
	if not _valid or kind.strip_edges().is_empty() or not _finite_nonnegative(amount_ml) or amount_ml <= 0.0:
		return 0.0
	var held := float(_components.get(kind, 0.0))
	var actual := minf(amount_ml, held)
	var remainder := held - actual
	if remainder <= 0.0: _components.erase(kind)
	else: _components[kind] = remainder
	return actual

## Returns the actual amount accepted; liquid type is preserved in the mixture.
func fill(kind: String, amount_ml: float) -> float:
	if not _valid or kind.strip_edges().is_empty() or not _finite_nonnegative(amount_ml) or amount_ml <= 0.0:
		return 0.0
	var accepted := minf(amount_ml, maxf(0.0, capacity_ml - _total_ml()))
	if accepted > 0.0: _components[kind] = float(_components.get(kind, 0.0)) + accepted
	return accepted

func _total_ml() -> float:
	var total := 0.0
	for amount: Variant in _components.values(): total += float(amount)
	return total

static func _finite_nonnegative(value: Variant) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] and is_finite(float(value)) and float(value) >= 0.0
