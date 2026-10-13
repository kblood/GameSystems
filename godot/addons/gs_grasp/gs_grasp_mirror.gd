class_name GSGraspMirror
extends RefCounted
## Mirrors a recorded grasp across the item's XY plane, matching record.js.
## This utility does not validate, score, merge or install poses.

const DEFAULT_OPEN := [[0, 10, 5, 5], [0, -5, 0, 0], [0, -5, 0, 0], [0, -5, 0, 0], [0, -5, 0, 0]]

static func mirror_pose(pose: Dictionary) -> Dictionary:
	var source_side: Variant = pose.get("side")
	var target_side := "right" if typeof(source_side) == TYPE_STRING and source_side == "left" else "left"
	var wrist: Array = pose.wrist
	var quat: Array = pose.quat
	var angles: Array = pose.angles
	var mirrored := pose.duplicate(false)
	mirrored["side"] = target_side
	mirrored["wrist"] = [wrist[0], wrist[1], _positive_zero(-float(wrist[2]))]
	# Equivalent to JS qmul([-x, -y, z, w], [0, 1, 0, 0]).map(v => v + 0).
	mirrored["quat"] = [
		_positive_zero(-float(quat[2])),
		_positive_zero(float(quat[3])),
		_positive_zero(-float(quat[0])),
		_positive_zero(float(quat[1])),
	]
	mirrored["angles"] = _copy_rows(angles)
	var open_rows: Variant = pose.get("open")
	if not _js_truthy(open_rows):
		open_rows = DEFAULT_OPEN
	mirrored["open"] = _copy_rows(open_rows)
	mirrored["mirroredFrom"] = pose.get("id")
	if pose.has("palm") and _js_truthy(pose.palm):
		var palm: Array = pose.palm
		mirrored["palm"] = [palm[0], palm[1], -float(palm[2])]
	var id: Variant = pose.get("id")
	if typeof(id) == TYPE_STRING:
		var old_token := "/%s/" % str(source_side)
		var position: int = id.find(old_token)
		if position >= 0:
			id = id.substr(0, position) + "/%s/" % target_side + id.substr(position + old_token.length())
		mirrored["id"] = str(id) + "-m"
	return mirrored

static func _copy_rows(rows: Array) -> Array:
	var copied: Array = []
	for row: Variant in rows:
		copied.append(row.duplicate())
	return copied

static func _positive_zero(value: float) -> float:
	return value + 0.0

static func _js_truthy(value: Variant) -> bool:
	if value == null:
		return false
	if typeof(value) == TYPE_BOOL:
		return value
	if typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT:
		return float(value) != 0.0 and not is_nan(float(value))
	if typeof(value) == TYPE_STRING:
		return not value.is_empty()
	return true
