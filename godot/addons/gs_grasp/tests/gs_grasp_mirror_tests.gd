extends SceneTree

const Mirror = preload("res://addons/gs_grasp/gs_grasp_mirror.gd")
const GoldenPath := "res://addons/gs_grasp/tests/grasp_mirror.golden.json"
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
		check((actual is float or actual is int) and absf(float(actual) - float(expected)) <= 1e-12, label + " numeric value")
	else:
		check(expected == actual, label + " value")

func _initialize() -> void:
	var golden: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(GoldenPath))
	check(golden.get("schema") == "gamesystems.golden.grasp-mirror.v1", "golden schema")
	for row: Dictionary in golden.cases:
		var original: Dictionary = row.input.duplicate(true)
		var mirrored: Dictionary = Mirror.mirror_pose(row.input)
		compare(row.expected, mirrored, row.name)
		check(row.input == original, row.name + " input unchanged")
	var copy_case: Dictionary = golden.cases[0].input.duplicate(true)
	var copy_result: Dictionary = Mirror.mirror_pose(copy_case)
	copy_result.angles[0][0] = 99
	check(copy_case.angles[0][0] != 99, "angle rows are copied")
	copy_result.open[0][0] = 88
	check(copy_case.open[0][0] != 88, "open rows are copied")
	copy_result.palm[2] = 77
	check(copy_case.palm[2] != 77, "palm array is copied")
	copy_result.unknownMetadata.nested[0] = "shared"
	check(copy_case.unknownMetadata.nested[0] == "shared", "unrelated metadata stays shallow-shared")
	var signed_zero_case: Dictionary = golden.cases[0].input.duplicate(true)
	signed_zero_case.wrist[2] = 0.0
	signed_zero_case.palm[2] = 0.0
	signed_zero_case.quat = [0.0, 0.0, 0.0, 1.0]
	var signed_zero_result: Dictionary = Mirror.mirror_pose(signed_zero_case)
	var negative_one := -1.0
	var positive_zero := 0.0
	var negative_zero := negative_one * positive_zero
	check(_float_bits(negative_zero) != _float_bits(positive_zero), "float bits distinguish signed zero")
	check(_float_bits(float(signed_zero_result.wrist[2])) == _float_bits(0.0), "wrist zero is positive after 0-z")
	check(_float_bits(float(signed_zero_result.palm[2])) == _float_bits(negative_zero), "palm zero retains unary-negation sign")
	for component: Variant in signed_zero_result.quat:
		if float(component) == 0.0:
			check(_float_bits(float(component)) == _float_bits(0.0), "quaternion zero is positive after +0")
	print("GS_GRASP_MIRROR_TESTS passed=%d failed=%d cases=%d" % [passed, failed, golden.cases.size()])
	quit(1 if failed else 0)

func _float_bits(value: float) -> PackedByteArray:
	return PackedFloat64Array([value]).to_byte_array()
