extends SceneTree

const ManagerScript = preload("../bottle_break_manager.gd")
const BottleScript = preload("../breakable_bottle.gd")
const LiquidScript = preload("../shaders/bottle_liquid.gd")
const HostScript = preload("res://addons/gs_host/gs_host.gd")
const ExtensionScript = preload("../gs_bottle_extension.gd")

class SilentBottle extends GSBreakableBottle:
	func _ready() -> void: pass

var checks := 0
var failures := 0

func check(value: bool, message: String) -> void:
	checks += 1
	if not value:
		failures += 1
		push_error(message)

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	check(BottleScript != null and LiquidScript != null, "bottle and liquid scripts load")
	var first_scene := Node3D.new()
	root.add_child(first_scene)
	current_scene = first_scene
	var manager: GSBottleBreakManager = GSBottleBreakManager.get_for(first_scene)
	await process_frame
	check(manager.get_parent() == first_scene, "manager is owned by its scene")
	manager.set_quality(GSBottleBreakManager.Quality.LOW)
	check(manager.max_shards == 24 and manager.max_droplets == 32 and manager.max_puddles == 6,
		"LOW tier applies bounded pools")
	manager.set_quality(GSBottleBreakManager.Quality.MINIMAL)
	check(manager.max_shards == 0 and manager.max_droplets == 12 and manager.max_puddles == 2,
		"MINIMAL tier disables shard physics and caps effects")
	check(manager.quality_at(Vector3.ZERO) == GSBottleBreakManager.Quality.MINIMAL,
		"no-camera fallback uses the configured tier")
	var second_scene := Node3D.new()
	root.add_child(second_scene)
	current_scene = second_scene
	var second_manager := GSBottleBreakManager.get_for(second_scene)
	await process_frame
	check(second_manager != manager and second_manager.get_parent() == second_scene,
		"two scenes receive independent managers")
	second_manager.queue_free()
	await process_frame
	current_scene = first_scene
	check(GSBottleBreakManager.get_for(first_scene) == manager,
		"remaining scene resolves its own live manager after another exits")
	check(is_instance_valid(manager), "other scene manager remains alive after sibling teardown")
	current_scene = null
	var nested_scene := Node3D.new()
	var left_branch := Node3D.new()
	var right_branch := Node3D.new()
	root.add_child(nested_scene)
	nested_scene.add_child(left_branch)
	nested_scene.add_child(right_branch)
	var nested_a := GSBottleBreakManager.get_for(left_branch)
	var nested_b := GSBottleBreakManager.get_for(right_branch)
	check(nested_a == nested_b and nested_a.get_parent() == nested_scene,
		"manager resolves the top scene when current_scene is unset")
	nested_scene.queue_free()
	await process_frame
	var extension_scene := Node3D.new()
	root.add_child(extension_scene)
	current_scene = extension_scene
	var sample := SilentBottle.new()
	extension_scene.add_child(sample) # Existing scene bottles must be discovered on init.
	var host: GSHost = HostScript.new()
	host.auto_update = false
	host.scene_root = extension_scene
	extension_scene.add_child(host)
	var api: GSBottleExtension = host.load_extension(ExtensionScript, {"asset_root": "assets/game_systems/bottles/"})
	check(api != null and api.get_manager().get_parent() == extension_scene,
		"extension loads with a mission-owned manager")
	host.set_tier(&"gs_bottles", &"low")
	check(api.get_manager().quality == GSBottleBreakManager.Quality.LOW,
		"host quality tiers configure the bottle manager")
	host.set_tier(&"gs_bottles", &"minimal")
	check(api.get_manager().quality == GSBottleBreakManager.Quality.MINIMAL,
		"host minimal tier maps to the bottle minimal budget")
	host.set_tier(&"gs_bottles", &"low")
	var transient := SilentBottle.new()
	extension_scene.add_child(transient)
	check(api._tracked.size() == 2, "extension tracks runtime-added bottles")
	extension_scene.remove_child(transient)
	check(api._tracked.size() == 1, "extension prunes bottles when they leave the scene")
	transient.free()
	var tracked_before_invalid: int = api._tracked.size()
	var outside_scope := Node3D.new()
	root.add_child(outside_scope)
	check(api.create_bottle("wine", 0.5, outside_scope) == null
		and api._tracked.size() == tracked_before_invalid,
		"extension refuses to create bottles in another scene scope")
	check(api.create_bottle("missing_style", 0.5, extension_scene) == null
		and api._tracked.size() == tracked_before_invalid,
		"missing bottle assets are rejected without invoking the asserting factory")
	check(api.create_bottle("wine", NAN, extension_scene) == null
		and api._tracked.size() == tracked_before_invalid,
		"non-finite bottle fill is rejected before construction")
	outside_scope.queue_free()
	var broken_events: Array[Dictionary] = []
	host.on(&"broken", func(data: Dictionary) -> void: broken_events.append(data))
	sample.broke.emit(Vector3.ONE, 2.5, &"shatter")
	check(broken_events.size() == 1 and broken_events[0].get("body") == sample
		and broken_events[0].get("at") == Vector3.ONE,
		"pre-existing bottle is bridged to one core broken event")
	check(api._tracked.is_empty(), "one-shot break event releases its tracked reference")
	var extension_manager := api.get_manager()
	host.dispose(&"gs_bottles")
	var after_dispose := SilentBottle.new()
	extension_scene.add_child(after_dispose)
	api.track_bottle(after_dispose)
	check(api._tracked.is_empty() and not after_dispose.broke.is_connected(api._on_broken.bind(after_dispose)),
		"retained API references cannot reattach bottle listeners after extension disposal")
	after_dispose.queue_free()
	await process_frame
	check(not is_instance_valid(extension_manager), "extension teardown frees its owned manager")
	host.queue_free()
	extension_scene.queue_free()
	await process_frame
	first_scene.queue_free()
	await process_frame
	print("GS_BOTTLES: %d checks, %d failures" % [checks, failures])
	quit(1 if failures else 0)
