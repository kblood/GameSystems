extends Node3D
## Bullet-hole leak stream + hole mark tests (LeakStream, BulletHoleMark, BreakableBottle._process_leaks).
##   godot --headless --path tests/leak_stream_proj res://leak_test.tscn            numeric checks (exit code = fails)
##   godot --path tests/leak_stream_proj res://leak_test.tscn -- --shots <dir>     2 screenshots

const TABLE_SIZE := Vector3(1.6, 0.72, 0.9)
const TOP := 0.72
const PET := "bottle_v2_pet500"
const CAN := "container_jerrycan"

var cam: Camera3D
var mgr: BottleBreakManager
var fails := 0


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	_env()
	await _frames(2)
	mgr = BottleBreakManager.get_for(self)
	QualityTier.set_tier(0)
	var si := args.find("--shots")
	if si >= 0:
		await _shots(args[si + 1])
	else:
		await _numeric()
	print("LEAK STREAM TEST ", "PASS" if fails == 0 else "FAIL (%d)" % fails)
	get_tree().quit(fails)


func _check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


func _frames(n: int) -> void:
	for i in n:
		await get_tree().physics_frame


func _spawn(id: String, pos: Vector3, fill: float, frozen := true, rot := Vector3.ZERO) -> BreakableBottle:
	var b := BottleFactory.spawn(id, {"fill": fill, "position": pos, "rotation_degrees": rot, "audio": false, "seed": 7}) as BreakableBottle
	add_child(b)
	b.freeze = frozen
	return b


## Shoot along dir through the bottle-local point lp (line through it; entry / exit found on the shell mesh).
func _shoot(b: BreakableBottle, lp: Vector3, dir: Vector3, energy := 500.0, cal := 0.009) -> void:
	b.hit_by_projectile(b.global_transform * lp, dir.normalized(), energy, cal)


func _clear() -> void:
	for c in get_children():
		if c is BreakableBottle:
			c.queue_free()
	await _frames(2)
	for s in LeakStream.live.duplicate():
		s._finish()
	mgr.clear_debris()
	await _frames(3)
	LeakStream.reset_ledger()


## Distance (m) from a bottle-local point to the shell mesh along normal n (independent of the bottle's own hit code).
func _shell_dist(b: BreakableBottle, p: Vector3, n: Vector3) -> float:
	var sn := b._shell_node()
	var xf := b._rel_xf(sn)
	var f := sn.mesh.get_faces()
	var best := INF
	for i in range(0, f.size(), 3):
		var v0 := xf * f[i]
		var e1 := xf * f[i + 1] - v0
		var e2 := xf * f[i + 2] - v0
		var nn := e1.cross(e2)
		var den := nn.dot(n)
		if absf(den) < 1e-15:
			continue
		var t := nn.dot(v0 - p) / den
		var x := p + n * t
		# barycentric inside test
		var c0 := (e1).cross(x - v0).dot(nn)
		var c1 := (e2 - e1).cross(x - v0 - e1).dot(nn)
		var c2 := (-e2).cross(x - v0 - e2).dot(nn)
		if (c0 >= 0 and c1 >= 0 and c2 >= 0) or (c0 <= 0 and c1 <= 0 and c2 <= 0):
			best = minf(best, absf(t))
	return best


func _streams_of(b: BreakableBottle) -> Array:
	var out := []
	for lk in b.leaks:
		var s = lk.get("stream")
		if s != null and is_instance_valid(s) and not (s as LeakStream).finished and not (s as LeakStream).stopping:
			out.append(s)
	return out


func _numeric() -> void:
	await _test_edge_streams()
	await _test_jerrycan()
	await _test_dry_hole_tip()
	await _test_lying_level()
	await _test_idle_then_tip()
	await _test_caps_and_tiers()
	await _test_hitscan_long_range()
	await _test_swap_model_glass()


# ---------------------------------------------------------------- A: PET at the table edge, entry + exit stream
func _test_edge_streams() -> void:
	print("== A: PET on the table edge, 500 J through the body")
	await _clear()
	var b := _spawn(PET, Vector3(0.74, TOP + 0.001, 0.0), 0.85)
	await _frames(3)
	var cap := b.lut.capacity_ml
	var f0 := b.fill
	_shoot(b, Vector3(0, 0.05, 0), Vector3(1, 0, 0))
	_check(b.leaks.size() == 2 and b.hole_marks.size() == 2, "2 holes -> %d leaks, %d marks" % [b.leaks.size(), b.hole_marks.size()])
	for m in b.hole_marks:
		var hp: Vector3 = m.get_meta("hole_p")
		var hn: Vector3 = m.get_meta("hole_n")
		var d := _shell_dist(b, hp, hn)
		_check(d < 0.001, "mark %s on the shell (%.2f mm), lift %.2f mm" % [m.name, d * 1000.0, m.position.distance_to(hp) * 1000.0])
	await _frames(20)
	var ss := _streams_of(b)
	_check(ss.size() == 2 and LeakStream.live.size() == 2, "2 continuous streams (%d live)" % LeakStream.live.size())
	var on_floor := 0
	var on_table := 0
	for i in ss.size():
		var s: LeakStream = ss[i]
		var hole_w: Vector3 = b.global_transform * (b.leaks[i]["p"] as Vector3)
		_check(s.p0.distance_to(hole_w) < 0.001, "stream %d starts at the hole (%.2f mm)" % [i, s.p0.distance_to(hole_w) * 1000.0])
		var cl := s.centreline()
		var maxgap := 0.0
		for j in range(1, cl.size()):
			maxgap = maxf(maxgap, cl[j].distance_to(cl[j - 1]))
		_check(cl.size() == LeakStream.RINGS and maxgap < 0.02, "stream %d: %d segments, max segment %.1f mm" % [i, cl.size() - 1, maxgap * 1000.0])
		var r_core := 1.0
		for j in int(LeakStream.RINGS * 0.55):
			r_core = minf(r_core, s.radius_at(s.t_land * j / (LeakStream.RINGS - 1.0), s.phase))
		_check(r_core > 0.0004, "stream %d: no gaps in the first 55 %% (min r %.2f mm)" % [i, r_core * 1000.0])
		var r0 := clampf(sqrt(s.q / (PI * s.v0.length())), LeakStream.R_MIN, LeakStream.R_MAX)
		_check(r0 >= 0.0005 and r0 <= 0.002, "stream %d base radius %.2f mm in [0.5, 2] (q %.1f ml/s)" % [i, r0 * 1000.0, s.q * 1e6])
		_check(s.landed, "stream %d lands at %s after %.3f s" % [i, s.land_pos, s.t_land])
		if absf(s.land_pos.y) < 0.004:
			on_floor += 1
		elif absf(s.land_pos.y - TOP) < 0.004:
			on_table += 1
		var ph := s.phase
		var mat := s.material_override as ShaderMaterial
		var u0: float = mat.get_shader_parameter("phase")
		var rr0 := s.radius_at(s.t_land * 0.8, ph)
		await _frames(2)
		var u1: float = mat.get_shader_parameter("phase")
		_check(u1 > u0 and absf(s.radius_at(s.t_land * 0.8, s.phase) - rr0) > 1e-6, "stream %d animates (phase %.3f -> %.3f)" % [i, u0, u1])
	_check(on_floor == 1 and on_table == 1, "exit jet crosses the table edge to the floor, entry jet lands on the table (%d / %d)" % [on_floor, on_table])
	var rc0 := LeakStream.recomputes
	var ry0 := LeakStream.rays
	await _frames(60)
	_check(LeakStream.recomputes - rc0 <= 12, "parabola cached: %d recomputes / 60 frames x 2 streams, %d rays" % [LeakStream.recomputes - rc0, LeakStream.rays - ry0])
	_check(LeakStream.rays - ry0 <= (LeakStream.recomputes - rc0) * 3, "<= 3 rays per recompute")
	var drained := (f0 - b.fill) * cap
	_check(absf(drained - LeakStream.emitted_ml) < 0.01 * drained + 0.01, "drained %.1f ml == emitted %.1f ml" % [drained, LeakStream.emitted_ml])
	var acc := LeakStream.landed_ml + LeakStream.lost_ml + LeakStream.in_flight_total()
	_check(absf(acc - LeakStream.emitted_ml) < 0.01, "emitted %.2f == landed %.2f + lost %.2f + flight %.2f" % [LeakStream.emitted_ml, LeakStream.landed_ml, LeakStream.lost_ml, LeakStream.in_flight_total()])
	# run until both holes are dry
	var k := 0
	while b.leak_flowing and k < 1500:
		await _frames(10)
		k += 10
	await _frames(60)
	drained = (f0 - b.fill) * cap
	_check(not b.leak_flowing, "leak stopped after %.1f s, fill %.3f (%.0f ml drained)" % [k / 60.0, b.fill, drained])
	_check(LeakStream.live.is_empty(), "no live streams after the leak stopped (%d)" % LeakStream.live.size())
	var nodes := 0
	for c in mgr.get_children():
		if c is LeakStream:
			nodes += 1
	_check(nodes == 0, "stream nodes freed (%d)" % nodes)
	_check(not b.is_physics_processing(), "bottle: no per-frame leak work once dry")
	_check(absf(drained - LeakStream.emitted_ml) < 0.01 * drained + 0.01 and absf(LeakStream.landed_ml - drained) < 0.01 * drained + 0.01,
		"volume: drained %.1f == emitted %.1f == landed %.1f (lost %.2f)" % [drained, LeakStream.emitted_ml, LeakStream.landed_ml, LeakStream.lost_ml])
	var pud := 0.0
	for p in mgr._puddles:
		pud += float(p["vol"])
	_check(pud > 0.7 * drained, "puddles hold %.1f ml of %.1f (rest in splash droplets)" % [pud, drained])
	# empty it: marks stay, still no work
	b.fill = 0.0
	await _frames(5)
	_check(b.hole_marks.size() == 2 and is_instance_valid(b.hole_marks[0]) and b.hole_marks[0].visible, "marks stay after fill hits 0")
	_check(not b.is_physics_processing() and LeakStream.live.is_empty(), "empty: zero streams, physics process off")
	var m0: MeshInstance3D = b.hole_marks[0]
	_check(m0.get_script() == null and not m0.is_processing() and not m0.is_physics_processing(), "mark has no script / process callback")
	var gp := m0.global_position
	b.global_transform = Transform3D(Basis(Vector3.UP, 0.7), b.global_position + Vector3(0, 0, 0.2))
	var exp := b.global_transform * m0.position
	_check(m0.get_parent() == b and m0.global_position.distance_to(exp) < 1e-5 and m0.global_position.distance_to(gp) > 0.05, "mark moves with the bottle (local transform)")


# ---------------------------------------------------------------- B: jerrycan
func _test_jerrycan() -> void:
	print("== B: jerrycan on the floor, 500 J")
	await _clear()
	var b := _spawn(CAN, Vector3(-2.0, 0.001, 0.5), 0.7)
	await _frames(3)
	var f0 := b.fill
	_shoot(b, Vector3(0, 0.12, 0), Vector3(0.3, 0, 1))
	_check(b.hole_marks.size() == b.leaks.size() and b.leaks.size() >= 1, "jerrycan: %d holes, %d marks" % [b.leaks.size(), b.hole_marks.size()])
	for m in b.hole_marks:
		var d := _shell_dist(b, m.get_meta("hole_p"), m.get_meta("hole_n"))
		_check(d < 0.001, "jerrycan mark on the shell (%.2f mm)" % (d * 1000.0))
	await _frames(90)
	var ss := _streams_of(b)
	_check(ss.size() == b.leaks.size(), "jerrycan: %d streams" % ss.size())
	for i in ss.size():
		var s: LeakStream = ss[i]
		var hw: Vector3 = b.global_transform * (b.leaks[i]["p"] as Vector3)
		_check(s.p0.distance_to(hw) < 0.001 and s.landed and absf(s.land_pos.y) < 0.004, "jerrycan stream %d: hole -> floor (%.2f m away)" % [i, Vector2(s.land_pos.x - hw.x, s.land_pos.z - hw.z).length()])
	var drained := (f0 - b.fill) * b.lut.capacity_ml
	var acc := LeakStream.landed_ml + LeakStream.lost_ml + LeakStream.in_flight_total()
	_check(absf(drained - LeakStream.emitted_ml) < 0.01 * drained + 0.01 and absf(acc - LeakStream.emitted_ml) < 0.01,
		"jerrycan volume: drained %.1f, emitted %.1f, landed+flight %.1f" % [drained, LeakStream.emitted_ml, acc])


# ---------------------------------------------------------------- C: dry hole above the level, tip, tip back
func _test_dry_hole_tip() -> void:
	print("== C: hole above the level, tip, tip back")
	await _clear()
	var b := _spawn(PET, Vector3(2.0, 0.001, 0.0), 0.5)
	await _frames(3)
	_shoot(b, Vector3(0, 0.16, 0), Vector3(1, 0, 0), 100.0, 0.0045)
	await _frames(20)
	_check(b.leaks.size() == 1 and b.hole_marks.size() == 1, "dry hole: 1 leak record, 1 mark")
	_check(LeakStream.live.is_empty() and not b.leak_flowing, "upright: no stream")
	_check(not b.is_physics_processing(), "upright, dry: no per-frame leak work")
	var f0 := b.fill
	# tip over: axis to world -X... hole (local -X side) faces down
	b.global_transform = Transform3D(Basis(Vector3(0, 0, 1), deg_to_rad(90.0)), Vector3(2.0, 0.05, 0.0))
	b.wake_leaks()
	await _frames(6)
	var ss := _streams_of(b)
	var hw: Vector3 = b.global_transform * (b.leaks[0]["p"] as Vector3)
	_check(ss.size() == 1 and (ss[0] as LeakStream).p0.distance_to(hw) < 0.001, "tipped: stream starts at the hole")
	_check(b.fill < f0, "tipped: fill drops %.4f -> %.4f" % [f0, b.fill])
	b.global_transform = Transform3D(Basis.IDENTITY, Vector3(2.0, 0.001, 0.0))
	await _frames(3)
	var s: LeakStream = ss[0] if ss.size() > 0 else null
	_check(s != null and (s.stopping or s.finished), "upright again: stream stops")
	await _frames(60)
	_check(LeakStream.live.is_empty() and not b.is_physics_processing(), "upright again: stream gone, no per-frame work")
	b.global_transform = Transform3D(Basis(Vector3(0, 0, 1), deg_to_rad(90.0)), Vector3(2.0, 0.05, 0.0))
	b.wake_leaks()
	await _frames(6)
	_check(_streams_of(b).size() == 1, "tipped a second time: stream restarts")
	var acc := LeakStream.landed_ml + LeakStream.lost_ml + LeakStream.in_flight_total()
	var dr := (f0 - b.fill) * b.lut.capacity_ml
	_check(absf(dr - LeakStream.emitted_ml) < 0.05 and absf(acc - LeakStream.emitted_ml) < 0.01, "tip test volume: drained %.3f, emitted %.3f, landed+flight %.3f" % [dr, LeakStream.emitted_ml, acc])


# ---------------------------------------------------------------- D: lying bottle drains to the hole height
func _test_lying_level() -> void:
	print("== D: PET lying on its side, hole below the level")
	await _clear()
	var b := _spawn(PET, Vector3(-1.0, 0.04, 2.0), 0.6, true, Vector3(0, 0, 90))
	await _frames(3)
	var c := b.global_transform * Vector3(0, 0.08, 0)
	b.hit_by_projectile(c + Vector3(0, -0.012, 0), Vector3(0, 0, -1), 100.0, 0.009)
	var k := 0
	await _frames(5)
	_check(b.leak_flowing, "lying: hole below the level leaks")
	while b.leak_flowing and k < 4800:
		await _frames(10)
		k += 10
		if k % 300 == 0:
			var u_ := b.global_transform.basis.orthonormalized().inverse() * Vector3.UP
			print("    t=%.0f s fill %.4f head %.2f mm proc %s streams %d" % [k / 60.0, b.fill, (b.lut.offset(u_, b.fill) - (b.leaks[0]["p"] as Vector3).dot(u_)) * 1000.0, b.is_physics_processing(), LeakStream.live.size()])
	var up := b.global_transform.basis.orthonormalized().inverse() * Vector3.UP
	var p: Vector3 = b.leaks[0]["p"]
	var head := b.lut.offset(up, b.fill) - p.dot(up)
	var f_exp := b.lut.fill_for_offset(up, p.dot(up))
	var f_hi := b.lut.fill_for_offset(up, p.dot(up) + 0.0025)   # leaks stop at 2 mm head
	_check(not b.leak_flowing and head < 0.0025 and head > -0.002, "stopped after %.1f s with the level at the hole (head %.2f mm)" % [k / 60.0, head * 1000.0])
	_check(b.fill >= f_exp and b.fill <= f_hi, "fill %.3f matches the hole height: fill at hole %.3f .. +2.5 mm %.3f" % [b.fill, f_exp, f_hi])


# ---------------------------------------------------------------- E: settled bottle with a dry hole costs nothing, leaks when knocked over
func _test_idle_then_tip() -> void:
	print("== E: settled, dry hole -> idle; knocked over -> leaks")
	await _clear()
	var b := _spawn(PET, Vector3(-3.0, 0.002, -2.0), 0.4, false)
	await _frames(30)
	_shoot(b, Vector3(0, 0.17, 0), Vector3(1, 0, 0), 15.0, 0.0045)
	await _frames(20)
	var k := 20
	while not b.sleeping and k < 600:
		await _frames(10)
		k += 10
	await _frames(5)
	print("    sleeping %s proc %s flowing %s streams %d fill %.3f hole y %.3f" % [b.sleeping, b.is_physics_processing(), b.leak_flowing, LeakStream.live.size(), b.fill, (b.leaks[0]["p"] as Vector3).y])
	_check(b.sleeping and not b.is_physics_processing() and LeakStream.live.is_empty(), "asleep with a dry hole: physics process off, no stream (%.1f s)" % (k / 60.0))
	var hp: Vector3 = b.leaks[0]["p"]
	var ang := atan2(hp.z, hp.x)
	# lay it down with the hole facing the floor, slightly above it (it drops, wakes, _integrate_forces restarts the leak check)
	var bas := Basis(Vector3(0, 0, 1), deg_to_rad(90.0)) * Basis(Vector3.UP, ang - PI)
	b.global_transform = Transform3D(bas, Vector3(-3.0, 0.045, -2.0))
	b.sleeping = false
	k = 0
	while _streams_of(b).is_empty() and k < 60:
		await _frames(1)
		k += 1
	_check(not _streams_of(b).is_empty(), "knocked over: stream starts after %d frames" % k)


# ---------------------------------------------------------------- F: caps, tiers
func _test_caps_and_tiers() -> void:
	print("== F: caps / tiers")
	await _clear()
	var bs: Array[BreakableBottle] = []
	for i in 8:
		var b := _spawn(PET, Vector3(-3.5 + i * 0.35, 0.001, 3.0), 0.9)
		bs.append(b)
	await _frames(3)
	for b in bs:
		_shoot(b, Vector3(0, 0.05, 0), Vector3(0, 0, 1))
	await _frames(20)
	_check(LeakStream.live.size() == LeakStream.MAX_STREAMS, "16 wet holes -> %d streams (cap %d), rest droplets (%d live)" % [LeakStream.live.size(), LeakStream.MAX_STREAMS, mgr.live_droplets])
	var b0 := bs[0]
	for i in 4:
		_shoot(b0, Vector3(0, 0.08 + i * 0.02, 0), Vector3(1, 0, 0.2 * i))
	_check(b0.leaks.size() == 3 and b0.hole_marks.size() == BulletHoleMark.MAX_PER_BOTTLE, "per bottle: %d leaks (max 3), %d marks (max %d)" % [b0.leaks.size(), b0.hole_marks.size(), BulletHoleMark.MAX_PER_BOTTLE])
	await _clear()
	QualityTier.set_tier(1)
	await _frames(2)
	var bm := _spawn(PET, Vector3(0, 0.001, 3.0), 0.9)
	await _frames(3)
	_shoot(bm, Vector3(0, 0.05, 0), Vector3(0, 0, 1))
	await _frames(20)
	_check(LeakStream.live.is_empty() and mgr.live_droplets > 0 and bm.hole_marks.size() == 2, "MEDIUM: droplets (%d), no tube (%d), marks %d" % [mgr.live_droplets, LeakStream.live.size(), bm.hole_marks.size()])
	QualityTier.set_tier(3)
	await _frames(2)
	var bn := _spawn(PET, Vector3(0.5, 0.001, 3.0), 0.9)
	await _frames(3)
	_shoot(bn, Vector3(0, 0.05, 0), Vector3(0, 0, 1))
	_check(bn.hole_marks.is_empty() and bn.leaks.size() == 2, "MINIMAL: no marks (leaks still %d)" % bn.leaks.size())
	QualityTier.set_tier(0)


# ---------------------------------------------------------------- hitscan 500 m must terminate (float32 segment-end rounding)
func _test_hitscan_long_range() -> void:
	print("== G: FastImpact.fire hitscan, range 500 m, through bottles")
	await _clear()
	var a := _spawn(PET, Vector3(3.0, 1.0, 0.0), 0.8)
	var b := _spawn(PET, Vector3(3.6, 1.0, 0.0), 0.8)
	await _frames(3)
	var space := get_world_3d().direct_space_state
	var t0 := Time.get_ticks_msec()
	var res := FastImpact.fire(space, Vector3(0, 1.03, 0), Vector3.RIGHT, 2000.0, 0.009, BottleFactory.MASK_BOTTLE, 500.0, 0.0, [], 0.55)
	_check(Time.get_ticks_msec() - t0 < 2000, "hitscan 500 m terminates quickly (%d ms)" % (Time.get_ticks_msec() - t0))
	_check(res.size() >= 1 and res.size() <= 8, "hitscan hit the bottles (%d results)" % res.size())
	for r in res:
		_check(absf((r["point"] as Vector3).z) < 0.2 and (r["point"] as Vector3).x > 2.5, "hit point sane %s" % str(r["point"]))
	# miss entirely, and a start far from the origin (large float32 coordinates)
	var m := FastImpact.fire(space, Vector3(0, 5.0, 0), Vector3(1, 0.001, 0.3), 500.0, 0.009, BottleFactory.MASK_BOTTLE, 500.0, 0.0)
	_check(m.is_empty(), "hitscan miss returns nothing")
	var far := FastImpact.fire(space, Vector3(-480.0, 1.03, 0), Vector3.RIGHT, 2000.0, 0.009, BottleFactory.MASK_BOTTLE, 500.0, 0.0)
	_check(far.size() >= 0, "hitscan from 480 m away terminates")
	await _clear()


# ---------------------------------------------------------------- swap_model keeps glass_node (Glass* or Body* shell)
func _test_swap_model_glass() -> void:
	print("== H: BottleFactory.swap_model keeps glass_node")
	for id in ["design_container_jerrycan_fuel", "bottle_v2_pet500", "container_tumbler"]:
		var b := _spawn(id, Vector3(0, TOP + 0.001, 0), 0.5)
		await _frames(2)
		if b == null or b.glass_node == null:
			_check(false, "%s spawned without glass_node" % id)
			continue
		var info: Dictionary = b.get_meta("bottle_info")
		BottleFactory.swap_model(b, BottleFactory.variant_path(info, 0, 0))
		await _frames(2)
		_check(b.glass_node != null and b.model.is_ancestor_of(b.glass_node), "%s: glass_node kept after swap_model" % id)
		b.queue_free()
	await _clear()


# ---------------------------------------------------------------- screenshots
func _shots(dir: String) -> void:
	DirAccess.make_dir_recursive_absolute(dir)
	var b := _spawn(PET, Vector3(0.70, TOP + 0.001, 0.0), 0.85)
	var c := _spawn(CAN, Vector3(0.1, TOP + 0.001, -0.1), 0.7)
	await _frames(3)
	_shoot(b, Vector3(0, 0.06, 0), Vector3(1, 0, 0.25))
	_shoot(c, Vector3(0, 0.1, 0), Vector3(0.6, 0, 1))
	cam.look_at_from_position(Vector3(1.25, 1.05, 1.15), Vector3(0.62, 0.55, 0.05), Vector3.UP)
	await _frames(40)
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(dir + "/leak_streams.png")
	print("shot leak_streams")
	# a PET shot above its level (never leaked) + the drained one: marks after the leaks stopped
	var d := _spawn(PET, Vector3(0.45, TOP + 0.001, 0.25), 0.3)
	await _frames(3)
	_shoot(d, Vector3(0, 0.15, 0), Vector3(0.3, 0, -1), 100.0, 0.0045)
	var k := 0
	while b.leak_flowing and k < 2400:
		await _frames(20)
		k += 20
	await _frames(60)
	var hw: Vector3 = d.global_transform * (d.leaks[0]["p"] as Vector3)
	cam.fov = 30
	cam.look_at_from_position(hw + Vector3(0.05, 0.06, 0.32), (hw + b.global_transform * (b.leaks[0]["p"] as Vector3)) * 0.5, Vector3.UP)
	await _frames(5)
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(dir + "/hole_marks.png")
	print("shot hole_marks (leak stopped: ", not b.leak_flowing, ", streams ", LeakStream.live.size(), ")")


func _box(size: Vector3, pos: Vector3, col: Color) -> void:
	var sb := StaticBody3D.new()
	sb.collision_layer = 1
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
	var bs := BoxShape3D.new()
	bs.size = size
	cs.shape = bs
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
	_box(TABLE_SIZE, Vector3(0, TOP * 0.5, 0), Color(0.42, 0.28, 0.17))
	cam = Camera3D.new()
	cam.fov = 50
	add_child(cam)
	cam.current = true
	cam.look_at_from_position(Vector3(0, 1.6, 2.5), Vector3(0, 0.7, 0), Vector3.UP)
