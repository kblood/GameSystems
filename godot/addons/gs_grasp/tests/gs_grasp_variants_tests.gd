extends SceneTree

const Variants = preload("res://addons/gs_grasp/gs_grasp_variants.gd")
const BakedData = preload("res://addons/gs_grasp_data/gs_grasp_baked_data.gd")
const RecordedData = preload("res://addons/gs_grasp_data/gs_grasp_recorded_data.gd")
const GoldenPath := "res://addons/gs_grasp/tests/grasp_variants.golden.json"
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
	var baked: Array = BakedData.load_data().poses
	var recorded: Array = RecordedData.load_data().poses
	check(golden.schema == "gamesystems.golden.grasp-variants.v1", "golden schema")
	check(not baked.is_empty() and not recorded.is_empty(), "G3 variant inputs load")
	var before_baked: Array = baked.duplicate(true)
	var before_recorded: Array = recorded.duplicate(true)
	for row: Dictionary in golden.cases:
		var parsed: Variant = Variants.parse_selection(row.input)
		if row.get("invalid", false):
			check(parsed == null, row.name + " invalid parse")
			check(Variants.select_variants(baked, recorded, row.input) == null, row.name + " invalid selection")
			continue
		check(parsed == row.parsed, row.name + " parse result")
		var result: Variant = Variants.select_variants(baked, recorded, row.input)
		check(result is Dictionary, row.name + " selection result")
		if not result is Dictionary:
			continue
		check(result.selection == row.selection, row.name + " selected policy")
		check(result.ids == row.ids, row.name + " selected IDs")
		check(result.unknown == row.unknown, row.name + " unknown IDs")
		check(result.uses_baked == row.is_baked_array, row.name + " baked selection")
		check(result.poses.size() == row.poses.size(), row.name + " merged pose count")
		for index: int in mini(result.poses.size(), row.poses.size()):
			var pose: Dictionary = result.poses[index]
			var expected: Dictionary = row.poses[index]
			check(pose.id == expected.id, row.name + " pose order %d" % index)
			check(pose.has("default") == expected.has_default, row.name + " default presence %d" % index)
			check(pose.get("default") == expected.default, row.name + " default value %d" % index)
	check(baked == before_baked and recorded == before_recorded, "source arrays unchanged")
	print("GS_GRASP_VARIANTS_TESTS passed=%d failed=%d cases=%d" % [passed, failed, golden.cases.size()])
	quit(1 if failed else 0)
