class_name GSBackpackHandlePull
extends RefCounted
## Deterministic, bounded local-space handle pull for backpack inspection.
## The host owns hand tracking, collision queries, presentation and return policy.

const PULL_DEADZONE_M := 0.035
const MAX_PULL_M := 0.20
const FOLLOW_RATE := 14.0

var active := false
var side := ""
var input_kind := "grip"
var start_local := Vector3.ZERO
var offset_m := 0.0
var target_m := 0.0

func begin(hand_local: Vector3, hand_side: String, kind := "grip") -> bool:
	if active or hand_side not in ["left", "right"] or not hand_local.is_finite(): return false
	if kind not in ["grip", "interact"]: return false
	active = true
	side = hand_side
	input_kind = kind
	start_local = hand_local
	target_m = 0.0
	return true

func step(hand_local: Vector3, tracked: bool, dt: float) -> float:
	if not active: return _settle(dt)
	if not tracked or not hand_local.is_finite():
		cancel()
		return _settle(dt)
	if not is_finite(dt) or dt <= 0.0: return offset_m
	# The backpack faces -Z. Side motion and movement toward the body cannot pull it.
	var outward := start_local.z - hand_local.z
	target_m = clampf(outward - PULL_DEADZONE_M, 0.0, MAX_PULL_M)
	return _settle(dt)

func cancel() -> void:
	active = false
	side = ""
	input_kind = "grip"
	target_m = 0.0

func _settle(dt: float) -> float:
	if is_finite(dt) and dt > 0.0:
		offset_m = lerpf(offset_m, target_m, 1.0 - exp(-FOLLOW_RATE * dt))
		if not active and offset_m < 0.001: offset_m = 0.0
	return offset_m
