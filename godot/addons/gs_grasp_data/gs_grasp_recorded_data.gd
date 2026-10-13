class_name GSGraspRecordedData
extends RefCounted
## G3 canonical recording-document reader. Rejects invalid documents as a whole.
## JS recordedPoses instead filters isPose failures and ignores metadata validity.
## Angles are degrees, wrist/palm/handLength metres, quaternion [x,y,z,w].
## This is structural validation, not anatomical/contact quality assessment.

const DATA_PATH := "res://addons/gs_grasp_data/data/recorded_grasps.data.json"
const SCHEMA := "gamesystems.recorded-grasps.v1"
const POSE_KEYS := ["id", "kind", "grasp", "side", "wrist", "quat", "angles", "open", "mode", "default", "handLength", "recorded", "mirroredFrom", "palm"]

static func load_data(path: String = DATA_PATH) -> Dictionary:
	if not FileAccess.file_exists(path):
		push_error("GSGraspRecordedData: data file not found: %s" % path)
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not validate(parsed):
		push_error("GSGraspRecordedData: invalid recorded-grasp data: %s" % path)
		return {}
	return parsed

static func validate(data: Variant) -> bool:
	if not _only_keys(data, ["schema", "note", "poses"]) or data.get("schema") != SCHEMA:
		return false
	if data.has("note") and not data.note is String:
		return false
	var poses: Variant = data.get("poses")
	if not poses is Array:
		return false
	for pose: Variant in poses:
		if not validate_pose(pose):
			return false
	return true

static func validate_pose(pose: Variant) -> bool:
	if not _only_keys(pose, POSE_KEYS):
		return false
	for key: String in ["id", "kind", "grasp"]:
		if not _text(pose.get(key)):
			return false
	if pose.get("side") not in ["left", "right"] or not _numbers(pose.get("wrist"), 3) or not _numbers(pose.get("quat"), 4):
		return false
	# Accumulate as doubles: do not tighten JS's 1e-3 unit-quaternion tolerance.
	var norm_squared := 0.0
	for component: float in pose.quat:
		norm_squared += component * component
	if not is_finite(norm_squared) or absf(sqrt(norm_squared) - 1.0) >= 0.001:
		return false
	if not _rows(pose.get("angles")) or not _rows(pose.get("open")):
		return false
	if pose.has("handLength") and (not _number(pose.handLength) or pose.handLength <= 0.08 or pose.handLength >= 0.35):
		return false
	if pose.has("default") and not pose.default is bool:
		return false
	for key: String in ["mode", "mirroredFrom"]:
		if pose.has(key) and not _text(pose[key]):
			return false
	if pose.has("palm") and not _numbers(pose.palm, 3):
		return false
	return not pose.has("recorded") or _metadata(pose.recorded)

static func _metadata(metadata: Variant) -> bool:
	if not _only_keys(metadata, ["at", "source", "frames", "score", "mirrored"]):
		return false
	# Preserve timestamp text; this reader does not parse dates or run Grasp Studio.
	if not _text(metadata.get("at")) or not _text(metadata.get("source")):
		return false
	if metadata.has("frames") and (not _number(metadata.frames) or metadata.frames < 0 or floor(metadata.frames) != metadata.frames):
		return false
	if metadata.has("score") and (not _number(metadata.score) or metadata.score < 0 or metadata.score > 100):
		return false
	return not metadata.has("mirrored") or metadata.mirrored is bool

static func _rows(rows: Variant) -> bool:
	if not rows is Array or rows.size() != 5:
		return false
	for i: int in range(5):
		if not _numbers(rows[i], 4) and not (i == 0 and _numbers(rows[i], 5)):
			return false
	return true

static func _numbers(value: Variant, count: int) -> bool:
	if not value is Array or value.size() != count:
		return false
	for number: Variant in value:
		if not _number(number):
			return false
	return true

static func _number(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value))

static func _text(value: Variant) -> bool:
	return value is String and not value.is_empty()

static func _only_keys(value: Variant, keys: Array) -> bool:
	if not value is Dictionary:
		return false
	for key: Variant in value:
		if not keys.has(key):
			return false
	return true
