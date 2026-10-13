class_name GSGraspClosure
extends RefCounted
## Forward kinematics shared by grasp closure, contact fitting and tracked-hand previews.

const D2R := PI / 180.0
const ShapeSdf := preload("res://addons/gs_grasp/gs_grasp_shape_sdf.gd")
const ClosureDataReader = preload("res://addons/gs_grasp_data/gs_grasp_closure_data.gd")
const ValidatorDataReader = preload("res://addons/gs_grasp_data/gs_grasp_validator_data.gd")
const JOINT_KEYS := ["dyaw", "pitch", "bend1", "bend2", "twist"]
const DEFAULT_THUMB_TILT := PI / 3.0
const DEFAULT_REFERENCE_HAND := {
	"length": 0.203,
	"palm": [0.0, -0.0238, 0.0685],
	"palmCenter": [-0.0065, -0.0249, 0.0617],
}
const DEFAULT_PALM_GAP := 0.004
const DEFAULT_PALM_SLIDE := 0.04
const DEFAULT_SQUEEZE := 0.001
const DEFAULT_PAD_RADIUS := {
	"Thumb": [0.031, 0.037, 0.032],
	"Index": [0.055, 0.052, 0.05],
	"Middle": [0.04, 0.037, 0.034],
	"Ring": [0.05, 0.047, 0.045],
	"Little": [0.044, 0.042, 0.04],
}
const FINGERS := ["Thumb", "Index", "Middle", "Ring", "Little"]
static var _closure_defaults: Dictionary = {}
static var _hard_ranges: Dictionary = {}

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

## Place this hand's palm centre on the baked palm anchor, then slide along the palm normal to fit palm/thenar clearance.
## `offset` is in hand space: lateral/along/normal in metres, pitch/twist in degrees. `thumb_row` moves profile thenar
## samples with the thumb CMC. A null shape returns only the unslid wrist and orientation.
static func place_palm(pose: Dictionary, hand: Dictionary, shape: Variant = null, options: Dictionary = {},
		offset: Dictionary = {}, thumb_row: Variant = "__pose_approach__", reference: Dictionary = DEFAULT_REFERENCE_HAND) -> Dictionary:
	var opts := {"palmGap": DEFAULT_PALM_GAP, "palmSlide": DEFAULT_PALM_SLIDE, "squeeze": DEFAULT_SQUEEZE}
	opts.merge(options, true)
	var effective_thumb_row: Variant = thumb_row
	if effective_thumb_row is String and effective_thumb_row == "__pose_approach__":
		var approach: Variant = pose.get("open", [])
		if approach is Array and not approach.is_empty():
			effective_thumb_row = approach[0]
	var orient: Array = pose.quat.duplicate()
	var pitch := float(offset.get("pitch", 0.0))
	if pitch != 0.0:
		orient = _quaternion_multiply(orient, _axis_angle_quaternion([1.0, 0.0, 0.0], pitch * D2R))
	var twist := float(offset.get("twist", 0.0))
	if twist != 0.0:
		orient = _quaternion_multiply(orient, _axis_angle_quaternion(hand.palm.normal, twist * D2R))
	var pivot := _palm_anchor(pose, str(hand.side), reference)
	var lateral := float(offset.get("lateral", 0.0))
	if lateral != 0.0:
		pivot = _add(pivot, _rotate_by_quaternion([-lateral if hand.side == "left" else lateral, 0.0, 0.0], pose.quat))
	var scale := float(hand.scale)
	var palm_center: Array = hand.palm.center
	var along := float(offset.get("along", 0.0))
	var at := palm_center.duplicate()
	if along != 0.0:
		at[2] = float(at[2]) + along / scale
	var wrist := _sub(pivot, _rotate_by_quaternion(_scale(at, scale), orient))
	if shape == null:
		return {"wrist": wrist, "quat": orient}
	var normal := _rotate_by_quaternion(hand.palm.normal, orient)
	var gaps := _palm_gaps(hand, wrist, orient, shape, effective_thumb_row)
	var moved := 0.0
	var palm_slide := float(opts.palmSlide)
	for _iteration: int in 3:
		if not _finite_number(gaps.palm):
			break
		var palm_offset: Variant = hand.profile.get("palmOffset", 0.0)
		if not _finite_number(palm_offset):
			palm_offset = 0.0
		var want := float(gaps.palm) - float(opts.palmGap) - float(palm_offset) * scale
		want = maxf(-palm_slide - moved, minf(palm_slide - moved, want))
		if absf(want) < 1e-4:
			break
		wrist = _add(wrist, _scale(normal, want))
		moved += want
		gaps = _palm_gaps(hand, wrist, orient, shape, effective_thumb_row)
	for _iteration: int in 3:
		if float(gaps.thenar) >= -float(opts.squeeze):
			break
		wrist = _add(wrist, _scale(normal, float(gaps.thenar) + float(opts.squeeze) / 2.0))
		gaps = _palm_gaps(hand, wrist, orient, shape, effective_thumb_row)
	var normal_offset := float(offset.get("normal", 0.0))
	if normal_offset != 0.0:
		wrist = _add(wrist, _scale(normal, -normal_offset))
		gaps = _palm_gaps(hand, wrist, orient, shape, effective_thumb_row)
	return {"wrist": wrist, "quat": orient, "palmGap": gaps.palm, "thenarGap": gaps.thenar}

## Close one finger row from its open approach toward its baked shape until the skin samples reach the item SDF.
## Returns the target row, three shape parameters, touching segment indices and backedOff/stuck flags. This is a pure
## helper; it does not modify a hand or pose and does not perform thumb CMC search.
static func close_finger(name: String, finger: Dictionary, open_row: Array, closed_row: Array, shape: Dictionary,
		wrist: Array, quat: Array, scale: float = 1.0, options: Dictionary = {}) -> Dictionary:
	var opts: Dictionary = _load_closure_defaults().duplicate(true)
	opts.merge(options, true)
	var hard: Dictionary = _load_hard_ranges()
	var squeeze := float(opts.squeeze)
	var deep := -squeeze
	var is_thumb := name == "Thumb"
	var thumb_overshoot: Variant = opts.get("thumbOvershoot")
	if thumb_overshoot == null:
		thumb_overshoot = opts.overshoot
	var max_t := 1.0 + (float(thumb_overshoot) if is_thumb else float(opts.overshoot))
	var free := bool(opts.get("free", false))
	var twisted := is_thumb and (open_row.size() > 4 or closed_row.size() > 4)
	var twist_open := float(open_row[4]) if open_row.size() > 4 else 0.0
	var twist_closed := float(closed_row[4]) if closed_row.size() > 4 else 0.0
	var parameters := [1.0, 1.0, 1.0]
	var gaps: Array = [INF, INF, INF]
	var touching: Array[int] = []
	var first_free := 0
	var backed_off := false
	var initial_hit := _close_reach(parameters, 0, deep, name, finger, open_row, closed_row, hard,
		free, twisted, twist_open, twist_closed, shape, wrist, quat, scale, gaps)
	if initial_hit >= 0:
		var depth0 := minf(float(gaps[0]), minf(float(gaps[1]), float(gaps[2])))
		var delta := float(opts.step) / 2.0
		var previous := 1.0
		var t := 1.0
		var clear := false
		while t > -float(opts.backoff) + 1e-9:
			t = maxf(-float(opts.backoff), t - delta)
			_set_close_parameter(parameters, 0, t)
			var hit := _close_reach(parameters, 0, deep, name, finger, open_row, closed_row, hard,
				free, twisted, twist_open, twist_closed, shape, wrist, quat, scale, gaps)
			if hit < 0:
				clear = true
				break
			var depth := minf(float(gaps[0]), minf(float(gaps[1]), float(gaps[2])))
			if depth < depth0 - squeeze:
				break
			previous = t
		if not clear:
			_set_close_parameter(parameters, 0, 1.0)
			_set_close_parameter(parameters, 1, 1.0)
			_set_close_parameter(parameters, 2, 1.0)
			gaps = [INF, INF, INF]
			initial_hit = _close_reach(parameters, 0, deep, name, finger, open_row, closed_row, hard,
				free, twisted, twist_open, twist_closed, shape, wrist, quat, scale, gaps)
			if depth0 >= -float(opts.tolerate):
				return {"row": _close_row_at(name, open_row, closed_row, parameters, hard, free, twisted, twist_open, twist_closed),
					"t": [1.0, 1.0, 1.0], "touching": [initial_hit], "backedOff": false, "stuck": false}
			return {"row": _close_row_at(name, open_row, closed_row, parameters, hard, free, twisted, twist_open, twist_closed),
				"t": [1.0, 1.0, 1.0], "touching": [], "backedOff": true, "stuck": true}
		var outside := t
		var deeper := previous
		for _iteration: int in int(opts.bisect):
			var middle := (outside + deeper) / 2.0
			_set_close_parameter(parameters, 0, middle)
			if _close_reach(parameters, 0, deep, name, finger, open_row, closed_row, hard, free,
					twisted, twist_open, twist_closed, shape, wrist, quat, scale, gaps) >= 0:
				deeper = middle
			else:
				outside = middle
		_set_close_parameter(parameters, 0, deeper)
		var contact_segment := _close_reach(parameters, 0, deep, name, finger, open_row, closed_row, hard,
			free, twisted, twist_open, twist_closed, shape, wrist, quat, scale, gaps)
		_set_close_parameter(parameters, 0, outside)
		touching.append(contact_segment if contact_segment >= 0 else initial_hit)
		first_free = int(touching[0]) + 1
		backed_off = true
	else:
		var near_hit := _close_reach(parameters, 0, float(opts.touch), name, finger, open_row, closed_row, hard,
			free, twisted, twist_open, twist_closed, shape, wrist, quat, scale, gaps)
		if near_hit >= 0:
			touching.append(near_hit)
			first_free = near_hit + 1
	while first_free < 3:
		var start := float(parameters[first_free])
		var previous := start
		var hit := -1
		var t := start
		while t < max_t:
			t = minf(max_t, t + float(opts.step))
			_set_close_parameter(parameters, first_free, t)
			hit = _close_reach(parameters, first_free, deep, name, finger, open_row, closed_row, hard,
				free, twisted, twist_open, twist_closed, shape, wrist, quat, scale, gaps)
			if hit >= 0:
				break
			previous = t
		if hit < 0:
			_set_close_parameter(parameters, first_free, start)
			break
		var low := previous
		var high := t
		for _iteration: int in int(opts.bisect):
			var middle := (low + high) / 2.0
			_set_close_parameter(parameters, first_free, middle)
			if _close_reach(parameters, first_free, deep, name, finger, open_row, closed_row, hard,
					free, twisted, twist_open, twist_closed, shape, wrist, quat, scale, gaps) >= 0:
				high = middle
			else:
				low = middle
		_set_close_parameter(parameters, first_free, high)
		hit = _close_reach(parameters, first_free, deep, name, finger, open_row, closed_row, hard,
			free, twisted, twist_open, twist_closed, shape, wrist, quat, scale, gaps)
		touching.append(hit)
		first_free = hit + 1
	return {"row": _close_row_at(name, open_row, closed_row, parameters, hard, free, twisted, twist_open, twist_closed),
		"t": parameters.duplicate(), "touching": touching, "backedOff": backed_off, "stuck": false}

static func _close_reach(parameters: Array, from_segment: int, limit: float, name: String, finger: Dictionary,
		open_row: Array, closed_row: Array, hard: Dictionary, free: bool, twisted: bool,
		twist_open: float, twist_closed: float, shape: Dictionary, wrist: Array, quat: Array,
		scale: float, gaps: Array) -> int:
	var row := _close_row_at(name, open_row, closed_row, parameters, hard, free, twisted, twist_open, twist_closed)
	var measured := segment_gaps(finger_chain(finger, row), finger, shape, wrist, quat, scale, from_segment)
	for segment: int in 3:
		gaps[segment] = measured[segment]
	for segment: int in range(from_segment, 3):
		if float(gaps[segment]) <= limit:
			return segment
	return -1

static func _close_row_at(name: String, open_row: Array, closed_row: Array, parameters: Array, hard: Dictionary,
		free: bool, twisted: bool, twist_open: float, twist_closed: float) -> Array:
	var t0 := minf(1.0, float(parameters[0])) if name == "Thumb" else float(parameters[0])
	var row: Array = [
		_limited_row_value(name, 0, float(open_row[0]) + (float(closed_row[0]) - float(open_row[0])) * t0, hard, free),
		_limited_row_value(name, 1, float(open_row[1]) + (float(closed_row[1]) - float(open_row[1])) * t0, hard, free),
		_limited_row_value(name, 2, float(open_row[2]) + (float(closed_row[2]) - float(open_row[2])) * float(parameters[1]), hard, free),
		_limited_row_value(name, 3, float(open_row[3]) + (float(closed_row[3]) - float(open_row[3])) * float(parameters[2]), hard, free)]
	if twisted:
		row.append(_limited_row_value(name, 4, twist_open + (twist_closed - twist_open) * t0, hard, free))
	return row

static func _limited_row_value(name: String, joint: int, value: float, hard: Dictionary, free: bool) -> float:
	if free:
		return value
	var bounds: Array = hard[name][JOINT_KEYS[joint]]
	return clampf(value, float(bounds[0]), float(bounds[1]))

static func _set_close_parameter(parameters: Array, from_segment: int, value: float) -> void:
	for index: int in range(from_segment, 3):
		parameters[index] = value

static func _load_closure_defaults() -> Dictionary:
	if _closure_defaults.is_empty():
		_closure_defaults = ClosureDataReader.load_data().get("CLOSURE", {})
	return _closure_defaults

static func _load_hard_ranges() -> Dictionary:
	if _hard_ranges.is_empty():
		_hard_ranges = ValidatorDataReader.load_data().get("HARD", {})
	return _hard_ranges

static func _palm_anchor(pose: Dictionary, side: String, reference: Dictionary) -> Array:
	var factor := 1.0
	var hand_length: Variant = pose.get("handLength")
	if _finite_number(hand_length) and float(hand_length) > 0.0:
		factor = float(hand_length) / float(reference.length)
	var center: Array = reference.palmCenter.duplicate()
	if side == "left":
		center[0] = -float(center[0])
	return _add(pose.wrist, _rotate_by_quaternion(_scale(center, factor), pose.quat))

static func _palm_gaps(hand: Dictionary, wrist: Array, quat: Array, shape: Dictionary, thumb_row: Variant) -> Dictionary:
	var palm := INF
	for sample: Array in hand.palm.samples:
		var distance: Variant = ShapeSdf.signed_distance(shape, _to_item_space(sample, wrist, quat, float(hand.scale)))
		if _finite_number(distance):
			palm = minf(palm, float(distance))
	var thenar := INF
	var points: Array = hand.thenar.points
	if not points.is_empty():
		for point: Array in _thenar_points(hand, thumb_row):
			var distance: Variant = ShapeSdf.signed_distance(shape, _to_item_space(point, wrist, quat, float(hand.scale)))
			if _finite_number(distance):
				thenar = minf(thenar, float(distance))
	else:
		var a: Array = hand.thenar.a
		var b: Array = hand.thenar.b
		for fraction: float in [0.0, 0.5, 1.0]:
			var sample := _add(a, _scale(_sub(b, a), fraction))
			var distance: Variant = ShapeSdf.signed_distance(shape, _to_item_space(sample, wrist, quat, float(hand.scale)))
			if _finite_number(distance):
				thenar = minf(thenar, float(distance) - float(hand.thenar.radius) * float(hand.scale))
	return {"palm": palm, "thenar": thenar}

static func _thenar_points(hand: Dictionary, thumb_row: Variant) -> Array:
	var points: Array = hand.thenar.points
	if thumb_row == null or not thumb_row is Array or points.is_empty():
		return points
	var thumb: Dictionary = hand.fingers.Thumb
	var base: Array = thumb.base
	var rest_joint: Array = finger_chain(thumb, [0.0, 0.0, 0.0, 0.0])[1]
	var target_joint: Array = finger_chain(thumb, thumb_row)[1]
	var rest_direction := _norm(_sub(rest_joint, base))
	var target_direction := _norm(_sub(target_joint, base))
	var axis := _cross(rest_direction, target_direction)
	var sine := _length(axis)
	if sine < 1e-6:
		return points
	var angle := atan2(sine, _dot(rest_direction, target_direction))
	axis = _scale(axis, 1.0 / sine)
	var moved: Array = []
	for point: Array in points:
		moved.append(_add(base, _turn(_sub(point, base), axis, angle)))
	return moved

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

static func _quaternion_multiply(a: Array, b: Array) -> Array:
	var ax := float(a[0])
	var ay := float(a[1])
	var az := float(a[2])
	var aw := float(a[3])
	var bx := float(b[0])
	var by := float(b[1])
	var bz := float(b[2])
	var bw := float(b[3])
	return [aw * bx + ax * bw + ay * bz - az * by,
		aw * by - ax * bz + ay * bw + az * bx,
		aw * bz + ax * by - ay * bx + az * bw,
		aw * bw - ax * bx - ay * by - az * bz]

static func _axis_angle_quaternion(axis: Array, angle: float) -> Array:
	var half := angle / 2.0
	var sine := sin(half)
	return [float(axis[0]) * sine, float(axis[1]) * sine, float(axis[2]) * sine, cos(half)]

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
