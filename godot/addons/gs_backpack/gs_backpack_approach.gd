class_name GSBackpackApproach
extends RefCounted
## Bounded, body-local history for intentional over-shoulder access to a backpack.
## +X is the wearer's right; +Z is behind the wearer. This policy owns no items,
## scene nodes, physics queries, haptics, or presentation.

const MAX_SAMPLE_DT := 0.15
const MAX_SAMPLE_JUMP_M := 0.30
const APPROACH_LIFETIME_S := 1.25
const ENTRY_SIDE_MIN_M := 0.08
const SIDE_MAX_M := 0.50
const ENTRY_HEIGHT_TOLERANCE_M := 0.02
const ENTRY_FRONT_M := -0.22
const ENTRY_BACK_M := 0.08
const RETRIEVE_BACK_MIN_M := 0.10
const RETRIEVE_BELOW_SHOULDER_M := 0.35
const CENTRE_CROSS_TOLERANCE_M := 0.04
const MIN_PROGRESS_M := 0.08
const PATH_SHOULDER_CLEARANCE_M := 0.05
const BOUNDARY_EPSILON := 0.000001

var _hands: Dictionary = {}

func reset(side: String = "") -> void:
	if side.is_empty(): _hands.clear()
	else: _hands.erase(side)

func observe(side: String, tracked: bool, local_hand: Vector3, shoulder_y: float, dt: float) -> void:
	if side not in ["left", "right"]: return
	if not tracked or not local_hand.is_finite() or not is_finite(shoulder_y) or not is_finite(dt) or dt <= 0.0 or dt > MAX_SAMPLE_DT + BOUNDARY_EPSILON:
		reset(side)
		return
	var previous: Dictionary = _hands.get(side, {})
	if not previous.is_empty() and local_hand.distance_to(previous.position) > MAX_SAMPLE_JUMP_M + BOUNDARY_EPSILON:
		# A recovered/teleported hand must make a new continuous approach. Do not
		# arm from the discontinuity itself, even when it lands above a shoulder.
		reset(side)
		return
	if not previous.is_empty() and float(previous.age) <= APPROACH_LIFETIME_S and not _path_clear(side,previous.position,local_hand,shoulder_y):
		reset(side)
		return
	var age := float(previous.get("age", APPROACH_LIFETIME_S + 1.0)) + dt
	var entry: Vector3 = previous.get("entry", local_hand)
	var lateral := local_hand.x * (1.0 if side == "right" else -1.0)
	if lateral >= ENTRY_SIDE_MIN_M and lateral <= SIDE_MAX_M and local_hand.y >= shoulder_y - ENTRY_HEIGHT_TOLERANCE_M and local_hand.y <= shoulder_y + 0.35 and local_hand.z >= ENTRY_FRONT_M and local_hand.z <= ENTRY_BACK_M:
		entry = local_hand
		age = 0.0
	_hands[side] = {"position":local_hand, "entry":entry, "age":age}

func check(side: String, local_hand: Vector3, shoulder_y: float) -> Dictionary:
	if side not in ["left", "right"] or not local_hand.is_finite() or not is_finite(shoulder_y): return _result(false, "back_approach_invalid")
	var hand: Dictionary = _hands.get(side, {})
	if hand.is_empty(): return _result(false, "back_approach_required")
	if local_hand.distance_to(hand.position) > MAX_SAMPLE_JUMP_M + BOUNDARY_EPSILON:
		reset(side)
		return _result(false, "back_approach_jump")
	if not _path_clear(side,hand.position,local_hand,shoulder_y):
		reset(side)
		return _result(false, "back_approach_path")
	if float(hand.age) > APPROACH_LIFETIME_S: return _result(false, "back_approach_expired")
	var lateral := local_hand.x * (1.0 if side == "right" else -1.0)
	if lateral < -CENTRE_CROSS_TOLERANCE_M or lateral > SIDE_MAX_M: return _result(false, "back_approach_wrong_side")
	if local_hand.y < shoulder_y - RETRIEVE_BELOW_SHOULDER_M: return _result(false, "back_approach_too_low")
	if local_hand.z < RETRIEVE_BACK_MIN_M: return _result(false, "back_approach_not_behind")
	var entry: Vector3 = hand.entry
	if local_hand.z - entry.z < MIN_PROGRESS_M and entry.y - local_hand.y < MIN_PROGRESS_M: return _result(false, "back_approach_no_progress")
	return _result(true, "over_shoulder")

func _path_clear(side: String, previous: Vector3, current: Vector3, shoulder_y: float) -> bool:
	var lateral := current.x * (1.0 if side == "right" else -1.0)
	if lateral < -CENTRE_CROSS_TOLERANCE_M or lateral > SIDE_MAX_M or current.z < ENTRY_FRONT_M: return false
	if current.y < shoulder_y - RETRIEVE_BELOW_SHOULDER_M: return false
	# The hand must cross behind the shoulder while still high. Interpolate the
	# sampled segment at that plane, so a diagonal through the torso cannot pass.
	if current.z < RETRIEVE_BACK_MIN_M and current.y < shoulder_y - PATH_SHOULDER_CLEARANCE_M: return false
	if previous.z < RETRIEVE_BACK_MIN_M and current.z >= RETRIEVE_BACK_MIN_M:
		var crossing := previous.lerp(current,(RETRIEVE_BACK_MIN_M-previous.z)/(current.z-previous.z))
		if crossing.y < shoulder_y - PATH_SHOULDER_CLEARANCE_M: return false
	return true

func _result(allowed: bool, reason: String) -> Dictionary:
	return {"allowed":allowed, "reason":reason}
