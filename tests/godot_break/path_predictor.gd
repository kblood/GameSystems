class_name PathPredictor
extends RefCounted
## Cached ballistic path of one body. The path p0 + v0 t + g t^2 / 2 is analytic, so the world is queried once (a
## swept test along the next `horizon` seconds) and the answer is reused every physics step. It is recomputed ONLY when the
## body's velocity differs from the cached ballistic velocity v0 + g (t - t0) by more than a tolerance (a collision, an impulse,
## drag, grab / release), the horizon is nearly used up, or invalidate() / PathPredictor.targets_changed() is called
## (a target moved or was removed). Slow or idle bodies (speed < min_speed) never query at all.
## Counters: recomputes (full sweeps) and steps (calls), for tests/profiling.

static var epoch := 0   # bump when targets move/disappear: all predictors recompute once
var recomputes := 0
var steps := 0
var horizon := 2.0
var min_speed := 3.0
var tol_abs := 0.1
var tol_rel := 0.05     # covers default linear damping over a second
var _valid := false
var _p0 := Vector3.ZERO
var _v0 := Vector3.ZERO
var _t0 := 0.0
var _hit: Dictionary = {}
var _epoch := -1


static func targets_changed() -> void:
	epoch += 1


func invalidate() -> void:
	_valid = false


## Returns the predicted hit when it is due within the next step or two, else {}. The hit dict is that of
## FastImpact.predict_crossing (point, normal, collider, v_n, t = seconds from the cache origin, ...).
func step(body: RigidBody3D, dt: float, mask: int, exclude: Array = [], lookahead := 1.25) -> Dictionary:
	steps += 1
	var v := body.linear_velocity
	if v.length() < min_speed:
		_valid = false
		return {}
	var now := Engine.get_physics_frames() * dt
	var g := FastImpact.GRAVITY * body.gravity_scale
	if _valid:
		var dev := (v - (_v0 + g * (now - _t0))).length()
		if dev > tol_abs + tol_rel * v.length() or _epoch != epoch or now - _t0 > horizon * 0.9 \
				or (is_instance_valid(_hit.get("collider")) == false and not _hit.is_empty()):
			_valid = false
	if not _valid:
		recomputes += 1
		_valid = true
		_epoch = epoch
		_p0 = body.global_position
		_v0 = v
		_t0 = now
		_hit = _sweep(body, dt, mask, exclude)
	if _hit.is_empty():
		return {}
	var t_rel := now - _t0
	if float(_hit["t"]) - t_rel > dt * lookahead:
		return {}
	var out := _hit.duplicate()
	_hit = {}   # consumed: the caller assesses it; the impact changes the velocity, which triggers the recompute
	return out


func _sweep(body: RigidBody3D, dt: float, mask: int, exclude: Array) -> Dictionary:
	# the whole horizon in segments (a long sweep with one cast would miss thin things the cast margin can't see)
	var seg := 0.1
	var t := 0.0
	while t < horizon:
		var h := FastImpact.predict_crossing(body, dt, mask, exclude, 1.25, FastImpact.GRAVITY, t, minf(seg, horizon - t))
		if not h.is_empty():
			return h
		t += seg
	return {}
