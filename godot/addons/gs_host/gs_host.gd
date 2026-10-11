class_name GSHost
extends Node
## Extension host, the Godot port of GameSystems/extensions/host/host.js: loads extensions, gives each a GSContext,
## routes core events and quality changes, and contains failures. Not an autoload: the game's mission scene owns it
## (like the bottle manager), so a mission teardown disposes every extension.
##
##   extension = any Object with ID, init_extension(ctx) and optionally REQUIRES, QUALITY, update_extension(dt),
##               set_quality(tier), dispose_extension()  (contract and fault rules: gs_extension.gd)
##   ctx = GSContext {id, scene_root, camera, xr_origin, game, physics, options, quality (current tier),
##                    asset_path(path), emit(event, data), on(event, cb) -> unsubscribe, get_ext(id), fail(reason)}
##
##   var api = host.load_extension(preload("res://addons/gs_x/x.gd"), {option = 1})   # api, or null when it failed
## Sources: an extension Object, a Script, a PackedScene, a resource path, or a Callable(options) returning one.
## A missing or failing optional extension only disables that feature. Listeners registered through ctx.on are removed
## when the extension is disposed. A failure in init/update/set_quality is reported through on_error and the
## extension_failed signal, the extension is disposed, and the game keeps running. init is synchronous in Godot
## (do deferred loading inside the extension). Quality: one global level 0..max_level -> a tier per extension
## (gs_quality.gd, same mapping as quality.js); tiers can be pinned with set_tier.

const Quality = preload("gs_quality.gd")
const EventBus = preload("gs_event_bus.gd")
const Context = preload("gs_context.gd")
const PhysicsAdapter = preload("gs_physics_adapter.gd")
const ErrorTrap = preload("gs_error_trap.gd")
const MAX_ERRORS := 32

signal extension_loaded(id: StringName)
signal extension_failed(id: StringName, phase: StringName, message: String)
signal extension_disposed(id: StringName)

@export var max_level := 3.0
@export var auto_update := true ## update(delta) from _process; false: the game calls update(dt) itself
@export var asset_root := "res://" ## base of relative asset_path() requests
var scene_root: Node
var camera: Node
var xr_origin: Node
var game: Variant
var physics: Object:
	set(value):
		var missing := PhysicsAdapter.missing_methods(value) if value != null else PackedStringArray()
		if not missing.is_empty():
			push_error("GSHost: physics adapter is missing: %s" % ", ".join(missing))
			return
		physics = value
## on_error.call(message: String, id: StringName, phase: StringName); default: push_warning.
var on_error: Callable
var errors: Array[Dictionary] = [] ## last MAX_ERRORS failures {id, phase, message}
var events: EventBus
## Global quality level (0..max_level).
var level: float:
	get: return _level

var _records := {} # StringName -> record Dictionary, in load order
var _level := 3.0
var _disposed := false

func _init() -> void:
	ErrorTrap.acquire()
	events = EventBus.new()
	events.on_error = _listener_error

func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		if not _disposed: _dispose_all(true)
		ErrorTrap.release()

func _process(delta: float) -> void:
	if auto_update: update(delta)

func emit(event: StringName, data: Variant = {}) -> int:
	return events.emit(event, data)

func on(event: StringName, cb: Callable) -> Callable:
	return events.on(event, cb)

## Public api of a ready extension, else null.
func get_ext(id: StringName) -> Variant:
	var record: Variant = _records.get(id)
	return record.api if record != null and record.state == &"ready" else null

## &"absent", &"loading", &"ready" (failed/disposed extensions are removed, so they read as absent).
func state(id: StringName) -> StringName:
	var record: Variant = _records.get(id)
	return record.state if record != null else &"absent"

func ids() -> Array[StringName]:
	var out: Array[StringName] = []
	out.assign(_records.keys())
	return out

## Current tier name of an extension, or null.
func tier(id: StringName) -> Variant:
	var record: Variant = _records.get(id)
	return record.tier if record != null else null

func asset_path(path: String) -> String:
	if path.begins_with("res://") or path.begins_with("user://") or path.is_absolute_path(): return path
	return asset_root.path_join(path)

func load_extension(source: Variant, options: Dictionary = {}) -> Variant:
	if _disposed: return null
	var resolved := _resolve(source, options)
	var ext: Object = resolved[0]
	if ext == null:
		_report("Not an extension: needs ID and init_extension(ctx)", StringName(str(options.get("id", "?"))), &"load")
		return null
	var id := StringName(ext.get("ID"))
	if _records.has(id):
		_free_created(ext, resolved[1])
		_report("Extension '%s' is already loaded" % id, id, &"load")
		return null
	var missing := PackedStringArray()
	var requires: Variant = ext.get("REQUIRES")
	if requires is Array or requires is PackedStringArray:
		for other in requires:
			if get_ext(StringName(other)) == null: missing.append(String(other))
	if not missing.is_empty():
		_free_created(ext, resolved[1])
		_report("Extension '%s' requires %s" % [id, ", ".join(missing)], id, &"load")
		return null
	var tiers := Quality.tiers_of(ext.get("QUALITY"))
	var ctx := Context.new()
	ctx.id = id
	ctx.scene_root = scene_root
	ctx.camera = camera
	ctx.xr_origin = xr_origin
	ctx.game = game
	ctx.physics = physics
	ctx.options = options
	ctx._host = self
	var record := {"id": id, "ext": ext, "ctx": ctx, "state": &"loading", "api": null, "tiers": tiers,
		"tier": Quality.tier_for(tiers, _level, max_level), "pinned": null, "unsubscribers": [], "owned_node": false}
	_records[id] = record
	if ext is Node and (ext as Node).get_parent() == null:
		add_child(ext)
		record.owned_node = true
	_apply_processing(record)
	var before := ErrorTrap.count()
	var api: Variant = ext.call(&"init_extension", ctx)
	var crashed := before >= 0 and ErrorTrap.count() != before
	if record.state != &"loading": # disposed while loading
		if record.state == &"cancelled": _finish(record, &"disposed")
		return null
	if crashed or api == null or record.has("fail_reason"):
		_teardown(record, &"init", record.get("fail_reason", "init_extension crashed (script error)" if crashed else "init_extension returned null"))
		return null
	record.api = api
	record.state = &"ready"
	_apply_processing(record)
	extension_loaded.emit(id)
	return api

## Per-frame update of every ready extension whose tier is not "off".
func update(dt: float) -> void:
	for record: Dictionary in _records.values():
		if record.state != &"ready" or Quality.is_off(record.tier): continue
		var ext: Object = record.ext
		if not is_instance_valid(ext):
			_teardown(record, &"update", "extension object was freed")
			continue
		if not ext.has_method(&"update_extension"): continue
		var before := ErrorTrap.count()
		var result: Variant = ext.call(&"update_extension", dt)
		if before >= 0 and ErrorTrap.count() != before: _teardown(record, &"update", "update_extension crashed (script error)")
		elif result is bool and not result: _teardown(record, &"update", "update_extension returned false")

## Global quality level (0..max_level); pinned extensions keep their tier.
func set_quality(value: float) -> void:
	_level = 0.0 if is_nan(value) else clampf(value, 0.0, max_level)
	for record: Dictionary in _records.values():
		if record.pinned == null: _apply_tier(record, Quality.tier_for(record.tiers, _level, max_level))

## Pin one extension to a tier (name or index); null unpins and follows the global level again. Returns the tier,
## or null for an unknown extension or tier.
func set_tier(id: StringName, value: Variant) -> Variant:
	var record: Variant = _records.get(id)
	if record == null: return null
	if value == null:
		record.pinned = null
		_apply_tier(record, Quality.tier_for(record.tiers, _level, max_level))
		return record.tier
	var name: Variant = Quality.normalize_tier(record.tiers, value)
	if name == null:
		push_warning("GSHost: extension '%s' has no quality tier %s (%s)" % [id, value, ", ".join(record.tiers)])
		return null
	record.pinned = name
	_apply_tier(record, name)
	return name

## Dispose one extension, or with no id every extension (reverse load order) and the host itself.
func dispose(id: StringName = &"") -> void:
	if id != &"":
		var record: Variant = _records.get(id)
		if record != null: _teardown(record, &"dispose")
		return
	_dispose_all(false)

func _dispose_all(deleting: bool) -> void:
	_disposed = true
	var records := _records.values()
	records.reverse()
	for record: Dictionary in records:
		if deleting: record.owned_node = false # children are freed with the host
		_teardown(record, &"dispose")
	events.clear()

# ready -> disposed (dispose now); loading -> cancelled (disposed once init returns); failure -> failed (dispose now).
func _teardown(record: Dictionary, phase: StringName, error: String = "") -> void:
	if error != "": _report(error, record.id, phase)
	for off: Callable in record.unsubscribers: off.call()
	record.unsubscribers.clear()
	if record.state == &"loading" and error == "": record.state = &"cancelled"
	elif record.state == &"ready" or record.state == &"loading" or (error != "" and record.state == &"cancelled"):
		_finish(record, &"failed" if error != "" else &"disposed")
	if is_same(_records.get(record.id), record): _records.erase(record.id)

func _finish(record: Dictionary, final_state: StringName) -> void:
	record.state = final_state
	(record.ctx as Context)._host = null
	var ext: Object = record.ext
	if is_instance_valid(ext):
		if ext.has_method(&"dispose_extension"):
			var before := ErrorTrap.count()
			ext.call(&"dispose_extension")
			if before >= 0 and ErrorTrap.count() != before: _report("dispose_extension crashed (script error)", record.id, &"dispose")
		if record.owned_node and not (ext as Node).is_queued_for_deletion():
			(ext as Node).set_process(false)
			(ext as Node).set_physics_process(false)
			(ext as Node).queue_free()
	record.ext = null
	record.api = null
	extension_disposed.emit(record.id)

func _apply_tier(record: Dictionary, value: Variant) -> void:
	if value == record.tier: return
	record.tier = value
	if record.state != &"ready": return # init_extension reads ctx.quality
	_apply_processing(record)
	var ext: Object = record.ext
	if not is_instance_valid(ext) or not ext.has_method(&"set_quality"): return
	var before := ErrorTrap.count()
	var result: Variant = ext.call(&"set_quality", StringName(value))
	if before >= 0 and ErrorTrap.count() != before: _teardown(record, &"set_quality", "set_quality crashed (script error)")
	elif result is bool and not result: _teardown(record, &"set_quality", "set_quality returned false")

# "off" switches a node extension's _process/_physics_process off; leaving "off" restores what it had.
func _apply_processing(record: Dictionary) -> void:
	var node := record.ext as Node
	if node == null or not is_instance_valid(node): return
	if not node.is_node_ready():
		# Godot switches processing on when the node becomes ready (host not in the tree yet): decide then.
		if not record.get("waiting_ready", false):
			record.waiting_ready = true
			node.ready.connect(_node_ready.bind(record.id, node), CONNECT_ONE_SHOT)
		return
	if Quality.is_off(record.tier):
		if not record.has("saved_processing"):
			record.saved_processing = [node.is_processing(), node.is_physics_processing()]
		node.set_process(false)
		node.set_physics_process(false)
	elif record.has("saved_processing"):
		node.set_process(record.saved_processing[0])
		node.set_physics_process(record.saved_processing[1])
		record.erase("saved_processing")

func _node_ready(id: StringName, node: Node) -> void:
	var record: Variant = _records.get(id)
	if record != null and record.ext == node:
		record.waiting_ready = false
		_apply_processing(record)

# [extension or null, created_here]
func _resolve(source: Variant, options: Dictionary) -> Array:
	var x: Variant = source
	var created := false
	if x is Callable:
		x = (x as Callable).call(options)
		created = true
	if x is String or x is StringName:
		x = load(String(x)) if ResourceLoader.exists(String(x)) else null
	if x is PackedScene:
		x = (x as PackedScene).instantiate()
		created = true
	elif x is Script:
		x = (x as Script).new() if (x as Script).can_instantiate() else null
		created = true
	if x is Object and is_instance_valid(x) and (x as Object).has_method(&"init_extension"):
		var id: Variant = (x as Object).get("ID")
		if (id is String or id is StringName) and String(id) != "": return [x, created]
	_free_created(x, created)
	return [null, false]

func _free_created(x: Variant, created: bool) -> void:
	if created and x is Node and is_instance_valid(x) and (x as Node).get_parent() == null: (x as Node).free()

func _context_on(ctx: Context, event: StringName, cb: Callable) -> Callable:
	var record := _record_for(ctx)
	if record.is_empty() or not (record.state == &"loading" or record.state == &"ready"): return func() -> void: pass
	var off := events.on(event, cb)
	record.unsubscribers.append(off)
	return off

func _context_fail(ctx: Context, reason: String) -> void:
	var record := _record_for(ctx)
	if record.is_empty(): return
	if record.state == &"loading": record.fail_reason = reason
	elif record.state == &"ready": _teardown(record, &"fail", reason)

func _record_for(ctx: Context) -> Dictionary:
	var record: Variant = _records.get(ctx.id)
	return record if record != null and is_same(record.ctx, ctx) else {}

func _listener_error(message: String, event: StringName) -> void:
	_report(message, StringName("event:%s" % event), &"listener")

func _report(message: String, id: StringName, phase: StringName) -> void:
	errors.append({"id": id, "phase": phase, "message": message})
	if errors.size() > MAX_ERRORS: errors.pop_front()
	extension_failed.emit(id, phase, message)
	if on_error.is_valid(): on_error.call(message, id, phase)
	else: push_warning("Extension '%s' failed in %s: %s" % [id, phase, message])
