extends Node3D
## Bottle library demo. WASD + mouse look; LMB shoot, RMB / E throw (held object or a brick), G grab / release (wheel or Z/X tilts),
## 1-4 quality tier HIGH..MINIMAL, R reset, F overlay, P pause, Esc quit.   godot --path demo [-- --shots <dir>]

const SHELF_W := 3.3
var cam: Camera3D
var yaw := 0.0
var pitch := 0.0
var held: Node3D = null
var held_tilt := 0.0
var _held_prev := Vector3.ZERO
var _held_vel := Vector3.ZERO
var _held_h := 0.25
var bricks: Array[RigidBody3D] = []
var overlay: Label
var _fps_timer: Timer
var _last_lod_pos := Vector3(1e9, 0, 0)
var shots_dir := ""
var scene_root: Node3D

const SHELVES := [
	{"y": 0.55, "items": [["bottle_wine", ""], ["bottle_beer", ""], ["bottle_whiskey", ""], ["bottle_jar", ""], ["bottle_flask", ""], ["bottle_soda", ""]]},
	{"y": 1.05, "items": [["bottle_v2_bordeaux", ""], ["bottle_v2_longneck", ""], ["bottle_v2_whisky", ""], ["bottle_v2_pet500", ""], ["bottle_v2_mason", ""], ["bottle_v2_spirit", ""]]},
	{"y": 1.55, "items": [["container_tumbler", ""], ["container_hipflask", ""], ["container_mug", ""], ["bottle_wine", "wine_classic"], ["bottle_beer", "beer_pale"], ["bottle_soda", "soda_cherry"], ["bottle_v2_bordeaux", "v2_bordeaux_classic"], ["bottle_v2_longneck", "v2_longneck_lager"]]},
]


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	var args := OS.get_cmdline_user_args()
	var si := args.find("--shots")
	if si >= 0:
		shots_dir = args[si + 1]
	_build_env()
	_build_ui()
	cam = Camera3D.new()
	cam.current = true
	cam.fov = 60
	add_child(cam)
	cam.position = Vector3(0, 1.25, 2.6)
	scene_root = Node3D.new()
	scene_root.name = "Stuff"
	scene_root.process_mode = Node.PROCESS_MODE_PAUSABLE
	add_child(scene_root)
	_build_room()
	_populate()
	if args.has("--rest"):
		_run_rest()
	elif shots_dir != "":
		_run_shots()
	else:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _build_env() -> void:
	var env := Environment.new()
	var sky := Sky.new()
	var pm := ProceduralSkyMaterial.new()
	pm.sky_top_color = Color(0.45, 0.6, 0.8)
	pm.sky_horizon_color = Color(0.75, 0.8, 0.85)
	pm.ground_horizon_color = Color(0.55, 0.52, 0.5)
	sky.sky_material = pm
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.8
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-45, 25, 0)
	sun.light_energy = 1.3
	sun.shadow_enabled = true
	add_child(sun)
	var lamp := OmniLight3D.new()
	lamp.position = Vector3(0.0, 2.0, 1.2)
	lamp.omni_range = 6.0
	lamp.light_energy = 1.2
	add_child(lamp)


func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	overlay = Label.new()
	overlay.position = Vector2(10, 8)
	overlay.add_theme_color_override("font_color", Color.WHITE)
	overlay.add_theme_color_override("font_outline_color", Color.BLACK)
	overlay.add_theme_constant_override("outline_size", 4)
	overlay.visible = false
	layer.add_child(overlay)
	var help := Label.new()
	help.text = "LMB shoot  RMB/E throw  G grab (wheel/Z/X tilt)  1-4 tier  R reset  F stats  P pause"
	help.position = Vector2(10, 690)
	help.add_theme_color_override("font_outline_color", Color.BLACK)
	help.add_theme_constant_override("outline_size", 4)
	layer.add_child(help)
	_fps_timer = Timer.new()
	_fps_timer.wait_time = 0.25
	_fps_timer.timeout.connect(_update_overlay)
	add_child(_fps_timer)


func _static_box(size: Vector3, pos: Vector3, col: Color, surface: String) -> void:
	var sb := StaticBody3D.new()
	sb.collision_layer = 1
	sb.set_meta("break_surface", surface)
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.roughness = 0.8
	mi.material_override = m
	sb.add_child(mi)
	var cs := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = size
	cs.shape = sh
	sb.add_child(cs)
	sb.position = pos
	add_child(sb)


func _build_room() -> void:
	_static_box(Vector3(10, 0.2, 10), Vector3(0, -0.1, 0), Color(0.45, 0.42, 0.4), "concrete")
	_static_box(Vector3(4.2, 2.6, 0.1), Vector3(0, 1.3, -0.5), Color(0.8, 0.77, 0.7), "concrete")
	for s in SHELVES:
		_static_box(Vector3(SHELF_W + 0.2, 0.05, 0.4), Vector3(0, s["y"] - 0.025, -0.25), Color(0.5, 0.33, 0.2), "wood")


func _populate() -> void:
	for s in SHELVES:
		var items: Array = s["items"]
		var n := items.size()
		for i in n:
			var x := (i - (n - 1) * 0.5) * 0.36
			var it: Array = items[i]
			var fill := 0.35 + 0.1 * float((i * 7 + int(s["y"] * 10)) % 6)
			var b := BottleFactory.spawn(it[0], {"fill": fill, "design": it[1], "position": Vector3(x, float(s["y"]) + 0.003, -0.2), "seed": 100 + i})
			if b:
				scene_root.add_child(b)


func _clear() -> void:
	held = null
	for b in get_tree().get_nodes_in_group("bottles"):
		b.queue_free()
	for br in bricks:
		if is_instance_valid(br):
			br.queue_free()
	bricks.clear()
	if BottleBreakManager.current and is_instance_valid(BottleBreakManager.current):
		BottleBreakManager.current.clear_debris()


func reset_scene() -> void:
	_clear()
	await get_tree().process_frame
	_populate()


# ---------------------------------------------------------------- input / update

func _unhandled_input(e: InputEvent) -> void:
	if shots_dir != "":
		return
	if e is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		yaw -= e.relative.x * 0.0022
		pitch = clampf(pitch - e.relative.y * 0.0022, -1.5, 1.5)
	elif e is InputEventMouseButton and e.pressed:
		if e.button_index == MOUSE_BUTTON_LEFT:
			if Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
				Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
			else:
				shoot()
		elif e.button_index == MOUSE_BUTTON_RIGHT:
			throw()
		elif e.button_index == MOUSE_BUTTON_WHEEL_UP:
			held_tilt += 0.1
		elif e.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			held_tilt -= 0.1
	elif e is InputEventKey and e.pressed and not e.echo:
		match e.keycode:
			KEY_1: QualityTier.set_tier(0)
			KEY_2: QualityTier.set_tier(1)
			KEY_3: QualityTier.set_tier(2)
			KEY_4: QualityTier.set_tier(3)
			KEY_R: reset_scene()
			KEY_F: toggle_overlay()
			KEY_P: get_tree().paused = not get_tree().paused
			KEY_E: throw()
			KEY_G: grab_toggle()
			KEY_ESCAPE:
				if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
					Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
				else:
					get_tree().quit()


func _process(dt: float) -> void:
	if shots_dir == "":
		var v := Vector3.ZERO
		var b := cam.global_transform.basis
		if Input.is_physical_key_pressed(KEY_W): v -= Vector3(b.z.x, 0, b.z.z).normalized()
		if Input.is_physical_key_pressed(KEY_S): v += Vector3(b.z.x, 0, b.z.z).normalized()
		if Input.is_physical_key_pressed(KEY_A): v -= b.x
		if Input.is_physical_key_pressed(KEY_D): v += b.x
		if Input.is_physical_key_pressed(KEY_SPACE): v += Vector3.UP
		if Input.is_physical_key_pressed(KEY_C): v -= Vector3.UP
		if Input.is_physical_key_pressed(KEY_Z): held_tilt += dt * 1.5
		if Input.is_physical_key_pressed(KEY_X): held_tilt -= dt * 1.5
		var spd := 4.0 if Input.is_physical_key_pressed(KEY_SHIFT) else 1.8
		cam.position += v * spd * dt
	cam.rotation = Vector3(pitch, yaw, 0)
	if cam.position.distance_squared_to(_last_lod_pos) > 1.0:   # camera moved ~1 m: re-evaluate mesh LODs
		_last_lod_pos = cam.position
		BottleFactory.refresh_all(get_tree())


func _physics_process(dt: float) -> void:
	if held and is_instance_valid(held):
		var fwd := -cam.global_transform.basis.z
		var basis := Basis(fwd, held_tilt) * Basis(Vector3.UP, yaw)
		var centre := cam.global_position + fwd * 0.6 + Vector3(0, -0.1, 0)
		var origin := centre - basis * Vector3(0, _held_h * 0.5, 0)
		_held_vel = (origin - _held_prev) / maxf(dt, 1e-4)
		_held_prev = origin
		held.global_transform = Transform3D(basis, origin)
	for br in bricks:
		if is_instance_valid(br):
			FastImpact.step_thrown(br, dt, BottleFactory.MASK_BOTTLE)


func ray_pick(mask: int) -> Dictionary:
	var from := cam.global_position
	var q := PhysicsRayQueryParameters3D.create(from, from - cam.global_transform.basis.z * 6.0, mask)
	return get_world_3d().direct_space_state.intersect_ray(q)


func grab_toggle() -> void:
	if held:
		release(Vector3.ZERO)
		return
	var h := ray_pick(2 | 8)
	if h.is_empty():
		return
	var n := h["collider"] as Node3D
	if n and n.is_in_group("bottles"):
		grab(n)


func grab(n: Node3D) -> void:
	held = n
	held_tilt = 0.0
	_held_h = float(n.get_meta("bottle_info")["height_m"])
	_held_prev = n.global_position
	var rb := n as RigidBody3D
	rb.freeze_mode = RigidBody3D.FREEZE_MODE_KINEMATIC
	rb.freeze = true
	if n.has_method("set_held"):
		n.set_held(true)


func release(vel: Vector3) -> void:
	var rb := held as RigidBody3D
	held = null
	if rb == null or not is_instance_valid(rb):
		return
	rb.freeze = false
	rb.sleeping = false
	rb.linear_velocity = vel if vel != Vector3.ZERO else _held_vel
	if rb.has_method("set_held"):
		rb.set_held(false)


func throw() -> void:
	var fwd := -cam.global_transform.basis.z
	if held:
		release(fwd * 11.0 + Vector3.UP * 1.0)
		return
	spawn_brick(cam.global_position + fwd * 0.5, fwd * 14.0)


func spawn_brick(pos: Vector3, vel: Vector3) -> RigidBody3D:
	var br := RigidBody3D.new()
	br.mass = 2.3
	br.collision_layer = 2
	br.collision_mask = BottleFactory.MASK_BOTTLE
	br.continuous_cd = true
	br.set_meta("break_surface", "stone")
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.215, 0.065, 0.1025)
	mi.mesh = bm
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.6, 0.25, 0.18)
	m.roughness = 0.95
	mi.material_override = m
	br.add_child(mi)
	var cs := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = bm.size
	cs.shape = sh
	br.add_child(cs)
	scene_root.add_child(br)
	br.global_position = pos
	br.linear_velocity = vel
	br.angular_velocity = Vector3(2, 3, 1)
	bricks.append(br)
	while bricks.size() > 6:
		var o: RigidBody3D = bricks.pop_front()
		if is_instance_valid(o):
			o.queue_free()
	return br


func shoot() -> Array:
	var from := cam.global_position
	var dir := -cam.global_transform.basis.z
	var space := get_world_3d().direct_space_state
	var res := FastImpact.fire(space, from, dir, 500.0, 0.009, BottleFactory.MASK_BOTTLE, 60.0)
	return res


func toggle_overlay() -> void:
	overlay.visible = not overlay.visible
	if overlay.visible:
		_fps_timer.start()
		_update_overlay()
	else:
		_fps_timer.stop()


func _update_overlay() -> void:
	var m := BottleBreakManager.current
	var shards := m.live_shards if m and is_instance_valid(m) else 0
	var drops := m.live_droplets if m and is_instance_valid(m) else 0
	var awake := 0
	var liquids_on := 0
	var all := get_tree().get_nodes_in_group("bottles")
	for b in all:
		if b is RigidBody3D and not (b as RigidBody3D).sleeping:
			awake += 1
		if "ctl" in b and b.ctl and b.ctl.is_processing():
			liquids_on += 1
	overlay.text = "FPS %d   tier %s\nbottles %d (awake %d, liquid updating %d)\nshards %d  droplets %d" % [
		Engine.get_frames_per_second(), QualityTier.tier_name(), all.size(), awake, liquids_on, shards, drops]


# ---------------------------------------------------------------- scripted screenshots

func _frames(n: int) -> void:
	for i in n:
		await get_tree().physics_frame
	await get_tree().process_frame


func _aim(from: Vector3, target: Vector3) -> void:
	cam.position = from
	var d := (target - from).normalized()
	yaw = atan2(-d.x, -d.z)
	pitch = asin(d.y)
	cam.rotation = Vector3(pitch, yaw, 0)


func _snap(shot_name: String) -> void:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	img.save_png("%s/%s.png" % [shots_dir, shot_name])
	print("shot ", shot_name)


func _find(id: String, design := "") -> Node3D:
	for b in get_tree().get_nodes_in_group("bottles"):
		var inf: Dictionary = b.get_meta("bottle_info")
		if design != "":
			if inf["id"] == "design_" + design:
				return b
		elif inf["id"] == id:
			return b
	return null


func _run_shots() -> void:
	DirAccess.make_dir_recursive_absolute(shots_dir)
	await _frames(90)
	_aim(Vector3(0, 1.2, 3.0), Vector3(0, 1.05, -0.2))
	await _frames(20)
	await _snap("01_still_life")
	_aim(Vector3(-0.6, 0.9, 1.3), Vector3(-0.7, 0.7, -0.2))
	await _frames(10)
	await _snap("01b_shelf_v1_v2")
	_aim(Vector3(0.2, 1.45, 1.4), Vector3(0.4, 1.65, -0.2))
	await _frames(10)
	await _snap("01c_shelf_designs")
	# tilted held bottle
	_aim(Vector3(0, 1.4, 1.0), Vector3(0, 1.2, 0.2))
	var wb := _find("bottle_v2_bordeaux")
	if wb:
		grab(wb)
		held_tilt = 1.2
		await _frames(100)
		await _snap("02_tilted_held")
		held_tilt = 2.2
		await _frames(100)
		await _snap("02b_tilted_far")
		release(Vector3.ZERO)
	await reset_scene()
	await _frames(60)
	# shoot a bottle (v1 wine on the lowest shelf)
	var wine := _find("bottle_wine")
	if wine:
		_aim(Vector3(wine.global_position.x, 0.8, 2.0), wine.global_position + Vector3(0, 0.12, 0))
		await _frames(5)
		var r := shoot()
		print("shot result ", r.size())
		await _frames(12)
		await _snap("03_shot_a")
		await _frames(40)
		await _snap("03_shot_b")
	# brick at a v2 bottle
	await reset_scene()
	await _frames(60)
	var bt := _find("bottle_v2_whisky")
	if bt:
		var tp := bt.global_position + Vector3(0, 0.12, 0)
		_aim(Vector3(tp.x, tp.y, 2.4), tp)
		spawn_brick(cam.global_position + Vector3(0, -0.1, -0.5), (tp - cam.global_position).normalized() * 13.0)
		await _frames(25)
		await _snap("04_brick_a")
		await _frames(50)
		await _snap("04_brick_b")
	# tier comparison
	await reset_scene()
	await _frames(60)
	for t in 4:
		QualityTier.set_tier(t)
		_aim(Vector3(0.5, 1.45, 1.1), Vector3(0.45, 1.6, -0.2))
		await _frames(30)
		await _snap("05_tier_%d" % t)
	var m := BottleBreakManager.current
	print("manager quality ", m.quality if m else -1, " live shards ", m.live_shards if m else -1)
	get_tree().quit()


## Resting check: every bottle should sleep on its shelf. Prints max velocities between 2 s and 3.5 s.
func _run_rest() -> void:
	var ad := 0.0
	var ld := 0.0
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--ad="): ad = float(a.substr(5))
		if a.begins_with("--ld="): ld = float(a.substr(5))
	if ad > 0.0:
		for b in get_tree().get_nodes_in_group("bottles"):
			(b as RigidBody3D).angular_damp = ad
			(b as RigidBody3D).linear_damp = ld
	var w := get_tree().get_nodes_in_group("bottles")[0] as RigidBody3D
	for i in 6:
		await _frames(20)
		print("T ", i, " pos ", w.global_position, " rot ", w.rotation_degrees, " w ", w.angular_velocity, " sleep ", w.sleeping, " mass ", w.mass, " com ", w.center_of_mass)
	var mx := {}
	for i in 90:
		await get_tree().physics_frame
		for b in get_tree().get_nodes_in_group("bottles"):
			var rb := b as RigidBody3D
			var k: String = b.get_meta("bottle_info")["id"]
			var d: Array = mx.get(k, [0.0, 0.0, true])
			d[0] = maxf(d[0], rb.linear_velocity.length())
			d[1] = maxf(d[1], rb.angular_velocity.length())
			d[2] = d[2] and rb.sleeping
			mx[k] = d
	for k in mx:
		print("REST %s maxv %.4f maxw %.4f sleeping %s" % [k, mx[k][0], mx[k][1], mx[k][2]])
	get_tree().quit()
