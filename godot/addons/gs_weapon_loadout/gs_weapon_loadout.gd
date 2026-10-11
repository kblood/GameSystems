class_name GSWeaponLoadout
extends RefCounted
## Keeps independent runtime entries and coordinates safe host-side activation.
## This addon does not know about nodes, hands, inventory, or weapon rules.

signal active_entry_changed(previous_id: StringName, active_id: StringName)

const Entry = preload("res://addons/gs_weapon_loadout/gs_weapon_loadout_entry.gd")

var _entries: Dictionary = {}
var _active_id: StringName = &""
var _selection_callback_active := false

func add_entry(entry_id: StringName, state: Variant, presentation: Variant = null,
		metadata: Dictionary = {}) -> Dictionary:
	if _selection_callback_active: return _failure("selection_in_progress", "Cannot mutate entries during a host selection callback")
	if String(entry_id).strip_edges().is_empty(): return _failure("invalid_id", "Weapon entry ID cannot be empty")
	if state == null: return _failure("missing_state", "Weapon entry state cannot be null")
	if _entries.has(entry_id): return _failure("duplicate_id", "Weapon entry already exists: %s" % entry_id)
	var entry: Variant = Entry.new(entry_id, state, presentation, metadata)
	_entries[entry_id] = entry
	return {"ok":true, "entry":entry}

func remove_entry(entry_id: StringName) -> Dictionary:
	if _selection_callback_active: return _failure("selection_in_progress", "Cannot mutate entries during a host selection callback")
	if not _entries.has(entry_id): return _failure("unknown_id", "Unknown weapon entry: %s" % entry_id)
	if entry_id == _active_id: return _failure("active_entry", "Cannot remove the active weapon entry")
	var removed: Variant = _entries[entry_id]
	_entries.erase(entry_id)
	return {"ok":true, "entry":removed}

func get_entry(entry_id: StringName) -> Variant:
	return _entries.get(entry_id)

func active_entry() -> Variant:
	return get_entry(_active_id) if not String(_active_id).is_empty() else null

func active_id() -> StringName:
	return _active_id

func entry_ids() -> PackedStringArray:
	var result := PackedStringArray()
	for entry_id in _entries.keys(): result.append(String(entry_id))
	result.sort()
	return result

## Select a registered weapon and let the host bind its live runtime.
##
## `can_switch(previous, candidate)` is an optional read-only policy check. It
## returns bool or {"ok": bool, "reason": String}. `apply_switch(previous,
## candidate)` is mandatory when changing entries and must perform an atomic host
## transition: return false without partial changes on failure. The registry only
## publishes the new active entry after the host transition succeeds.
func select(entry_id: StringName, can_switch: Callable = Callable(),
		apply_switch: Callable = Callable()) -> Dictionary:
	if _selection_callback_active: return _failure("selection_in_progress", "A weapon selection callback is already running")
	var candidate: Variant = get_entry(entry_id)
	if candidate == null: return _failure("unknown_id", "Unknown weapon entry: %s" % entry_id)
	if entry_id == _active_id: return {"ok":true, "reason":"already_active", "entry":candidate}
	var previous: Variant = active_entry()
	if not String(_active_id).is_empty() and previous == null:
		return _failure("invalid_active", "Active weapon entry is missing")
	if can_switch.is_valid():
		_selection_callback_active = true
		var policy: Variant = can_switch.call(previous, candidate)
		_selection_callback_active = false
		var policy_result := _callback_result(policy)
		if not policy_result.ok: return _failure("switch_rejected", String(policy_result.get("reason", "Host rejected weapon switch")))
	if not apply_switch.is_valid():
		return _failure("missing_apply", "A host apply callback is required to select a live weapon")
	_selection_callback_active = true
	var applied: Variant = apply_switch.call(previous, candidate)
	_selection_callback_active = false
	var apply_result := _callback_result(applied)
	if not apply_result.ok:
		return _failure("apply_failed", String(apply_result.get("reason", "Host could not apply weapon switch")))
	# Protect against indirect/re-entrant edits by callbacks before committing the
	# active ID. The callback lock blocks add/remove/select; identity is also
	# rechecked so future API changes cannot publish a stale candidate.
	if get_entry(entry_id) != candidate or StringName(candidate.id) != entry_id \
		or (previous != null and (active_entry() != previous or StringName(previous.id) != _active_id)):
		return _failure("entry_changed", "Loadout entries changed during host selection")
	_active_id = entry_id
	active_entry_changed.emit(StringName(previous.id) if previous != null else &"", entry_id)
	return {"ok":true, "reason":"selected", "entry":candidate, "previous":previous}

func _callback_result(value: Variant) -> Dictionary:
	if typeof(value) == TYPE_BOOL: return {"ok":value, "reason":""}
	if value is Dictionary:
		var ok_value: Variant = value.get("ok", null)
		if typeof(ok_value) != TYPE_BOOL:
			return {"ok":false, "reason":"Host dictionary result must contain a boolean ok field"}
		return {"ok":ok_value, "reason":str(value.get("reason", "")), "value":value}
	return {"ok":false, "reason":"Host callback must return bool or a Dictionary with an ok field"}

func _failure(code: String, message: String) -> Dictionary:
	return {"ok":false, "code":code, "reason":message}
