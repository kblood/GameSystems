class_name GSGraspValidator
extends RefCounted
## Pure row plausibility check; does not clamp, mutate, or apply grasp quality policy.

const Data = preload("res://addons/gs_grasp_data/gs_grasp_validator_data.gd")
const FINGERS := ["Thumb", "Index", "Middle", "Ring", "Little"]
const KEYS := ["dyaw", "pitch", "bend1", "bend2"]
const HYPEREXTENSION_WARN_DEG := -12.0
const DIP_PER_PIP := {"min": 0.35, "max": 1.0, "slack": 8.0}
const MAX_NEIGHBOUR_PITCH_DEG := 40.0
static var _default_data: Dictionary = {}

static func validate_rows(rows: Variant, data: Dictionary = {}) -> Variant:
	var config: Variant = _config(data)
	if not config is Dictionary: return null
	var hard: Array = []
	var warn: Array = []
	var cost := 0.0
	for finger: String in FINGERS:
		var current: Variant = _row(rows, finger)
		if not current is Array:
			hard.append({"finger": finger, "rule": "missing"})
			continue
		for index: int in range(KEYS.size()):
			var joint: String = KEYS[index]
			var bounds: Array = config.HARD[finger][joint]
			var value := float(current[index])
			var low := float(bounds[0])
			var high := float(bounds[1])
			if value < low - 0.01 or value > high + 0.01:
				hard.append({"finger": finger, "joint": joint, "value": value, "range": [low, high], "rule": "range"})
			var comfort: Dictionary = config.COMFORT[finger]
			var centre: Array = comfort.centre
			var width: Array = comfort.width
			cost += pow((value - float(centre[index])) / float(width[index]), 2.0)
		if current.size() > 4:
			var bounds: Array = config.HARD.Thumb.twist
			var value := float(current[4])
			if value < float(bounds[0]) - 0.01 or value > float(bounds[1]) + 0.01:
				hard.append({"finger": finger, "joint": "twist", "value": value,
					"range": [float(bounds[0]), float(bounds[1])], "rule": "range"})
		if finger == "Thumb":
			if float(current[3]) < HYPEREXTENSION_WARN_DEG:
				warn.append({"finger": finger, "joint": "bend2", "value": float(current[3]), "rule": "thumb-ip-hyperextended"})
		elif float(current[2]) > 20.0:
			var ratio := float(current[3]) / float(current[2])
			if float(current[3]) < float(DIP_PER_PIP.min) * float(current[2]) - float(DIP_PER_PIP.slack) \
					or float(current[3]) > float(DIP_PER_PIP.max) * float(current[2]) + float(DIP_PER_PIP.slack):
				warn.append({"finger": finger, "joint": "bend2", "value": float(current[3]), "ratio": ratio, "rule": "dip-pip-coupling"})
	var four: Array = []
	for index: int in range(1, FINGERS.size()):
		var current: Variant = _row(rows, FINGERS[index])
		if current is Array: four.append(current)
	for index: int in range(1, four.size()):
		var delta := float(four[index][1]) - float(four[index - 1][1])
		if absf(delta) > MAX_NEIGHBOUR_PITCH_DEG:
			# Preserve JS's compacted-row finger label behavior when intermediate rows are missing.
			warn.append({"finger": FINGERS[index + 1], "rule": "neighbour-pitch", "delta": delta})
	if not is_finite(cost): return null
	return {"ok": hard.is_empty(), "hard": hard, "warn": warn, "cost": cost}

static func _row(rows: Variant, finger: String) -> Variant:
	if not rows is Dictionary: return null
	var value: Variant = rows.get(finger)
	if not value is Array or (value.size() != 4 and not (finger == "Thumb" and value.size() == 5)):
		return null
	for angle: Variant in value:
		if not _finite(angle): return null
	return value

static func _config(data: Dictionary) -> Variant:
	if not data.is_empty():
		return data if Data.validate(data) else null
	if _default_data.is_empty():
		_default_data = Data.load_data()
	return _default_data if Data.validate(_default_data) else null

static func _finite(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value))
