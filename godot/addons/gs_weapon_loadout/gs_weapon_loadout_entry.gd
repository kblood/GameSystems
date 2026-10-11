class_name GSWeaponLoadoutEntry
extends RefCounted
## Opaque host-owned runtime for one weapon in a loadout.
## The catalog describes what a weapon is; this entry retains the live state that
## must survive switching (ammo ledger, model/presenter, magazine tokens, etc.).

var _id: StringName
var id: StringName:
	get: return _id
var state: Variant
var presentation: Variant
var metadata: Dictionary

func _init(entry_id: StringName, weapon_state: Variant, weapon_presentation: Variant = null,
		entry_metadata: Dictionary = {}) -> void:
	_id = entry_id
	state = weapon_state
	presentation = weapon_presentation
	metadata = entry_metadata.duplicate(true)

func is_valid() -> bool:
	return not String(id).strip_edges().is_empty() and state != null
