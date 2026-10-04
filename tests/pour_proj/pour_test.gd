extends Node3D
## Pour system tests.  godot --headless --path tests/pour_proj res://pour_test.tscn -- --numeric
##                      godot --path tests/pour_proj res://pour_test.tscn -- --shots <dir>

var cam: Camera3D
var label: Label
var shots_dir := ""
var fails := 0


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	var si := args.find("--shots")
	if si >= 0:
		shots_dir = args[si + 1]
	_env()
	if shots_dir != "":
		await _shots()
	else:
		await _numeric()
	get_tree().quit()


func _env() -> void:
	var env := Environment.new()
	var sky := Sky.new()
	sky.sky_material = ProceduralSkyMaterial.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.8
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, 30, 0)
	sun.shadow_enabled = true
	add_child(sun)
	var sb := StaticBody3D.new()
	sb.collision_layer = 1
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(40, 0.2, 10)
	mi.mesh = bm
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.55, 0.5, 0.45)
	mi.material_override = m
	sb.add_child(mi)
	var cs := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = bm.size
	cs.shape = sh
	sb.add_child(cs)
	sb.position = Vector3(0, -0.1, 0)
	add_child(sb)
	cam = Camera3D.new()
	cam.fov = 45
	add_child(cam)
	cam.current = true
	var cl := CanvasLayer.new()
	add_child(cl)
	label = Label.new()
	label.position = Vector2(10, 8)
	label.add_theme_color_override("font_outline_color", Color.BLACK)
	label.add_theme_constant_override("outline_size", 5)
	cl.add_child(label)


func spawn(id: String, pos: Vector3, fill: float, rot := Vector3.ZERO) -> RigidBody3D:
	var b := BottleFactory.spawn(id, {"fill": fill, "position": pos, "rotation_degrees": rot, "audio": false}) as RigidBody3D
	add_child(b)
	return b


func hold(b: RigidBody3D) -> void:
	b.freeze_mode = RigidBody3D.FREEZE_MODE_KINEMATIC
	b.freeze = true
	if "breakable" in b:
		b.breakable = false   # teleport-tilting a kinematic body reads as a hard impact


func uncap(b: Node) -> void:
	b.ctl.cap_open = true
	var c = b.model.find_child("Cap*", true, false)
	if c:
		c.visible = false


func tilt(b: Node3D, deg: float, pivot: Vector3) -> void:
	b.global_transform = Transform3D(Basis(Vector3(0, 0, 1), deg_to_rad(deg)), pivot)


func pour_of(b: Node) -> BottlePour:
	return b.get_meta("pour")


func frames(n: int) -> void:
	for i in n:
		await get_tree().physics_frame


func check(name: String, ok: bool, msg: String) -> void:
	print(("PASS " if ok else "FAIL ") + name + ": " + msg)
	if not ok:
		fails += 1


func vol(b: Node) -> float:
	return pour_of(b).volume_ml()


## Put the receiver (kinematic, upright) so the pourer's current stream hits the centre of its mouth.
func aim(src: BottlePour, rcv: RigidBody3D) -> void:
	var mw: Vector3 = rcv.ctl.liquid.global_transform * rcv.ctl.mouth_centre
	var off := mw - rcv.global_position
	var p0 := src.stream_p0
	var v0 := src.stream_v0
	if v0 == Vector3.ZERO:
		return
	var y_m := mw.y
	var a := -0.5 * 9.81
	var b := v0.y
	var c := p0.y - y_m
	var disc := b * b - 4.0 * a * c
	if disc < 0.0:
		return
	var t := (-b - sqrt(disc)) / (2.0 * a)
	var hit := p0 + v0 * t
	rcv.global_position = Vector3(hit.x - off.x, rcv.global_position.y, hit.z - off.z)


func total_world() -> float:
	return BottlePour.world_puddle_ml + BottlePour.world_lost_ml


# ======================================================================= numeric

func _numeric() -> void:
	await frames(5)
	# --- A: upright open tumbler loses nothing; sleeping containers cost nothing
	var t_up := spawn("container_tumbler", Vector3(-8, 0.002, 0), 0.95)
	var mug := spawn("container_mug", Vector3(-8.3, 0.002, 0), 0.9)
	var wine_capped := spawn("bottle_wine", Vector3(-8.6, 0.002, 0), 0.7)
	await frames(10)
	var v0 := vol(t_up)
	var vm := vol(mug)
	await frames(300)
	check("upright_no_loss", absf(vol(t_up) - v0) < 0.01 and absf(vol(mug) - vm) < 0.01,
		"tumbler %.3f -> %.3f ml, mug %.3f -> %.3f ml" % [v0, vol(t_up), vm, vol(mug)])
	var busy := 0
	for p in BottlePour.registry:
		if p.is_physics_processing():
			busy += 1
	var asleep := t_up.sleeping and mug.sleeping and wine_capped.sleeping
	check("sleeping_costs_nothing", asleep and busy == 0, "all asleep=%s, pour nodes processing=%d of %d" % [asleep, busy, BottlePour.registry.size()])

	# --- B: tumbler 232 ml tipped (0 -> 180 deg in 1 s, held) empties
	var tb := spawn("container_tumbler", Vector3(-6, 0.6, 0), 1.0)
	hold(tb)
	await frames(5)
	var cap := pour_of(tb).capacity_ml()
	var full := vol(tb)
	BottlePour.world_puddle_ml = 0.0
	BottlePour.world_lost_ml = 0.0
	var t := 0.0
	var t_first := -1.0
	var t_empty := -1.0
	var ang := 0.0
	while t < 5.0:
		ang = minf(180.0, ang + 180.0 / 60.0)
		tilt(tb, ang, Vector3(-6, 0.6, 0))
		await frames(1)
		t += 1.0 / 60.0
		if t_first < 0.0 and vol(tb) < full - 0.5:
			t_first = t
		if t_empty < 0.0 and vol(tb) < 0.5:
			t_empty = t
	await frames(90)
	var pr := pour_of(tb)
	var world := total_world()
	check("tumbler_tipped_empties", vol(tb) < 0.5 and absf(full - vol(tb) - world) < 0.02 * full,
		"cap %.1f ml, start %.1f, left %.3f ml, first flow t=%.2fs (tilt %.0f deg), empty t=%.2fs, on world %.1f ml, poured %.1f" %
		[cap, full, vol(tb), t_first, t_first * 180.0, t_empty, world, pr.poured_ml])

	# --- C: wine (uncapped) pour rates at fixed tilts
	for deg in [100.0, 115.0, 135.0, 180.0]:
		var w := spawn("bottle_wine", Vector3(-4, 0.5, 0), 0.8)
		hold(w)
		await frames(3)
		uncap(w)
		tilt(w, deg, Vector3(-4, 0.5, 0))
		await frames(2)
		var wv0 := vol(w)
		var tt := 0.0
		var t100 := -1.0
		while tt < 4.0:
			await frames(1)
			tt += 1.0 / 60.0
			if t100 < 0.0 and wv0 - vol(w) >= 100.0:
				t100 = tt
		var rate := (wv0 - vol(w)) / tt
		print("INFO wine tilt %.0f deg: start %.1f ml, mean %.1f ml/s over 4 s, first 100 ml in %.2f s, plugged=%s" % [deg, wv0, rate, t100, pour_of(w)._plugged])
		if deg == 115.0 or deg == 135.0:
			check("wine_rate_%d" % int(deg), t100 > 0.4 and t100 < 1.2, "100 ml in %.2f s (target 0.5-1 s)" % t100)
		w.queue_free()
		await frames(100)

	# --- D: wine -> empty tumbler (overflow) -> tumbler -> empty wine bottle; conservation
	var src := spawn("bottle_wine", Vector3(0, 0.45, 0), 0.75)
	var rcv := spawn("container_tumbler", Vector3(0.3, 0.001, 0), 0.0)
	var rcv2 := spawn("bottle_wine", Vector3(1.0, 0.001, 0), 0.0)
	hold(src)
	hold(rcv)
	hold(rcv2)
	await frames(3)
	uncap(src)
	uncap(rcv2)
	var wine_col: Color = src.ctl.liquid_color()
	var tum_col0: Color = rcv.ctl.liquid_color()
	BottlePour.world_puddle_ml = 0.0
	BottlePour.world_lost_ml = 0.0
	var ps := pour_of(src)
	var pt := pour_of(rcv)
	var got := {"ml": 0.0, "n": 0}
	ps.poured_into.connect(func(r, ml): got["ml"] += ml; got["n"] += 1)
	var s0 := vol(src)
	var total0 := vol(src) + vol(rcv) + vol(rcv2)
	ang = 60.0
	var tt2 := 0.0
	while tt2 < 6.0:
		ang = minf(125.0, ang + 1.0)
		tilt(src, ang, Vector3(0, 0.45, 0))
		await frames(1)
		aim(ps, rcv)
		tt2 += 1.0 / 60.0
	for k in 60:
		tilt(src, 125.0 - k * 1.5, Vector3(0, 0.45, 0))
		await frames(1)
	await frames(120)
	var lost := s0 - vol(src)
	var gain := vol(rcv)
	var w1 := total_world()
	var err := absf(lost - gain - w1 - ps.in_flight_ml() - pt.in_flight_ml())
	check("wine_to_tumbler_conserved", err < 0.02 * lost and gain > 200.0,
		"wine lost %.2f ml = tumbler %.2f + world %.2f (overflow+misses); err %.3f ml (%.3f %%); poured_into %d calls %.1f ml" %
		[lost, gain, w1, err, 100.0 * err / maxf(lost, 1e-6), got["n"], got["ml"]])
	check("receiver_took_colour", rcv.ctl.liquid_color().is_equal_approx(wine_col) and not tum_col0.is_equal_approx(wine_col),
		"tumbler colour %s (wine %s, before %s)" % [rcv.ctl.liquid_color(), wine_col, tum_col0])
	# tumbler back into the empty wine bottle
	src.global_position = Vector3(-1.5, 0.45, 0)
	rcv.global_position = Vector3(1.0, 0.55, 0.0)
	rcv2.global_position = Vector3(1.0, 0.001, 0.4)
	var world_before := total_world()
	var t_before := vol(rcv)
	ang = 40.0
	tt2 = 0.0
	while tt2 < 8.0:
		ang = minf(150.0, ang + 0.5)
		tilt(rcv, ang, Vector3(1.0, 0.55, 0.0))
		await frames(1)
		aim(pt, rcv2)
		tt2 += 1.0 / 60.0
	await frames(120)
	var t_lost := t_before - vol(rcv)
	var b_gain := vol(rcv2)
	var w2 := total_world() - world_before
	var err2 := absf(t_lost - b_gain - w2 - pt.in_flight_ml())
	check("tumbler_to_bottle_conserved", err2 < 0.02 * maxf(t_lost, 1.0) and b_gain > 0.2 * t_lost,
		"tumbler lost %.2f ml = bottle %.2f + world %.2f; err %.3f ml" % [t_lost, b_gain, w2, err2])
	var total1 := vol(src) + vol(rcv) + vol(rcv2) + total_world() + ps.in_flight_ml() + pt.in_flight_ml()
	check("global_ledger", absf(total1 - total0) < 0.01 * total0, "start %.3f ml, end %.3f ml (containers + world)" % [total0, total1])

	# --- E: dynamic mug knocked over spills into a puddle
	BottlePour.world_puddle_ml = 0.0
	var mg := spawn("container_mug", Vector3(4, 0.15, 0), 0.8, Vector3(0, 0, 95))
	await frames(245)
	var mv0 := 0.8 * pour_of(mg).capacity_ml()
	check("mug_knocked_over_spills", vol(mg) < mv0 * 0.5 and absf(mv0 - vol(mg) - BottlePour.world_puddle_ml - pour_of(mg).in_flight_ml()) < 0.02 * mv0,
		"mug %.1f -> %.1f ml, puddle %.1f ml" % [mv0, vol(mg), BottlePour.world_puddle_ml])
	print("DONE fails=%d" % fails)


# ======================================================================= screenshots

func snap(n: String) -> void:
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("%s/%s.png" % [shots_dir, n])
	print("shot ", n)


func look(from: Vector3, at: Vector3) -> void:
	cam.global_position = from
	cam.look_at(at)


func _shots() -> void:
	DirAccess.make_dir_recursive_absolute(shots_dir)
	await frames(5)
	# 1: wine bottle pouring into a tumbler, level rising
	var src := spawn("bottle_wine", Vector3(0, 0.45, 0), 0.75)
	var rcv := spawn("container_tumbler", Vector3(0.3, 0.001, 0), 0.0)
	hold(src)
	hold(rcv)
	await frames(3)
	uncap(src)
	look(Vector3(-0.12, 0.3, 0.85), Vector3(-0.15, 0.2, 0))
	var ps := pour_of(src)
	var ang := 60.0
	var t := 0.0
	var marks := {0.9: "01_wine_into_tumbler_start", 2.0: "02_wine_into_tumbler_mid", 3.4: "03_wine_into_tumbler_full"}
	while t < 3.5:
		ang = minf(125.0, ang + 1.2)
		tilt(src, ang, Vector3(0, 0.45, 0))
		await frames(1)
		aim(ps, rcv)
		t += 1.0 / 60.0
		for m in marks.keys():
			if absf(t - m) < 0.5 / 60.0:
				label.text = "wine %.0f ml -> tumbler %.0f ml (%.0f %%)   flow %.0f ml/s" % [vol(src), vol(rcv), 100.0 * rcv.fill, ps.flow_ml_s]
				await snap(marks[m])
	# 2: tumbler knocked over (dynamic), puddle
	var tb := spawn("container_tumbler", Vector3(3, 0.12, 0), 0.9, Vector3(0, 0, 100))
	look(Vector3(3.0, 0.35, 0.6), Vector3(2.9, 0.03, 0))
	await frames(14)
	label.text = "tumbler tipping: %.0f ml left" % vol(tb)
	await snap("04_tumbler_tipping")
	await frames(120)
	label.text = "tumbler after 2 s: %.0f ml left, puddle %.0f ml" % [vol(tb), BottlePour.world_puddle_ml]
	await snap("05_tumbler_puddle")
	# 3: mug held at 115 deg pouring onto the floor
	var mg := spawn("container_mug", Vector3(6, 0.4, 0), 0.8)
	hold(mg)
	await frames(3)
	tilt(mg, 115.0, Vector3(6, 0.4, 0))
	look(Vector3(5.85, 0.35, 0.75), Vector3(5.9, 0.2, 0))
	await frames(10)
	label.text = "mug at 115 deg: %.0f ml left, flow %.0f ml/s" % [vol(mg), pour_of(mg).flow_ml_s]
	await snap("06_mug_pour")
	# 4: close-up of the bottle stream
	var w2 := spawn("bottle_wine", Vector3(9, 0.45, 0), 0.8)
	hold(w2)
	await frames(3)
	uncap(w2)
	tilt(w2, 130.0, Vector3(9, 0.45, 0))
	look(Vector3(8.8, 0.35, 0.45), Vector3(8.85, 0.25, 0))
	for k in 50:
		await frames(1)
		if k % 10 == 0:
			var p7 := pour_of(w2)
			print("DBG7 k=%d vol=%.1f open=%s proc=%s flow=%.1f sleep=%s/%s" % [k, vol(w2), p7.is_open(), p7.is_physics_processing(), p7.flow_ml_s, w2.sleeping, w2.ctl.is_sleeping()])
	label.text = "wine at 130 deg: flow %.0f ml/s" % pour_of(w2).flow_ml_s
	await snap("07_wine_stream_closeup")
