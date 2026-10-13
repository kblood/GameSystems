class_name GSGraspValidatorData
extends RefCounted
## G3 data-only reader. Ranges/comfort use degrees; gates carry units in their keys.
## No grasp clamping, scoring, contact tests or coordinate conversion are implemented here.

const DATA_PATH := "res://addons/gs_grasp_data/data/validator.data.json"
const SCHEMA := "gamesystems.grasp-validator-data.v1"
const FINGERS := ["Thumb", "Index", "Middle", "Ring", "Little"]
const ROW_KEYS := ["dyaw", "pitch", "bend1", "bend2"]
const GATE_KEYS := ["wristErrorMm", "penetrationMm", "palmGapMaxMm", "palmGapMinMm", "tipTouchMm", "minFingersTouching", "minOppositionDeg"]

static func load_data(path: String = DATA_PATH) -> Dictionary:
	if not FileAccess.file_exists(path):
		push_error("GSGraspValidatorData: data file not found: %s" % path)
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not validate(parsed):
		push_error("GSGraspValidatorData: invalid grasp validator data: %s" % path)
		return {}
	return parsed

static func validate(data: Variant) -> bool:
	if not data is Dictionary or data.get("schema") != SCHEMA:
		return false
	var hard: Variant = data.get("HARD")
	var comfort: Variant = data.get("COMFORT")
	var gates: Variant = data.get("GATES")
	if not _has_keys(hard, FINGERS) or not _has_keys(comfort, FINGERS) or not _has_keys(gates, GATE_KEYS):
		return false
	for finger: String in FINGERS:
		var keys := ROW_KEYS.duplicate()
		if finger == "Thumb":
			keys.append("twist")
		if not _has_keys(hard[finger], keys) or not _has_keys(comfort[finger], ["centre", "width"]):
			return false
		for key: String in keys:
			var bounds: Variant = hard[finger][key]
			if not _numeric_array(bounds, 2) or bounds[0] > bounds[1]:
				return false
		var centre: Variant = comfort[finger]["centre"]
		var width: Variant = comfort[finger]["width"]
		if not _numeric_array(centre, 4) or not _numeric_array(width, 4):
			return false
		for i: int in range(4):
			if width[i] <= 0 or centre[i] < hard[finger][ROW_KEYS[i]][0] or centre[i] > hard[finger][ROW_KEYS[i]][1]:
				return false
	for key: String in GATE_KEYS:
		if not _finite_number(gates[key]):
			return false
	for key: String in ["wristErrorMm", "penetrationMm", "tipTouchMm"]:
		if gates[key] < 0:
			return false
	if gates.palmGapMinMm > gates.palmGapMaxMm:
		return false
	if gates.minFingersTouching < 0 or gates.minFingersTouching > 5 or floor(gates.minFingersTouching) != gates.minFingersTouching:
		return false
	return gates.minOppositionDeg >= 0 and gates.minOppositionDeg <= 180

static func _has_keys(value: Variant, keys: Array) -> bool:
	if not value is Dictionary or value.size() != keys.size():
		return false
	for key: String in keys:
		if not value.has(key):
			return false
	return true

static func _finite_number(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value))

static func _numeric_array(value: Variant, size: int) -> bool:
	if not value is Array or value.size() != size:
		return false
	for number: Variant in value:
		if not _finite_number(number):
			return false
	return true
