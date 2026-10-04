class_name GlassPathPredictor
extends RefCounted
## Cached ballistic path prediction for fast thrown bodies (the glass side of the shared predict_crossing utility;
## method names and result keys match FastImpact.predict_crossing in gameplay/godot/fast_impact.gd).
##
## The free-flight path is analytic, p(t) = p0 + v0 (t - t0) + 1/2 g (t - t0)^2, so it is swept ONCE (sphere cast of
## the body's bounding radius, segment by segment over `horizon` seconds) and the first pane crossing is cached.
## Every physics step only compares the body's velocity with the cached ballistic velocity v0 + g (t - t0);
## a difference above eps (collision, impulse, force, drag, VR grab/release) invalidates and recomputes.
## Slow bodies (< min_speed) do no prediction at all. Call invalidate() when a target moved / was removed.
##
## Result keys (cached crossing and predict_crossing): {hit, t (absolute s for the cache / relative for one-shot),
## point, normal (points away from the pane, toward the body), collider, collider_id, v_impact, v_rel, v_n}

const GRAVITY := Vector3(0, -9.81, 0)

var body: RigidBody3D
var mask := 1
var horizon := 1.5                  ## s of path swept per recompute (path is extended when it runs out)
var seg_dt := 1.0 / 30.0
var min_speed := 2.0
var eps := 0.05                     ## m/s + 1 % of speed: tolerance for "only gravity changed it"
var radius := 0.05
var recomputes := 0                 ## path re-solves caused by a velocity deviation (or first throw / invalidate)
var extensions := 0                 ## sweeps that only extended a still-valid path past its horizon
var valid := false
var k_damp := 0.0
var _swept_to := 0.0                ## path time (s after t0) swept so far
var p0 := Vector3.ZERO
var v0 := Vector3.ZERO
var t0 := 0.0
var g := GRAVITY
var crossing := {}
var _shape := SphereShape3D.new()
var _consumed: Array[RID] = []


func _init(b: RigidBody3D = null, target_mask := 1) -> void:
	body = b
	mask = target_mask
	if b:
		radius = body_radius(b)


func invalidate() -> void:
	valid = false
	crossing = {}


## Linear damping the engine applies to the body (REPLACE: body value; COMBINE: + project default). Area damping
## overrides are not modelled (they show up as a deviation -> recompute).
static func body_damp(b: RigidBody3D) -> float:
	if b.linear_damp_mode == RigidBody3D.DAMP_MODE_REPLACE:
		return b.linear_damp
	return b.linear_damp + float(ProjectSettings.get_setting("physics/3d/default_linear_damp", 0.1))


## Analytic path with gravity g and linear damping k (k = 0: plain parabola).
static func path_pos(p: Vector3, v: Vector3, gg: Vector3, k: float, t: float) -> Vector3:
	if k < 1e-4:
		return p + v * t + 0.5 * gg * t * t
	var e := exp(-k * t)
	return p + (v - gg / k) * (1.0 - e) / k + gg / k * t


static func path_vel(v: Vector3, gg: Vector3, k: float, t: float) -> Vector3:
	if k < 1e-4:
		return v + gg * t
	return (v - gg / k) * exp(-k * t) + gg / k


## Velocity the cached path expects at time `now`.
func expected_velocity(now: float) -> Vector3:
	return path_vel(v0, g, k_damp, now - t0)


func expected_position(now: float) -> Vector3:
	return path_pos(p0, v0, g, k_damp, now - t0)


## Call every physics step (before the engine step). Returns the cached crossing when it happens within this step
## (lead = how many steps early to fire), else {}.
func step(now: float, dt: float, lead := 1.5) -> Dictionary:
	if body == null or not is_instance_valid(body) or body.freeze:
		return {}
	var v := body.linear_velocity
	var sp := v.length()
	if sp < min_speed:
		if valid:
			invalidate()
		return {}
	if valid and (v - expected_velocity(now)).length() > eps + 0.01 * sp:
		valid = false
	if not valid:
		recompute(now)
	elif crossing.is_empty() and now - t0 > _swept_to - 2.0 * dt:
		extensions += 1
		_sweep(_swept_to, _swept_to + horizon)
	if crossing.is_empty():
		return {}
	var c := crossing
	if not is_instance_valid(c.get("collider")):
		invalidate()
		return {}
	if float(c["t"]) - now <= dt * lead:
		# consumed; the path stays valid until the velocity changes, later panes are found by extending the sweep
		crossing = {}
		_consumed.append((c["collider"] as CollisionObject3D).get_rid())
		_swept_to = float(c["t"]) - t0
		return c
	return {}


func recompute(now: float) -> void:
	recomputes += 1
	valid = true
	crossing = {}
	_consumed.clear()
	g = GRAVITY * body.gravity_scale
	k_damp = body_damp(body)
	p0 = body.global_position
	v0 = body.linear_velocity
	t0 = now
	_sweep(0.0, horizon)


## Sweep the cached path from path time t_from to t_to (seconds after t0).
func _sweep(t_from: float, t_to: float) -> void:
	_swept_to = t_to
	var space := body.get_world_3d().direct_space_state
	_shape.radius = radius
	var q := PhysicsShapeQueryParameters3D.new()
	q.shape = _shape
	q.collision_mask = mask
	var ex: Array[RID] = [body.get_rid()]
	ex.append_array(_consumed)
	q.exclude = ex
	q.margin = 0.001
	var n := int(ceil((t_to - t_from) / seg_dt))
	for i in n:
		var ta := t_from + i * seg_dt
		var tb := ta + seg_dt
		var a := path_pos(p0, v0, g, k_damp, ta)
		var b := path_pos(p0, v0, g, k_damp, tb)
		q.transform = Transform3D(Basis.IDENTITY, a)
		q.motion = b - a
		var r := space.cast_motion(q)
		if r.size() < 2 or r[0] >= 1.0:
			continue
		var f: float = r[1]
		q.transform = Transform3D(Basis.IDENTITY, a + (b - a) * minf(f + 0.002, 1.0))
		q.motion = Vector3.ZERO
		var ri := space.get_rest_info(q)
		if ri.is_empty():
			return
		var t := ta + f * seg_dt
		var vi := path_vel(v0, g, k_damp, t)
		var col := instance_from_id(int(ri["collider_id"]))
		crossing = {"hit": true, "t": t0 + t, "point": ri["point"], "normal": ri["normal"], "collider": col,
			"collider_id": ri["collider_id"], "v_impact": vi, "v_rel": vi, "v_n": maxf(-vi.dot(ri["normal"]), 0.0)}
		return


## Bounding radius of a body's collision shapes (cached in meta "_glass_r").
static func body_radius(b: Node3D) -> float:
	if b.has_meta("_glass_r"):
		return float(b.get_meta("_glass_r"))
	var r := 0.02
	for c in b.get_children():
		if c is CollisionShape3D and (c as CollisionShape3D).shape:
			var s := (c as CollisionShape3D).shape
			var rr := 0.05
			if s is SphereShape3D:
				rr = (s as SphereShape3D).radius
			elif s is BoxShape3D:
				rr = (s as BoxShape3D).size.length() * 0.5
			elif s is CapsuleShape3D:
				rr = (s as CapsuleShape3D).height * 0.5
			elif s is CylinderShape3D:
				rr = Vector2((s as CylinderShape3D).radius, (s as CylinderShape3D).height * 0.5).length()
			elif s is ConvexPolygonShape3D:
				rr = 0.0
				for p in (s as ConvexPolygonShape3D).points:
					rr = maxf(rr, p.length())
			r = maxf(r, rr + (c as CollisionShape3D).position.length())
	b.set_meta("_glass_r", r)
	return r


## One-shot swept test (no cache), same signature/keys as FastImpact.predict_crossing.
## body: RigidBody3D, or {space, from, velocity, radius}. t in the result is relative (s from now).
static func predict_crossing(body_or_ray: Variant, dt: float, targets_mask: int, exclude: Array = [], lookahead := 1.25,
		gravity := GRAVITY) -> Dictionary:
	var space: PhysicsDirectSpaceState3D
	var p: Vector3
	var v: Vector3
	var rad := 0.002
	var ex := exclude.duplicate()
	if body_or_ray is RigidBody3D:
		var rb := body_or_ray as RigidBody3D
		space = rb.get_world_3d().direct_space_state
		p = rb.global_position
		v = rb.linear_velocity
		rad = body_radius(rb)
		gravity *= rb.gravity_scale
		ex.append(rb.get_rid())
	else:
		var d: Dictionary = body_or_ray
		space = d["space"]
		p = d["from"]
		v = d["velocity"]
		rad = float(d.get("radius", rad))
	var T := dt * lookahead
	var motion := v * T + 0.5 * gravity * T * T
	if motion.length() < 1e-5:
		return {}
	var sh := SphereShape3D.new()
	sh.radius = rad
	var q := PhysicsShapeQueryParameters3D.new()
	q.shape = sh
	q.transform = Transform3D(Basis.IDENTITY, p)
	q.motion = motion
	q.collision_mask = targets_mask
	q.exclude = ex
	var r := space.cast_motion(q)
	if r.size() < 2 or r[0] >= 1.0:
		return {}
	var f: float = r[1]
	q.transform = Transform3D(Basis.IDENTITY, p + motion * minf(f + 0.002, 1.0))
	q.motion = Vector3.ZERO
	var ri := space.get_rest_info(q)
	if ri.is_empty():
		return {}
	var t := f * T
	var vi := v + gravity * t
	var vr := vi - (ri["linear_velocity"] as Vector3)
	return {"hit": true, "t": t, "point": ri["point"], "normal": ri["normal"], "collider_id": ri["collider_id"],
		"collider": instance_from_id(int(ri["collider_id"])), "v_impact": vi, "v_rel": vr,
		"v_n": maxf(-vr.dot(ri["normal"]), 0.0)}
