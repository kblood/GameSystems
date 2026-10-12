extends SceneTree
## Contract checks for the portable over-shoulder approach policy.
const Approach = preload("res://addons/gs_backpack/gs_backpack_approach.gd")
const HandlePull = preload("res://addons/gs_backpack/gs_backpack_handle_pull.gd")
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
	var pull := HandlePull.new()
	check(not pull.begin(Vector3.ZERO,"middle") and not pull.begin(Vector3(INF,0.0,0.0),"right"),
		"handle pull rejects unknown sides and non-finite hand positions")
	check(not pull.begin(Vector3.ZERO,"right","click") and pull.begin(Vector3.ZERO,"right","interact"),
		"handle pull accepts explicit grip/interact actions only")
	check(pull.input_kind == "interact" and not pull.begin(Vector3.ZERO,"left"),
		"one active pull retains its source action and rejects a second hand")
	pull.step(Vector3(0.2,0.0,-0.02),true,0.1)
	check(pull.target_m == 0.0 and pull.offset_m == 0.0,
		"sideways motion and sub-deadzone travel do not pull the bag")
	pull.step(Vector3(0.0,0.0,-0.10),true,0.1)
	check(is_equal_approx(pull.target_m,0.065) and pull.offset_m > 0.0 and pull.offset_m < pull.target_m,
		"outward travel beyond the deadzone eases toward a local-space target")
	pull.step(Vector3(0.0,0.0,-2.0),true,0.1)
	check(pull.target_m == HandlePull.MAX_PULL_M,
		"handle pull saturates at its fixed 20 cm travel bound")
	var before_invalid_dt := pull.offset_m
	pull.step(Vector3(0.0,0.0,-0.1),true,NAN)
	check(pull.offset_m == before_invalid_dt and pull.active,
		"invalid frame time cannot corrupt an active pull offset")
	pull.step(Vector3.ZERO,false,0.1)
	check(not pull.active and pull.target_m == 0.0 and pull.offset_m < HandlePull.MAX_PULL_M,
		"tracking loss cancels the gesture and begins a smoothed return")
	for _i in range(60): pull.step(Vector3.ZERO,true,1.0/72.0)
	check(pull.offset_m == 0.0 and pull.side.is_empty(),
		"cancelled handle pull settles fully back to its worn anchor")
	pull.begin(Vector3.ZERO,"left")
	pull.step(Vector3(0.0,0.0,-0.15),true,0.1)
	var active_offset := pull.offset_m
	pull.step(Vector3(NAN,0.0,0.0),true,0.1)
	check(not pull.active and pull.offset_m < active_offset,
		"a non-finite tracked hand cancels the active pull without jumping the bag")
	for _i in range(60): pull.step(Vector3.ZERO,true,1.0/72.0)
	pull.begin(Vector3.ZERO,"right","interact")
	pull.step(Vector3(0.0,0.0,-0.15),true,0.1)
	var cancelled_offset := pull.offset_m
	pull.cancel()
	check(not pull.active and pull.target_m == 0.0 and pull.offset_m == cancelled_offset,
		"explicit cancellation preserves only the current eased offset for a smooth return")
	for _i in range(60): pull.step(Vector3.ZERO,true,1.0/72.0)
	check(pull.offset_m == 0.0, "explicitly cancelled pull eventually settles back to zero")
	print("GS_BACKPACK checks=%d failures=%d" % [checks, failures.size()])
	quit(1 if not failures.is_empty() else 0)
