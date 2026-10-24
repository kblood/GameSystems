extends SceneTree
## P2 contract checks for the container ledger on top of the REAL NightfallGearInventory (the golden-vector parity test covers the rules
## against the JS core; this one proves the additive layer works with the actual inventory and leaves its checkpoint format alone).
##   godot --headless --path godot --script res://addons/gs_backpack/tests/gs_backpack_container_tests.gd
const BpContainer = preload("res://addons/gs_backpack/gs_backpack_container.gd")
const BpStash = preload("res://addons/gs_backpack/gs_backpack_stash.gd")
const ProfileExt = preload("res://addons/gs_backpack/gs_backpack_profile_ext.gd")
const Profile = preload("res://addons/gs_backpack/gs_backpack_profile.gd")
const State = preload("res://addons/gs_backpack/gs_backpack_state.gd")
const SZ := Vector3(0.10, 0.05, 0.03)

var checks := 0
var failures: Array[String] = []

func _initialize() -> void:
	call_deferred("run")

func check(value: bool, label: String) -> void:
	checks += 1
	if not value:
		failures.append(label)
		push_error("GS_BACKPACK_CONTAINER: " + label)

func example() -> Dictionary: return JSON.parse_string(FileAccess.get_file_as_string(Profile.EXAMPLE_PATH))
func stash_example() -> Dictionary: return JSON.parse_string(FileAccess.get_file_as_string("res://addons/gs_backpack/data/profile.stash.example.json"))

func make(profile: Dictionary, inv: NightfallGearInventory, events: Array = [], options: Dictionary = {}) -> BpContainer:
	var c := BpContainer.new()
	var o := options.duplicate()
	o["emit"] = func(type: String, data: Dictionary) -> void: events.append(type)
	check(c.configure(profile, inv, o), "configure " + String(profile.get("id", "?")))
	return c

func run() -> void:
	# --- rules on the real inventory
	var inv := NightfallGearInventory.new()
	var events: Array = []
	var c := make(example(), inv, events)
	check(inv.item_in_slot("field_pack/main_tool/0") == "" and c.cell_ids("main_tool").size() == 2, "cells exist as provider slots field_pack/<pocket>/<i>")
	for id in ["t1", "t2", "t3"]: check(c.register_item(id, null, "tool", SZ), "register " + id)
	check(c.register_item("s1", null, "supply", SZ), "register supply")
	check(c.register_item("g1", null, "pistol", SZ), "register pistol")
	check(c.register_item("big", null, "supply", Vector3(0.5, 0.1, 0.1)), "register big")
	check(not c.register_item("t1", null, "tool", SZ), "duplicate id refused")
	var r: Dictionary = c.store("t1", "main_tool")
	check(bool(r.ok) and r.cell == "field_pack/main_tool/0" and inv.slot_of("t1") == r.cell, "store fills the first free cell")
	check(c.store("t2", "main_tool").cell == "field_pack/main_tool/1", "second cell")
	check(c.store("t3", "main_tool").reason == "FULL", "FULL when the pocket is full")
	check(c.store("s1", "main_tool").reason == "WRONG_ITEM", "WRONG_ITEM for a wrong category")
	check(c.store("big", "main_case").reason == "TOO_LARGE" or c.store("big", "main_case").reason == "WRONG_ITEM", "oversize is refused")
	check(c.store("ghost", "main_tool").reason == "UNKNOWN_ITEM", "UNKNOWN_ITEM")
	check(c.store("s1", "nowhere").reason == "UNKNOWN_POCKET", "UNKNOWN_POCKET")
	check(c.store("t1", "main_tool").reason == "NOT_OWNED", "NOT_OWNED for an item already in a cell")
	check(c.register_item("odd", null, "tool", Vector3(NAN, 1, 1)) == false, "invalid size refused by the provider")
	check(c.check("t3", "main_tool").reason == "FULL", "check is pure")
	var got: Dictionary = c.retrieve("main_tool", "t1", "hand:left")
	check(bool(got.ok) and got.itemId == "t1" and inv.owner_of("t1") == "hand:left", "retrieve to a hand")
	check(c.retrieve("main_tool", "t1").reason == "NOT_FOUND" and c.retrieve("main_case").reason == "EMPTY", "NOT_FOUND / EMPTY")
	check(c.store("t1", "main_tool", "hand:left").ok, "store from a hand")
	# stable ids and move
	check(bool(c.move("t1", "side_pouch").ok) or c.move("t1", "side_pouch").reason != "", "move gives a result")
	check(inv.has_item("t1") and inv.owner_of("t1") != "", "ids are stable")
	check(c.store_all(["s1"], "main_supply").ok and c.locate("s1").pocketId == "main_supply", "store_all and locate")
	check(events.has("backpack:placing") and events.has("backpack:placed") and events.has("backpack:stored"), "placing/stored/placed events")
	check(events.find("backpack:placing") < events.find("backpack:placed"), "placing comes before placed")

	# --- mount acceptOnly, validators, snap modes
	var mount_pack := example()
	mount_pack["id"] = "mpack"
	mount_pack.pockets[4]["mount"] = {"acceptOnly": ["sidearm", "pistol_a"], "snapMode": "dropped", "returnDelayS": 0.5}
	var inv2 := NightfallGearInventory.new()
	var m := make(mount_pack, inv2)
	var pid: String = mount_pack.pockets[4].id
	check(m.register_item("pa", null, "pistol", SZ, "world", ["pistol_a"]) and m.register_item("pb", null, "pistol", SZ), "register pistols")
	check(m.store("pb", pid).reason == "NOT_ACCEPTED", "mount acceptOnly rejects")
	check(m.offer("pa", pid).reason == "NOT_RELEASED", "dropped needs a release")
	check(m.offer("pa", pid, true).ok, "dropped snaps once released")
	var veto := func(e: Dictionary) -> bool: return e.kind != "removing"
	m.add_validator(veto)
	check(m.retrieve(pid).reason == "VETOED", "validator vetoes removing")
	m.clear_validators()
	check(m.retrieve(pid, "", "world").ok, "retrieve after validators are cleared")
	check(bool(m.schedule_return("pa", pid).ok) and m.tick(0.3).is_empty() and m.tick(0.3).size() == 1 and m.locate("pa").pocketId == pid, "timed return after returnDelayS")

	# --- materialisation limit, one refresh path
	var many := example()
	many["id"] = "many"
	many["tiers"] = {"high": {"physicalItemsMax": 3.0}}
	var inv3 := NightfallGearInventory.new()
	var v := make(many, inv3)
	for i in 5:
		v.register_item("s%d" % i, null, "supply", SZ)
		check(v.store("s%d" % i, "main_supply").ok or i >= 3, "fill supply %d" % i)
	var view: Dictionary = v.view({"tab": "main_supply"})
	check(view.mode == "physical" and view.items.size() <= 3 and view.pageSize == 3, "materialisation limit caps the proxies")
	v.set_tier("low")
	check(v.view().mode == "slots" and v.material_limit() == 0, "low tier is a slot view")
	v.set_tier("high")
	var refreshes := [0]
	v.on_refresh(func(_x: Dictionary) -> void: refreshes[0] += 1)
	v.hold("s0")
	check(not _has_item(v.view({"tab": "main_supply"}), "s0") and refreshes[0] == 1, "held items are left out; one refresh per change")
	v.unhold("s0")
	var guard := [0]
	v.on_refresh(func(_x: Dictionary) -> void:
		if guard[0] == 0:
			guard[0] = 1
			v.refresh())
	var before: int = v.refresh_stats().refreshes
	v.refresh()
	check(v.refresh_stats().deferred >= 1 and int(v.refresh_stats().refreshes) <= before + int(Profile.data().VIEW.MAX_REFRESH_PASSES), "re-entrant refresh is coalesced and capped")
	check(ProfileExt.material_limit(many, "high") == 3 and ProfileExt.material_limit(example(), "low") == 0, "material_limit()")
	var too_many := example()
	too_many["tiers"] = {"high": {"physicalItemsMax": 13.0}}
	check(not bool(ProfileExt.parse(too_many).ok), "limit above 12 refused")

	# --- checkpoint v2: backpack layer only; the inventory checkpoint is not touched and a missing payload is accepted
	var inv_cp_before: Dictionary = inv.capture()
	var cp: Dictionary = c.capture_checkpoint()
	check(cp.schema == "gamesystems.backpack-checkpoint.v2" and cp.profileId == "field_pack" and cp.has("ledger") and cp.bag == null, "checkpoint v2 shape")
	check(JSON.parse_string(JSON.stringify(cp)) is Dictionary, "checkpoint is JSON-safe")
	check(first_keys(inv.capture()) == ["items", "slots", "version"] and inv.capture().hash() == inv_cp_before.hash(), "inventory checkpoint format and content unchanged by the layer")
	var layer_cells: Dictionary = c.capture().cells
	c.retrieve("main_tool")
	var restored: Dictionary = c.restore_checkpoint(cp)
	check(bool(restored.ok) and not bool(restored.absent) and restored.version == 2 and c.capture().cells.hash() == layer_cells.hash(), "restore v2 puts the cells back")
	var absent: Dictionary = c.restore_checkpoint(null)
	check(bool(absent.ok) and bool(absent.absent) and c.capture().cells.hash() == layer_cells.hash(), "missing backpack state is an accepted no-op")
	var bad: Dictionary = cp.duplicate(true)
	bad["profileId"] = "other"
	check(not bool(c.restore_checkpoint(bad).ok) and not bool(c.restore_checkpoint("junk").ok), "wrong profile or junk is refused")
	var with_bag := State.new()
	check(with_bag.configure(example()), "bag state configures")
	var cp_bag: Dictionary = c.capture_checkpoint(with_bag)
	check(cp_bag.bag is Dictionary and bool(c.restore_checkpoint(cp_bag, with_bag).ok), "v2 with the bag state round-trips")
	check(bool(c.restore_checkpoint(c.capture()).ok) and c.restore_checkpoint(c.capture()).version == 1, "a bare ledger v1 is accepted")

	# --- stash
	var inv4 := NightfallGearInventory.new()
	var sevents: Array = []
	var stash := BpStash.new()
	check(stash.configure(stash_example(), inv4, {"emit": func(type: String, _d: Dictionary) -> void: sevents.append(type)}), "stash configures")
	check(not BpStash.new().configure(example(), NightfallGearInventory.new()), "a pack profile is not a stash")
	stash.container.register_item("t1", null, "tool", SZ)
	stash.container.register_item("t2", null, "tool", SZ)
	check(stash.container.store("t1", "drawer").ok, "drawer is always reachable")
	check(stash.container.store("t2", "shelf").reason == "NOT_ACCESSIBLE", "shelf needs the stash open")
	stash.open()
	check(stash.container.store("t2", "shelf").ok and sevents.has("backpack:stash_open"), "open stash reaches the shelf")
	var scp: Dictionary = stash.capture()
	stash.close()
	check(not stash.is_open and stash.container.retrieve("shelf").reason == "NOT_ACCESSIBLE", "close shuts the shelf")
	check(stash.restore(scp) and stash.is_open, "stash restores its open state")
	check(not stash.restore({"schema": "gamesystems.backpack-stash.v1", "profileId": "wall_locker", "open": "yes"}), "bad stash checkpoint refused")
	check(not ProfileExt.parse(_with(stash_example(), "handle", {"local": [0, 0, 0]})).ok, "a stash has no handle")

	print("GS_BACKPACK_CONTAINER checks=%d failures=%d" % [checks, failures.size()])
	quit(1 if not failures.is_empty() else 0)

func _has_item(view: Dictionary, id: String) -> bool:
	for i in view.items:
		if i.itemId == id: return true
	return false

func first_keys(d: Dictionary) -> Array:
	var k := d.keys()
	k.sort()
	return k

func _with(d: Dictionary, key: String, value: Variant) -> Dictionary:
	var o := d.duplicate(true)
	o[key] = value
	return o
