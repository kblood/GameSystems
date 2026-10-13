class_name GSGraspClamp
extends RefCounted
## Stateless port of JS grasp_validator.clampRows. Input/output angles are degrees.

const ValidatorData = preload("res://addons/gs_grasp_data/gs_grasp_validator_data.gd")
const FINGERS := ["Thumb", "Index", "Middle", "Ring", "Little"]
const KEYS := ["dyaw", "pitch", "bend1", "bend2"]

static func clamp_rows(rows: Dictionary, data: Dictionary = {}) -> Variant:
	var config: Dictionary = data if not data.is_empty() else ValidatorData.load_data()
	if not ValidatorData.validate(config):
		return null
	for finger: String in FINGERS:
		if rows.has(finger) and not rows[finger] is Array:
			return null
	var output := {}
	for finger: String in FINGERS:
		var input: Array = rows.get(finger, [])
		var result: Array = []
		for index: int in range(KEYS.size()):
			var bounds: Array = config.HARD[finger][KEYS[index]]
			var fallback: float = float(config.COMFORT[finger].centre[index])
			var value: Variant = input[index] if index < input.size() else null
			var angle: float = float(value) if _finite_number(value) else fallback
			result.append(clampf(angle, float(bounds[0]), float(bounds[1])))
		if finger == "Thumb" and input.size() > 4:
			var bounds: Array = config.HARD.Thumb.twist
			var twist: Variant = input[4]
			var angle: float = float(twist) if _finite_number(twist) else 0.0
			result.append(clampf(angle, float(bounds[0]), float(bounds[1])))
		output[finger] = result
	return output

static func _finite_number(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value))
