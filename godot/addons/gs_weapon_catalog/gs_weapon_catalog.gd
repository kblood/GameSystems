class_name GSWeaponCatalog
extends RefCounted
## Validates and loads a small JSON weapon catalogue. It does not own runtime weapon state.

var definitions: Dictionary = {}
var schema: String = ""
var units: String = ""
var up: String = ""
var forward: String = ""

static func load_file(path: String) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null: return {"ok":false, "errors":["Cannot open weapon catalog: %s" % path]}
	return parse_text(file.get_as_text())

static func parse_text(source: String) -> Dictionary:
	var parsed: Variant = JSON.parse_string(source)
	if not parsed is Dictionary: return {"ok":false, "errors":["Weapon catalog root must be an object"]}
	var data: Dictionary = parsed
	var errors: Array[String] = []
	if data.get("schema") != "nightfall.weapon-catalog.v1": errors.append("Unsupported weapon catalog schema")
	if data.get("units") != "metres" or data.get("up") != "+Y" or data.get("forward") != "-Z": errors.append("Catalog axes must be metre scale, +Y up and -Z forward")
	if not data.get("weapons") is Array: errors.append("Catalog weapons must be an array")
	if not errors.is_empty(): return {"ok":false, "errors":errors}
	var catalog := GSWeaponCatalog.new()
	catalog.schema = data.schema
	catalog.units = data.units
	catalog.up = data.up
	catalog.forward = data.forward
	for index in data.weapons.size():
		var entry: Variant = data.weapons[index]
		if not entry is Dictionary:
			errors.append("Weapon %d must be an object" % index)
			continue
		var entry_errors: Array[String] = []
		_validate_entry(entry, index, entry_errors)
		errors.append_array(entry_errors)
		var weapon_id := str(entry.get("id", ""))
		if weapon_id.is_empty(): continue
		if catalog.definitions.has(weapon_id):
			errors.append("Duplicate weapon id: %s" % weapon_id)
			continue
		if not entry_errors.is_empty(): continue
		catalog.definitions[weapon_id] = GSWeaponDefinition.from_dictionary(entry)
	if not errors.is_empty(): return {"ok":false, "errors":errors}
	return {"ok":true, "catalog":catalog, "errors":errors}

static func _validate_entry(entry: Dictionary, index: int, errors: Array[String]) -> void:
	var label := str(entry.get("id", "weapon[%d]" % index))
	for key in ["id", "name", "kind", "source_kind"]:
		if str(entry.get(key, "")).strip_edges().is_empty(): errors.append("%s missing %s" % [label, key])
	if entry.get("kind") not in ["pistol", "rifle", "melee"]: errors.append("%s has unsupported kind" % label)
	if entry.get("source_kind") not in ["existing_procedural", "blender_glb"]: errors.append("%s has unsupported source_kind" % label)
	var source := str(entry.get("scene", entry.get("source", "")))
	if source.is_empty(): errors.append("%s has no model source" % label)
	var fire_modes: Variant = entry.get("fire_modes", [])
	var attachments: Variant = entry.get("attachments", [])
	var moving_parts: Variant = entry.get("moving_parts", [])
	if not fire_modes is Array: errors.append("%s fire modes must be an array" % label)
	if not attachments is Array or not moving_parts is Array: errors.append("%s attachment and moving part lists must be arrays" % label)
	if entry.get("kind") == "melee":
		if entry.get("capacity") != null or fire_modes is Array and not fire_modes.is_empty(): errors.append("%s melee entries cannot define ammo or fire modes" % label)
	else:
		var capacity: Variant = entry.get("capacity")
		var capacity_value := float(capacity) if typeof(capacity) in [TYPE_INT, TYPE_FLOAT] else 0.0
		if typeof(capacity) not in [TYPE_INT, TYPE_FLOAT] or capacity_value < 1.0 or capacity_value > 128.0 or floorf(capacity_value) != capacity_value:
			errors.append("%s needs a whole-number magazine capacity from 1 to 128" % label)
		if not fire_modes is Array or fire_modes.is_empty(): errors.append("%s needs at least one fire mode" % label)
		elif fire_modes is Array:
			var seen_modes: Array[String] = []
			for mode in fire_modes:
				var mode_name := str(mode)
				if mode_name not in ["semi", "auto"]: errors.append("%s has unsupported fire mode %s" % [label, mode_name])
				if mode_name in seen_modes: errors.append("%s repeats fire mode %s" % [label, mode_name])
				seen_modes.append(mode_name)
			var default_mode := str(entry.get("default_fire_mode", "semi"))
			if default_mode not in ["semi", "auto"]: errors.append("%s has unsupported default fire mode %s" % [label, default_mode])
			elif default_mode not in seen_modes: errors.append("%s default fire mode %s is not listed in fire_modes" % [label, default_mode])
		var interval: Variant = entry.get("shot_interval_s", 0.12)
		var interval_value := float(interval) if typeof(interval) in [TYPE_INT, TYPE_FLOAT] else NAN
		if typeof(interval) not in [TYPE_INT, TYPE_FLOAT] or not is_finite(interval_value) or interval_value < 0.03 or interval_value > 2.0:
			errors.append("%s shot interval must be from 0.03 to 2 seconds" % label)
	if attachments is Array:
		for marker in attachments:
			if not str(marker).begins_with("attach_"): errors.append("%s has invalid attachment marker %s" % [label, marker])
	if moving_parts is Array:
		for part in moving_parts:
			if not str(part).begins_with("part_"): errors.append("%s has invalid moving part %s" % [label, part])

func get_weapon(weapon_id: String) -> GSWeaponDefinition:
	return definitions.get(weapon_id) as GSWeaponDefinition

func weapon_ids() -> PackedStringArray:
	var ids := PackedStringArray(definitions.keys())
	ids.sort()
	return ids
