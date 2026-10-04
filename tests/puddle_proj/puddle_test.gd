extends Node3D
## Puddle surface-clipping tests.
##   godot --headless --path tests/puddle_proj res://puddle_test.tscn            numeric checks (exit code = fails)
##   godot --path tests/puddle_proj res://puddle_test.tscn -- --shots <dir>     4 screenshots

const TABLE_SIZE := Vector3(1.6, 0.72, 0.9)
const TABLE_POS := Vector3(0, 0.36, 0)
const TOP := 0.72
const SHELF_SIZE := Vector3(1.2, 0.04, 0.4)
const SHELF_POS := Vector3(-1.8, 1.0, -0.3)
const COL := Color(0.55, 0.12, 0.05)

var cam: Camera3D
var mgr: BottleBreakManager
var fails := 0


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	_env()
	await _frames(2)
	mgr = BottleBreakManager.get_for(self)
	var si := args.find("--shots")
	if si >= 0:
		await _shots(args[si + 1])
	else:
		await _numeric()
	print("PUDDLE TEST ", "PASS" if fails == 0 else "FAIL (%d)" % fails)
	get_tree().quit(fails)


func _check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


func _frames(n: int) -> void:
	for i in n:
		await get_tree().physics_frame


func _numeric() -> void:
	print("renderer decals supported: ", mgr.decals_supported())
	for t in 4:
		mgr.set_quality(t)
		mgr.clear_debris()
		await _frames(3)
		var tn: String = BottleBreakManager.TIERS[t]["name"]
		print("== ", tn)
		var r0 := mgr.puddle_rays
		mgr.add_puddle(Vector3(0.72, TOP, 0.0), Vector3.UP, 300.0, COL)        # 8 cm from the +X edge
		var r_edge := mgr.puddle_rays - r0
		mgr.add_puddle(Vector3(-0.3, TOP, 0.0), Vector3.UP, 100.0, COL)        # middle of the table
		var decal: bool = t == 0 and mgr.decals_supported()
		if not decal:
			_check_clip(tn, r_edge)
		mgr.add_puddle(Vector3(-2.5, 0.0, 2.0), Vector3.UP, 200.0, COL)        # floor
		var n_expect := mini(3, mgr.max_puddles)
		_check(mgr._puddles.size() == n_expect, "%s %d puddles (limit %d)" % [tn, mgr._puddles.size(), mgr.max_puddles])
		if decal:
			var dn := 0
			for c in mgr.get_children():
				if c is Decal:
					dn += 1
			_check(dn == 3, "HIGH decal count %d == 3" % dn)
			var exp_pos := [Vector3(0.72, TOP, 0.0), Vector3(-0.3, TOP, 0.0), Vector3(-2.5, 0.0, 2.0)]
			for i in 3:
				var d: Decal = mgr._puddles[i]["node"]
				_check(d.global_position.distance_to(exp_pos[i]) < 1e-4, "HIGH decal %d at %s" % [i, d.global_position])
			_check(mgr.puddle_rays - r0 == 0, "HIGH decals cast no rays (%d)" % (mgr.puddle_rays - r0))
		else:
			_check(int(mgr._puddles[-1]["rays"]) == 1, "%s floor puddle 1 ray" % tn)
		# no per-frame rays: run 1 s, then grow the middle puddle (one re-clip)
		var before := mgr.puddle_rays
		await _frames(60)
		_check(mgr.puddle_rays == before, "%s no rays during 60 idle-puddle frames (%d -> %d)" % [tn, before, mgr.puddle_rays])
		if not decal:
			mgr.add_puddle(Vector3(-0.3, TOP, 0.0), Vector3.UP, 400.0, COL)    # merges, grows past the clip area
			await _frames(5)
			_check(mgr.puddle_rays - before == 1, "%s growth re-clip cost %d ray" % [tn, mgr.puddle_rays - before])
		# per-tier limit with recycling of the oldest
		var maxseen := 0
		for k in mgr.max_puddles + 4:
			mgr.add_puddle(Vector3(-4.0 + k * 0.6, 0.0, -3.0 + (k % 2) * 1.5), Vector3.UP, 40.0, COL)
			maxseen = maxi(maxseen, mgr._puddles.size())
		await _frames(2)
		var live := 0
		for c in mgr.get_children():
			if (c is Decal or (c is MeshInstance3D and c.mesh is ArrayMesh)) and not c.is_queued_for_deletion():
				live += 1
		_check(maxseen <= mgr.max_puddles and live <= mgr.max_puddles, "%s puddle count %d / nodes %d <= limit %d" % [tn, maxseen, live, mgr.max_puddles])
	await _numeric_tail()


func _check_clip(tn: String, r_edge: int) -> void:
		if true:
			# edge puddle: clipped exactly to the table top
			var pe: Dictionary = mgr._puddles[0]
			var rc: float = pe["rc"]
			var maxx := -INF
			var inside := true
			for w in _poly_world(pe):
				maxx = maxf(maxx, w.x)
				if absf(w.x) > TABLE_SIZE.x * 0.5 + 1e-4 or absf(w.z) > TABLE_SIZE.z * 0.5 + 1e-4:
					inside = false
			_check(0.72 + rc > 0.8, "%s edge puddle would overhang unclipped (0.72 + %.3f > 0.8)" % [tn, rc])
			_check(inside, "%s edge puddle: no vertex outside the table top" % tn)
			_check(absf(maxx - 0.8) < 1e-4, "%s edge puddle clipped at the edge (max x %.4f)" % [tn, maxx])
			_check(r_edge == 1, "%s edge puddle used %d ray (box collider)" % [tn, r_edge])
			var pm: Dictionary = mgr._puddles[1]
			var poly: PackedVector2Array = pm["poly"]
			var R: float = pm["rc"]
			var full := poly.size() == 4
			for q in poly:
				full = full and is_equal_approx(absf(q.x), R) and is_equal_approx(absf(q.y), R)
			_check(full, "%s middle puddle unclipped (%d verts, half size %.3f)" % [tn, poly.size(), R])
			_check(int(pm["rays"]) == 1, "%s middle puddle 1 ray" % tn)


func _numeric_tail() -> void:
	# non-box collider: probe-ray fallback (cylinder stool)
	mgr.set_quality(1)
	mgr.clear_debris()
	await _frames(2)
	var r1 := mgr.puddle_rays
	mgr.add_puddle(Vector3(3.0, 0.5, 0.0), Vector3.UP, 150.0, COL)
	var pc: Dictionary = mgr._puddles[0]
	var ok := true
	for w in _poly_world(pc):
		ok = ok and Vector2(w.x - 3.0, w.z).length() <= 0.2 * 1.42 + 1e-3   # polygon around a 0.2 m disc
	var cmax := 0.0
	for q: Vector2 in pc["poly"]:
		cmax = maxf(cmax, q.length())
	_check(ok and cmax < float(pc["rc"]), "cylinder puddle clipped by probe rays (max %.3f < rc %.3f)" % [cmax, pc["rc"]])
	_check(mgr.puddle_rays - r1 <= 1 + 8 * 4, "cylinder puddle rays %d <= 33" % (mgr.puddle_rays - r1))
	# idle cost
	mgr.clear_debris()
	await _frames(3)
	_check(not mgr.is_physics_processing(), "idle: manager physics processing off with no puddles/debris")


func _poly_world(p: Dictionary) -> Array:
	var out := []
	for q: Vector2 in p["poly"]:
		out.append(p["pos"] + p["x"] * q.x + p["z"] * q.y)
	return out


func _shots(dir: String) -> void:
	DirAccess.make_dir_recursive_absolute(dir)
	var shelf_edge := Vector3(SHELF_POS.x, SHELF_POS.y + SHELF_SIZE.y * 0.5, SHELF_POS.z + SHELF_SIZE.z * 0.5 - 0.06)
	var shelf_cam := [Vector3(-1.45, 1.3, 0.75), Vector3(-1.8, 0.98, -0.15)]
	for spec in [[0, "high_shelf_edge", shelf_edge, 250.0] + shelf_cam,
			[2, "low_shelf_edge", shelf_edge, 250.0] + shelf_cam,
			[1, "medium_table_middle", Vector3(-0.2, TOP, 0.05), 250.0, Vector3(0.4, 1.5, 1.3), Vector3(-0.2, TOP, 0.0)],
			[0, "high_floor", Vector3(1.6, 0.0, 1.4), 400.0, Vector3(2.3, 1.2, 2.6), Vector3(1.5, 0.0, 1.2)]]:
		mgr.set_quality(spec[0])
		mgr.clear_debris()
		await _frames(2)
		mgr.add_puddle(spec[2], Vector3.UP, spec[3], COL)
		cam.look_at_from_position(spec[4], spec[5], Vector3.UP)
		await _frames(150)
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png("%s/%s.png" % [dir, spec[1]])
		print("shot ", spec[1], " decal=", mgr._puddles[0]["decal"])


func _box(size: Vector3, pos: Vector3, col: Color, shape: Shape3D = null) -> void:
	var sb := StaticBody3D.new()
	sb.collision_layer = 1
	var mi := MeshInstance3D.new()
	if shape is CylinderShape3D:
		var cm := CylinderMesh.new()
		cm.top_radius = shape.radius
		cm.bottom_radius = shape.radius
		cm.height = shape.height
		mi.mesh = cm
	else:
		var bm := BoxMesh.new()
		bm.size = size
		mi.mesh = bm
		var bs := BoxShape3D.new()
		bs.size = size
		shape = bs
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.roughness = 0.8
	mi.material_override = m
	sb.add_child(mi)
	var cs := CollisionShape3D.new()
	cs.shape = shape
	sb.add_child(cs)
	sb.position = pos
	add_child(sb)


func _env() -> void:
	var env := Environment.new()
	var sky := Sky.new()
	sky.sky_material = ProceduralSkyMaterial.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.7
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-55, 35, 0)
	sun.shadow_enabled = true
	add_child(sun)
	_box(Vector3(12, 0.2, 12), Vector3(0, -0.1, 0), Color(0.45, 0.42, 0.4))
	_box(TABLE_SIZE, TABLE_POS, Color(0.42, 0.28, 0.17))
	_box(SHELF_SIZE, SHELF_POS, Color(0.5, 0.33, 0.2))
	var cyl := CylinderShape3D.new()
	cyl.radius = 0.2
	cyl.height = 0.5
	_box(Vector3.ZERO, Vector3(3.0, 0.25, 0.0), Color(0.3, 0.3, 0.35), cyl)
	cam = Camera3D.new()
	cam.fov = 50
	add_child(cam)
	cam.current = true
	cam.look_at_from_position(Vector3(0, 1.6, 2.5), Vector3(0, 0.7, 0), Vector3.UP)
