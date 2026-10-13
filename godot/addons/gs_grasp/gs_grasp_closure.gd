class_name GSGraspClosure
extends RefCounted
## Forward kinematics shared by grasp closure, contact fitting and tracked-hand previews.

const D2R := PI / 180.0
const ShapeSdf := preload("res://addons/gs_grasp/gs_grasp_shape_sdf.gd")
const DEFAULT_THUMB_TILT := PI / 3.0
const DEFAULT_REFERENCE_HAND := {
	"length": 0.203,
	"palm": [0.0, -0.0238, 0.0685],
}
const DEFAULT_PAD_RADIUS := {
	"Thumb": [0.031, 0.037, 0.032],
	"Index": [0.055, 0.052, 0.05],
	"Middle": [0.04, 0.037, 0.034],
	"Ring": [0.05, 0.047, 0.045],
	"Little": [0.044, 0.042, 0.04],
}
const FINGERS := ["Thumb", "Index", "Middle", "Ring", "Little"]

## Build hand-space finger, palm and thenar geometry from a measured profile or a rest-hand joint fixture.
## Supports the public closure.handGeometry format; lengths and points are rig-space metres.
static func hand_geometry(rest: Dictionary, options: Dictionary = {}) -> Dictionary:
	var scale_value: Variant = options.get("scale")
	if not options.has("scale"):
		scale_value = rest.get("scale")
		if scale_value == null:
			scale_value = 1.0
	var scale := float(scale_value) if scale_value != null else 0.0
	var profile: Dictionary = {}
	var requested_profile: Variant = options.get("profile")
	if requested_profile == null:
		requested_profile = rest.get("profile")
	if _is_hand_profile(requested_profile):
		profile = requested_profile
	else:
		var tilt_option: Variant = options.get("thumbTilt")
		if tilt_option == null:
			tilt_option = rest.get("thumbTilt")
			if tilt_option == null:
				tilt_option = DEFAULT_THUMB_TILT
		var radii_option: Variant = options.get("radii")
		var requested_radii: Dictionary = radii_option if radii_option is Dictionary else DEFAULT_PAD_RADIUS
		profile = _profile_from_rest(rest, float(tilt_option), requested_radii)
	if options.has("radii") and options.radii is Dictionary:
		profile = profile.duplicate(true)
		var pads: Dictionary = {}
		for finger_name: String in FINGERS:
			var values: Array = options.radii[finger_name]
			var scaled: Array = []
			for radius: float in values:
				scaled.append(radius * float(profile.length))
			pads[finger_name] = scaled
		profile["pad"] = pads
	var side := str(profile.get("side", rest.get("side", "")))
	var tilt_value: Variant = options.get("thumbTilt")
	if tilt_value == null:
		tilt_value = profile.get("thumbTilt")
	if tilt_value == null:
		tilt_value = rest.get("thumbTilt")
		if tilt_value == null:
			tilt_value = DEFAULT_THUMB_TILT
	var tilt := float(tilt_value)
	var radial_sign := -1.0 if side == "left" else 1.0
	var fingers: Dictionary = {}
	for finger_name: String in FINGERS:
		var axes := _finger_axes(finger_name, side, tilt)
		var basis: Dictionary = profile.bases
		var segment_lengths: Dictionary = profile.segments
		var spreads: Dictionary = profile.spread
		var pads: Dictionary = profile.pad
		fingers[finger_name] = {
			"base": _profile_to_hand_space(basis[finger_name], radial_sign),
			"len": segment_lengths[finger_name].duplicate(),
			"axes": axes,
			"hinge": _norm(_cross(axes.D, axes.F)),
			"restYaw": float(spreads[finger_name]),
			"radius": pads[finger_name].duplicate(),
			"twistSign": -1.0 if side == "left" else 1.0,
		}
	var center := _profile_to_hand_space(profile.palmCenter, radial_sign)
	var normal := _norm(_profile_to_hand_space(profile.palmNormal, radial_sign))
	var samples: Array = []
	var palm_patch: Variant = profile.get("palmPatch", [])
	if palm_patch is Array:
		for point: Variant in palm_patch:
			if _is_vector3(point):
				samples.append(_profile_to_hand_space(point, radial_sign))
	if samples.size() < 3:
		var profile_width: Variant = profile.get("palmWidth")
		if not _finite_number(profile_width) or float(profile_width) == 0.0:
			profile_width = 0.43 * float(profile.length)
		var width := 0.3 * float(profile_width)
		var depth := 0.25 * float(profile.knuckle)
		var u := _norm(_reject([1.0, 0.0, 0.0], normal))
		var v := _norm(_cross(normal, u))
		for i: float in [-1.0, 0.0, 1.0]:
			for j: float in [-1.0, 0.0, 1.0]:
				samples.append(_add(center, _add(_scale(u, i * width), _scale(v, j * depth))))
	samples.append(center.duplicate())
	var thumb: Dictionary = fingers.Thumb
	var thumb_base: Array = thumb.base
	var thumb_joint: Array = finger_chain(thumb, [0.0, 0.0, 0.0, 0.0])[1]
	var thenar_points: Array = []
	var raw_thenar: Variant = profile.get("thenarPatch", [])
	if raw_thenar is Array:
		for point: Variant in raw_thenar:
			if _is_vector3(point):
				thenar_points.append(_profile_to_hand_space(point, radial_sign))
	var palm_geometry := {"center": center, "normal": normal, "samples": samples}
	if profile.has("palmWidth"):
		palm_geometry["width"] = profile.palmWidth
	if profile.has("palmThickness"):
		palm_geometry["thickness"] = profile.palmThickness
	var thumb_root: Variant = profile.get("thumbRoot")
	if thumb_root == null:
		thumb_root = thumb.radius[0]
	return {
		"side": side,
		"scale": scale,
		"length": float(profile.length) * scale,
		"thumbTilt": tilt,
		"profile": profile,
		"fingers": fingers,
		"palm": palm_geometry,
		"thenar": {"a": thumb_base.duplicate(), "b": _add(thumb_base, _scale(_sub(thumb_joint, thumb_base), 0.6)),
			"radius": float(thumb_root), "points": thenar_points},
	}

## Retarget a baked/recorded wrist to this hand's length while keeping its palm anchor in place.
## `hand.length` and `reference.length` use metres; `pose.wrist` and `pose.quat` are item-space.
static func place_wrist(pose: Dictionary, hand: Dictionary, reference: Dictionary = DEFAULT_REFERENCE_HAND) -> Dictionary:
	var wrist: Array = pose.wrist
	var quat: Array = pose.quat
	var offset := 0.0
	if pose.has("handLength") and _finite_number(pose.handLength) and float(pose.handLength) > 0.0:
		var delta := (float(pose.handLength) - float(hand.length)) / float(reference.length)
		if not is_finite(delta) or absf(delta) < 1e-6:
			return {"wrist": wrist.duplicate(), "quat": quat.duplicate()}
		offset = delta
	else:
		var ratio := float(hand.length) / float(reference.length)
		if not is_finite(ratio) or absf(ratio - 1.0) < 1e-4:
			return {"wrist": wrist.duplicate(), "quat": quat.duplicate()}
		offset = 1.0 - ratio
	var palm_offset := _rotate_by_quaternion(_scale(reference.palm, offset), quat)
	return {"wrist": _add(wrist, palm_offset), "quat": quat.duplicate()}

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

## Measure each finger segment's skin gap (metres) against item-local signed-distance geometry.
## Samples the bone midpoint and distal joint, matching closure.segmentGaps. Earlier segments stay INF when `from` is nonzero.
static func segment_gaps(chain: Array, finger: Dictionary, shape: Dictionary, wrist: Array, quat: Array,
		scale: float = 1.0, from: int = 0) -> Array:
	var gaps: Array = [INF, INF, INF]
	for segment: int in range(clampi(from, 0, 3), 3):
		var a: Array = chain[segment]
		var b: Array = chain[segment + 1]
		var midpoint := _scale(_add(a, b), 0.5)
		var middle_distance: Variant = ShapeSdf.signed_distance(shape, _to_item_space(midpoint, wrist, quat, scale))
		var end_distance: Variant = ShapeSdf.signed_distance(shape, _to_item_space(b, wrist, quat, scale))
		if not _finite_number(middle_distance) or not _finite_number(end_distance):
			continue
		var radius: Array = finger.radius
		gaps[segment] = minf(float(middle_distance), float(end_distance)) - float(radius[segment]) * scale
	return gaps

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

static func _finite_number(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value))

static func _rotate_by_quaternion(vector: Array, quaternion: Array) -> Array:
	var x := float(quaternion[0])
	var y := float(quaternion[1])
	var z := float(quaternion[2])
	var w := float(quaternion[3])
	var tx := 2.0 * (y * float(vector[2]) - z * float(vector[1]))
	var ty := 2.0 * (z * float(vector[0]) - x * float(vector[2]))
	var tz := 2.0 * (x * float(vector[1]) - y * float(vector[0]))
	return [float(vector[0]) + w * tx + y * tz - z * ty,
		float(vector[1]) + w * ty + z * tx - x * tz,
		float(vector[2]) + w * tz + x * ty - y * tx]

static func _to_item_space(point: Array, wrist: Array, quat: Array, scale: float) -> Array:
	return _add(wrist, _rotate_by_quaternion(_scale(point, scale), quat))

static func _is_vector3(value: Variant) -> bool:
	return value is Array and value.size() == 3 and _finite_number(value[0]) and _finite_number(value[1]) and _finite_number(value[2])

static func _profile_to_hand_space(point: Array, radial_sign: float) -> Array:
	return [float(point[0]) * radial_sign, float(point[1]), float(point[2])]

static func _is_hand_profile(value: Variant) -> bool:
	if not value is Dictionary or value.get("format") != "gamesystems.hand-profile.v1":
		return false
	if value.get("side") not in ["left", "right"] or not _finite_number(value.get("length")) or float(value.length) <= 0.0:
		return false
	if not _finite_number(value.get("knuckle")) or float(value.knuckle) <= 0.0:
		return false
	if not _is_vector3(value.get("palmCenter")) or not _is_vector3(value.get("palmNormal")):
		return false
	for finger_name: String in FINGERS:
		if not value.get("bases") is Dictionary or not _is_vector3(value.bases.get(finger_name)):
			return false
		if not value.get("segments") is Dictionary or not value.segments.get(finger_name) is Array or value.segments[finger_name].size() != 3:
			return false
		if not value.get("pad") is Dictionary or not value.pad.get(finger_name) is Array or value.pad[finger_name].size() != 3:
			return false
		var spreads: Variant = value.get("spread")
		if not spreads is Dictionary or not _finite_number(spreads.get(finger_name)):
			return false
		for index: int in 3:
			if not _finite_number(value.segments[finger_name][index]) or not _finite_number(value.pad[finger_name][index]):
				return false
	return true

static func _profile_from_rest(rest: Dictionary, thumb_tilt: float, radii: Dictionary) -> Dictionary:
	var side := str(rest.side)
	var frame: Dictionary = rest.frame
	var dorsal: Array = _norm(frame.D)
	var forward: Array = _norm(frame.F)
	var radial: Array
	if frame.get("R") != null:
		radial = _norm(frame.R)
	else:
		var cross_axis := _norm(_cross(dorsal, forward))
		radial = _scale(cross_axis, -1.0 if side == "left" else 1.0)
	var wrist: Array = rest.wrist
	var bases: Dictionary = {}
	var segments: Dictionary = {}
	var spread: Dictionary = {}
	for finger_name: String in FINGERS:
		var source: Dictionary = rest.fingers[finger_name]
		var points: Array = source.pts
		var local_points: Array = []
		for point: Array in points:
			var relative := _sub(point, wrist)
			local_points.append([_dot(relative, radial), _dot(relative, dorsal), _dot(relative, forward)])
		bases[finger_name] = local_points[0]
		var length_values: Array = []
		if source.has("len") and source.len is Array and source.len.size() == 3:
			length_values = source.len.duplicate()
		else:
			for index: int in 3:
				length_values.append(_length(_sub(local_points[index + 1], local_points[index])))
		segments[finger_name] = length_values
		var first_direction := _norm(_sub(local_points[1], local_points[0]))
		var recorded_yaw: Variant = source.get("rest", {}).get("yaw")
		spread[finger_name] = float(recorded_yaw) if recorded_yaw != null else atan2(float(first_direction[0]), float(first_direction[2]))
	var knuckle := _length(bases.Middle)
	var hand_length := knuckle + float(segments.Middle[0]) + float(segments.Middle[1]) + float(segments.Middle[2])
	var pads: Dictionary = {}
	for finger_name: String in FINGERS:
		var values: Array = []
		for radius: float in radii[finger_name]:
			values.append(radius * hand_length)
		pads[finger_name] = values
	var palm := _scale(DEFAULT_REFERENCE_HAND.palm, hand_length / float(DEFAULT_REFERENCE_HAND.length))
	return {"format": "gamesystems.hand-profile.v1", "side": side, "source": "rest", "length": hand_length,
		"knuckle": knuckle, "palmWidth": 0.43 * hand_length, "palmThickness": 0.16 * hand_length,
		"palmCenter": palm, "palmNormal": [0.0, -1.0, 0.0], "palmPatch": [], "thumbRoot": pads.Thumb[0],
		"thumbTilt": thumb_tilt, "bases": bases, "spread": spread, "segments": segments, "girth": pads, "pad": pads}

static func _finger_axes(finger_name: String, side: String, tilt: float) -> Dictionary:
	var forward := [0.0, 0.0, 1.0]
	var dorsal := [0.0, 1.0, 0.0]
	var radial := [-1.0, 0.0, 0.0] if side == "left" else [1.0, 0.0, 0.0]
	if finger_name != "Thumb":
		return {"F": forward, "D": dorsal, "R": radial}
	var cosine := cos(tilt)
	var sine := sin(tilt)
	var thumb_dorsal := _norm(_add(_scale(dorsal, cosine), _scale(radial, sine)))
	var thumb_radial := _norm(_reject(_sub(_scale(radial, cosine), _scale(dorsal, sine)), thumb_dorsal))
	return {"F": forward, "D": thumb_dorsal, "R": thumb_radial}
