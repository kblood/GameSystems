class_name GSHumanoidBoneMaps
extends RefCounted
## Loads the generated shared humanoid bone-map contract without modifying it.

const DATA_PATH := "res://addons/gs_humanoid/data/bone_maps.data.json"
const SCHEMA := "gamesystems.humanoid-bone-maps.v1"
const REQUIRED_MAPS := ["mpfb", "vrm1", "vrm0", "mixamo"]

static func load_data(path: String = DATA_PATH) -> Dictionary:
	if not FileAccess.file_exists(path):
		push_error("GSHumanoidBoneMaps: data file not found: %s" % path)
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not validate(parsed):
		push_error("GSHumanoidBoneMaps: invalid humanoid bone-map contract: %s" % path)
		return {}
	return parsed

static func validate(data: Variant) -> bool:
	if not data is Dictionary or data.get("schema") != SCHEMA:
		return false
	var root_bone: Variant = data.get("rootMotionBone")
	var joints: Variant = data.get("jointNames")
	var maps: Variant = data.get("maps")
	if not root_bone is String or root_bone.is_empty() or not joints is Array or not maps is Dictionary:
		return false
	if joints.size() != 52 or maps.size() != REQUIRED_MAPS.size():
		return false
	var joint_set := {}
	for joint: Variant in joints:
		if not joint is String or joint.is_empty() or joint_set.has(joint):
			return false
		joint_set[joint] = true
	for rig: String in REQUIRED_MAPS:
		if not maps.has(rig) or not maps[rig] is Dictionary or maps[rig].size() != joints.size():
			return false
		for joint: String in joints:
			var bone: Variant = maps[rig].get(joint)
			if not maps[rig].has(joint) or not bone is String or bone.is_empty():
				return false
	return true
