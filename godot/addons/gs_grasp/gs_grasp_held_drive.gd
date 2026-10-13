class_name GSGraspHeldDrive
extends RefCounted
## Stateless acceleration math and caller-owned motion samples for the grasp drive.
## This does not apply forces or replace a host physics/grab loop.

const DriveData = preload("res://addons/gs_grasp_data/gs_grasp_held_drive_data.gd")
static var _default_data: Dictionary = {}

static func acceleration_limit(mass: float, data: Dictionary = {}) -> Variant:
	var config: Variant = _config(data)
	if not config is Dictionary or not _finite(mass): return null
	return minf(float(config.MAX_ACCELERATION), float(config.MAX_HOLD_FORCE) / maxf(mass, 0.001))

static func drive_acceleration(position: Vector3, velocity: Vector3, target_position: Vector3, mass: float,
		dt: float, target_velocity: Vector3 = Vector3.ZERO, gravity: Vector3 = Vector3(0.0, -9.81, 0.0),
		data: Dictionary = {}) -> Variant:
	var config: Variant = _config(data)
	if not config is Dictionary or not _finite_vector(position) or not _finite_vector(velocity) \
			or not _finite_vector(target_position) or not _finite_vector(target_velocity) \
			or not _finite_vector(gravity) or not _finite(mass) or not _finite(dt) or dt <= 0.0:
		return null
	var stiffness := float(config.STIFFNESS)
	var damping := float(config.DAMPING)
	var denominator := 1.0 + damping * dt + stiffness * dt * dt
	var acceleration := (target_position + (target_velocity - velocity) * dt - position) * stiffness
	acceleration += (target_velocity - velocity) * damping
	acceleration = acceleration / denominator - gravity
	var cap := minf(float(config.MAX_ACCELERATION), float(config.MAX_HOLD_FORCE) / maxf(mass, 0.001))
	if not _finite_vector(acceleration) or not _finite(cap): return null
	return acceleration.limit_length(cap)

static func drive_angular(angular_error: Vector3, angular_velocity: Vector3, dt: float,
		target_spin: Vector3 = Vector3.ZERO, data: Dictionary = {}) -> Variant:
	var config: Variant = _config(data)
	if not config is Dictionary or not _finite_vector(angular_error) or not _finite_vector(angular_velocity) \
			or not _finite_vector(target_spin) or not _finite(dt) or dt <= 0.0:
		return null
	var stiffness := float(config.STIFFNESS)
	var damping := float(config.DAMPING)
	var denominator := 1.0 + damping * dt + stiffness * dt * dt
	var result := (angular_error * stiffness + (target_spin - angular_velocity) * damping) / denominator
	return result if _finite_vector(result) else null

static func create_hand_motion(data: Dictionary = {}) -> Variant:
	var config: Variant = _config(data)
	if not config is Dictionary: return null
	return {"samples": [], "linear": Vector3.ZERO, "angular": Vector3.ZERO}

## Adds a dt-weighted average sample. The supplied Dictionary remains caller-owned.
static func push_hand_motion(motion: Dictionary, linear: Vector3, angular: Vector3, dt: float,
		data: Dictionary = {}) -> Dictionary:
	var config: Variant = _config(data)
	if not config is Dictionary or not _valid_motion(motion) or not _finite_vector(linear) \
			or not _finite_vector(angular) or not _finite(dt) or dt <= 0.0:
		return motion
	var samples: Array = motion.samples.duplicate()
	samples.append({"dt": dt, "linear": linear, "angular": angular})
	var limit := int(config.HAND_MOTION_SAMPLES)
	while samples.size() > limit: samples.pop_front()
	var total := 0.0
	var linear_sum := Vector3.ZERO
	var angular_sum := Vector3.ZERO
	for sample: Dictionary in samples:
		total += float(sample.dt)
		linear_sum += sample.linear * float(sample.dt)
		angular_sum += sample.angular * float(sample.dt)
	if total <= 0.0 or not _finite(total) or not _finite_vector(linear_sum) or not _finite_vector(angular_sum): return motion
	var average_linear := linear_sum / total
	var average_angular := angular_sum / total
	if not _finite_vector(average_linear) or not _finite_vector(average_angular): return motion
	motion.samples = samples
	motion.linear = average_linear
	motion.angular = average_angular
	return motion

static func carried_velocity(linear: Vector3, angular: Vector3, pivot: Vector3, point: Vector3) -> Variant:
	if not _finite_vector(linear) or not _finite_vector(angular) or not _finite_vector(pivot) or not _finite_vector(point):
		return null
	var result := linear + angular.cross(point - pivot)
	return result if _finite_vector(result) else null

static func _config(data: Dictionary) -> Variant:
	if not data.is_empty():
		return data if DriveData.validate(data) else null
	if _default_data.is_empty():
		_default_data = DriveData.load_data()
	return _default_data if DriveData.validate(_default_data) else null

static func _valid_motion(motion: Dictionary) -> bool:
	if not motion.get("samples") is Array or not _finite_vector(motion.get("linear")) \
			or not _finite_vector(motion.get("angular")):
		return false
	for sample: Variant in motion.samples:
		if not sample is Dictionary or not _finite(sample.get("dt")) or sample.dt <= 0.0 \
				or not _finite_vector(sample.get("linear")) or not _finite_vector(sample.get("angular")):
			return false
	return true

static func _finite_vector(value: Variant) -> bool:
	return value is Vector3 and is_finite(value.x) and is_finite(value.y) and is_finite(value.z)

static func _finite(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value))
