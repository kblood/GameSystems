class_name GSNearestGrasp
extends RefCounted
## Stateless port of extensions/grasp/baked_grasps.js nearestPose.
## See README.md for input, units, identity, ordering and malformed-input semantics.

const ANGLE_WEIGHT := 0.05 # Metres of cost per radian.
const HYSTERESIS := 0.01 # Metres subtracted for previousId.
const QUAT_NORM_TOLERANCE := 0.001 # Accommodates the canonical rounded bake.

static func nearest_pose(poses: Array, kind: String, side: String, local: Dictionary, options: Dictionary = {}) -> Variant:
	if not _numbers(local.get("pos"), 3) or not _quaternion(local.get("quat")):
		return null
	var previous: Variant = options.get("previousId")
	var grasp: Variant = options.get("grasp")
	var predicate: Variant = options.get("filter")
	if (previous != null and not previous is String) or (grasp != null and not grasp is String):
		return null
	if predicate != null and (not predicate is Callable or not predicate.is_valid()):
		return null
	# Validate before callbacks so a malformed library cannot produce a partial result.
	for pose: Variant in poses:
		if not _pose(pose):
			return null
	var best: Variant = null
	for pose: Dictionary in poses:
		if pose.kind != kind or pose.side != side:
			continue
		if grasp != null and grasp != "" and pose.grasp != grasp:
			continue
		if predicate != null and not predicate.call(pose):
			continue
		var dx: float = pose.wrist[0] - local.pos[0]
		var dy: float = pose.wrist[1] - local.pos[1]
		var dz: float = pose.wrist[2] - local.pos[2]
		# Scaled length avoids intermediate overflow/underflow, like JS Math.hypot.
		var scale: float = maxf(absf(dx), maxf(absf(dy), absf(dz)))
		var distance := 0.0
		if scale > 0.0:
			distance = scale * sqrt((dx / scale) ** 2 + (dy / scale) ** 2 + (dz / scale) ** 2)
		var angle := quat_angle(pose.quat, local.quat)
		var cost: float = distance + ANGLE_WEIGHT * angle - (HYSTERESIS if pose.id == previous else 0.0)
		if not is_finite(distance) or not is_finite(cost):
			return null
		if best == null or cost < best.cost:
			best = {"pose": pose, "cost": cost, "distance": distance, "angle": angle}
	return best

static func quat_angle(a: Array, b: Array) -> float:
	# Preconditions: four finite components, approximately unit length; no normalization.
	var dot: float = absf(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])
	return 2.0 * acos(minf(1.0, dot))

static func _pose(pose: Variant) -> bool:
	if not pose is Dictionary:
		return false
	for key: String in ["id", "kind", "side", "grasp"]:
		if not pose.get(key) is String:
			return false
	return _numbers(pose.get("wrist"), 3) and _quaternion(pose.get("quat"))

static func _numbers(value: Variant, count: int) -> bool:
	if not value is Array or value.size() != count:
		return false
	for item: Variant in value:
		if (not item is float and not item is int) or not is_finite(float(item)):
			return false
	return true

static func _quaternion(value: Variant) -> bool:
	if not _numbers(value, 4):
		return false
	var norm_squared := 0.0
	for component: float in value:
		norm_squared += component * component
	return absf(norm_squared - 1.0) <= QUAT_NORM_TOLERANCE
