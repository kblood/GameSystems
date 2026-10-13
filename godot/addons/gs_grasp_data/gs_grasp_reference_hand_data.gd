class_name GSGraspReferenceHandData
extends RefCounted
## G3 raw rest-hand fixture reader. Rig-space points/lengths are metres; yaw is radians.
## Frame/segment checks allow the canonical export's six-decimal rounding.
## Does not implement referenceHand()/handGeometry() or transform the fixture.

const DATA_PATH := "res://addons/gs_grasp_data/data/reference_hand.data.json"
const SCHEMA := "gamesystems.reference-hand.v1"
const FINGERS := ["Thumb", "Index", "Middle", "Ring", "Little"]
const FRAME_TOLERANCE := 0.0001
const LENGTH_TOLERANCE := 0.00001

static func load_data(path: String = DATA_PATH) -> Dictionary:
	if not FileAccess.file_exists(path):
		push_error("GSGraspReferenceHandData: data file not found: %s" % path)
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not validate(parsed):
		push_error("GSGraspReferenceHandData: invalid reference-hand data: %s" % path)
		return {}
	return parsed

static func validate(data: Variant) -> bool:
	if not _keys(data, ["schema", "source", "scale", "restLength", "hands"]) or data.get("schema") != SCHEMA:
		return false
	if not data.get("source") is String or data.source.is_empty() or not _positive(data.get("scale")) or not _positive(data.get("restLength")):
		return false
	var hands: Variant = data.get("hands")
	if not _keys(hands, ["left", "right"]):
		return false
	for side: String in ["left", "right"]:
		var hand: Variant = hands[side]
		if not _keys(hand, ["side", "frame", "wrist", "fingers"]) or hand.get("side") != side or not _vector(hand.get("wrist")):
			return false
		if not _frame(hand.get("frame"), side) or not _keys(hand.get("fingers"), FINGERS):
			return false
		for finger: String in FINGERS:
			if not _finger(hand.fingers[finger]):
				return false
	return true

static func _frame(frame: Variant, side: String) -> bool:
	if not _keys(frame, ["F", "D", "R"]):
		return false
	for axis: String in ["F", "D", "R"]:
		if not _vector(frame[axis]) or absf(_v3(frame[axis]).length() - 1.0) > FRAME_TOLERANCE:
			return false
	var forward := _v3(frame.F)
	var dorsal := _v3(frame.D)
	var radial := _v3(frame.R)
	if absf(forward.dot(dorsal)) > FRAME_TOLERANCE or absf(forward.dot(radial)) > FRAME_TOLERANCE or absf(dorsal.dot(radial)) > FRAME_TOLERANCE:
		return false
	var handedness := -1.0 if side == "left" else 1.0
	return absf(dorsal.cross(forward).dot(radial) - handedness) <= FRAME_TOLERANCE

static func _finger(finger: Variant) -> bool:
	if not _keys(finger, ["pts", "len", "rest"]):
		return false
	var points: Variant = finger.get("pts")
	var lengths: Variant = finger.get("len")
	var rest: Variant = finger.get("rest")
	if not points is Array or points.size() != 4 or not lengths is Array or lengths.size() != 3:
		return false
	if not _keys(rest, ["yaw"]) or not _number(rest.get("yaw")):
		return false
	for point: Variant in points:
		if not _vector(point):
			return false
	for i: int in range(3):
		if not _positive(lengths[i]) or absf(_v3(points[i + 1]).distance_to(_v3(points[i])) - lengths[i]) > LENGTH_TOLERANCE:
			return false
	return true

static func _keys(value: Variant, keys: Array) -> bool:
	if not value is Dictionary or value.size() != keys.size():
		return false
	for key: String in keys:
		if not value.has(key):
			return false
	return true

static func _number(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value))

static func _positive(value: Variant) -> bool:
	return _number(value) and value > 0

static func _vector(value: Variant) -> bool:
	return value is Array and value.size() == 3 and _number(value[0]) and _number(value[1]) and _number(value[2])

static func _v3(value: Array) -> Vector3:
	return Vector3(value[0], value[1], value[2])
