extends SceneTree

const Selector = preload("res://addons/gs_grasp/gs_nearest_grasp.gd")
const Baked = preload("res://addons/gs_grasp_data/gs_grasp_baked_data.gd")
const GOLDEN := "res://addons/gs_grasp/tests/nearest_grasp.golden.json"
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
	var baked: Dictionary = Baked.load_data()
	check(not baked.is_empty(), "baked input validated")
	check(golden.schema == "gamesystems.golden.nearest-grasp.v1", "golden schema")
	check(Selector.ANGLE_WEIGHT == golden.constants.ANGLE_WEIGHT and Selector.HYSTERESIS == golden.constants.HYSTERESIS, "JS constants")
	for row: Dictionary in golden.cases:
		var poses: Array = baked.poses if row.library == "baked" else row.poses
		var before: Array = poses.duplicate(true)
		var options: Dictionary = row.options.duplicate(true)
		var calls: Array = []
		if row.allowed != null:
			options.filter = func(p: Dictionary) -> bool:
				calls.append(p.id)
				return row.allowed.has(p.id)
		var result: Variant = Selector.nearest_pose(poses, row.kind, row.side, row.local, options)
		if row.expected == null:
			check(result == null, row.name + " empty")
		else:
			check(result != null, row.name + " result")
			if result != null:
				check(is_same(result.pose, poses[int(row.expected.index)]) and result.pose.id == row.expected.id, row.name + " original pose identity")
				for key: String in ["distance", "angle", "cost"]:
					check(absf(result[key] - row.expected[key]) <= 1e-10, row.name + " " + key)
		check(calls == row.filter_calls, row.name + " predicate order")
		check(poses == before, row.name + " inputs unchanged")
	malformed_cases()
	print("GS_NEAREST_GRASP_TESTS passed=%d failed=%d cases=%d" % [passed, failed, golden.cases.size()])
	quit(1 if failed else 0)

func malformed_cases() -> void:
	var pose := {"id": "a", "kind": "test", "side": "left", "grasp": "body", "wrist": [0, 0, 0], "quat": [0, 0, 0, 1]}
	var local := {"pos": [0, 0, 0], "quat": [0, 0, 0, 1]}
	for invalid: Dictionary in [{}, {"pos": [0, 0], "quat": [0, 0, 0, 1]}, {"pos": [NAN, 0, 0], "quat": [0, 0, 0, 1]},
		{"pos": [0, 0, 0], "quat": [0, 0, 0, 0]}, {"pos": [0, 0, 0], "quat": [0, 0, 0, 2]},
		{"pos": [true, 0, 0], "quat": [0, 0, 0, 1]}]:
		check(Selector.nearest_pose([pose], "test", "left", invalid) == null, "invalid query fails closed")
	for invalid: Variant in [null, {}, {"id": 4}, {"wrist": [INF, 0, 0]}, {"quat": [0, 0, 0]}]:
		var candidate: Variant = pose.duplicate(true) if invalid is Dictionary else invalid
		if invalid is Dictionary:
			candidate.merge(invalid, true)
			if invalid.is_empty():
				candidate.erase("grasp")
		var calls: Array = []
		var options := {"filter": func(_p: Dictionary) -> bool: calls.append(true); return true}
		check(Selector.nearest_pose([pose, candidate], "test", "left", local, options) == null and calls.is_empty(), "invalid library fails before callbacks")
	for options: Dictionary in [{"previousId": 7}, {"grasp": true}, {"filter": "not callable"}, {"filter": Callable()}]:
		check(Selector.nearest_pose([pose], "test", "left", local, options) == null, "invalid options fail closed")
	var first: Variant = Selector.nearest_pose([pose], "test", "left", local)
	check(first != null and first.cost == 0.0, "no state leaks from previous calls")
