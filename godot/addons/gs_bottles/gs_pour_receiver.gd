class_name GSPourReceiver
extends Node3D
## An authored one-way liquid opening, independent of bottles and backing stores.
## The host's accept_ml(amount_ml, liquid_kind, source) returns the accepted mL.
## Rejected liquid remains the pourer's responsibility and lands as physical spill.

signal received(ml: float, liquid_kind: StringName, source: GSBottlePour)

static var registry: Array[GSPourReceiver] = []

@export var enabled := true
@export_range(0.001, 1.0, 0.001, "or_greater") var radius := 0.035
@export var normal := Vector3.UP
var accept_ml: Callable


func _enter_tree() -> void:
	registry.append(self)


func _exit_tree() -> void:
	registry.erase(self)


## Segment crossing of the opening, in [0, 1], or -1 for a miss.
## Local-space testing supports scaled openings without approximating an ellipse.
func segment_fraction(from: Vector3, to: Vector3) -> float:
	if not enabled or is_queued_for_deletion() or not is_inside_tree() or not is_finite(radius) or radius <= 0.0 \
		or not normal.is_finite() or normal.length_squared() < 0.000001 \
		or not global_transform.is_finite() or absf(global_basis.determinant()) < 0.000001:
		return -1.0
	var inverse := global_transform.affine_inverse()
	var local_from := inverse * from
	var local_to := inverse * to
	var axis := normal.normalized()
	var s0 := local_from.dot(axis)
	var s1 := local_to.dot(axis)
	if s0 < 0.0 or s1 >= 0.0:
		return -1.0
	var fraction := s0 / (s0 - s1)
	var hit := local_from.lerp(local_to, fraction)
	return fraction if hit.length_squared() <= radius * radius else -1.0


func world_normal() -> Vector3:
	return (global_basis.inverse().transposed() * normal).normalized()


func receive(ml: float, kind: StringName, source: GSBottlePour) -> float:
	if not enabled or is_queued_for_deletion() or not is_inside_tree() or not is_finite(ml) or ml <= 0.0 \
		or not is_instance_valid(source) or not is_instance_valid(source.body) \
		or not source.body.is_inside_tree() or source.body.get_world_3d() != get_world_3d() or not accept_ml.is_valid():
		return 0.0
	var result: Variant = accept_ml.call(ml, kind, source)
	if typeof(result) not in [TYPE_FLOAT, TYPE_INT] or not is_finite(float(result)) \
		or float(result) < 0.0 or float(result) > ml:
		push_error("GSPourReceiver accept_ml must return a finite accepted amount between zero and the requested mL")
		return 0.0
	var accepted := float(result)
	if accepted > 0.0:
		received.emit(accepted, kind, source)
	return accepted
