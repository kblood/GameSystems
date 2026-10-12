extends SceneTree
## Source contract for independent weapon state and atomic live selection.

const Loadout = preload("res://addons/gs_weapon_loadout/gs_weapon_loadout.gd")
var passed := 0
var failed := 0

func _initialize() -> void:
	var loadout: Variant = Loadout.new()
	var kestrel_state := {"rounds":7, "chambered":true, "magazines":[11,12]}
	var shear_state := {"cooldown":0.17, "attack_armed":false}
	var kestrel_model := Node3D.new()
	var shear_model := Node3D.new()
	case_result(loadout.add_entry(&"kestrel", kestrel_state, kestrel_model, {"kind":"firearm"}).ok,
		"adds the first weapon runtime entry")
	case_result(loadout.add_entry(&"shear", shear_state, shear_model, {"kind":"melee"}).ok,
		"adds a different weapon runtime entry")
	case_result(not loadout.add_entry(&"", {}, null).ok, "rejects an empty ID")
	case_result(not loadout.add_entry(&"kestrel", {}, null).ok, "rejects a duplicate ID")
	case_result(not loadout.add_entry(&"empty", null).ok, "rejects missing live state")
	case_result(loadout.active_entry() == null and loadout.active_id().is_empty(), "does not invent an active entry")
	var changes: Array[Array] = []
	var failed_apply := func(_old: Variant, _next: Variant) -> bool: return false
	var missing_apply: Dictionary = loadout.select(&"kestrel")
	case_result(not missing_apply.ok and loadout.active_entry() == null, "requires host apply before activating a live entry")
	var rejected: Dictionary = loadout.select(&"kestrel", func(_old: Variant, _next: Variant) -> Dictionary:
		return {"ok":false, "reason":"hand_occupied"}, failed_apply)
	case_result(not rejected.ok and rejected.code == "switch_rejected", "policy refusal leaves selection unchanged")
	var apply_refused: Dictionary = loadout.select(&"kestrel", Callable(), failed_apply)
	case_result(not apply_refused.ok and apply_refused.code == "apply_failed", "failed host binding leaves selection unchanged")
	case_result(loadout.active_entry() == null, "failed selection keeps no active entry")
	var apply := func(old_entry: Variant, new_entry: Variant) -> bool:
		changes.append([old_entry.id if old_entry != null else &"", new_entry.id])
		return true
	var first: Dictionary = loadout.select(&"kestrel", Callable(), apply)
	case_result(first.ok and loadout.active_id() == &"kestrel", "first live selection succeeds")
	case_result(changes.size() == 1 and changes[0] == [&"", &"kestrel"], "host receives previous and candidate entries")
	var signal_rows: Array[Array] = []
	loadout.active_entry_changed.connect(func(old_id: StringName, new_id: StringName) -> void:
		signal_rows.append([old_id, new_id]))
	var to_shear: Dictionary = loadout.select(&"shear", Callable(), apply)
	case_result(to_shear.ok and loadout.active_entry() == loadout.get_entry(&"shear"), "switches the active live entry")
	case_result(signal_rows == [[&"kestrel", &"shear"]], "publishes only successful active-entry transitions")
	case_result(loadout.get_entry(&"kestrel").state == kestrel_state and loadout.get_entry(&"shear").state == shear_state,
		"retains independent mutable state references")
	kestrel_state.rounds = 3
	shear_state.cooldown = 0.0
	case_result(loadout.get_entry(&"kestrel").state.rounds == 3 and loadout.get_entry(&"shear").state.cooldown == 0.0,
		"preserves per-entry mutations through switching")
	var malformed_string: Dictionary = loadout.select(&"kestrel", Callable(), func(_old: Variant, _next: Variant) -> Dictionary:
		return {"ok":"false"})
	case_result(not malformed_string.ok and loadout.active_id() == &"shear",
		"rejects string-valued dictionary success and preserves the active entry")
	var malformed_number: Dictionary = loadout.select(&"kestrel", Callable(), func(_old: Variant, _next: Variant) -> Dictionary:
		return {"ok":1})
	case_result(not malformed_number.ok and loadout.active_id() == &"shear",
		"rejects numeric dictionary success and preserves the active entry")
	var id_tamper: Dictionary = loadout.select(&"kestrel", Callable(), func(_old: Variant, next: Variant) -> bool:
		next.set("_id", &"spoofed")
		return true)
	var tampered_entry: Variant = loadout.get_entry(&"kestrel")
	var id_tamper_rejected: bool = not id_tamper.ok and loadout.active_id() == &"shear" and tampered_entry.id == &"spoofed"
	tampered_entry.set("_id", &"kestrel")
	case_result(id_tamper_rejected and tampered_entry.id == &"kestrel",
		"revalidates candidate identity before publishing a selection")
	var mutation_attempts: Array[Dictionary] = []
	var remove_candidate := func(_old: Variant, _next: Variant) -> bool:
		mutation_attempts.append(loadout.remove_entry(&"kestrel"))
		return true
	var protected_switch: Dictionary = loadout.select(&"kestrel", Callable(), remove_candidate)
	case_result(protected_switch.ok and loadout.active_id() == &"kestrel"
		and loadout.get_entry(&"kestrel") != null and mutation_attempts.size() == 1
		and mutation_attempts[0].code == "selection_in_progress",
		"host callbacks cannot delete the candidate before the active ID commits")
	case_result(signal_rows == [[&"kestrel", &"shear"], [&"shear", &"kestrel"]],
		"successful protected switch emits one stable transition")
	var notification_attempts: Array[Dictionary] = []
	var notification_observations: Array[bool] = []
	var notification_listener := func(old_id: StringName, new_id: StringName) -> void:
		notification_observations.append(loadout.active_id() == new_id \
			and loadout.active_entry() == loadout.get_entry(new_id))
		notification_attempts.append(loadout.select(&"kestrel", Callable(), apply))
		notification_attempts.append(loadout.restore_active_entry(&"kestrel"))
		notification_attempts.append(loadout.remove_entry(&"kestrel"))
		notification_attempts.append(loadout.add_entry(&"new_entry", {}, null))
	loadout.active_entry_changed.connect(notification_listener)
	var notification_switch: Dictionary = loadout.select(&"shear", Callable(), apply)
	loadout.active_entry_changed.disconnect(notification_listener)
	var notification_results_blocked := notification_attempts.size() == 4
	for attempt: Dictionary in notification_attempts:
		notification_results_blocked = notification_results_blocked and not attempt.ok and attempt.code == "selection_in_progress"
	case_result(notification_switch.ok and loadout.active_id() == &"shear" \
		and notification_observations == [true] and notification_results_blocked,
		"selection notifications block reentrant selection, restore, removal, and insertion")
	case_result(signal_rows == [[&"kestrel", &"shear"], [&"shear", &"kestrel"], [&"kestrel", &"shear"]],
		"reentrant notification attempts preserve one stable transition")
	var after_notification: Dictionary = loadout.select(&"kestrel", Callable(), apply)
	case_result(after_notification.ok and loadout.active_id() == &"kestrel",
		"normal selection succeeds after notification dispatch releases the lock")
	var same_entry: Dictionary = loadout.select(&"kestrel")
	case_result(same_entry.ok and same_entry.reason == "already_active" and changes.size() == 4,
		"same-entry selection is a no-op without host callback")
	case_result(not loadout.select(&"missing", Callable(), apply).ok and changes.size() == 4,
		"unknown target never invokes host transition")
	case_result(not loadout.remove_entry(&"kestrel").ok, "refuses removal of active entry")
	case_result(loadout.remove_entry(&"shear").ok and loadout.get_entry(&"shear") == null,
		"removes an inactive entry explicitly")
	var restore_probe: Variant = Loadout.new()
	restore_probe.add_entry(&"kestrel", kestrel_state)
	restore_probe.add_entry(&"shear", shear_state)
	restore_probe.restore_active_entry(&"kestrel")
	var restored_active: Dictionary = restore_probe.restore_active_entry(&"shear")
	case_result(restored_active.ok and restored_active.reason == "restored" and restore_probe.active_id() == &"shear",
		"trusted host restore publishes an already-committed active entry")
	var missing_restore: Dictionary = restore_probe.restore_active_entry(&"missing")
	case_result(not missing_restore.ok and restore_probe.active_id() == &"shear",
		"unknown checkpoint selection leaves the active entry unchanged")
	kestrel_model.free()
	shear_model.free()
	print("GS_WEAPON_LOADOUT passed=%d failed=%d" % [passed,failed])
	quit(1 if failed else 0)

func case_result(ok: bool, label: String) -> void:
	if ok: passed += 1
	else:
		failed += 1
		push_error("GS_WEAPON_LOADOUT: " + label)
