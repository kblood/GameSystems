extends SceneTree

const Bottle = preload("res://addons/gs_bottles/breakable_bottle.gd")
const Liquid = preload("res://addons/gs_bottles/shaders/bottle_liquid.gd")
const Profile = preload("res://addons/gs_bottles/bottle_break_profile.gd")
const Lut = preload("res://addons/gs_bottles/bottle_lut.gd")
const HoleMark = preload("res://addons/gs_bottles/bullet_hole_mark.gd")

class PendingStream extends RefCounted:
	var finished := false

class TestBottle extends GSBreakableBottle:
	func _ready() -> void:
		pass

var checks := 0
var failures := 0

func _initialize() -> void:
	_run.call_deferred()

func check(value: bool, label: String) -> void:
	checks += 1
	if not value:
		failures += 1
		push_error("BOTTLE LEAK CHECKPOINT FAIL: " + label)

func _new_bottle():
	var bottle: Variant = TestBottle.new()
	bottle.bottle_name = "checkpoint_test"
	bottle.spill_liquid_kind = &"diesel"
	bottle.profile = Profile.new()
	bottle._rprof.resize(64)
	bottle._rprof.fill(0.01)
	bottle.lut = Lut.new()
	bottle.lut.capacity_ml = 500.0
	bottle.lut.color = Color(1.2, -0.1, 0.4, 0.8)
	bottle.ctl = Liquid.new()
	bottle.add_child(bottle.ctl)
	bottle.model = Node3D.new()
	bottle.add_child(bottle.model)
	bottle._built = true
	bottle.fill = 0.6
	bottle.ctl.fill = bottle.fill
	var holes: Array[Dictionary] = [
		{"p": Vector3(-0.005, 0.0, 0.001), "n": Vector3.LEFT, "r": 0.002, "acc": 0.31,
			"acc_kind": &"diesel", "acc_color": Color(1.2, -0.1, 0.4, 0.8), "stream": null},
		{"p": Vector3(0.005, 0.01, -0.001), "n": Vector3.RIGHT, "r": 0.003, "acc": 0.17,
			"acc_kind": &"water", "acc_color": Color(0.1, 0.2, 0.8, 1.0), "stream": null},
	]
	bottle.leaks = holes
	bottle.set_physics_process(false)
	HoleMark.add(bottle, bottle.hole_marks, Vector3(-0.005, 0.0, 0.001), Vector3.LEFT,
		0.002, false, Color(0.2, 0.3, 0.4), 0.73)
	return bottle

func _run() -> void:
	var bottle: Variant = _new_bottle()
	var saved: Dictionary = bottle.capture_leak_checkpoint()
	var json_copy: Dictionary = JSON.parse_string(JSON.stringify(saved))
	bottle.set_fill(0.4)
	bottle.leaks[0].acc = 0.01
	bottle.leaks[0].acc_kind = &"water"
	check(not saved.is_empty() and bottle.restore_leak_checkpoint(json_copy),
		"JSON round-trip restores changed source fill and active low-tier leak state")
	check(is_equal_approx(bottle.fill, 0.6) and is_equal_approx(bottle.ctl.fill, 0.6)
		and is_equal_approx(bottle.leaks[0].acc, 0.31) and bottle.leaks[0].acc_kind == &"diesel"
		and bottle.leaks[0].acc_color == Color(1.2, -0.1, 0.4, 0.8),
		"restore recovers bottle source fill and per-hole amount, identity and finite HDR color")
	var fresh: Variant = _new_bottle()
	fresh.leaks.clear()
	for mark in fresh.hole_marks: mark.free()
	fresh.hole_marks.clear()
	check(fresh.restore_leak_checkpoint(json_copy) and fresh.leaks.size() == 2 and fresh.hole_marks.size() == 1
		and is_equal_approx(fresh.leaks[0].acc, 0.31) and fresh.leaks[0].acc_kind == &"diesel",
		"restore reconstructs saved hole topology and visual mark on a fresh bottle")
	var stable: Dictionary = bottle.capture_leak_checkpoint()
	var invalid: Dictionary = JSON.parse_string(JSON.stringify(stable))
	invalid.leaks[1].position[0] = 9.0
	check(not bottle.restore_leak_checkpoint(invalid) and bottle.capture_leak_checkpoint() == stable,
		"malformed topology is rejected before changing any liquid state")
	invalid = JSON.parse_string(JSON.stringify(stable))
	invalid.leaks[0].accumulated_ml = "not-a-number"
	check(not bottle.restore_leak_checkpoint(invalid) and bottle.capture_leak_checkpoint() == stable,
		"invalid late-entry amount is rejected atomically")
	invalid = JSON.parse_string(JSON.stringify(stable))
	invalid.leaks[0].normal = [1.0e308, 1.0e308, 1.0e308]
	check(not bottle.restore_leak_checkpoint(invalid) and bottle.capture_leak_checkpoint() == stable,
		"overflowing normal magnitude is rejected atomically")
	invalid = JSON.parse_string(JSON.stringify(stable))
	invalid.marks[0].seed = 7.0
	check(not bottle.restore_leak_checkpoint(invalid) and bottle.capture_leak_checkpoint() == stable,
		"out-of-range mark seed is rejected atomically")
	invalid = JSON.parse_string(JSON.stringify(stable))
	invalid.leaks[0].color[0] = 1.0e308
	check(not bottle.restore_leak_checkpoint(invalid) and bottle.capture_leak_checkpoint() == stable,
		"finite JSON color that overflows Godot Color is rejected atomically")
	invalid = JSON.parse_string(JSON.stringify(stable))
	invalid.marks[0].tint[0] = 1.0e308
	check(not bottle.restore_leak_checkpoint(invalid) and bottle.capture_leak_checkpoint() == stable,
		"finite JSON tint that overflows Godot Color is rejected atomically")
	var pending := PendingStream.new()
	bottle.leaks[0].stream = pending
	check(bottle.capture_leak_checkpoint().is_empty() and not bottle.restore_leak_checkpoint(stable),
		"live stream transport cannot be omitted from a low-tier source checkpoint")
	pending.finished = true
	check(not bottle.capture_leak_checkpoint().is_empty() and bottle.restore_leak_checkpoint(stable),
		"finished transport permits source checkpointing")
	await _verify_live_restored_flow(json_copy)
	bottle.free()
	fresh.free()
	await process_frame
	print("BOTTLE_LEAK_CHECKPOINT checks=%d failures=%d" % [checks, failures])
	quit(1 if failures else 0)

func _verify_live_restored_flow(saved: Dictionary) -> void:
	var scene := Node3D.new()
	root.add_child(scene)
	current_scene = scene
	var manager := GSBottleBreakManager.get_for(scene)
	manager.set_quality(GSBottleBreakManager.Quality.MINIMAL)
	var restored: Variant = _new_bottle()
	for ci in restored.lut.n_cos:
		var row: Array[float] = []
		for fi in restored.lut.n_fill: row.append(float(fi) / float(restored.lut.n_fill - 1))
		restored.lut.lut.append(row)
	scene.add_child(restored)
	await physics_frame
	restored.set_physics_process(false)
	check(not restored.is_physics_processing(), "fresh intact bottle leak scheduler starts idle")
	check(restored.restore_leak_checkpoint(saved) and restored.is_physics_processing(),
		"restoring wet topology explicitly wakes the leak scheduler")
	var fill_before: float = restored.fill
	var accumulator_before := float(restored.leaks[0].acc)
	restored._process_leaks(0.005)
	check(restored.fill < fill_before and float(restored.leaks[0].acc) > accumulator_before,
		"restored source resumes real liquid debit and typed sub-drop accumulation")
	scene.queue_free()
	await process_frame
