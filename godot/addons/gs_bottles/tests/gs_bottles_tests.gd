extends SceneTree

const ManagerScript = preload("../bottle_break_manager.gd")
const BottleScript = preload("../breakable_bottle.gd")
const LiquidScript = preload("../shaders/bottle_liquid.gd")

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
	first_scene.queue_free()
	await process_frame
	print("GS_BOTTLES: %d checks, %d failures" % [checks, failures])
	quit(1 if failures else 0)
