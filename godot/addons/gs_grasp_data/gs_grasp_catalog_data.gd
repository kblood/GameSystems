class_name GSGraspCatalogData
extends RefCounted
## G3 data-only prop catalog reader. Shapes use item-local metres, +Y up; masses kg.
## Primitive unions are flat, matching the current JS signedDistance input format.

const DATA_PATH := "res://addons/gs_grasp_data/data/catalog.data.json"
const SCHEMA := "gamesystems.grasp-catalog-data.v1"
const PROP_KEYS := ["label", "mass", "grip", "shape", "breakable", "glass", "fill", "liquid", "color"]

static func load_data(path: String = DATA_PATH) -> Dictionary:
	if not FileAccess.file_exists(path):
		push_error("GSGraspCatalogData: data file not found: %s" % path)
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not validate(parsed):
		push_error("GSGraspCatalogData: invalid prop catalog data: %s" % path)
		return {}
	return parsed

static func validate(data: Variant) -> bool:
	if not data is Dictionary or data.get("schema") != SCHEMA or not _positive(data.get("DEFAULT_MASS")):
		return false
	var catalog: Variant = data.get("CATALOG")
	if not catalog is Dictionary or catalog.is_empty():
		return false
	for kind: Variant in catalog:
		if not _text(kind) or not _prop(catalog[kind]):
			return false
	return true

static func validate_shape(shape: Variant) -> bool:
	return _shape(shape, true)

static func _prop(prop: Variant) -> bool:
	if not _only_keys(prop, PROP_KEYS):
		return false
	if not _text(prop.get("label")) or not _text(prop.get("grip")) or not _positive(prop.get("mass")) or not _shape(prop.get("shape"), true):
		return false
	if prop.has("breakable") and not prop.breakable is bool:
		return false
	if prop.has("fill") and (not _number(prop.fill) or prop.fill < 0 or prop.fill > 1):
		return false
	for key: String in ["glass", "liquid", "color"]:
		if prop.has(key) and (not _number(prop[key]) or prop[key] < 0 or prop[key] > 0xffffff or floor(prop[key]) != prop[key]):
			return false
	return true

static func _shape(shape: Variant, allow_parts: bool) -> bool:
	if not shape is Dictionary:
		return false
	if shape.has("at") and not _vector(shape.at):
		return false
	match shape.get("type"):
		"box":
			if not _only_keys(shape, ["type", "size", "at"]) or not _vector(shape.get("size")):
				return false
			return shape.size[0] > 0 and shape.size[1] > 0 and shape.size[2] > 0
		"cylinder":
			return _only_keys(shape, ["type", "radius", "half", "at"]) and _positive(shape.get("radius")) and _positive(shape.get("half"))
		"lathe":
			if not _only_keys(shape, ["type", "profile", "at"]):
				return false
			var profile: Variant = shape.get("profile")
			if not profile is Array or profile.size() < 2:
				return false
			var previous_y := -INF
			var nonzero_radius := false
			for row: Variant in profile:
				if not row is Array or row.size() != 2 or not _number(row[0]) or not _number(row[1]):
					return false
				if row[0] <= previous_y or row[1] < 0:
					return false
				previous_y = row[0]
				nonzero_radius = nonzero_radius or row[1] > 0
			return nonzero_radius
		"parts":
			if not allow_parts or not _only_keys(shape, ["type", "parts"]):
				return false
			var parts: Variant = shape.get("parts")
			if not parts is Array or parts.is_empty():
				return false
			for part: Variant in parts:
				if not _shape(part, false):
					return false
			return true
	return false

static func _only_keys(value: Variant, keys: Array) -> bool:
	if not value is Dictionary:
		return false
	for key: Variant in value:
		if not keys.has(key):
			return false
	return true

static func _text(value: Variant) -> bool:
	return value is String and not value.is_empty()

static func _number(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value))

static func _positive(value: Variant) -> bool:
	return _number(value) and value > 0

static func _vector(value: Variant) -> bool:
	return value is Array and value.size() == 3 and _number(value[0]) and _number(value[1]) and _number(value[2])
