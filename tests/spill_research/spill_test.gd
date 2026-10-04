extends Node3D
## Headless numeric test for the spill prototype (docs/spill_system_research.md).
##   Godot --headless --path tests/spill_research
## Scene: a 0.24 x 0.24 m shelf (BoxShape3D, top at y = 0.90) over a floor. 200 ml is poured 3 cm from the +x edge at
## 25 ml/s. Surface knowledge = 1 ray to find the collider (box top face computed analytically) + 1 cached ray per
## overflowing edge for the drop height. Checks: exact volume ledger, water vs honey drip/strand behaviour,
## zero cost at rest (runner stops processing), ray budget. Also times a GDScript height-field step (option a).

const Proto := preload("res://spill_proto.gd")
const DT := 1.0 / 60.0
const POUR_ML := 200.0
const POUR_RATE := 25.0          ## ml/s
const SIM_T := 300.0
const SHELF_TOP := 0.9

var rays := 0
var _frame := 0
var _fails := 0
var _runner: Node
var _runner_calls_at_check := 0


class Runner extends Node:
	## What SpillSystem does per frame: step awake sims, stop processing when all sleep.
	var sims: Array = []
	var calls := 0
	var _acc := {}
	func _physics_process(dt: float) -> void:
		calls += 1
		var awake := false
		for s in sims:
			var iv: float = s.tick_interval()
			if iv == INF:
				continue
			awake = true
			_acc[s] = float(_acc.get(s, 0.0)) + dt
			if _acc[s] >= iv:
				s.step(_acc[s])
				_acc[s] = 0.0
		if not awake:
			set_physics_process(false)


func _ready() -> void:
	_box(Vector3(0.24, 0.04, 0.24), Vector3(0.0, SHELF_TOP - 0.02, 0.0))
	_box(Vector3(4.0, 0.1, 4.0), Vector3(0.0, -0.05, 0.0))


func _box(size: Vector3, pos: Vector3) -> void:
	var b := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = size
	cs.shape = bs
	b.add_child(cs)
	add_child(b)
	b.position = pos


func _ray(from: Vector3, to: Vector3) -> Dictionary:
	rays += 1
	return get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(from, to))


## Top face of the box hit under p: [face transform (y = normal), half_x, half_z] or [] if not a box.
func _face_under(p: Vector3) -> Array:
	var hit := _ray(p + Vector3.UP * 0.05, p + Vector3.DOWN * 0.5)
	if hit.is_empty():
		return []
	var co := hit["collider"] as CollisionObject3D
	var owner_id := co.shape_find_owner(int(hit["shape"]))
	var shape := co.shape_owner_get_shape(owner_id, 0)
	if not shape is BoxShape3D:
		return []
	var xf := co.global_transform * co.shape_owner_get_transform(owner_id)
	var s: Vector3 = (shape as BoxShape3D).size * 0.5
	# the box Y axis is up here; the general case picks the axis best aligned with the hit normal (as _box_top_rect does)
	var face := Transform3D(xf.basis.orthonormalized(), xf * Vector3(0.0, s.y, 0.0))
	return [face, s.x, s.z]


func _floor_drop(p: Vector3) -> float:
	var hit := _ray(p, p + Vector3.DOWN * 10.0)
	return p.y - float(hit["position"].y) if not hit.is_empty() else 10.0


func _physics_process(_dt: float) -> void:
	_frame += 1
	if _frame == 3:
		_run()
	elif _frame == 4:
		_runner_calls_at_check = _runner.calls
	elif _frame == 64:
		_check("zero cost at rest: runner ticks at most once, then stops processing (60 frames)", _runner.calls <= 1 and not _runner.is_physics_processing(),
			"calls %d -> %d, processing %s" % [_runner_calls_at_check, _runner.calls, _runner.is_physics_processing()])
		print("\nRESULT: %s (%d failures)" % ["PASS" if _fails == 0 else "FAIL", _fails])
		get_tree().quit(1 if _fails > 0 else 0)


func _check(name: String, ok: bool, info: String) -> void:
	if not ok:
		_fails += 1
	print("[%s] %s  (%s)" % ["PASS" if ok else "FAIL", name, info])


func _simulate(id: String) -> Dictionary:
	var pour := Vector3(0.09, SHELF_TOP + 0.1, 0.01)
	var rays0 := rays
	var f := _face_under(pour)
	var sim = Proto.new(id, f[0], f[1], f[2])
	sim.floor_query = _floor_drop
	var poured := 0.0
	var t_active := 0.0
	var max_us := 0
	var tot_us := 0
	var n := int(SIM_T / DT)
	var sleep_t := -1.0
	var max_err := 0.0
	var r5 := 0.0
	var floor_hist := PackedFloat32Array()
	var creep_acc := 0.0
	var sim_steps := 0
	for i in n:
		var t := i * DT
		if poured < POUR_ML:
			var ml := minf(POUR_RATE * DT, POUR_ML - poured)
			poured += ml
			sim.add_liquid(Vector3(pour.x, SHELF_TOP, pour.z), ml * 1.0e-6)
		var was_awake: bool = not sim.asleep
		var t0 := Time.get_ticks_usec()
		creep_acc += DT
		if sim.tick_interval() <= creep_acc:      # same scheduling as Runner: per tick when ACTIVE, 1 Hz when CREEPing
			sim.step(creep_acc)
			creep_acc = 0.0
			sim_steps += 1
		var us := Time.get_ticks_usec() - t0
		if was_awake:
			t_active += DT
			tot_us += us
			max_us = maxi(max_us, us)
		max_err = maxf(max_err, absf(sim.ledger_error()))
		floor_hist.append(sim.v_floor)
		if absf(t - 5.0) < DT * 0.5:
			r5 = sim.R
		if sim.asleep and sleep_t < 0.0 and poured >= POUR_ML:
			sleep_t = t
	var dts: PackedFloat32Array = sim.drop_times
	var interval := (dts[dts.size() - 1] - dts[0]) / (dts.size() - 1) if dts.size() > 1 else -1.0
	var t_half := -1.0   # time from the first overflow until half of the final floor volume has arrived
	for i in floor_hist.size():
		if floor_hist[i] >= 0.5 * sim.v_floor and sim.v_floor > 0.0:
			t_half = i * DT - sim.first_overflow
			break
	return {"t_half": t_half, "sim": sim, "steps": sim_steps, "err_ml": max_err * 1.0e6, "rays": rays - rays0, "sleep_t": sleep_t, "r5": r5,
		"interval": interval, "avg_us": float(tot_us) / maxf(1.0, t_active / DT), "max_us": max_us}


func _run() -> void:
	print("liquid       lc_mm h_eq_mm h_pin_mm v_drop_ml tau_neck_s strand_s q_jet_ml/s | overflow_s drops  mean_int_s strand_site_s rope_s t_half  R5s_cm R_end_cm floor_ml sleep_s err_ml rays avg_us max_us")
	var res := {}
	for id in Proto.LIQUIDS.keys():
		var r := _simulate(id)
		res[id] = r
		var s = r["sim"]
		var L: Dictionary = s.liq
		print("%-11s %6.2f %7.2f %8.2f %9.3f %10.3f %8.2f %10.2f | %10.2f %5d %11.3f %8.1f %5.2f %6.1f %7.1f %8.1f %8.1f %7.1f %8s %4d %6.0f %6d" % [
			id, L["lc"] * 1e3, L["h_eq"] * 1e3, L["h_pin"] * 1e3, L["v_drop"] * 1e6, L["tau_neck"], L["tau_strand"] if L["strand"] else 0.0,
			L["q_jet"] * 1e6, s.first_overflow, s.drops, r["interval"], s.strand_time, s.jet_time, r["t_half"], r["r5"] * 100.0, s.R * 100.0,
			s.v_floor * 1e6, r["sleep_t"], String.num_scientific(snappedf(r["err_ml"], 1e-12)), r["rays"], r["avg_us"], r["max_us"]])
	var w = res["water"]["sim"]
	var hn = res["honey"]["sim"]
	print("")
	for id in res:
		_check("volume conserved (%s)" % id, res[id]["err_ml"] < 1.0e-6, "max ledger error %s ml" % String.num_scientific(res[id]["err_ml"]))
	_check("water overflows the edge and drips", w.first_overflow > 0.0 and w.drops >= 20, "first %.2f s, %d drops" % [w.first_overflow, w.drops])
	_check("honey overflows as a strand, water never strands", hn.strand_time > 1.0 and w.strand_time == 0.0,
		"honey strand %.1f s, water %.1f s" % [hn.strand_time, w.strand_time])
	_check("honey drips far less often than water", hn.drops * 5 < w.drops and (res["honey"]["interval"] < 0.0 or res["honey"]["interval"] > 3.0 * res["water"]["interval"]),
		"drops water %d / honey %d, mean interval water %.3f s / honey %.3f s" % [w.drops, hn.drops, res["water"]["interval"], res["honey"]["interval"]])
	_check("honey spreads slower than water", res["honey"]["r5"] < 0.75 * res["water"]["r5"], "R(5 s) water %.1f cm / honey %.1f cm" % [res["water"]["r5"] * 100, res["honey"]["r5"] * 100])
	var pinned_ml := POUR_ML - float(w.liq["h_pin"]) * 0.24 * 0.24 * 1.0e6
	var w_out: float = (w.v_floor + w.on_edges()) * 1.0e6
	_check("water stays pinned at the edge until the shelf holds h_pin (overflow = poured - h_pin * area)", absf(w_out - pinned_ml) < 0.25 * pinned_ml,
		"over the edge %.1f ml, predicted %.1f ml" % [w_out, pinned_ml])
	var Lw := Proto.derive("water")
	var Lh := Proto.derive("honey")
	var fw := Proto.edge_flux(Lw, float(Lw["h_pin"]) + 0.001, 0.001, 0.03)
	var fh := Proto.edge_flux(Lh, float(Lh["h_pin"]) + 0.001, 0.001, 0.03)
	_check("edge flux at 1 mm excess: honey << water", fh < 0.1 * fw, "per 10 cm of edge: water %.2f ml/s, honey %.3f ml/s" % [fw * 1e5, fh * 1e5])
	var all_sleep := true
	var max_rays := 0
	for id in res:
		all_sleep = all_sleep and res[id]["sleep_t"] > 0.0
		print("[INFO] %-10s sim steps %5d (%.0f %% of physics ticks), settles at %.1f s" % [id, res[id]["steps"], 100.0 * res[id]["steps"] / (SIM_T / DT), res[id]["sleep_t"]])
		max_rays = maxi(max_rays, res[id]["rays"])
	_check("every liquid settles (sleeps) within %d s" % int(SIM_T), all_sleep, "")
	_check("ray budget: <= 1 face ray + 1 per overflowing edge, none per step", max_rays <= 5, "max %d rays per spill" % max_rays)
	# zero cost at rest: hand the settled sims to a runner node; it must stop on its first tick
	_runner = Runner.new()
	for id in res:
		_runner.sims.append(res[id]["sim"])
	add_child(_runner)
	_bench_grid(32)
	_bench_grid(64)


## Option (a) cost probe: one virtual-pipe shallow-water step (4 outflow pipes per cell, implicit viscous damping) on an
## n x n grid in GDScript. Reports ms per step.
func _bench_grid(n: int) -> void:
	var hh := PackedFloat32Array()
	hh.resize(n * n)
	hh.fill(0.002)
	var fl := [PackedFloat32Array(), PackedFloat32Array(), PackedFloat32Array(), PackedFloat32Array()]
	for a in fl:
		a.resize(n * n)
		a.fill(0.0)
	var fr: PackedFloat32Array = fl[0]
	var fle: PackedFloat32Array = fl[1]
	var fu: PackedFloat32Array = fl[2]
	var fd: PackedFloat32Array = fl[3]
	hh[n * n / 2 + n / 2] = 0.01
	var dx := 0.005
	var dt := 1.0 / 60.0
	var damp := 1.0 / (1.0 + dt * 3.0 * 0.001 / (1000.0 * 0.002 * 0.002))
	var k := dt * 9.81 / dx
	var steps := 20
	var t0 := Time.get_ticks_usec()
	for it in steps:
		for y in n:
			for x in n:
				var i := y * n + x
				var h0 := hh[i]
				var a := maxf(0.0, (fr[i] + k * (h0 - hh[i + 1])) * damp) if x < n - 1 else 0.0
				var b := maxf(0.0, (fle[i] + k * (h0 - hh[i - 1])) * damp) if x > 0 else 0.0
				var cc := maxf(0.0, (fu[i] + k * (h0 - hh[i + n])) * damp) if y < n - 1 else 0.0
				var d := maxf(0.0, (fd[i] + k * (h0 - hh[i - n])) * damp) if y > 0 else 0.0
				var s := a + b + cc + d
				var lim := minf(1.0, h0 * dx / maxf(s * dt, 1e-12))
				fr[i] = a * lim
				fle[i] = b * lim
				fu[i] = cc * lim
				fd[i] = d * lim
		for y in n:
			for x in n:
				var i := y * n + x
				var inflow := (fr[i - 1] if x > 0 else 0.0) + (fle[i + 1] if x < n - 1 else 0.0) + (fu[i - n] if y > 0 else 0.0) + (fd[i + n] if y < n - 1 else 0.0)
				hh[i] += dt / dx * (inflow - fr[i] - fle[i] - fu[i] - fd[i])
	var ms := (Time.get_ticks_usec() - t0) / 1000.0 / steps
	print("[INFO] option (a) GDScript virtual-pipe grid %dx%d: %.2f ms per step (dev PC)" % [n, n, ms])
