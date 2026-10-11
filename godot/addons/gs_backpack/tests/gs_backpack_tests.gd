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
	check(approach.check("middle", Vector3.ZERO, SHOULDER_Y).reason == "back_approach_invalid", "unknown hand side is rejected")
	approach.observe("middle", true, Vector3(0.18,0.40,0.0), SHOULDER_Y, 0.02)
	check(approach.check("middle", Vector3(0.18,0.40,0.0), SHOULDER_Y).reason == "back_approach_invalid",
		"unknown side observation cannot create access history")
	approach.observe("right", false, Vector3(0.20, 0.30, 0.20), SHOULDER_Y, 0.02)
	check(approach.check("right", Vector3(0.20, 0.30, 0.20), SHOULDER_Y).reason == "back_approach_required", "tracking loss clears approach history")
	approach.observe("right", true, Vector3(0.20, 0.30, 0.20), SHOULDER_Y, 0.16)
	check(approach.check("right", Vector3(0.20, 0.30, 0.20), SHOULDER_Y).reason == "back_approach_required", "long frame cannot bridge missing samples")
	sample(approach, "right", Vector3(0.18, 0.40, 0.0))
	approach.observe("right", true, Vector3(0.18, 0.40, 0.5), 0.0, 0.02)
	check(approach.check("right", Vector3(0.18, 0.40, 0.5), SHOULDER_Y).reason == "back_approach_required", "teleport-sized hand jump resets history")
	valid_right(approach)
	approach.observe("right",true,Vector3(NAN,0.4,0.0),SHOULDER_Y,0.02)
	check(approach.check("right",Vector3(0.08,0.10,0.36),SHOULDER_Y).reason == "back_approach_required",
		"non-finite sampled hand clears only its own history")
	valid_right(approach)
	approach.observe("right",true,Vector3(0.18,0.40,0.0),NAN,0.02)
	check(approach.check("right",Vector3(0.08,0.10,0.36),SHOULDER_Y).reason == "back_approach_required",
		"non-finite shoulder height clears the affected history")
	for invalid_dt in [0.0,-0.02,NAN,INF]:
		valid_right(approach)
		approach.observe("right",true,Vector3(0.18,0.40,0.0),SHOULDER_Y,invalid_dt)
		check(approach.check("right",Vector3(0.08,0.10,0.36),SHOULDER_Y).reason == "back_approach_required",
			"invalid sample dt %s clears the affected history" % invalid_dt)
	valid_left(approach)
	approach.observe("right",true,Vector3(0.18,0.40,0.0),SHOULDER_Y,0.02)
	approach.observe("right",true,Vector3(0.18,0.40,0.0),SHOULDER_Y,-0.02)
	check(approach.check("left",Vector3(-0.08,0.10,0.36),SHOULDER_Y).allowed,
		"invalid right-hand sample preserves independent left-hand history")
	check(approach.check("right",Vector3(0.18,0.40,0.0),SHOULDER_Y).reason == "back_approach_required",
		"invalid sample clears only the sampled hand")
	approach.reset()
	approach.observe("right",true,Vector3(0.18,0.40,0.0),SHOULDER_Y,0.15)
	approach.observe("right",true,Vector3(0.18,0.40,0.30),SHOULDER_Y,0.15)
	check(approach.check("right",Vector3(0.18,0.40,0.30),SHOULDER_Y).allowed,
		"exact maximum sample interval and movement boundary remain valid")
	approach.reset()
	approach.observe("right",true,Vector3(0.18,0.40,0.0),SHOULDER_Y,0.02)
	approach.observe("right",true,Vector3(0.18,0.40,0.15),SHOULDER_Y,0.02)
	check(approach.check("right",Vector3(0.18,0.40,0.45),SHOULDER_Y).allowed,
		"final access check accepts a valid hand position exactly 0.30 m from its last observation")
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
