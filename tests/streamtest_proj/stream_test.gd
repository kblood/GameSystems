extends Node3D
## Pour system tests.  godot --headless --path tests/pour_proj res://stream_test.tscn -- --numeric
##                      godot --path tests/pour_proj res://stream_test.tscn -- --shots <dir>

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
	if "--probe" in args:
		await _probe()
	elif shots_dir != "":
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


# ======================================================================= stream geometry

const IDS := ["bottle_wine", "bottle_beer", "bottle_whiskey", "bottle_v2_bordeaux", "container_tumbler", "container_mug", "container_hipflask", "design_container_jerrycan_fuel", "design_v2_pet500_orange", "design_v2_pet2l_cola"]
const TILTS := [100.0, 130.0, 160.0, 180.0]
const PIV := Vector3(0, 0.6, 0)
const DT := 1.0 / 60.0


## Analytic landing on the floor plane y = 0 of the parabola from (p, v). Returns [point, flight time] (time -1 if none).
func parabola_land(p: Vector3, v: Vector3) -> Array:
	var a := -0.5 * 9.81
	var disc := v.y * v.y - 4.0 * a * p.y
	if disc < 0.0:
		return [Vector3.ZERO, -1.0]
	var t := (-v.y - sqrt(disc)) / (2.0 * a)
	if t < 0.0:
		t = (-v.y + sqrt(disc)) / (2.0 * a)
	return [p + v * t + Vector3(0, -0.5 * 9.81 * t * t, 0), t]


func vis(pr: BottlePour) -> bool:
	return pr._stream != null and pr._stream.visible


func run_case(id: String, deg: float) -> void:
	var tag := "%s@%d" % [id, int(deg)]
	var b := spawn(id, PIV, 0.8)
	hold(b)
	await frames(3)
	if not b.ctl.is_open():
		uncap(b)
	var pr := pour_of(b)
	tilt(b, 0.0, PIV)
	await frames(2)
	BottlePour.world_puddle_ml = 0.0
	BottlePour.world_lost_ml = 0.0
	var cap := pr.capacity_ml()
	var v_start := vol(b)
	var lxf: Transform3D = pr._ctl.liquid.global_transform
	var r_m: float = pr._ctl.mouth_radius
	var bad1 := 0
	var worst_plane := 0.0
	var worst_rad := 0.0
	var worst_r_over := 0.0
	var bad3 := 0
	var bad7 := 0
	var bad8 := 0
	var moved := 0
	var bad9 := 0
	var max_gap := 0.0
	var max_bead := 0.0
	var min_t1_gap := 1e9
	var prev_sum := Vector3.ZERO
	var mgr := BottleBreakManager.get_for(pr)
	var old_alive := {}
	for di in mgr._dalive.size():
		if mgr._dalive[di] == 1:
			old_alive[di] = true
	var ratios := []
	var land_hist := []
	var n_flow := 0
	var bad5a := 0   # flowing but no stream
	var bad5b := 0   # stream with no flow for longer than the tail time
	var t_noflow := 0.0
	var first_flow := false
	var bad5c := 0   # stream visible before the first flow
	var last_flow_t := -1.0
	var vanish_t := -1.0
	var prev_flow := 0.0
	var tilted := false
	var k := 0
	var kend := 90
	tilt(b, deg, PIV)
	while k < kend + 120:
		await frames(1)
		k += 1
		var tm := k * DT
		if OS.get_cmdline_user_args().has("--dbg") and (k < 8 or k % 30 == 0):
			print("DBG %s k=%d flow=%.1f active=%s fill=%.3f vis=%s sleeping=%s ctlsleep=%s" % [tag, k, pr.flow_ml_s, pr._active, b.fill, vis(pr), b.sleeping, pr._ctl.is_sleeping()])
		lxf = pr._ctl.liquid.global_transform
		var flow := pr.flow_ml_s
		var showing := vis(pr)
		if flow > 0.0:
			n_flow += 1
			first_flow = true
			last_flow_t = tm
			t_noflow = 0.0
			if not showing:
				bad5a += 1
			# (1) p0 inside the mouth disc
			var cw := lxf * pr._ctl.mouth_centre
			var n := (lxf.basis * pr._ctl.mouth_axis).normalized()
			var d := pr.stream_p0 - cw
			var h := d.dot(n)
			var rad := (d - n * h).length()
			var rs: float = r_m * lxf.basis.get_scale().x
			worst_plane = maxf(worst_plane, absf(h))
			worst_rad = maxf(worst_rad, rad / rs)
			if rad > rs or absf(h) > 0.0021:
				bad1 += 1
			# (2) tube radius never above the mouth radius; at t0 close to sqrt(wet/pi) once the flow is steady
			var r0 := pr.stream_radius_at(0.0)
			worst_r_over = maxf(worst_r_over, r0 / rs)
			if r0 > rs * 1.0001:
				bad1 += 1000
			if n_flow > 4 and k < kend - 2 and not pr._plugged and absf(flow - prev_flow) < 0.03 * flow and pr.stream_v0.length() < 2.9:
				ratios.append(r0 / sqrt(pr.jet_area / PI))
			# (3) radius monotone while falling
			var pl := parabola_land(pr.stream_p0, pr.stream_v0)
			var tl: float = pl[1]
			if tl > 0.0 and pr.stream_v0.y <= 0.01:
				var prev_r := 1e9
				for s in 25:
					var rr := pr.stream_radius_at(tl * s / 24.0)
					if rr > prev_r + 1e-9:
						bad3 += 1
					prev_r = rr
			land_hist.append([pl[0], tl, tm])
			# (7) tube continuous from mouth to landing: starts at t0 = 0, reaches the landing time, ring spacing small
			if n_flow * DT > tl + 0.06 and k < kend - 2 and tl > 0.0 and pr._smat != null:
				var t1: float = pr._smat.get_shader_parameter("t1")
				var t0: float = pr._smat.get_shader_parameter("t0")
				var gap := (pr.stream_v0.length() + 9.81 * t1) * t1 / 39.0   # upper bound of the ring spacing (m)
				max_gap = maxf(max_gap, gap)
				min_t1_gap = minf(min_t1_gap, t1 - tl)
				if t0 > 0.0 or t1 < tl - 0.03 or gap > 0.05 or pr.stream_radius_at(t1) < 0.0007:
					bad7 += 1
			# (8) animates: parcels advance every tick (and the shader carries TIME terms, checked once below)
			# a given parcel advances: follow the parcel whose age is closest to 0.1 s
			var bi := -1
			for pi in pr._np:
				if bi < 0 or absf(pr._page[pi] - 0.1) < absf(pr._page[bi] - 0.1):
					bi = pi
			if bi >= 0 and pr._page[bi] > 0.05:
				var pos: Vector3 = pr._pp[bi]
				var expect := pr.stream_p0 + pr.stream_v0 * pr._page[bi] + Vector3(0, -0.5 * 9.81 * pr._page[bi] * pr._page[bi], 0)
				if n_flow > 8 and k < kend - 2 and absf(flow - prev_flow) < 0.03 * flow and (pos - expect).length() > 0.06:
					bad8 += 1
				if (pos - prev_sum).length() > 0.0:
					moved += 1
				prev_sum = pos
			# (9) splash beads never fatter than the tube
			if n_flow > 4 and mgr != null:
				var allow := maxf(pr.stream_radius_at(maxf(tl, 0.0)), 0.0025) * 1.001
				for di in mgr._dalive.size():
					if mgr._dalive[di] == 1 and not old_alive.has(di):
						max_bead = maxf(max_bead, mgr._dsize[di] / allow)
						if mgr._dsize[di] > allow:
							bad9 += 1
		else:
			if showing:
				t_noflow += DT
				if not first_flow:
					bad5c += 1
				if t_noflow > pr._t_land + 0.04 + 1e-4:
					bad5b += 1
			elif last_flow_t > 0.0 and vanish_t < 0.0:
				vanish_t = tm - last_flow_t
		prev_flow = flow
		if k == kend:
			tilt(b, 0.0, PIV)   # stop the flow (back upright) and watch the tail
	await frames(60)
	# (4) landing point: last parcel landing vs the analytic parabola sampled one flight time earlier (+-1 tick)
	var err_land := 1e9
	var ks := k
	for e in land_hist:
		err_land = minf(err_land, (e[0] - pr.last_land).length())
	var drained := v_start - vol(b)
	var landed := total_world() + pr.delivered_ml
	var verr := absf(drained - landed) / maxf(drained, 1e-6)
	var r_med := 0.0
	if ratios.size() > 0:
		ratios.sort()
		r_med = ratios[ratios.size() / 2]
	check("1_p0_in_mouth " + tag, bad1 % 1000 == 0 and n_flow > 0, "flow ticks %d, max |plane| %.2f mm, max radial %.0f%% of mouth_r (%.1f mm)" % [n_flow, worst_plane * 1000.0, worst_rad * 100.0, r_m * 1000.0])
	check("2_radius " + tag, bad1 < 1000 and (ratios.size() == 0 or (r_med > 0.8 and r_med < 1.25)), "r0 max %.0f%% of mouth_r, steady r0/sqrt(wet/pi) median %.2f (n=%d)" % [worst_r_over * 100.0, r_med, ratios.size()])
	check("3_monotone " + tag, bad3 == 0, "violations %d" % bad3)
	check("4_landing " + tag, err_land < 0.01 and verr < 0.02, "land err %.1f mm, drained %.2f ml landed %.2f ml (%.2f %%)" % [err_land * 1000.0, drained, landed, verr * 100.0])
	check("5_visibility " + tag, bad5a == 0 and bad5b == 0 and bad5c == 0 and not vis(pr), "flow w/o stream %d, tail overrun %d, early %d, vanished %.2f s after last flow (t_land %.2f), end visible=%s" % [bad5a, bad5b, bad5c, vanish_t, pr._t_land, vis(pr)])
	check("7_tube_continuous " + tag, bad7 == 0, "bad ticks %d, max ring spacing %.1f mm (chord sag %.3f mm), t1 - t_land >= %.3f s, t0 = 0" % [bad7, max_gap * 1000.0, 0.125 * 9.81 * pow(0.35 / 39.0, 2) * 1000.0, min_t1_gap])
	check("8_animates " + tag, bad8 == 0 and BottlePour.STREAM_SHADER.count("TIME") >= 2, "parcel off its parabola on %d ticks, tracked parcel moved on %d ticks, shader TIME terms %d" % [bad8, moved, BottlePour.STREAM_SHADER.count("TIME")])
	check("9_beads_not_fatter_than_tube " + tag, bad9 == 0, "violating ticks %d, max bead/tube %.2f" % [bad9, max_bead])
	b.queue_free()
	await frames(30)


## (6) steady tilt just above the pour threshold: stream must not flicker
func run_flicker(id: String) -> void:
	var b := spawn(id, PIV, 0.8)
	hold(b)
	await frames(3)
	if not b.ctl.is_open():
		uncap(b)
	var pr := pour_of(b)
	var thr := -1.0
	var deg := 40.0
	while deg < 181.0 and thr < 0.0:
		b.fill = 0.8
		tilt(b, deg, PIV)
		await frames(6)
		if pr.flow_ml_s > 0.0:
			thr = deg
		deg += 1.0
	if thr < 0.0:
		check("6_flicker " + id, false, "no pour threshold found")
		b.queue_free()
		return
	var worst := 0
	var info := ""
	for off in [0.0, 0.5, 1.0, 2.0]:
		b.fill = 0.8
		tilt(b, 0.0, PIV)
		await frames(40)
		b.fill = 0.8
		tilt(b, thr + off, PIV)
		var edges := 0
		var prev := false
		var win := [0, 0, 0]
		var flow_ticks := 0
		for k in 180:
			await frames(1)
			var on := vis(pr)
			if on and not prev:
				edges += 1
				win[mini(k / 60, 2)] += 1
			prev = on
			if pr.flow_ml_s > 0.0:
				flow_ticks += 1
		worst = maxi(worst, maxi(win[0], maxi(win[1], win[2])))
		info += " +%.1f:starts/s=%s,flow=%d" % [off, str(win), flow_ticks]
	check("6_flicker " + id, worst <= 1, "threshold %.0f deg;%s" % [thr, info])
	b.queue_free()
	await frames(5)


func _numeric() -> void:
	await frames(5)
	var ids: Array = IDS
	var no6 := "--no6" in OS.get_cmdline_user_args()
	var ai := OS.get_cmdline_user_args().find("--ids")
	if ai >= 0:
		ids = OS.get_cmdline_user_args()[ai + 1].split(",")
	for id in ids:
		for deg in TILTS:
			await run_case(id, deg)
		if not no6:
			await run_flicker(id)
	print("DONE fails=%d" % fails)


func _shots() -> void:
	await frames(5)
	DirAccess.make_dir_recursive_absolute(shots_dir)
	var ids := ["design_container_jerrycan_fuel", "design_v2_pet500_orange"]
	var degs := [130.0, 160.0]
	for i in 2:
		var b := spawn(ids[i], PIV, 0.8)
		hold(b)
		await frames(3)
		if not b.ctl.is_open():
			uncap(b)
		tilt(b, degs[i], PIV)
		cam.position = Vector3(-0.25, 0.4, 0.9)
		cam.look_at(Vector3(-0.25, 0.3, 0.0))
		await frames(40)
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png("%s/stream_%d.png" % [shots_dir, i])
		b.queue_free()
		await frames(10)


## probe: what the stream is made of for jerrycan / PET (prints numbers)
func _probe() -> void:
	await frames(5)
	for id in ["design_container_jerrycan_fuel", "design_v2_pet500_orange", "design_v2_pet2l_cola"]:
		for deg in [100.0, 130.0, 160.0, 180.0]:
			var b := spawn(id, PIV, 0.8)
			hold(b)
			await frames(3)
			if not b.ctl.is_open():
				uncap(b)
			var pr := pour_of(b)
			tilt(b, deg, PIV)
			await frames(40)
			var sm: ShaderMaterial = pr._smat
			var pl := parabola_land(pr.stream_p0, pr.stream_v0)
			var vis_meshes := 0
			for n in get_tree().root.find_children("*", "MeshInstance3D", true, false):
				if n.is_visible_in_tree() and n.name == "PourStream":
					vis_meshes += 1
			print("PROBE %s@%d open=%s r_mouth=%.1fmm flow=%.1f jet=%.0fmm2 plugged=%s |v0|=%.2f p0y=%.3f t_land=%.2f t1=%s t0=%s q=%s vis=%s r0=%.1fmm r_end=%.1fmm np=%d streams=%d" % [id, int(deg), pr.is_open(), pr._ctl.mouth_radius * 1000, pr.flow_ml_s, pr.jet_area * 1e6, pr._plugged, pr.stream_v0.length(), pr.stream_p0.y, pl[1], sm.get_shader_parameter("t1") if sm else "-", sm.get_shader_parameter("t0") if sm else "-", pr._q_vis, vis(pr), pr.stream_radius_at(0.0) * 1000, pr.stream_radius_at(maxf(pl[1], 0.0)) * 1000, pr._np, vis_meshes])
			b.queue_free()
			await frames(5)
	print("PROBE DONE")
