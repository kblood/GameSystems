class_name GSGraspQualityData
extends RefCounted
## G3 symbolic quality-policy data, not a quality selection or closure implementation.
## Lists contain names, not numeric performance budgets or physical units.

const DATA_PATH := "res://addons/gs_grasp_data/data/quality.data.json"
const SCHEMA := "gamesystems.grasp-quality-data.v1"
const LEVELS := ["raw", "low", "mid", "high"]
const FINGERS := ["Thumb", "Index", "Middle", "Ring", "Little"]

static func load_data(path: String = DATA_PATH) -> Dictionary:
	if not FileAccess.file_exists(path):
		push_error("GSGraspQualityData: data file not found: %s" % path)
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not validate(parsed):
		push_error("GSGraspQualityData: invalid quality-policy data: %s" % path)
		return {}
	return parsed

static func validate(data: Variant) -> bool:
	if not _keys(data, ["schema", "GRASP_QUALITY", "CLAMP_EXEMPT", "defaultQuality", "aliases", "exemptKeep"]) or data.schema != SCHEMA:
		return false
	# The order and names encode v1's cheapest-first semantics used by existing JS.
	if not data.GRASP_QUALITY is Array or data.GRASP_QUALITY != LEVELS:
		return false
	if not data.defaultQuality is String or not LEVELS.has(data.defaultQuality):
		return false
	if not _names(data.CLAMP_EXEMPT) or not _names(data.exemptKeep) or not data.aliases is Dictionary:
		return false
	for finger: String in data.exemptKeep:
		if not FINGERS.has(finger):
			return false
	for alias: Variant in data.aliases:
		var target: Variant = data.aliases[alias]
		if not alias is String or alias.is_empty() or LEVELS.has(alias) or not target is String or not LEVELS.has(target):
			return false
	return true

static func _names(value: Variant) -> bool:
	if not value is Array:
		return false
	var seen := {}
	for name: Variant in value:
		if not name is String or name.is_empty() or seen.has(name):
			return false
		seen[name] = true
	return true

static func _keys(value: Variant, keys: Array) -> bool:
	if not value is Dictionary or value.size() != keys.size():
		return false
	for key: String in keys:
		if not value.has(key):
			return false
	return true
