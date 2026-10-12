class_name GSBackpackInteraction
extends RefCounted
## Composes deliberate shoulder access with a host's normal gated retrieval API.
## The host remains authoritative for reach, occlusion, ownership and scene moves.

const Approach = preload("res://addons/gs_backpack/gs_backpack_approach.gd")

var _approach = Approach.new()
var _adapter: Object
var _approach_slots: Dictionary = {}

func configure(adapter: Object, approach_slots: Array[String] = ["back"]) -> bool:
	if not is_instance_valid(adapter) or not adapter.has_method("request_retrieve"): return false
	var slots: Dictionary = {}
	for slot_id in approach_slots:
		if slot_id.strip_edges().is_empty() or slots.has(slot_id): return false
		slots[slot_id] = true
	_adapter = adapter
	_approach_slots = slots
	_approach.reset()
	return true

## Call at tracking cadence with the hand position in the body's local frame.
func observe_hand(side: String, tracked: bool, body_local_hand: Vector3, shoulder_y: float, dt: float) -> void:
	_approach.observe(side, tracked, body_local_hand, shoulder_y, dt)

func check_approach(slot_id: String, side: String, body_local_hand: Vector3, shoulder_y: float) -> Dictionary:
	if not side in ["left", "right"]: return _result(false, "invalid_hand")
	if not _approach_slots.has(slot_id): return {"allowed":true, "reason":"approach_not_required"}
	return _approach.check(side, body_local_hand, shoulder_y)

## Only configured slots require the deliberate reach path. Every accepted
## retrieval still passes through the host adapter's hand/reach/occlusion gate.
func retrieve(slot_id: String, side: String, tracked: bool, body_local_hand: Vector3,
		shoulder_y: float, hand_world: Transform3D, reach_m: float,
		exclude: Array[RID] = [], collision_mask: int = 0xFFFFFFFF,
		require_approach := true) -> Dictionary:
	if not side in ["left", "right"]: return _result(false, "invalid_hand")
	if not tracked:
		_approach.reset(side)
		return _result(false, "hand_tracking_lost")
	if not is_instance_valid(_adapter) or not _adapter.has_method("request_retrieve"):
		return _result(false, "not_configured")
	if require_approach:
		var access: Dictionary = check_approach(slot_id, side, body_local_hand, shoulder_y)
		if not bool(access.allowed): return access
	return _adapter.call("request_retrieve", slot_id, "hand:" + side, true,
		hand_world, reach_m, exclude, collision_mask)

func reset(side: String = "") -> void:
	_approach.reset(side)

func _result(accepted: bool, reason: String) -> Dictionary:
	return {"allowed": false, "accepted": accepted, "reason": reason, "distance_m": -1.0}
