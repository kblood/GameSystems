extends SceneTree

const Clamp = preload("res://addons/gs_grasp/gs_grasp_clamp.gd")
const GoldenPath := "res://addons/gs_grasp/tests/grasp_clamp.golden.json"
var passed := 0
var failed := 0

func check(ok: bool, label: String) -> void:
	if ok:
		passed += 1
	else:
		failed += 1
		push_error(label)

func _initialize() -> void:
	var golden: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(GoldenPath))
	check(golden.schema == "gamesystems.golden.grasp-clamp.v1", "golden schema")
	for row: Dictionary in golden.cases:
		var input: Dictionary = row.input
		var before: Dictionary = input.duplicate(true)
		var result: Variant = Clamp.clamp_rows(input)
		check(result is Dictionary, row.name + " result")
		if result is Dictionary:
			for finger: String in ["Thumb", "Index", "Middle", "Ring", "Little"]:
				var actual: Array = result[finger]
				var expected: Array = row.expected[finger]
				check(actual.size() == expected.size(), row.name + " " + finger + " length")
				for index: int in mini(actual.size(), expected.size()):
					check(is_equal_approx(float(actual[index]), float(expected[index])) or absf(float(actual[index]) - float(expected[index])) <= 1e-10,
						row.name + " " + finger + "[" + str(index) + "]")
		check(input == before, row.name + " input unchanged")
	check(Clamp.clamp_rows({"Thumb": "not-a-row"}) == null, "malformed row rejected")
	var non_finite := Clamp.clamp_rows({"Thumb": [NAN, INF, true, -INF, NAN], "Index": [false, NAN, INF, -INF]})
	var config: Dictionary = preload("res://addons/gs_grasp_data/gs_grasp_validator_data.gd").load_data()
	for finger: String in ["Thumb", "Index"]:
		for index: int in 4:
			check(is_equal_approx(float(non_finite[finger][index]), float(config.COMFORT[finger].centre[index])), "nonfinite fallback %s[%d]" % [finger, index])
	check(non_finite.Thumb[4] == 0.0, "invalid twist falls back to zero")
	check(Clamp.clamp_rows({}, {"schema": "invalid"}) == null, "invalid custom validator data rejected")
	print("GS_GRASP_CLAMP_TESTS passed=%d failed=%d cases=%d" % [passed, failed, golden.cases.size()])
	quit(1 if failed else 0)
