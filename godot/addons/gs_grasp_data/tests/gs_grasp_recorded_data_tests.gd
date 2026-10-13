extends SceneTree
## Strict artifact validation; JS filtered output is recorded separately.

const Data = preload("res://addons/gs_grasp_data/gs_grasp_recorded_data.gd")
const GOLDEN_PATH := "res://addons/gs_grasp_data/data/recorded_grasps.golden.json"
var passed := 0
var failed := 0

func _initialize() -> void:
	var contract: Dictionary = Data.load_data()
	var golden: Variant = JSON.parse_string(FileAccess.get_file_as_string(GOLDEN_PATH))
	check(not contract.is_empty(), "canonical recording copy validates")
	check(golden is Dictionary and golden.get("schema") == "gamesystems.golden.grasp-recorded-data.v1", "filtered JS export golden loads")
	if not contract.is_empty() and golden is Dictionary:
		check(contract == golden.get("contract"), "raw document matches canonical source")
		var accepted: Array = golden.get("accepted_indices", [])
		var rejected: Array = golden.get("rejected_indices", [])
		var records: Array = golden.get("recorded", [])
		check(accepted.size() + rejected.size() == contract.poses.size(), "filter manifest covers raw poses")
		check(rejected.is_empty(), "shipped canonical document contains no JS-filtered-out poses")
		check(records.size() == accepted.size(), "public RECORDED count agrees with accepted indices")
		for i: int in range(records.size()):
			check(records[i] == contract.poses[int(accepted[i])], "public record preserves raw order/value %d" % i)
		check(Data.validate({"schema": Data.SCHEMA, "poses": []}), "empty versioned recording library is valid")
		for invalid: Variant in [null, [], 2, {}, {"poses": []}, {"schema": "wrong", "poses": []}]:
			check(not Data.validate(invalid), "invalid root rejected: %s" % str(invalid))
		var pose: Dictionary = contract.poses[0]
		var cases := [
			[["id"], "", "empty id"], [["kind"], 1, "kind type"], [["grasp"], "", "empty grasp"],
			[["side"], "middle", "unknown side"], [["wrist"], [0, 0], "wrist size"],
			[["wrist"], [0, INF, 0], "infinite wrist"], [["quat"], [0, 0, 0, 2], "nonunit quaternion"],
			[["quat"], [0, 0, 0, 0], "zero quaternion"], [["quat"], [0, 0, NAN, 1], "NaN quaternion"],
			[["angles"], [], "missing digit rows"], [["open"], [], "missing open rows"],
			[["handLength"], 0.08, "hand length lower endpoint"], [["handLength"], 0.35, "hand length upper endpoint"],
			[["handLength"], true, "boolean hand length"], [["default"], 1, "default type"],
			[["mode"], 1, "mode type"], [["recorded"], [], "metadata type"],
			[["recorded", "source"], "", "missing provenance"], [["recorded", "at"], false, "timestamp type"],
			[["recorded", "frames"], 1.5, "fractional frame count"], [["recorded", "frames"], -1, "negative frame count"],
			[["recorded", "score"], INF, "infinite score"], [["recorded", "score"], 101, "score over 100"],
			[["recorded", "mirrored"], 1, "mirrored flag type"], [["palm"], [0, "0", 0], "palm type"],
			[["mirroredFrom"], 1, "mirrored origin type"],
		]
		for case: Array in cases:
			var invalid := pose.duplicate(true)
			var parent: Dictionary = invalid
			var path: Array = case[0]
			for i: int in range(path.size() - 1):
				parent = parent[path[i]]
			parent[path[-1]] = case[1]
			check(not Data.validate_pose(invalid), "rejects %s" % case[2])
		var non_thumb_twist := pose.duplicate(true)
		non_thumb_twist.angles[1].append(0)
		check(not Data.validate_pose(non_thumb_twist), "fifth component only permitted for thumb")
		var bad_component := pose.duplicate(true)
		bad_component.open[2][0] = false
		check(not Data.validate_pose(bad_component), "boolean angle rejected")
		var four_thumb := pose.duplicate(true)
		four_thumb.angles[0].resize(4)
		check(Data.validate_pose(four_thumb), "four-component thumb supported")
		var outside_anatomy := pose.duplicate(true)
		outside_anatomy.angles[0][4] = -60
		check(Data.validate_pose(outside_anatomy), "structural contract does not clamp anatomical limits")
		var minimal := pose.duplicate(true)
		for key: String in ["mode", "default", "handLength", "recorded"]:
			minimal.erase(key)
		check(Data.validate_pose(minimal), "optional pose metadata may be absent")
		for path: Array in [[], ["recorded"]]:
			var extra := pose.duplicate(true)
			var parent: Dictionary = extra
			for key: String in path:
				parent = parent[key]
			parent["unexpected"] = 1
			check(not Data.validate_pose(extra), "unknown pose/metadata fields rejected")
		var bad_doc := contract.duplicate(true)
		bad_doc.poses.append({"id": "invalid"})
		check(not Data.validate(bad_doc), "strict reader rejects whole document instead of filtering")
		var extra_doc := contract.duplicate(true)
		extra_doc["unexpected"] = true
		check(not Data.validate(extra_doc), "unknown document field rejected")
	print("GS_GRASP_RECORDED_DATA passed=%d failed=%d" % [passed, failed])
	quit(1 if failed else 0)

func check(condition: bool, label: String) -> void:
	if condition:
		passed += 1
	else:
		failed += 1
		print("FAIL ", label)
