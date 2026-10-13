class_name GSGraspMerge
extends RefCounted
## Pure mergePoses port. See README.md for identity and malformed-input contracts.

static func merge_poses(baked: Array, recorded: Array) -> Variant:
	for collection: Array in [baked, recorded]:
		for pose: Variant in collection:
			if not _valid(pose):
				return null
	if recorded.is_empty():
		return baked
	var defaults := {}
	for pose: Dictionary in recorded:
		if pose.get("default", false):
			defaults[_key(pose)] = true
	var ids := {}
	var out := []
	for pose: Dictionary in baked:
		ids[pose.id] = true
		out.append(_undefault(pose) if pose.get("default", false) and defaults.has(_key(pose)) else pose)
	# JS deliberately uses one Set for IDs and default:key markers. Preserve even
	# collisions between those namespaces, as well as slash-concatenated keys.
	var seen := {}
	for pose: Dictionary in recorded:
		if ids.has(pose.id) or seen.has(pose.id):
			continue
		var marker := "default:" + _key(pose)
		var is_default: bool = pose.get("default", false) and not seen.has(marker)
		if is_default:
			seen[marker] = true
		seen[pose.id] = true
		out.append(_undefault(pose) if pose.get("default", false) and not is_default else pose)
	return out

static func _key(pose: Dictionary) -> String:
	return "%s/%s/%s" % [pose.kind, pose.side, pose.grasp]

static func _undefault(pose: Dictionary) -> Dictionary:
	var copy := pose.duplicate(false)
	copy["default"] = false
	return copy

static func _valid(pose: Variant) -> bool:
	if not pose is Dictionary:
		return false
	for key: String in ["id", "kind", "side", "grasp"]:
		if not pose.get(key) is String:
			return false
	return not pose.has("default") or pose["default"] is bool
