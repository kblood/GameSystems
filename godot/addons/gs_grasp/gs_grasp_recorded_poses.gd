class_name GSGraspRecordedPoses
extends RefCounted
## Runtime filtering contract ported from extensions/grasp/record.js.
## This intentionally differs from the strict G3 source-file reader: malformed
## individual poses are skipped and unrelated metadata is left untouched.

const RECORDED_SCHEMA := "gamesystems.recorded-grasps.v1"

static func is_pose(value: Variant) -> bool:
	if not value is Dictionary:
		return false
	var pose: Dictionary = value
	for key: String in ["id", "kind", "grasp"]:
		if typeof(pose.get(key)) != TYPE_STRING:
			return false
	if typeof(pose.get("side")) != TYPE_STRING or pose.get("side") not in ["left", "right"]:
		return false
	if not _finite_array(pose.get("wrist"), 3) or not _finite_array(pose.get("quat"), 4):
		return false
	var norm_squared := 0.0
	for component: Variant in pose.quat:
		norm_squared += float(component) * float(component)
	if not is_finite(norm_squared) or absf(sqrt(norm_squared) - 1.0) >= 0.001:
		return false
	if not _rows(pose.get("angles")) or not _rows(pose.get("open")):
		return false
	if pose.has("handLength"):
		var hand_length: Variant = pose.handLength
		if not _finite_number(hand_length) or float(hand_length) <= 0.08 or float(hand_length) >= 0.35:
			return false
	return true

static func recorded_poses(document: Variant) -> Array:
	if not document is Dictionary:
		return []
	var doc: Dictionary = document
	if doc.has("schema") and _js_truthy(doc.schema):
		if typeof(doc.schema) != TYPE_STRING or doc.schema != RECORDED_SCHEMA:
			return []
	var poses: Variant = doc.get("poses")
	if not poses is Array:
		return []
	var accepted: Array = []
	for pose: Variant in poses:
		if is_pose(pose):
			accepted.append(pose)
	return accepted

static func _rows(value: Variant) -> bool:
	if not value is Array or value.size() != 5:
		return false
	for index: int in range(5):
		if not _finite_array(value[index], 4) and not (index == 0 and _finite_array(value[index], 5)):
			return false
	return true

static func _finite_array(value: Variant, count: int) -> bool:
	if not value is Array or value.size() != count:
		return false
	for item: Variant in value:
		if not _finite_number(item):
			return false
	return true

static func _finite_number(value: Variant) -> bool:
	return (typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT) and is_finite(float(value))

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
