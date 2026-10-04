extends Node3D
## Bottle library demo. WASD + mouse look; LMB shoot, RMB / E throw (held object or a brick), G grab / release (wheel or Z/X tilts), U uncap (pour bar at the right: tilt an open bottle / cup over a glass),
## 1-4 quality tier HIGH..MINIMAL, R reset, F overlay, P pause, Esc quit.   godot --path demo [-- --shots <dir>]

const SHELF_W := 3.3
var cam: Camera3D
var yaw := 0.0
var pitch := 0.0
const HOLD_MAX_SPEED := 2.5   ## m/s a held bottle can move toward the hand (glass breaks at ~4 m/s, ignored below 0.4)
const HOLD_MAX_SPIN := 6.0    ## rad/s
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
var glass: GlassSystem
var glass_panes: Array[GlassPane] = []
var window_pane: GlassPane
var shop_pane: GlassPane
var temper_pane: GlassPane
var _glass_audio: GlassAudioAdapter
const WIN_X := -2.9          ## house window in the back wall, left of the shelves (shelves span x -1.75..1.75)
const WIN_Y := 1.45
const WIN_SIZE := Vector2(1.2, 1.3)
const SHOP_POS := Vector3(4.4, 1.16, 0.6)     ## free-standing shop-front pane beside the bar (annealed 6 mm), yawed toward the room
const TEMPER_POS := Vector3(-4.0, 0.66, 1.0)  ## small tempered pane (dice shatter) on a frame, front left

const SHELVES := [
	{"y": 0.55, "items": [["bottle_wine", ""], ["bottle_beer", ""], ["bottle_whiskey", ""], ["bottle_jar", ""], ["bottle_flask", ""], ["bottle_soda", ""]]},
	{"y": 1.05, "items": [["bottle_v2_bordeaux", ""], ["bottle_v2_longneck", ""], ["bottle_v2_whisky", ""], ["bottle_v2_pet500", ""], ["bottle_v2_mason", ""], ["bottle_v2_spirit", ""]]},
	{"y": 1.55, "items": [["container_tumbler", ""], ["container_hipflask", ""], ["container_mug", ""], ["bottle_wine", "wine_classic"], ["bottle_beer", "beer_pale"], ["bottle_soda", "soda_cherry"], ["bottle_v2_bordeaux", "v2_bordeaux_classic"], ["bottle_v2_longneck", "v2_longneck_lager"]]},
]


## Pour bar (right of the shelves): grab (G) a tumbler / mug / bottle, U uncaps the aimed or held bottle, tilt with wheel or Z/X over a glass.
const BAR_X := 2.7
const BAR_TOP := 0.72
const BAR_ITEMS := [   # [asset id, design, fill, x offset, open]
	["container_tumbler", "", 0.0, -0.45, false], ["container_tumbler", "", 0.9, -0.28, false], ["container_mug", "", 0.8, -0.1, false],
	["bottle_wine", "", 0.8, 0.08, true], ["bottle_v2_bordeaux", "", 0.7, 0.26, true], ["container_square", "", 0.7, 0.44, false],
	["container_hipflask", "container_hipflask_engraved", 0.6, -0.45, false], ["container_jerrycan", "container_jerrycan_fuel", 0.7, 0.1, false],
	["container_mug", "container_mug_diner", 0.0, 0.3, false],
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
	_build_glass()
	_populate()
	if args.has("--rest"):
		_run_rest()
	elif args.has("--glass"):
		_run_glass()
	elif args.has("--labels") and shots_dir != "":
		_run_label_shots()
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
	env.ambient_light_energy = 0.4
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-45, 25, 0)
	sun.light_energy = 0.6
	sun.shadow_enabled = true
	add_child(sun)
	var lamp := OmniLight3D.new()
	lamp.position = Vector3(0.0, 2.0, 1.2)
	lamp.omni_range = 6.0
	lamp.light_energy = 0.7
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
	help.text = "LMB shoot (shoot/throw at the glass panes too)  RMB/E throw  G grab (wheel/Z/X tilt)  U cap on/off  1-4 tier  R reset  F stats  P pause"
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
	_static_box(Vector3(1.6, BAR_TOP, 0.9), Vector3(BAR_X, BAR_TOP * 0.5 - 0.0, -0.05), Color(0.42, 0.28, 0.17), "wood")
	_static_box(Vector3(10, 0.2, 10), Vector3(0, -0.1, 0), Color(0.45, 0.42, 0.4), "concrete")
	_build_back_wall()
	for s in SHELVES:
		_static_box(Vector3(SHELF_W + 0.2, 0.05, 0.4), Vector3(0, s["y"] - 0.025, -0.25), Color(0.5, 0.33, 0.2), "wood")
		_spot(Vector3(0, s["y"] + 0.55, 0.45), Vector3(0, s["y"] + 0.1, -0.25), SHELF_W * 1.5)
	_spot(Vector3(BAR_X, BAR_TOP + 0.9, 0.9), Vector3(BAR_X, BAR_TOP + 0.1, -0.05), 1.2)


## Back wall (z=-0.5, 0.1 thick, y 0..2.6) from x=-4.5 to 2.1 with an opening for the house window (frame width 0.07).
func _build_back_wall() -> void:
	var col := Color(0.2, 0.19, 0.19)
	var x0 := -4.5
	var x1 := 2.1
	var ox0 := WIN_X - WIN_SIZE.x * 0.5 - 0.07
	var ox1 := WIN_X + WIN_SIZE.x * 0.5 + 0.07
	var oy0 := WIN_Y - WIN_SIZE.y * 0.5 - 0.07
	var oy1 := WIN_Y + WIN_SIZE.y * 0.5 + 0.07
	_static_box(Vector3(ox0 - x0, 2.6, 0.1), Vector3((x0 + ox0) * 0.5, 1.3, -0.5), col, "concrete")
	_static_box(Vector3(x1 - ox1, 2.6, 0.1), Vector3((ox1 + x1) * 0.5, 1.3, -0.5), col, "concrete")
	_static_box(Vector3(ox1 - ox0, oy0, 0.1), Vector3((ox0 + ox1) * 0.5, oy0 * 0.5, -0.5), col, "concrete")
	_static_box(Vector3(ox1 - ox0, 2.6 - oy1, 0.1), Vector3((ox0 + ox1) * 0.5, (oy1 + 2.6) * 0.5, -0.5), col, "concrete")


## Glass: GlassSystem (child of this scene, so no autoload / root-busy issue), audio adapter, window, shop front, tempered pane.
func _build_glass() -> void:
	glass = GlassSystem.new()
	glass.name = "GlassSystem"
	add_child(glass)
	glass.tier = QualityTier.tier as GlassSystem.Tier
	QualityTier.tier_changed.connect(func(t: int): glass.tier = t as GlassSystem.Tier)
	_glass_audio = GlassAudioAdapter.new()   # finds AudioHub's BottleAudio by class name
	add_child(_glass_audio)
	var win := GlassPrefabs.house_window("single", WIN_SIZE, "annealed", 4.0)
	win.position = Vector3(WIN_X, WIN_Y, -0.5)
	win.rotation.y = PI   # +Z (outside) faces -z, away from the room
	add_child(win)
	window_pane = GlassPrefabs.panes_of(win)[0]
	var shop := GlassPrefabs.shop_front(Vector2(1.6, 2.2), "annealed", 6.0)
	shop.position = SHOP_POS
	shop.rotation.y = deg_to_rad(-49.0)
	add_child(shop)
	shop_pane = GlassPrefabs.panes_of(shop)[0]
	var tp := GlassPrefabs.shop_front(Vector2(1.0, 1.2), "tempered", 4.0)
	tp.position = TEMPER_POS
	tp.rotation.y = deg_to_rad(35.0)
	add_child(tp)
	temper_pane = GlassPrefabs.panes_of(tp)[0]
	for p in [window_pane, shop_pane, temper_pane]:
		p.set_meta("break_surface", "glass")   # bottles hitting a pane use the glass surface
		glass_panes.append(p)


func _repair_glass() -> void:
	glass.clear_all()
	for p in glass_panes:
		p.repair()
	glass.invalidate_all()


## Warm display spotlight pooling light on a shelf or the bar (the walls are dark so glass and liquid read).
func _spot(from: Vector3, at: Vector3, width: float) -> void:
	var l := SpotLight3D.new()
	l.position = from
	l.light_color = Color(1.0, 0.92, 0.8)
	l.light_energy = 6.0
	l.spot_range = 3.0
	l.spot_angle = clampf(rad_to_deg(atan(width * 0.5 / from.distance_to(at))), 20.0, 70.0)
	l.spot_attenuation = 0.6
	l.shadow_enabled = true
	add_child(l)
	l.look_at_from_position(from, at, Vector3.UP)


func _populate_bar() -> void:
	for i in BAR_ITEMS.size():
		var it: Array = BAR_ITEMS[i]
		var back := i >= 6   # second row stands further back
		var pos := Vector3(BAR_X + float(it[3]), BAR_TOP + 0.003, 0.05 if not back else -0.2)
		var b := BottleFactory.spawn(it[0], {"fill": it[2], "design": it[1], "position": pos, "seed": 300 + i})
		if b:
			scene_root.add_child(b)
			if it[4]:
				uncap(b)


## Remove the cap so the container can pour (BottleLiquid.cap_open also makes the shader treat it as open).
func uncap(b: Node) -> void:
	_set_cap(b, false)


## U: take the cap off, or put it back on when it is already off (bottles without a cap node do nothing).
func toggle_cap(b: Node) -> void:
	if b == null or not ("ctl" in b) or b.ctl == null:
		return
	var c = b.model.find_child("Cap*", true, false)
	if c == null:
		return
	_set_cap(b, not c.visible)


func _set_cap(b: Node, on: bool) -> void:
	if b == null or not ("ctl" in b) or b.ctl == null:
		return
	b.ctl.cap_open = not on
	var c = b.model.find_child("Cap*", true, false)
	if c:
		c.visible = on


func _populate() -> void:
	_populate_bar()
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
	_repair_glass()
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
			KEY_U: toggle_cap(held if held else _pick_bottle())
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
		# Stay dynamic and steer by velocity (capped), so shelves and other bottles block it instead of being
		# tunnelled through, and no depenetration impulse breaks anything.
		var rb := held as RigidBody3D
		rb.linear_velocity = ((origin - rb.global_position) * 20.0).limit_length(HOLD_MAX_SPEED)
		var dq := (basis.get_rotation_quaternion() * rb.global_transform.basis.get_rotation_quaternion().inverse()).normalized()
		if dq.w < 0.0:
			dq = -dq
		var ang := dq.get_angle()
		rb.angular_velocity = (dq.get_axis() * ang * 15.0).limit_length(HOLD_MAX_SPIN) if ang > 1e-3 else Vector3.ZERO
		_held_vel = rb.linear_velocity
	for br in bricks:
		if is_instance_valid(br):
			FastImpact.step_thrown(br, dt, BottleFactory.MASK_BOTTLE)


func ray_pick(mask: int) -> Dictionary:
	var from := cam.global_position
	var q := PhysicsRayQueryParameters3D.create(from, from - cam.global_transform.basis.z * 6.0, mask)
	return get_world_3d().direct_space_state.intersect_ray(q)


func _pick_bottle() -> Node3D:
	var h := ray_pick(2 | 8)
	return h["collider"] as Node3D if not h.is_empty() else null


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
	rb.sleeping = false
	rb.can_sleep = false
	rb.gravity_scale = 0.0
	if n.has_method("set_held"):
		n.set_held(true)


func release(vel: Vector3) -> void:
	var rb := held as RigidBody3D
	held = null
	if rb == null or not is_instance_valid(rb):
		return
	rb.gravity_scale = 1.0
	rb.can_sleep = true
	rb.sleeping = false
	rb.angular_velocity = Vector3.ZERO
	rb.linear_velocity = vel if vel != Vector3.ZERO else _held_vel
	glass.track(rb)   # predicted pane crossing for flung bottles (the pane sensors also auto-track)
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
	glass.track(br)
	while bricks.size() > 6:
		var o: RigidBody3D = bricks.pop_front()
		if is_instance_valid(o):
			o.queue_free()
	return br


var last_glass: Dictionary = {}


## (FastImpact.fire runs with a muzzle speed here: its hitscan mode can spin forever when a segment end rounds to the same float32 position.)
## LMB: hitscan through glass panes (GlassSystem.fire_bullet, residual energy) and bottles (FastImpact.fire), in order.
## Bottles between the muzzle / panes are hit per segment; the energy after the last pane carries on to bottles behind it.
func shoot() -> Array:
	var from := cam.global_position
	var dir := -cam.global_transform.basis.z
	var space := get_world_3d().direct_space_state
	var ex: Array = []
	for p in glass_panes:
		ex.append(p.get_rid())
	var gb := glass.fire_bullet(from, dir, 500.0, 0.009, 1 | glass.pane_layer, -1.0, 150.0)   # world + panes
	last_glass = gb
	var res: Array = []
	var pos := from
	var energy := 500.0
	var stop_dist := 150.0
	if not (gb["stop"] as Dictionary).is_empty():
		stop_dist = from.distance_to(gb["stop"]["point"])
	for h in gb["hits"]:
		var hp: Vector3 = h["point"]
		res.append_array(FastImpact.fire(space, pos, dir, energy, 0.009, BottleFactory.MASK_BOTTLE, pos.distance_to(hp), 0.0, ex))
		pos = hp + dir * 0.002
		energy = float(gb["energy"])
	if energy > 2.0:
		res.append_array(FastImpact.fire(space, pos, dir, energy, 0.009, BottleFactory.MASK_BOTTLE, maxf(stop_dist - pos.distance_to(from), 0.1), 0.0, ex))
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


func _run_label_shots() -> void:
	DirAccess.make_dir_recursive_absolute(shots_dir)
	await _frames(90)
	var i := 0
	for b in get_tree().get_nodes_in_group("bottles"):
		var inf: Dictionary = b.get_meta("bottle_info")
		if not String(inf["id"]).begins_with("design_"):
			continue
		var p: Vector3 = b.global_position + Vector3(0, 0.1, 0)
		_aim(p + Vector3(0, 0.05, 0.55), p)
		await _frames(4)
		await _snap("lbl_%02d_%s" % [i, String(inf["id"]).trim_prefix("design_")])
		i += 1
		if i >= 12: break


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
	await _run_bar_shots()
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


# ---------------------------------------------------------------- pour / container breakage shots

func _hold(b: RigidBody3D) -> void:
	b.freeze_mode = RigidBody3D.FREEZE_MODE_KINEMATIC
	b.freeze = true
	b.breakable = false   # teleport-tilting a kinematic body reads as a hard impact


func _tilt(b: Node3D, deg: float, pivot: Vector3) -> void:
	b.global_transform = Transform3D(Basis(Vector3(0, 0, 1), deg_to_rad(deg)), pivot)


## Move the receiver so the pourer's current stream hits its mouth.
func _aim_receiver(src: BottlePour, rcv: RigidBody3D) -> void:
	var mw: Vector3 = rcv.ctl.liquid.global_transform * rcv.ctl.mouth_centre
	var off := mw - rcv.global_position
	var p0 := src.stream_p0
	var v0 := src.stream_v0
	if v0 == Vector3.ZERO:
		return
	var a := -0.5 * 9.81
	var c := p0.y - mw.y
	var disc := v0.y * v0.y - 4.0 * a * c
	if disc < 0.0:
		return
	var t := (-v0.y - sqrt(disc)) / (2.0 * a)
	var hit := p0 + v0 * t
	rcv.global_position = Vector3(hit.x - off.x, rcv.global_position.y, hit.z - off.z)


func _watch(b: Node, label: String) -> void:
	b.broke.connect(func(_p, _e, k): print("EVENT %s broke (%s)" % [label, k]))
	b.leaked.connect(func(_p): print("EVENT %s leaked" % label))
	b.impact_assessed.connect(func(i): print("EVENT %s impact ratio %.2f" % [label, float(i.get("ratio", 0.0))]))


func _vol(b: Node) -> float:
	return (b.get_meta("pour") as BottlePour).volume_ml()


func _run_bar_shots() -> void:
	await reset_scene()
	await _frames(60)
	_aim(Vector3(BAR_X, 1.25, 2.0), Vector3(BAR_X, 0.85, 0.0))
	await _frames(15)
	await _snap("06_bar_still_life")
	# bottle pouring into the empty tumbler (held bottle tilts, receiver follows the stream)
	var wine := _find("bottle_wine")
	var rcv: RigidBody3D = null
	for b in get_tree().get_nodes_in_group("bottles"):
		if b.get_meta("bottle_info")["id"] == "container_tumbler" and _vol(b) < 1.0:
			rcv = b
	if wine and rcv:
		_hold(wine)
		_hold(rcv)
		var piv := Vector3(BAR_X - 1.0, BAR_TOP + 0.5, 0.2)
		var ps := wine.get_meta("pour") as BottlePour
		rcv.global_position = Vector3(BAR_X - 0.8, BAR_TOP + 0.002, 0.2)
		_aim(Vector3(BAR_X - 1.15, BAR_TOP + 0.55, 1.0), Vector3(BAR_X - 0.95, BAR_TOP + 0.35, 0.2))
		var ang := 60.0
		for i in 240:
			ang = minf(125.0, ang + 1.2)
			_tilt(wine, ang, piv)
			await get_tree().physics_frame
			_aim_receiver(ps, rcv)
			if i == 90 or i == 215:
				await _snap("07_wine_into_tumbler_%d" % i)
				print("POUR wine %.0f ml -> tumbler %.0f ml (%.0f%%) flow %.0f ml/s" % [_vol(wine), _vol(rcv), 100.0 * rcv.fill, ps.flow_ml_s])
	# knocked-over tumbler -> puddle
	if wine:
		wine.freeze = false
	if rcv:
		rcv.freeze = false
	var full: RigidBody3D = null
	for b in get_tree().get_nodes_in_group("bottles"):
		if b.get_meta("bottle_info")["id"] == "container_tumbler" and _vol(b) > 100.0 and not b.freeze and b.global_position.x > 2.0:
			full = b
	if full:
		_aim(Vector3(BAR_X - 0.1, BAR_TOP + 0.5, 0.9), full.global_position)
		full.rotation_degrees = Vector3(0, 0, 100)
		full.linear_velocity = Vector3(0.6, 0.3, 0)
		await _frames(25)
		await _snap("08_tumbler_tipping")
		await _frames(150)
		await _snap("09_tumbler_puddle")
		print("TIPPED tumbler left %.1f ml, world puddle %.1f ml" % [_vol(full), BottlePour.world_puddle_ml])
	# brick at a container (shelf tumbler) and at the glass hip flask
	await reset_scene()
	await _frames(60)
	var tum: Node3D = null
	for b in get_tree().get_nodes_in_group("bottles"):
		if b.get_meta("bottle_info")["id"] == "container_tumbler" and b.global_position.x > 2.0 and _vol(b) > 100.0:
			tum = b
	if tum:
		_watch(tum, "tumbler")
		var tp := tum.global_position + Vector3(0, 0.07, 0)
		_aim(Vector3(tp.x, tp.y, 1.1), tp)
		spawn_brick(cam.global_position + Vector3(0, 0.06, -0.5), (tp - cam.global_position).normalized() * 12.0)
		await _frames(18)
		await _snap("10_brick_tumbler_a")
		await _frames(45)
		await _snap("10_brick_tumbler_b")
	var mug: Node3D = null
	for b in get_tree().get_nodes_in_group("bottles"):
		if b.get_meta("bottle_info")["id"] == "container_mug" and b.global_position.x > 2.0 and _vol(b) > 100.0:
			mug = b
	if mug:
		_watch(mug, "mug")
		var mp := mug.global_position + Vector3(0, 0.05, 0)
		_aim(Vector3(mp.x, mp.y, 1.1), mp)
		var r := shoot()
		print("mug shot result ", r.size())
		await _frames(30)
		await _snap("11_bullet_mug")
	var bdz := _find("", "v2_bordeaux_classic")
	if bdz:
		_watch(bdz, "bordeaux_design")
		var bp := bdz.global_position + Vector3(0, 0.12, 0)
		_aim(Vector3(bp.x, bp.y, 1.4), bp)
		spawn_brick(cam.global_position + Vector3(0, -0.05, -0.5), (bp - cam.global_position).normalized() * 13.0)
		await _frames(18)
		await _snap("12_v2_design_shatter_a")
		await _frames(45)
		await _snap("12_v2_design_shatter_b")


# ---------------------------------------------------------------- glass verification (--glass [--shots <dir>])

var _gcheck_fail := 0


func _check(name: String, ok: bool, detail := "") -> void:
	if not ok:
		_gcheck_fail += 1
	print("%s %s %s" % ["PASS" if ok else "FAIL", name, detail])


func _glass_snap(n: String) -> void:
	if shots_dir != "":
		await _snap(n)


func _run_glass() -> void:
	if shots_dir != "":
		DirAccess.make_dir_recursive_absolute(shots_dir)
	await _frames(90)
	var ev := {"damaged": 0, "broke": 0}
	glass.pane_damaged.connect(func(_p, _pt, _o, _e): ev["damaged"] += 1)
	glass.pane_broke.connect(func(_p, _pt, _e, _k): ev["broke"] += 1)
	# idle cost: nothing running in the glass system
	_check("idle glass system", not glass.is_processing() and not glass.is_physics_processing(),
		"process %s physics %s" % [glass.is_processing(), glass.is_physics_processing()])
	# 1. bullet at the window (sky behind it)
	var wp := window_pane.global_position
	_aim(Vector3(wp.x + 0.25, wp.y - 0.05, 2.2), wp + Vector3(-0.1, 0.1, 0))
	await _frames(5)
	var r := shoot()
	var res: Dictionary = (window_pane.last_info as Dictionary)
	_check("window bullet", int(res.get("outcome", 0)) != GlassDamageModel.Outcome.NONE and ev["damaged"] > 0,
		"outcome %s pierced %s damage %.2f%% hits %d bottle hits %d" % [res.get("outcome_name", "?"), res.get("pierced", false), window_pane.damage_percent(), last_glass["hits"].size(), r.size()])
	await _frames(40)
	_aim(Vector3(wp.x + 0.6, wp.y - 0.15, 1.6), wp)
	await _frames(5)
	await _glass_snap("g1_window_cracked")
	# bullet that passes the pane and continues to the shelf bottles: stand left of the window? check residual energy value
	print("residual energy after window %.1f J" % float(last_glass["energy"]))
	# 2. brick at the shop front
	var sp := shop_pane.global_position
	var out: Vector3 = shop_pane.global_transform.basis.z
	var origin := sp + out * 3.0 + Vector3(0, 0.1, 0)
	_aim(origin + Vector3(0, 0.3, 0), sp)
	var d0 := int(ev["damaged"])
	var b0 := int(ev["broke"])
	spawn_brick(origin, (sp - origin).normalized() * 14.0)
	await _frames(12)
	await _frames(60)
	_check("brick vs shop front", shop_pane.damage > 0.0 or shop_pane.broken, "damage %.1f%% outcome %s broken %s events +%d damaged +%d broke" % [
		shop_pane.damage_percent(), shop_pane.last_info.get("outcome_name", "?"), shop_pane.broken, int(ev["damaged"]) - d0, int(ev["broke"]) - b0])
	_check("brick signal", ev["damaged"] > d0 or ev["broke"] > b0)
	await _frames(40)
	_aim(sp + out * 3.0 + Vector3(0, 0.5, 0), sp + Vector3(0, -0.3, 0))
	await _frames(5)
	await _glass_snap("g2_shop_front")
	# 3. bottle thrown at the tempered pane
	var tp := temper_pane.global_position
	var tout: Vector3 = temper_pane.global_transform.basis.z
	var bpos := tp + tout * 2.0 + Vector3(0, 0.0, 0)
	var bt := BottleFactory.spawn("bottle_beer", {"fill": 0.6, "position": bpos, "seed": 7})
	scene_root.add_child(bt)
	await _frames(2)
	var bb_broke := {"v": false}
	bt.broke.connect(func(_p, _e, _k): bb_broke["v"] = true)
	var dd := int(ev["damaged"])
	var bk := int(ev["broke"])
	bt.rotation = Vector3(0, 0, 0)
	bt.linear_velocity = (-tout) * 9.0 + Vector3(0, 0.6, 0)
	bt.sleeping = false
	glass.track(bt)
	await _frames(70)
	_check("bottle vs tempered pane", temper_pane.damage > 0.0 or temper_pane.broken, "pane damage %.1f%% outcome %s broken %s; bottle broke %s valid %s events +%d/+%d" % [
		temper_pane.damage_percent(), temper_pane.last_info.get("outcome_name", "?"), temper_pane.broken, bb_broke["v"], is_instance_valid(bt),
		int(ev["damaged"]) - dd, int(ev["broke"]) - bk])
	_check("bottle sane", bb_broke["v"] or (is_instance_valid(bt) and bt.global_position.is_finite()))
	# 4. overview
	_aim(Vector3(-1.0, 1.7, 4.2), Vector3(-1.2, 1.0, -0.3))
	await _frames(5)
	await _glass_snap("g3_overview")
	# 5. reset repairs panes
	await reset_scene()
	await _frames(10)
	var ok := true
	for p in glass_panes:
		ok = ok and p.damage == 0.0 and not p.broken and not p.fractured and p.mesh_instance.visible
	_check("reset repairs panes", ok)
	var ex2: Array = []
	var g2 := glass.fire_bullet(Vector3(WIN_X, WIN_Y, 2.0), Vector3(0, 0, -1), 500.0, 0.009, 1 | glass.pane_layer)
	_check("repaired window hit again", g2["hits"].size() == 1, "hits %d" % g2["hits"].size())
	# bullet through the (repaired) window continues to a bottle hung behind it
	var tb := BottleFactory.spawn("bottle_wine", {"fill": 0.5, "position": Vector3(WIN_X, 0.9, 0.5), "seed": 9})
	scene_root.add_child(tb)
	await _frames(2)
	tb.freeze = true
	_aim(Vector3(WIN_X, 1.6, -3.0), tb.global_position + Vector3(0, 0.12, 0))
	var bhit := shoot()
	_check("bullet through pane hits bottle behind", last_glass["hits"].size() == 1 and bhit.size() >= 1,
		"pane hits %d bottle hits %d residual %.0f J" % [last_glass["hits"].size(), bhit.size(), float(last_glass["energy"])])
	await _frames(240)
	_check("idle after settle", not glass.is_physics_processing() and not glass.is_processing(), "physics %s process %s tracked? shards %d" % [glass.is_physics_processing(), glass.is_processing(), glass.live_shards()])
	print("GLASS RESULT ", "PASS" if _gcheck_fail == 0 else "FAIL (%d)" % _gcheck_fail)
	get_tree().quit()
