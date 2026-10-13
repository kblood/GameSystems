class_name GSGraspVariants
extends RefCounted
## Stateless selection planner for baked/recorded grasp variants.

const Merge = preload("res://addons/gs_grasp/gs_grasp_merge.gd")

static func parse_selection(selection: Variant = "baked") -> Variant:
	if selection == null:
		return "baked"
	if selection is String:
		if selection.is_empty() or selection == "baked" or selection == "off":
			return "baked"
		if selection == "recorded" or selection == "all":
			return "recorded"
		var ids: Array[String] = []
		for part: String in selection.split(","):
			var id := part.strip_edges()
			if not id.is_empty():
				ids.append(id)
		return ids if not ids.is_empty() else "baked"
	if selection is Array:
		var ids: Array[String] = []
		for value: Variant in selection:
			if not value is String:
				return null
			var id: String = value.strip_edges()
			if not id.is_empty():
				ids.append(id)
		return ids if not ids.is_empty() else "baked"
	return null

static func select_variants(baked: Array, recorded: Array, selection: Variant = "baked") -> Variant:
	var parsed: Variant = parse_selection(selection)
	if parsed == null or not _valid_library(baked) or not _valid_library(recorded):
		return null
	var chosen: Array = []
	var unknown: Array[String] = []
	if parsed is String and parsed == "recorded":
		chosen = recorded
	elif parsed is Array:
		for id: String in parsed:
			var found := false
			for pose: Dictionary in recorded:
				if pose.id == id:
					found = true
					break
			if not found:
				unknown.append(id)
		for pose: Dictionary in recorded:
			if parsed.has(pose.id):
				var selected: Dictionary = pose.duplicate(false)
				selected["default"] = true
				chosen.append(selected)
	var poses: Variant = baked if chosen.is_empty() else Merge.merge_poses(baked, chosen)
	if not poses is Array:
		return null
	var ids: Array[String] = []
	for pose: Dictionary in chosen:
		ids.append(pose.id)
	return {"selection": parsed, "poses": poses, "ids": ids, "unknown": unknown, "uses_baked": chosen.is_empty()}

static func _valid_library(poses: Array) -> bool:
	return Merge.merge_poses(poses, []) is Array
