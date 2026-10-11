class_name NightfallGearInventory
extends RefCounted
## Pure ownership ledger for physical gear slots. It never reparents scene nodes.
## Register stable IDs and slot definitions before use; the host applies a
## successful transition to its scene tree only after this ledger accepts it.
signal ownership_changed(item_id: String, from_owner: String, to_owner: String, slot_id: String)

const CHECKPOINT_VERSION := 1
const OWNERS := ["world", "hand:left", "hand:right"]

var _slots: Dictionary = {}
var _items: Dictionary = {}
var _slot_items: Dictionary = {}
var _disposed := false
var _transition_emitting := false

## Slot max_size and item size are positive Vector3 dimensions in metres. Size
## is compared after sorting axes, so a rotated item can still fit the cavity.
func add_slot(slot_id: String, allowed_categories: Array[String], max_size: Vector3) -> bool:
	if _disposed or _transition_emitting or slot_id.strip_edges().is_empty() or _slots.has(slot_id): return false
	if not _valid_size(max_size) or allowed_categories.is_empty(): return false
	var categories: Array[String] = []
	for category in allowed_categories:
		if category.strip_edges().is_empty() or category in categories: return false
		categories.append(category)
	_slots[slot_id] = {"categories":categories,"max_size":_canonical_size(max_size)}
	_slot_items[slot_id] = ""
	return true

## item_ref is retained for the host to resolve its registered physical object;
## it is deliberately excluded from checkpoints. Initial ownership is restored
## by reset(), which clears all slot claims without creating or deleting items.
func register_item(item_id: String, item_ref: Variant, category: String, size: Vector3, initial_owner := "world") -> bool:
	if _disposed or _transition_emitting or item_id.strip_edges().is_empty() or _items.has(item_id): return false
	if item_ref == null or category.strip_edges().is_empty() or not _valid_size(size) or not initial_owner in OWNERS: return false
	_items[item_id] = {"ref":item_ref,"category":category,"size":_canonical_size(size),"initial_owner":initial_owner,"owner":initial_owner,"slot":""}
	return true

func has_item(item_id: String) -> bool:
	return not _disposed and _items.has(item_id)

func item_ref(item_id: String) -> Variant:
	return _items[item_id].ref if not _disposed and _items.has(item_id) else null

func owner_of(item_id: String) -> String:
	return String(_items[item_id].owner) if not _disposed and _items.has(item_id) else ""

func slot_of(item_id: String) -> String:
	return String(_items[item_id].slot) if not _disposed and _items.has(item_id) else ""

func item_in_slot(slot_id: String) -> String:
	return String(_slot_items[slot_id]) if not _disposed and _slot_items.has(slot_id) else ""

func can_store(item_id: String, expected_owner: String, slot_id: String) -> bool:
	if _disposed or _transition_emitting or not _items.has(item_id) or not _slots.has(slot_id): return false
	var item: Dictionary = _items[item_id]
	var slot: Dictionary = _slots[slot_id]
	return item.owner == expected_owner and expected_owner in OWNERS and _slot_items[slot_id] == "" and item.category in slot.categories and _fits(item.size, slot.max_size)

## Atomic hand/world -> slot transition. On failure no ownership index changes.
func store(item_id: String, expected_owner: String, slot_id: String) -> bool:
	if not can_store(item_id, expected_owner, slot_id): return false
	_items[item_id].owner = "slot"
	_items[item_id].slot = slot_id
	_slot_items[slot_id] = item_id
	_emit_ownership_changed(item_id, expected_owner, "slot", slot_id)
	return true

## Atomic slot -> hand/world transition. Only a registered valid owner is accepted.
func retrieve(slot_id: String, new_owner: String) -> String:
	if _disposed or _transition_emitting or not _slot_items.has(slot_id) or not new_owner in OWNERS: return ""
	var item_id: String = _slot_items[slot_id]
	if item_id.is_empty() or not _items.has(item_id): return ""
	_items[item_id].owner = new_owner
	_items[item_id].slot = ""
	_slot_items[slot_id] = ""
	_emit_ownership_changed(item_id, "slot", new_owner, slot_id)
	return item_id

## Transfer between hands/world while preserving the single-owner invariant.
func transfer(item_id: String, expected_owner: String, new_owner: String) -> bool:
	if _disposed or _transition_emitting or not _items.has(item_id) or not expected_owner in OWNERS or not new_owner in OWNERS: return false
	var item: Dictionary = _items[item_id]
	if item.owner != expected_owner or not String(item.slot).is_empty(): return false
	if expected_owner == new_owner: return true
	item.owner = new_owner
	_emit_ownership_changed(item_id, expected_owner, new_owner, "")
	return true

## Restore the owner assigned when each stable item ID was registered.
func reset() -> void:
	if _disposed or _transition_emitting: return
	for slot_id in _slot_items: _slot_items[slot_id] = ""
	for item_id in _items:
		_items[item_id].owner = _items[item_id].initial_owner
		_items[item_id].slot = ""

func capture() -> Dictionary:
	if _disposed: return {}
	var item_rows: Dictionary = {}
	for item_id in _items:
		var item: Dictionary = _items[item_id]
		item_rows[item_id] = {"owner":item.owner,"slot":item.slot}
	return {"version":CHECKPOINT_VERSION,"items":item_rows,"slots":_slot_items.duplicate(true)}

## Validate without mutation. Commit the resulting prepared value separately.
## Checkpoints can only refer to the same registered IDs and configured slots.
func prepare_restore(snapshot: Dictionary) -> Dictionary:
	var version: Variant = snapshot.get("version")
	if _disposed or typeof(version) != TYPE_INT or version != CHECKPOINT_VERSION: return {"valid":false,"reason":"version"}
	var rows: Variant = snapshot.get("items")
	var slots: Variant = snapshot.get("slots")
	if not rows is Dictionary or not slots is Dictionary or rows.size() != _items.size() or slots.size() != _slots.size(): return {"valid":false,"reason":"shape"}
	var prepared_items: Dictionary = {}
	var prepared_slots: Dictionary = {}
	var claimed_items: Dictionary = {}
	for item_id in _items:
		if not rows.has(item_id): return {"valid":false,"reason":"item_id"}
		var row: Variant = rows[item_id]
		if not row is Dictionary: return {"valid":false,"reason":"item_row"}
		var owner: Variant = row.get("owner")
		var slot: Variant = row.get("slot")
		if typeof(owner) != TYPE_STRING or typeof(slot) != TYPE_STRING: return {"valid":false,"reason":"item_value_type"}
		if owner in OWNERS:
			if not slot.is_empty(): return {"valid":false,"reason":"owner_slot"}
			prepared_items[item_id] = {"owner":owner,"slot":""}
		elif owner == "slot":
			if not _slots.has(slot): return {"valid":false,"reason":"slot_id"}
			prepared_items[item_id] = {"owner":"slot","slot":slot}
		else: return {"valid":false,"reason":"owner"}
	for slot_id in _slots:
		if not slots.has(slot_id): return {"valid":false,"reason":"slot_id"}
		var item_id: Variant = slots[slot_id]
		if typeof(item_id) != TYPE_STRING: return {"valid":false,"reason":"slot_item_type"}
		if not item_id.is_empty():
			if not _items.has(item_id) or claimed_items.has(item_id): return {"valid":false,"reason":"duplicate_slot_item"}
			claimed_items[item_id] = true
			var item: Dictionary = _items[item_id]
			var slot: Dictionary = _slots[slot_id]
			if item.category not in slot.categories or not _fits(item.size,slot.max_size): return {"valid":false,"reason":"slot_fit"}
			if prepared_items[item_id].owner != "slot" or prepared_items[item_id].slot != slot_id: return {"valid":false,"reason":"owner_mismatch"}
			prepared_slots[slot_id] = item_id
		else: prepared_slots[slot_id] = ""
	for item_id in prepared_items:
		if prepared_items[item_id].owner == "slot" and prepared_slots.get(prepared_items[item_id].slot,"") != item_id:
			return {"valid":false,"reason":"missing_slot_claim"}
	return {"valid":true,"items":prepared_items,"slots":prepared_slots}

func commit_restore(prepared: Dictionary) -> bool:
	if _disposed or _transition_emitting or not bool(prepared.get("valid",false)): return false
	var checked := prepare_restore({"version":CHECKPOINT_VERSION,"items":prepared.get("items",{}),"slots":prepared.get("slots",{})})
	if not bool(checked.get("valid",false)): return false
	for item_id in _items:
		_items[item_id].owner = checked.items[item_id].owner
		_items[item_id].slot = checked.items[item_id].slot
	for slot_id in _slot_items: _slot_items[slot_id] = checked.slots[slot_id]
	return true

## Idempotent teardown. The host remains responsible for scene-tree ownership.
func dispose() -> void:
	if _disposed or _transition_emitting: return
	reset()
	_items.clear()
	_slots.clear()
	_slot_items.clear()
	_disposed = true

func is_disposed() -> bool:
	return _disposed

## Ownership observers are synchronous in Godot. Prevent nested mutations until
## every observer has seen the same committed transition.
func _emit_ownership_changed(item_id: String, from_owner: String, to_owner: String, slot_id: String) -> void:
	_transition_emitting = true
	ownership_changed.emit(item_id, from_owner, to_owner, slot_id)
	_transition_emitting = false

func _valid_size(size: Vector3) -> bool:
	return size.is_finite() and size.x > 0.0 and size.y > 0.0 and size.z > 0.0

func _canonical_size(size: Vector3) -> Vector3:
	var axes := [size.x,size.y,size.z]
	axes.sort()
	return Vector3(axes[2],axes[1],axes[0])

func _fits(item_size: Vector3, slot_size: Vector3) -> bool:
	return item_size.x <= slot_size.x + 0.000001 and item_size.y <= slot_size.y + 0.000001 and item_size.z <= slot_size.z + 0.000001
