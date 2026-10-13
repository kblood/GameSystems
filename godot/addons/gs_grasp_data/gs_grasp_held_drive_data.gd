class_name GSGraspHeldDriveData
extends RefCounted
## G3 reader for shared held-drive tuning. Does not implement forces or hand sampling.
## STIFFNESS is s^-2, DAMPING is s^-1; acceleration is m/s^2, torque N m, force N.

const DATA_PATH := "res://addons/gs_grasp_data/data/held_drive.data.json"
const SCHEMA := "gamesystems.grasp-held-drive-data.v1"
const NONNEGATIVE_KEYS := ["STIFFNESS", "DAMPING", "MAX_ACCELERATION", "MAX_TORQUE", "MAX_HOLD_FORCE"]

static func load_data(path: String = DATA_PATH) -> Dictionary:
	if not FileAccess.file_exists(path):
		push_error("GSGraspHeldDriveData: data file not found: %s" % path)
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not validate(parsed):
		push_error("GSGraspHeldDriveData: invalid held-drive data: %s" % path)
		return {}
	return parsed

static func validate(data: Variant) -> bool:
	if not data is Dictionary or data.get("schema") != SCHEMA:
		return false
	for key: String in NONNEGATIVE_KEYS:
		var value: Variant = data.get(key)
		if not _finite_number(value) or value < 0:
			return false
	var samples: Variant = data.get("HAND_MOTION_SAMPLES")
	return _finite_number(samples) and samples >= 1 and floor(samples) == samples

static func _finite_number(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value))
