extends SceneTree
## Native contract tests for gs_cameras; non-headless runs also verify rendered pixels.
##   godot --headless --path godot --script res://addons/gs_cameras/tests/gs_camera_system_tests.gd

const CameraSystem = preload("res://addons/gs_cameras/gs_camera_system.gd")
const Host = preload("res://addons/gs_host/gs_host.gd")

var passed := 0
var failed := 0
var world_root: Node3D
var system: Variant
var main_camera: Camera3D
var cameras: Dictionary = {}
var screens: Dictionary = {}
var original_materials: Dictionary = {}

func _initialize() -> void:
	world_root = Node3D.new()
	root.add_child(world_root)
	main_camera = Camera3D.new()
	main_camera.name = "MainCamera"
	main_camera.current = true
	world_root.add_child(main_camera)
	system = CameraSystem.new()
	system.auto_update = false
	root.add_child(system)
	var configured: Variant = system.configure({"quality": "minimal", "max_feeds": 3, "max_screens": 3, "screen_layer": 1})
	check(configured, "camera system configures before registration")
	await process_frame
	registration_and_budgets()
	await render_cadence_and_sharing()
	await hidden_screens_and_toggles()
	await checkpoint_atomicity()
	invalid_inputs_and_cleanup()
	await host_integration()
	world_root.queue_free()
	system.queue_free()
	await process_frame
	await pixel_verification()
	print("GS_CAMERAS passed=%d failed=%d" % [passed, failed])
	quit(1 if failed else 0)

func check(condition: bool, label: String) -> void:
	if condition: passed += 1
	else:
		failed += 1
		push_error("GS_CAMERAS: " + label)

func registration_and_budgets() -> void:
	check(system.stats().quality == &"minimal", "minimal tier is active")
	check(system.add_feed(&"hall", {"camera": make_camera(&"hall"), "aspect": 1.0, "label": "Hall"}), "feed registration succeeds")
	check(system.add_feed(&"spare", {"camera": make_camera(&"spare"), "aspect": 1.0}), "second feed registration succeeds")
	check(system.add_feed(&"portrait", {"camera": make_camera(&"portrait"), "aspect": 0.25}), "portrait feed registration succeeds")
	check(system.feed_state(&"portrait").width == 32 and system.feed_state(&"portrait").height == 128,
		"portrait dimensions preserve aspect within the texture budget")
	check(not system.add_feed(&"overflow", {"camera": make_camera(&"overflow"), "aspect": 1.0}), "configured feed budget rejects overflow")
	check(system.add_screen(&"monitor_a", {"mesh": make_screen(&"monitor_a"), "feed_id": &"hall"}), "screen registration succeeds")
	check(system.add_screen(&"monitor_b", {"mesh": make_screen(&"monitor_b"), "feed_id": &"hall"}), "second screen can share a feed")
	check(system.add_screen(&"monitor_c", {"mesh": make_screen(&"monitor_c"), "feed_id": &"spare"}), "third screen selects an independent feed")
	check(system.texture(&"hall") == system.texture(&"hall") and system.texture(&"hall") != null, "feed exposes a stable texture resource")
	check(system.feed_state(&"hall").frames == 0 and system.feed_state(&"hall").width <= 128
		and system.feed_state(&"hall").height <= 128, "new target is within the minimal texture budget")
	check(system.stats().feeds == 3 and system.stats().screens == 3, "registry stats reflect registered feeds and screens")

func render_cadence_and_sharing() -> void:
	var first: Dictionary = system.step(0.5)
	check(first.ok and int(first.scheduled) == 1, "minimal tier schedules at most one selected feed per step")
	check(await await_draw_completion(), "first SubViewport request completes within bounded frame wait")
	check(system.feed_state(&"hall").frames + system.feed_state(&"spare").frames == 1,
		"capture frame count advances after frame_post_draw")
	check(world_root.get_viewport().get_camera_3d() == main_camera and main_camera.current,
		"feed capture leaves the active main viewport camera unchanged")
	var second: Dictionary = system.step(0.01)
	check(second.ok and int(second.scheduled) == 1, "round-robin services the distinct unrendered selected feed")
	check(await await_draw_completion(), "second SubViewport request completes within bounded frame wait")
	var early: Dictionary = system.step(0.01)
	check(early.ok and int(early.scheduled) == 0, "feed cadence prevents an early repeat")
	var state_a: Dictionary = system.screen_state(&"monitor_a")
	var state_b: Dictionary = system.screen_state(&"monitor_b")
	check(state_a.feed_id == &"hall" and state_b.feed_id == &"hall", "both screens retain their shared feed selection")
	check(screen_material(&"monitor_a").get("albedo_texture") == system.texture(&"hall")
		and screen_material(&"monitor_b").get("albedo_texture") == system.texture(&"hall"),
		"screens share the selected feed texture")
	var switched: Variant = system.switch_feed(&"monitor_a", &"spare")
	check(switched and system.screen_state(&"monitor_a").feed_id == &"spare"
		and system.screen_state(&"monitor_b").feed_id == &"hall", "switching one screen leaves the other unchanged")
	check(screen_material(&"monitor_a").get("albedo_texture") == system.texture(&"spare"), "switched screen displays its new feed")
	var hall_before_fair: int = int(system.feed_state(&"hall").frames)
	var spare_before_fair: int = int(system.feed_state(&"spare").frames)
	var fair: Dictionary = system.step(0.5)
	check(fair.ok and int(fair.scheduled) == 1, "round-robin schedules another eligible selected feed")
	check(await await_draw_completion(), "visible peer capture completes within bounded frame wait")
	var hall_delta: int = int(system.feed_state(&"hall").frames) - hall_before_fair
	var spare_delta: int = int(system.feed_state(&"spare").frames) - spare_before_fair
	check(hall_delta + spare_delta == 1 and maxi(hall_delta, spare_delta) == 1,
		"one scheduled feed produces one capture while round-robin services selected feeds")
	var raised: Variant = system.set_quality("high")
	check(raised and system.feed_state(&"hall").frames == 0 and system.feed_state(&"spare").frames == 0
		and system.feed_state(&"hall").width <= 1024 and system.feed_state(&"hall").height <= 1024,
		"quality change resets captured frames and resizes within the high-tier budget")
	check(system.feed_state(&"portrait").width == 256 and system.feed_state(&"portrait").height == 1024,
		"quality resize retains portrait aspect within high-tier dimensions")

func hidden_screens_and_toggles() -> void:
	var hidden_parent := Node3D.new()
	hidden_parent.name = "HiddenParent"
	world_root.add_child(hidden_parent)
	var child_screen: MeshInstance3D = screens[&"monitor_b"]
	var old_parent: Node = child_screen.get_parent()
	old_parent.remove_child(child_screen)
	hidden_parent.add_child(child_screen)
	hidden_parent.visible = false
	var hidden: Dictionary = system.step(1.0)
	check(hidden.ok and int(hidden.scheduled) == 1, "a visible selected screen still schedules when a different screen is hidden")
	check(await await_draw_completion(), "re-enabled capture completes within bounded frame wait")
	var after_visible_peer: int = int(system.stats().frames)
	system.set_screen_enabled(&"monitor_a", false)
	system.set_feed_enabled(&"hall", false)
	system.set_feed_enabled(&"spare", false)
	var disabled: Dictionary = system.step(1.0)
	check(disabled.ok and int(disabled.scheduled) == 0, "disabled feed and screens do not schedule captures")
	check(screen_material(&"monitor_a").get("albedo_texture") == null
		and screen_material(&"monitor_b").get("albedo_texture") == null, "disabled feed shows blank on every bound screen")
	system.set_feed_enabled(&"hall", true)
	system.set_feed_enabled(&"spare", true)
	system.set_screen_enabled(&"monitor_a", true)
	var parent_hidden: Dictionary = system.step(1.0)
	check(parent_hidden.ok and int(parent_hidden.scheduled) == 1
		and system.stats().frames >= after_visible_peer,
		"hidden parent suppresses its child while the other active selection remains serviceable")
	check(await await_draw_completion(), "parent hidden-state capture completes within bounded frame wait")
	hidden_parent.visible = true
	hidden_parent.remove_child(child_screen)
	old_parent.add_child(child_screen)
	hidden_parent.queue_free()
	var selected_visible: Dictionary = system.step(1.0)
	check(selected_visible.ok and int(selected_visible.scheduled) <= 2, "restored screen visibility remains within high-tier per-step budget")

func checkpoint_atomicity() -> void:
	var saved: Dictionary = system.checkpoint()
	check(system.switch_feed(&"monitor_a", null), "screen can be detached before checkpoint restore")
	check(system.set_screen_enabled(&"monitor_b", false), "screen can be disabled before checkpoint restore")
	var prepared: Dictionary = system.prepare_restore(saved)
	check(prepared.ok and prepared.commit is Callable, "checkpoint validates and returns a deferred commit")
	if prepared.ok and prepared.commit is Callable:
		(prepared.commit as Callable).call()
		await process_frame
	check(system.checkpoint() == saved, "committed checkpoint restores feed selection and enabled state")
	var before_bad: Dictionary = system.checkpoint()
	var bad_schema: Dictionary = saved.duplicate(true)
	bad_schema.schema = "wrong.schema"
	reject_checkpoint(bad_schema, before_bad, "wrong checkpoint schema is rejected atomically")
	var bad_topology: Dictionary = saved.duplicate(true)
	bad_topology.feeds.pop_back()
	reject_checkpoint(bad_topology, before_bad, "checkpoint topology mismatch is rejected atomically")
	var duplicate: Dictionary = saved.duplicate(true)
	duplicate.screens[1] = duplicate.screens[0].duplicate(true)
	reject_checkpoint(duplicate, before_bad, "duplicate screen entry is rejected atomically")
	var bad_flag: Dictionary = saved.duplicate(true)
	bad_flag.feeds[0].enabled = "yes"
	reject_checkpoint(bad_flag, before_bad, "invalid checkpoint boolean is rejected atomically")
	var missing_feed: Dictionary = saved.duplicate(true)
	missing_feed.screens[0].feed_id = &"missing"
	reject_checkpoint(missing_feed, before_bad, "unknown checkpoint feed reference is rejected atomically")

func reject_checkpoint(payload: Dictionary, before: Dictionary, label: String) -> void:
	var rejected: Dictionary = system.prepare_restore(payload)
	check(not rejected.ok and system.checkpoint() == before, label)

func await_draw_completion() -> bool:
	for _frame in 3:
		RenderingServer.force_draw()
		await process_frame
		if int(system.stats().pending) == 0: return true
	return false

func invalid_inputs_and_cleanup() -> void:
	var mesh_a: MeshInstance3D = screens[&"monitor_a"]
	var mesh_b: MeshInstance3D = screens[&"monitor_b"]
	var mesh_c: MeshInstance3D = screens[&"monitor_c"]
	check(not system.add_feed(&"hall", {"camera": make_camera(&"duplicate"), "aspect": 1.0}), "duplicate feed id is rejected")
	check(not system.add_feed(&"bad_aspect", {"camera": make_camera(&"bad_aspect"), "aspect": 0.1}), "out-of-range aspect is rejected")
	check(not system.add_screen(&"duplicate_mesh", {"mesh": screens[&"monitor_a"], "feed_id": &"hall"}), "one mesh cannot be bound twice")
	check(not system.switch_feed(&"monitor_a", &"missing") and system.screen_state(&"monitor_a").feed_id == &"spare",
		"invalid switch preserves current selection")
	var bad_step: Dictionary = system.step(NAN)
	check(not bad_step.ok, "non-finite delta is rejected")
	var replacement := StandardMaterial3D.new()
	(screens[&"monitor_a"] as MeshInstance3D).material_override = replacement
	var peer_step: Dictionary = system.step(0.5)
	check(peer_step.ok and system.feed_state(&"spare").pending,
		"a bound peer continues requesting a shared feed after another screen material is replaced")
	check(await await_draw_completion(), "peer feed capture completes within bounded frame wait")
	check(system.switch_feed(&"monitor_b", null) and system.switch_feed(&"monitor_c", null),
		"remaining bound screens can be detached for ownership checks")
	var material_detached: Dictionary = system.step(0.5)
	check(material_detached.ok and int(material_detached.scheduled) == 0
		and not system.feed_state(&"spare").pending and not system.feed_state(&"hall").pending,
		"replaced material stops that screen from requesting its feed")
	check(system.switch_feed(&"monitor_c", &"spare"), "screen can be rebound before layer ownership check")
	mesh_c.layers = 2
	var layer_detached: Dictionary = system.step(0.5)
	check(layer_detached.ok and int(layer_detached.scheduled) == 0 and not system.feed_state(&"spare").pending,
		"replaced screen layer stops that screen from requesting its feed")
	check(system.remove_screen(&"monitor_a"), "replaced screen can be removed")
	check(mesh_a.material_override == replacement, "screen removal preserves a host replacement material")
	check(system.switch_feed(&"monitor_b", &"hall"), "screen can reselect feed before feed-removal check")
	var original_b: Material = original_materials[&"monitor_b"]
	var original_c: Material = original_materials[&"monitor_c"]
	check(system.remove_feed(&"hall"), "feed removal succeeds")
	check(system.screen_state(&"monitor_b").feed_id == null and screen_material(&"monitor_b").get("albedo_texture") == null,
		"removing a feed detaches its screens and clears their display")
	system.dispose()
	system.dispose()
	check(mesh_b.material_override == original_b, "idempotent disposal restores remaining original material")
	check(mesh_c.material_override == original_c, "disposal restores every remaining screen material")
	check(mesh_c.layers == 2, "disposal preserves a host replacement screen layer")
	check(is_instance_valid(mesh_a) and is_instance_valid(mesh_b) and is_instance_valid(mesh_c), "cleanup leaves application-owned screen nodes alive")

func host_integration() -> void:
	var host := Host.new()
	host.auto_update = false
	host.scene_root = world_root
	root.add_child(host)
	var api: Variant = host.load_extension(CameraSystem, {"screen_layer": 2})
	check(api == host.get_ext(&"gs_cameras") and host.ids() == [&"gs_cameras"],
		"GSHost loads the camera extension under its stable ID and exposes itself as the API")
	if api != null:
		check(api.stats().screen_layer == 2 and api.add_feed(&"host_feed", {"camera": make_camera(&"host_feed"), "aspect": 1.0}),
			"host-provided screen layer option is applied and API accepts a feed")
		check(host.set_tier(&"gs_cameras", &"low") == &"low" and host.tier(&"gs_cameras") == &"low"
			and api.quality == &"low" and api.feed_state(&"host_feed").width == 256,
			"pinned host tier reaches the extension and resizes its feed target")
	host.dispose(&"gs_cameras")
	check(host.ids().is_empty(), "host disposal tears down the camera extension cleanly")
	host.queue_free()
	await process_frame

## A graphics-enabled run also checks real SubViewport output. The dummy renderer has no pixel data.
func pixel_verification() -> void:
	if DisplayServer.get_name() == "headless":
		print("GS_CAMERAS_PIXEL skipped: headless display server")
		return
	var pixel_world := Node3D.new()
	root.add_child(pixel_world)
	var camera := Camera3D.new()
	camera.name = "PixelFeedCamera"
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color(0.04, 0.82, 0.06)
	camera.environment = environment
	pixel_world.add_child(camera)
	var pixel_system = CameraSystem.new()
	pixel_system.auto_update = false
	root.add_child(pixel_system)
	check(pixel_system.configure({"quality": "minimal", "screen_layer": 1}), "pixel fixture configures a minimal render target")
	check(pixel_system.add_feed(&"pixel", {"camera": camera, "aspect": 1.0}), "pixel fixture registers its feed")
	var screen := MeshInstance3D.new()
	screen.mesh = PlaneMesh.new()
	pixel_world.add_child(screen)
	check(pixel_system.add_screen(&"pixel_screen", {"mesh": screen, "feed_id": &"pixel"}), "pixel fixture selects its feed through a screen")
	var scheduled: Dictionary = pixel_system.step(0.5)
	check(scheduled.ok and int(scheduled.scheduled) == 1, "pixel fixture schedules a feed render")
	for _frame in 8:
		RenderingServer.force_draw()
		await process_frame
		if int(pixel_system.feed_state(&"pixel").frames) > 0: break
	var image: Image = pixel_system.texture(&"pixel").get_image()
	if image != null and not image.is_empty():
		var pixel: Color = image.get_pixel(image.get_width() / 2, image.get_height() / 2)
		var expected := Color(0.04, 0.82, 0.06)
		var matches: bool = pixel_system.feed_state(&"pixel").frames == 1 \
			and absf(pixel.r - expected.r) < 0.12 \
			and absf(pixel.g - expected.g) < 0.12 \
			and absf(pixel.b - expected.b) < 0.12
		check(matches,
			"actual SubViewport center pixel matches the camera environment color (%.3f, %.3f, %.3f)" % [pixel.r, pixel.g, pixel.b])
		if matches:
			print("GS_CAMERAS_PIXEL size=%s frames=%d center=(%.3f, %.3f, %.3f, %.3f)" % [image.get_size(), pixel_system.feed_state(&"pixel").frames, pixel.r, pixel.g, pixel.b, pixel.a])
	else:
		check(false, "SubViewport returned nonempty image data in graphics mode")
	pixel_system.dispose()
	pixel_system.queue_free()
	pixel_world.queue_free()
	await process_frame

func make_camera(id: StringName) -> Camera3D:
	var camera := Camera3D.new()
	camera.name = String(id)
	camera.position = Vector3(0, 0, 3)
	camera.current = false
	world_root.add_child(camera)
	cameras[id] = camera
	return camera

func make_screen(id: StringName) -> MeshInstance3D:
	var mesh := MeshInstance3D.new()
	mesh.name = String(id)
	mesh.mesh = PlaneMesh.new()
	var material := StandardMaterial3D.new()
	mesh.material_override = material
	world_root.add_child(mesh)
	screens[id] = mesh
	original_materials[id] = material
	return mesh

func screen_material(id: StringName) -> Material:
	return (screens[id] as MeshInstance3D).material_override
