class_name FastImpact
extends RefCounted
## Impact detection for FAST movers that does not rely on the engine reporting a contact:
##  - bullets: hitscan or per-step ballistic ray segments, every bottle along the ray is hit (sorted by distance, energy reduced)
##  - thrown bodies: each physics step the swept path (p + v dt + g dt^2 / 2, a little more than one step ahead) is shape-cast
##    from the leading edge; the contact point/normal/speed are PREDICTED, so the break check uses the pre-solver velocity
##    even if the solver would tunnel or has already removed speed.
## Naming matches the glass system's predict_crossing(body or ray, targets): same arguments, same result keys.
##
## predict_crossing result: {hit, t (s until contact), point, normal (points away from the collider), collider, collider_id,
##   shape_idx (index of our shape that hits), v_impact (our velocity at contact), v_rel (relative to collider), v_n (m/s, >= 0)}

const GRAVITY := Vector3(0, -9.81, 0)
const MAX_ITERS := 20000   ## hard cap on fire() segments (120 Hz * 160 s)


## Swept test for a body. targets_mask = physics layers to test against. Returns {} when nothing is hit within lookahead*dt.
## `body` may be a RigidBody3D (its collision shapes are cast) or a Dictionary {from, velocity, radius} describing a ray/sphere.
## t0/span (seconds, analytic ballistic path p0 + v t + g t^2/2): test the window [t0, t0 + span]; span < 0 = dt * lookahead.
static func predict_crossing(body: Variant, dt: float, targets_mask: int, exclude: Array = [], lookahead := 1.25,
		gravity := GRAVITY, t0 := 0.0, span := -1.0) -> Dictionary:
	var rb: RigidBody3D = body as RigidBody3D
	var space: PhysicsDirectSpaceState3D
	var v: Vector3
	var p0: Vector3
	var shapes: Array = []   # [{shape, xf}]
	if rb:
		space = rb.get_world_3d().direct_space_state
		v = rb.linear_velocity
		p0 = rb.global_position
		for c in rb.get_children():
			if c is CollisionShape3D and not (c as CollisionShape3D).disabled and (c as CollisionShape3D).shape:
				shapes.append({"shape": (c as CollisionShape3D).shape, "xf": rb.global_transform * (c as CollisionShape3D).transform})
		gravity = gravity * rb.gravity_scale
		exclude = exclude + [rb.get_rid()]
	else:
		var d: Dictionary = body
		space = d["space"]
		v = d["velocity"]
		p0 = d["from"]
		var sp := SphereShape3D.new()
		sp.radius = float(d.get("radius", 0.002))
		shapes.append({"shape": sp, "xf": Transform3D(Basis.IDENTITY, p0)})
	var T := dt * lookahead if span < 0.0 else span
	var off := v * t0 + 0.5 * gravity * t0 * t0
	var motion := v * T + 0.5 * gravity * (2.0 * t0 * T + T * T)
	if motion.length() < 1e-4:
		return {}
	var best := {}
	var best_f := 2.0
	for i in shapes.size():
		var q := PhysicsShapeQueryParameters3D.new()
		q.shape = shapes[i]["shape"]
		var sx: Transform3D = shapes[i]["xf"]
		sx.origin += off
		q.transform = sx
		q.motion = motion
		q.collision_mask = targets_mask
		q.exclude = exclude
		q.margin = 0.002
		var r := space.cast_motion(q)
		if r.size() < 2 or r[0] >= 1.0:
			continue
		var f: float = r[1]   # first fraction in collision
		if f >= best_f:
			continue
		# contact info: put the shape slightly past the first-contact fraction
		var xf: Transform3D = sx
		xf.origin += motion * minf(f + 0.002, 1.0)
		q.transform = xf
		q.motion = Vector3.ZERO
		var ri := space.get_rest_info(q)
		if ri.is_empty():
			continue
		best_f = f
		best = {"hit": true, "t": t0 + f * T, "point": ri["point"], "normal": ri["normal"], "collider_id": ri["collider_id"],
			"collider": instance_from_id(int(ri["collider_id"])), "shape_idx": i, "col_vel": ri["linear_velocity"]}
	if best.is_empty():
		return {}
	var t: float = best["t"]
	var vi := v + gravity * t
	var vr := vi - (best["col_vel"] as Vector3)
	best["v_impact"] = vi
	best["v_rel"] = vr
	best["v_n"] = maxf(-vr.dot(best["normal"]), 0.0)
	return best


## All collider hits along a segment, nearest first. Each: {point, normal, collider, collider_id, rid, t (0..1)}.
static func ray_hits(space: PhysicsDirectSpaceState3D, from: Vector3, to: Vector3, mask: int, exclude: Array = [],
		max_hits := 8) -> Array:
	var out: Array = []
	var ex := exclude.duplicate()
	var dist := from.distance_to(to)
	for i in max_hits:
		var q := PhysicsRayQueryParameters3D.create(from, to, mask, ex)
		q.hit_from_inside = true
		var h := space.intersect_ray(q)
		if h.is_empty():
			break
		out.append({"point": h["position"], "normal": h["normal"], "collider": h["collider"], "collider_id": h["collider_id"],
			"rid": h["rid"], "t": from.distance_to(h["position"]) / maxf(dist, 1e-6)})
		ex.append(h["rid"])
	return out


## Resolve a bullet. muzzle_speed <= 0: hitscan over max_range. Otherwise ballistic ray segments of step_dt with gravity drop.
## Every bottle (anything with hit_by_projectile / receive_ballistic_hit) on the way gets the hit at the exact ray point;
## shattered / pierced glass passes on `pass_fraction` of the energy, anything else stops the bullet.
## Returns [{collider, point, energy, outcome}] in hit order.
static func fire(space: PhysicsDirectSpaceState3D, from: Vector3, direction: Vector3, energy_joules: float, caliber: float,
		mask: int, max_range := 120.0, muzzle_speed := 0.0, exclude: Array = [], pass_fraction := 0.55,
		step_dt := 1.0 / 120.0) -> Array:
	var results: Array = []
	var E := energy_joules
	var dir := direction.normalized()
	var ex := exclude.duplicate()
	var travelled := 0.0
	var pos := from
	var vel := dir * (muzzle_speed if muzzle_speed > 0.0 else 1.0)
	var done := false
	var iters := 0
	while not done and travelled < max_range and E > 2.0:
		var seg_end: Vector3
		if muzzle_speed > 0.0:
			var nv := vel + GRAVITY * step_dt
			seg_end = pos + (vel + nv) * 0.5 * step_dt
			vel = nv
			dir = vel.normalized()
		else:
			seg_end = pos + dir * (max_range - travelled)
		for h in ray_hits(space, pos, seg_end, mask, ex):
			var col: Object = h["collider"]
			var tgt := _bottle_of(col)
			if tgt == null:
				done = true   # world / unknown object: the bullet stops
				break
			var info: Dictionary = tgt.hit_by_projectile(h["point"], dir, E, caliber)
			var out: int = int(info.get("outcome", 0))
			results.append({"collider": tgt, "point": h["point"], "energy": E, "outcome": out})
			ex.append(h["rid"])
			if out == BottleBreakProfile.Outcome.SHATTER or out == BottleBreakProfile.Outcome.NECK_SNAP \
					or out == BottleBreakProfile.Outcome.PIERCE:
				E *= pass_fraction
				if E < 2.0:
					done = true
					break
			else:
				done = true
				break
		# Guarantee progress: float32 rounding of seg_end can make the measured distance 0 (endless loop at long range).
		if muzzle_speed > 0.0:
			travelled += maxf(pos.distance_to(seg_end), 1e-3)
		else:
			travelled = max_range   # hitscan is a single segment
		pos = seg_end
		iters += 1
		if iters >= MAX_ITERS:
			break
	return results


static func _bottle_of(o: Object) -> Node:
	var n := o as Node
	while n != null:
		if n.has_method("hit_by_projectile"):
			return n
		n = n.get_parent()
	return null


## For any fast RigidBody3D that is NOT a BreakableBottle (thrown rock, tool, ...): call every physics step.
## A bottle on the predicted path gets apply_impact at the predicted contact with the predicted relative speed.
## Returns the prediction ({} if none). The caller keeps its own body; it is not modified.
static func step_thrown(body: RigidBody3D, dt: float, targets_mask: int, min_speed := 3.0) -> Dictionary:
	if body.linear_velocity.length() < min_speed:
		return {}
	var pp: PathPredictor = body.get_meta("path_predictor") if body.has_meta("path_predictor") else null
	if pp == null:
		pp = PathPredictor.new()
		body.set_meta("path_predictor", pp)
	var p := pp.step(body, dt, targets_mask)
	if p.is_empty():
		return p
	var tgt := p["collider"] as BreakableBottle
	if tgt == null:
		return p
	var key := body.get_instance_id()
	if tgt.take_prediction(key):
		tgt.apply_impact(p["point"], p["normal"], 0.0, {"mass": body.mass, "speed": p["v_n"], "surface": String(body.get_meta("break_surface", "wood")),
			"kind": "thrown", "collider_id": key})
	return p
