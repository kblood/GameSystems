extends SceneTree

const Merge = preload("res://addons/gs_grasp/gs_grasp_merge.gd")
const Baked = preload("res://addons/gs_grasp_data/gs_grasp_baked_data.gd")
const Recordings = preload("res://addons/gs_grasp_data/gs_grasp_recorded_data.gd")
const GOLDEN := "res://addons/gs_grasp/tests/grasp_merge.golden.json"
var passed := 0
var failed := 0

func check(ok: bool, label: String) -> void:
	if ok:
		passed += 1
	else:
		failed += 1
		push_error(label)

func _initialize() -> void:
	var golden: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(GOLDEN))
	var baked_data: Dictionary = Baked.load_data()
	var recordings_data: Dictionary = Recordings.load_data()
	check(golden.schema == "gamesystems.golden.grasp-merge.v1", "golden schema")
	check(not baked_data.is_empty() and not recordings_data.is_empty(), "G3 source contracts loaded")
	for row: Dictionary in golden.cases:
		var baked: Array = baked_data.poses if row.library == "canonical" else row.baked
		# Use the indices accepted by public JS recordedPoses, without porting its
		# filtering algorithm or assuming that every raw recording is accepted.
		var recorded: Array = row.recorded if row.library != "canonical" else row.recorded_indices.map(func(index): return recordings_data.poses[int(index)])
		var before_baked := baked.duplicate(true)
		var before_recorded := recorded.duplicate(true)
		var baked_identities := baked.duplicate(false)
		var recorded_identities := recorded.duplicate(false)
		var result: Variant = Merge.merge_poses(baked, recorded)
		check(result is Array, row.name + " result")
		if not result is Array:
			continue
		check(is_same(result, baked) == row.same_array, row.name + " array identity")
		check(result.size() == row.expected.size(), row.name + " length")
		for index: int in mini(result.size(), row.expected.size()):
			var expected: Dictionary = row.expected[index]
			var input: Dictionary = (baked if expected.source == "baked" else recorded)[int(expected.index)]
			var pose: Dictionary = result[index]
			check(is_same(pose, input) == expected.same_pose, row.name + " pose identity %d" % index)
			var expected_value: Dictionary = input.duplicate(false)
			if expected.has_default:
				expected_value["default"] = expected.default_value
			check(pose == expected_value and pose.has("default") == expected.has_default, row.name + " value/order %d" % index)
			for nested: Dictionary in expected.nested_identity:
				check(is_same(pose[nested.key], input[nested.key]) == nested.same, row.name + " shallow identity " + nested.key)
		check(baked == before_baked and recorded == before_recorded, row.name + " inputs unchanged")
		check(same_entries(baked, baked_identities), row.name + " baked input identities unchanged")
		check(same_entries(recorded, recorded_identities), row.name + " recorded input identities unchanged")
	malformed_cases()
	print("GS_GRASP_MERGE_TESTS passed=%d failed=%d cases=%d" % [passed, failed, golden.cases.size()])
	quit(1 if failed else 0)

func same_entries(actual: Array, before: Array) -> bool:
	if actual.size() != before.size():
		return false
	for index in actual.size():
		if not is_same(actual[index], before[index]):
			return false
	return true

func malformed_cases() -> void:
	var pose := {"id":"a", "kind":"cup", "side":"left", "grasp":"body", "default":true}
	for invalid: Variant in [null, false, {}, {"id":3}, {"default":1}, {"default":null}]:
		var candidate: Variant = pose.duplicate() if invalid is Dictionary else invalid
		if invalid is Dictionary:
			candidate.merge(invalid, true)
			if invalid.is_empty():
				candidate.erase("kind")
		check(Merge.merge_poses([candidate], []) == null, "invalid baked fails even for empty recorded")
		check(Merge.merge_poses([pose], [candidate]) == null, "invalid recording fails")
	# Repeated references survive without accidental deep copies.
	var same_array := [pose, pose]
	var other := {"id":"b", "kind":"other", "side":"left", "grasp":"body"}
	var merged: Array = Merge.merge_poses(same_array, [other])
	check(is_same(merged[0], pose) and is_same(merged[1], pose), "repeated baked reference retained")
