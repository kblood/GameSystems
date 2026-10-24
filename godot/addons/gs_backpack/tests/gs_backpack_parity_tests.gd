extends SceneTree
## P1 parity test: replays the shared golden vectors (res://addons/gs_backpack/data/backpack.golden.json, generated from the
## JS core by extensions/backpack/tools/gen_golden.mjs) against the GDScript implementation and requires identical results:
## approach (existing GSBackpackApproach, unchanged), handle pull (existing GSBackpackHandlePull, unchanged), profile
## validation (GSBackpackProfile) and the state machine (GSBackpackState).
##   godot --headless --path godot --script res://addons/gs_backpack/tests/gs_backpack_parity_tests.gd
## P2 adds: profile validation with GSBackpackProfileExt (kind, mounts, materialisation limit) and the container ledger / stash
## (GSBackpackContainer, GSBackpackStash) over an in-memory provider with fault injection (MemProvider, twin of createMemoryInventory).
## Optional: `-- --dump=<file>` writes the actual observations so tools/parity.mjs can compare them with the JS run.
const Approach = preload("res://addons/gs_backpack/gs_backpack_approach.gd")
const HandlePull = preload("res://addons/gs_backpack/gs_backpack_handle_pull.gd")
const Profile = preload("res://addons/gs_backpack/gs_backpack_profile.gd")
const State = preload("res://addons/gs_backpack/gs_backpack_state.gd")
const ProfileExt = preload("res://addons/gs_backpack/gs_backpack_profile_ext.gd")
const BpContainer = preload("res://addons/gs_backpack/gs_backpack_container.gd")
const BpStash = preload("res://addons/gs_backpack/gs_backpack_stash.gd")
const STASH_EXAMPLE_PATH := "res://addons/gs_backpack/data/profile.stash.example.json"
const GOLDEN_PATH := "res://addons/gs_backpack/data/backpack.golden.json"
const EPS := 0.0000001

var checks := 0
var failures: Array[String] = []
var vectors := 0
var ops_run := 0

func _initialize() -> void:
	call_deferred("run")

func check(value: bool, label: String) -> void:
	checks += 1
	if not value:
		failures.append(label)
		push_error("GS_BACKPACK_PARITY: " + label)

func dec(v: Variant) -> Variant:
	if v is String:
		if v == "NaN": return NAN
		if v == "Infinity": return INF
		if v == "-Infinity": return -INF
		return v
	if v is Array:
		var out: Array = []
		for x in v: out.append(dec(x))
		return out
	if v is Dictionary:
		var out := {}
		for k in v: out[k] = dec(v[k])
		return out
	return v

func vec3(a: Array) -> Vector3:
	return Vector3(float(a[0]), float(a[1]), float(a[2]))

## "" when equal (numbers within EPS), else the path of the first difference.
func first_diff(a: Variant, b: Variant, path := "") -> String:
	if (a is float or a is int) and (b is float or b is int): return "" if absf(float(a) - float(b)) <= EPS else "%s: %s vs %s" % [path, a, b]
	if a is Array or b is Array:
		if not (a is Array and b is Array) or a.size() != b.size(): return "%s: array shape" % path
		for i in a.size():
			var d := first_diff(a[i], b[i], "%s[%d]" % [path, i])
			if not d.is_empty(): return d
		return ""
	if a is Dictionary and b is Dictionary:
		var ka: Array = a.keys()
		var kb: Array = b.keys()
		ka.sort()
		kb.sort()
		if ka != kb: return "%s: keys %s vs %s" % [path, ka, kb]
		for k in ka:
			var d := first_diff(a[k], b[k], "%s.%s" % [path, k])
			if not d.is_empty(): return d
		return ""
	return "" if typeof(a) == typeof(b) and a == b else "%s: %s vs %s" % [path, JSON.stringify(a), JSON.stringify(b)]

func fmt_event(e: Dictionary) -> String:
	if e.type == "state": return "state:%s>%s:%s" % [e.from, e.to, e.reason]
	if e.type == "release_blocked": return "release_blocked:" + String(e.reason)
	if e.has("side"): return "%s:%s" % [e.type, e.side]
	return String(e.type)

func observe_state(st: State, r: Dictionary, extra: Dictionary = {}) -> Dictionary:
	var snap: Dictionary = st.snapshot()
	var access: Array[String] = []
	for k in st.profile.pockets:
		if st.can_access(k.id): access.append(k.id)
	var events: Array = []
	for e in r.events: events.append(fmt_event(e))
	var out := {"ok": r.ok, "reason": r.reason, "events": events, "state": snap.state, "owner": snap.owner, "holder": snap.holder,
		"secondary": snap.secondary, "openFraction": snap.openFraction, "accessOpen": snap.accessOpen, "pullOffset": snap.pullOffset,
		"returnProgress": snap.returnProgress, "placed": snap.placed, "posture": snap.posture, "tier": st.tier, "access": ",".join(access)}
	out.merge(extra)
	return out

func run_approach(vec: Dictionary) -> Array:
	var a := Approach.new()
	var out: Array = []
	for raw in vec.ops:
		var op: Dictionary = dec(raw)
		match op.op:
			"observe":
				a.observe(op.side, op.tracked, vec3(op.hand), float(op.shoulderY), float(op.dt))
				out.append(null)
			"check":
				out.append(a.check(op.side, vec3(op.hand), float(op.shoulderY)))
			"reset":
				a.reset(op.get("side", ""))
				out.append(null)
			_: check(false, "unknown approach op " + String(op.op))
	return out

func run_pull(vec: Dictionary) -> Array:
	var p := HandlePull.new()
	var out: Array = []
	for raw in vec.ops:
		var op: Dictionary = dec(raw)
		match op.op:
			"begin": out.append(p.begin(vec3(op.hand), op.side, op.get("kind", "grip")))
			"step": out.append({"offset": p.step(vec3(op.hand), op.tracked, float(op.dt)), "target": p.target_m, "active": p.active})
			"cancel":
				p.cancel()
				out.append({"offset": p.offset_m, "target": p.target_m, "active": p.active})
			_: check(false, "unknown pull op " + String(op.op))
	return out

func build_profile(vec: Dictionary, golden: Dictionary) -> Dictionary:
	var profile: Dictionary = golden.profiles[vec.get("profile", "example")].duplicate(true)
	if vec.has("thresholds"):
		var t: Dictionary = profile.get("thresholds", {}).duplicate()
		t.merge(vec.thresholds, true)
		profile["thresholds"] = t
	if vec.has("tiers"):
		var t: Dictionary = profile.get("tiers", {}).duplicate()
		t.merge(vec.tiers, true)
		profile["tiers"] = t
	return profile

func run_state(vec: Dictionary, golden: Dictionary) -> Array:
	var st := State.new()
	var configured := st.configure(build_profile(vec, golden), vec.get("tier", "high"))
	check(configured, "configure " + String(vec.name))
	var out: Array = []
	if not configured: return out
	for raw in vec.ops:
		var op: Dictionary = dec(raw)
		var r: Dictionary
		var extra := {}
		match op.op:
			"step": r = st.step(float(op.dt), op.get("input", {}))
			"grab": r = st.grab(op.side, op.get("kind", "grip"), op.get("handleDistanceM"))
			"open": r = st.open()
			"close": r = st.close()
			"callToHand": r = st.call_to_hand(op.side)
			"die": r = st.die()
			"setTier": r = st.set_tier(op.tier)
			"setPosture":
				st.set_posture(op.posture)
				r = {"ok": true, "reason": "", "events": []}
			"capture":
				r = {"ok": true, "reason": "", "events": []}
				extra = {"capture": st.capture()}
			"restore":
				var prepared: Dictionary = st.prepare_restore(op.data)
				if bool(prepared.ok):
					st.commit_restore(prepared)
					r = {"ok": true, "reason": "", "events": []}
				else:
					r = {"ok": false, "reason": "invalid", "events": []}
			_:
				check(false, "unknown state op " + String(op.op))
				r = {"ok": false, "reason": "", "events": []}
		out.append(observe_state(st, r, extra))
	return out

## In-memory inventory provider with the same rules as extensions/backpack/ledger.js createMemoryInventory(), plus fault injection.
class MemProvider extends RefCounted:
	const OWNERS := ["world", "hand:left", "hand:right", "equipped"]
	var slots := {}
	var items := {}
	var slot_item := {}
	var fault := {"store": {"skip": 0, "fail": 0}, "retrieve": {"skip": 0, "fail": 0}}

	static func ok_size(v: Vector3) -> bool:
		return is_finite(v.x) and is_finite(v.y) and is_finite(v.z) and v.x > 0.0 and v.y > 0.0 and v.z > 0.0

	func _pass(method: String) -> bool:
		var f: Dictionary = fault[method]
		if int(f.skip) > 0:
			f.skip = int(f.skip) - 1
			return true
		if int(f.fail) > 0:
			f.fail = int(f.fail) - 1
			return false
		return true

	func add_slot(id: String, categories: Array, max_size: Vector3) -> bool:
		if id.is_empty() or slots.has(id) or not ok_size(max_size) or categories.is_empty(): return false
		slots[id] = {"categories": categories.duplicate(), "max": max_size}
		slot_item[id] = ""
		return true

	func register_item(id: String, _ref: Variant, category: String, size: Vector3, owner := "world") -> bool:
		if id.is_empty() or items.has(id) or category.is_empty() or not ok_size(size) or not owner in OWNERS: return false
		items[id] = {"category": category, "size": size, "owner": owner, "slot": ""}
		return true

	func transfer(id: String, expected: String, new_owner: String) -> bool:
		if not items.has(id): return false
		var it: Dictionary = items[id]
		if not String(it.slot).is_empty() or it.owner != expected or not expected in OWNERS or not new_owner in OWNERS: return false
		it.owner = new_owner
		return true

	func owner_of(id: String) -> String: return String(items[id].owner) if items.has(id) else ""
	func slot_of(id: String) -> String: return String(items[id].slot) if items.has(id) else ""
	func item_in_slot(slot: String) -> String: return String(slot_item.get(slot, ""))

	func store(id: String, expected_owner: String, slot: String) -> bool:
		if not _pass("store"): return false
		if not items.has(id) or not slots.has(slot): return false
		var it: Dictionary = items[id]
		var sl: Dictionary = slots[slot]
		if it.owner != expected_owner or not expected_owner in OWNERS or slot_item[slot] != "": return false
		if not String(it.category) in sl.categories: return false
		var a := [it.size.x, it.size.y, it.size.z]
		var b := [sl.max.x, sl.max.y, sl.max.z]
		if not Profile.size_fits(a, b): return false
		it.owner = "slot"
		it.slot = slot
		slot_item[slot] = id
		return true

	func retrieve(slot: String, new_owner: String) -> String:
		if not _pass("retrieve"): return ""
		var id := String(slot_item.get(slot, ""))
		if id.is_empty() or not new_owner in OWNERS: return ""
		items[id].owner = new_owner
		items[id].slot = ""
		slot_item[slot] = ""
		return id

func fmt_ledger_event(type: String, d: Dictionary) -> String:
	var t := type.trim_prefix("backpack:")
	if t == "moved": return "moved:%s:%s>%s" % [d.itemId, d.from, d.to]
	if t == "mount_return": return "mount_return:%s:%s:%s" % [d.itemId, d.pocketId, "true" if d.ok else "false"]
	if d.has("itemId"): return "%s:%s:%s@%s" % [t, d.itemId, d.pocketId, d.get("cell", "")]
	return t

func join_strings(a: Array) -> String:
	var p := PackedStringArray()
	for x in a: p.append(String(x))
	return ",".join(p)

func norm_result(r: Dictionary) -> Dictionary:
	return {"ok": bool(r.ok), "reason": String(r.get("reason", "")), "cell": String(r.get("cell", "")), "itemId": String(r.get("itemId", "")),
		"failedItem": String(r.get("failedItem", "")), "cells": join_strings(r.get("cells", []))}

func view_obs(v: Dictionary) -> Dictionary:
	var rows: Array = []
	for i in v.items: rows.append("%s@%s" % [i.itemId, i.cell])
	return {"mode": v.mode, "tab": v.tab, "tabs": join_strings(v.tabs), "page": v.page, "pages": v.pages, "pageSize": v.pageSize, "total": v.total,
		"truncated": v.truncated, "items": join_strings(rows)}

func run_ledger(vec: Dictionary, golden: Dictionary) -> Array:
	var profile: Dictionary = golden.profiles[vec.get("profile", "example")].duplicate(true)
	var prov := MemProvider.new()
	var override := {}
	var ids: Array = []
	var events: Array = []
	var st := {"access": "all"}
	var emit := func(type: String, data: Dictionary) -> void: events.append(fmt_ledger_event(type, data))
	var options := {"emit": emit, "info_provider": func(id: String) -> Dictionary: return override.get(id, {}), "tier": vec.get("tier", "high")}
	var stash: BpStash = null
	var ledger: BpContainer
	var configured := false
	if profile.get("kind", "pack") == "stash":
		stash = BpStash.new()
		configured = stash.configure(profile, prov, options)
		ledger = stash.container
	else:
		options["can_access"] = func(id: String) -> bool: return st.access is String or id in st.access
		ledger = BpContainer.new()
		configured = ledger.configure(profile, prov, options)
	check(configured, "ledger configure " + String(vec.name))
	var out: Array = []
	if not configured: return out
	for raw in vec.ops:
		var op: Dictionary = dec(raw)
		var r := {"ok": true, "reason": ""}
		var extra := {}
		var owner := String(op.get("owner", "world"))
		match op.op:
			"registerItem":
				var ok: bool = ledger.register_item(op.id, null, op.category, op.size, owner, op.get("tags", []))
				var force: bool = bool(op.get("force", false))
				if not ok and force: override[op.id] = {"category": op.category, "size": op.size.duplicate(), "owner": owner}
				if ok or force: ids.append(op.id)
				r = {"ok": ok, "reason": ""}
			"setAccess": st.access = op.pockets
			"open": r = stash.open()
			"close": r = stash.close()
			"check": r = ledger.check(op.item, op.pocket, owner)
			"store": r = ledger.store(op.item, op.pocket, owner)
			"retrieve": r = ledger.retrieve(op.pocket, String(op.get("item", "")), String(op.get("newOwner", "world")))
			"move": r = ledger.move(op.item, op.pocket)
			"storeAll": r = ledger.store_all(op.items, op.pocket, owner)
			"hand": r = {"ok": prov.transfer(op.item, op.from, op.to), "reason": ""}
			"fault": prov.fault[op.method] = {"skip": int(op.skip), "fail": int(op.fail)}
			"validator":
				var on: Array = op.on
				var veto := func(e: Dictionary) -> bool:
					return not (on.has(e.kind) and (not op.has("items") or op.items.has(e.itemId)) and (not op.has("pockets") or op.pockets.has(e.pocketId)))
				ledger.add_validator(veto)
			"clearValidators": ledger.clear_validators()
			"offer": r = ledger.offer(op.item, op.pocket, op.get("released", false) == true)
			"scheduleReturn":
				r = ledger.schedule_return(op.item, op.pocket)
				extra = {"pending": join_strings(ledger.pending_returns())}
			"tick":
				var res: Array = ledger.tick(float(op.dt))
				var rows: Array = []
				for x in res: rows.append("%s:%s:%s" % [x.itemId, "true" if x.ok else "false", x.reason])
				extra = {"returns": join_strings(rows), "pending": join_strings(ledger.pending_returns())}
			"hold": r = ledger.hold(op.item, String(op.get("side", "right")))
			"unhold": r = ledger.unhold(op.item)
			"selectView": extra = {"view": view_obs(ledger.select_view(op.get("tab", "*"), op.get("page", 0)))}
			"view":
				var vo := {}
				for key in ["tab", "page", "exclude"]:
					if op.has(key): vo[key] = op[key]
				extra = {"view": view_obs(ledger.view(vo))}
			"setTier": ledger.set_tier(op.tier)
			"listener":
				var lst := {"done": false}
				var l_item: String = op.item
				var l_pocket: String = op.pocket
				var l_mode: String = op.mode
				ledger.on_refresh(func(_v: Dictionary) -> void:
					if l_mode == "store_once" and lst.done: return
					lst.done = true
					ledger.store(l_item, l_pocket))
			"capture": extra = {"capture": (stash if stash != null else ledger).capture()}
			"captureV2": extra = {"capture": ledger.capture_checkpoint()}
			"restore":
				if not (stash if stash != null else ledger).restore(op.data): r = {"ok": false, "reason": "invalid"}
			"restoreV2":
				var rr: Dictionary = ledger.restore_checkpoint(null if op.get("absent", false) else op.get("data"))
				if bool(rr.ok): extra = {"absent": rr.absent, "version": rr.version}
				else: r = {"ok": false, "reason": "invalid"}
			_: check(false, "unknown ledger op " + String(op.op))
		var where: Array = []
		var sorted_ids := ids.duplicate()
		sorted_ids.sort()
		for id in sorted_ids:
			var known: bool = prov.items.has(id)
			where.append("%s:%s@%s" % [id, prov.owner_of(id) if known else "?", prov.slot_of(id) if known else ""])
		out.append({"result": norm_result(r), "events": events.duplicate(), "where": "|".join(PackedStringArray(where)), "refresh": ledger.refresh_stats(), "extra": extra})
		events.clear()
	return out

func compare(group: String, vec: Dictionary, actual: Array) -> void:
	vectors += 1
	var expected: Array = vec.expected
	check(expected.size() == actual.size(), "%s/%s result count" % [group, vec.name])
	for i in mini(expected.size(), actual.size()):
		ops_run += 1
		var d := first_diff(actual[i], expected[i])
		if not d.is_empty():
			check(false, "%s/%s op %d %s" % [group, vec.name, i, d])
			return
	check(true, "%s/%s" % [group, vec.name])

func run() -> void:
	var golden_text := FileAccess.get_file_as_string(GOLDEN_PATH)
	var golden: Variant = JSON.parse_string(golden_text)
	check(golden is Dictionary and golden.get("schema") == "gamesystems.backpack-golden.v1", "golden file loads")
	if not golden is Dictionary:
		quit(1)
		return
	var dump := {"approach": {}, "pull": {}, "state": {}, "profileCases": {}, "ledger": {}}
	# the shared constants file equals the constants of the existing, unchanged Godot scripts
	var data: Dictionary = Profile.data()
	check(not data.is_empty(), "data file loads")
	var approach_constants: Dictionary = (Approach as Script).get_script_constant_map()
	var pull_constants: Dictionary = (HandlePull as Script).get_script_constant_map()
	for key in approach_constants:
		if data.APPROACH.has(key): check(absf(float(approach_constants[key]) - float(data.APPROACH[key])) < 0.0000000001, "data.APPROACH.%s equals GSBackpackApproach" % key)
	for key in pull_constants:
		if data.PULL.has(key): check(absf(float(pull_constants[key]) - float(data.PULL[key])) < 0.0000000001, "data.PULL.%s equals GSBackpackHandlePull" % key)
	check(data.APPROACH.has("MAX_SAMPLE_DT") and data.PULL.has("MAX_PULL_M") and data.PULL.has("HANDLE_REACH_M"), "data carries the ported constants")
	# the example profile file is the golden profile and is valid
	var loaded: Dictionary = Profile.load_file()
	check(bool(loaded.ok), "example profile validates: " + String(loaded.error))
	check(first_diff(JSON.parse_string(FileAccess.get_file_as_string(Profile.EXAMPLE_PATH)), golden.profiles.example).is_empty(), "profile.example.json equals the golden profile")
	var stash_loaded: Dictionary = ProfileExt.parse(JSON.parse_string(FileAccess.get_file_as_string(STASH_EXAMPLE_PATH)))
	check(bool(stash_loaded.ok), "stash example profile validates: " + String(stash_loaded.error))
	check(first_diff(JSON.parse_string(FileAccess.get_file_as_string(STASH_EXAMPLE_PATH)), golden.profiles.stash).is_empty(), "profile.stash.example.json equals the golden stash profile")
	for vec in golden.profileCases:
		var r: Dictionary = ProfileExt.parse(vec.profile)
		vectors += 1
		ops_run += 1
		check(bool(r.ok) == bool(vec.expected.valid), "profileCases/%s valid=%s" % [vec.name, vec.expected.valid])
		dump.profileCases[vec.name] = {"valid": bool(r.ok)}
	for vec in golden.approach:
		var actual := run_approach(vec)
		compare("approach", vec, actual)
		dump.approach[vec.name] = actual
	for vec in golden.pull:
		var actual := run_pull(vec)
		compare("pull", vec, actual)
		dump.pull[vec.name] = actual
	for vec in golden.state:
		var actual := run_state(vec, golden)
		compare("state", vec, actual)
		dump.state[vec.name] = actual
	for vec in golden.get("ledger", []):
		var actual := run_ledger(vec, golden)
		compare("ledger", vec, actual)
		dump.ledger[vec.name] = actual
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--dump="):
			var f := FileAccess.open(arg.substr(7), FileAccess.WRITE)
			if f != null:
				f.store_string(JSON.stringify(dump))
				f.close()
	print("GS_BACKPACK_PARITY vectors=%d ops=%d checks=%d failures=%d" % [vectors, ops_run, checks, failures.size()])
	quit(1 if not failures.is_empty() else 0)
