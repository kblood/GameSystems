class_name NightfallGearInventorySceneAdapter
extends Node
## Scene-tree host for NightfallGearInventory. The ledger remains the source of
## ownership truth; this node applies accepted store/retrieve/reset/restore
## transitions to registered Node3D items and slot anchors.

signal ownership_changed(item_id: String, from_owner: String, to_owner: String, slot_id: String)
signal reconciliation_failed(reason: String)

const Inventory = preload("res://addons/gs_gear_inventory/gs_gear_inventory.gd")

var inventory = Inventory.new()
var _owner_roots: Dictionary = {}
var _slots: Dictionary = {}
var _items: Dictionary = {}
var _body_state: Dictionary = {}
var _busy := false

func set_owner_root(owner: String, root: Node3D) -> bool:
	if _busy or not owner in Inventory.OWNERS or not is_instance_valid(root) or not root.is_inside_tree(): return false
	for item_id in _items:
		var item := _item_node(item_id)
		if item == root or _is_under(root, item): return false
	_owner_roots[owner] = root
	return true

func register_slot(slot_id: String, anchor: Node3D, allowed_categories: Array[String], max_size: Vector3, access_hands: Array[String] = ["hand:left", "hand:right"]) -> bool:
	if _busy or not is_instance_valid(anchor) or not anchor.is_inside_tree() or _slots.has(slot_id): return false
	if access_hands.is_empty(): return false
	var validated_hands: Array[String] = []
	for hand in access_hands:
		if not hand in ["hand:left", "hand:right"] or hand in validated_hands: return false
		validated_hands.append(hand)
	for existing_id in _slots:
		if _slot_node(existing_id) == anchor: return false
	for item_id in _items:
		var item := _item_node(item_id)
		if item == anchor or _is_under(anchor, item): return false
	if not inventory.add_slot(slot_id, allowed_categories, max_size): return false
	_slots[slot_id] = {"anchor":anchor,"access_hands":validated_hands}
	return true

## Event-driven access check for a single store/retrieve request. Call when the
## user requests interaction; this deliberately does no per-frame candidate scan.
## Occlusion uses one physics ray ending just before the slot anchor. Exclude the
## player's body/colliders from the caller to avoid self-occlusion.
func check_slot_access(requesting_hand: String, hand_tracked: bool, hand_world: Transform3D, slot_id: String, reach_m: float, exclude: Array[RID] = [], collision_mask: int = 0xFFFFFFFF) -> Dictionary:
	var anchor := _slot_node(slot_id)
	if anchor == null or not anchor.is_inside_tree() or not _valid_transform(anchor.global_transform): return _access_result(false, "invalid_slot")
	if not requesting_hand in ["hand:left", "hand:right"]: return _access_result(false, "invalid_hand")
	if requesting_hand not in _slots[slot_id].access_hands: return _access_result(false, "wrong_hand")
	if not hand_tracked: return _access_result(false, "hand_tracking_lost")
	if not _valid_transform(hand_world) or not is_finite(reach_m) or reach_m <= 0.0: return _access_result(false, "invalid_request")
	var from := hand_world.origin
	var to := anchor.global_position
	var distance := from.distance_to(to)
	if distance > reach_m: return _access_result(false, "out_of_reach", distance)
	if distance > 0.025:
		var ray_excludes := exclude.duplicate()
		for rid in _held_collision_rids(requesting_hand):
			if not rid in ray_excludes: ray_excludes.append(rid)
		var query := PhysicsRayQueryParameters3D.create(from, to - (to - from).normalized() * 0.02, collision_mask, ray_excludes)
		query.collide_with_areas = true
		query.collide_with_bodies = true
		var viewport := get_viewport()
		var world: World3D = viewport.world_3d if viewport != null else null
		if world == null: return _access_result(false, "no_physics_world", distance)
		if not world.direct_space_state.intersect_ray(query).is_empty(): return _access_result(false, "occluded", distance)
	return _access_result(true, "ok", distance)

## Gated entry points intended for input/grab events. Direct store/retrieve remain
## available to trusted game reset/checkpoint code that already validated access.
func request_store(item_id: String, expected_owner: String, slot_id: String, requesting_hand: String, hand_tracked: bool, hand_world: Transform3D, reach_m: float, exclude: Array[RID] = [], collision_mask: int = 0xFFFFFFFF) -> Dictionary:
	if requesting_hand != expected_owner: return _access_result(false, "wrong_hand")
	var access := check_slot_access(requesting_hand, hand_tracked, hand_world, slot_id, reach_m, exclude, collision_mask)
	if not access.allowed: return access
	if not store(item_id, expected_owner, slot_id): return _access_result(false, "store_rejected", float(access.distance_m))
	access.accepted = true
	return access

func request_retrieve(slot_id: String, requesting_hand: String, hand_tracked: bool, hand_world: Transform3D, reach_m: float, exclude: Array[RID] = [], collision_mask: int = 0xFFFFFFFF) -> Dictionary:
	var access := check_slot_access(requesting_hand, hand_tracked, hand_world, slot_id, reach_m, exclude, collision_mask)
	if not access.allowed: return access
	var item_id := retrieve(slot_id, requesting_hand)
	if item_id.is_empty(): return _access_result(false, "retrieve_rejected", float(access.distance_m))
	access.accepted = true
	access.item_id = item_id
	return access

## Register an item where it currently lives. Its initial pose relative to the
## owner root is kept for reset so moving hand roots preserve natural grip fit.
func register_item(item_id: String, node: Node3D, category: String, size: Vector3, initial_owner := "world") -> bool:
	if _busy or not is_instance_valid(node) or not node.is_inside_tree() or _items.has(item_id): return false
	for existing_id in _items:
		var existing_node := _item_node(existing_id)
		if existing_node == node or _is_under(node, existing_node) or _is_under(existing_node, node): return false
	for anchor_id in _slots:
		var anchor := _slot_node(anchor_id)
		if anchor == node or _is_under(anchor, node): return false
	for root in _owner_roots.values():
		if root == node or _is_under(root, node): return false
	if not _owner_roots.has(initial_owner) or not is_instance_valid(_owner_roots[initial_owner]): return false
	if not _is_under(node, _owner_roots[initial_owner]): return false
	var owner_root: Node3D = _owner_roots[initial_owner]
	var row := {"node":node,"initial_owner_transform":owner_root.global_transform.affine_inverse() * node.global_transform,"initial_owner":initial_owner}
	if not inventory.register_item(item_id, node, category, size, initial_owner): return false
	_items[item_id] = row
	return true

func store(item_id: String, expected_owner: String, slot_id: String) -> bool:
	if _busy or not _registered_nodes_valid(): return false
	var node := _item_node(item_id)
	var anchor := _slot_node(slot_id)
	var current_root: Node3D = _owner_roots.get(expected_owner)
	if node == null or anchor == null or not _is_under(node, current_root) or not _can_reparent_to(node, anchor):
		return false
	if not inventory.can_store(item_id, expected_owner, slot_id): return false
	_busy = true
	var old_parent := node.get_parent()
	var old_global := node.global_transform
	var old_body := _capture_body_state(node)
	if node.get_parent() != anchor:
		node.reparent(anchor, false)
	node.transform = Transform3D.IDENTITY
	_freeze_in_slot(node)
	if not inventory.store(item_id, expected_owner, slot_id):
		if is_instance_valid(old_parent): node.reparent(old_parent, false)
		node.global_transform = old_global
		_restore_body_state(node, old_body)
		_busy = false
		return false
	_body_state[item_id] = old_body
	_busy = false
	_emit_ownership_changed(item_id, expected_owner, "slot", slot_id)
	return true

func retrieve(slot_id: String, new_owner: String) -> String:
	if _busy or not _registered_nodes_valid() or not _owner_roots.has(new_owner): return ""
	var item_id := inventory.item_in_slot(slot_id)
	var node := _item_node(item_id)
	var anchor := _slot_node(slot_id)
	var root: Node3D = _owner_roots.get(new_owner)
	if node == null or anchor == null or not is_instance_valid(root) or not root.is_inside_tree() or not _is_under(node, anchor) or not _can_reparent_to(node, root): return ""
	var at := node.global_transform
	_busy = true
	var moved := inventory.retrieve(slot_id, new_owner)
	if moved.is_empty():
		_busy = false
		return ""
	node.reparent(root, true)
	node.global_transform = at
	_restore_body_state(node, _body_state.get(item_id, {}))
	_body_state.erase(item_id)
	_busy = false
	_emit_ownership_changed(item_id, "slot", new_owner, slot_id)
	return item_id

## Reset ledger and scene together. Every item returns to its registered owner
## root and captured spawn pose. Rejects before mutating when a node/root is gone.
func reset_inventory() -> bool:
	if _busy or not _registered_nodes_valid(): return _fail("invalid_registered_node")
	for item_id in _items:
		var initial_owner := _initial_owner(item_id)
		var initial_root: Node3D = _owner_roots.get(initial_owner)
		if not _valid_owner_root(initial_owner): return _fail("missing_owner_root:%s" % initial_owner)
		if not _can_reparent_to(_item_node(item_id), initial_root): return _fail("cyclic_owner_root:%s" % item_id)
	_busy = true
	inventory.reset()
	var ok := _reconcile_all(true)
	_busy = false
	return ok

## Two-phase checkpoint API mirrors the ledger. Reconciliation is prevalidated,
## then applies all target owners/slots before emitting a single completion event.
func restore_inventory(snapshot: Dictionary) -> bool:
	if _busy or not _registered_nodes_valid(): return _fail("invalid_registered_node")
	var prepared: Dictionary = inventory.prepare_restore(snapshot)
	if not bool(prepared.get("valid", false)): return false
	if not _prepared_scene_valid(prepared): return false
	_busy = true
	if not inventory.commit_restore(prepared):
		_busy = false
		return false
	var ok := _reconcile_all(false)
	_busy = false
	return ok

func capture() -> Dictionary:
	return inventory.capture()

func owner_of(item_id: String) -> String:
	return inventory.owner_of(item_id)

func slot_of(item_id: String) -> String:
	return inventory.slot_of(item_id)

func _reconcile_all(reset_pose: bool) -> bool:
	for item_id in _items:
		var owner := inventory.owner_of(item_id)
		var slot_id := inventory.slot_of(item_id)
		var node := _item_node(item_id)
		var target: Node3D = _slot_node(slot_id) if owner == "slot" else _owner_roots.get(owner)
		if node == null or not is_instance_valid(target): return _fail("missing_target:%s" % item_id)
		var old_global := node.global_transform
		if node.get_parent() != target:
			node.reparent(target, false)
		if owner == "slot":
			node.transform = Transform3D.IDENTITY
			if not _body_state.has(item_id): _body_state[item_id] = _capture_body_state(node)
			_freeze_in_slot(node)
		else:
			if reset_pose:
				var owner_root: Node3D = _owner_roots[owner]
				node.global_transform = owner_root.global_transform * _items[item_id].initial_owner_transform
			else:
				node.global_transform = old_global
			_restore_body_state(node, _body_state.get(item_id, {}))
			_body_state.erase(item_id)
	return true

func _prepared_scene_valid(prepared: Dictionary) -> bool:
	var rows: Dictionary = prepared.get("items", {})
	for item_id in rows:
		var row: Dictionary = rows[item_id]
		var target: Node3D = _slot_node(row.slot) if row.owner == "slot" else _owner_roots.get(row.owner)
		if target == null or not is_instance_valid(target) or not target.is_inside_tree() or not _can_reparent_to(_item_node(item_id), target): return false
	return true

func _initial_owner(item_id: String) -> String:
	# Initial owner is immutable ledger metadata. Reset uses current initial owner
	# from the registration row, recorded alongside the initial scene pose.
	return String(_items[item_id].get("initial_owner", "world"))

func _registered_nodes_valid() -> bool:
	for root in _owner_roots.values():
		if not is_instance_valid(root) or not root is Node3D or not root.is_inside_tree(): return false
	for item_id in _items:
		var node := _item_node(item_id)
		if node == null or not node.is_inside_tree(): return false
	for item_ids in _items.keys():
		var outer := _item_node(item_ids)
		for other_id in _items.keys():
			if other_id == item_ids: continue
			var other := _item_node(other_id)
			if _is_under(outer, other): return false
	for slot_id in _slots:
		var anchor := _slot_node(slot_id)
		if anchor == null or not anchor.is_inside_tree(): return false
		for item_id in _items:
			var item := _item_node(item_id)
			if anchor == item or _is_under(anchor, item): return false
	for root in _owner_roots.values():
		for item_id in _items:
			var item := _item_node(item_id)
			if root == item or _is_under(root, item): return false
	return true

func _item_node(item_id: String) -> Node3D:
	if not _items.has(item_id): return null
	var node: Variant = _items[item_id].node
	return node if is_instance_valid(node) and node is Node3D else null

func _slot_node(slot_id: String) -> Node3D:
	var slot: Variant = _slots.get(slot_id)
	var node: Variant = slot.get("anchor") if slot is Dictionary else null
	return node if is_instance_valid(node) and node is Node3D else null

func _valid_transform(value: Transform3D) -> bool:
	return value.origin.is_finite() and value.basis.x.is_finite() and value.basis.y.is_finite() and value.basis.z.is_finite()

func _access_result(allowed: bool, reason: String, distance_m := -1.0) -> Dictionary:
	return {"allowed":allowed,"accepted":false,"reason":reason,"distance_m":distance_m}

func _valid_owner_root(owner: String) -> bool:
	return _owner_roots.has(owner) and is_instance_valid(_owner_roots[owner])

func _is_under(node: Node, ancestor: Variant) -> bool:
	if not is_instance_valid(ancestor) or not ancestor is Node: return false
	var cursor := node.get_parent()
	while cursor != null:
		if cursor == ancestor: return true
		cursor = cursor.get_parent()
	return false

func _held_collision_rids(owner: String) -> Array[RID]:
	var rids: Array[RID] = []
	for item_id in _items:
		if inventory.owner_of(item_id) != owner: continue
		var held := _item_node(item_id)
		if held == null: continue
		if held is CollisionObject3D:
			rids.append((held as CollisionObject3D).get_rid())
		for child in held.find_children("*", "CollisionObject3D", true, false):
			if child is CollisionObject3D: rids.append((child as CollisionObject3D).get_rid())
	return rids

## Godot forbids parenting a node beneath itself or one of its descendants.
## Check before the ledger changes so a failed scene move cannot split ownership.
func _can_reparent_to(node: Node3D, target: Node3D) -> bool:
	return is_instance_valid(node) and is_instance_valid(target) and node != target and not _is_under(target, node)

func _capture_body_state(node: Node3D) -> Dictionary:
	if not node is RigidBody3D: return {}
	var body := node as RigidBody3D
	return {"freeze":body.freeze,"layer":body.collision_layer,"mask":body.collision_mask,"sleeping":body.sleeping}

func _freeze_in_slot(node: Node3D) -> void:
	if node is RigidBody3D:
		var body := node as RigidBody3D
		body.freeze = true
		body.sleeping = true
		body.collision_layer = 0
		body.collision_mask = 0

func _restore_body_state(node: Node3D, state: Dictionary) -> void:
	if node is RigidBody3D and not state.is_empty():
		var body := node as RigidBody3D
		body.collision_layer = int(state.layer)
		body.collision_mask = int(state.mask)
		body.freeze = bool(state.freeze)
		body.sleeping = bool(state.sleeping)

func _fail(reason: String) -> bool:
	reconciliation_failed.emit(reason)
	return false

func _emit_ownership_changed(item_id: String, from_owner: String, to_owner: String, slot_id: String) -> void:
	_busy = true
	ownership_changed.emit(item_id, from_owner, to_owner, slot_id)
	_busy = false
