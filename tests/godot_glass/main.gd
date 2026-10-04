extends Node3D
## Glass pane test scene (desktop, no VR).
##   interactive (default): LMB shoot, RMB throw, 1-9/0 pane, T thickness, C caliber, B throwable, +/- speed,
##                          G tier, M slow motion, R repair, N other side, Esc quit
##   -- --shots <dir> [--only <type>|tiers]   scripted PNGs + contact sheet (<dir>/../glass_sheet.png)
##   -- --calibrate <dir>                     headless: break table, assertions, predictor trials, tier bench (JSON)

const PANES := ["annealed", "tempered", "laminated", "igu", "wired", "resistant", "casement", "shop", "door", "rear"]
const CALIBERS := [["9mm", 0.009, 518.0], ["22lr", 0.0057, 178.0], ["556", 0.0056, 1767.0],
	["762", 0.0076, 3422.0], ["45acp", 0.0114, 484.0], ["pellet", 0.0045, 15.0], ["bb", 0.006, 1.0]]
const THROWABLES := ["brick", "stone", "bottle", "chair", "sphere", "hammer", "body"]
const THICK := [3.0, 4.0, 6.0, 10.0]

var sys: GlassSystem
var cam: Camera3D
var hud: Label
var window: Node3D
var pane_i := 0
var cal_i := 0
var throw_i := 0
var throw_speed := 9.0
var thick_i := -1
var slow := false
var backside := false
var thrown: Array[RigidBody3D] = []


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	sys = GlassSystem.new()
	add_child(sys)
	_build_world()
	if "--calibrate" in args:
		var i := args.find("--calibrate")
		var dir: String = args[i + 1] if args.size() > i + 1 else ProjectSettings.globalize_path("res://out")
		await _calibrate(dir)
		get_tree().quit()
		return
	if "--shots" in args:
		var i := args.find("--shots")
		var dir: String = args[i + 1] if args.size() > i + 1 else ProjectSettings.globalize_path("res://out")
		await _shots(dir, args)
		get_tree().quit()
		return
	_interactive_setup()


# ------------------------------------------------------------------ world

func _build_world() -> void:
	var env := WorldEnvironment.new()
	var e := Environment.new()
	var sky := Sky.new()
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color(0.25, 0.42, 0.7)
	sm.sky_horizon_color = Color(0.7, 0.75, 0.8)
	sm.ground_bottom_color = Color(0.2, 0.18, 0.16)
	sm.ground_horizon_color = Color(0.5, 0.48, 0.45)
	sky.sky_material = sm
	e.background_mode = Environment.BG_SKY
	e.sky = sky
	e.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	e.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	e.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.environment = e
	add_child(env)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-35, 35, 0)
	sun.light_energy = 1.2
	sun.shadow_enabled = true
	add_child(sun)
	var ground := StaticBody3D.new()
	ground.collision_layer = 1
	var fcs := CollisionShape3D.new()
	var fb := BoxShape3D.new()
	fb.size = Vector3(200, 1, 200)
	fcs.shape = fb
	fcs.position.y = -0.5
	ground.add_child(fcs)
	var fm := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(60, 60)
	fm.mesh = pm
	fm.material_override = GlassPrefabs.mat("floor", Color(0.32, 0.3, 0.27), 0.9)
	ground.add_child(fm)
	add_child(ground)
	# interior behind the window: a back wall with coloured blocks so holes / cracks read against something
	var back := Node3D.new()
	add_child(back)
	GlassPrefabs.box(back, Vector3(8, 4, 0.1), Vector3(0, 2, -3.0), GlassPrefabs.mat("wall", Color(0.55, 0.5, 0.45), 0.9))
	var cols := [Color(0.7, 0.2, 0.15), Color(0.2, 0.4, 0.7), Color(0.85, 0.7, 0.25), Color(0.2, 0.55, 0.3), Color(0.12, 0.12, 0.14)]
	for i in 10:
		var hh := 0.35 + 0.4 * ((i * 7) % 3)
		GlassPrefabs.box(back, Vector3(0.5, hh, 0.3), Vector3(-2.2 + i * 0.5, hh * 0.5, -2.7),
			GlassPrefabs.mat("blk%d" % (i % 5), cols[i % 5], 0.7))
	cam = Camera3D.new()
	cam.fov = 60
	add_child(cam)
	_view(Vector3(0, 1.3, 1.9))


func _view(pos: Vector3, target := Vector3(0, 1.3, 0)) -> void:
	cam.position = pos
	cam.look_at(target)


func _spawn_window(n: String, mm := -1.0) -> Node3D:
	if window:
		remove_child(window)
		window.queue_free()
	for b in thrown:
		if is_instance_valid(b):
			sys.untrack(b)
			b.queue_free()
	thrown.clear()
	sys.clear_all()
	window = GlassPrefabs.by_name(n, mm)
	window.position = Vector3(0, 1.3, 0)
	add_child(window)
	return window


func panes() -> Array:
	return GlassPrefabs.panes_of(window) if window else []


func main_pane() -> GlassPane:
	var p := panes()
	return p[0] if p.size() > 0 else null


func shoot(from: Vector3, to: Vector3, cal: Array) -> Dictionary:
	return sys.fire_bullet(from, (to - from).normalized(), float(cal[2]), float(cal[1]), 0xFFFFFFFF, -1.0, 100.0)


func throw_body(kind: String, from: Vector3, to: Vector3, speed: float, parent: Node = null) -> RigidBody3D:
	var b := RigidBody3D.new()
	var cs := CollisionShape3D.new()
	var mi := MeshInstance3D.new()
	var d: Dictionary = GlassImpact.STRIKERS.get(kind, GlassImpact.STRIKERS["stone"])
	b.mass = float(d["mass"])
	match kind:
		"brick":
			var s := BoxShape3D.new()
			s.size = Vector3(0.215, 0.065, 0.1)
			cs.shape = s
			var m := BoxMesh.new()
			m.size = s.size
			mi.mesh = m
			mi.material_override = GlassPrefabs.mat("brick", Color(0.6, 0.25, 0.15), 0.9)
		"bottle":
			var s := CylinderShape3D.new()
			s.radius = 0.038
			s.height = 0.3
			cs.shape = s
			var m := CylinderMesh.new()
			m.top_radius = 0.015
			m.bottom_radius = 0.038
			m.height = 0.3
			mi.mesh = m
			mi.material_override = GlassPrefabs.mat("bottle", Color(0.1, 0.35, 0.15), 0.1)
		"chair":
			var s := BoxShape3D.new()
			s.size = Vector3(0.45, 0.45, 0.45)
			cs.shape = s
			var m := BoxMesh.new()
			m.size = s.size
			mi.mesh = m
			mi.material_override = GlassPrefabs.mat("wood", Color(0.5, 0.35, 0.2), 0.8)
		"body":
			var s := CapsuleShape3D.new()
			s.radius = 0.22
			s.height = 1.7
			cs.shape = s
			var m := CapsuleMesh.new()
			m.radius = 0.22
			m.height = 1.7
			mi.mesh = m
			mi.material_override = GlassPrefabs.mat("body", Color(0.3, 0.3, 0.5), 0.8)
		_:
			var s := SphereShape3D.new()
			s.radius = float(d.get("radius", 0.04))
			cs.shape = s
			var m := SphereMesh.new()
			m.radius = s.radius
			m.height = s.radius * 2.0
			mi.mesh = m
			mi.material_override = GlassPrefabs.mat("stone", Color(0.45, 0.45, 0.42), 0.9)
	b.add_child(cs)
	b.add_child(mi)
	b.set_meta("glass_striker", kind)
	b.collision_layer = 1 << 5
	b.collision_mask = 1 | (1 << 20)
	(parent if parent else self).add_child(b)
	if parent == null:
		thrown.append(b)
	b.global_position = from
	var T := from.distance_to(to) / speed
	var k := GlassPathPredictor.body_damp(b)
	# aim so the damped ballistic path passes through `to` after T (first-order damping correction)
	b.linear_velocity = ((to - from) / T - 0.5 * Vector3(0, -9.81, 0) * T) * (1.0 + 0.5 * k * T)
	b.angular_velocity = Vector3(randf_range(-3, 3), randf_range(-3, 3), randf_range(-3, 3))
	sys.track(b)
	return b


func apply_named(kind: String, point: Vector3, speed: float, dir := Vector3(0, 0, -1)) -> Dictionary:
	var imp := GlassImpact.from_preset(kind, speed)
	imp.point = point
	imp.velocity = dir.normalized() * speed
	var p := main_pane()
	return p.impact(imp) if p else {}


# ------------------------------------------------------------------ interactive

func _interactive_setup() -> void:
	var cl := CanvasLayer.new()
	add_child(cl)
	hud = Label.new()
	hud.position = Vector2(10, 10)
	hud.add_theme_font_size_override("font_size", 15)
	hud.add_theme_color_override("font_outline_color", Color.BLACK)
	hud.add_theme_constant_override("outline_size", 4)
	cl.add_child(hud)
	_spawn_window(PANES[pane_i])
	add_child(GlassAudioAdapter.new())   # plays through BottleAudio if one is in the tree, else silent
	_hud()
	if "--selftest" in OS.get_cmdline_user_args():
		await _selftest()


func _selftest() -> void:
	await get_tree().create_timer(0.3).timeout
	var vs := get_viewport().get_visible_rect().size
	_shoot_mouse(vs * Vector2(0.45, 0.42))
	await get_tree().create_timer(0.2).timeout
	_throw_mouse(vs * Vector2(0.55, 0.55))
	await get_tree().create_timer(1.2).timeout
	_hud()
	await RenderingServer.frame_post_draw
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://out"))
	get_viewport().get_texture().get_image().save_png(ProjectSettings.globalize_path("res://out/interactive_selftest.png"))
	print("SELFTEST done")
	get_tree().quit()


func _hud() -> void:
	if hud == null:
		return
	var c: Array = CALIBERS[cal_i]
	var p := main_pane()
	var s := "Pane [1-0]: %s  %s mm [T]   tier [G]: %s   slow-mo [M]: %s\n" % [PANES[pane_i],
		str(p.get_profile().thickness_mm) if p else "-", GlassSystem.TIER_NAMES[sys.tier], "on" if slow else "off"]
	s += "LMB shoot [C]: %s %.0f J   RMB throw [B]: %s at %.1f m/s [+/-]   R repair  N other side\n" % [c[0], c[2], THROWABLES[throw_i], throw_speed]
	var d: Dictionary = GlassImpact.STRIKERS[THROWABLES[throw_i]]
	var m := float(d["mass"])
	s += "throwable: m %.2f kg  E %.1f J  p %.2f Ns\n" % [m, 0.5 * m * throw_speed * throw_speed, m * throw_speed]
	if p:
		var th := GlassDamageModel.thresholds(p.get_profile(), p._context(Vector2.ZERO), GlassImpact.from_preset(THROWABLES[throw_i]))
		s += "pane: damage %.0f %%  centre thresholds for this throwable: crack %.1f J  break %.1f J  shatter %.1f J\n" % [
			p.damage_percent(), th["crack"], th["break"], th["shatter"]]
		var li := p.last_info
		if not li.is_empty():
			s += "last hit: %s  E %.1f J (normal %.1f)  p %.3f Ns  pierced %s  residual %.1f m/s  tier %s  cracks %.2f m\n" % [
				li.get("outcome_name", "?"), li.get("energy", 0.0), li.get("energy_n", 0.0), li.get("momentum", 0.0),
				str(li.get("pass_through", false)), (li.get("residual_velocity", Vector3.ZERO) as Vector3).length(),
				GlassSystem.TIER_NAMES[int(li.get("tier", 0))], li.get("crack_length", 0.0)]
	s += "shards %d (queued %d)  masks %.1f MB  granules %d" % [sys.live_shards(), sys.queued_shards(), sys.mask_megabytes(), sys.stats["granules"]]
	hud.text = s


func _shoot_mouse(mp: Vector2) -> void:
	var from := cam.project_ray_origin(mp)
	var dir := cam.project_ray_normal(mp)
	shoot(from, from + dir * 50.0, CALIBERS[cal_i])
	_hud()


func _throw_mouse(mp: Vector2) -> void:
	var from := cam.project_ray_origin(mp)
	var dir := cam.project_ray_normal(mp)
	var p := main_pane()
	var target := from + dir * 3.0
	if p:
		var plane := Plane(p.global_transform.basis.z, p.global_position)
		var hit: Variant = plane.intersects_ray(from, dir)
		if hit != null:
			target = hit
	throw_body(THROWABLES[throw_i], from + dir * 0.4 + Vector3(0, -0.15, 0), target, throw_speed)
	await get_tree().create_timer(0.5).timeout
	_hud()


func _unhandled_input(ev: InputEvent) -> void:
	if hud == null:
		return
	var mb := ev as InputEventMouseButton
	if mb and mb.pressed:
		if mb.button_index == MOUSE_BUTTON_LEFT:
			_shoot_mouse(mb.position)
		elif mb.button_index == MOUSE_BUTTON_RIGHT:
			_throw_mouse(mb.position)
		return
	var kb := ev as InputEventKey
	if kb == null or not kb.pressed:
		return
	var k := kb.keycode
	if k >= KEY_0 and k <= KEY_9:
		pane_i = (k - KEY_1) if k != KEY_0 else 9
		thick_i = -1
		_spawn_window(PANES[pane_i])
	match k:
		KEY_T:
			thick_i = (thick_i + 1) % THICK.size()
			_spawn_window(PANES[pane_i], THICK[thick_i])
		KEY_C:
			cal_i = (cal_i + 1) % CALIBERS.size()
		KEY_B:
			throw_i = (throw_i + 1) % THROWABLES.size()
		KEY_EQUAL, KEY_KP_ADD:
			throw_speed = minf(throw_speed + 1.0, 40.0)
		KEY_MINUS, KEY_KP_SUBTRACT:
			throw_speed = maxf(throw_speed - 1.0, 1.0)
		KEY_G:
			sys.tier = ((int(sys.tier) + 1) % 4) as GlassSystem.Tier
		KEY_M:
			slow = not slow
			Engine.time_scale = 0.15 if slow else 1.0
		KEY_R:
			for p in panes():
				(p as GlassPane).repair()
			sys.clear_all()
		KEY_N:
			backside = not backside
			_view(Vector3(0.2, 1.35, -1.9 if backside else 1.9))
		KEY_ESCAPE:
			get_tree().quit()
	_hud()


# ------------------------------------------------------------------ shots

func _snap(dir: String, nm: String, frames := 3) -> String:
	for i in frames:
		await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	var path := "%s/%s.png" % [dir, nm]
	img.save_png(path)
	return path


func _wait(t: float) -> void:
	var end := Time.get_ticks_msec() + int(t * 1000.0)
	while Time.get_ticks_msec() < end:
		await get_tree().physics_frame


func _wait_frames(n: int) -> void:
	for i in n:
		await get_tree().physics_frame


func _shots(dir: String, args: Array) -> void:
	DirAccess.make_dir_recursive_absolute(dir)
	sys.auto_lod = false
	var only := ""
	if "--only" in args:
		only = args[args.find("--only") + 1]
	var shots: Array[String] = []
	var labels: Array[String] = []
	var c9: Array = CALIBERS[0]
	for ty in ["annealed", "tempered", "laminated", "igu", "wired", "resistant"]:
		if only != "" and only != ty:
			continue
		# 1 + 2: single 9 mm, close-up front and exit side
		_spawn_window(ty)
		await _wait_frames(3)
		var tgt := Vector3(0.05, 1.33, 0)
		shoot(Vector3(0.6, 1.5, 4.0), tgt, c9)
		_view(Vector3(0.05, 1.33, 0.75), tgt)
		await _wait_frames(10)
		shots.append(await _snap(dir, ty + "_1_bullet_front")); labels.append(ty + " 9mm entry side")
		_view(Vector3(0.0, 1.33, -0.75), tgt)
		shots.append(await _snap(dir, ty + "_2_bullet_back")); labels.append(ty + " 9mm exit side")
		# 3: five rounds
		_spawn_window(ty)
		await _wait_frames(3)
		_view(Vector3(0, 1.3, 1.9))
		var rng := RandomNumberGenerator.new()
		rng.seed = 3
		var sz: Vector2 = main_pane().size
		for i in 5:
			var cal: Array = CALIBERS[[0, 1, 0, 4, 2][i]]
			shoot(Vector3(rng.randf_range(-1, 1), 1.5, 5.0), Vector3(rng.randf_range(-0.35, 0.35) * sz.x, 1.3 + rng.randf_range(-0.35, 0.35) * sz.y, 0), cal)
			await _wait_frames(3)
		await _wait_frames(36)
		shots.append(await _snap(dir, ty + "_3_bullets")); labels.append(ty + " 5 rounds")
		# 4 + 5: brick thrown through
		_spawn_window(ty)
		await _wait_frames(3)
		_view(Vector3(1.5, 1.4, 1.6), Vector3(0, 1.2, -0.3))
		sys.stats["predicted_hits"] = 0
		throw_body("brick", Vector3(0.3, 1.6, 3.0), Vector3(0.05, 1.25, 0), 14.0)
		var n := 0
		while sys.stats["predicted_hits"] == 0 and n < 90:
			await get_tree().physics_frame
			n += 1
		await _wait_frames(6)
		shots.append(await _snap(dir, ty + "_4_brick_0.1s")); labels.append(ty + " brick 14 m/s +0.1 s")
		await _wait_frames(96)
		_view(Vector3(0.4, 1.4, 2.0), Vector3(0, 1.1, 0))
		shots.append(await _snap(dir, ty + "_5_brick_1.7s")); labels.append(ty + " brick +1.7 s")
		# 6: hammer + shoulder
		_spawn_window(ty)
		await _wait_frames(3)
		_view(Vector3(0, 1.3, 1.5))
		apply_named("hammer", Vector3(-0.2, 1.5, 0), 4.0)
		apply_named("body", Vector3(0.1, 1.15, 0), 3.0)
		await _wait_frames(30)
		shots.append(await _snap(dir, ty + "_6_hammer_body")); labels.append(ty + " hammer 4 m/s + body 3 m/s")
	# tier comparison: annealed, 3 rounds + brick
	if only == "" or only == "tiers":
		for t in 4:
			sys.tier = t as GlassSystem.Tier
			sys.use_refraction = t == 0     # also compiles the screen-refraction shader variant
			_spawn_window("annealed")
			await _wait_frames(3)
			_view(Vector3(0.6, 1.35, 1.9), Vector3(0, 1.2, 0))
			shoot(Vector3(0, 1.5, 5), Vector3(-0.3, 1.6, 0), c9)
			shoot(Vector3(0, 1.5, 5), Vector3(0.3, 1.7, 0), c9)
			shoot(Vector3(0, 1.5, 5), Vector3(0.25, 0.9, 0), CALIBERS[1])
			throw_body("brick", Vector3(-0.2, 1.4, 3.0), Vector3(-0.1, 1.15, 0), 9.0)
			await _wait_frames(27)
			shots.append(await _snap(dir, "tier_%s" % GlassSystem.TIER_NAMES[t])); labels.append("tier " + GlassSystem.TIER_NAMES[t])
		sys.tier = GlassSystem.Tier.HIGH
	var sheet_name := "glass_sheet.png" if only == "" else "glass_sheet_%s.png" % only
	_sheet(shots, labels, dir.get_base_dir().path_join(sheet_name))
	print("SHOTS: %d images" % shots.size())


func _sheet(paths: Array[String], labels: Array[String], out: String) -> void:
	var cols := 6
	var tw := 384
	var th := 216
	var rows := int(ceil(paths.size() / float(cols)))
	var sheet := Image.create(cols * tw, maxi(rows, 1) * th, false, Image.FORMAT_RGB8)
	sheet.fill(Color(0.1, 0.1, 0.1))
	for i in paths.size():
		var im := Image.load_from_file(paths[i])
		if im == null:
			continue
		im.convert(Image.FORMAT_RGB8)
		im.resize(tw, th, Image.INTERPOLATE_LANCZOS)
		sheet.blit_rect(im, Rect2i(0, 0, tw, th), Vector2i((i % cols) * tw, (i / cols) * th))
	sheet.save_png(out)
	var f := FileAccess.open(out.get_basename() + ".txt", FileAccess.WRITE)
	for i in labels.size():
		f.store_line("%d (row %d col %d): %s" % [i, i / cols + 1, i % cols + 1, labels[i]])
	print("SHEET: ", out)


# ------------------------------------------------------------------ calibration

func _crit_speed(p: GlassProfile, kind: String, min_out: int, ctx: Dictionary, pass_needed := false) -> float:
	var lo := 0.0
	var hi := 150.0
	if not _fails(p, kind, hi, min_out, ctx, pass_needed):
		return INF
	for i in 40:
		var mid := 0.5 * (lo + hi)
		if _fails(p, kind, mid, min_out, ctx, pass_needed):
			hi = mid
		else:
			lo = mid
	return hi


func _fails(p: GlassProfile, kind: String, v: float, min_out: int, ctx: Dictionary, pass_needed: bool) -> bool:
	var r := GlassDamageModel.assess(p, ctx, GlassImpact.from_preset(kind, v))
	return bool(r["pass_through"]) if pass_needed else int(r["outcome"]) >= min_out


func _ctx() -> Dictionary:
	return {"d_edge": 0.5, "span": 0.5, "damage": 0.0, "near": 0.0, "flaw": 1.0, "normal": Vector3.BACK, "size_min": 1.0}


func _calibrate(dir: String) -> void:
	DirAccess.make_dir_recursive_absolute(dir)
	var O := GlassDamageModel.Outcome
	var report := {"table": [], "bullets": [], "asserts": [], "trials": {}, "recompute": {}, "tiers": {}}
	var ctx := _ctx()
	var strikers := ["stone", "brick", "bottle", "hammer", "chair", "fist", "body", "punch_tool"]
	print("\nBREAK TABLE: critical speed m/s (energy J) for crack / pass-through, centre of a 1.0 x 1.2 m pane")
	print("%-10s %5s %-11s %18s %18s" % ["type", "mm", "striker", "crack", "pass through"])
	for ty in ["annealed", "tempered", "laminated", "wired", "resistant"]:
		var ths: Array = [20.0, 30.0, 40.0] if ty == "resistant" else THICK
		for mm in ths:
			var p := GlassProfile.preset(ty, mm)
			for s in strikers:
				var m := float(GlassImpact.STRIKERS[s]["mass"])
				var vc := _crit_speed(p, s, O.CRACKED, ctx)
				var vp := _crit_speed(p, s, O.PUNCHED, ctx, true)
				report["table"].append({"type": ty, "mm": mm, "striker": s, "mass": m, "v_crack": _j(vc), "e_crack": _j(0.5 * m * vc * vc),
					"v_through": _j(vp), "e_through": _j(0.5 * m * vp * vp)})
				print("%-10s %5.0f %-11s %8s (%7s) %8s (%7s)" % [ty, mm, s, _f(vc), _f(0.5 * m * vc * vc), _f(vp), _f(0.5 * m * vp * vp)])
	print("\nBULLETS (default thickness, centre, normal incidence)")
	for ty in ["annealed", "tempered", "laminated", "wired", "resistant"]:
		var p := GlassProfile.preset(ty)
		for b in ["bb", "pellet", "22lr", "9mm", "9mm_hp", "45acp", "556", "762"]:
			var r := GlassDamageModel.assess(p, ctx, GlassImpact.from_preset(b))
			var row := {"type": ty, "mm": p.thickness_mm, "bullet": b, "energy": r["energy"], "outcome": GlassDamageModel.outcome_name(r["outcome"]),
				"kind": String(r["kind"]), "residual_speed": (r["residual_velocity"] as Vector3).length(), "hole_mm": float(r["hole_radius"]) * 2000.0,
				"exit_crater_mm": float(r["crater_exit"]) * 2000.0, "crack_m": r["crack_length"], "perf_J": r["thresholds"]["perf"]}
			report["bullets"].append(row)
			print("%-10s %4.0fmm %-7s %7.0f J -> %-9s %-8s resid %6.1f m/s hole %4.1f mm exit crater %5.1f mm cracks %.2f m" % [ty, p.thickness_mm, b,
				row["energy"], row["outcome"], row["kind"], row["residual_speed"], row["hole_mm"], row["exit_crater_mm"], row["crack_m"]])
	print("\nASSERTIONS")
	var A: Array = report["asserts"]
	var ann := GlassProfile.preset("annealed", 4.0)
	_assert(A, GlassDamageModel.assess(ann, ctx, GlassImpact.from_preset("stone", 1.0))["outcome"] == O.NONE, "4 mm annealed: 0.2 kg stone at 1 m/s does nothing")
	_assert(A, GlassDamageModel.assess(ann, ctx, GlassImpact.from_preset("stone", 8.0))["outcome"] >= O.PUNCHED, "4 mm annealed: stone at 8 m/s breaks through")
	var h9 := GlassDamageModel.assess(ann, ctx, GlassImpact.from_preset("9mm"))
	_assert(A, h9["outcome"] == O.PUNCHED and float(h9["hole_radius"]) < 0.008 and float(h9["crack_length"]) > 0.03,
		"9mm pierces 4 mm annealed: small hole + radial cracks")
	for mm in [4.0, 6.0, 10.0]:
		for b in ["22lr", "9mm", "556"]:
			var r := GlassDamageModel.assess(GlassProfile.preset("tempered", mm), ctx, GlassImpact.from_preset(b))
			_assert(A, r["outcome"] == O.SHATTERED and r["kind"] == &"dice", "tempered %d mm dices fully from %s" % [int(mm), b])
	for b in ["22lr", "9mm", "45acp", "556", "762"]:
		var r := GlassDamageModel.assess(GlassProfile.preset("laminated"), ctx, GlassImpact.from_preset(b))
		_assert(A, float(r["drop_radius"]) == 0.0 and r["outcome"] != O.SHATTERED, "laminated never drops pieces from one %s" % b)
	var loc := 0.0
	var stopped := 0
	for i in 12:
		var c2 := ctx.duplicate()
		c2["local_damage"] = clampf(loc, 0.0, 1.0)
		var r := GlassDamageModel.assess(GlassProfile.preset("resistant"), c2, GlassImpact.from_preset("9mm"))
		if r["pass_through"]:
			break
		stopped += 1
		loc += float(r["d_local"])
	_assert(A, stopped >= 4 and stopped <= 8, "30 mm resistant stops %d rounds of 9mm in one spot (4..8)" % stopped)
	_assert(A, GlassDamageModel.assess(GlassProfile.preset("resistant"), ctx, GlassImpact.from_preset("762"))["pass_through"], "7.62 rifle defeats 30 mm pistol-rated glass")
	_assert(A, GlassDamageModel.assess(GlassProfile.preset("laminated"), ctx, GlassImpact.from_preset("brick", 8.0))["outcome"] == O.CRACKED, "windscreen holds a brick at 8 m/s (cobweb)")
	var tem := GlassProfile.preset("tempered", 4.0)
	var c_edge := ctx.duplicate()
	c_edge["d_edge"] = 0.005
	var e_edge: float = GlassDamageModel.thresholds(tem, c_edge, GlassImpact.from_preset("stone"))["crack"]
	var e_mid: float = GlassDamageModel.thresholds(tem, ctx, GlassImpact.from_preset("stone"))["crack"]
	_assert(A, e_edge < 0.4 * e_mid, "tempered edge hit needs < 40 %% of the centre energy (%.1f vs %.1f J)" % [e_edge, e_mid])
	var g22 := GlassImpact.from_preset("22lr")
	g22.velocity = Vector3(1, 0, -0.12).normalized() * 370.0
	_assert(A, GlassDamageModel.assess(GlassProfile.preset("annealed", 10.0), ctx, g22)["ricochet"], "grazing .22 ricochets off 10 mm annealed")
	# scene: 3 rounds weaken an annealed pane, save / load replays it
	_spawn_window("annealed")
	await _wait_frames(2)
	var p0 := main_pane()
	var thr0: float = GlassDamageModel.thresholds(p0.get_profile(), p0._context(Vector2.ZERO), GlassImpact.from_preset("stone"))["crack"]
	for i in 3:
		shoot(Vector3(0, 1.3, 4), Vector3(-0.2 + i * 0.2, 1.45, 0), CALIBERS[0])
	var thr1: float = GlassDamageModel.thresholds(p0.get_profile(), p0._context(Vector2.ZERO), GlassImpact.from_preset("stone"))["crack"]
	_assert(A, thr1 < thr0 * 0.8, "3 bullet holes weaken the pane (centre crack threshold %.2f -> %.2f J)" % [thr0, thr1])
	var st := p0.get_damage_state()
	var d_before := p0.damage
	var holes := p0.holes_a.size()
	p0.repair()
	_assert(A, p0.damage == 0.0 and p0.holes_a.size() == 0, "repair() resets the pane")
	p0.set_damage_state(JSON.parse_string(JSON.stringify(st)))
	_assert(A, p0.holes_a.size() == holes and absf(p0.damage - d_before) < 1e-4, "save/load (JSON) replays %d impacts exactly" % st["impacts"].size())
	# idle cost: 40 casement windows (80 panes) after setup
	var farm := Node3D.new()
	add_child(farm)
	for i in 40:
		var w := GlassPrefabs.house_window("casement")
		w.position = Vector3(30 + (i % 10) * 2.0, 1.3, 30 + (i / 10) * 2.0)
		farm.add_child(w)
	await _wait_frames(3)
	var idle := 0
	var total := 0
	for n in farm.find_children("*", "GlassPane", true, false):
		total += 1
		if n.is_processing() or n.is_physics_processing():
			idle += 1
	_assert(A, idle == 0, "idle panes run no _process/_physics_process (%d of %d)" % [idle, total])
	report["idle_processing_panes"] = idle
	farm.queue_free()
	await _recompute_test(report)
	await _trials(report)
	await _tier_bench(report)
	var fails := 0
	for a in A:
		if not a["ok"]:
			fails += 1
	report["assert_failures"] = fails
	report["assert_count"] = A.size()
	var f := FileAccess.open(dir.path_join("glass_calibration_report.json"), FileAccess.WRITE)
	f.store_string(JSON.stringify(report, "  "))
	f.close()
	print("\nCALIBRATION: %d assertions, %d failed -> %s" % [A.size(), fails, dir.path_join("glass_calibration_report.json")])


func _j(x: float) -> Variant:
	return "inf" if is_inf(x) else snappedf(x, 0.01)


func _f(x: float) -> String:
	return "inf" if is_inf(x) else ("%.1f" % x if x < 100.0 else "%.0f" % x)


func _assert(A: Array, ok: bool, what: String) -> void:
	A.append({"ok": ok, "what": what})
	print(("  ok   " if ok else "  FAIL ") + what)


## Recomputes: free flight (expect 1) and a bouncing ball (expect ~1 per bounce).
func _recompute_test(report: Dictionary) -> void:
	var b := throw_body("sphere", Vector3(100, 20, 0), Vector3(110, 25, 0), 12.0)
	var pr := sys.predictor_for(b)
	await _wait_frames(60)
	var free_n := pr.recomputes
	var free_ext := pr.extensions
	b.queue_free()
	# bouncy test pad (restitution ~0.9) so every bounce stays above the 2 m/s prediction threshold
	var pad := StaticBody3D.new()
	var pm := PhysicsMaterial.new()
	pm.bounce = 0.9
	pad.physics_material_override = pm
	var pcs := CollisionShape3D.new()
	var pbs := BoxShape3D.new()
	pbs.size = Vector3(6, 0.2, 6)
	pcs.shape = pbs
	pad.add_child(pcs)
	pad.position = Vector3(60, 0.1, 10)
	add_child(pad)
	await get_tree().physics_frame
	var ball := throw_body("sphere", Vector3(60, 4, 10), Vector3(60.6, 0.25, 10), 4.0)
	ball.physics_material_override = pm
	var pr2 := sys.predictor_for(ball)
	var bounces := 0
	var fast_bounces := 0
	var vy_prev := 0.0
	for i in 240:
		await get_tree().physics_frame
		var vy := ball.linear_velocity.y
		if vy_prev < -0.5 and vy > 0.2:
			bounces += 1
			if ball.linear_velocity.length() >= sys.predict_min_speed:
				fast_bounces += 1
		vy_prev = vy
	report["recompute"] = {"free_flight_1s_recomputes": free_n, "free_flight_1s_extensions": free_ext, "bounces": bounces,
		"bounces_above_min_speed": fast_bounces, "bounce_recomputes": pr2.recomputes,
		"note": "first recompute = the throw; predictor idles below predict_min_speed (2 m/s)"}
	print("\nRECOMPUTE: free flight 1 s -> %d recompute(s), %d extension(s); bouncing ball: %d bounces (%d above 2 m/s) -> %d recomputes" % [
		free_n, free_ext, bounces, fast_bounces, pr2.recomputes])
	_assert(report["asserts"], free_n == 1, "free-flying body: exactly 1 path computation in 1 s")
	_assert(report["asserts"], pr2.recomputes >= fast_bounces and pr2.recomputes <= fast_bounces + 1 + (bounces - fast_bounces) * 2,
		"bouncing body: 1 recompute per bounce + the throw (%d for %d bounces, %d of them fast)" % [pr2.recomputes, bounces, fast_bounces])
	ball.queue_free()
	pad.queue_free()
	sys.untrack(ball)


## Randomised crossing trials: bullets (ray) and thrown bodies (predicted sweep), normal and grazing.
func _trials(report: Dictionary) -> void:
	sys.tier = GlassSystem.Tier.MINIMAL
	sys.auto_lod = false
	var rng := RandomNumberGenerator.new()
	rng.seed = 99
	var N := 1000
	var results := {}
	print("\nCROSSING TRIALS (%d each, annealed 4 mm 1.0 x 1.2 m, tier minimal)" % N)
	for graze in [false, true]:
		var key: String = "bullet_7g_350ms_" + ("grazing" if graze else "normal")
		var st := {"trials": 0, "hit": 0, "miss": 0, "tunnel": 0, "pierced": 0, "ricochet": 0, "stopped": 0, "max_err_mm": 0.0}
		var batch := 50
		for bi in N / batch:
			var root := Node3D.new()
			add_child(root)
			var pl: Array[GlassPane] = []
			for i in batch:
				var p := GlassPane.new()
				p.size = Vector2(1.0, 1.2)
				p.glass_type = "annealed"
				p.thickness_mm = 4.0
				p.auto_track_bodies = false
				p.pane_seed = bi * batch + i + 1
				p.position = Vector3(500 + i * 10.0, 50, 0)
				root.add_child(p)
				pl.append(p)
			await get_tree().physics_frame
			for i in batch:
				var p := pl[i]
				var tgt := p.global_position + Vector3(rng.randf_range(-0.45, 0.45), rng.randf_range(-0.55, 0.55), 0)
				var deg := rng.randf_range(76.0, 82.0) if graze else rng.randf_range(0.0, 20.0)
				var ang := deg_to_rad(deg) * (1.0 if rng.randf() < 0.5 else -1.0)
				var dir := Vector3(sin(ang), 0, -cos(ang))
				var r := sys.fire_bullet(tgt - dir * 4.0, dir, 0.5 * 0.007 * 350.0 * 350.0, 0.009, 0xFFFFFFFF, -1.0, 8.0)
				st["trials"] += 1
				var hits: Array = r["hits"]
				if hits.is_empty() or hits[0]["pane"] != p:
					st["tunnel"] += 1
					continue
				var err := (hits[0]["point"] as Vector3).distance_to(tgt) * 1000.0
				st["max_err_mm"] = maxf(float(st["max_err_mm"]), err)
				if err > 20.0:
					st["miss"] += 1
				else:
					st["hit"] += 1
				var res: Dictionary = hits[0]["result"]
				if res.get("ricochet", false):
					st["ricochet"] += 1
				elif res.get("pass_through", false):
					st["pierced"] += 1
				else:
					st["stopped"] += 1
			root.queue_free()
			await get_tree().physics_frame
		results[key] = st
		print("  %s: %s" % [key, st])
	for kind in [["brick", 15.0], ["bottle", 25.0]]:
		for graze in [false, true]:
			var key := "%s_%dms_%s" % [kind[0], int(kind[1]), "grazing" if graze else "normal"]
			var st := {"trials": 0, "hit": 0, "miss": 0, "tunnel": 0, "passed": 0, "held": 0, "max_err_mm": 0.0, "recomputes": 0}
			var batch := 100
			for bi in N / batch:
				var root := Node3D.new()
				add_child(root)
				var pl: Array[GlassPane] = []
				var bodies: Array[RigidBody3D] = []
				var tg: Array[Vector3] = []
				var hit_of := {}
				for i in batch:
					var p := GlassPane.new()
					p.size = Vector2(1.0, 1.2)
					p.glass_type = "annealed"
					p.thickness_mm = 4.0
					p.auto_track_bodies = false
					p.position = Vector3(-500 - i * 8.0, 50, 0)
					p.pane_seed = bi * batch + i + 1
					root.add_child(p)
					pl.append(p)
					p.impact_assessed.connect(func(pane: GlassPane, info: Dictionary) -> void:
						if not hit_of.has(pane):
							hit_of[pane] = info)
				await get_tree().physics_frame
				for i in batch:
					var p := pl[i]
					var mg := 0.12
					var tgt := p.global_position + Vector3(rng.randf_range(-0.5 + mg, 0.5 - mg), rng.randf_range(-0.6 + mg, 0.6 - mg), 0)
					var deg := rng.randf_range(60.0, 70.0) if graze else rng.randf_range(0.0, 15.0)
					var ang := deg_to_rad(deg) * (1.0 if rng.randf() < 0.5 else -1.0)
					var dir := Vector3(sin(ang), rng.randf_range(-0.1, 0.1), -cos(ang)).normalized()
					var from := tgt - dir * rng.randf_range(1.2, 2.5)
					bodies.append(throw_body(kind[0], from, tgt, kind[1], root))
					tg.append(tgt)
				await _wait_frames(45)
				for i in batch:
					var p := pl[i]
					var b := bodies[i]
					st["trials"] += 1
					var pr := sys.predictor_for(b)
					st["recomputes"] += pr.recomputes if pr else 0
					var crossed := p.to_local(b.global_position).z < -0.05
					if not hit_of.has(p):
						st["tunnel" if crossed else "miss"] += 1
						continue
					var info: Dictionary = hit_of[p]
					var pt: Vector3 = info["point"]
					var err := Vector2(pt.x - tg[i].x, pt.y - tg[i].y).length() * 1000.0
					# the body's surface reaches the plane before its centre: allow bounding radius * tan(incidence)
					var cosi := clampf(absf(float(info["cos"])), 0.2, 1.0)
					var allow := GlassPathPredictor.body_radius(b) * sqrt(1.0 - cosi * cosi) / cosi * 1000.0 + 40.0
					st["max_err_mm"] = maxf(float(st["max_err_mm"]), err)
					st["hit" if err <= allow else "miss"] += 1
					if info.get("pass_through", false):
						st["passed"] += 1
					else:
						st["held"] += 1
				for b in bodies:
					sys.untrack(b)
				root.queue_free()
				await get_tree().physics_frame
			results[key] = st
			print("  %s: %s" % [key, st])
	report["trials"] = results
	var tun := 0
	var miss := 0
	for k in results:
		tun += int(results[k]["tunnel"])
		miss += int(results[k]["miss"])
	_assert(report["asserts"], tun == 0, "no tunnelling in %d randomised crossings (tunnel %d, miss %d)" % [N * 6, tun, miss])
	sys.tier = GlassSystem.Tier.HIGH


## Per-tier cost: one bullet, ten bullets, brick through annealed, tempered dice.
func _tier_bench(report: Dictionary) -> void:
	sys.auto_lod = false
	print("\nTIER BENCH (impact = synchronous cost of the hit; build/frame = worst shard-build slice afterwards)")
	for t in 4:
		sys.tier = t as GlassSystem.Tier
		var row := {}
		for case in ["bullet", "bullet_x10", "brick_annealed", "tempered_dice"]:
			var ty := "tempered" if case == "tempered_dice" else "annealed"
			_spawn_window(ty, 5.0 if ty == "tempered" else 4.0)
			sys.stats["build_ms_max"] = 0.0
			sys.stats["granules"] = 0
			await _wait_frames(2)
			var p := main_pane()
			var c := p.global_position
			var t0 := Time.get_ticks_usec()
			match case:
				"bullet":
					p.hit_by_projectile(c + Vector3(0.1, 0.1, 0), Vector3(0, 0, -1), 518.0, 0.009)
				"bullet_x10":
					for i in 10:
						p.hit_by_projectile(c + Vector3(-0.4 + i * 0.08, 0.3 - i * 0.05, 0), Vector3(0, 0, -1), 518.0, 0.009)
				"brick_annealed":
					apply_named("brick", c, 10.0)
				"tempered_dice":
					apply_named("hammer", c + Vector3(0.36, 0, 0), 9.0)
			var ms := (Time.get_ticks_usec() - t0) / 1000.0
			var frame_max := 0.0
			for f in 45:
				var a := Time.get_ticks_usec()
				await get_tree().physics_frame
				frame_max = maxf(frame_max, (Time.get_ticks_usec() - a) / 1000.0)
			var shards := sys.live_shards()
			row[case] = {"impact_ms": snappedf(ms, 0.01), "shards": shards, "granules": sys.stats["granules"], "mask_mb": snappedf(sys.mask_megabytes(), 0.01),
				"build_ms_max_per_frame": snappedf(float(sys.stats["build_ms_max"]), 0.01), "frame_ms_max_after": snappedf(frame_max, 0.1),
				"mesh_instances": _count_meshes(window), "outcome": p.last_info.get("outcome_name", "")}
			print("  %-8s %-15s impact %6.2f ms  shards %3d  granules %4d  mask %5.2f MB  build/frame %5.2f ms  frame max %5.1f ms  (%s)" % [
				GlassSystem.TIER_NAMES[t], case, ms, shards, sys.stats["granules"], sys.mask_megabytes(), float(sys.stats["build_ms_max"]), frame_max,
				row[case]["outcome"]])
		report["tiers"][GlassSystem.TIER_NAMES[t]] = row
	sys.tier = GlassSystem.Tier.HIGH


func _count_meshes(n: Node) -> int:
	var c := 1 if (n is MeshInstance3D and (n as MeshInstance3D).visible and (n as MeshInstance3D).mesh) else 0
	for k in n.get_children():
		c += _count_meshes(k)
	return c
