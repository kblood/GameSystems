extends SceneTree

const RecordedPoses = preload("res://addons/gs_grasp/gs_grasp_recorded_poses.gd")
const GoldenPath := "res://addons/gs_grasp/tests/grasp_recorded_poses.golden.json"
var passed := 0
var failed := 0

func check(ok: bool, label: String) -> void:
	if ok: passed += 1
	else:
		failed += 1
		push_error(label)

func _initialize() -> void:
	var golden: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(GoldenPath))
	check(golden.get("schema") == "gamesystems.golden.grasp-recorded-poses.v1", "golden schema")
	for row: Dictionary in golden.cases:
		var result: Array = RecordedPoses.recorded_poses(row.input)
		var actual_ids: Array[String] = []
		for pose: Dictionary in result:
			actual_ids.append(pose.id)
		check(actual_ids == row.accepted, row.name + " accepted pose order")
		if row.input is Dictionary and row.input.get("poses") is Array:
			var actual_indices: Array = []
			for index: int in range(row.input.poses.size()):
				if RecordedPoses.is_pose(row.input.poses[index]): actual_indices.append(index)
			check(_same_indices(actual_indices, row.accepted_indices), row.name + " accepted indices")
	var infinity_pose := _valid_pose("infinity")
	infinity_pose.wrist[0] = INF
	check(not RecordedPoses.is_pose(infinity_pose), "infinite wrist rejected")
	var bool_pose := _valid_pose("boolean-angle")
	bool_pose.angles[0][1] = true
	check(not RecordedPoses.is_pose(bool_pose), "boolean is not a numeric angle")
	var string_name_side := _valid_pose("string-name-side")
	string_name_side.side = &"right"
	check(not RecordedPoses.is_pose(string_name_side), "StringName side is not a JS string")
	for key: String in ["id", "kind", "grasp"]:
		var string_name_field := _valid_pose("string-name-" + key)
		string_name_field[key] = &"value"
		check(not RecordedPoses.is_pose(string_name_field), "StringName " + key + " is not a JS string")
	var ignored_metadata_pose := _valid_pose("metadata-ignored")
	ignored_metadata_pose.recorded = 42
	check(RecordedPoses.is_pose(ignored_metadata_pose), "optional metadata is not validated")
	var nan_schema: Dictionary = {"schema": NAN, "poses": [_valid_pose("nan-schema")]}
	check(RecordedPoses.recorded_poses(nan_schema).size() == 1, "NaN schema is falsy in JS")
	var inf_schema: Dictionary = {"schema": INF, "poses": [_valid_pose("inf-schema")]}
	check(RecordedPoses.recorded_poses(inf_schema).is_empty(), "infinite schema is truthy in JS")
	print("GS_GRASP_RECORDED_POSES_TESTS passed=%d failed=%d cases=%d" % [passed, failed, golden.cases.size()])
	quit(1 if failed else 0)

func _valid_pose(identifier: String) -> Dictionary:
	var rows: Array = []
	for _index: int in range(5): rows.append([0.0, 0.0, 0.0, 0.0])
	return {"id": identifier, "kind": "sample", "grasp": "body", "side": "right",
		"wrist": [0.0, 0.0, 0.0], "quat": [0.0, 0.0, 0.0, 1.0], "angles": rows.duplicate(true), "open": rows.duplicate(true)}

func _same_indices(actual: Array, expected: Array) -> bool:
	if actual.size() != expected.size(): return false
	for index: int in range(actual.size()):
		if int(actual[index]) != int(expected[index]): return false
	return true
