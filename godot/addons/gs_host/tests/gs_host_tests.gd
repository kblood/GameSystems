extends SceneTree
## Headless tests for gs_host: tier_for/normalize_tier against the JS golden (data/tier_for.golden.json, made by
## GameSystems/godot/tools/gen_golden.mjs), extension loading and requires, fault isolation, quality tiers and pinning,
## node processing while "off", disposal order, and (in a game copy) that the synced files still match SOURCE.json.
##   godot --headless --path <project> --script res://addons/gs_host/tests/gs_host_tests.gd
##   ... -- --real-crash   also runs a real GDScript runtime error inside an extension (prints SCRIPT ERROR, so it
##                         is not part of the native suite, which rejects logged script errors)
## Crashes in the suite run are simulated by bumping the error trap's counter, the same signal a real script error sends.

const Host = preload("res://addons/gs_host/gs_host.gd")
const Quality = preload("res://addons/gs_host/gs_quality.gd")
const EventBus = preload("res://addons/gs_host/gs_event_bus.gd")
const PhysicsAdapter = preload("res://addons/gs_host/gs_physics_adapter.gd")
const ErrorTrap = preload("res://addons/gs_host/gs_error_trap.gd")
const GOLDEN := "res://addons/gs_host/data/tier_for.golden.json"
const SOURCE := "res://addons/gs_host/SOURCE.json"

var passed := 0
var failed := 0
var errors: Array = []

class Probe extends RefCounted:
	var ID: StringName
	var REQUIRES: Array = []
	var QUALITY: Array = []
	var mode := {}
	var journal: Array
	var ctx
	var updates := 0
	var qualities: Array = []
	var grabs: Array = []
	var disposed := 0
	func _init(id: StringName, shared_journal: Array, options := {}) -> void:
		ID = id
		journal = shared_journal
		mode = options
		REQUIRES = options.get("requires", [])
		QUALITY = options.get("quality", [])
	func init_extension(context) -> Variant:
		ctx = context
		journal.append("init:%s:%s" % [ID, ctx.quality])
		ctx.on(&"grab", _on_grab)
		if mode.get("fail_init", false): ctx.fail("refused")
		if mode.get("init_null", false): return null
		if mode.get("crash_init", false): ErrorTrap._instance.script_errors += 1
		return {"id": ID, "probe": self}
	func update_extension(_dt: float) -> Variant:
		updates += 1
		if mode.get("update_false", false): return false
		if mode.get("crash_update", false): ErrorTrap._instance.script_errors += 1
		if mode.get("fail_update", false): ctx.fail("gave up")
		if mode.get("real_crash", false):
			var empty := {}
			return empty["missing"].value
		return true
	func set_quality(tier: StringName) -> bool:
		qualities.append(String(tier))
		return not mode.get("quality_false", false)
	func dispose_extension() -> void:
		disposed += 1
		journal.append("dispose:%s" % ID)
	func _on_grab(data: Dictionary) -> void:
		grabs.append(data)
		if mode.get("crash_listener", false): ErrorTrap._instance.script_errors += 1

class NodeProbe extends Node:
	const ID := &"node_probe"
	const QUALITY := ["off", "low", "high"]
	var ticks := 0
	var disposed := false
	func init_extension(_ctx) -> Variant: return self
	func _process(_delta: float) -> void: ticks += 1
	func dispose_extension() -> void: disposed = true

class NotAnExtension extends RefCounted:
	var ID := &"nope"

func _initialize() -> void:
	golden()
	loading()
	fault_isolation()
	tiers()
	await processing_and_disposal()
	bus_and_physics()
	source_integrity()
	if "--real-crash" in OS.get_cmdline_user_args(): real_crash()
	print("GS_HOST passed=%d failed=%d" % [passed, failed])
	quit(1 if failed else 0)

func check(condition: bool, label: String) -> void:
	if condition: passed += 1
	else:
		failed += 1
		print("FAIL ", label)

func make_host() -> Host:
	var host := Host.new()
	host.auto_update = false
	errors.clear()
	host.on_error = func(message: String, id: StringName, phase: StringName) -> void: errors.append([String(id), String(phase), message])
	return host

func golden() -> void:
	var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(GOLDEN))
	check(data is Dictionary and data.get("schema") == "gamesystems.golden.tier-for.v1", "golden file loads")
	if not data is Dictionary: return
	var bad := 0
	for item: Dictionary in data.cases:
		var got: Variant = Quality.tier_for(PackedStringArray(item.tiers), float(item.level), float(item.max_level))
		if got != item.expected:
			bad += 1
			if bad <= 5: print("tier_for(%s, %s, %s) = %s, JS %s" % [item.tiers, item.level, item.max_level, got, item.expected])
	check(bad == 0 and data.cases.size() > 100, "tier_for matches %d JS golden cases (%d differ)" % [data.cases.size(), bad])
	bad = 0
	for item: Dictionary in data.normalize:
		var tier: Variant = int(item.tier) if typeof(item.tier) == TYPE_FLOAT else item.tier # JSON numbers are floats
		if Quality.normalize_tier(PackedStringArray(item.tiers), tier) != item.expected: bad += 1
	check(bad == 0, "normalize_tier matches %d JS golden cases (%d differ)" % [data.normalize.size(), bad])
	check(Quality.tier_for(Quality.DEFAULT_TIERS, NAN, 3.0) == "off" and Quality.tier_for(["a"], 1.0, NAN) == "a", "NaN level/max like JS")

func loading() -> void:
	var host := make_host()
	var journal: Array = []
	var a := Probe.new(&"a", journal, {"quality": ["off", "low", "high"]})
	var api: Variant = host.load_extension(a, {"x": 1})
	check(api is Dictionary and api.id == &"a" and host.state(&"a") == &"ready", "extension loads and returns its api")
	check(host.get_ext(&"a") == api and a.ctx.options.x == 1 and a.ctx.id == &"a", "get_ext and ctx options")
	check(journal == ["init:a:high"], "init sees ctx.quality for the default level 3")
	check(host.load_extension(Probe.new(&"b", journal, {"requires": [&"missing"]})) == null and host.state(&"b") == &"absent"
		and errors.back()[1] == "load", "missing requirement refused")
	var b: Variant = host.load_extension(Probe.new(&"b", journal, {"requires": [&"a"]}))
	check(b != null and (b.probe as Probe).ctx.get_ext(&"a") == api, "requirement met; ctx.get_ext reaches another extension")
	check(host.load_extension(Probe.new(&"a", journal)) == null and errors.back()[2].contains("already loaded"), "duplicate id refused")
	check(host.load_extension(NotAnExtension.new()) == null and host.load_extension("res://does/not/exist.gd") == null
		and host.load_extension(null) == null, "non-extensions refused")
	var made: Variant = host.load_extension(func(options: Dictionary) -> Object: return Probe.new(StringName(options.id), journal), {"id": "c"})
	check(made != null and host.ids() == [&"a", &"b", &"c"], "Callable factory source; ids in load order")
	check(host.asset_path("x/y.png") == "res://x/y.png" and host.asset_path("user://z") == "user://z", "asset_path")
	host.free()

func fault_isolation() -> void:
	var host := make_host()
	var journal: Array = []
	var good := Probe.new(&"good", journal)
	host.load_extension(good)
	var failed_ids: Array = []
	host.extension_failed.connect(func(id: StringName, _phase: StringName, _message: String) -> void: failed_ids.append(String(id)))
	# init failures: returned null, script error, ctx.fail(); listeners registered during init are removed.
	for mode in ["init_null", "crash_init", "fail_init"]:
		var bad := Probe.new(StringName(mode), journal, {mode: true})
		check(host.load_extension(bad) == null and host.state(StringName(mode)) == &"absent" and bad.disposed == 1, "init failure (%s) disposes only it" % mode)
	check(host.events.count(&"grab") == 1 and failed_ids == ["init_null", "crash_init", "fail_init"], "failed inits leave no listeners")
	# update failures: returned false, script error, ctx.fail(); the other extension keeps updating.
	for mode in ["update_false", "crash_update", "fail_update"]:
		host.load_extension(Probe.new(StringName(mode), journal, {mode: true}))
	host.update(0.016)
	host.update(0.016)
	check(good.updates == 2, "healthy extension keeps updating")
	check(host.ids() == [&"good"] and errors.slice(-3).map(func(e: Array) -> String: return e[1]) == ["update", "update", "fail"],
		"update failures (false/crash/fail) dispose only those extensions")
	# a crashing listener is reported; the others still get the event.
	var noisy := Probe.new(&"noisy", journal, {"crash_listener": true})
	host.load_extension(noisy)
	var delivered := host.emit(&"grab", {"owner": "player", "side": "left", "body": null, "pose_id": "wrap"})
	check(delivered == 1 and good.grabs.size() == 1 and noisy.grabs.size() == 1 and errors.back()[0] == "event:grab"
		and errors.back()[1] == "listener", "crashing listener reported, other listeners still run")
	# set_quality failure disposes only that extension.
	var picky := Probe.new(&"picky", journal, {"quality_false": true, "quality": ["off", "low", "high"]})
	host.load_extension(picky)
	host.set_quality(1)
	check(host.state(&"picky") == &"absent" and picky.disposed == 1 and errors.back()[1] == "set_quality", "set_quality failure disposes it")
	check(host.state(&"good") == &"ready" and host.state(&"noisy") == &"ready", "others survive every failure")
	# a disposed extension's ctx is inert.
	var ctx: Variant = picky.ctx
	check(ctx.quality == null and ctx.emit(&"grab", {}) == 0 and ctx.get_ext(&"good") == null, "disposed ctx is inert")
	var before := host.events.count(&"grab")
	ctx.on(&"grab", func(_d: Dictionary) -> void: pass).call()
	check(host.events.count(&"grab") == before, "ctx.on after dispose is a no-op")
	host.free()

func tiers() -> void:
	var host := make_host()
	var journal: Array = []
	var p := Probe.new(&"p", journal, {"quality": ["off", "low", "high"]})
	var d := Probe.new(&"d", journal) # default tiers off/on
	host.load_extension(p)
	host.load_extension(d)
	var seen: Array = []
	for level in [0, 1, 2, 3, 9, -2]:
		host.set_quality(level)
		seen.append([host.tier(&"p"), host.tier(&"d")])
	check(seen == [["off", "off"], ["low", "on"], ["high", "on"], ["high", "on"], ["high", "on"], ["off", "off"]], "levels map to tiers like quality.js: %s" % [seen])
	check(p.qualities == ["off", "low", "high", "off"] and host.level == 0.0, "set_quality called only on change; level clamped")
	host.update(0.016)
	check(p.updates == 0 and d.updates == 0, "no update while off")
	check(host.set_tier(&"p", "low") == "low" and host.set_tier(&"d", 1) == "on", "pin by name and by index")
	host.set_quality(3)
	host.set_quality(0)
	check(host.tier(&"p") == "low" and host.tier(&"d") == "on", "pinned tiers ignore the global level")
	host.update(0.016)
	check(p.updates == 1, "pinned 'low' updates at level 0")
	check(host.set_tier(&"p", null) == "off" and host.tier(&"p") == "off", "unpin follows the level again")
	check(host.set_tier(&"p", "ultra") == null and host.set_tier(&"nobody", "low") == null, "unknown tier / extension")
	host.free()
	# init reads the tier of the level set before loading.
	var low := make_host()
	low.set_quality(1)
	var q := Probe.new(&"q", journal, {"quality": ["minimal", "low", "mid", "high"]})
	low.load_extension(q)
	check(journal.back() == "init:q:low", "ctx.quality at init follows the current level")
	low.free()

func processing_and_disposal() -> void:
	# Loaded before the host is in the tree: Godot enables _process when the node becomes ready; "off" must win.
	var early := make_host()
	early.set_quality(0)
	var waiting: Variant = early.load_extension(NodeProbe)
	root.add_child(early)
	await process_frame
	check(waiting.is_node_ready() and not waiting.is_processing() and waiting.ticks == 0, "tier off holds after the node becomes ready")
	early.set_quality(3)
	check(waiting.is_processing(), "leaving off after ready restores _process")
	early.free()
	var host := make_host()
	root.add_child(host)
	host.set_quality(0)
	var node: Variant = host.load_extension(NodeProbe)
	check(node is NodeProbe and node.get_parent() == host, "Script source instantiated and parented to the host")
	check(not node.is_processing(), "tier off switches _process off")
	host.set_quality(2)
	check(node.is_processing(), "leaving off restores _process")
	var journal: Array = []
	host.load_extension(Probe.new(&"x", journal))
	host.load_extension(Probe.new(&"y", journal))
	host.dispose(&"node_probe")
	check(node.disposed and node.is_queued_for_deletion() and host.state(&"node_probe") == &"absent", "dispose(id) disposes and frees an owned node")
	host.dispose()
	check(journal.slice(-2) == ["dispose:y", "dispose:x"] and host.ids().is_empty() and host.events.count(&"grab") == 0, "dispose() in reverse load order, bus cleared")
	check(host.load_extension(Probe.new(&"z", journal)) == null, "a disposed host loads nothing")
	host.free()
	# freeing the host disposes what is still loaded.
	var other := make_host()
	var kept := Probe.new(&"kept", journal)
	other.load_extension(kept)
	other.free()
	check(kept.disposed == 1, "freeing the host disposes its extensions")

func bus_and_physics() -> void:
	var bus := EventBus.new()
	var got: Array = []
	var off := bus.on(&"xr_start", func(d: Dictionary) -> void: got.append(d))
	check(bus.emit(&"xr_start", {"a": 1}) == 1 and got == [{"a": 1}], "bus delivers")
	off.call()
	check(bus.emit(&"xr_start") == 0 and bus.count(&"xr_start") == 0, "unsubscribe")
	check(EventBus.CORE_EVENTS.size() == 7 and EventBus.JS_NAMES.size() == 7 and EventBus.JS_NAMES[&"hand_tracking_changed"] == "handTrackingChanged", "core events mirror events.js")
	check(PhysicsAdapter.missing_methods(PhysicsAdapter.new()).is_empty() and PhysicsAdapter.missing_methods(RefCounted.new()).size() == 10, "physics adapter interface check")

## In a game copy: every synced file still has the hash SOURCE.json recorded (generated copies must not be edited).
func source_integrity() -> void:
	if not FileAccess.file_exists(SOURCE):
		print("SOURCE.json absent (source checkout): integrity check skipped")
		return
	var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(SOURCE))
	var bad: Array = []
	for item: Dictionary in data.get("files", []):
		var path := "res://" + String(item.target)
		if hash_like_sync(path) != item.sha256: bad.append(item.target)
	check(not data.get("files", []).is_empty() and bad.is_empty(), "synced files match SOURCE.json (edited: %s)" % [bad])

## Same hash as GameSystems/godot/tools/sync_addons.py: text files after CRLF -> LF (autocrlf checkouts are not edits).
static func hash_like_sync(path: String) -> String:
	if not FileAccess.file_exists(path): return ""
	if path.get_extension().to_lower() in ["gd", "json", "md", "txt", "cfg", "gdshader", "gdshaderinc", "tscn", "tres", "csv", ""]:
		return FileAccess.get_file_as_string(path).replace("\r\n", "\n").sha256_text()
	return FileAccess.get_sha256(path)

func real_crash() -> void:
	var host := make_host()
	var journal: Array = []
	var good := Probe.new(&"good", journal)
	var bad := Probe.new(&"bad", journal, {"real_crash": true})
	host.load_extension(good)
	host.load_extension(bad)
	host.update(0.016)
	host.update(0.016)
	check(host.ids() == [&"good"] and bad.disposed == 1 and good.updates == 2 and errors.back()[1] == "update", "real script error in update disposes only that extension")
	host.free()
