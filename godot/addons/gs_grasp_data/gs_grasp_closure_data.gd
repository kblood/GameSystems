class_name GSGraspClosureData
extends RefCounted
## G3 data-only reader for closure defaults; no closure or hand-geometry algorithms.
## Lengths are metres, pad radii are hand-length fractions, thumb tilt is radians,
## opposition is degrees, and overshoot/backoff/step are dimensionless blend amounts.

const DATA_PATH := "res://addons/gs_grasp_data/data/closure.data.json"
const SCHEMA := "gamesystems.grasp-closure-data.v1"
const FINGERS := ["Thumb", "Index", "Middle", "Ring", "Little"]
const CLOSURE_KEYS := ["overshoot", "backoff", "squeeze", "touch", "tolerate", "step", "bisect", "opposition", "thumbSearch", "palmGap", "palmSlide"]

static func load_data(path: String = DATA_PATH) -> Dictionary:
	if not FileAccess.file_exists(path):
		push_error("GSGraspClosureData: data file not found: %s" % path)
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not validate(parsed):
		push_error("GSGraspClosureData: invalid grasp closure data: %s" % path)
		return {}
	return parsed

static func validate(data: Variant) -> bool:
	if not data is Dictionary or data.get("schema") != SCHEMA:
		return false
	var closure: Variant = data.get("CLOSURE")
	var radii: Variant = data.get("PAD_RADIUS")
	var reference: Variant = data.get("REFERENCE_HAND")
	if not _has_keys(closure, CLOSURE_KEYS) or not _has_keys(radii, FINGERS) or not _has_keys(reference, ["length", "palm", "palmCenter"]):
		return false
	if not _finite_number(data.get("THUMB_TILT")) or not _finite_number(reference.length) or reference.length <= 0:
		return false
	if not _vector(reference.palm) or not _vector(reference.palmCenter):
		return false
	for finger: String in FINGERS:
		if not _vector(radii[finger]):
			return false
		for radius: float in radii[finger]:
			if radius < 0:
				return false
	if not closure.thumbSearch is bool:
		return false
	for key: String in CLOSURE_KEYS:
		if key != "thumbSearch" and (not _finite_number(closure[key]) or closure[key] < 0):
			return false
	if closure.step <= 0 or floor(closure.bisect) != closure.bisect:
		return false
	return closure.opposition <= 180

static func _has_keys(value: Variant, keys: Array) -> bool:
	if not value is Dictionary or value.size() != keys.size():
		return false
	for key: String in keys:
		if not value.has(key):
			return false
	return true

static func _finite_number(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value))

static func _vector(value: Variant) -> bool:
	if not value is Array or value.size() != 3:
		return false
	for number: Variant in value:
		if not _finite_number(number):
			return false
	return true
