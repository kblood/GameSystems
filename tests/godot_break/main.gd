extends Node3D
## Bottle break test bed (desktop, no VR).
##   godot --path .                                   interactive
##   godot --headless --path . --fixed-fps 60 -- --calibrate        threshold search + scenario table -> calibration_report.json
##   godot --path . --rendering-driver vulkan -- --shots <dir>      PNG sequences (drop, bullet, plastic leak, neck snap)
## Interactive keys: WASD/mouse = move/look (Esc frees the mouse) | LMB shoot | RMB throw bottle | wheel = throw speed
## B bottle | F fill | R stand a bottle on the table | E drop one from the drop height at the crosshair | [ ] drop height
## Q realism tier (HIGH/MEDIUM/LOW/MINIMAL) | G ammo | M change the wall surface | C clear debris | T put a bottle on the table and tip it over (neck-snap/pour test)

const BOTTLES := ["wine", "beer", "soda", "whiskey", "jar", "flask"]
const FILLS := [0.0, 0.25, 0.5, 0.75, 1.0]
const WALL_SURFACES := ["concrete", "metal", "wood", "carpet"]
const AMMO := [["airgun 5.5mm", 15.0, 0.0055], [".22 LR", 150.0, 0.0056], ["9 mm", 500.0, 0.009], ["rifle", 2500.0, 0.0077]]
const TABLE_TOP := 0.75

var cam: Camera3D
var world: Node3D
var table: StaticBody3D
var wall: StaticBody3D
var mgr: BottleBreakManager
var bottles: Array[BreakableBottle] = []
var bi := 0
var fi := 2
var wi := 0
var ai := 2
var throw_speed := 8.0
var drop_height := 1.2
var yaw := 0.0
var pitch := -0.15
var hud: Label
var meter: ProgressBar
var dmg_bar: ProgressBar
var meter_label: Label
var last_info: Dictionary = {}
var _profiles := {}
var _shots_mode := false


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if "--calibrate" in args:
		var c := BreakCalibration.new()
		add_child(c)
		c.run()
		return
	if "--fast" in args:
		var ft := FastTrials.new()
		add_child(ft)
		ft.run()
		return
	if "--bench" in args:
		var bn := BottleBreakBench.new()
		add_child(bn)
		bn.run(func(w: Node3D): TestWorld.pad(w, Vector3(0, -0.1, 0), Vector3(10, 0.2, 10), "concrete"))
		return
	var qi := args.find("--quality")
	if qi >= 0 and args.size() > qi + 1:
		BottleBreakManager.default_quality = int(args[qi + 1])
	await get_tree().process_frame
	_build_world()
	var si := args.find("--shots")
	if si >= 0 and args.size() > si + 1:
		_shots_mode = true
		await _shots(args[si + 1])
		return
	if "--smoke" in args:
		await _smoke()
		return
	_build_ui()
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	_spawn_standing()


# ------------------------------------------------------------------ world

func _build_world() -> void:
	get_window().size = Vector2i(1100, 700)
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var psm := ProceduralSkyMaterial.new()
	psm.sky_top_color = Color(0.35, 0.5, 0.75)
	psm.sky_horizon_color = Color(0.75, 0.8, 0.85)
	psm.ground_bottom_color = Color(0.25, 0.25, 0.27)
	psm.ground_horizon_color = Color(0.6, 0.62, 0.65)
	sky.sky_material = psm
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.9
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, 35, 0)
	sun.light_energy = 1.3
	sun.shadow_enabled = true
	add_child(sun)
	world = Node3D.new()
	world.name = "World"
	add_child(world)
	TestWorld.pad(world, Vector3.ZERO, Vector3(40, 0.2, 40), "concrete", "floor")
	TestWorld.pad(world, Vector3(-3, 0.03, 0), Vector3(3, 0.06, 3), "carpet", "carpet")
	table = TestWorld.pad(world, Vector3(3, TABLE_TOP, 0), Vector3(1.6, TABLE_TOP, 1.0), "wood", "table")
	wall = TestWorld.pad(world, Vector3(0, 4, -5), Vector3(14, 4, 0.3), "concrete", "wall")
	cam = Camera3D.new()
	cam.fov = 70
	cam.near = 0.03
	add_child(cam)
	cam.position = Vector3(0, 1.6, 4)
	mgr = BottleBreakManager.get_for(self)


func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var panel := PanelContainer.new()
	panel.position = Vector2(10, 10)
	layer.add_child(panel)
	var box := VBoxContainer.new()
	panel.add_child(box)
	hud = Label.new()
	box.add_child(hud)
	meter_label = Label.new()
	meter_label.text = "FORCE METER  F_peak / F_crit"
	box.add_child(meter_label)
	meter = ProgressBar.new()
	meter.custom_minimum_size = Vector2(420, 18)
	meter.max_value = 2.0
	meter.step = 0.01
	meter.show_percentage = false
	box.add_child(meter)
	var dl := Label.new()
	dl.text = "cumulative damage (fatigue)"
	box.add_child(dl)
	dmg_bar = ProgressBar.new()
	dmg_bar.custom_minimum_size = Vector2(420, 14)
	dmg_bar.max_value = 1.0
	dmg_bar.step = 0.01
	box.add_child(dmg_bar)
	var ch := Label.new()
	ch.text = "+"
	ch.set_anchors_preset(Control.PRESET_CENTER)
	layer.add_child(ch)


func _profile(name: String) -> BottleBreakProfile:
	if not _profiles.has(name):
		var b := BreakableBottle.create(name, 0.5)
		_profiles[name] = b.profile
		b.free()
	return _profiles[name]


func _threshold_text() -> String:
	var p := _profile(BOTTLES[bi])
	if p.material == "plastic":
		return "plastic: never shatters (dents; leaks when shot)"
	var parts := []
	for s in ["concrete", "wood", "carpet"]:
		var v := p.critical_speed(s, FILLS[fi], p.body_z * 0.5)
		parts.append("%s %.1f m/s (%.2f m)" % [s, v, v * v / 19.62])
	return "breaks (body hit, no flaw): " + " | ".join(parts)


func _process(dt: float) -> void:
	if _shots_mode or hud == null:
		return
	var v := Vector3.ZERO
	var basis := cam.global_transform.basis
	if Input.is_key_pressed(KEY_W): v -= basis.z
	if Input.is_key_pressed(KEY_S): v += basis.z
	if Input.is_key_pressed(KEY_A): v -= basis.x
	if Input.is_key_pressed(KEY_D): v += basis.x
	cam.position += v * dt * 3.0
	var t := "bottle %s  fill %d%%   throw %.1f m/s   ammo %s (%d J)   wall: %s   drop height %.1f m\n" % [
		BOTTLES[bi], int(FILLS[fi] * 100), throw_speed, AMMO[ai][0], int(AMMO[ai][1]), WALL_SURFACES[wi], drop_height]
	t += _threshold_text() + "\n"
	if not last_info.is_empty():
		if last_info.get("bullet", false):
			t += "LAST: bullet %.0f J  zone %s  -> %s" % [last_info["energy"], last_info["zone_name"], _oname(last_info["outcome"])]
		else:
			t += "LAST: v_n %.2f m/s  J %.1f Ns  E %.1f J  m_eff %.2f kg  zone %s on %s  F %.0f / crit %.0f N  -> %s" % [
				last_info["v_n"], last_info["j_n"], last_info["energy"], last_info["m_eff"], last_info["zone_name"],
				last_info["surface"], last_info["f_peak"], last_info["f_crit"], _oname(last_info["outcome"])]
	t += "\nTIER %s (Q)   shards %d/%d  droplets %d/%d" % [BottleBreakManager.TIERS[mgr.quality]["name"], mgr.live_shards,
		mgr.max_shards, mgr.live_droplets, mgr.max_droplets]
	hud.text = t


func _oname(o: int) -> String:
	return ["none", "CRACK", "NECK SNAP", "SHATTER", "dent", "PIERCED"][o]


func _on_impact(info: Dictionary) -> void:
	last_info = info
	if meter:
		var r: float = info.get("ratio", 1.0 if info.get("bullet", false) else 0.0)
		meter.value = r
		meter_label.text = "FORCE METER  F_peak / F_crit = %.2f  (>= 1.0 breaks)" % r
		dmg_bar.value = info.get("damage_after", 0.0)


# ------------------------------------------------------------------ bottles

func _new_bottle(pos: Vector3, vel := Vector3.ZERO, ang := Vector3.ZERO) -> BreakableBottle:
	var b := BreakableBottle.create(BOTTLES[bi], FILLS[fi])
	world.add_child(b)
	b.global_position = pos
	b.linear_velocity = vel
	b.angular_velocity = ang
	b.impact_assessed.connect(_on_impact)
	b.broke.connect(func(p, e, k): print("broke ", k, " E=%.1f J at " % e, p))
	bottles.append(b)
	while bottles.size() > 14:
		var o: BreakableBottle = bottles.pop_front()
		if is_instance_valid(o):
			o.queue_free()
	return b


func _spawn_standing() -> void:
	_new_bottle(Vector3(3, TABLE_TOP + 0.002, 0))


func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		yaw -= e.relative.x * 0.0025
		pitch = clampf(pitch - e.relative.y * 0.0025, -1.5, 1.5)
		cam.rotation = Vector3(pitch, yaw, 0)
	elif e is InputEventMouseButton and e.pressed:
		if Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
			return
		match e.button_index:
			MOUSE_BUTTON_LEFT: _shoot()
			MOUSE_BUTTON_RIGHT: _throw()
			MOUSE_BUTTON_WHEEL_UP: throw_speed = minf(throw_speed + 0.5, 30.0)
			MOUSE_BUTTON_WHEEL_DOWN: throw_speed = maxf(throw_speed - 0.5, 1.0)
	elif e is InputEventKey and e.pressed and not e.echo:
		match (e as InputEventKey).keycode:
			KEY_ESCAPE: Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
			KEY_B: bi = (bi + 1) % BOTTLES.size()
			KEY_F: fi = (fi + 1) % FILLS.size()
			KEY_G: ai = (ai + 1) % AMMO.size()
			KEY_M:
				wi = (wi + 1) % WALL_SURFACES.size()
				TestWorld.set_surface(wall, WALL_SURFACES[wi])
			KEY_R: _spawn_standing()
			KEY_C: mgr.clear_debris()
			KEY_E: _drop()
			KEY_BRACKETLEFT: drop_height = maxf(0.2, drop_height - 0.2)
			KEY_BRACKETRIGHT: drop_height = minf(6.0, drop_height + 0.2)
			KEY_T: _tilt_test()
			KEY_Q: mgr.set_quality((mgr.quality + 1) % 4)   # realism tier, switchable at runtime


func _aim_ray() -> Dictionary:
	var from := cam.global_position
	var to := from - cam.global_transform.basis.z * 60.0
	var q := PhysicsRayQueryParameters3D.create(from, to, 1 | 8)
	return get_world_3d().direct_space_state.intersect_ray(q)


func _shoot() -> void:
	var dir := -cam.global_transform.basis.z
	var hit := _aim_ray()
	var end := cam.global_position + dir * 40.0
	if not hit.is_empty():
		end = hit["position"]
		if hit["collider"] is BreakableBottle:
			(hit["collider"] as BreakableBottle).hit_by_projectile(end, dir, AMMO[ai][1], AMMO[ai][2])
	_tracer(cam.global_position + cam.global_transform.basis * Vector3(0.12, -0.12, -0.3), end)


func _tracer(a: Vector3, b: Vector3) -> void:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.006, 0.006, a.distance_to(b))
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = Color(1, 0.85, 0.4)
	bm.material = m
	mi.mesh = bm
	add_child(mi)
	mi.global_position = (a + b) * 0.5
	mi.look_at(b, Vector3.UP)
	get_tree().create_timer(0.06).timeout.connect(mi.queue_free)


func _throw() -> void:
	var dir := -cam.global_transform.basis.z
	var right := cam.global_transform.basis.x
	_new_bottle(cam.global_position + dir * 0.7 - Vector3.UP * 0.12, dir * throw_speed, right * 5.0)


func _drop() -> void:
	var hit := _aim_ray()
	var p := cam.global_position + Vector3.UP
	if not hit.is_empty():
		p = hit["position"] + Vector3.UP * drop_height
	var b := _new_bottle(p + Vector3.UP * 0.2)
	b.rotation = Vector3(0, 0, PI * 0.5)   # lying: lands on the body


func _tilt_test() -> void:
	var b := _new_bottle(Vector3(3, TABLE_TOP + 0.01, 0))
	b.angular_velocity = Vector3(0, 0, 2.0)


# ------------------------------------------------------------------ headless self test

func _smoke() -> void:
	await get_tree().physics_frame
	_new_bottle(Vector3(0, 1.0, 0))
	for i in 120:
		await get_tree().physics_frame
	print("SMOKE ok shards=", mgr.live_shards)
	get_tree().quit()


# ------------------------------------------------------------------ screenshots

func _cam_at(pos: Vector3, target: Vector3, fov := 45.0) -> void:
	cam.fov = fov
	cam.global_position = pos
	cam.look_at(target, Vector3.UP)


func _grab(dir: String, name: String) -> void:
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("%s/%s.png" % [dir, name])


func _frames(n: int) -> void:
	for i in n:
		await get_tree().physics_frame


func _shots(dir: String) -> void:
	DirAccess.make_dir_recursive_absolute(dir)
	get_window().size = Vector2i(720, 540)
	await _frames(3)
	var sink := {"n": 0}
	var oi := OS.get_cmdline_user_args().find("--only")
	var only: String = OS.get_cmdline_user_args()[oi + 1] if oi >= 0 else "ABCD"
	# ---- A: wine, 75 % full, dropped ~1.8 m onto concrete (lying): shatter + splash + puddle
	if "A" in only:
		await _shot_a(dir, sink)
	if "B" in only:
		await _shot_b(dir)
	if "C" in only:
		await _shot_c(dir)
	if "D" in only:
		await _shot_d(dir)
	if "E" in only:
		await _shot_e(dir)
	print("SHOTS done")
	get_tree().quit()


func _shot_a(dir: String, sink: Dictionary) -> void:
	bi = 0
	fi = 3
	_cam_at(Vector3(0.0, 0.55, 1.5), Vector3(0, 0.25, 0))
	var b := _new_bottle(Vector3(0, 1.8, 0))
	b.rotation = Vector3(0, 0, PI * 0.5)
	b.use_flaw = false
	b.broke.connect(func(_p, _e, _k): sink["n"] = 1)
	var guard := 0
	while sink["n"] == 0 and guard < 300:
		await get_tree().physics_frame
		guard += 1
		if guard == 25:
			await _grab(dir, "A0_falling")
	print("A broke after frames ", guard)
	for k in [[1, "A1_impact"], [3, "A2_plus4f"], [6, "A3_plus10f"], [20, "A4_plus30f"], [90, "A5_plus2s"], [120, "A6_plus4s"]]:
		await _frames(k[0])
		await _grab(dir, k[1])
	mgr.clear_debris()
	await _frames(5)


func _shot_b(dir: String) -> void:
	# ---- B: bullet into a standing, full wine bottle on the table (9 mm)
	fi = 4
	_cam_at(Vector3(3.0, TABLE_TOP + 0.35, 1.3), Vector3(3, TABLE_TOP + 0.17, 0), 40.0)
	var t := _new_bottle(Vector3(3, TABLE_TOP + 0.002, 0))
	t.use_flaw = false
	await _frames(40)
	await _grab(dir, "B0_before")
	t.hit_by_projectile(Vector3(3, TABLE_TOP + 0.13, 0.036), Vector3(0, 0, -1), 500.0, 0.009)
	await _frames(3)
	await _grab(dir, "B1_shot_plus3f")
	await _frames(12)
	await _grab(dir, "B2_plus15f")
	await _frames(60)
	await _grab(dir, "B3_plus1s")
	await _frames(180)
	await _grab(dir, "B4_plus4s")
	mgr.clear_debris()


func _shot_c(dir: String) -> void:
	# ---- C: plastic soda, shot at ~40 % height: leaks until the level drops to the hole
	bi = 2
	fi = 4
	_cam_at(Vector3(3.0, TABLE_TOP + 0.3, 0.9), Vector3(3, TABLE_TOP + 0.13, 0), 40.0)
	var s := _new_bottle(Vector3(3, TABLE_TOP + 0.002, 0))
	await _frames(40)
	s.hit_by_projectile(Vector3(3, TABLE_TOP + 0.1, 0.033), Vector3(0, 0.05, -1), 500.0, 0.009)
	for k in [[20, "C1_leak_0.3s"], [60, "C2_leak_1.3s"], [240, "C3_leak_5s"], [600, "C4_leak_15s"]]:
		await _frames(k[0])
		await _grab(dir, k[1])
		print("soda fill ", s.fill)
	s.queue_free()
	mgr.clear_debris()


func _shot_e(dir: String) -> void:
	# ---- E: the same drop at each realism tier, 1.3 s after the break
	bi = 0
	fi = 3
	for q in 4:
		mgr.set_quality(q)
		mgr.clear_debris()
		_cam_at(Vector3(0.0, 0.55, 1.5), Vector3(0, 0.25, 0))
		var b := _new_bottle(Vector3(0, 1.8, 0))
		b.rotation = Vector3(0, 0, PI * 0.5)
		b.use_flaw = false
		var sink := {"n": 0}
		b.broke.connect(func(_p, _e, _k): sink["n"] = 1)
		var guard := 0
		while sink["n"] == 0 and guard < 300:
			await get_tree().physics_frame
			guard += 1
		await _frames(80)
		await _grab(dir, "E%d_tier_%s" % [q, BottleBreakManager.TIERS[q]["name"]])
	mgr.set_quality(0)
	mgr.clear_debris()


func _shot_d(dir: String) -> void:
	# ---- D: wine, neck snap (tap on the neck), then tip it over: pours until the level is below the broken rim
	bi = 0
	fi = 3
	_cam_at(Vector3(3.0, TABLE_TOP + 0.4, 1.0), Vector3(3, TABLE_TOP + 0.2, 0), 45.0)
	var n := _new_bottle(Vector3(3, TABLE_TOP + 0.002, 0))
	n.use_flaw = false
	n.free_on_break = false
	await _frames(40)
	var info := n.apply_impact(Vector3(3, TABLE_TOP + 0.30, 0.012), Vector3(0, 0, 1), 1.0, {"speed": 3.0, "surface": "concrete"})
	print("neck hit ", info.get("zone_name"), " ratio ", info.get("ratio"), " outcome ", info.get("outcome"))
	await _frames(20)
	await _grab(dir, "D1_neck_snapped")
	n.angular_velocity = Vector3(2.5, 0, 0)
	n.apply_central_impulse(Vector3(0, 0, -0.1))
	for k in [[30, "D2_tipping"], [40, "D3_pouring"], [120, "D4_pouring_later"], [240, "D5_after"]]:
		await _frames(k[0])
		await _grab(dir, k[1])
		print("neck fill ", n.fill, " state ", n.state)
