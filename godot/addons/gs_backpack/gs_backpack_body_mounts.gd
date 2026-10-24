class_name GSBackpackBodyMounts
extends Node
## P3: hip / chest / back mounts that belong to the BODY, not to the bag. They are ordinary ledger slots (registered on the host's scene
## adapter) whose anchors follow a GSBackpackBodyAnchorProvider, so weapons and magazines stay on the wearer while the bag is off.
##
## Two ways in:
##  * adopt_group(): a node group that already exists and is registered as slots (Nightfall: the rig's "Slots" node holding Back, LeftHip,
##    RightHip). While the bag is detached the group leaves the bag's transform (top_level) and is driven from the provider each physics
##    tick; the slot anchors, and the items parented under them, ride with it. Re-attaching restores the original local transform.
##  * build_mount()/register_on(): a host without such slots creates them from an anchor kind plus a local offset and registers them on its
##    scene adapter through the adapter's public register_slot().
## Nothing here touches the ledger's slot set after registration, and nothing changes the inventory checkpoint.
##
## A zone never snaps its own ancestor: zone_may_snap() refuses a candidate that is the zone's node or contains it (a bag holding the hip
## mount, a weapon holding the holster zone). The scene adapter register_slot() already refuses an anchor under a registered item.

signal mounts_changed

var provider: Object
var detached := false
var _groups: Array[Dictionary] = []
var _mounts: Dictionary = {}
var _specs: Dictionary = {}

func configure(body_provider: Object) -> bool:
	if body_provider == null: return false
	for m in ["is_valid", "pack_frame", "mount_frame"]:
		if not body_provider.has_method(m): return false
	provider = body_provider
	return true

## Group of anchors that moves as one body-frame object. `local` is its transform relative to the kind frame; default: its current
## local transform (it must be a direct child of the node that follows that frame while attached).
func adopt_group(group: Node3D, kind := "pack", local: Variant = null) -> bool:
	if not is_instance_valid(group) or provider == null: return false
	for g in _groups:
		if g.node == group: return false
	_groups.append({"node": group, "kind": kind, "local": local if local is Transform3D else group.transform, "was_top_level": group.top_level})
	mounts_changed.emit()
	return true

## Registers an anchor that an already-registered slot uses, so ids can be listed and followed (no group needed when the anchor lives under
## an adopted group).
func adopt_anchor(slot_id: String, anchor: Node3D, kind := "pack") -> bool:
	if slot_id.is_empty() or not is_instance_valid(anchor) or _mounts.has(slot_id): return false
	_mounts[slot_id] = {"anchor": anchor, "kind": kind, "group": false}
	mounts_changed.emit()
	return true

## Creates a mount anchor (Node3D) under `parent` at `local` relative to the `kind` frame and remembers its slot spec for register_on().
## It follows the provider by itself (top_level) every follow() tick. Returns null on an invalid request.
func build_mount(slot_id: String, kind: String, local: Transform3D, parent: Node, categories: Array[String], max_size: Vector3,
		hands: Array[String] = ["hand:left", "hand:right"]) -> Node3D:
	if slot_id.is_empty() or _mounts.has(slot_id) or not is_instance_valid(parent) or not local.is_finite(): return null
	var anchor := Node3D.new()
	anchor.name = "Mount_" + slot_id.replace("/", "_")
	anchor.top_level = true
	parent.add_child(anchor)
	_mounts[slot_id] = {"anchor": anchor, "kind": kind, "group": false, "local": local, "own": true}
	_specs[slot_id] = {"categories": categories.duplicate(), "max_size": max_size, "hands": hands.duplicate()}
	follow()
	mounts_changed.emit()
	return anchor

## Registers every built mount on a scene adapter (public register_slot only). All or nothing is not possible on the adapter, so the
## return value lists the slot ids that were refused (empty = all registered).
func register_on(scene_adapter: Object) -> Array:
	var refused: Array = []
	for id in _specs:
		var s: Dictionary = _specs[id]
		var anchor: Node3D = _mounts[id].anchor
		if not bool(scene_adapter.register_slot(id, anchor, s.categories, s.max_size, s.hands)): refused.append(id)
	return refused

func mount_ids() -> Array: return _mounts.keys()
func anchor_of(slot_id: String) -> Node3D:
	return _mounts[slot_id].anchor if _mounts.has(slot_id) else null
func group_count() -> int: return _groups.size()

## True while the mounts are driven from the body provider instead of the bag.
func set_detached(on: bool) -> void:
	if detached == on: return
	detached = on
	for g in _groups:
		var node: Node3D = g.node
		if not is_instance_valid(node): continue
		if on:
			node.top_level = true
			if provider != null and bool(provider.is_valid()): node.global_transform = _frame(g.kind) * g.local
		else:
			node.top_level = bool(g.was_top_level)
			node.transform = g.local
	follow()

## One write per group per physics tick; a no-op while there is no valid body pose or nothing is detached.
func follow() -> void:
	if provider == null or not bool(provider.is_valid()): return
	if detached:
		for g in _groups:
			var node: Node3D = g.node
			if is_instance_valid(node): node.global_transform = _frame(g.kind) * g.local
	for id in _mounts:
		var m: Dictionary = _mounts[id]
		if m.get("own", false) and is_instance_valid(m.anchor):
			(m.anchor as Node3D).global_transform = _frame(m.kind) * (m.local as Transform3D)

## Current world transform of a mount's anchor (the body-frame placement, also while the bag is far away).
func mount_world(slot_id: String) -> Transform3D:
	var a := anchor_of(slot_id)
	return a.global_transform if a != null and a.is_inside_tree() else Transform3D.IDENTITY

func _frame(kind: String) -> Transform3D:
	return provider.mount_frame(kind) as Transform3D

func _exit_tree() -> void:
	# Never leave an adopted group frozen in world space when the controller goes away.
	if detached: set_detached(false)

## False when `candidate` is the zone's own node or one of its ancestors (a zone never snaps the thing that carries it).
static func zone_may_snap(zone: Node, candidate: Node) -> bool:
	if zone == null or candidate == null: return false
	var n: Node = zone
	while n != null:
		if n == candidate: return false
		n = n.get_parent()
	return true

