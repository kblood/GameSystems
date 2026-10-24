class_name GSBackpackSlotAlias
extends RefCounted
## P3: lets the container layer (GSBackpackContainer) sit on top of a ledger whose slots already exist, WITHOUT adding slots to it.
## The container names its cells "<profileId>/<pocketId>/<i>"; this provider maps every such cell onto an existing slot id of the real
## provider (NightfallGearInventorySceneAdapter or NightfallGearInventory) and forwards store/retrieve/owner_of/slot_of/item_in_slot to it.
## So the real ledger, its slot set and therefore its checkpoint format never change (design doc 3.5: the layer is purely additive).
##
## Duck type of the container's provider: add_slot, register_item, store, retrieve, item_in_slot, slot_of, owner_of.
## add_slot() only accepts cells that were mapped up front (a typo cannot silently create a slot). Two cells never share a real slot.

var _real: Object
var _queries: Object
var _cell_to_slot: Dictionary = {}
var _slot_to_cell: Dictionary = {}

## cell_slots: {cell_id: real_slot_id}. Returns false when the map is invalid or the real provider lacks a method.
func configure(real_provider: Object, cell_slots: Dictionary) -> bool:
	if real_provider == null or cell_slots.is_empty(): return false
	for m in ["register_item", "store", "retrieve", "slot_of", "owner_of"]:
		if not real_provider.has_method(m): return false
	# NightfallGearInventorySceneAdapter keeps the ledger query on its public `inventory`; a bare ledger has it itself.
	_queries = real_provider if real_provider.has_method("item_in_slot") else real_provider.get("inventory")
	if _queries == null or not _queries.has_method("item_in_slot"): return false
	var c2s := {}
	var s2c := {}
	for cell in cell_slots:
		var slot := String(cell_slots[cell])
		if String(cell).is_empty() or slot.is_empty() or s2c.has(slot): return false
		c2s[String(cell)] = slot
		s2c[slot] = String(cell)
	_real = real_provider
	_cell_to_slot = c2s
	_slot_to_cell = s2c
	return true

func real_slot(cell: String) -> String: return String(_cell_to_slot.get(cell, ""))
func cell_of_slot(slot: String) -> String: return String(_slot_to_cell.get(slot, ""))
func cells() -> Array: return _cell_to_slot.keys()

func add_slot(slot_id: String, _categories: Array[String], _max_size: Vector3) -> bool:
	return _cell_to_slot.has(slot_id)

func register_item(item_id: String, item_ref: Variant, category: String, size: Vector3, owner := "world") -> bool:
	return bool(_real.register_item(item_id, item_ref, category, size, owner))

func store(item_id: String, expected_owner: String, cell: String) -> bool:
	if not _cell_to_slot.has(cell): return false
	return bool(_real.store(item_id, expected_owner, _cell_to_slot[cell]))

func retrieve(cell: String, new_owner: String) -> String:
	if not _cell_to_slot.has(cell): return ""
	return String(_real.retrieve(_cell_to_slot[cell], new_owner))

func item_in_slot(cell: String) -> String:
	if not _cell_to_slot.has(cell): return ""
	return String(_queries.item_in_slot(_cell_to_slot[cell]))

## The cell id when the item sits in an aliased slot (the container's locate() needs that), else the real slot id.
func slot_of(item_id: String) -> String:
	var slot := String(_real.slot_of(item_id))
	return String(_slot_to_cell.get(slot, slot))

func owner_of(item_id: String) -> String:
	return String(_real.owner_of(item_id))
