extends SceneTree
## Raw structural contract and direct API correspondences, not handGeometry parity.

const Data = preload("res://addons/gs_grasp_data/gs_grasp_reference_hand_data.gd")
const GOLDEN_PATH := "res://addons/gs_grasp_data/data/reference_hand.golden.json"
var passed := 0
var failed := 0

func _initialize() -> void:
	var contract: Dictionary = Data.load_data()
	var golden: Variant = JSON.parse_string(FileAccess.get_file_as_string(GOLDEN_PATH))
	check(not contract.is_empty(), "canonical reference-hand copy loads")
	check(golden is Dictionary and golden.get("schema") == "gamesystems.golden.grasp-reference-hand.v1", "JS public-output golden loads")
	if not contract.is_empty() and golden is Dictionary:
		check(contract == golden.get("contract"), "raw fixture matches canonical source contract")
		check(Data.validate(golden.get("contract")), "golden raw fixture validates")
		var cases: Array = golden.get("cases", [])
		check(cases.size() == 6, "six public-output cases recorded")
		for case: Dictionary in cases:
			var expected: Dictionary = case.expected
			var side: String = case.side
			var scale: float = contract.scale if case.scale == null else case.scale
			check(expected.side == contract.hands[side].side and expected.scale == scale, "side/scale consumed by public API")
			for finger: String in Data.FINGERS:
				check(expected.fingers[finger].len == contract.hands[side].fingers[finger].len, "segment lengths pass through public API: %s/%s" % [side, finger])
		for invalid: Variant in [null, [], 2, "data", {}, {"schema": Data.SCHEMA}]:
			check(not Data.validate(invalid), "invalid root rejected: %s" % str(invalid))
		var mutations := [
			[["schema"], "gamesystems.reference-hand.v2", "unknown schema"],
			[["source"], "", "empty provenance"],
			[["scale"], 0, "zero scale"],
			[["scale"], INF, "infinite scale"],
			[["scale"], true, "boolean scale"],
			[["restLength"], -1, "negative rest length"],
			[["hands"], [], "hands type"],
			[["hands", "left", "side"], "right", "mismatched side"],
			[["hands", "left", "wrist"], [0, 0], "wrist dimension"],
			[["hands", "left", "wrist"], [0, NAN, 0], "NaN wrist"],
			[["hands", "left", "frame"], [], "frame type"],
			[["hands", "left", "frame", "F"], [0, 0, 0], "zero forward axis"],
			[["hands", "left", "frame", "D"], [0, 2, 0], "nonunit dorsal axis"],
			[["hands", "left", "frame", "D"], contract.hands.left.frame.F, "parallel frame axes"],
			[["hands", "left", "frame", "R"], [0.504831, -0.553459, -0.662442], "wrong frame handedness"],
			[["hands", "right", "fingers"], {}, "missing fingers"],
			[["hands", "right", "fingers", "Thumb"], [], "finger type"],
			[["hands", "right", "fingers", "Thumb", "pts"], [[0, 0, 0]], "point count"],
			[["hands", "right", "fingers", "Thumb", "len"], [1, 2], "length count"],
			[["hands", "right", "fingers", "Thumb", "len"], [0, 1, 1], "zero segment"],
			[["hands", "right", "fingers", "Thumb", "len"], [1, 1, 1], "lengths inconsistent with points"],
			[["hands", "right", "fingers", "Thumb", "len"], [INF, 1, 1], "infinite segment"],
			[["hands", "right", "fingers", "Thumb", "rest"], {}, "missing rest yaw"],
			[["hands", "right", "fingers", "Thumb", "rest", "yaw"], "0", "yaw type"],
		]
		for mutation: Array in mutations:
			var invalid := contract.duplicate(true)
			var parent: Dictionary = invalid
			var path: Array = mutation[0]
			for i: int in range(path.size() - 1):
				parent = parent[path[i]]
			parent[path[-1]] = mutation[1]
			check(not Data.validate(invalid), "rejects %s" % mutation[2])
		var missing := contract.duplicate(true)
		missing.hands.erase("right")
		check(not Data.validate(missing), "missing right hand rejected")
		var extra := contract.duplicate(true)
		extra.hands.left.fingers["Sixth"] = extra.hands.left.fingers.Thumb.duplicate(true)
		check(not Data.validate(extra), "extra finger rejected")
		for path: Array in [[], ["hands", "left"], ["hands", "left", "fingers", "Thumb"], ["hands", "left", "fingers", "Thumb", "rest"]]:
			var extra_field := contract.duplicate(true)
			var parent: Dictionary = extra_field
			for key: String in path:
				parent = parent[key]
			parent["unexpected"] = 1
			check(not Data.validate(extra_field), "unexpected field rejected at %s" % str(path))
		var rounded := contract.duplicate(true)
		rounded.hands.left.fingers.Thumb.len[0] += 0.000002
		check(Data.validate(rounded), "small export-rounding differences accepted")
	print("GS_GRASP_REFERENCE_HAND_DATA passed=%d failed=%d" % [passed, failed])
	quit(1 if failed else 0)

func check(condition: bool, label: String) -> void:
	if condition:
		passed += 1
	else:
		failed += 1
		print("FAIL ", label)
