class_name GSCameraSystem
extends Node
## Shared, bounded monoscopic camera feeds. Host cameras/meshes remain host-owned.
## Add this node to the scene before registering feeds. step() schedules rendering;
## frame_post_draw completes it. No frame catch-up and no dependency on gs_host.

const ID := &"gs_cameras"
const QUALITY := ["minimal", "low", "mid", "high"]
const MAX_FEEDS := 16
const MAX_SCREENS := 32
const CHECKPOINT_SCHEMA := "gamesystems.godot.cameras.v1"
const SCREEN_OWNER_META := &"_gs_cameras_owner"
const OFF_COLOR := Color(0.031373, 0.05098, 0.070588, 1.0)
const BUDGETS := {
	"minimal": {"width": 128, "fps": 2, "per_step": 1},
	"low": {"width": 256, "fps": 4, "per_step": 1},
	"mid": {"width": 512, "fps": 8, "per_step": 2},
	"high": {"width": 1024, "fps": 15, "per_step": 2},
}

signal screen_changed(state: Dictionary)

@export var auto_update := true
var quality: StringName:
	get: return _quality

var _quality := &"high"
var _max_feeds := MAX_FEEDS
var _max_screens := MAX_SCREENS
var _screen_layer := 20
var _screen_mask := 1 << 19
var _feeds: Dictionary = {}
var _screens: Dictionary = {}
var _clock := 0.0
var _cursor := 0
var _topology_revision := 0
var _disposed := false
var _stepping := false
var _context: Object


func _enter_tree() -> void:
	if _disposed: return
	RenderingServer.frame_pre_draw.connect(_before_draw)
	RenderingServer.frame_post_draw.connect(_after_draw)


func _exit_tree() -> void:
	dispose()


func _process(delta: float) -> void:
	if auto_update: step(delta)


## Configure before registration. Registry limits may be lowered, never raised.
func configure(options: Dictionary) -> bool:
	if _disposed or not _feeds.is_empty() or not _screens.is_empty(): return false
	if not _only_keys(options, ["quality", "max_feeds", "max_screens", "screen_layer"]): return false
	var tier: Variant = options.get("quality", _quality)
	var feeds_limit: Variant = options.get("max_feeds", _max_feeds)
	var screens_limit: Variant = options.get("max_screens", _max_screens)
	var layer: Variant = options.get("screen_layer", _screen_layer)
	if not _valid_quality(tier) or not _integer_between(feeds_limit, 1, MAX_FEEDS) \
			or not _integer_between(screens_limit, 1, MAX_SCREENS) or not _integer_between(layer, 1, 20): return false
	_quality = StringName(tier)
	_max_feeds = feeds_limit
	_max_screens = screens_limit
	_screen_layer = layer
	_screen_mask = 1 << (_screen_layer - 1)
	return true


## Optional GSHost lifecycle. The host drives update_extension; direct use uses _process.
func init_extension(context: Object) -> Variant:
	if _disposed or not is_instance_valid(context): return null
	var options: Dictionary = context.options.duplicate()
	options["quality"] = context.quality
	if not configure(options): return null
	_context = context
	auto_update = false
	return self


func update_extension(delta: float) -> bool:
	return bool(step(delta).ok)


func dispose_extension() -> void:
	dispose()


func add_feed(id: StringName, values: Dictionary) -> bool:
	if _disposed or not is_inside_tree() or not _valid_id(id) or _feeds.has(id) or _feeds.size() >= _max_feeds:
		return false
	if not _only_keys(values, ["camera", "aspect", "enabled", "label", "world_3d"]): return false
	var source: Variant = values.get("camera")
	var aspect: Variant = values.get("aspect", 16.0 / 9.0)
	var enabled: Variant = values.get("enabled", true)
	var label: Variant = values.get("label", String(id))
	var world: Variant = values.get("world_3d")
	if typeof(source) != TYPE_OBJECT or not is_instance_valid(source) or not source is Camera3D or not _camera_ready(source) \
			or not _number_between(aspect, 0.25, 4.0) or not enabled is bool \
			or not label is String or label.strip_edges().is_empty() or label.length() > 256 \
			or (world != null and not world is World3D): return false
	var viewport := SubViewport.new()
	viewport.name = "CameraFeed"
	viewport.size = _dimensions(float(aspect))
	viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED
	viewport.world_3d = world if world != null else source.get_world_3d()
	viewport.use_xr = false
	viewport.gui_disable_input = true
	viewport.physics_object_picking = false
	viewport.audio_listener_enable_2d = false
	viewport.audio_listener_enable_3d = false
	viewport.msaa_3d = Viewport.MSAA_DISABLED
	viewport.screen_space_aa = Viewport.SCREEN_SPACE_AA_DISABLED
	viewport.use_taa = false
	add_child(viewport)
	var mirror := Camera3D.new()
	mirror.name = "FeedCamera"
	viewport.add_child(mirror)
	mirror.current = true
	var feed := {"camera": source, "world_3d": world, "viewport": viewport, "mirror": mirror,
		"aspect": float(aspect), "enabled": enabled, "label": label.strip_edges(), "frames": 0,
		"last_time": -INF, "pending": false, "drawing": false}
	_feeds[id] = feed
	_sync_camera(feed)
	_topology_revision += 1
	return true


func add_screen(id: StringName, values: Dictionary) -> bool:
	if _disposed or not _valid_id(id) or _screens.has(id) or _screens.size() >= _max_screens: return false
	if not _only_keys(values, ["mesh", "feed_id", "enabled"]): return false
	var mesh: Variant = values.get("mesh")
	var feed_id: Variant = values.get("feed_id")
	var enabled: Variant = values.get("enabled", true)
	if typeof(mesh) != TYPE_OBJECT or not is_instance_valid(mesh) or not mesh is MeshInstance3D or not mesh.is_inside_tree() \
			or mesh.is_queued_for_deletion() or mesh.mesh == null or mesh.mesh.get_surface_count() != 1 \
			or mesh.material_overlay != null or mesh.has_meta(SCREEN_OWNER_META) \
			or not _valid_feed_reference(feed_id) or not enabled is bool: return false
	var material := StandardMaterial3D.new()
	material.resource_name = "GameSystems camera screen"
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR
	material.albedo_color = OFF_COLOR
	var screen := {"mesh": mesh, "feed_id": null if feed_id == null else StringName(feed_id),
		"enabled": enabled, "material": material, "original_material": mesh.material_override,
		"original_layers": mesh.layers}
	_screens[id] = screen
	mesh.set_meta(SCREEN_OWNER_META, get_instance_id())
	mesh.material_override = material
	mesh.layers = _screen_mask
	_topology_revision += 1
	_refresh_screen(screen)
	return true


func feed_state(id: StringName) -> Dictionary:
	if _disposed or not _feeds.has(id): return {}
	var feed: Dictionary = _feeds[id]
	var size: Vector2i = feed.viewport.size
	return {"id": String(id), "enabled": feed.enabled, "aspect": feed.aspect,
		"frames": feed.frames, "width": size.x, "height": size.y, "pending": feed.pending}


func screen_state(id: StringName) -> Dictionary:
	if _disposed or not _screens.has(id): return {}
	var screen: Dictionary = _screens[id]
	return {"id": String(id), "feed_id": null if screen.feed_id == null else String(screen.feed_id),
		"enabled": screen.enabled}


func feed_options(screen_id: StringName) -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	if _disposed or not _screens.has(screen_id): return result
	for id: StringName in _feeds:
		var feed: Dictionary = _feeds[id]
		result.append({"id": String(id), "label": feed.label, "enabled": feed.enabled,
			"selected": _screens[screen_id].feed_id == id})
	return result


func texture(id: StringName) -> Texture2D:
	if _disposed or not _feeds.has(id): return null
	return _feeds[id].viewport.get_texture()


func switch_feed(screen_id: StringName, feed_id: Variant) -> bool:
	if _disposed or not _screens.has(screen_id) or not _valid_feed_reference(feed_id): return false
	_screens[screen_id].feed_id = null if feed_id == null else StringName(feed_id)
	_refresh_screen(_screens[screen_id])
	_cancel_unselected()
	var state := screen_state(screen_id)
	# Publish copies after state is committed. Callbacks may dispose this system.
	if is_instance_valid(_context): _context.emit(&"cameras:screen", state.duplicate())
	if not _disposed: screen_changed.emit(state)
	return true


func set_screen_enabled(id: StringName, value: Variant) -> bool:
	if _disposed or not _screens.has(id) or not value is bool: return false
	_screens[id].enabled = value
	_refresh_screen(_screens[id])
	_cancel_unselected()
	return true


func set_feed_enabled(id: StringName, value: Variant) -> bool:
	if _disposed or not _feeds.has(id) or not value is bool: return false
	var feed: Dictionary = _feeds[id]
	if feed.enabled == value: return true
	feed.enabled = value
	if not value: _cancel_feed(feed)
	feed.last_time = -INF
	_refresh()
	return true


func set_quality(tier: StringName) -> bool:
	if _disposed or not _valid_quality(tier): return false
	if tier == _quality: return true
	_quality = tier
	for feed: Dictionary in _feeds.values():
		_cancel_feed(feed)
		feed.viewport.size = _dimensions(feed.aspect)
		feed.frames = 0
		feed.last_time = -INF
	_refresh()
	return true


func remove_screen(id: StringName) -> bool:
	if _disposed or not _screens.has(id): return false
	var screen: Dictionary = _screens[id]
	var mesh: MeshInstance3D = screen.mesh if is_instance_valid(screen.mesh) else null
	if mesh != null:
		if mesh.material_override == screen.material: mesh.material_override = screen.original_material
		if mesh.layers == _screen_mask: mesh.layers = screen.original_layers
		if mesh.get_meta(SCREEN_OWNER_META, null) == get_instance_id(): mesh.remove_meta(SCREEN_OWNER_META)
	# Release target references even if a caller kept the former display material.
	screen.material.albedo_texture = null
	_screens.erase(id)
	_topology_revision += 1
	_cancel_unselected()
	return true


func remove_feed(id: StringName) -> bool:
	if _disposed or not _feeds.has(id): return false
	for screen: Dictionary in _screens.values():
		if screen.feed_id == id:
			screen.feed_id = null
			_refresh_screen(screen)
	var feed: Dictionary = _feeds[id]
	_cancel_feed(feed)
	var viewport: SubViewport = feed.viewport
	_feeds.erase(id)
	_topology_revision += 1
	if is_instance_valid(viewport): viewport.free()
	return true


## Schedule at most the tier budget in flight across all calls until a draw completes.
## The result counts scheduled requests, not GPU-completed images. No catch-up rendering.
func step(delta: float) -> Dictionary:
	if _disposed or not is_inside_tree() or _stepping or not is_finite(delta) or delta < 0.0 \
			or not is_finite(_clock + delta): return {"ok": false, "scheduled": 0, "pending": _pending_count()}
	_stepping = true
	_clock += delta
	_cancel_unselected()
	_refresh()
	var selected := _selected_feeds()
	var ordered: Array = selected.keys()
	ordered.sort()
	var remaining := int(BUDGETS[String(_quality)].per_step) - _pending_count()
	var scheduled := 0
	var count := ordered.size()
	var start := _cursor % count if count > 0 else 0
	for offset in range(count):
		if remaining <= 0: break
		var index := (start + offset) % count
		var feed: Dictionary = _feeds[ordered[index]]
		if not feed.enabled or feed.pending or not _camera_ready(feed.camera): continue
		if _clock - float(feed.last_time) + 1.0e-9 < 1.0 / float(BUDGETS[String(_quality)].fps): continue
		_sync_camera(feed)
		feed.pending = true
		feed.drawing = false
		feed.viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
		_cursor = (index + 1) % count
		scheduled += 1
		remaining -= 1
	_stepping = false
	return {"ok": true, "scheduled": scheduled, "pending": _pending_count()}


func stats() -> Dictionary:
	if _disposed: return {}
	var frames := 0
	for feed: Dictionary in _feeds.values(): frames += int(feed.frames)
	var result: Dictionary = BUDGETS[String(_quality)].duplicate()
	result.merge({"quality": String(_quality), "feeds": _feeds.size(), "screens": _screens.size(),
		"frames": frames, "pending": _pending_count(), "max_feeds": _max_feeds,
		"max_screens": _max_screens, "screen_layer": _screen_layer})
	return result


## Only JSON values: topology references and flags. Poses/optics/worlds/quality stay host-owned.
func checkpoint() -> Dictionary:
	if _disposed: return {}
	var feeds: Array[Dictionary] = []
	var screens: Array[Dictionary] = []
	for id: StringName in _feeds: feeds.append({"id": String(id), "enabled": _feeds[id].enabled})
	for id: StringName in _screens: screens.append(screen_state(id))
	return {"schema": CHECKPOINT_SCHEMA, "feeds": feeds, "screens": screens}


## Fully validate before mutation. A one-shot commit also checks the topology revision.
## Accepts a decoded JSON Dictionary or JSON text (at most 64 KiB).
func prepare_restore(payload: Variant) -> Dictionary:
	var failure := {"ok": false}
	if _disposed: return failure
	var data: Variant = payload
	if payload is String:
		if payload.length() > 65536: return failure
		var parser := JSON.new()
		if parser.parse(payload) != OK: return failure
		data = parser.data
	if not data is Dictionary or not _exact_keys(data, ["schema", "feeds", "screens"]) \
			or not data.schema is String or data.schema != CHECKPOINT_SCHEMA \
			or not data.feeds is Array or not data.screens is Array \
			or data.feeds.size() != _feeds.size() or data.screens.size() != _screens.size() \
			or not _topology_live(): return failure
	var feed_flags: Dictionary = {}
	var screen_flags: Dictionary = {}
	for row: Variant in data.feeds:
		if not row is Dictionary or not _exact_keys(row, ["id", "enabled"]) \
				or not row.id is String or not _valid_id(row.id) or not row.enabled is bool: return failure
		var id := StringName(row.id)
		if not _feeds.has(id) or feed_flags.has(id): return failure
		feed_flags[id] = row.enabled
	for row: Variant in data.screens:
		if not row is Dictionary or not _exact_keys(row, ["id", "enabled", "feed_id"]) \
				or not row.id is String or not _valid_id(row.id) or not row.enabled is bool \
				or (row.feed_id != null and not row.feed_id is String) or not _valid_feed_reference(row.feed_id): return failure
		var id := StringName(row.id)
		if not _screens.has(id) or screen_flags.has(id): return failure
		screen_flags[id] = {"enabled": row.enabled,
			"feed_id": null if row.feed_id == null else StringName(row.feed_id)}
	var plan := {"feeds": feed_flags, "screens": screen_flags, "used": false}
	var revision := _topology_revision
	return {"ok": true, "commit": func() -> bool: return _commit_restore(plan, revision)}


func restore_checkpoint(payload: Variant) -> bool:
	var prepared := prepare_restore(payload)
	return prepared.commit.call() if prepared.ok else false


func dispose() -> void:
	if _disposed: return
	if RenderingServer.frame_pre_draw.is_connected(_before_draw): RenderingServer.frame_pre_draw.disconnect(_before_draw)
	if RenderingServer.frame_post_draw.is_connected(_after_draw): RenderingServer.frame_post_draw.disconnect(_after_draw)
	for id: StringName in _screens.keys(): remove_screen(id)
	for id: StringName in _feeds.keys(): remove_feed(id)
	_disposed = true
	_context = null
	set_process(false)
	_topology_revision += 1


func _before_draw() -> void:
	if _disposed: return
	_cancel_unselected()
	_refresh()
	for feed: Dictionary in _feeds.values():
		if feed.pending:
			_sync_camera(feed)
			feed.drawing = true


func _after_draw() -> void:
	if _disposed: return
	for feed: Dictionary in _feeds.values():
		if not feed.pending or not feed.drawing: continue
		feed.pending = false
		feed.drawing = false
		feed.viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED
		feed.last_time = _clock
		feed.frames += 1
	_refresh()


func _sync_camera(feed: Dictionary) -> void:
	var source: Camera3D = feed.camera
	var mirror: Camera3D = feed.mirror
	var viewport: SubViewport = feed.viewport
	var world: World3D = feed.world_3d if feed.world_3d != null else source.get_world_3d()
	if viewport.world_3d != world: viewport.world_3d = world
	mirror.global_transform = source.global_transform
	mirror.keep_aspect = source.keep_aspect
	mirror.set_perspective(source.fov, source.near, source.far)
	mirror.h_offset = source.h_offset
	mirror.v_offset = source.v_offset
	mirror.cull_mask = source.cull_mask & ~_screen_mask
	mirror.environment = source.environment
	mirror.attributes = source.attributes


func _refresh() -> void:
	for screen: Dictionary in _screens.values(): _refresh_screen(screen)


func _refresh_screen(screen: Dictionary) -> void:
	var feed: Dictionary = _feeds.get(screen.feed_id, {})
	var active: bool = screen.enabled and not feed.is_empty() and feed.enabled and feed.frames > 0 \
		and _screen_bound(screen) and _camera_ready(feed.camera)
	var material: StandardMaterial3D = screen.material
	material.albedo_texture = feed.viewport.get_texture() if active else null
	material.albedo_color = Color.WHITE if active else OFF_COLOR


func _selected_feeds() -> Dictionary:
	var selected: Dictionary = {}
	for screen: Dictionary in _screens.values():
		if screen.enabled and screen.feed_id != null and _screen_bound(screen) and screen.mesh.is_visible_in_tree():
			selected[screen.feed_id] = true
	return selected


func _cancel_unselected() -> void:
	var selected := _selected_feeds()
	for id: StringName in _feeds:
		var feed: Dictionary = _feeds[id]
		if feed.pending and (not feed.enabled or not selected.has(id) or not _camera_ready(feed.camera)):
			_cancel_feed(feed)


func _cancel_feed(feed: Dictionary) -> void:
	feed.pending = false
	feed.drawing = false
	if is_instance_valid(feed.viewport): feed.viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED


func _pending_count() -> int:
	var count := 0
	for feed: Dictionary in _feeds.values():
		if feed.pending: count += 1
	return count


func _screen_bound(screen: Dictionary) -> bool:
	var mesh: Variant = screen.mesh
	return is_instance_valid(mesh) and mesh.is_inside_tree() and not mesh.is_queued_for_deletion() \
		and mesh.material_override == screen.material and mesh.layers == _screen_mask \
		and mesh.get_meta(SCREEN_OWNER_META, null) == get_instance_id()


func _camera_ready(camera: Variant) -> bool:
	return typeof(camera) == TYPE_OBJECT and is_instance_valid(camera) and camera is Camera3D and camera.is_inside_tree() \
		and not camera.is_queued_for_deletion() and camera.projection == Camera3D.PROJECTION_PERSPECTIVE \
		and camera.global_transform.is_finite() and _number_between(camera.fov, 1.0, 179.0) \
		and is_finite(camera.near) and is_finite(camera.far) and camera.near > 0.0 and camera.far > camera.near \
		and is_finite(camera.h_offset) and is_finite(camera.v_offset)


func _topology_live() -> bool:
	for feed: Dictionary in _feeds.values():
		if not is_instance_valid(feed.camera) or feed.camera.is_queued_for_deletion(): return false
	for screen: Dictionary in _screens.values():
		if not is_instance_valid(screen.mesh) or screen.mesh.is_queued_for_deletion(): return false
	return true


func _commit_restore(plan: Dictionary, revision: int) -> bool:
	if _disposed or plan.used or revision != _topology_revision or not _topology_live(): return false
	plan.used = true
	for id: StringName in plan.feeds:
		var feed: Dictionary = _feeds[id]
		_cancel_feed(feed)
		feed.enabled = plan.feeds[id]
		feed.frames = 0
		feed.last_time = -INF
	for id: StringName in plan.screens:
		_screens[id].enabled = plan.screens[id].enabled
		_screens[id].feed_id = plan.screens[id].feed_id
	_cursor = 0
	_refresh()
	return true


func _dimensions(aspect: float) -> Vector2i:
	var side := int(BUDGETS[String(_quality)].width)
	return Vector2i(maxi(2, roundi(minf(side, side * aspect))), maxi(2, roundi(minf(side, side / aspect))))


func _valid_feed_reference(id: Variant) -> bool:
	return id == null or (_valid_id(id) and _feeds.has(StringName(id)))


static func _valid_id(value: Variant) -> bool:
	return (value is String or value is StringName) and not String(value).strip_edges().is_empty() \
		and String(value).length() <= 128


static func _valid_quality(value: Variant) -> bool:
	return (value is String or value is StringName) and BUDGETS.has(String(value))


static func _number_between(value: Variant, low: float, high: float) -> bool:
	return (value is float or value is int) and is_finite(float(value)) and value >= low and value <= high


static func _integer_between(value: Variant, low: int, high: int) -> bool:
	return value is int and value >= low and value <= high


static func _only_keys(value: Dictionary, keys: Array) -> bool:
	for key: Variant in value:
		if not (key is String or key is StringName) or not keys.has(String(key)): return false
	return true


static func _exact_keys(value: Dictionary, keys: Array) -> bool:
	if value.size() != keys.size(): return false
	for key: Variant in value:
		if not key is String or not keys.has(key): return false
	return true
