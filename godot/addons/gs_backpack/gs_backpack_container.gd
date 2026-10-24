class_name GSBackpackContainer
extends RefCounted
## P2: Godot twin of extensions/backpack/ledger.js (+ checkpoint.js). A NEW, additive layer on top of an existing inventory provider
## (NightfallGearInventory, or GSBackpackSceneAdapter's provider facade); it changes neither the provider nor its checkpoint format.
##
## One pocket with capacity N is N provider slots named "<profileId>/<pocketId>/<index>"; each cell holds one item. Item IDs are stable (the
## container never renames, copies or recreates an item). Every transfer is atomic: it completes or the provider is back where it started.
## Rejection reasons: UNKNOWN_POCKET, NOT_ACCESSIBLE, UNKNOWN_ITEM, NOT_OWNED, INVALID_SIZE, WRONG_ITEM, NOT_ACCEPTED (mount acceptOnly),
## TOO_LARGE, FULL, then validators (VETOED), then the provider (PROVIDER_REJECTED); plus EMPTY, NOT_FOUND, SNAP_DISABLED, NOT_RELEASED.
## Same check order and results as the JS ledger; tests/gs_backpack_parity_tests.gd replays the shared golden vectors against both.
##
## NightfallGearInventory has no public item info (category/size), so the container keeps a small registry of what register_item() passed
## through, or asks an optional `info_provider` Callable(item_id) -> {category, size:[x,y,z], owner, tags?} (empty = unknown). An item the
## provider knows but the container has no info for skips the category/size checks and is left to the provider (PROVIDER_REJECTED).
##
## Provider duck type: add_slot(id, Array[String], Vector3) -> bool, register_item(id, ref, category, Vector3, owner) -> bool,
## store(item, expected_owner, slot) -> bool, retrieve(slot, new_owner) -> String, item_in_slot(slot), slot_of(item), owner_of(item).
##
## Materialisation limit and ONE refresh path: view() lists at most N items (N = physicalItemsMax on a tier with physicalItems, else a slot
## view without cap); held items are left out; every change goes through refresh(), guarded against re-entrancy (a change a listener makes
## during a refresh is applied at once, its refresh is coalesced into one more pass). Design doc 3.4 and research 1.11.

const Profile = preload("res://addons/gs_backpack/gs_backpack_profile.gd")
const ProfileExt = preload("res://addons/gs_backpack/gs_backpack_profile_ext.gd")
const LEDGER_SCHEMA := "gamesystems.backpack-ledger.v1"
const CHECKPOINT_SCHEMA := "gamesystems.backpack-checkpoint.v2"
const SYSTEM_V1_SCHEMA := "gamesystems.backpack-system.v1"
const ALL_TAB := "*"
const EPS := 0.000000001

var profile: Dictionary = {}
var _provider: Object
var _can_access: Callable
var _emit: Callable
var _info_provider: Callable
var _transit_owner := "world"
var _tier_name := "high"
var _tier_fn: Callable
var _pockets: Dictionary = {}
var _order: Array[String] = []
var _cell_owner: Dictionary = {}
var _registry: Dictionary = {}
var _validators: Array[Callable] = []
var _listeners: Array[Callable] = []
var _held: Dictionary = {}
var _pending: Dictionary = {}
var _refreshes := 0
var _deferred := 0
var _sel_tab := ALL_TAB
var _sel_page: Variant = 0
var _refreshing := false
var _again := false

## options: can_access: Callable(pocket_id) -> bool (default: always), emit: Callable(type, data), transit_owner: String ("world"),
## info_provider: Callable(item_id) -> Dictionary, tier: String ("high") or Callable() -> String.
## Returns false (container unusable) when the profile is invalid, the provider lacks a method or refuses a slot.
func configure(raw_profile: Variant, provider: Object, options: Dictionary = {}) -> bool:
	var parsed: Dictionary = ProfileExt.parse(raw_profile)
	if not bool(parsed.ok) or provider == null: return false
	for m in ["add_slot", "register_item", "store", "retrieve", "item_in_slot", "slot_of", "owner_of"]:
		if not provider.has_method(m): return false
	profile = parsed.profile
	_provider = provider
	_can_access = options.get("can_access", Callable())
	_emit = options.get("emit", Callable())
	_info_provider = options.get("info_provider", Callable())
	_transit_owner = String(options.get("transit_owner", "world"))
	var tier: Variant = options.get("tier", "high")
	if tier is Callable: _tier_fn = tier
	else: _tier_name = String(tier)
	_pockets = {}
	_order = []
	_cell_owner = {}
	for k in profile.pockets:
		var cells: Array[String] = []
		for i in int(k.capacity): cells.append("%s/%s/%d" % [profile.id, k.id, i])
		var pocket: Dictionary = k.duplicate(true)
		pocket["cells"] = cells
		_pockets[k.id] = pocket
		_order.append(String(k.id))
		var cats: Array[String] = []
		for c in k.categories: cats.append(String(c))
		var size: Array = k.maxSize
		for cell in cells:
			if not bool(_provider.add_slot(cell, cats, Vector3(float(size[0]), float(size[1]), float(size[2])))): return false
			_cell_owner[cell] = String(k.id)
	return true

## Registers an item with the provider and remembers its category/size/tags for the checks. size is a Vector3 or [x, y, z].
func register_item(item_id: String, item_ref: Variant, category: String, size: Variant, owner := "world", tags: Array = []) -> bool:
	var v := _vec3(size)
	if not bool(_provider.register_item(item_id, item_ref if item_ref != null else item_id, category, v, owner)): return false
	_registry[item_id] = {"category": category, "size": [v.x, v.y, v.z], "tags": tags.duplicate()}
	return true

func pocket_ids() -> Array: return _order.duplicate()
func cell_ids(pocket_id: String) -> Array: return _pockets[pocket_id].cells.duplicate()
func items_in(pocket_id: String) -> Array:
	var out: Array = []
	if not _pockets.has(pocket_id): return out
	for c in _pockets[pocket_id].cells:
		var id := String(_provider.item_in_slot(c))
		if not id.is_empty(): out.append(id)
	return out
func free_cells(pocket_id: String) -> int:
	var n := 0
	for c in _pockets[pocket_id].cells:
		if String(_provider.item_in_slot(c)).is_empty(): n += 1
	return n
## {pocketId, cell} or {} when the item is in no cell of this container.
func locate(item_id: String) -> Dictionary:
	var c := String(_provider.slot_of(item_id))
	if not c.is_empty() and _cell_owner.has(c): return {"pocketId": _cell_owner[c], "cell": c}
	return {}
func mount_of(pocket_id: String) -> Dictionary:
	if not _pockets.has(pocket_id) or not _pockets[pocket_id].has("mount"): return {}
	return _pockets[pocket_id].mount.duplicate(true)

## Validator for placing/removing (UltimateXR AddPlacingValidator): Callable({kind, itemId, pocketId}) -> false or a reason String vetoes.
func add_validator(fn: Callable) -> void: _validators.append(fn)
func remove_validator(fn: Callable) -> void: _validators.erase(fn)
func clear_validators() -> void: _validators.clear()

## Releases every Callable/Object reference the ledger holds (validators, refresh listeners, emit/can_access/info/tier callbacks, provider)
## so RefCounted cycles (a listener or option Callable bound to its own owner, e.g. a GSBackpackStash) cannot outlive the owner. Call it when
## the container is discarded; afterwards it must be configure()d again before use.
func dispose() -> void:
	_validators.clear()
	_listeners.clear()
	_can_access = Callable()
	_emit = Callable()
	_info_provider = Callable()
	_tier_fn = Callable()
	_provider = null

# ---------------------------------------------------------------- checks and transfers
## Pure check of a store (no validators, no changes): {ok, reason, cell}.
func check(item_id: String, pocket_id: String, expected_owner := "world") -> Dictionary:
	if not _pockets.has(pocket_id): return _fail("UNKNOWN_POCKET")
	if not _accessible(pocket_id): return _fail("NOT_ACCESSIBLE")
	var info: Dictionary = _info(item_id)
	if info.is_empty(): return _fail("UNKNOWN_ITEM")
	if String(info.owner) != expected_owner: return _fail("NOT_OWNED")
	var k: Dictionary = _pockets[pocket_id]
	if not _valid_size(info.size): return _fail("INVALID_SIZE")
	if not String(info.category) in k.categories: return _fail("WRONG_ITEM")
	if not _accepts(k, item_id, info): return _fail("NOT_ACCEPTED")
	if not Profile.size_fits(info.size, k.maxSize): return _fail("TOO_LARGE")
	var cell := _free_cell(pocket_id)
	if cell.is_empty(): return _fail("FULL")
	return {"ok": true, "reason": "", "cell": cell}

## hand/world -> pocket. Atomic; on a provider failure nothing changed.
func store(item_id: String, pocket_id: String, expected_owner := "world") -> Dictionary:
	var c: Dictionary = check(item_id, pocket_id, expected_owner)
	if not bool(c.ok): return c
	if not _gate("placing", item_id, pocket_id): return _fail("VETOED")
	_note("backpack:placing", {"itemId": item_id, "pocketId": pocket_id, "cell": c.cell})
	if not bool(_provider.store(item_id, expected_owner, c.cell)): return _fail("PROVIDER_REJECTED")
	_held.erase(item_id)
	_note("backpack:stored", {"itemId": item_id, "pocketId": pocket_id, "cell": c.cell})
	_note("backpack:placed", {"itemId": item_id, "pocketId": pocket_id, "cell": c.cell})
	refresh()
	return {"ok": true, "reason": "", "cell": c.cell}

## pocket -> hand/world. item_id optional ("" = the first item in cell order).
func retrieve(pocket_id: String, item_id := "", new_owner := "world") -> Dictionary:
	if not _pockets.has(pocket_id): return _fail("UNKNOWN_POCKET")
	if not _accessible(pocket_id): return _fail("NOT_ACCESSIBLE")
	var cell := ""
	for c in _pockets[pocket_id].cells:
		var here := String(_provider.item_in_slot(c))
		if (item_id.is_empty() and not here.is_empty()) or (not item_id.is_empty() and here == item_id):
			cell = c
			break
	if cell.is_empty(): return _fail("EMPTY" if item_id.is_empty() else "NOT_FOUND")
	var target := String(_provider.item_in_slot(cell))
	if not _gate("removing", target, pocket_id): return _fail("VETOED")
	_note("backpack:removing", {"itemId": target, "pocketId": pocket_id, "cell": cell})
	var got := String(_provider.retrieve(cell, new_owner))
	if got.is_empty(): return _fail("PROVIDER_REJECTED")
	_held.erase(got)
	_note("backpack:retrieved", {"itemId": got, "pocketId": pocket_id, "cell": cell})
	_note("backpack:removed", {"itemId": got, "pocketId": pocket_id, "cell": cell})
	refresh()
	return {"ok": true, "reason": "", "itemId": got, "cell": cell}

## Pocket to pocket. The destination is checked first; if the provider fails midway the item is put back (rollback).
func move(item_id: String, to_pocket_id: String) -> Dictionary:
	var from: Dictionary = locate(item_id)
	if from.is_empty(): return _fail("NOT_FOUND")
	if not _accessible(from.pocketId): return _fail("NOT_ACCESSIBLE")
	if from.pocketId == to_pocket_id: return {"ok": true, "reason": "", "cell": from.cell}
	var info: Dictionary = _info(item_id)
	if not _pockets.has(to_pocket_id): return _fail("UNKNOWN_POCKET")
	if not _accessible(to_pocket_id): return _fail("NOT_ACCESSIBLE")
	var to: Dictionary = _pockets[to_pocket_id]
	if info.is_empty(): return _fail("UNKNOWN_ITEM")
	if not _valid_size(info.size): return _fail("INVALID_SIZE")
	if not String(info.category) in to.categories: return _fail("WRONG_ITEM")
	if not _accepts(to, item_id, info): return _fail("NOT_ACCEPTED")
	if not Profile.size_fits(info.size, to.maxSize): return _fail("TOO_LARGE")
	var cell := _free_cell(to_pocket_id)
	if cell.is_empty(): return _fail("FULL")
	if not _gate("removing", item_id, from.pocketId) or not _gate("placing", item_id, to_pocket_id): return _fail("VETOED")
	_note("backpack:removing", {"itemId": item_id, "pocketId": from.pocketId, "cell": from.cell})
	_note("backpack:placing", {"itemId": item_id, "pocketId": to_pocket_id, "cell": cell})
	if String(_provider.retrieve(from.cell, _transit_owner)).is_empty(): return _fail("PROVIDER_REJECTED")
	if not bool(_provider.store(item_id, _transit_owner, cell)):
		_put_back(item_id, from.cell, _transit_owner)
		return _fail("PROVIDER_REJECTED")
	_note("backpack:moved", {"itemId": item_id, "from": from.pocketId, "to": to_pocket_id})
	_note("backpack:removed", {"itemId": item_id, "pocketId": from.pocketId, "cell": from.cell})
	_note("backpack:placed", {"itemId": item_id, "pocketId": to_pocket_id, "cell": cell})
	refresh()
	return {"ok": true, "reason": "", "cell": cell}

## All-or-nothing store of several items into one pocket.
func store_all(item_ids: Array, pocket_id: String, expected_owner := "world") -> Dictionary:
	var seen := {}
	for id in item_ids:
		if seen.has(id): return _fail("NOT_OWNED", {"failedItem": id})
		seen[id] = true
	for id in item_ids:
		var c: Dictionary = check(String(id), pocket_id, expected_owner)
		if not bool(c.ok) and c.reason != "FULL":
			c["failedItem"] = id
			return c
	if _pockets.has(pocket_id) and item_ids.size() > free_cells(pocket_id): return _fail("FULL", {"failedItem": item_ids[free_cells(pocket_id)]})
	for id in item_ids:
		if not _gate("placing", String(id), pocket_id): return _fail("VETOED", {"failedItem": id})
	var done: Array = []
	for id in item_ids:
		var cell := _free_cell(pocket_id)
		if not bool(_provider.store(String(id), expected_owner, cell)):
			done.reverse()
			for d in done:
				if String(_provider.retrieve(d.cell, expected_owner)).is_empty(): push_error("GSBackpackContainer: rollback failed for %s" % d.id)
			return _fail("PROVIDER_REJECTED", {"failedItem": id})
		done.append({"id": String(id), "cell": cell})
	var cells: Array = []
	for d in done:
		_held.erase(d.id)
		_note("backpack:placed", {"itemId": d.id, "pocketId": pocket_id, "cell": d.cell})
		cells.append(d.cell)
	refresh()
	return {"ok": true, "reason": "", "cells": cells}

# ---------------------------------------------------------------- mount behaviour
## An item is brought to a mount. snapMode none never snaps, dropped only once released, range snaps when offered (the host decides "in range").
func offer(item_id: String, pocket_id: String, released := false) -> Dictionary:
	if not _pockets.has(pocket_id): return _fail("UNKNOWN_POCKET")
	var info: Dictionary = _info(item_id)
	if info.is_empty(): return _fail("UNKNOWN_ITEM")
	var snap: String = String(_pockets[pocket_id].get("mount", {}).get("snapMode", Profile.data().MOUNT.DEFAULT_SNAP_MODE))
	if snap == "none": return _fail("SNAP_DISABLED")
	if snap == "dropped" and not released: return _fail("NOT_RELEASED")
	return store(item_id, pocket_id, String(info.owner))

## A released world item gets sent into this mount after the mount's returnDelayS (timeout return).
func schedule_return(item_id: String, pocket_id: String) -> Dictionary:
	if not _pockets.has(pocket_id): return _fail("UNKNOWN_POCKET")
	var info: Dictionary = _info(item_id)
	if info.is_empty(): return _fail("UNKNOWN_ITEM")
	if String(info.owner) != "world": return _fail("NOT_OWNED")
	_pending[item_id] = {"pocketId": pocket_id, "t": 0.0}
	return {"ok": true, "reason": ""}

func pending_returns() -> Array: return _pending.keys()

## Advances the return timers. A pending item that was picked up meanwhile is forgotten. Returns [{itemId, ok, reason}] for the returns attempted now.
func tick(dt: float) -> Array:
	var out: Array = []
	if not is_finite(dt) or dt < 0.0: return out
	for item_id in _pending.keys():
		var e: Dictionary = _pending[item_id]
		var info: Dictionary = _info(item_id)
		if info.is_empty() or String(info.owner) != "world":
			_pending.erase(item_id)
			continue
		e["t"] = float(e.t) + dt
		var delay: float = float(_pockets[e.pocketId].get("mount", {}).get("returnDelayS", 0.0))
		if float(e.t) + EPS < delay: continue
		_pending.erase(item_id)
		var r: Dictionary = store(item_id, e.pocketId, "world")
		_note("backpack:mount_return", {"itemId": item_id, "pocketId": e.pocketId, "ok": bool(r.ok)})
		out.append({"itemId": item_id, "ok": bool(r.ok), "reason": r.reason})
	return out

# ---------------------------------------------------------------- view (materialisation limit) and the single refresh path
func set_tier(name: String) -> void:
	_tier_name = name
	_tier_fn = Callable()
	refresh()

func tier() -> String: return String(_tier_fn.call()) if _tier_fn.is_valid() else _tier_name

## Max physical proxies at once for the current tier (0 = slot view).
func material_limit() -> int: return ProfileExt.material_limit(profile, tier())

## Items to show for a tab ("*" = all bag pockets, or a pocket id) and a page: at most material_limit() items (physical) or every cell of the tab
## (slots). Held items are left out. opts: tab, page, exclude. Pure: it does not change the selection (select_view does).
func view(opts: Dictionary = {}) -> Dictionary:
	var limit := material_limit()
	var mode := "physical" if limit > 0 else "slots"
	var bag: Array = []
	for id in _order:
		if String(_pockets[id].container) == "bag" and _accessible(id): bag.append(id)
	var tabs: Array = [ALL_TAB]
	tabs.append_array(bag)
	var want: String = String(opts.get("tab", _sel_tab))
	var tab: String = want if (want == ALL_TAB or _pockets.has(want)) else ALL_TAB
	var shown: Array = []
	if tab == ALL_TAB: shown = bag
	elif _accessible(tab): shown = [tab]
	var skip := {}
	for id in _held: skip[id] = true
	for id in opts.get("exclude", []): skip[id] = true
	var rows: Array = []
	for pid in shown:
		for cell in _pockets[pid].cells:
			var id := String(_provider.item_in_slot(cell))
			if not id.is_empty() and (skip.has(id) or String(_info(id).get("owner", "")).begins_with("hand:")): id = ""
			if not id.is_empty() or mode == "slots": rows.append({"itemId": id, "pocketId": pid, "cell": cell})
	var page_size: int = limit if mode == "physical" else maxi(1, rows.size())
	var pages: int = maxi(1, ceili(float(rows.size()) / float(page_size)))
	var raw: Variant = opts.get("page", _sel_page)
	var page := 0
	if (raw is int or raw is float) and is_finite(float(raw)): page = clampi(int(raw), 0, pages - 1)
	var items: Array = rows.slice(page * page_size, (page + 1) * page_size)
	return {"mode": mode, "tab": tab, "tabs": tabs, "page": page, "pages": pages, "pageSize": page_size, "total": rows.size(), "items": items, "truncated": rows.size() > items.size()}

## Chooses tab and page. This and every ledger change reach listeners through refresh() and nowhere else.
func select_view(tab := ALL_TAB, page: Variant = 0) -> Dictionary:
	_sel_tab = tab
	_sel_page = page
	refresh()
	return view()

## Subscribes to the view: Callable(view: Dictionary), called after every change.
func on_refresh(fn: Callable) -> void: _listeners.append(fn)
func off_refresh(fn: Callable) -> void: _listeners.erase(fn)
func refresh_stats() -> Dictionary: return {"refreshes": _refreshes, "deferred": _deferred}

func refresh() -> bool:
	if _refreshing:
		_again = true
		_deferred += 1
		return false
	_refreshing = true
	var passes := 0
	while true:
		_again = false
		passes += 1
		_refreshes += 1
		if not _listeners.is_empty():
			var v: Dictionary = view()
			for l in _listeners.duplicate():
				if l.is_valid(): l.call(v)
		if not _again or passes >= int(Profile.data().VIEW.MAX_REFRESH_PASSES): break
	_refreshing = false
	_again = false
	return true

## An item in a hand (or being grabbed as a proxy before the retrieve commits) is left out of the view so it never shows in two places.
func hold(item_id: String, side := "right") -> Dictionary:
	if side != "left" and side != "right": return _fail("NOT_OWNED")
	if _info(item_id).is_empty(): return _fail("UNKNOWN_ITEM")
	_held[item_id] = side
	refresh()
	return {"ok": true, "reason": ""}

func unhold(item_id: String) -> Dictionary:
	var had := _held.erase(item_id)
	if had: refresh()
	return {"ok": had, "reason": "" if had else "NOT_FOUND"}

func held_items() -> Array: return _held.keys()

# ---------------------------------------------------------------- checkpoint: cells (v1 ledger) and the backpack-layer checkpoint v2
## JSON-safe cell assignment. The provider's own checkpoint restores ownership; this validates and re-syncs the cell mapping on top of it.
func capture() -> Dictionary:
	var cells := {}
	for id in _order:
		for c in _pockets[id].cells: cells[c] = String(_provider.item_in_slot(c))
	return {"schema": LEDGER_SCHEMA, "profileId": profile.id, "cells": cells}

## {ok, reason, cells}: validates without mutation. Commit with commit_restore().
func prepare_restore(raw: Variant) -> Dictionary:
	if not raw is Dictionary: return _invalid()
	if raw.get("schema") != LEDGER_SCHEMA or raw.get("profileId") != profile.id: return _invalid()
	var cells: Variant = raw.get("cells")
	if not cells is Dictionary or cells.size() != _cell_owner.size(): return _invalid()
	var seen := {}
	for cell in cells:
		var item_id: Variant = cells[cell]
		if not _cell_owner.has(cell) or not item_id is String: return _invalid()
		if String(item_id).is_empty(): continue
		if seen.has(item_id): return _invalid()
		seen[item_id] = true
		var info: Dictionary = _info(item_id)
		if info.is_empty(): return _invalid()
		var k: Dictionary = _pockets[_cell_owner[cell]]
		if not String(info.category) in k.categories or not Profile.size_fits(info.size, k.maxSize): return _invalid()
		var here := String(_provider.slot_of(item_id))
		if not (not here.is_empty() and _cell_owner.has(here)) and String(info.owner) != _transit_owner: return _invalid()
	return {"ok": true, "reason": "", "cells": cells.duplicate(true)}

## Applies a prepared restore. Returns false (and the provider is back where it was) when the provider fails midway.
func commit_restore(prepared: Dictionary) -> bool:
	if not bool(prepared.get("ok", false)): return false
	var cells: Dictionary = prepared.cells
	var before: Array = []
	for c in cells:
		var id := String(_provider.item_in_slot(c))
		if not id.is_empty(): before.append([c, id])
	for b in before: _provider.retrieve(b[0], _transit_owner)
	var placed: Array = []
	for c in cells:
		var id := String(cells[c])
		if id.is_empty(): continue
		if not bool(_provider.store(id, _transit_owner, c)):
			for p in placed: _provider.retrieve(p, _transit_owner)
			for b in before: _put_back(b[1], b[0], _transit_owner)
			return false
		placed.append(c)
	_held.clear()
	_pending.clear()
	return true

func notify_restored() -> void:
	_note("backpack:ledger-restored", {})
	refresh()

func restore(raw: Variant) -> bool:
	if not commit_restore(prepare_restore(raw)): return false
	notify_restored()
	return true

## Backpack-layer checkpoint v2: { schema, profileId, ledger, bag }. `bag` = optional GSBackpackState (its capture), else null.
## It holds only this layer's own state; the provider's checkpoint (NightfallGearInventory v1) is untouched and stored by the game as before.
func capture_checkpoint(bag: Object = null) -> Dictionary:
	return {"schema": CHECKPOINT_SCHEMA, "profileId": profile.id, "ledger": capture(), "bag": bag.capture() if bag != null else null}

## Validates a checkpoint v2 without mutation. raw null (an old checkpoint without backpack state) is accepted as {absent: true}; the older
## P0 system checkpoint and a bare ledger v1 are accepted too. Returns {ok, absent, version, ledger, bag}; commit with commit_checkpoint().
func prepare_checkpoint(raw: Variant, bag: Object = null) -> Dictionary:
	if raw == null: return {"ok": true, "absent": true, "version": 0}
	var bad := {"ok": false, "absent": false, "version": 0}
	if not raw is Dictionary: return bad
	var ledger_raw: Variant
	var bag_raw: Variant = null
	var version := 1
	var schema: Variant = raw.get("schema")
	if schema == CHECKPOINT_SCHEMA:
		if raw.get("profileId") != profile.id or not raw.get("ledger") is Dictionary or not raw.has("bag"): return bad
		bag_raw = raw.get("bag")
		if bag_raw != null and not bag_raw is Dictionary: return bad
		ledger_raw = raw.ledger
		version = 2
	elif schema == SYSTEM_V1_SCHEMA:
		ledger_raw = raw.get("ledger")
		bag_raw = raw.get("bag")
	elif schema == LEDGER_SCHEMA: ledger_raw = raw
	else: return bad
	var l: Dictionary = prepare_restore(ledger_raw)
	if not bool(l.ok): return bad
	var b: Dictionary = {}
	if bag != null and bag_raw is Dictionary:
		b = bag.prepare_restore(bag_raw)
		if not bool(b.get("ok", false)): return bad
	return {"ok": true, "absent": false, "version": version, "ledger": l, "bag": b}

func commit_checkpoint(prepared: Dictionary, bag: Object = null) -> bool:
	if not bool(prepared.get("ok", false)): return false
	if bool(prepared.absent): return true
	if not commit_restore(prepared.ledger): return false
	if bag != null and not prepared.bag.is_empty(): bag.commit_restore(prepared.bag)
	return true

func notify_checkpoint(prepared: Dictionary) -> void:
	if bool(prepared.get("ok", false)) and not bool(prepared.absent): notify_restored()

## prepare + commit + notify: {ok, absent, version}. A rejected or rolled-back restore changes nothing.
func restore_checkpoint(raw: Variant, bag: Object = null) -> Dictionary:
	var p: Dictionary = prepare_checkpoint(raw, bag)
	if not commit_checkpoint(p, bag): return {"ok": false, "absent": false, "version": 0}
	notify_checkpoint(p)
	return {"ok": true, "absent": p.absent, "version": p.version}

# ---------------------------------------------------------------- internals
func _fail(reason: String, extra: Dictionary = {}) -> Dictionary:
	var r := {"ok": false, "reason": reason}
	r.merge(extra)
	return r

func _invalid() -> Dictionary: return {"ok": false, "reason": "invalid"}

func _note(type: String, data: Dictionary) -> void:
	if _emit.is_valid(): _emit.call(type, data)

func _accessible(pocket_id: String) -> bool:
	return not _can_access.is_valid() or bool(_can_access.call(pocket_id))

func _free_cell(pocket_id: String) -> String:
	for c in _pockets[pocket_id].cells:
		if String(_provider.item_in_slot(c)).is_empty(): return c
	return ""

func _put_back(item_id: String, cell: String, owner: String) -> void:
	if not bool(_provider.store(item_id, owner, cell)): push_error("GSBackpackContainer: rollback failed for %s -> %s" % [item_id, cell])

func _gate(kind: String, item_id: String, pocket_id: String) -> bool:
	for v in _validators:
		if not v.is_valid(): continue
		var r: Variant = v.call({"kind": kind, "itemId": item_id, "pocketId": pocket_id})
		if (r is bool and r == false) or (r is String and not String(r).is_empty()): return false
	return true

func _accepts(k: Dictionary, item_id: String, info: Dictionary) -> bool:
	var mount: Dictionary = k.get("mount", {})
	if not mount.has("acceptOnly"): return true
	var only: Array = mount.acceptOnly
	if item_id in only: return true
	var tags: Array = info.get("tags", [])
	if tags.is_empty(): tags = [info.category]
	for t in tags:
		if t in only: return true
	return false

## {category, size:[x,y,z], owner, tags?} of an item, or {} when unknown to the container.
func _info(item_id: String) -> Dictionary:
	if _info_provider.is_valid():
		var r: Variant = _info_provider.call(item_id)
		if r is Dictionary and not r.is_empty(): return r
	if _registry.has(item_id):
		var e: Dictionary = _registry[item_id]
		return {"category": e.category, "size": e.size, "owner": String(_provider.owner_of(item_id)), "tags": e.tags}
	return {}

static func _vec3(v: Variant) -> Vector3:
	if v is Vector3: return v
	if v is Array and v.size() == 3: return Vector3(float(v[0]), float(v[1]), float(v[2]))
	return Vector3(NAN, NAN, NAN)

static func _valid_size(s: Variant) -> bool:
	if not s is Array or s.size() != 3: return false
	for v in s:
		if not (v is int or v is float) or not is_finite(float(v)) or float(v) <= 0.0: return false
	return true
