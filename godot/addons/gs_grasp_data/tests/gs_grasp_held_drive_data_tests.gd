extends SceneTree
## Shared scalar-data contract; no claim of Godot held-drive algorithm parity.

const Data = preload("res://addons/gs_grasp_data/gs_grasp_held_drive_data.gd")
const GOLDEN_PATH := "res://addons/gs_grasp_data/data/held_drive.golden.json"
var passed := 0
var failed := 0

func _initialize() -> void:
	var contract: Dictionary = Data.load_data()
	var golden: Variant = JSON.parse_string(FileAccess.get_file_as_string(GOLDEN_PATH))
	check(not contract.is_empty(), "shared held-drive data loads")
	check(golden is Dictionary and golden.get("schema") == "gamesystems.golden.grasp-held-drive-data.v1", "JS export golden loads")
	if not contract.is_empty() and golden is Dictionary:
		check(contract == golden.get("contract"), "Godot reads exactly the JS public tuning")
		check(Data.validate(golden.get("contract")), "JS export golden validates")
		for invalid: Variant in [null, [], 2, "data", {}, {"schema": Data.SCHEMA}]:
			check(not Data.validate(invalid), "invalid root rejected: %s" % str(invalid))
		var unknown_schema := contract.duplicate(true)
		unknown_schema.schema = "gamesystems.grasp-held-drive-data.v2"
		check(not Data.validate(unknown_schema), "unknown schema rejected")
		for key: String in Data.NONNEGATIVE_KEYS:
			var missing := contract.duplicate(true)
			missing.erase(key)
			check(not Data.validate(missing), "missing %s rejected" % key)
			for value: Variant in [-1, "1", true, NAN, INF]:
				var invalid := contract.duplicate(true)
				invalid[key] = value
				check(not Data.validate(invalid), "invalid %s rejected: %s" % [key, str(value)])
			var zero := contract.duplicate(true)
			zero[key] = 0
			check(Data.validate(zero), "zero %s permits disabled tuning" % key)
		var missing_samples := contract.duplicate(true)
		missing_samples.erase("HAND_MOTION_SAMPLES")
		check(not Data.validate(missing_samples), "missing sample count rejected")
		for value: Variant in [0, -1, 1.5, "2", false, NAN, INF]:
			var invalid := contract.duplicate(true)
			invalid.HAND_MOTION_SAMPLES = value
			check(not Data.validate(invalid), "invalid sample count rejected: %s" % str(value))
		var one_sample := contract.duplicate(true)
		one_sample.HAND_MOTION_SAMPLES = 1
		check(Data.validate(one_sample), "one sample is valid")
	print("GS_GRASP_HELD_DRIVE_DATA passed=%d failed=%d" % [passed, failed])
	quit(1 if failed else 0)

func check(condition: bool, label: String) -> void:
	if condition:
		passed += 1
	else:
		failed += 1
		print("FAIL ", label)
