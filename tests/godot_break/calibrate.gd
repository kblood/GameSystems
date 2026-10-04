class_name BreakCalibration
extends Node
## Headless calibration: binary-searches the impact speed that breaks each bottle in real physics drops and compares
## it with BottleBreakProfile.critical_speed(). Run:
##   godot --headless --path . --fixed-fps 60 -- --calibrate        (writes calibration_report.json)
## --fixed-fps removes real-time sync, so a 1 s drop costs a few ms.

const BOTTLES := ["wine", "beer", "soda", "whiskey", "jar", "flask"]
const FILLS := [0.0, 0.5, 1.0]
const SURFACES := ["concrete", "wood", "carpet"]
const V_MAX := 30.0

var world: Node3D
var mgr: BottleBreakManager
var _pads := {}
var _results: Array = []
var debug := false


func run() -> void:
	await get_tree().process_frame
	world = Node3D.new()
	add_child(world)
	var x := 0.0
	for s in ["concrete", "wood", "carpet"]:
		_pads[s] = TestWorld.pad(world, Vector3(x, 0, 0), Vector3(3, 0.2, 3), s)
		x += 4.0
	mgr = BottleBreakManager.get_for(self)
	await get_tree().physics_frame
	var t0 := Time.get_ticks_msec()
	print("== threshold search: measured (physics) vs analytic (profile.critical_speed), flaw/fatigue off ==")
	print("%-8s %-5s %-9s %-6s | %8s %7s | %8s %7s | %s" % ["bottle", "fill", "surface", "orient", "v_meas", "h_m", "v_calc", "h_m", "meas/calc"])
	for b in BOTTLES:
		for f in FILLS:
			for s in SURFACES:
				for o in (["side", "base"] if s == "concrete" else ["side"]):
					await _search(b, f, s, o)
	await _scenarios()
	var rep := {"rows": _results, "seconds": (Time.get_ticks_msec() - t0) / 1000.0}
	var f := FileAccess.open(ProjectSettings.globalize_path("res://calibration_report.json"), FileAccess.WRITE)
	f.store_string(JSON.stringify(rep, "\t"))
	f.close()
	print("CALIBRATION done in %.1f s, report written" % rep["seconds"])
	get_tree().quit()


func _search(name: String, fill: float, surface: String, orient: String) -> void:
	var probe := await _trial(name, fill, surface, orient, V_MAX)
	var prof := BottleBreakProfile.for_bottle(name)
	var row := {"bottle": name, "fill": fill, "surface": surface, "orient": orient}
	if not probe["broke"]:
		row["v_meas"] = -1.0
		row["v_calc"] = -1.0 if prof.material == "plastic" else _calc(name, fill, surface, float(probe["y"]))
		_results.append(row)
		print("%-8s %-5.1f %-9s %-6s | %8s %7s | %8s %7s |" % [name, fill, surface, orient, ">%d" % int(V_MAX), "-",
			"never" if prof.material == "plastic" else "%.2f" % float(row["v_calc"]), "-"])
		return
	var lo := 0.3
	var hi := V_MAX
	var y: float = probe["y"]
	for i in 11:
		var mid := 0.5 * (lo + hi)
		var r := await _trial(name, fill, surface, orient, mid)
		if r["broke"]:
			hi = mid
		else:
			lo = mid
		if r["broke"]:
			y = r["y"]
	var vc := _calc(name, fill, surface, y)
	row["v_meas"] = hi
	row["v_calc"] = vc
	row["h_meas"] = hi * hi / 19.62
	row["h_calc"] = vc * vc / 19.62
	row["y"] = y
	_results.append(row)
	print("%-8s %-5.1f %-9s %-6s | %8.2f %7.2f | %8.2f %7.2f | %.2f" % [name, fill, surface, orient, hi,
		hi * hi / 19.62, vc, vc * vc / 19.62, hi / vc])


func _calc(name: String, fill: float, surface: String, y: float) -> float:
	var prof := BottleBreakProfile.for_bottle(name)
	var tmp := BreakableBottle.create(name, fill)   # to get the mesh-derived mass
	var p := tmp.profile
	tmp.free()
	return p.critical_speed(surface, fill, y)


## One drop/throw at speed v (downwards). Returns {broke, y (contact height on the axis), ratio}.
func _trial(name: String, fill: float, surface: String, orient: String, v: float) -> Dictionary:
	mgr.clear_debris()
	var b := BreakableBottle.create(name, fill)
	b.use_flaw = false; b.debug_contacts = debug
	b.use_fatigue = false
	b.free_on_break = false
	b.debug_contacts = debug
	var res := {"broke": false, "y": -1.0, "ratio": 0.0}
	b.impact_assessed.connect(func(info: Dictionary):
		if res["y"] < 0.0:
			res["y"] = info["y"]
			res["ratio"] = info["ratio"])
	b.broke.connect(func(_p, _e, _k): res["broke"] = true)
	world.add_child(b)
	var px: float = _pads[surface].position.x
	if orient == "side":
		b.rotation = Vector3(0, 0, PI * 0.5)
		b.global_position = Vector3(px - b.profile.height * 0.3, 0.075 + 0.02, 0)
	else:
		b.global_position = Vector3(px, 0.03, 0)
	var gap := maxf(0.05, 3.0 * v / 60.0)   # >= 2 physics steps of free flight so the pre-impact velocity is observed
	b.global_position.y += gap
	b.linear_velocity = Vector3(0, -sqrt(maxf(v * v - 2.0 * 9.81 * gap, 0.0)), 0)
	var after := 0
	for i in 70:
		await get_tree().physics_frame
		if res["y"] > 0.0:
			after += 1   # judge the first assessed impact only (not a later topple)
		if res["broke"] or after > 2:
			break
	# let the deferred break run
	await get_tree().physics_frame
	b.queue_free()
	return res


func _scenarios() -> void:
	print("== scenarios (hidden flaw + fatigue ON, 40 bottles each, % that broke) ==")
	var rows := [
		["wine", 0.5, "concrete", "side", 4.4, "drop 1.0 m"],
		["wine", 0.5, "concrete", "side", 5.4, "drop 1.5 m"],
		["wine", 0.5, "concrete", "side", 7.0, "thrown 7 m/s"],
		["wine", 1.0, "concrete", "side", 7.0, "thrown 7 m/s"],
		["whiskey", 1.0, "concrete", "side", 7.0, "thrown 7 m/s"],
		["flask", 1.0, "concrete", "side", 7.0, "thrown 7 m/s"],
		["wine", 0.5, "carpet", "side", 2.8, "drop 0.4 m"],
		["wine", 0.5, "carpet", "side", 4.4, "drop 1.0 m"],
		["beer", 0.5, "wood", "side", 4.4, "drop 1.0 m"],
		["soda", 1.0, "concrete", "side", 9.0, "thrown 9 m/s (plastic)"],
	]
	for r in rows:
		var n_broke := 0
		var N := 40
		for k in N:
			var b := BreakableBottle.create(r[0], r[1])
			b.free_on_break = false
			var got := [false]
			b.broke.connect(func(_p, _e, _k): got[0] = true)
			mgr.clear_debris()
			world.add_child(b)
			var px: float = _pads[r[2]].position.x
			b.rotation = Vector3(0, 0, PI * 0.5)
			var gap := maxf(0.05, 3.0 * float(r[4]) / 60.0)
			b.global_position = Vector3(px - b.profile.height * 0.3, 0.095 + gap, 0)
			b.linear_velocity = Vector3(0, -sqrt(maxf(float(r[4]) ** 2 - 2.0 * 9.81 * gap, 0.0)), 0)
			for i in 40:
				await get_tree().physics_frame
				if got[0]:
					break
			await get_tree().physics_frame
			if got[0]:
				n_broke += 1
			b.queue_free()
		_results.append({"scenario": "%s fill %.1f %s %s" % [r[0], r[1], r[2], r[5]], "pct_broke": 100.0 * n_broke / N})
		print("  %-8s fill %.1f on %-8s %-24s -> %3d %% broke" % [r[0], r[1], r[2], r[5], int(100.0 * n_broke / N)])
	# bottle on bottle: B thrown sideways at standing A
	for v in [1.5, 3.0, 6.0, 9.0]:
		var nb := 0
		var N2 := 20
		for k in N2:
			var a := BreakableBottle.create("wine", 0.5)
			var bb := BreakableBottle.create("wine", 0.5)
			a.free_on_break = false
			bb.free_on_break = false
			var got := [false]
			a.broke.connect(func(_p, _e, _k): got[0] = true)
			bb.broke.connect(func(_p, _e, _k): got[0] = true)
			mgr.clear_debris()
			world.add_child(a)
			world.add_child(bb)
			a.global_position = Vector3(0, 0.0, 0)
			bb.rotation = Vector3(0, 0, -PI * 0.5)
			bb.global_position = Vector3(-0.5, 0.15, 0)
			bb.linear_velocity = Vector3(v, 0, 0)
			for i in 40:
				await get_tree().physics_frame
				if got[0]:
					break
			await get_tree().physics_frame
			if got[0]:
				nb += 1
			a.queue_free()
			bb.queue_free()
		_results.append({"scenario": "bottle-on-bottle %.1f m/s" % v, "pct_broke": 100.0 * nb / N2})
		print("  bottle thrown at standing bottle %.1f m/s (wine, half full) -> %3d %% broke (either)" % [v, int(100.0 * nb / N2)])
