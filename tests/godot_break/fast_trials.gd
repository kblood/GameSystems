class_name FastTrials
extends Node
## Randomised fast-mover trials: bullets (hitscan / ballistic / several bottles on one ray), bottles thrown at a thin wall,
## and a plain fast RigidBody3D thrown at a standing bottle. Reports misses / tunnelling with and without prediction.
##   godot --headless --path . --fixed-fps 60 -- --fast

var world: Node3D
var mgr: BottleBreakManager
var rng := RandomNumberGenerator.new()
var report := {}
var _wall: StaticBody3D
var _pad: StaticBody3D


func run(standalone := true) -> void:
	if standalone:
		await get_tree().process_frame
		world = Node3D.new()
		add_child(world)
		mgr = BottleBreakManager.get_for(self)
	rng.seed = 1234
	_pad = TestWorld.pad(world, Vector3(-30, 0, 0), Vector3(20, 0.2, 20), "concrete")
	_wall = StaticBody3D.new()
	_wall.set_meta("break_surface", "concrete")
	_wall.collision_layer = 1
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(0.02, 6.0, 8.0)   # 2 cm thick wall
	cs.shape = bs
	_wall.add_child(cs)
	world.add_child(_wall)
	_wall.global_position = Vector3(30, 3.0, 0)
	await get_tree().physics_frame
	print("== fast movers (randomised, seed 1234) ==")
	await _bullets()
	await _multi()
	await _thrown_wall(true)
	await _thrown_wall(false)
	await _thrown_object(true)
	await _thrown_object(false)
	await _predictor_cost()
	if standalone:
		var f := FileAccess.open(ProjectSettings.globalize_path("res://fast_report.json"), FileAccess.WRITE)
		f.store_string(JSON.stringify(report, "\t"))
		f.close()
		print("FAST done")
		get_tree().quit()


func _standing(x: float, fill := 0.5) -> BreakableBottle:
	var b := BreakableBottle.create("wine", fill)
	b.use_flaw = false
	b.free_on_break = false
	world.add_child(b)
	b.global_position = Vector3(x, 0.002, 0)
	return b


func _bullets() -> void:
	var space := world.get_world_3d().direct_space_state
	var mask := 1 | 256
	for mode in ["hitscan centre", "hitscan grazing (92% of radius)", "ballistic 400 m/s grazing"]:
		var N := 100 if mode != "ballistic 400 m/s grazing" else 50
		var miss := 0
		var broke := 0
		for k in N:
			var b := _standing(-30.0)
			await get_tree().physics_frame
			var y := rng.randf_range(0.03, 0.18)
			var r := 0.034
			var az := rng.randf() * TAU
			var dist := rng.randf_range(3.0, 25.0)
			var el := rng.randf_range(0.0, deg_to_rad(10.0))
			var d := Vector3(cos(az) * cos(el), sin(el), sin(az) * cos(el))   # direction FROM target TO shooter
			var side := d.cross(Vector3.UP).normalized()
			var lateral := 0.0 if mode == "hitscan centre" else (0.92 if rng.randf() < 0.5 else -0.92) * r
			var aim := b.global_position + Vector3(0, y, 0) + side * lateral
			var speed := 400.0 if mode.begins_with("ballistic") else 0.0
			if speed > 0.0:
				var t := dist / speed
				aim.y += 0.5 * 9.81 * t * t   # aim compensation for drop
			var from := aim + d * dist
			var res := FastImpact.fire(space, from, -d, 500.0, 0.009, mask, dist + 5.0, speed)
			await get_tree().physics_frame
			await get_tree().physics_frame
			if res.is_empty():
				miss += 1
			elif b.state == &"shattered" or b.state == &"neck_snapped":
				broke += 1
			b.queue_free()
			await get_tree().physics_frame
		print("  bullets %-34s %3d trials: %d missed, %d broke" % [mode, N, miss, broke])
		report["bullets " + mode] = {"trials": N, "missed": miss, "broke": broke}


func _multi() -> void:
	var space := world.get_world_3d().direct_space_state
	var N := 30
	var all3 := 0
	var energies := []
	for k in N:
		var bs := []
		for i in 3:
			var b := _standing(-33.0 + i * 0.22)
			bs.append(b)
		await get_tree().physics_frame
		var y := rng.randf_range(0.08, 0.2)
		var res := FastImpact.fire(space, Vector3(-40.0, y, rng.randf_range(-0.01, 0.01)), Vector3.RIGHT, 500.0, 0.009, 1 | 256, 30.0)
		if res.size() == 3:
			all3 += 1
			if energies.is_empty():
				for r in res:
					energies.append(snappedf(r["energy"], 0.1))
		await get_tree().physics_frame
		for b in bs:
			b.queue_free()
		await get_tree().physics_frame
	print("  one 9 mm round through 3 bottles in a row: %d / %d trials hit all three (energy at each: %s J)" % [all3, N, str(energies)])
	report["multi_bottle_ray"] = {"trials": N, "hit_all_three": all3, "energies": energies}


## Bottle thrown at a 2 cm wall: speed 8-60 m/s, incidence 0-75 deg. Expected to break when the normal speed is >= 8 m/s.
func _thrown_wall(predict: bool) -> void:
	var N := 120
	var expected := 0
	var broke := 0
	var tunnel := 0
	var unassessed := 0
	var v_err := 0.0
	var v_err_n := 0
	for k in N:
		var b := BreakableBottle.create("wine", 0.5)
		b.use_flaw = false
		b.use_fatigue = false
		b.free_on_break = false
		b.predict_impacts = predict
		var got := {"info": null}
		b.impact_assessed.connect(func(i): if got["info"] == null: got["info"] = i)
		world.add_child(b)
		var v := rng.randf_range(8.0, 60.0)
		var th := deg_to_rad(rng.randf_range(0.0, 75.0))
		var dir := Vector3(cos(th), 0.0, sin(th) * (1.0 if rng.randf() < 0.5 else -1.0))
		b.global_position = Vector3(30.0 - 1.0 * dir.x, 2.0 - 1.0 * dir.y, -dir.z)
		b.rotation = Vector3(rng.randf() * TAU, rng.randf() * TAU, rng.randf() * TAU)
		b.linear_velocity = dir * v
		b.gravity_scale = 0.0
		var vn := v * dir.x
		for i in 30:
			await get_tree().physics_frame
			if b.state == &"shattered":
				break
			if b.global_position.x > 30.3:
				break
		await get_tree().physics_frame
		var did_break := b.state == &"shattered" or b.state == &"neck_snapped"
		if vn >= 8.0:
			expected += 1
			if did_break:
				broke += 1
				if got["info"] != null:
					v_err += absf(float(got["info"]["v_n"]) - vn) / vn
					v_err_n += 1
			else:
				if b.global_position.x > 30.02:
					tunnel += 1
				if got["info"] == null:
					unassessed += 1
		b.queue_free()
		await get_tree().physics_frame
	var mre := v_err / maxf(v_err_n, 1)
	print("  thrown at 2 cm wall, prediction %-3s: %3d trials with v_n >= 8 m/s -> %d broke, %d tunnelled, %d never assessed; mean |v_n error| %.1f %%" % [
		"ON" if predict else "OFF", expected, broke, tunnel, unassessed, mre * 100.0])
	report["thrown_wall_predict_%s" % ("on" if predict else "off")] = {"expected": expected, "broke": broke, "tunnelled": tunnel,
		"unassessed": unassessed, "mean_vn_error": mre}


## Plain fast sphere (not a bottle) thrown at a standing bottle; only FastImpact.step_thrown helps it.
func _thrown_object(predict: bool) -> void:
	var N := 80
	var expected := 0
	var broke := 0
	var unassessed := 0
	for k in N:
		var b := _standing(-30.0)
		var got := {"n": 0}
		b.impact_assessed.connect(func(_i): got["n"] += 1)
		var s := RigidBody3D.new()
		var cs := CollisionShape3D.new()
		var sh := SphereShape3D.new()
		sh.radius = 0.04
		cs.shape = sh
		s.add_child(cs)
		s.mass = 0.5
		s.collision_layer = 8
		s.collision_mask = 1 | 256
		s.continuous_cd = true
		s.gravity_scale = 0.0
		world.add_child(s)
		var v := rng.randf_range(10.0, 60.0)
		var y := rng.randf_range(0.04, 0.28)
		var lat := rng.randf_range(-1.0, 1.0) * 0.03
		s.global_position = Vector3(-30.0 - 2.0, y, lat)
		s.linear_velocity = Vector3(v, 0, 0)
		await get_tree().physics_frame
		for i in 24:
			if predict:
				FastImpact.step_thrown(s, get_physics_process_delta_time(), 256 | 1)
			await get_tree().physics_frame
			if b.state != &"intact" and b.state != &"neck_snapped":
				break
		await get_tree().physics_frame
		var did := b.state == &"shattered" or b.state == &"neck_snapped"
		if v >= 20.0:
			expected += 1
			if did:
				broke += 1
			elif got["n"] == 0:
				unassessed += 1
		s.queue_free()
		b.queue_free()
		await get_tree().physics_frame
	print("  plain sphere (0.5 kg) at standing bottle, step_thrown %-3s: %3d trials >= 20 m/s -> %d broke, %d never assessed (missed)" % [
		"ON" if predict else "OFF", expected, broke, unassessed])
	report["thrown_object_predict_%s" % ("on" if predict else "off")] = {"expected": expected, "broke": broke, "unassessed": unassessed}


## PathPredictor cache: a free-flying body recomputes ~once per horizon, a bouncing one once per bounce.
func _predictor_cost() -> void:
	for mode in ["free flight", "bouncing"]:
		var s := RigidBody3D.new()
		var cs := CollisionShape3D.new()
		var sh := SphereShape3D.new()
		sh.radius = 0.05
		cs.shape = sh
		s.add_child(cs)
		s.collision_layer = 8
		s.collision_mask = 1
		var pm := PhysicsMaterial.new()
		pm.bounce = 0.7
		s.physics_material_override = pm
		s.linear_damp_mode = RigidBody3D.DAMP_MODE_REPLACE
		s.linear_damp = 0.0
		world.add_child(s)
		var free: bool = (mode == "free flight")
		if free:
			s.gravity_scale = 0.0
			s.global_position = Vector3(-35, 5.0, 0)
			s.linear_velocity = Vector3(8, 0, 0)   # 3 s across empty space
		else:
			s.global_position = Vector3(-39, 3.0, 0)
			s.linear_velocity = Vector3(3, 0, 0)
		await get_tree().physics_frame
		var pp := PathPredictor.new()
		var bounces := 0
		var vy_prev := 0.0
		var frames := 180
		for i in frames:
			pp.step(s, get_physics_process_delta_time(), 1 | 256)
			await get_tree().physics_frame
			if vy_prev < -1.0 and s.linear_velocity.y > vy_prev + 1.5:
				bounces += 1
			vy_prev = s.linear_velocity.y
		var secs := frames / 60.0
		print("  PathPredictor %-11s: %d steps in %.1f s -> %d recomputes (%.2f /s), %d bounces" % [mode, pp.steps, secs, pp.recomputes,
			pp.recomputes / secs, bounces])
		report["predictor_" + mode] = {"steps": pp.steps, "recomputes": pp.recomputes, "bounces": bounces, "seconds": secs}
		s.queue_free()
		await get_tree().physics_frame
