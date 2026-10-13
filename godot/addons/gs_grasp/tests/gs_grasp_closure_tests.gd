extends SceneTree

const Closure = preload("res://addons/gs_grasp/gs_grasp_closure.gd")
const GoldenPath := "res://addons/gs_grasp/tests/grasp_closure.golden.json"
const PlaceWristGoldenPath := "res://addons/gs_grasp/tests/grasp_place_wrist.golden.json"
var passed := 0
var failed := 0

func check(ok: bool, label: String) -> void:
	if ok:
		passed += 1
	else:
		failed += 1
		push_error(label)

func compare(expected: Variant, actual: Variant, label: String) -> void:
	if expected is Dictionary:
		check(actual is Dictionary and actual.size() == expected.size(), label + " dictionary shape")
		if not actual is Dictionary:
			return
		for key: Variant in expected:
			check(actual.has(key), label + " missing " + str(key))
			if actual.has(key):
				compare(expected[key], actual[key], label + "." + str(key))
	elif expected is Array:
		check(actual is Array and actual.size() == expected.size(), label + " shape")
		if not actual is Array:
			return
		for index: int in range(mini(expected.size(), actual.size())):
			compare(expected[index], actual[index], label + "[%d]" % index)
	elif expected is float or expected is int:
		check((actual is float or actual is int) and absf(float(actual) - float(expected)) <= 1e-10 * maxf(1.0, absf(float(expected))), label + " numeric")
	else:
		check(expected == actual, label + " value")

func _initialize() -> void:
	var golden: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(GoldenPath))
	check(golden.get("schema") == "gamesystems.golden.grasp-finger-chain.v1", "golden schema")
	for row: Dictionary in golden.cases:
		var finger_before: Dictionary = row.finger.duplicate(true)
		var angles_before: Array = row.row.duplicate(true)
		compare(row.expected, Closure.finger_chain(row.finger, row.row), row.name)
		check(row.finger == finger_before, row.name + " finger model unchanged")
		check(row.row == angles_before, row.name + " row unchanged")
	var wrist_golden: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(PlaceWristGoldenPath))
	check(wrist_golden.get("schema") == "gamesystems.golden.grasp-place-wrist.v1", "place wrist golden schema")
	for row: Dictionary in wrist_golden.cases:
		var pose_before: Dictionary = row.pose.duplicate(true)
		compare(row.expected, Closure.place_wrist(row.pose, row.hand, row.reference), row.name)
		check(row.pose == pose_before, row.name + " pose unchanged")
	print("GS_GRASP_CLOSURE_TESTS passed=%d failed=%d cases=%d finger_chain=%d place_wrist=%d" % [passed, failed,
		golden.cases.size() + wrist_golden.cases.size(), golden.cases.size(), wrist_golden.cases.size()])
	quit(1 if failed else 0)
