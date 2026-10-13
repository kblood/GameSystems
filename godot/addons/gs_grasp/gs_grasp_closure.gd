class_name GSGraspClosure
extends RefCounted
## Forward kinematics shared by grasp closure, contact fitting and tracked-hand previews.

const D2R := PI / 180.0

## Convert one valid [dyaw, pitch, bend1, bend2, optional thumb twist] row to
## [base, MCP, PIP, tip] points in the hand frame, matching closure.fingerChain.
static func finger_chain(finger: Dictionary, row: Array) -> Array:
	var axes: Dictionary = finger.axes
	var forward: Array = axes.F
	var dorsal: Array = axes.D
	var radial: Array = axes.R
	var hinge: Array = finger.hinge
	var yaw := float(finger.restYaw) + (float(row[0]) if row.size() > 0 else 0.0) * D2R
	var pitch := (float(row[1]) if row.size() > 1 else 0.0) * D2R
	var pitch_cos := cos(pitch)
	var direction := _norm([
		float(radial[0]) * sin(yaw) * pitch_cos + float(forward[0]) * cos(yaw) * pitch_cos - float(dorsal[0]) * sin(pitch),
		float(radial[1]) * sin(yaw) * pitch_cos + float(forward[1]) * cos(yaw) * pitch_cos - float(dorsal[1]) * sin(pitch),
		float(radial[2]) * sin(yaw) * pitch_cos + float(forward[2]) * cos(yaw) * pitch_cos - float(dorsal[2]) * sin(pitch)])
	var twist := 0.0
	if row.size() > 4 and float(row[4]) != 0.0:
		var twist_sign := float(finger.get("twistSign", 1.0))
		if twist_sign == 0.0:
			twist_sign = 1.0
		twist = float(row[4]) * D2R * twist_sign
	var direction2 := _next_direction(direction, float(row[2]) if row.size() > 2 else 0.0, hinge, dorsal, twist)
	var direction3 := _next_direction(direction2, float(row[3]) if row.size() > 3 else 0.0, hinge, dorsal, twist)
	var base: Array = finger.base
	var lengths: Array = finger.len
	var joint1 := _add(base, _scale(direction, float(lengths[0])))
	var joint2 := _add(joint1, _scale(direction2, float(lengths[1])))
	var tip := _add(joint2, _scale(direction3, float(lengths[2])))
	return [base.duplicate(), joint1, joint2, tip]

static func _next_direction(parent: Array, bend: float, hinge: Array, dorsal: Array, twist: float) -> Array:
	var axis := _reject(hinge, parent)
	if _length(axis) < 1e-6:
		axis = _reject(dorsal, parent)
	axis = _norm(axis)
	if twist != 0.0:
		axis = _turn(axis, parent, twist)
	return _turn(parent, axis, bend * D2R)

static func _add(a: Array, b: Array) -> Array:
	return [float(a[0]) + float(b[0]), float(a[1]) + float(b[1]), float(a[2]) + float(b[2])]

static func _sub(a: Array, b: Array) -> Array:
	return [float(a[0]) - float(b[0]), float(a[1]) - float(b[1]), float(a[2]) - float(b[2])]

static func _scale(a: Array, scalar: float) -> Array:
	return [float(a[0]) * scalar, float(a[1]) * scalar, float(a[2]) * scalar]

static func _dot(a: Array, b: Array) -> float:
	return float(a[0]) * float(b[0]) + float(a[1]) * float(b[1]) + float(a[2]) * float(b[2])

static func _cross(a: Array, b: Array) -> Array:
	return [float(a[1]) * float(b[2]) - float(a[2]) * float(b[1]),
		float(a[2]) * float(b[0]) - float(a[0]) * float(b[2]),
		float(a[0]) * float(b[1]) - float(a[1]) * float(b[0])]

static func _reject(vector: Array, normal: Array) -> Array:
	return _sub(vector, _scale(normal, _dot(vector, normal)))

static func _turn(vector: Array, axis: Array, angle: float) -> Array:
	var c := cos(angle)
	var s := sin(angle)
	var crossed := _cross(axis, vector)
	var projection := _dot(axis, vector) * (1.0 - c)
	return [float(vector[0]) * c + float(crossed[0]) * s + float(axis[0]) * projection,
		float(vector[1]) * c + float(crossed[1]) * s + float(axis[1]) * projection,
		float(vector[2]) * c + float(crossed[2]) * s + float(axis[2]) * projection]

static func _norm(vector: Array) -> Array:
	var magnitude := _length(vector)
	if magnitude == 0.0:
		magnitude = 1.0
	return [float(vector[0]) / magnitude, float(vector[1]) / magnitude, float(vector[2]) / magnitude]

static func _length(vector: Array) -> float:
	return sqrt(_dot(vector, vector))
