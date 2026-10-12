extends SceneTree

const Thermal = preload("res://addons/gs_thermal/gs_thermal_system.gd")
const FireSpread = preload("res://addons/gs_fire_spread/gs_spatial_fire_spread_system.gd")

const SOURCES := 128
const TARGETS := 128
const WARMUP_TICKS := 20
const MEASURED_TICKS := 200


func _initialize() -> void:
	var arguments := OS.get_cmdline_user_args()
	var sparse := "sparse" in arguments
	var scenario := "sparse" if sparse else "dense"
	var thermal := Thermal.new()
	thermal.add_room(&"benchmark-room")
	for index in SOURCES:
		var position := Vector3(float(index) * (2.0 if sparse else 0.01), 0.0,
			float(index / 16) * (2.0 if sparse else 0.01))
		var id := StringName("source-%03d" % index)
		thermal.add_object(id, {"room_id": &"benchmark-room", "position": position,
			"temperature_c": 300.0, "ignition_c": 200.0, "heat_capacity_kj_c": 1.0,
			"flammability": 1.0, "fuel": 100.0, "burn_rate": 0.01})
	for index in TARGETS:
		var position := Vector3(float(index) * (2.0 if sparse else 0.01), 0.0,
			float(index / 16) * (2.0 if sparse else 0.01))
		var id := StringName("target-%03d" % index)
		thermal.add_object(id, {"room_id": &"benchmark-room", "position": position,
			"temperature_c": 20.0, "ignition_c": 1000000.0, "heat_capacity_kj_c": 1.0e12,
			"flammability": 1.0, "fuel": 100.0, "burn_rate": 0.01})
	var spread := FireSpread.new(thermal)
	for index in SOURCES:
		if not spread.register_object(StringName("source-%03d" % index)):
			push_error("benchmark source registration failed")
			quit(1)
	for index in TARGETS:
		if not spread.register_object(StringName("target-%03d" % index)):
			push_error("benchmark target registration failed")
			quit(1)
	var candidate_pairs := 0
	for _tick in WARMUP_TICKS:
		var warmup: Dictionary = spread.step(FireSpread.FIXED_STEP)
		if not warmup.ok or warmup.pairs < TARGETS or warmup.heated != TARGETS:
			push_error("benchmark did not reach the expected worst-case pass: %s" % warmup)
			quit(1)
		candidate_pairs = int(warmup.pairs)
	var samples: Array[int] = []
	for _tick in MEASURED_TICKS:
		var start := Time.get_ticks_usec()
		var result: Dictionary = spread.step(FireSpread.FIXED_STEP)
		var elapsed := Time.get_ticks_usec() - start
		if not result.ok or result.pairs != candidate_pairs or result.heated != TARGETS:
			push_error("benchmark pass failed: %s" % result)
			quit(1)
		samples.append(elapsed)
	samples.sort()
	var total_usec := 0
	for sample: int in samples: total_usec += sample
	var p95_index := mini(samples.size() - 1, int(ceil(float(samples.size()) * 0.95)) - 1)
	print("SPATIAL_FIRE_SPREAD_BENCHMARK scenario=%s platform=%s cpu=%s godot=%s objects=%d sources=%d targets=%d candidates=%d ticks=%d avg_us=%.1f p95_us=%d max_us=%d" % [
		scenario,
		OS.get_name(), OS.get_processor_name(), Engine.get_version_info().string,
		SOURCES + TARGETS, SOURCES, TARGETS, candidate_pairs, MEASURED_TICKS,
		float(total_usec) / float(samples.size()), samples[p95_index], samples[-1]])
	quit(0)
