extends SceneTree
## Validates that Godot consumes the same generated humanoid data contract as the JS extension.

const Maps = preload("res://addons/gs_humanoid/gs_humanoid_bone_maps.gd")
const GOLDEN_PATH := "res://addons/gs_humanoid/data/bone_maps.golden.json"

var passed := 0
var failed := 0

func _initialize() -> void:
	var contract: Dictionary = Maps.load_data()
	var golden: Variant = JSON.parse_string(FileAccess.get_file_as_string(GOLDEN_PATH))
	check(not contract.is_empty(), "generated contract loads and validates")
	check(golden is Dictionary and golden.get("schema") == "gamesystems.golden.humanoid-bone-maps.v1", "cross-runtime golden loads")
	if not contract.is_empty() and golden is Dictionary:
		var expected: Variant = golden.get("contract")
		check(contract == expected, "all Godot bone maps match generated JS-data golden")
		check(Maps.validate(expected), "golden embeds a structurally valid contract")
		var malformed: Dictionary = expected.duplicate(true)
		malformed["jointNames"][1] = malformed["jointNames"][0]
		check(not Maps.validate(malformed), "duplicate canonical joint is rejected")
		malformed = expected.duplicate(true)
		malformed["maps"].erase("mixamo")
		check(not Maps.validate(malformed), "missing rig map is rejected")
		malformed = expected.duplicate(true)
		malformed["maps"]["vrm1"].erase("hips")
		check(not Maps.validate(malformed), "missing map joint is rejected")
		malformed = expected.duplicate(true)
		malformed["maps"]["vrm1"]["hips"] = ""
		check(not Maps.validate(malformed), "empty bone mapping is rejected")
		malformed = expected.duplicate(true)
		malformed["maps"]["vrm1"]["hips"] = 42
		check(not Maps.validate(malformed), "non-string bone mapping is rejected")
		check(not Maps.validate({"schema": Maps.SCHEMA, "rootMotionBone": "x", "jointNames": [], "maps": {}}), "incomplete map data is rejected")
	print("GS_HUMANOID_MAPS passed=%d failed=%d" % [passed, failed])
	quit(1 if failed else 0)

func check(condition: bool, label: String) -> void:
	if condition:
		passed += 1
	else:
		failed += 1
		print("FAIL ", label)
