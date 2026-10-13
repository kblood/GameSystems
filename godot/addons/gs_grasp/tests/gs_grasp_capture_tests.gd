extends SceneTree

const Capture = preload("res://addons/gs_grasp/gs_grasp_capture.gd")
const GoldenPath := "res://addons/gs_grasp/tests/grasp_capture.golden.json"
var passed := 0
var failed := 0

func check(ok: bool, label: String) -> void:
	if ok: passed += 1
	else:
		failed += 1
		push_error(label)

func compare(expected: Variant, actual: Variant, label: String) -> void:
	if expected is Dictionary:
		check(actual is Dictionary and actual.size() == expected.size(), label + " dictionary shape")
		if not actual is Dictionary: return
		for key: Variant in expected:
			check(actual.has(key), label + " has " + str(key))
			if actual.has(key): compare(expected[key], actual[key], label + "/" + str(key))
	elif expected is Array:
		check(actual is Array and actual.size() == expected.size(), label + " array shape")
		if not actual is Array: return
		for index: int in range(mini(expected.size(), actual.size())):
			compare(expected[index], actual[index], label + "[%d]" % index)
	elif expected == null:
		check(actual == null, label + " is null")
	elif expected is float or expected is int:
		check((actual is float or actual is int) and absf(float(actual) - float(expected)) <= 1e-10 * maxf(1.0, absf(float(expected))), label + " numeric value")
	else:
		check(expected == actual, label + " value")

func _initialize() -> void:
	var golden: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(GoldenPath))
	check(golden.get("schema") == "gamesystems.golden.grasp-capture.v1", "golden schema")
	for row: Dictionary in golden.cases:
		var joints_before: Dictionary = row.joints.duplicate(true)
		compare(row.expected_basis, Capture.hand_basis(row.side, row.joints), row.name + " basis")
		compare(row.expected_length, Capture.hand_length_from_joints(row.joints), row.name + " length")
		check(row.joints == joints_before, row.name + " joints unchanged")
	for row: Dictionary in golden.quaternion_cases:
		compare(row.expected, Capture.quat_from_basis(row.X, row.Y, row.Z), row.name + " quaternion")
	for row: Dictionary in golden.length_cases:
		compare(row.expected_length, Capture.hand_length_from_joints(row.joints), row.name + " length")
		if row.name == "small-finite-segments":
			var actual_length: float = Capture.hand_length_from_joints(row.joints)
			check(actual_length > 0.0 and absf(actual_length / float(row.expected_length) - 1.0) <= 1e-10,
				"small finite length retains relative magnitude")
	for row: Dictionary in golden.row_cases:
		var joints_before: Dictionary = row.joints.duplicate(true)
		var actual_rows: Variant = Capture.rows_from_joints(row.side, row.joints, row.hand)
		compare(row.expected_rows, actual_rows, row.name + " rows")
		if row.name.ends_with("thumb-twist-inverse"):
			check(actual_rows is Array and actual_rows[0].size() == 5 and float(actual_rows[0][4]) > 20.0,
				row.name + " preserves positive non-zero thumb twist")
		check(row.joints == joints_before, row.name + " joints unchanged")
	for row: Dictionary in golden.capture_cases:
		var joints_before: Dictionary = row.joints.duplicate(true)
		compare(row.expected_capture, Capture.capture_from_joints(row.side, row.joints, row.item, row.hand), row.name + " capture")
		check(row.joints == joints_before, row.name + " joints unchanged")
	for row: Dictionary in golden.recorded_pose_cases:
		var capture_before: Dictionary = row.capture.duplicate(true)
		compare(row.expected_pose, Capture.recorded_pose(row.capture, row.options, row.catalog), row.name + " recorded pose")
		check(row.capture == capture_before, row.name + " capture unchanged")
	var catalog_data: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://addons/gs_grasp_data/data/catalog.data.json"))
	var dynamic_pose: Dictionary = Capture.recorded_pose(golden.recorded_pose_cases[0].capture,
		{"kind": "carton", "grasp": "body"}, catalog_data)
	check(dynamic_pose.mode == "flat", "recorded pose reads the shared prop catalog")
	var custom_catalog_pose: Dictionary = Capture.recorded_pose(golden.recorded_pose_cases[0].capture,
		{"kind": "custom_prop", "grasp": "body", "at": "2026-10-13T12:34:56Z"},
		{"custom_prop": {"grip": "pinch"}})
	check(custom_catalog_pose.mode == "pinch", "recorded pose accepts an adapter-provided custom catalog")
	var timestamp_pattern := RegEx.new()
	timestamp_pattern.compile("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$")
	check(timestamp_pattern.search(dynamic_pose.recorded.at) != null, "recorded pose creates an ISO UTC timestamp")
	var generated_stamp: String = str(dynamic_pose.recorded.at).replace("-", "").replace(":", "")
	var fractional_stamp := RegEx.new()
	fractional_stamp.compile("\\.\\d+Z?$|Z$")
	generated_stamp = fractional_stamp.sub(generated_stamp, "", true)
	check(dynamic_pose.id == "carton/right/body/rec-" + generated_stamp, "generated ID uses the recorded timestamp")
	# Godot JSON parses 1e-310 as zero, so construct this finite subnormal at runtime.
	var parts := [1e-200, 1e-110]
	var tiny: float = parts[0] * parts[1]
	check(tiny > 0.0 and is_finite(tiny), "runtime subnormal is finite and nonzero")
	var tiny_joints := {"wrist": [0.0, 0.0, 0.0],
		"index-finger-phalanx-proximal": [tiny, 0.0, 0.0],
		"middle-finger-phalanx-proximal": [0.0, 0.0, tiny],
		"pinky-finger-phalanx-proximal": [-tiny, 0.0, 0.0]}
	var tiny_basis: Dictionary = Capture.hand_basis("right", tiny_joints)
	check(absf(float(tiny_basis.F[2]) - 1.0) <= 1e-10 and absf(float(tiny_basis.R[0]) - 1.0) <= 1e-10,
		"subnormal frame has unit forward and radial axes")
	print("GS_GRASP_CAPTURE_TESTS passed=%d failed=%d cases=%d quat_cases=%d length_cases=%d row_cases=%d capture_cases=%d recorded_pose_cases=%d" % [passed, failed, golden.cases.size(), golden.quaternion_cases.size(), golden.length_cases.size(), golden.row_cases.size(), golden.capture_cases.size(), golden.recorded_pose_cases.size()])
	quit(1 if failed else 0)
