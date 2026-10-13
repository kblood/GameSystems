class_name GSGraspCapture
extends RefCounted
## Geometry helpers for turning tracked XR hands into recorded grasps.
## This port covers hand framing, finger-row extraction and measured hand length.

const WRIST := "wrist"
const INDEX_KNUCKLE := "index-finger-phalanx-proximal"
const MIDDLE_KNUCKLE := "middle-finger-phalanx-proximal"
const LITTLE_KNUCKLE := "pinky-finger-phalanx-proximal"
const MIDDLE_CHAIN := ["wrist", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip"]
const FINGERS := ["Thumb", "Index", "Middle", "Ring", "Little"]
const XR_CHAINS := {
	"Thumb": ["thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip"],
	"Index": ["index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip"],
	"Middle": ["middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip"],
	"Ring": ["ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip"],
	"Little": ["pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal", "pinky-finger-tip"],
}
const R2D := 180.0 / PI
const THUMB_TWIST_PLANE := [0.15, 0.4]

## Extract [dyaw, pitch, bend1, bend2] in degrees for thumb..little from world-space WebXR joints.
## The thumb adds its axial twist as row[4], matching record.js. `hand` is the closure.handGeometry() reference model.
static func rows_from_joints(side: Variant, joints: Dictionary, hand: Dictionary) -> Variant:
	var basis: Variant = hand_basis(side, joints)
	if basis == null:
		return null
	var wrist: Array = joints[WRIST]
	var rows: Array = []
	for finger: String in FINGERS:
		var points: Array = []
		for name: String in XR_CHAINS[finger]:
			var point: Variant = joints.get(name)
			if not _finite_array(point, 3):
				return null
			points.append(point)
		var local_points: Array = []
		for point: Array in points:
			var delta := _sub(point, wrist)
			local_points.append([_dot(delta, basis.X), _dot(delta, basis.D), _dot(delta, basis.F)])
		var vectors: Array = []
		for index: int in range(3):
			vectors.append(_norm(_sub(local_points[index + 1], local_points[index])))
		var model: Dictionary = hand.fingers[finger]
		var axes: Dictionary = model.axes
		var forward: Array = axes.F
		var dorsal: Array = axes.D
		var radial: Array = axes.R
		var hinge: Array = model.hinge
		var twist_sign: float = float(model.get("twistSign", -1.0 if side == "left" else 1.0))
		var first: Array = vectors[0]
		var vr := _dot(first, radial)
		var vd := _dot(first, dorsal)
		var vf := _dot(first, forward)
		var twist: Variant = _thumb_twist(vectors, hinge, dorsal, twist_sign) if finger == "Thumb" else null
		var applied_twist := float(twist) * twist_sign if twist != null and float(twist) != 0.0 else 0.0
		var row: Array = [atan2(vr, vf) - float(model.restYaw), atan2(-vd, sqrt(vr * vr + vf * vf))]
		row[0] = atan2(sin(float(row[0])), cos(float(row[0]))) * R2D
		row[1] = float(row[1]) * R2D
		for bend_index: int in [1, 2]:
			var parent: Array = vectors[bend_index - 1]
			var child: Array = vectors[bend_index]
			var axis := _reject(hinge, parent)
			if _length(axis) < 1e-6:
				axis = _reject(dorsal, parent)
			axis = _norm(axis)
			if applied_twist != 0.0:
				axis = _turn(axis, parent, applied_twist)
			var a := _reject(parent, axis)
			var e := _reject(child, axis)
			row.append(atan2(_dot(_cross(a, e), axis), _dot(a, e)) * R2D)
		if twist != null:
			row.append(float(twist) * R2D)
		rows.append(row)
	return rows

## Capture the tracked wrist pose in item-space together with its finger rows and measured hand length.
## `item` and `hand` use the public JS shapes `{pos, quat}` and `handGeometry()` respectively.
static func capture_from_joints(side: Variant, joints: Dictionary, item: Dictionary, hand: Dictionary) -> Variant:
	var basis: Variant = hand_basis(side, joints)
	if basis == null:
		return null
	var angles: Variant = rows_from_joints(side, joints, hand)
	var measured_length: Variant = hand_length_from_joints(joints)
	if angles == null or measured_length == null or not measured_length:
		return null
	var inverse_item: Array = _qconj(item.quat)
	var local_position := _rotate(inverse_item, _sub(joints[WRIST], item.pos))
	var local_quaternion := _qmul(inverse_item, basis.quat)
	return {"side": side, "wrist": local_position, "quat": local_quaternion, "angles": angles, "handLength": measured_length}

static func _qconj(quaternion: Array) -> Array:
	return [-float(quaternion[0]), -float(quaternion[1]), -float(quaternion[2]), float(quaternion[3])]

static func _qmul(a: Array, b: Array) -> Array:
	var ax := float(a[0]); var ay := float(a[1]); var az := float(a[2]); var aw := float(a[3])
	var bx := float(b[0]); var by := float(b[1]); var bz := float(b[2]); var bw := float(b[3])
	return [aw * bx + ax * bw + ay * bz - az * by,
		aw * by - ax * bz + ay * bw + az * bx,
		aw * bz + ax * by - ay * bx + az * bw,
		aw * bw - ax * bx - ay * by - az * bz]

static func _rotate(quaternion: Array, vector: Array) -> Array:
	var x := float(quaternion[0]); var y := float(quaternion[1]); var z := float(quaternion[2]); var w := float(quaternion[3])
	var vx := float(vector[0]); var vy := float(vector[1]); var vz := float(vector[2])
	var tx := 2.0 * (y * vz - z * vy)
	var ty := 2.0 * (z * vx - x * vz)
	var tz := 2.0 * (x * vy - y * vx)
	return [vx + w * tx + y * tz - z * ty, vy + w * ty + z * tx - x * tz, vz + w * tz + x * ty - y * tx]

static func _thumb_twist(vectors: Array, hinge: Array, dorsal: Array, twist_sign: float) -> float:
	var n1 := _cross(vectors[0], vectors[1])
	var n2 := _cross(vectors[1], vectors[2])
	var s1 := _length(n1)
	var s2 := _length(n2)
	var total := s1 + s2
	var weight := clampf((total - THUMB_TWIST_PLANE[0]) / (THUMB_TWIST_PLANE[1] - THUMB_TWIST_PLANE[0]), 0.0, 1.0)
	weight = weight * weight * (3.0 - 2.0 * weight)
	if weight <= 0.0:
		return 0.0
	var weighted := 0.0
	if s1 > 1e-9:
		weighted += s1 * _twist_about(vectors[0], n1, hinge, dorsal)
	if s2 > 1e-9:
		weighted += s2 * _twist_about(vectors[1], n2, hinge, dorsal)
	return twist_sign * weight * weighted / total

static func _twist_about(parent: Array, normal: Array, hinge: Array, dorsal: Array) -> float:
	var axis := _reject(hinge, parent)
	if _length(axis) < 1e-6:
		axis = _reject(dorsal, parent)
	axis = _norm(axis)
	var measured := _scale(normal, 1.0 / _length(normal))
	if _dot(normal, axis) < 0.0:
		measured = _scale(measured, -1.0)
	else:
		measured = _scale(measured, 1.0)
	return atan2(_dot(_cross(axis, measured), parent), _dot(axis, measured))

static func _turn(vector: Array, axis: Array, angle: float) -> Array:
	var c := cos(angle)
	var s := sin(angle)
	var crossed := _cross(axis, vector)
	var projection := _dot(axis, vector) * (1.0 - c)
	return [float(vector[0]) * c + float(crossed[0]) * s + float(axis[0]) * projection,
		float(vector[1]) * c + float(crossed[1]) * s + float(axis[1]) * projection,
		float(vector[2]) * c + float(crossed[2]) * s + float(axis[2]) * projection]

static func hand_length_from_joints(joints: Dictionary) -> Variant:
	var total := 0.0
	for index: int in range(1, MIDDLE_CHAIN.size()):
		var a: Variant = joints.get(MIDDLE_CHAIN[index - 1])
		var b: Variant = joints.get(MIDDLE_CHAIN[index])
		if not _finite_array(a, 3) or not _finite_array(b, 3):
			return null
		total += _length(_sub(b, a))
	return total

static func hand_basis(side: Variant, joints: Dictionary) -> Variant:
	var wrist: Variant = joints.get(WRIST)
	var index: Variant = joints.get(INDEX_KNUCKLE)
	var middle: Variant = joints.get(MIDDLE_KNUCKLE)
	var little: Variant = joints.get(LITTLE_KNUCKLE)
	if not _finite_array(wrist, 3) or not _finite_array(index, 3) or not _finite_array(middle, 3) or not _finite_array(little, 3):
		return null
	var forward := _norm(_sub(middle, wrist))
	var radial := _norm(_reject(_sub(index, little), forward))
	var dorsal := _norm(_cross(radial, forward) if typeof(side) == TYPE_STRING and side == "left" else _cross(forward, radial))
	var thumb_axis := _norm(_cross(dorsal, forward))
	return {"F": forward, "R": radial, "D": dorsal, "X": thumb_axis, "quat": quat_from_basis(thumb_axis, dorsal, forward)}

## Quaternion [x,y,z,w] for a matrix whose columns are X, Y, Z.
static func quat_from_basis(x_axis: Array, y_axis: Array, z_axis: Array) -> Array:
	var m00 := float(x_axis[0]); var m10 := float(x_axis[1]); var m20 := float(x_axis[2])
	var m01 := float(y_axis[0]); var m11 := float(y_axis[1]); var m21 := float(y_axis[2])
	var m02 := float(z_axis[0]); var m12 := float(z_axis[1]); var m22 := float(z_axis[2])
	var trace := m00 + m11 + m22
	var q: Array
	if trace > 0.0:
		var s := 0.5 / sqrt(trace + 1.0)
		q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]
	elif m00 > m11 and m00 > m22:
		var s := 2.0 * sqrt(1.0 + m00 - m11 - m22)
		q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]
	elif m11 > m22:
		var s := 2.0 * sqrt(1.0 + m11 - m00 - m22)
		q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]
	else:
		var s := 2.0 * sqrt(1.0 + m22 - m00 - m11)
		q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]
	var magnitude := _length4(q)
	var normalized: Array = []
	for value: float in q:
		normalized.append(value / magnitude)
	return normalized

static func _finite_array(value: Variant, size: int) -> bool:
	if not value is Array or value.size() != size:
		return false
	for component: Variant in value:
		if (typeof(component) != TYPE_INT and typeof(component) != TYPE_FLOAT) or not is_finite(float(component)):
			return false
	return true

static func _sub(a: Array, b: Array) -> Array:
	return [float(a[0]) - float(b[0]), float(a[1]) - float(b[1]), float(a[2]) - float(b[2])]

static func _dot(a: Array, b: Array) -> float:
	return float(a[0]) * float(b[0]) + float(a[1]) * float(b[1]) + float(a[2]) * float(b[2])

static func _cross(a: Array, b: Array) -> Array:
	return [float(a[1]) * float(b[2]) - float(a[2]) * float(b[1]), float(a[2]) * float(b[0]) - float(a[0]) * float(b[2]), float(a[0]) * float(b[1]) - float(a[1]) * float(b[0])]

static func _scale(a: Array, scalar: float) -> Array:
	return [float(a[0]) * scalar, float(a[1]) * scalar, float(a[2]) * scalar]

static func _reject(vector: Array, normal: Array) -> Array:
	return _sub(vector, _scale(normal, _dot(vector, normal)))

static func _norm(vector: Array) -> Array:
	var magnitude := _length(vector)
	if magnitude == 0.0:
		magnitude = 1.0
	return [float(vector[0]) / magnitude, float(vector[1]) / magnitude, float(vector[2]) / magnitude]

static func _length(vector: Array) -> float:
	var maximum := maxf(absf(float(vector[0])), maxf(absf(float(vector[1])), absf(float(vector[2]))))
	if maximum == 0.0:
		return 0.0
	if is_inf(maximum):
		return INF
	var x := float(vector[0]) / maximum
	var y := float(vector[1]) / maximum
	var z := float(vector[2]) / maximum
	return maximum * sqrt(x * x + y * y + z * z)

static func _length4(vector: Array) -> float:
	var maximum := 0.0
	for component: float in vector:
		maximum = maxf(maximum, absf(component))
	if maximum == 0.0:
		return 0.0
	if is_inf(maximum):
		return INF
	var total := 0.0
	for component: float in vector:
		var scaled := component / maximum
		total += scaled * scaled
	return maximum * sqrt(total)
