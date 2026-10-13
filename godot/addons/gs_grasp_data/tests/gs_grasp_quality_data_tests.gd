extends SceneTree
## Data-only quality contract; does not run a Godot quality/closure policy.

const Data = preload("res://addons/gs_grasp_data/gs_grasp_quality_data.gd")
const GOLDEN_PATH := "res://addons/gs_grasp_data/data/quality.golden.json"
var passed := 0
var failed := 0

func _initialize() -> void:
	var contract: Dictionary = Data.load_data()
	var golden: Variant = JSON.parse_string(FileAccess.get_file_as_string(GOLDEN_PATH))
	check(not contract.is_empty(), "shared quality policy loads")
	check(golden is Dictionary and golden.get("schema") == "gamesystems.golden.grasp-quality-data.v1", "JS policy golden loads")
	if not contract.is_empty() and golden is Dictionary:
		check(contract == golden.get("contract"), "copied policy equals canonical JSON")
		for key: String in ["GRASP_QUALITY", "CLAMP_EXEMPT", "defaultQuality", "aliases"]:
			check(contract[key] == golden.api[key], "policy matches observed JS API: %s" % key)
		check(golden.selections.size() == contract.GRASP_QUALITY.size(), "selection probes cover level list")
		for i: int in range(golden.selections.size()):
			check(golden.selections[i].input == contract.GRASP_QUALITY[i] and golden.selections[i].expected == contract.GRASP_QUALITY[i], "public level selection probe %d" % i)
		for invalid: Variant in [null, [], 2, {}, {"schema": Data.SCHEMA}]:
			check(not Data.validate(invalid), "invalid root rejected: %s" % str(invalid))
		var cases := [
			["schema", "gamesystems.grasp-quality-data.v2"],
			["GRASP_QUALITY", "raw,low,mid,high"], ["GRASP_QUALITY", ["raw", "low", "high", "mid"]],
			["GRASP_QUALITY", ["raw", "low", "mid", "mid"]], ["GRASP_QUALITY", ["raw", "low", "mid", "high", "ultra"]],
			["defaultQuality", "ultra"], ["defaultQuality", 2],
			["aliases", []], ["aliases", {"clamped": "missing"}], ["aliases", {"clamped": "other", "other": "low"}],
			["aliases", {"low": "high"}], ["aliases", {"": "low"}], ["aliases", {"clamped": false}],
			["CLAMP_EXEMPT", "mug"], ["CLAMP_EXEMPT", ["mug", "mug"]], ["CLAMP_EXEMPT", [""]],
			["CLAMP_EXEMPT", [false]], ["exemptKeep", ["Toe"]], ["exemptKeep", ["Thumb", "Thumb"]],
			["exemptKeep", "Thumb"],
		]
		for case: Array in cases:
			var invalid := contract.duplicate(true)
			invalid[case[0]] = case[1]
			check(not Data.validate(invalid), "rejects malformed %s: %s" % [case[0], str(case[1])])
		for key: String in contract:
			var missing := contract.duplicate(true)
			missing.erase(key)
			check(not Data.validate(missing), "missing policy field rejected: %s" % key)
		var extra := contract.duplicate(true)
		extra["unexpected"] = true
		check(not Data.validate(extra), "unknown policy field rejected")
		var disabled_exemption := contract.duplicate(true)
		disabled_exemption.CLAMP_EXEMPT = []
		disabled_exemption.exemptKeep = []
		disabled_exemption.aliases = {}
		check(Data.validate(disabled_exemption), "empty optional policy sets are structurally valid")
		var asset_specific := contract.duplicate(true)
		asset_specific.CLAMP_EXEMPT = ["custom_prop"]
		check(Data.validate(asset_specific), "exempt kinds do not require generic catalog membership")
	print("GS_GRASP_QUALITY_DATA passed=%d failed=%d" % [passed, failed])
	quit(1 if failed else 0)

func check(condition: bool, label: String) -> void:
	if condition:
		passed += 1
	else:
		failed += 1
		print("FAIL ", label)
