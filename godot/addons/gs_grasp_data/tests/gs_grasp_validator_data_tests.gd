extends SceneTree
## Data equality and malformed-input checks only; this does not test G4 grasp algorithms.

const Data = preload("res://addons/gs_grasp_data/gs_grasp_validator_data.gd")
const GOLDEN_PATH := "res://addons/gs_grasp_data/data/validator.golden.json"
var passed := 0
var failed := 0

func _initialize() -> void:
	var contract: Dictionary = Data.load_data()
	var golden: Variant = JSON.parse_string(FileAccess.get_file_as_string(GOLDEN_PATH))
	check(not contract.is_empty(), "shared validator data loads")
	check(golden is Dictionary and golden.get("schema") == "gamesystems.golden.grasp-validator-data.v1", "JS export golden loads")
	if not contract.is_empty() and golden is Dictionary:
		check(contract == golden.get("contract"), "Godot reads exactly the JS public constants")
		check(Data.validate(golden.get("contract")), "JS export golden satisfies the data contract")
		for invalid: Variant in [null, [], 2, "data", {}, {"schema": Data.SCHEMA}]:
			check(not Data.validate(invalid), "invalid root rejected: %s" % str(invalid))
		var cases := [
			[["schema"], "gamesystems.grasp-validator-data.v2", "unknown schema"],
			[["HARD"], [], "hard map type"],
			[["COMFORT"], null, "comfort map type"],
			[["GATES"], [], "gates map type"],
			[["HARD", "Thumb", "twist"], [-45], "range size"],
			[["HARD", "Index", "pitch"], [30, -30], "inverted range"],
			[["HARD", "Index", "pitch"], [false, 30], "boolean angle"],
			[["HARD", "Index", "pitch"], [NAN, 30], "NaN angle"],
			[["HARD", "Index", "pitch"], [-25, INF], "infinite angle"],
			[["COMFORT", "Thumb", "centre"], [0, 0, 0], "centre size"],
			[["COMFORT", "Thumb", "centre"], [0, 200, 0, 0], "centre outside hard range"],
			[["COMFORT", "Index", "width"], [15, 0, 55, 45], "zero width"],
			[["COMFORT", "Index", "width"], [15, -1, 55, 45], "negative width"],
			[["COMFORT", "Index", "width"], [15, "45", 55, 45], "string width"],
			[["GATES", "wristErrorMm"], -1, "negative distance gate"],
			[["GATES", "penetrationMm"], INF, "infinite gate"],
			[["GATES", "palmGapMinMm"], 7, "inverted palm gap"],
			[["GATES", "minFingersTouching"], 3.5, "fractional finger count"],
			[["GATES", "minFingersTouching"], 6, "finger count over five"],
			[["GATES", "minFingersTouching"], -1, "negative finger count"],
			[["GATES", "minOppositionDeg"], 181, "opposition over 180"],
			[["GATES", "minOppositionDeg"], -1, "negative opposition"],
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
		missing.HARD.Thumb.erase("twist")
		check(not Data.validate(missing), "missing thumb twist rejected")
		var extra := contract.duplicate(true)
		extra.HARD.Index["twist"] = [-45, 45]
		check(not Data.validate(extra), "non-thumb twist rejected")
		var missing_gate := contract.duplicate(true)
		missing_gate.GATES.erase("tipTouchMm")
		check(not Data.validate(missing_gate), "missing gate rejected")
	print("GS_GRASP_DATA passed=%d failed=%d" % [passed, failed])
	quit(1 if failed else 0)

func check(condition: bool, label: String) -> void:
	if condition:
		passed += 1
	else:
		failed += 1
		print("FAIL ", label)
