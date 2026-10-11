extends SceneTree

const Adapter = preload("res://addons/gs_gear_inventory/gs_gear_inventory_scene_adapter.gd")

var checks := 0
var failures: Array[String] = []

func _initialize() -> void:
	call_deferred("run")

func check(value: bool, message: String) -> void:
	checks += 1
	if not value:
		failures.append(message)
		printerr("FAIL ", message)

func run() -> void:
	var world := Node3D.new()
	world.name = "WorldItems"
	root.add_child(world)
	var left_hand := Node3D.new()
	left_hand.name = "LeftHand"
	root.add_child(left_hand)
	var right_hand := Node3D.new()
	right_hand.name = "RightHand"
	root.add_child(right_hand)
	var backpack := Node3D.new()
	backpack.name = "Backpack"
	root.add_child(backpack)
	var back_anchor := Node3D.new()
	back_anchor.name = "BackSlot"
	backpack.add_child(back_anchor)
	back_anchor.position = Vector3(0.0, 1.2, -0.3)
	var pistol := RigidBody3D.new()
	pistol.name = "Pistol"
	right_hand.add_child(pistol)
	pistol.position = Vector3(0.2, 0.1, -0.4)
	pistol.collision_layer = 4
	pistol.collision_mask = 7
	var spare_item := Node3D.new()
	spare_item.name = "SpareTool"
	world.add_child(spare_item)
	var adapter = Adapter.new()
	root.add_child(adapter)
	check(adapter.set_owner_root("world", world), "world owner root configured")
	check(adapter.set_owner_root("hand:left", left_hand), "left hand owner root configured")
	check(adapter.set_owner_root("hand:right", right_hand), "right hand owner root configured")
	check(adapter.register_slot("back", back_anchor, ["pistol"], Vector3(0.32, 0.22, 0.06)), "physical back slot registered")
	check(not adapter.register_slot("back_alias", back_anchor, ["pistol"], Vector3(0.32, 0.22, 0.06)), "one physical anchor cannot back two slot IDs")
	check(adapter.register_item("sidearm", pistol, "pistol", Vector3(0.24, 0.17, 0.04), "hand:right"), "actual rigid body registered from hand")
	check(not adapter.register_item("duplicate_physical", pistol, "pistol", Vector3(0.24, 0.17, 0.04), "hand:right"), "one physical node cannot have two item IDs")
	check(adapter.register_item("spare_tool", spare_item, "tool", Vector3(0.1, 0.1, 0.1), "world"), "second physical item registers independently")
	var nested_item := Node3D.new()
	pistol.add_child(nested_item)
	check(not adapter.register_item("nested_item", nested_item, "pistol", Vector3(0.1, 0.1, 0.1), "hand:right"), "nested registered gear cannot acquire a conflicting owner")
	pistol.remove_child(nested_item)
	nested_item.free()
	var cycle_anchor := Node3D.new()
	cycle_anchor.name = "CycleSlot"
	backpack.add_child(cycle_anchor)
	check(adapter.register_slot("cycle", cycle_anchor, ["pistol"], Vector3(0.32, 0.22, 0.06)), "second independent slot anchor registers")
	var initial_pose := pistol.global_transform
	world.remove_child(spare_item)
	pistol.add_child(spare_item)
	check(not adapter.store("sidearm", "hand:right", "back"), "store rejects items externally nested after registration")
	check(adapter.owner_of("sidearm") == "hand:right", "nested-item rejection leaves ledger unchanged")
	pistol.remove_child(spare_item)
	world.add_child(spare_item)
	backpack.remove_child(cycle_anchor)
	pistol.add_child(cycle_anchor)
	check(not adapter.store("sidearm", "hand:right", "cycle"), "store rejects a slot beneath its item")
	check(adapter.owner_of("sidearm") == "hand:right" and pistol.get_parent() == right_hand, "cyclic store rejection leaves scene and ledger unchanged")
	pistol.remove_child(cycle_anchor)
	backpack.add_child(cycle_anchor)
	var reentrant_result := {"retrieve":"unset"}
	var reentrant_listener := func(_item_id: String, _from_owner: String, _to_owner: String, slot_id: String) -> void:
		reentrant_result.retrieve = adapter.retrieve(slot_id, "world")
	adapter.ownership_changed.connect(reentrant_listener)
	check(adapter.store("sidearm", "hand:right", "back"), "store moves item to physical slot")
	adapter.ownership_changed.disconnect(reentrant_listener)
	check(String(reentrant_result.retrieve).is_empty(), "adapter rejects reentrant retrieve during transition callback")
	check(adapter.owner_of("sidearm") == "slot" and pistol.get_parent() == back_anchor, "adapter callback cannot split scene and ledger state")
	check(pistol.get_parent() == back_anchor and pistol.transform.is_equal_approx(Transform3D.IDENTITY), "stored item is attached at slot anchor")
	check(pistol.freeze and pistol.collision_layer == 0 and pistol.collision_mask == 0, "stored rigid body is frozen and removed from collision")
	check(adapter.owner_of("sidearm") == "slot" and adapter.slot_of("sidearm") == "back", "ledger and scene agree after store")
	check(adapter.retrieve("back", "hand:left") == "sidearm", "retrieve transfers item to requested hand")
	check(pistol.get_parent() == left_hand and pistol.global_transform.is_equal_approx(back_anchor.global_transform), "retrieved item keeps slot world pose under hand root")
	check(pistol.freeze and pistol.collision_layer == 0 and pistol.collision_mask == 0, "retrieved rigid body stays frozen while it is attached to a hand marker")
	check(not adapter.store("sidearm", "hand:right", "back"), "stale owner cannot store a physical node")
	check(adapter.store("sidearm", "hand:left", "back"), "store to checkpointed slot succeeds")
	var saved: Dictionary = adapter.capture()
	# A host can rebuild authored nodes, register the same stable IDs and restore
	# ownership from JSON without serializing live Node references in the ledger.
	var restored_world := Node3D.new()
	var restored_left := Node3D.new()
	var restored_right := Node3D.new()
	var restored_backpack := Node3D.new()
	for host_root: Node3D in [restored_world, restored_left, restored_right, restored_backpack]: root.add_child(host_root)
	var restored_back_anchor := Node3D.new()
	restored_backpack.add_child(restored_back_anchor)
	var restored_adapter = Adapter.new()
	root.add_child(restored_adapter)
	check(restored_adapter.set_owner_root("world", restored_world), "restored world root configured")
	check(restored_adapter.set_owner_root("hand:left", restored_left), "restored left hand root configured")
	check(restored_adapter.set_owner_root("hand:right", restored_right), "restored right hand root configured")
	check(restored_adapter.register_slot("back", restored_back_anchor, ["pistol"], Vector3(0.32, 0.22, 0.06)), "stable back slot re-registered")
	var restored_cycle_anchor := Node3D.new()
	restored_backpack.add_child(restored_cycle_anchor)
	check(restored_adapter.register_slot("cycle", restored_cycle_anchor, ["pistol"], Vector3(0.32, 0.22, 0.06)), "stable cycle slot re-registered")
	var restored_pistol := RigidBody3D.new()
	restored_right.add_child(restored_pistol)
	var restored_spare := Node3D.new()
	restored_world.add_child(restored_spare)
	check(restored_adapter.register_item("sidearm", restored_pistol, "pistol", Vector3(0.24, 0.17, 0.04), "hand:right"), "stable weapon ID re-registered after host reconstruction")
	check(restored_adapter.register_item("spare_tool", restored_spare, "tool", Vector3(0.1, 0.1, 0.1), "world"), "stable supply ID re-registered after host reconstruction")
	var decoded_checkpoint: Variant = JSON.parse_string(JSON.stringify(saved))
	check(decoded_checkpoint is Dictionary, "inventory checkpoint is JSON serializable")
	check(restored_adapter.restore_inventory(decoded_checkpoint), "fresh scene adapter restores a JSON checkpoint by stable ID")
	check(restored_pistol.get_parent() == restored_back_anchor and restored_adapter.owner_of("sidearm") == "slot"
		and restored_adapter.slot_of("sidearm") == "back", "restored weapon returns to its physical backpack slot")
	check(restored_spare.get_parent() == restored_world and restored_adapter.owner_of("spare_tool") == "world",
		"restored world supply remains under the world owner")
	var missing_item_checkpoint: Dictionary = decoded_checkpoint.duplicate(true)
	missing_item_checkpoint.items.erase("sidearm")
	check(not restored_adapter.restore_inventory(missing_item_checkpoint), "checkpoint rejects a missing stable item ID")
	check(restored_pistol.get_parent() == restored_back_anchor and restored_adapter.owner_of("sidearm") == "slot",
		"missing-ID rejection leaves the rebuilt scene unchanged")
	check(adapter.retrieve("back", "world") == "sidearm", "post-capture retrieve mutates scene")
	check(adapter.restore_inventory(saved), "restore reconciles scene after checkpoint commit")
	check(pistol.get_parent() == back_anchor and adapter.owner_of("sidearm") == "slot", "checkpoint restore reattaches item and restores ledger claim")
	var world_snapshot := saved.duplicate(true)
	world_snapshot.items.sidearm.owner = "world"
	world_snapshot.items.sidearm.slot = ""
	world_snapshot.slots.back = ""
	var before_world_restore := pistol.global_transform
	check(adapter.restore_inventory(world_snapshot), "checkpoint can restore a world-owned item")
	check(pistol.get_parent() == world and pistol.global_transform.is_equal_approx(before_world_restore), "restore to world preserves the physical item's global pose")
	check(adapter.restore_inventory(saved) and pistol.get_parent() == back_anchor, "second restore returns the item to its saved slot")
	var before_bad: Dictionary = adapter.capture()
	var malformed := saved.duplicate(true)
	malformed.slots.back = "unknown_item"
	check(not adapter.restore_inventory(malformed), "invalid checkpoint is rejected")
	check(adapter.capture() == before_bad and pistol.get_parent() == back_anchor, "rejected checkpoint leaves ledger and scene untouched")
	var initial_owner_local := right_hand.global_transform.affine_inverse() * initial_pose
	right_hand.position += Vector3(10.0, 0.0, 0.0)
	check(adapter.reset_inventory(), "reset restores registered initial scene ownership")
	check(pistol.get_parent() == right_hand and pistol.global_transform.is_equal_approx(right_hand.global_transform * initial_owner_local), "reset preserves spawn transform relative to a moved hand root")
	check(pistol.freeze and pistol.collision_layer == 0 and pistol.collision_mask == 0, "reset keeps hand-owned rigid bodies safely attached to their marker")
	check(adapter.owner_of("sidearm") == "hand:right" and adapter.slot_of("sidearm").is_empty(), "reset clears slot claims in ledger")
	check(adapter.store("sidearm", "hand:right", "back"), "hand item stores after reset")
	check(adapter.retrieve("back", "world") == "sidearm", "stored reset item can be retrieved to world")
	check(adapter.reset_inventory() and pistol.get_parent() == right_hand and pistol.freeze,
		"reset after world retrieve restores the registered initial hand owner")
	check(adapter.store("sidearm", "hand:right", "back"), "hand item stores again after reset cycle")
	check(adapter.retrieve("back", "world") == "sidearm" and not pistol.freeze
		and pistol.collision_layer == 4 and pistol.collision_mask == 7,
		"store, world retrieve, reset, store, world retrieve restores the initial rigid body profile")
	check(adapter.reset_inventory(), "restore initial ownership before detached-owner test")
	check(adapter.store("sidearm", "hand:right", "back"), "store item before detached-owner test")
	var detached_left := Node3D.new()
	root.add_child(detached_left)
	check(adapter.set_owner_root("hand:left", detached_left), "detached-owner test root registered while in tree")
	root.remove_child(detached_left)
	check(adapter.retrieve("back", "hand:left").is_empty(), "retrieve rejects a detached owner root")
	check(adapter.owner_of("sidearm") == "slot" and pistol.get_parent() == back_anchor, "detached-root rejection leaves scene and ledger unchanged")
	detached_left.free()
	var rejected_while_root_stale := Node3D.new()
	world.add_child(rejected_while_root_stale)
	check(not adapter.register_item("stale_root_probe", rejected_while_root_stale, "tool", Vector3(0.1, 0.1, 0.04)),
		"new registration safely rejects any freed configured owner root")
	check(adapter.set_owner_root("hand:left", left_hand), "valid left-hand root is restored after detached-root test")
	check(adapter.register_item("stale_root_probe", rejected_while_root_stale, "tool", Vector3(0.1, 0.1, 0.04)),
		"registration succeeds again after the missing owner root is repaired")
	check(adapter.unregister_item("stale_root_probe", "world"), "root recovery probe unregisters cleanly")
	rejected_while_root_stale.queue_free()
	check(not adapter.unregister_item("spare_tool", "hand:left"), "consumption rejects an item under the wrong owner")
	check(adapter.unregister_item("spare_tool", "world"), "accepted destination can unregister a world-owned item")
	check(not adapter.inventory.has_item("spare_tool") and spare_item.get_parent() == world
		and adapter.owner_of("sidearm") == "slot", "unregister removes only ledger ownership and retains the physical node")
	var destruction_anchor := Node3D.new()
	destruction_anchor.name = "DestructionSlot"
	backpack.add_child(destruction_anchor)
	check(adapter.register_slot("destruction", destruction_anchor, ["pistol"], Vector3(0.32, 0.22, 0.06)),
		"dedicated destruction-test slot registers")
	var doomed := Node3D.new()
	doomed.name = "DestroyedStoredCargo"
	world.add_child(doomed)
	check(adapter.register_item("doomed_cargo", doomed, "pistol", Vector3(0.1, 0.1, 0.04)),
		"cargo intended for destruction registers through the shared scene adapter")
	check(adapter.store("doomed_cargo", "world", "destruction"), "cargo can occupy a physical slot before external destruction")
	var disposed_event := {"owner": "unset", "slot": "unset"}
	var disposed_listener := func(item_id: String, _from: String, to: String, slot_id: String) -> void:
		if item_id == "doomed_cargo":
			disposed_event.owner = to
			disposed_event.slot = slot_id
	adapter.ownership_changed.connect(disposed_listener)
	doomed.queue_free()
	await process_frame
	adapter.ownership_changed.disconnect(disposed_listener)
	check(not adapter.inventory.has_item("doomed_cargo") and adapter.owner_of("doomed_cargo").is_empty()
		and adapter.inventory.item_in_slot("destruction").is_empty(),
		"external destruction releases the item and physical slot claim")
	check(disposed_event.owner == "disposed" and disposed_event.slot == "destruction",
		"scene host reports which slot lost an externally destroyed item")
	var immediately_freed := Node3D.new()
	world.add_child(immediately_freed)
	check(adapter.register_item("immediate_free_cargo", immediately_freed, "pistol", Vector3(0.1, 0.1, 0.04)),
		"immediate-free cargo registers")
	check(adapter.store("immediate_free_cargo", "world", "destruction"), "immediate-free cargo occupies its slot")
	var immediate_disposed_event := {"owner": "unset", "slot": "unset"}
	var immediate_listener := func(item_id: String, _from: String, to: String, slot_id: String) -> void:
		if item_id == "immediate_free_cargo":
			immediate_disposed_event.owner = to
			immediate_disposed_event.slot = slot_id
	adapter.ownership_changed.connect(immediate_listener)
	immediately_freed.free()
	await process_frame
	adapter.ownership_changed.disconnect(immediate_listener)
	check(not adapter.inventory.has_item("immediate_free_cargo") and adapter.owner_of("immediate_free_cargo").is_empty()
		and adapter.inventory.item_in_slot("destruction").is_empty(),
		"immediate free releases the ledger item and occupied slot")
	check(immediate_disposed_event.owner == "disposed" and immediate_disposed_event.slot == "destruction",
		"immediate free reports disposal with the former slot")
	var detached_item := Node3D.new()
	detached_item.name = "DetachedRegisteredItem"
	world.add_child(detached_item)
	check(adapter.register_item("detached_item", detached_item, "tool", Vector3(0.1, 0.1, 0.04)),
		"a world item registers before an external permanent detach")
	world.remove_child(detached_item)
	await process_frame
	check(not adapter.inventory.has_item("detached_item") and adapter.owner_of("detached_item").is_empty(),
		"a registered item left detached from the scene releases its ledger entry")
	detached_item.free()
	print("GEAR_INVENTORY_SCENE_ADAPTER checks=%d failures=%d" % [checks, failures.size()])
	quit(1 if not failures.is_empty() else 0)
