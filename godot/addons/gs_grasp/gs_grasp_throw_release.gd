class_name GSGraspThrowRelease
extends RefCounted
## Stateless peak-smoothed release math; hosts own tracking, release decisions and physics.

const GLASS_BREAK_CONTACT_SPEED := 2.5
const RELEASE_SPEED_CAP := 9.0
const RELEASE_SPIN_CAP := 22.0
const RELEASE_WINDOW := 0.1
const RELEASE_SMOOTHING := 0.04
const SAMPLE_SPEED_CAP := 8.0
const SAMPLE_SPIN_CAP := 20.0
const HISTORY_SPAN := 0.16

static func create_history() -> Dictionary:
	return {"samples": [], "linear": Vector3.ZERO, "angular": Vector3.ZERO}

## Appends bounded finite velocities and transactionally refreshes the public release values.
static func push_sample(history: Dictionary, linear: Vector3, angular: Vector3, dt: float) -> Dictionary:
	if not _valid_history(history) or not _finite_vector(linear) or not _finite_vector(angular) or not _finite(dt) or dt <= 0.0:
		return history
	var candidate: Array = history.samples.duplicate()
	candidate.append({"dt": dt, "linear": linear.limit_length(SAMPLE_SPEED_CAP), "angular": angular.limit_length(SAMPLE_SPIN_CAP)})
	var span := 0.0
	for index in range(candidate.size() - 1, -1, -1):
		span += float(candidate[index].dt)
		if not _finite(span): return history
		if span > HISTORY_SPAN:
			candidate = candidate.slice(index + 1)
			break
	var result: Variant = release_velocity(candidate)
	if not result is Dictionary: return history
	history.samples = candidate
	history.linear = result.linear
	history.angular = result.angular
	return history

## Chooses the peak vector magnitude among short dt-weighted windows in the recent release interval.
static func release_velocity(samples: Array) -> Variant:
	if not _valid_samples(samples): return null
	var best_linear := Vector3.ZERO
	var best_angular := Vector3.ZERO
	var age := 0.0
	for index in range(samples.size() - 1, -1, -1):
		if age > RELEASE_WINDOW: break
		var linear_sum := Vector3.ZERO
		var angular_sum := Vector3.ZERO
		var covered := 0.0
		for sample_index in range(index, -1, -1):
			var sample: Dictionary = samples[sample_index]
			var take := minf(float(sample.dt), RELEASE_SMOOTHING - covered)
			if take <= 0.0: break
			linear_sum += sample.linear * take
			angular_sum += sample.angular * take
			covered += take
		if not _finite(covered) or not _finite_vector(linear_sum) or not _finite_vector(angular_sum): return null
		var linear := linear_sum / covered if covered > 0.0 else Vector3.ZERO
		var angular := angular_sum / covered if covered > 0.0 else Vector3.ZERO
		if not _finite_vector(linear) or not _finite_vector(angular): return null
		if linear.length() > best_linear.length():
			best_linear = linear
			best_angular = angular
		age += float(samples[index].dt)
		if not _finite(age): return null
	return {"linear": best_linear.limit_length(RELEASE_SPEED_CAP), "angular": best_angular.limit_length(RELEASE_SPIN_CAP)}

## Difference between consecutive world poses. Inputs use Vector3 positions and normalized Quaternions.
static func sample_from_poses(previous_position: Vector3, previous_rotation: Quaternion,
		current_position: Vector3, current_rotation: Quaternion, dt: float) -> Variant:
	if not _finite_vector(previous_position) or not _finite_vector(current_position) or not _finite(dt) or dt <= 0.0 \
			or not _valid_quaternion(previous_rotation) or not _valid_quaternion(current_rotation):
		return null
	var linear := (current_position - previous_position) / dt
	# Match the JS current * conjugate(previous) formula for unit input quaternions.
	var ax := previous_rotation.x
	var ay := previous_rotation.y
	var az := previous_rotation.z
	var aw := previous_rotation.w
	var bx := current_rotation.x
	var by := current_rotation.y
	var bz := current_rotation.z
	var bw := current_rotation.w
	var x := bw * -ax + bx * aw + by * -az - bz * -ay
	var y := bw * -ay - bx * -az + by * aw + bz * -ax
	var z := bw * -az + bx * -ay - by * -ax + bz * aw
	var w := bw * aw - bx * -ax - by * -ay - bz * -az
	if w < 0.0:
		x = -x
		y = -y
		z = -z
		w = -w
	var vector := Vector3(x, y, z)
	var sine := vector.length()
	var angular := vector / sine * (2.0 * atan2(sine, w) / dt) if sine > 1e-9 else Vector3.ZERO
	if not _finite_vector(linear) or not _finite_vector(angular): return null
	return {"linear": linear, "angular": angular}

static func _valid_history(history: Dictionary) -> bool:
	return history.get("samples") is Array and _valid_samples(history.samples) \
		and _finite_vector(history.get("linear")) and _finite_vector(history.get("angular"))

static func _valid_samples(samples: Array) -> bool:
	for sample: Variant in samples:
		if not sample is Dictionary or not _finite(sample.get("dt")) or sample.dt <= 0.0 \
				or not _finite_vector(sample.get("linear")) or not _finite_vector(sample.get("angular")):
			return false
	return true

static func _valid_quaternion(value: Quaternion) -> bool:
	return is_finite(value.x) and is_finite(value.y) and is_finite(value.z) and is_finite(value.w) \
		and absf(value.length_squared() - 1.0) <= 0.001

static func _finite_vector(value: Variant) -> bool:
	return value is Vector3 and is_finite(value.x) and is_finite(value.y) and is_finite(value.z)

static func _finite(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value))
