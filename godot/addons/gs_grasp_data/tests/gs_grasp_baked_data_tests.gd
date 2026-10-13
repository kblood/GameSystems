extends SceneTree
## Complete BAKED identity/structure, not bake/asset/contact validation.

const Data = preload("res://addons/gs_grasp_data/gs_grasp_baked_data.gd")
const GOLDEN_PATH := "res://addons/gs_grasp_data/data/baked_grasps.golden.json"
var passed := 0
var failed := 0

func _initialize() -> void:
	var contract: Dictionary = Data.load_data()
	var golden: Variant = JSON.parse_string(FileAccess.get_file_as_string(GOLDEN_PATH))
	check(not contract.is_empty(), "canonical bake loads")
	check(golden is Dictionary and golden.get("schema") == "gamesystems.golden.grasp-baked-data.v1", "public BAKED golden loads")
	if not contract.is_empty() and golden is Dictionary:
		check(contract == golden.get("baked"), "every source field equals complete public BAKED")
		check(contract.poses.size() == golden.pose_ids.size(), "public pose identity count")
		for i: int in range(contract.poses.size()):
			check(contract.poses[i].id == golden.pose_ids[i] and Data.validate_pose(contract.poses[i]), "public pose identity/structure %d" % i)
		for kind: String in golden.kind_counts:
			check(contract.summary[kind].accepted == golden.kind_counts[kind], "per-kind public count: %s" % kind)
		check(golden.kinds_without_catalog == ["magazine"], "asset-specific magazine kind remains valid without generic catalog")
		var mutations := [
			[["schema"], "wrong", "unknown schema"], [["source", "schema"], "wrong", "source schema"],
			[["source", "inputsDigest"], "invalid", "malformed hash"], [["source", "avatarSha256"], "g".repeat(64), "nonhex hash"],
			[["source", "operatorScale"], 0, "zero operator scale"], [["source", "avatar"], "", "empty avatar path"],
			[["source", "limits", "touch_mm"], -1, "negative source limit"],
			[["conventions", "angles"], false, "convention text type"],
			[["conventions", "rest", "left", "frameInBone"], [0, 0, 0, 2], "nonunit rest quaternion"],
			[["conventions", "rest", "right", "palm"], [0, 0], "rest palm dimensions"],
			[["summary", "mug", "accepted"], 7, "summary disagrees with pose count"],
			[["summary", "mug", "total"], 1, "accepted exceeds source total"],
			[["summary", "mug", "frameErrorMm"], INF, "infinite summary metric"],
			[["summary", "can", "fitDropped"], 1.5, "fractional drop count"],
			[["summary", "mug", "palmMidToSurfaceMm", "median"], 100, "median greater than maximum"],
			[["poses"], {}, "poses type"],
		]
		for mutation: Array in mutations:
			var invalid := contract.duplicate(true)
			var parent: Dictionary = invalid
			var path: Array = mutation[0]
			for i: int in range(path.size() - 1):
				parent = parent[path[i]]
			parent[path[-1]] = mutation[1]
			check(not Data.validate(invalid), "rejects %s" % mutation[2])
		var pose_cases := [
			["id", ""], ["kind", 1], ["mode", "unknown"], ["side", "middle"], ["default", 1],
			["wrist", [0, NAN, 0]], ["quat", [0, 0, 0, 0]], ["palm", [0, 0]],
			["angles", []], ["open", []], ["metrics", {}], ["fit", false],
		]
		for mutation: Array in pose_cases:
			var invalid: Dictionary = contract.poses[0].duplicate(true)
			invalid[mutation[0]] = mutation[1]
			check(not Data.validate_pose(invalid), "invalid pose %s" % mutation[0])
		var duplicate := contract.duplicate(true)
		duplicate.poses[1].id = duplicate.poses[0].id
		check(not Data.validate(duplicate), "duplicate pose id rejected")
		var missing := contract.duplicate(true)
		missing.summary.erase("magazine")
		check(not Data.validate(missing), "each pose kind needs summary, not catalog entry")
		var extra := contract.duplicate(true)
		extra.poses[0]["unexpected"] = true
		check(not Data.validate(extra), "unknown pose field rejected")
		var raw: Dictionary = contract.poses[0].duplicate(true)
		raw.angles[0][1] = 100
		raw.metrics.palmGapMm = 1000
		check(Data.validate_pose(raw), "raw out-of-range angle/sentinel metric accepted structurally")
		raw.angles[1].append(0)
		check(not Data.validate_pose(raw), "non-thumb fifth row component rejected")
		var metadata_only := contract.duplicate(true)
		metadata_only.source.avatar = "res://not-present.glb"
		metadata_only.source.avatarSha256 = "0".repeat(64)
		check(Data.validate(metadata_only), "asset paths/hashes are structural provenance, not existence proof")
	print("GS_GRASP_BAKED_DATA passed=%d failed=%d" % [passed, failed])
	quit(1 if failed else 0)

func check(condition: bool, label: String) -> void:
	if condition:
		passed += 1
	else:
		failed += 1
		print("FAIL ", label)
