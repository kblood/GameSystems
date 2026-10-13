extends SceneTree

const Drive = preload("res://addons/gs_grasp/gs_grasp_held_drive.gd")
const GoldenPath := "res://addons/gs_grasp/tests/held_drive.golden.json"
var passed := 0
var failed := 0

func check(ok: bool, label: String) -> void:
	if ok: passed += 1
	else:
		failed += 1
		push_error(label)

func close_vector(actual: Variant, expected: Array, label: String, tolerance: float = 0.00002) -> void:
	check(actual is Vector3, label + " is Vector3")
	if actual is Vector3:
		check(actual.distance_to(Vector3(expected[0], expected[1], expected[2])) <= tolerance, label + " value")

func _initialize() -> void:
	var golden: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(GoldenPath))
	check(golden.get("schema") == "gamesystems.golden.grasp-held-drive-math.v1", "golden schema")
	for row: Dictionary in golden.limits:
		check(is_equal_approx(float(Drive.acceleration_limit(float(row.mass))), float(row.expected)), "acceleration limit mass %s" % row.mass)
	for row: Dictionary in golden.linear:
		var input: Dictionary = row.input
		var actual: Variant = Drive.drive_acceleration(Vector3(input.position[0], input.position[1], input.position[2]),
			Vector3(input.velocity[0], input.velocity[1], input.velocity[2]),
			Vector3(input.targetPosition[0], input.targetPosition[1], input.targetPosition[2]), float(input.mass), float(input.dt),
			Vector3(input.get("targetVelocity", [0.0, 0.0, 0.0])[0], input.get("targetVelocity", [0.0, 0.0, 0.0])[1], input.get("targetVelocity", [0.0, 0.0, 0.0])[2]),
			Vector3(input.get("gravity", [0.0, -9.81, 0.0])[0], input.get("gravity", [0.0, -9.81, 0.0])[1], input.get("gravity", [0.0, -9.81, 0.0])[2]))
		close_vector(actual, row.expected, "linear " + row.name)
	for row: Dictionary in golden.angular:
		var input: Dictionary = row.input
		var target: Array = input.get("targetSpin", [0.0, 0.0, 0.0])
		var actual: Variant = Drive.drive_angular(Vector3(input.angularError[0], input.angularError[1], input.angularError[2]),
			Vector3(input.angularVelocity[0], input.angularVelocity[1], input.angularVelocity[2]), float(input.dt),
			Vector3(target[0], target[1], target[2]))
		close_vector(actual, row.expected, "angular " + row.name)
	var motion: Dictionary = Drive.create_hand_motion()
	check(motion is Dictionary and motion.samples.is_empty(), "create empty motion")
	for index: int in range(golden.pushes.size()):
		var sample: Dictionary = golden.pushes[index]
		var returned: Dictionary = Drive.push_hand_motion(motion, Vector3(sample.linear[0], sample.linear[1], sample.linear[2]),
			Vector3(sample.angular[0], sample.angular[1], sample.angular[2]), float(sample.dt))
		var expected: Dictionary = golden.motion_steps[index]
		check(returned == motion, "push returns caller-owned dictionary")
		check(motion.samples.size() == expected.samples, "sample window size %d" % index)
		close_vector(motion.linear, expected.linear, "weighted linear average %d" % index)
		close_vector(motion.angular, expected.angular, "weighted angular average %d" % index)
	var before: Dictionary = motion.duplicate(true)
	check(Drive.push_hand_motion(motion, Vector3(INF, 0, 0), Vector3.ZERO, 0.02) == motion, "invalid sample is ignored")
	check(motion == before, "invalid sample leaves motion unchanged")
	var overflow_motion := {"samples": [{"dt": 1e308, "linear": Vector3.ZERO, "angular": Vector3.ZERO}], "linear": Vector3.ZERO, "angular": Vector3.ZERO}
	var overflow_before: Dictionary = overflow_motion.duplicate(true)
	Drive.push_hand_motion(overflow_motion, Vector3.ZERO, Vector3.ZERO, 1e308)
	check(overflow_motion == overflow_before, "overflowing average leaves motion unchanged")
	var carried: Dictionary = golden.carried
	close_vector(Drive.carried_velocity(Vector3(carried.linear[0], carried.linear[1], carried.linear[2]),
		Vector3(carried.angular[0], carried.angular[1], carried.angular[2]), Vector3(carried.pivot[0], carried.pivot[1], carried.pivot[2]),
		Vector3(carried.point[0], carried.point[1], carried.point[2])), carried.expected, "carried point velocity")
	check(Drive.drive_acceleration(Vector3.ZERO, Vector3.ZERO, Vector3.ZERO, 1.0, 0.0) == null, "zero dt fails closed")
	check(Drive.drive_angular(Vector3.ZERO, Vector3.ZERO, -0.01) == null, "negative dt fails closed")
	check(Drive.drive_acceleration(Vector3.ZERO, Vector3.ZERO, Vector3.ZERO, 1.0, 0.01, Vector3.ZERO, Vector3.ZERO, {"schema": "bad"}) == null, "invalid tuning fails closed")
	print("GS_GRASP_HELD_DRIVE_TESTS passed=%d failed=%d" % [passed, failed])
	quit(1 if failed else 0)
