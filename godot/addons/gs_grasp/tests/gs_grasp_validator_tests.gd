extends SceneTree

const Validator = preload("res://addons/gs_grasp/gs_grasp_validator.gd")
const GoldenPath := "res://addons/gs_grasp/tests/grasp_validator.golden.json"
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
	elif expected is float or expected is int:
		check((actual is float or actual is int) and absf(float(actual) - float(expected)) <= 1e-9 * maxf(1.0, absf(float(expected))), label + " numeric value")
	else:
		check(expected == actual, label + " value")

func _initialize() -> void:
	var golden: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(GoldenPath))
	check(golden.get("schema") == "gamesystems.golden.grasp-validator-rows.v1", "golden schema")
	for row: Dictionary in golden.cases:
		var actual: Variant = Validator.validate_rows(row.input)
		check(actual is Dictionary, row.name + " result dictionary")
		if actual is Dictionary: compare(row.expected, actual, row.name)
	var invalid_data := {"schema": "invalid"}
	check(Validator.validate_rows({}, invalid_data) == null, "invalid config fails closed")
	var non_dict: Variant = Validator.validate_rows(12)
	check(non_dict is Dictionary and not non_dict.ok and non_dict.hard.size() == 5, "non-dictionary rows report five missing fingers")
	var inf_rows := {"Thumb": [0.0, 0.0, 0.0, 0.0], "Index": [0.0, INF, 0.0, 0.0]}
	var inf_result: Dictionary = Validator.validate_rows(inf_rows)
	var index_missing := false
	for issue: Dictionary in inf_result.hard:
		if issue.get("finger") == "Index" and issue.get("rule") == "missing": index_missing = true
	check(index_missing, "INF row is treated as a missing finger")
	print("GS_GRASP_VALIDATOR_TESTS passed=%d failed=%d cases=%d" % [passed, failed, golden.cases.size()])
	quit(1 if failed else 0)
