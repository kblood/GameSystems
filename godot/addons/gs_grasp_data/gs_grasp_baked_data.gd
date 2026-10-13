class_name GSGraspBakedData
extends RefCounted
## G3 canonical bake reader. Does not bake, clamp, verify assets or assess contact quality.
## Shapes/catalog membership are deliberately not required for asset-specific kinds.

const DATA_PATH := "res://addons/gs_grasp_data/data/baked_grasps.data.json"
const SCHEMA := "nightfall-webxr.baked-grasps.v1"
const SOURCE_KEYS := ["schema", "inputsDigest", "jsonSha256", "avatar", "avatarSha256", "operatorScale", "limits"]
const LIMIT_KEYS := ["penetration_mm", "palm_gap_mm", "thumb_opposition_deg", "touch_mm", "test_touch_mm", "pinch_palm_clear_mm", "pinch_knuckle_pen_mm"]
const POSE_KEYS := ["id", "kind", "grasp", "mode", "side", "default", "wrist", "quat", "angles", "open", "palm", "metrics", "fit"]

static func load_data(path: String = DATA_PATH) -> Dictionary:
	if not FileAccess.file_exists(path):
		push_error("GSGraspBakedData: data file not found: %s" % path)
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not validate(parsed):
		push_error("GSGraspBakedData: invalid baked-grasp data: %s" % path)
		return {}
	return parsed

static func validate(data: Variant) -> bool:
	if not _keys(data, ["schema", "source", "conventions", "summary", "poses"]) or data.schema != SCHEMA:
		return false
	if not _source(data.source) or not _conventions(data.conventions) or not data.summary is Dictionary or not data.poses is Array:
		return false
	var counts := {}
	var ids := {}
	for pose: Variant in data.poses:
		if not validate_pose(pose) or ids.has(pose.id):
			return false
		ids[pose.id] = true
		counts[pose.kind] = counts.get(pose.kind, 0) + 1
	for kind: Variant in data.summary:
		if not _text(kind) or not _summary(data.summary[kind]) or data.summary[kind].accepted != counts.get(kind, 0):
			return false
	for kind: String in counts:
		if not data.summary.has(kind):
			return false
	return true

static func _source(source: Variant) -> bool:
	if not _keys(source, SOURCE_KEYS) or source.schema != "nightfall.baked-grasps.v1" or not _text(source.avatar):
		return false
	if not _positive(source.operatorScale) or not _keys(source.limits, LIMIT_KEYS):
		return false
	for key: String in ["inputsDigest", "jsonSha256", "avatarSha256"]:
		if not _sha256(source[key]):
			return false
	for key: String in LIMIT_KEYS:
		if not _nonnegative(source.limits[key]):
			return false
	return true

static func _conventions(conventions: Variant) -> bool:
	if not _keys(conventions, ["wrist", "quat", "angles", "rest"]):
		return false
	for key: String in ["wrist", "quat", "angles"]:
		if not _text(conventions[key]):
			return false
	if not _keys(conventions.rest, ["left", "right"]):
		return false
	for side: String in ["left", "right"]:
		var rest: Variant = conventions.rest[side]
		if not _keys(rest, ["frameInBone", "palm"]) or not _quat(rest.frameInBone) or not _numbers(rest.palm, 3):
			return false
	return true

static func _summary(summary: Variant) -> bool:
	if not _keys(summary, ["accepted", "total", "frameErrorMm", "palmMidToSurfaceMm"], ["fitDropped"]):
		return false
	if not _count(summary.accepted) or not _count(summary.total) or summary.accepted > summary.total or not _nonnegative(summary.frameErrorMm):
		return false
	if summary.has("fitDropped") and (not _count(summary.fitDropped) or summary.fitDropped > summary.total):
		return false
	var palm: Variant = summary.palmMidToSurfaceMm
	if palm == null:
		return true
	return _keys(palm, ["median", "max"]) and _number(palm.median) and _number(palm.max) and palm.median <= palm.max

static func validate_pose(pose: Variant) -> bool:
	if not _keys(pose, POSE_KEYS.slice(0, 12), ["fit"]):
		return false
	for key: String in ["id", "kind", "grasp"]:
		if not _text(pose[key]):
			return false
	if pose.mode not in ["wrap", "flat", "pinch"] or pose.side not in ["left", "right"] or not pose.default is bool:
		return false
	if not _numbers(pose.wrist, 3) or not _quat(pose.quat) or not _numbers(pose.palm, 3) or not _rows(pose.angles) or not _rows(pose.open):
		return false
	if pose.has("fit") and not _text(pose.fit):
		return false
	if not _keys(pose.metrics, ["penetrationMm", "palmGapMm", "thumbOppositionDeg"]):
		return false
	for key: String in ["penetrationMm", "palmGapMm", "thumbOppositionDeg"]:
		if not _number(pose.metrics[key]):
			return false
	return true

static func _rows(rows: Variant) -> bool:
	if not rows is Array or rows.size() != 5:
		return false
	for i: int in range(5):
		if not _numbers(rows[i], 4) and not (i == 0 and _numbers(rows[i], 5)):
			return false
	return true

static func _quat(value: Variant) -> bool:
	if not _numbers(value, 4):
		return false
	var norm_squared := 0.0
	for component: float in value:
		norm_squared += component * component
	return is_finite(norm_squared) and absf(sqrt(norm_squared) - 1.0) < 0.001

static func _keys(value: Variant, required: Array, optional: Array = []) -> bool:
	if not value is Dictionary:
		return false
	for key: String in required:
		if not value.has(key):
			return false
	for key: Variant in value:
		if not required.has(key) and not optional.has(key):
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

static func _nonnegative(value: Variant) -> bool:
	return _number(value) and value >= 0

static func _positive(value: Variant) -> bool:
	return _number(value) and value > 0

static func _count(value: Variant) -> bool:
	return _nonnegative(value) and floor(value) == value

static func _text(value: Variant) -> bool:
	return value is String and not value.is_empty()

static func _sha256(value: Variant) -> bool:
	if not value is String or value.length() != 64:
		return false
	for character: String in value:
		if not "0123456789abcdefABCDEF".contains(character):
			return false
	return true
