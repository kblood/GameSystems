class_name GSPuddleStore
extends RefCounted
## Bounded typed storage; geometry, ignition and transport belong to adapters.
## A deposit owns the whole incoming amount. Capacity rejection is explicit removal.

const MAX_COMPONENTS := 16
const MAX_VOLUME_ML := 1000000.0
var limit := 24
var _next_id := 1
var _records: Dictionary = {}
var _ledger := {"added_ml": 0.0, "consumed_ml": 0.0, "evaporated_ml": 0.0, "removed_ml": 0.0}

func create() -> int:
	while _records.size() >= maxi(1, limit):
		remove(int(_records.keys()[0]))
	var id := _next_id
	_next_id += 1
	_records[id] = {}
	return id

func contains(id: int) -> bool:
	return _records.has(id)

func deposit(id: int, kind: StringName, ml: float) -> float:
	if not _amount(ml) or ml <= 0.0 or ml > MAX_VOLUME_ML: return 0.0
	_ledger.added_ml += ml
	var key := normalize_kind(kind)
	var accepted := 0.0
	if _records.has(id):
		var components: Dictionary = _records[id]
		if components.has(key) or components.size() < MAX_COMPONENTS:
			accepted = minf(ml, maxf(0.0, MAX_VOLUME_ML - volume(id)))
			if accepted > 0.0: components[key] = float(components.get(key, 0.0)) + accepted
	_ledger.removed_ml += ml - accepted
	return accepted

## Actual typed mL withdrawn; unknown never counts as fuel or extinguishing agent.
func withdraw(id: int, kind: StringName, ml: float) -> float:
	return _take(id, normalize_kind(kind), ml, "consumed_ml")

func evaporate(id: int, kind: StringName, ml: float) -> float:
	return _take(id, normalize_kind(kind), ml, "evaporated_ml")

func _take(id: int, kind: String, ml: float, sink: String) -> float:
	if not _records.has(id) or not _amount(ml): return 0.0
	var components: Dictionary = _records[id]
	var actual := minf(ml, float(components.get(kind, 0.0)))
	if actual <= 0.0: return 0.0
	var remainder := float(components[kind]) - actual
	if remainder <= 0.0: components.erase(kind)
	else: components[kind] = remainder
	_ledger[sink] += actual
	return actual

func remove(id: int) -> float:
	var actual := volume(id)
	_records.erase(id)
	_ledger.removed_ml += actual
	return actual

func clear() -> void:
	for id: int in _records.keys(): remove(id)

func components(id: int) -> Dictionary:
	return (_records.get(id, {}) as Dictionary).duplicate(true)

func volume(id: int) -> float:
	var total := 0.0
	for ml: Variant in (_records.get(id, {}) as Dictionary).values(): total += float(ml)
	return total

func ledger() -> Dictionary:
	var state := _ledger.duplicate()
	state["held_ml"] = 0.0
	for id: int in _records: state.held_ml += volume(id)
	return state

func snapshot() -> Dictionary:
	var records := []
	for id: int in _records: records.append({"id": id, "components": components(id)})
	return {"version": 1, "next_id": _next_id, "records": records, "ledger": _ledger.duplicate()}

## Validation is complete before mutation; JSON round trips preserve stable IDs.
func restore(state: Dictionary) -> bool:
	if state.get("version") != 1 or not _integer(state.get("next_id")) \
		or not state.get("records") is Array or not state.get("ledger") is Dictionary:
		return false
	var next_id := int(state.next_id)
	var records: Array = state.records
	if next_id < 1 or records.size() > maxi(1, limit): return false
	var staged: Dictionary = {}
	var held := 0.0
	for item: Variant in records:
		if not item is Dictionary or not _integer(item.get("id")) or not item.get("components") is Dictionary: return false
		var id := int(item.id)
		var components: Dictionary = item.components
		if id < 1 or id >= next_id or staged.has(id) or components.size() > MAX_COMPONENTS: return false
		var total := 0.0
		for key: Variant in components:
			if not key is String or key != normalize_kind(StringName(key)) or not _amount(components[key]) or float(components[key]) <= 0.0: return false
			total += float(components[key])
		if total > MAX_VOLUME_ML: return false
		held += total
		staged[id] = components.duplicate(true)
	var ledger: Dictionary = state.ledger
	if ledger.size() != _ledger.size(): return false
	for key: String in _ledger:
		if not _amount(ledger.get(key)): return false
	var accounted := held + float(ledger.consumed_ml) + float(ledger.evaporated_ml) + float(ledger.removed_ml)
	if absf(float(ledger.added_ml) - accounted) > maxf(0.000001, absf(accounted) * 0.00000001): return false
	_records = staged
	_next_id = next_id
	_ledger = ledger.duplicate(true)
	return true

static func normalize_kind(kind: StringName) -> String:
	var key := String(kind).strip_edges()
	return key if not key.is_empty() and key.length() <= 64 else "unknown"

static func _amount(value: Variant) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] and is_finite(float(value)) and float(value) >= 0.0

static func _integer(value: Variant) -> bool:
	return _amount(value) and float(value) == floorf(float(value)) and float(value) <= 9007199254740991.0
