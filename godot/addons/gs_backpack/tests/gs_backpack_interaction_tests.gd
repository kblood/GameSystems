extends SceneTree

const Interaction = preload("res://addons/gs_backpack/gs_backpack_interaction.gd")
const SHOULDER_Y := 0.35

class RequestProbe extends RefCounted:
	var calls := 0
	var last_slot := ""
	var last_hand := ""
	func request_retrieve(slot_id: String, hand: String, tracked: bool, _pose: Transform3D,
			_reach: float, _exclude: Array[RID], _mask: int) -> Dictionary:
		calls += 1
		last_slot = slot_id
		last_hand = hand
		return {"allowed": tracked, "accepted": tracked, "reason": "ok" if tracked else "hand_tracking_lost"}

class NodeRequestProbe extends Node:
	func request_retrieve(_slot_id: String, _hand: String, _tracked: bool, _pose: Transform3D,
			_reach: float, _exclude: Array[RID], _mask: int) -> Dictionary:
		return {"allowed": true, "accepted": true, "reason": "ok"}

var checks := 0
var failures: Array[String] = []

func _initialize() -> void:
	call_deferred("run")

func check(value: bool, label: String) -> void:
	checks += 1
	if not value:
		failures.append(label)
		push_error("GS_BACKPACK_INTERACTION: " + label)

func sample_path(system: RefCounted, side: String) -> void:
	var sign := 1.0 if side == "right" else -1.0
	system.observe_hand(side, true, Vector3(sign * 0.18, 0.40, 0.0), SHOULDER_Y, 0.02)
	system.observe_hand(side, true, Vector3(sign * 0.18, 0.38, 0.15), SHOULDER_Y, 0.02)
	system.observe_hand(side, true, Vector3(sign * 0.12, 0.20, 0.27), SHOULDER_Y, 0.02)
	system.observe_hand(side, true, Vector3(sign * 0.08, 0.10, 0.36), SHOULDER_Y, 0.02)

func run() -> void:
	var probe := RequestProbe.new()
	var system := Interaction.new()
	check(not system.configure(null), "requires an adapter with gated retrieval")
	check(system.configure(probe), "configures the independent adapter bridge")
	var pose := Transform3D.IDENTITY
	var invalid := system.retrieve("back", "right", true, Vector3(0.1, 0.1, 0.4), SHOULDER_Y, pose, 1.0)
	check(not invalid.allowed and invalid.reason == "back_approach_required" and probe.calls == 0,
		"invalid back reach never reaches the ownership adapter")
	sample_path(system, "right")
	var right := system.retrieve("back", "right", true, Vector3(0.08, 0.10, 0.36), SHOULDER_Y, pose, 1.0)
	check(right.accepted and probe.calls == 1 and probe.last_hand == "hand:right",
		"valid right shoulder path delegates to the adapter's gated retrieve")
	sample_path(system, "left")
	var left := system.retrieve("back", "left", true, Vector3(-0.08, 0.10, 0.36), SHOULDER_Y, pose, 1.0)
	check(left.accepted and probe.calls == 2 and probe.last_hand == "hand:left",
		"valid mirrored left shoulder path delegates independently")
	sample_path(system, "right")
	var lost := system.retrieve("back", "right", false, Vector3(0.08, 0.10, 0.36), SHOULDER_Y, pose, 1.0)
	check(not lost.accepted and lost.reason == "hand_tracking_lost" and probe.calls == 2,
		"tracking loss clears the approach and cannot mutate host inventory")
	var ordinary := system.retrieve("left_hip", "right", true, Vector3.ZERO, SHOULDER_Y, pose, 1.0)
	check(ordinary.accepted and probe.calls == 3 and probe.last_slot == "left_hip",
		"ordinary slots bypass shoulder policy but still use the adapter gate")
	system.reset()
	check(system.retrieve("back", "right", true, Vector3(0.08, 0.1, 0.36), SHOULDER_Y, pose, 1.0).reason == "back_approach_required",
		"global reset clears transient shoulder history")
	var stale := Interaction.new()
	var node_probe := NodeRequestProbe.new()
	root.add_child(node_probe)
	check(stale.configure(node_probe), "a node-backed adapter can be configured")
	node_probe.free()
	var stale_result := stale.retrieve("back", "right", true, Vector3.ZERO, SHOULDER_Y, pose, 1.0)
	check(not stale_result.accepted and stale_result.reason == "not_configured",
		"a freed scene adapter fails safely without calling a stale Godot object")
	print("GS_BACKPACK_INTERACTION checks=%d failures=%d" % [checks, failures.size()])
	quit(1 if not failures.is_empty() else 0)
