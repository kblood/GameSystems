extends SceneTree

const Throw = preload("res://addons/gs_grasp/gs_grasp_throw_release.gd")
const GoldenPath := "res://addons/gs_grasp/tests/throw_release.golden.json"
var passed := 0
var failed := 0

func check(ok: bool, label: String) -> void:
	if ok: passed += 1
	else:
		failed += 1
		push_error(label)

func vector(value: Array) -> Vector3:
	return Vector3(value[0], value[1], value[2])

func close_vector(actual: Variant, expected: Array, label: String, tolerance: float = 0.00002) -> void:
	check(actual is Vector3, label + " is Vector3")
	if actual is Vector3:
		check(actual.distance_to(vector(expected)) <= tolerance, label + " value")

func _initialize() -> void:
	var golden: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(GoldenPath))
	check(golden.get("schema") == "gamesystems.golden.grasp-throw-release.v1", "golden schema")
	var constants := {"GLASS_BREAK_CONTACT_SPEED": Throw.GLASS_BREAK_CONTACT_SPEED,
		"RELEASE_SPEED_CAP": Throw.RELEASE_SPEED_CAP, "RELEASE_SPIN_CAP": Throw.RELEASE_SPIN_CAP,
		"RELEASE_WINDOW": Throw.RELEASE_WINDOW, "RELEASE_SMOOTHING": Throw.RELEASE_SMOOTHING,
		"SAMPLE_SPEED_CAP": Throw.SAMPLE_SPEED_CAP, "SAMPLE_SPIN_CAP": Throw.SAMPLE_SPIN_CAP,
		"HISTORY_SPAN": Throw.HISTORY_SPAN}
	for key: String in golden.constants:
		check(is_equal_approx(float(constants[key]), float(golden.constants[key])), "constant " + key)
	for row: Dictionary in golden.cases:
		var samples: Array = []
		for sample: Dictionary in row.samples:
			samples.append({"dt": float(sample.dt), "linear": vector(sample.linear), "angular": vector(sample.angular)})
		var actual: Variant = Throw.release_velocity(samples)
		check(actual is Dictionary, row.name + " result")
		if actual is Dictionary:
			close_vector(actual.linear, row.expected.linear, row.name + " linear")
			close_vector(actual.angular, row.expected.angular, row.name + " angular")
	var history: Dictionary = Throw.create_history()
	for index: int in range(golden.pushes.size()):
		var sample: Dictionary = golden.pushes[index]
		Throw.push_sample(history, vector(sample.linear), vector(sample.angular), float(sample.dt))
		var expected: Dictionary = golden.push_steps[index]
		check(history.samples.size() == expected.samples.size(), "history window size %d" % index)
		close_vector(history.linear, expected.linear, "history release linear %d" % index)
		close_vector(history.angular, expected.angular, "history release angular %d" % index)
		for sample_index: int in range(mini(history.samples.size(), expected.samples.size())):
			check(is_equal_approx(float(history.samples[sample_index].dt), float(expected.samples[sample_index].dt)), "history sample dt %d/%d" % [index, sample_index])
			close_vector(history.samples[sample_index].linear, expected.samples[sample_index].linear, "history sample linear %d/%d" % [index, sample_index])
			close_vector(history.samples[sample_index].angular, expected.samples[sample_index].angular, "history sample angular %d/%d" % [index, sample_index])
	for row: Dictionary in golden.pose_cases:
		var previous: Dictionary = row.previous
		var current: Dictionary = row.current
		var pose_result: Variant = Throw.sample_from_poses(vector(previous.pos), Quaternion(previous.quat[0], previous.quat[1], previous.quat[2], previous.quat[3]),
			vector(current.pos), Quaternion(current.quat[0], current.quat[1], current.quat[2], current.quat[3]), float(row.dt))
		check(pose_result is Dictionary, row.name + " result")
		if pose_result is Dictionary:
			close_vector(pose_result.linear, row.expected.linear, row.name + " linear")
			close_vector(pose_result.angular, row.expected.angular, row.name + " angular")
	var before: Dictionary = history.duplicate(true)
	Throw.push_sample(history, Vector3(INF, 0, 0), Vector3.ZERO, 1.0 / 72.0)
	check(history == before, "invalid velocity sample leaves history unchanged")
	check(Throw.push_sample(history, Vector3.ZERO, Vector3.ZERO, 0.0) == history, "invalid dt is ignored")
	check(Throw.release_velocity([{"dt": -0.1, "linear": Vector3.ZERO, "angular": Vector3.ZERO}]) == null, "malformed release history fails closed")
	check(Throw.sample_from_poses(Vector3.ZERO, Quaternion.IDENTITY, Vector3.ONE, Quaternion.IDENTITY, 0.0) == null, "pose sample zero dt fails closed")
	print("GS_GRASP_THROW_RELEASE_TESTS passed=%d failed=%d cases=%d" % [passed, failed, golden.cases.size()])
	quit(1 if failed else 0)
