class_name GSWeaponDefinition
extends RefCounted
## Data-only, metre-scale description shared by weapon implementations.

var id: String
var display_name: String
var kind: StringName
var source_kind: StringName
var source_path: String
var capacity: int = -1
var fire_modes: Array[StringName] = []
var shot_interval_s: float = -1.0
## Validated firearm tuning; null for melee definitions.
var shot_profile: GSWeaponShotProfile
var attachment_markers: Array[StringName] = []
var moving_parts: Array[StringName] = []
var raw: Dictionary = {}

static func from_dictionary(data: Dictionary) -> GSWeaponDefinition:
	var result := GSWeaponDefinition.new()
	result.id = str(data.get("id", ""))
	result.display_name = str(data.get("name", ""))
	result.kind = StringName(str(data.get("kind", "")))
	if result.kind != &"melee":
		result.shot_profile = GSWeaponShotProfile.parse(data.get("shot_profile", {})).get("profile")
	result.source_kind = StringName(str(data.get("source_kind", "")))
	result.source_path = str(data.get("scene", data.get("source", "")))
	result.capacity = int(data.capacity) if typeof(data.get("capacity")) in [TYPE_INT, TYPE_FLOAT] else -1
	result.shot_interval_s = float(data.shot_interval_s) if typeof(data.get("shot_interval_s")) in [TYPE_FLOAT, TYPE_INT] else -1.0
	for mode in data.get("fire_modes", []): result.fire_modes.append(StringName(str(mode)))
	for marker in data.get("attachments", []): result.attachment_markers.append(StringName(str(marker)))
	for part in data.get("moving_parts", []): result.moving_parts.append(StringName(str(part)))
	result.raw = data.duplicate(true)
	return result
