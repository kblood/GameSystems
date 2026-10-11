class_name GSWeaponModelBinding
extends RefCounted
## Resolves authored attach_* and part_* nodes from a model instance without owning it.

var root: Node3D
var attachments: Dictionary = {}
var moving_parts: Dictionary = {}
var missing: Array[StringName] = []

static func bind(model_root: Node3D, definition: GSWeaponDefinition) -> GSWeaponModelBinding:
	var binding := GSWeaponModelBinding.new()
	binding.root = model_root
	if not is_instance_valid(model_root) or definition == null:
		binding.missing.append(&"model_root")
		return binding
	for marker in definition.attachment_markers:
		var node := _find_named(model_root, String(marker))
		if node is Node3D: binding.attachments[marker] = node
		else: binding.missing.append(marker)
	for part in definition.moving_parts:
		var node := _find_named(model_root, String(part))
		if node is Node3D: binding.moving_parts[part] = node
		else: binding.missing.append(part)
	return binding

func is_complete() -> bool:
	return missing.is_empty()

func attachment_transform(marker: StringName) -> Transform3D:
	var node: Node3D = attachments.get(marker)
	if not is_instance_valid(node): return Transform3D.IDENTITY
	if root.is_inside_tree(): return node.global_transform
	var local := Transform3D.IDENTITY
	var cursor: Node = node
	while cursor is Node3D and cursor != root:
		local = (cursor as Node3D).transform * local
		cursor = cursor.get_parent()
	return root.transform * local

static func _find_named(parent: Node, wanted: String) -> Node:
	if parent.name == wanted: return parent
	for child in parent.get_children():
		var found := _find_named(child, wanted)
		if found != null: return found
	return null
