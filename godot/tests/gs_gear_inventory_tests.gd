extends SceneTree
const Inventory = preload("res://addons/gs_gear_inventory/gs_gear_inventory.gd")
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
	var inventory = Inventory.new()
	var pistol := RefCounted.new()
	var medkit := RefCounted.new()
	var oversized := RefCounted.new()
	var equipped_weapon := RefCounted.new()
	check(inventory.add_slot("right_hip", ["pistol"], Vector3(0.31,0.20,0.045)), "slot accepts valid category and size")
	check(inventory.add_slot("back", ["long_gun", "tool"], Vector3(0.72,0.32,0.12)), "second independent slot registers")
	check(not inventory.add_slot("right_hip", ["pistol"], Vector3.ONE), "duplicate slot IDs rejected")
	check(not inventory.add_slot("bad", ["pistol"], Vector3(0,-1,1)), "invalid slot size rejected")
	check(inventory.register_item("kestrel", pistol, "pistol", Vector3(0.24,0.17,0.041), "hand:right"), "item registers with initial hand owner")
	check(inventory.register_item("equipped_rifle", equipped_weapon, "long_gun", Vector3(0.6,0.2,0.08), "equipped"),
		"selected weapon registers under the equipped owner")
	check(inventory.transfer("equipped_rifle", "equipped", "world") and inventory.transfer("equipped_rifle", "world", "equipped"),
		"equipped weapon can transfer through the world owner")
	check(inventory.register_item("medkit", medkit, "tool", Vector3(0.14,0.08,0.09)), "second item registers")
	check(inventory.register_item("oversized", oversized, "long_gun", Vector3(1.0,0.2,0.1)), "oversized item registers independently of slot")
	check(not inventory.register_item("kestrel", RefCounted.new(), "pistol", Vector3.ONE), "duplicate item IDs rejected")
	check(not inventory.register_item("bad_size", RefCounted.new(), "pistol", Vector3(0.1, NAN, 0.1)), "non-finite item size rejected")
	check(not inventory.register_item("bad_owner", RefCounted.new(), "pistol", Vector3.ONE, "slot"), "initial owner cannot bypass slot claim")
	check(not inventory.can_store("medkit", "world", "right_hip"), "category mismatch blocks storage")
	check(not inventory.can_store("oversized", "world", "back"), "size mismatch blocks storage")
	check(not inventory.store("kestrel", "world", "right_hip"), "wrong expected owner cannot claim item")
	check(inventory.store("kestrel", "hand:right", "right_hip"), "valid hand-to-slot transfer succeeds")
	check(inventory.owner_of("kestrel") == "slot" and inventory.slot_of("kestrel") == "right_hip", "successful store updates item owner and slot")
	check(inventory.item_in_slot("right_hip") == "kestrel", "slot points to its one registered item")
	check(not inventory.store("medkit", "world", "right_hip"), "occupied slot remains exclusive")
	check(not inventory.transfer("kestrel", "slot", "hand:left"), "generic transfer cannot bypass slot retrieval")
	check(inventory.retrieve("right_hip", "hand:left") == "kestrel", "retrieve moves same item to requested hand")
	check(inventory.item_ref("kestrel") == pistol and inventory.owner_of("kestrel") == "hand:left", "retrieve preserves physical object identity")
	check(inventory.retrieve("right_hip", "hand:right").is_empty(), "empty slot retrieval is a no-op")
	check(inventory.transfer("kestrel", "hand:left", "world"), "hand-to-world transfer succeeds")
	check(not inventory.transfer("kestrel", "hand:left", "hand:right"), "stale owner cannot transfer item")
	check(inventory.store("medkit", "world", "back"), "rotated category-compatible dimensions fit the back slot")
	var checkpoint: Dictionary = inventory.capture()
	var prepared: Dictionary = inventory.prepare_restore(checkpoint)
	check(bool(prepared.get("valid", false)), "captured ownership state prepares")
	check(inventory.transfer("equipped_rifle", "equipped", "world"), "test mutates equipped weapon after capture")
	check(inventory.retrieve("back", "hand:right") == "medkit", "test mutates state after capture")
	check(inventory.commit_restore(prepared), "prepared checkpoint commits")
	check(inventory.owner_of("medkit") == "slot" and inventory.item_in_slot("back") == "medkit", "checkpoint restores consistent ownership indices")
	check(inventory.owner_of("equipped_rifle") == "equipped" and inventory.item_ref("equipped_rifle") == equipped_weapon,
		"checkpoint restores equipped weapon ownership and identity")
	var before_invalid: Dictionary = inventory.capture()
	var malformed: Dictionary = checkpoint.duplicate(true)
	malformed.items.medkit.slot = "right_hip"
	var invalid_prepare: Dictionary = inventory.prepare_restore(malformed)
	check(not bool(invalid_prepare.get("valid", true)), "slot-owner mismatch checkpoint is rejected")
	check(inventory.capture() == before_invalid, "failed prepare leaves live inventory unchanged")
	check(not inventory.commit_restore(invalid_prepare), "invalid prepared state cannot commit")
	var duplicate_claim: Dictionary = checkpoint.duplicate(true)
	duplicate_claim.slots.right_hip = "medkit"
	var duplicate_prepared: Dictionary = inventory.prepare_restore(duplicate_claim)
	check(not bool(duplicate_prepared.get("valid", true)), "checkpoint cannot claim one item in two slots")
	var wrong_version: Dictionary = checkpoint.duplicate(true)
	wrong_version.version = 999
	check(not bool(inventory.prepare_restore(wrong_version).get("valid", true)), "unknown checkpoint version rejected")
	var fractional_version: Dictionary = checkpoint.duplicate(true)
	fractional_version.version = 1.5
	check(not bool(inventory.prepare_restore(fractional_version).get("valid", true)), "fractional checkpoint version rejected")
	var string_version: Dictionary = checkpoint.duplicate(true)
	string_version.version = "1"
	check(not bool(inventory.prepare_restore(string_version).get("valid", true)), "string checkpoint version rejected")
	var numeric_owner: Dictionary = checkpoint.duplicate(true)
	numeric_owner.items.kestrel.owner = 7
	check(not bool(inventory.prepare_restore(numeric_owner).get("valid", true)), "numeric checkpoint owner rejected")
	var numeric_slot: Dictionary = checkpoint.duplicate(true)
	numeric_slot.items.medkit.slot = 7
	check(not bool(inventory.prepare_restore(numeric_slot).get("valid", true)), "numeric checkpoint slot rejected")
	var numeric_claim: Dictionary = checkpoint.duplicate(true)
	numeric_claim.slots.back = 7
	check(not bool(inventory.prepare_restore(numeric_claim).get("valid", true)), "numeric checkpoint slot claim rejected")
	inventory.reset()
	check(inventory.owner_of("kestrel") == "hand:right" and inventory.slot_of("kestrel").is_empty(), "reset restores original ownership")
	check(inventory.owner_of("equipped_rifle") == "equipped", "reset restores the equipped weapon owner")
	check(inventory.owner_of("medkit") == "world" and inventory.item_in_slot("back").is_empty(), "reset clears every slot claim")
	var callback_result := {"retrieve":"unset", "transfer":true, "reset_blocked":false}
	var reentrant_listener := func(item_id: String, _from_owner: String, to_owner: String, slot_id: String) -> void:
		callback_result.retrieve = inventory.retrieve(slot_id, "world")
		callback_result.transfer = inventory.transfer(item_id, to_owner, "world")
		inventory.reset()
		callback_result.reset_blocked = inventory.owner_of(item_id) == "slot"
	inventory.ownership_changed.connect(reentrant_listener)
	check(inventory.store("kestrel", "hand:right", "right_hip"), "store succeeds while observers run")
	inventory.ownership_changed.disconnect(reentrant_listener)
	check(String(callback_result.retrieve).is_empty(), "reentrant retrieve is rejected during ownership callback")
	check(not bool(callback_result.transfer), "reentrant transfer is rejected during ownership callback")
	check(bool(callback_result.reset_blocked) and inventory.item_in_slot("right_hip") == "kestrel", "reentrant reset cannot invalidate reported store")
	check(not inventory.unregister_item("kestrel", "hand:right"), "consumption cannot remove an item under the wrong owner")
	check(inventory.store("medkit", "world", "back"), "consumable fixture is placed in its slot")
	check(inventory.unregister_item("medkit", "slot"), "a consuming system can unregister an accepted slotted item")
	check(not inventory.has_item("medkit") and inventory.item_ref("medkit") == null
		and inventory.item_in_slot("back").is_empty(), "unregister clears item and reverse slot indexes")
	check(not bool(inventory.prepare_restore(checkpoint).get("valid", true)),
		"old checkpoint is rejected after the registered item set changes")
	inventory.dispose()
	inventory.dispose()
	check(inventory.is_disposed(), "dispose is idempotent")
	check(inventory.owner_of("kestrel").is_empty() and inventory.item_ref("kestrel") == null, "disposed inventory exposes no retained items")
	check(not inventory.store("kestrel", "hand:right", "right_hip") and not inventory.add_slot("later", ["pistol"], Vector3.ONE), "disposed inventory rejects further changes")
	print("GEAR_INVENTORY checks=%d failures=%d" % [checks, failures.size()])
	quit(1 if not failures.is_empty() else 0)
