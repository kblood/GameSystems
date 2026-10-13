extends SceneTree
## Equality with JS exports and malformed data checks, not G4/G6 algorithm parity.

const Data = preload("res://addons/gs_grasp_data/gs_grasp_closure_data.gd")
const GOLDEN_PATH := "res://addons/gs_grasp_data/data/closure.golden.json"
var passed := 0
var failed := 0

func _initialize() -> void:
	var contract: Dictionary = Data.load_data()
	var golden: Variant = JSON.parse_string(FileAccess.get_file_as_string(GOLDEN_PATH))
	check(not contract.is_empty(), "shared closure data loads")
	check(golden is Dictionary and golden.get("schema") == "gamesystems.golden.grasp-closure-data.v1", "JS export golden loads")
	if not contract.is_empty() and golden is Dictionary:
		check(contract == golden.get("contract"), "Godot reads the exact JS public defaults")
		check(Data.validate(golden.get("contract")), "JS golden validates")
		for invalid: Variant in [null, [], "data", 2, {}, {"schema": Data.SCHEMA}]:
			check(not Data.validate(invalid), "invalid root rejected: %s" % str(invalid))
		var cases := [
			[["schema"], "gamesystems.grasp-closure-data.v2", "unknown schema"],
			[["CLOSURE"], [], "closure type"],
			[["PAD_RADIUS"], [], "radii type"],
			[["REFERENCE_HAND"], [], "reference type"],
			[["THUMB_TILT"], "1", "string tilt"],
			[["THUMB_TILT"], INF, "infinite tilt"],
			[["THUMB_TILT"], true, "boolean tilt"],
			[["PAD_RADIUS", "Thumb"], [0.1, 0.1], "radius count"],
			[["PAD_RADIUS", "Index"], [0.1, -0.1, 0.1], "negative radius"],
			[["PAD_RADIUS", "Middle"], [0.1, NAN, 0.1], "NaN radius"],
			[["PAD_RADIUS", "Ring"], [0.1, false, 0.1], "boolean radius"],
			[["REFERENCE_HAND", "length"], 0, "zero length"],
			[["REFERENCE_HAND", "length"], -1, "negative length"],
			[["REFERENCE_HAND", "length"], INF, "infinite length"],
			[["REFERENCE_HAND", "palm"], [0, 0], "palm size"],
			[["REFERENCE_HAND", "palmCenter"], [0, "0", 0], "palm centre component type"],
			[["CLOSURE", "thumbSearch"], 0, "search must be boolean"],
			[["CLOSURE", "step"], 0, "zero step"],
			[["CLOSURE", "step"], -0.1, "negative step"],
			[["CLOSURE", "bisect"], 1.5, "fractional bisection count"],
			[["CLOSURE", "bisect"], -1, "negative bisection count"],
			[["CLOSURE", "opposition"], 181, "opposition over 180"],
			[["CLOSURE", "overshoot"], NAN, "NaN overshoot"],
			[["CLOSURE", "touch"], -0.1, "negative contact length"],
		]
		for case: Array in cases:
			var invalid := contract.duplicate(true)
			var parent: Dictionary = invalid
			var path: Array = case[0]
			for i: int in range(path.size() - 1):
				parent = parent[path[i]]
			parent[path[-1]] = case[1]
			check(not Data.validate(invalid), "rejects %s" % case[2])
		var missing := contract.duplicate(true)
		missing.PAD_RADIUS.erase("Little")
		check(not Data.validate(missing), "missing finger rejected")
		missing = contract.duplicate(true)
		missing.CLOSURE.erase("squeeze")
		check(not Data.validate(missing), "missing closure key rejected")
		var extra := contract.duplicate(true)
		extra.REFERENCE_HAND["extra"] = 1
		check(not Data.validate(extra), "unknown reference key rejected")
		var no_padding := contract.duplicate(true)
		no_padding.PAD_RADIUS.Thumb = [0, 0, 0]
		no_padding.CLOSURE.bisect = 0
		check(Data.validate(no_padding), "zero padding and zero bisections are valid data")
	print("GS_GRASP_CLOSURE_DATA passed=%d failed=%d" % [passed, failed])
	quit(1 if failed else 0)

func check(condition: bool, label: String) -> void:
	if condition:
		passed += 1
	else:
		failed += 1
		print("FAIL ", label)
