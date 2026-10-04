class_name BottleBreakBench
extends Node
## Cost per realism tier. Run headless with a fixed step so frames take as long as the work does:
##   godot --headless --path . --fixed-fps 60 -- --bench
## Breaks N half-full wine bottles at once per tier, then reports the average script+physics wall time per frame
## (rendering excluded: headless), peak live shards/droplets/puddles, and the idle cost of intact bottles.

const N_BOTTLES := 10
const FRAMES := 240
var world: Node3D
var cam: Camera3D


func run(floor_builder: Callable) -> void:
	await get_tree().process_frame
	world = Node3D.new()
	add_child(world)
	floor_builder.call(world)
	cam = Camera3D.new()
	world.add_child(cam)
	cam.position = Vector3(0, 1.5, 4)
	cam.current = true
	var mgr := BottleBreakManager.get_for(self)
	await get_tree().physics_frame
	var rows := []
	print("== idle: %d intact resting bottles ==" % N_BOTTLES)
	var idle := await _idle()
	print("  %.3f ms/frame (physics bodies asleep, bottle _physics_process off, manager off: %s)" % [idle, str(not mgr.is_physics_processing())])
	print("== break cost per tier (%d half-full wine bottles shattered in view, %d frames) ==" % [N_BOTTLES, FRAMES])
	print("%-8s %9s %10s %9s %9s %9s %8s" % ["tier", "ms/frame", "peak_ms", "shards", "droplets", "puddles", "bodies"])
	for q in 4:
		rows.append(await _tier(mgr, q, false))
	rows.append(await _tier(mgr, BottleBreakManager.Quality.HIGH, true))
	var f := FileAccess.open(ProjectSettings.globalize_path("res://bench_report.json"), FileAccess.WRITE)
	f.store_string(JSON.stringify({"idle_ms": idle, "rows": rows}, "\t"))
	f.close()
	print("BENCH done")
	get_tree().quit()


func _bottle(x: float) -> BreakableBottle:
	var b := BreakableBottle.create("wine", 0.5)
	b.use_flaw = false
	b.free_on_break = true
	world.add_child(b)
	b.global_position = Vector3(x, 0.02, 0)
	return b


func _idle() -> float:
	var t_e := Time.get_ticks_usec()
	for i in FRAMES:
		await get_tree().physics_frame
	print("  baseline with no bottles: %.3f ms/frame (loop overhead)" % ((Time.get_ticks_usec() - t_e) / 1000.0 / FRAMES))
	var bs := []
	for i in N_BOTTLES:
		bs.append(_bottle(-2.0 + i * 0.4))
	for i in 180:   # let them settle and fall asleep
		await get_tree().physics_frame
	var t0 := Time.get_ticks_usec()
	for i in FRAMES:
		await get_tree().physics_frame
	var ms := (Time.get_ticks_usec() - t0) / 1000.0 / FRAMES
	for b in bs:
		b.queue_free()
	await get_tree().physics_frame
	return ms


## far = camera moved 60 m away, so the "in view" tier falls back to MINIMAL.
func _tier(mgr: BottleBreakManager, q: int, far: bool) -> Dictionary:
	mgr.set_quality(q)
	mgr.clear_debris()
	cam.position = Vector3(0, 1.5, 70) if far else Vector3(0, 1.5, 4)
	cam.look_at(Vector3(0, 0.3, 0))
	var bs := []
	for i in N_BOTTLES:
		bs.append(_bottle(-2.0 + i * 0.4))
	await get_tree().physics_frame
	await get_tree().physics_frame
	var t_all := 0.0
	var t_peak := 0.0
	var pk_s := 0
	var pk_d := 0
	var pk_p := 0
	for i in N_BOTTLES:
		(bs[i] as BreakableBottle).apply_impact(bs[i].global_position + Vector3(0, 0.12, 0.03), Vector3(0, 0, 1), 40.0,
			{"mass": 5.0, "sharp": 1.0, "surface": "concrete", "speed": 8.0})
	for i in FRAMES:
		var t0 := Time.get_ticks_usec()
		await get_tree().physics_frame
		var dt := (Time.get_ticks_usec() - t0) / 1000.0
		t_all += dt
		t_peak = maxf(t_peak, dt)
		pk_s = maxi(pk_s, mgr.live_shards)
		pk_d = maxi(pk_d, mgr.live_droplets)
		pk_p = maxi(pk_p, mgr._puddles.size())
	var bodies := mgr.live_shards
	var name: String = BottleBreakManager.TIERS[q]["name"] + (" (far)" if far else "")
	print("%-8s %9.3f %10.3f %9d %9d %9d %8d" % [name, t_all / FRAMES, t_peak, pk_s, pk_d, pk_p, bodies])
	mgr.clear_debris()
	return {"tier": name, "ms_frame": t_all / FRAMES, "peak_ms": t_peak, "peak_shards": pk_s, "peak_droplets": pk_d, "peak_puddles": pk_p}
