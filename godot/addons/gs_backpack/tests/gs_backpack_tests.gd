extends SceneTree
## Contract checks for the portable over-shoulder approach policy.
const Approach = preload("res://addons/gs_backpack/gs_backpack_approach.gd")
const SHOULDER_Y := 0.35
var checks := 0
var failures: Array[String] = []

func _initialize() -> void:
	call_deferred("run")

func check(value: bool, label: String) -> void:
	checks += 1
	if not value:
		failures.append(label)
		push_error("GS_BACKPACK: " + label)

func sample(policy: RefCounted, side: String, point: Vector3, dt := 0.02) -> void:
	policy.observe(side, true, point, SHOULDER_Y, dt)

func valid_right(policy: RefCounted) -> void:
	sample(policy, "right", Vector3(0.18, 0.40, 0.0))
	sample(policy, "right", Vector3(0.18, 0.38, 0.15))
	sample(policy, "right", Vector3(0.12, 0.20, 0.27))
	sample(policy, "right", Vector3(0.08, 0.10, 0.36))

func valid_left(policy: RefCounted) -> void:
	sample(policy, "left", Vector3(-0.18, 0.40, 0.0))
	sample(policy, "left", Vector3(-0.18, 0.38, 0.15))
	sample(policy, "left", Vector3(-0.12, 0.20, 0.27))
	sample(policy, "left", Vector3(-0.08, 0.10, 0.36))

func run() -> void:
	var approach := Approach.new()
	check(approach.check("right", Vector3.ZERO, SHOULDER_Y).reason == "back_approach_required", "requires a sampled approach")
	approach.observe("right", false, Vector3(0.20, 0.30, 0.20), SHOULDER_Y, 0.02)
	check(approach.check("right", Vector3(0.20, 0.30, 0.20), SHOULDER_Y).reason == "back_approach_required", "tracking loss clears approach history")
	approach.observe("right", true, Vector3(0.20, 0.30, 0.20), SHOULDER_Y, 0.16)
	check(approach.check("right", Vector3(0.20, 0.30, 0.20), SHOULDER_Y).reason == "back_approach_required", "long frame cannot bridge missing samples")
	sample(approach, "right", Vector3(0.18, 0.40, 0.0))
	approach.observe("right", true, Vector3(0.18, 0.40, 0.5), 0.0, 0.02)
	check(approach.check("right", Vector3(0.18, 0.40, 0.5), SHOULDER_Y).reason == "back_approach_required", "teleport-sized hand jump resets history")
	sample(approach, "right", Vector3(0.18, 0.40, 0.0))
	var low := approach.check("right", Vector3(0.18, 0.20, 0.15), SHOULDER_Y)
	check(not low.allowed and low.reason == "back_approach_path", "low shoulder-plane crossing is rejected")
	valid_right(approach)
	var right_result := approach.check("right", Vector3(0.08, 0.10, 0.36), SHOULDER_Y)
	check(right_result.allowed and right_result.reason == "over_shoulder", "front-high-right path is accepted")
	valid_left(approach)
	var left_result := approach.check("left", Vector3(-0.08, 0.10, 0.36), SHOULDER_Y)
	check(left_result.allowed and left_result.reason == "over_shoulder", "mirrored front-high-left path is accepted")
	approach.reset("right")
	check(approach.check("right", Vector3(0.08, 0.10, 0.36), SHOULDER_Y).reason == "back_approach_required", "per-hand reset preserves independent history")
	approach.reset()
	check(approach.check("left", Vector3(-0.08, 0.10, 0.36), SHOULDER_Y).reason == "back_approach_required", "global reset clears all history")
	valid_right(approach)
	for _i in range(9): approach.observe("right", true, Vector3(0.18, 0.40, 0.15), SHOULDER_Y, 0.15)
	check(approach.check("right", Vector3(0.18, 0.40, 0.15), SHOULDER_Y).reason == "back_approach_expired", "approach history expires within a bounded lifetime")
	print("GS_BACKPACK checks=%d failures=%d" % [checks, failures.size()])
	quit(1 if not failures.is_empty() else 0)
