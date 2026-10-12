extends SceneTree
## Diagnostic benchmark of the composed fire-station host, not a headset certification.

const DemoScene = preload("res://demos/sprinkler_fire/fire_station_demo.tscn")
const FireSpread = preload("res://addons/gs_fire_spread/gs_spatial_fire_spread_system.gd")
const WARMUP_TICKS := 20
const MEASURED_TICKS := 200
const FIXED_DELTA := 0.05


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	var demo := DemoScene.instantiate()
	root.add_child(demo)
	await process_frame
	# Adding it to the tree synchronously runs _ready and constructs the full composition.
	var base_count := 2 # Authored spread source and target; the diesel spill registers on ignition.
	var extra_count := FireSpread.MAX_OBJECTS - base_count - 1
	for index in extra_count:
		var id := StringName("benchmark-object-%03d" % index)
		var position := Vector3(float(index % 16) * 0.35, 0.0, float(index / 16) * 0.35)
		if not demo.thermal.add_object(id, {"room_id": &"demo-room", "position": position,
			"temperature_c": 20.0, "ignition_c": 1000000.0, "heat_capacity_kj_c": 1.0e9,
			"flammability": 0.5, "fuel": 100.0, "burn_rate": 0.01}):
			push_error("thermal benchmark object creation failed at %d" % index)
			quit(1)
		if not demo.fire_spread.register_object(id):
			push_error("fire spread benchmark registration failed at %d" % index)
			quit(1)
	# Exercise the authored automatic head and typed runoff path during the measured run.
	if not demo.trigger_runoff_head():
		push_error("could not trigger authored runoff head")
		quit(1)
	var samples: Array[int] = []
	var measured_spray_ml := 0.0
	var warmup_runoff_ml := 0.0
	var measured_runoff_ml := 0.0
	for tick in WARMUP_TICKS + MEASURED_TICKS:
		var start := Time.get_ticks_usec()
		var result: Dictionary = demo.advance(FIXED_DELTA)
		var elapsed := Time.get_ticks_usec() - start
		if not result.get("ok", false):
			push_error("integrated demo tick failed: %s" % result)
			quit(1)
		if tick == WARMUP_TICKS - 1 and demo.fire_spread._object_ids.size() != FireSpread.MAX_OBJECTS:
			push_error("benchmark did not fill the bounded spread set: %d" % demo.fire_spread._object_ids.size())
			quit(1)
		if tick == WARMUP_TICKS - 1:
			var warmup_receipt: Dictionary = demo.sprinkler_source_receipts.get(&"sprinkler:floor-head", {})
			warmup_runoff_ml = float(warmup_receipt.get("puddle_ml", 0.0))
		if tick >= WARMUP_TICKS:
			samples.append(elapsed)
			measured_spray_ml += float(result.get("spray_ml", 0.0))
			var receipt: Dictionary = demo.sprinkler_source_receipts.get(&"sprinkler:floor-head", {})
			measured_runoff_ml = float(receipt.get("puddle_ml", 0.0)) - warmup_runoff_ml
	if measured_spray_ml <= 0.0 or measured_runoff_ml <= 0.0:
		push_error("measured workload did not exercise sprinkler spray and typed puddle runoff: spray=%f puddle=%f" % [
			measured_spray_ml, measured_runoff_ml])
		quit(1)
	samples.sort()
	var total_usec := 0
	for sample: int in samples:
		total_usec += sample
	var p95_index := mini(samples.size() - 1, int(ceil(float(samples.size()) * 0.95)) - 1)
	print("FIRE_STATION_BENCHMARK platform=%s cpu=%s godot=%s mode=headless objects=%d warmup=%d ticks=%d spray_ml=%.1f floor_puddle_ml=%.1f avg_us=%.1f p95_us=%d max_us=%d" % [
		OS.get_name(), OS.get_processor_name(), Engine.get_version_info().string,
		FireSpread.MAX_OBJECTS, WARMUP_TICKS, MEASURED_TICKS,
		measured_spray_ml, measured_runoff_ml,
		float(total_usec) / float(samples.size()), samples[p95_index], samples[-1]])
	quit(0)
