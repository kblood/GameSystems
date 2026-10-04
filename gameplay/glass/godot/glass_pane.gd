@tool
class_name GlassPane
extends StaticBody3D
## A breakable glass pane (house window, car window, shop front, door). Pane local frame: X right, Y up, +Z = front /
## outside; size in metres, origin at the pane centre. Optional cylindrical bends (curvature, 1/m).
##   var p := GlassPane.new(); p.size = Vector2(1, 1.2); p.glass_type = "annealed"; add_child(p)
##   p.hit_by_projectile(point, dir, 500.0, 0.009)             # -> {outcome, pass_through, residual_velocity, ...}
##   p.apply_impact(point, normal, 2.4, Vector3(0, 0, -9), "edge", 0.8)
##   GlassSystem.get_for(p).track(thrown_body)                  # predicted crossing for thrown objects
## Signals mirror BreakableBottle (broke(..., energy, kind)) with the pane as first argument.

signal damaged(pane: GlassPane, point: Vector3, outcome: int, energy: float)
signal broke(pane: GlassPane, position: Vector3, energy: float, kind: StringName)
signal pierced(pane: GlassPane, point: Vector3, residual_velocity: Vector3)
signal impact_assessed(pane: GlassPane, info: Dictionary)

const Outcome := GlassDamageModel.Outcome
const MAX_HOLES := 16

@export var size := Vector2(1.0, 1.2):
	set(v):
		size = v
		_queue_rebuild()
@export_enum("annealed", "tempered", "laminated", "wired", "resistant") var glass_type := "annealed":
	set(v):
		glass_type = v
		profile = null
		_queue_rebuild()
@export var thickness_mm := -1.0:                           ## <= 0: profile default
	set(v):
		thickness_mm = v
		_queue_rebuild()
@export var profile: GlassProfile
@export var curvature := Vector2.ZERO:                      ## 1/m: x = bend across the width (windscreen), y = height
	set(v):
		curvature = v
		_queue_rebuild()
@export_flags("left", "right", "bottom", "top") var clamped_edges := 15
@export var pane_seed := 0                                  ## 0 = from the node path (deterministic per scene)
@export_range(-1, 3) var tier := -1                         ## -1 = GlassSystem tier; else the cheapest of both
@export_group("Look")
@export var band_height := 0.0                              ## windscreen shade band (m from the top)
@export var band_color := Color(0.12, 0.3, 0.35, 0.55)
@export var heater_lines := 0
@export_group("Physics")
@export_flags_3d_physics var pane_layer := 1 | (1 << 20)    ## world + "glass panes" (prediction / bullets)
@export var auto_track_bodies := true                       ## sensor adds nearby RigidBody3Ds to the path predictor
@export var sensor_margin := 0.6                            ## m each side (covers 36 m/s at 60 Hz before the pane)
@export var pass_exception_time := 0.6

var damage := 0.0
var flaw := 1.0
var broken := false                                         ## nothing left to hit (diced / fully fallen)
var fractured := false                                      ## replaced by cell geometry
var history: Array[Dictionary] = []                         ## impacts (pane-local) for save / load / replay
var holes_a := PackedVector4Array()
var holes_b := PackedVector4Array()
var bulges := PackedVector4Array()
var cells: Array = []
var mask: GlassCrackMask
var material: ShaderMaterial
var mesh_instance: MeshInstance3D
var cell_instance: MeshInstance3D
var flap_instance: MeshInstance3D
var last_info := {}
var used_tier := -1

var _shape_nodes: Array[CollisionShape3D] = []
var _cell_shape: CollisionShape3D
var _sensor: Area3D
var _rng := RandomNumberGenerator.new()
var _pending_falls: Array[Dictionary] = []
var _anim := {}
var _built := false
var _sys: GlassSystem
var _primary := {}                                          # pattern of the strongest impact (fracture geometry)
var _replaying := false
var _paint_queue: Array = []                                # deferred crack strokes [pts, width, v0, v1] (time-sliced)
var _paint_head := 0
var paint_budget_ms := 1.0                                   ## crack painting per frame after a hit
var first_paint_ms := 2.5                                   ## painted synchronously in the hit itself


func _ready() -> void:
	add_to_group("glass_panes")
	_build()
	if not Engine.is_editor_hint():
		_sys = GlassSystem.get_for(self)
		damaged.connect(func(p, pt, o, e): _sys.pane_damaged.emit(p, pt, o, e))
		broke.connect(func(p, pt, e, k): _sys.pane_broke.emit(p, pt, e, k))
		pierced.connect(func(p, pt, v): _sys.pane_pierced.emit(p, pt, v))
	set_process(false)


func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE and mask and is_instance_valid(_sys):
		_sys.mask_released(mask.bytes())   # give the mask budget back
		mask = null


func _queue_rebuild() -> void:
	if _built and is_inside_tree():
		_build()


func get_profile() -> GlassProfile:
	if profile == null:
		profile = GlassProfile.preset(glass_type, thickness_mm)
	elif thickness_mm > 0.0:
		profile.thickness_mm = thickness_mm
	return profile


func half() -> Vector2:
	return size * 0.5


func _seed() -> int:
	return pane_seed if pane_seed != 0 else hash(String(get_path()) if is_inside_tree() else name)


# ------------------------------------------------------------------ build

func _build() -> void:
	_built = true
	var p := get_profile()
	for c in get_children():
		if c.has_meta("_glass_gen"):
			remove_child(c)
			c.queue_free()
	_shape_nodes.clear()
	collision_layer = pane_layer
	_rng.seed = _seed()
	flaw = p.roll_flaw(_rng)
	material = ShaderMaterial.new()
	material.shader = load((get_script() as Script).resource_path.get_base_dir() + "/glass_pane.gdshader")
	_setup_material()
	mesh_instance = MeshInstance3D.new()
	mesh_instance.set_meta("_glass_gen", true)
	mesh_instance.name = "PaneMesh"
	mesh_instance.mesh = _pane_mesh()
	mesh_instance.material_override = material
	mesh_instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mesh_instance)
	_build_collider()
	if auto_track_bodies and not Engine.is_editor_hint():
		_sensor = Area3D.new()
		_sensor.set_meta("_glass_gen", true)
		_sensor.collision_layer = 0
		_sensor.collision_mask = 0xFFFFF & ~(1 << 19)     # not shards
		_sensor.monitorable = false
		var cs := CollisionShape3D.new()
		var bx := BoxShape3D.new()
		var sag := _sag()
		bx.size = Vector3(size.x + 0.3, size.y + 0.3, sensor_margin * 2.0 + sag)
		cs.shape = bx
		cs.position.z = -sag * 0.5
		_sensor.add_child(cs)
		add_child(_sensor)
		_sensor.body_entered.connect(_on_sensor_body)


func _sag() -> float:
	var s := 0.0
	if absf(curvature.x) > 1e-5:
		s += (1.0 - cos(size.x * 0.5 * curvature.x)) / absf(curvature.x)
	if absf(curvature.y) > 1e-5:
		s += (1.0 - cos(size.y * 0.5 * curvature.y)) / absf(curvature.y)
	return s


func _setup_material() -> void:
	var p := get_profile()
	material.set_shader_parameter("tint", p.tint)
	material.set_shader_parameter("edge_tint", p.edge_tint)
	material.set_shader_parameter("pane_size", size)
	material.set_shader_parameter("thickness", p.t_m())
	material.set_shader_parameter("wire_spacing", p.wire_spacing)
	material.set_shader_parameter("band_height", band_height)
	material.set_shader_parameter("band_color", band_color)
	material.set_shader_parameter("heater_lines", heater_lines)
	material.set_shader_parameter("use_mask", false)
	material.set_shader_parameter("hole_count", 0)
	material.set_shader_parameter("bulge_count", 0)
	material.set_shader_parameter("craze", 0.0)
	material.set_shader_parameter("frost_cover", 0.0)


## Intact pane: subdivided slab (subdivision only where needed: curvature or laminated bulge).
func _pane_mesh() -> ArrayMesh:
	var p := get_profile()
	var need := curvature.length() > 1e-4 or p.mode == "laminated"
	var nx := clampi(int(ceil(size.x / 0.06)), 1, 40) if need else 1
	var ny := clampi(int(ceil(size.y / 0.06)), 1, 40) if need else 1
	var h := half()
	var polys: Array = []
	for y in ny:
		for x in nx:
			var a := Vector2(-h.x + size.x * x / nx, -h.y + size.y * y / ny)
			var b := Vector2(-h.x + size.x * (x + 1) / nx, -h.y + size.y * (y + 1) / ny)
			polys.append(PackedVector2Array([a, Vector2(b.x, a.y), b, Vector2(a.x, b.y)]))
	var skip := {}
	if nx * ny > 1:
		var cnt := {}
		for q in polys:
			for i in 4:
				var k := GlassFracture.edge_key(q[i], q[(i + 1) % 4])
				cnt[k] = int(cnt.get(k, 0)) + 1
		for k in cnt:
			if cnt[k] > 1:
				skip[k] = true
	return GlassFracture.slab_mesh(polys, p.t_m(), size, curvature, Vector3.ZERO, skip)


func _build_collider() -> void:
	var t := get_profile().t_m()
	var strips := 1 if absf(curvature.x) < 1e-4 else clampi(int(ceil(size.x * absf(curvature.x) * 10.0)), 2, 12)
	var rows := 1 if absf(curvature.y) < 1e-4 else clampi(int(ceil(size.y * absf(curvature.y) * 10.0)), 2, 8)
	var h := half()
	for sy in rows:
		for sx in strips:
			var cs := CollisionShape3D.new()
			cs.set_meta("_glass_gen", true)
			if strips == 1 and rows == 1:
				var b := BoxShape3D.new()
				b.size = Vector3(size.x, size.y, maxf(t, 0.004))
				cs.shape = b
			else:
				var pts := PackedVector3Array()
				for cy in 2:
					for cx in 2:
						var p2 := Vector2(-h.x + size.x * (sx + cx) / strips, -h.y + size.y * (sy + cy) / rows)
						pts.append(GlassFracture.surf(p2, maxf(t, 0.004) * 0.5, curvature))
						pts.append(GlassFracture.surf(p2, -maxf(t, 0.004) * 0.5, curvature))
				var cp := ConvexPolygonShape3D.new()
				cp.points = pts
				cs.shape = cp
			add_child(cs)
			_shape_nodes.append(cs)


func _set_intact_collider(on: bool) -> void:
	for cs in _shape_nodes:
		cs.set_deferred("disabled", not on)


func _on_sensor_body(b: Node3D) -> void:
	if b is RigidBody3D and not (b as RigidBody3D).freeze and _sys and not broken:
		if (b as RigidBody3D).collision_layer & (1 << 19):
			return
		_sys.track(b)


# ------------------------------------------------------------------ public API

## Bullet / fast small projectile. energy_joules at the pane, caliber in metres.
## params: speed (m/s), mass (kg), bullet ("fmj" | "hp" | "lead"). Returns the assessment (see GlassDamageModel.assess)
## + pierced, residual_velocity (world, m/s: continue your projectile with it), outcome_name.
func hit_by_projectile(point: Vector3, direction: Vector3, energy_joules: float, caliber := 0.009, params := {}) -> Dictionary:
	var imp := GlassImpact.bullet(caliber, energy_joules, float(params.get("speed", -1.0)), String(params.get("bullet", "fmj")))
	if params.has("mass"):
		imp.mass = float(params["mass"])
		imp.velocity = direction.normalized() * sqrt(2.0 * energy_joules / imp.mass)
	else:
		imp.velocity = direction.normalized() * imp.speed()
	imp.point = point
	return impact(imp)


## Thrown / swung object. velocity = striker velocity (world). shape: point | edge | rod | ball | flat.
## hardness relative to glass (stone 1.1, brick 0.8, wood 0.35, flesh 0.06). params: radius, contact, deform, kind, body.
func apply_impact(point: Vector3, normal: Vector3, mass: float, velocity: Vector3, shape := "ball", hardness := 1.0,
		params := {}) -> Dictionary:
	var imp := GlassImpact.new()
	imp.point = point
	imp.mass = mass
	imp.velocity = velocity if velocity.length() > 1e-6 else -normal * 0.01
	imp.shape = shape
	imp.hardness = hardness
	imp.radius = float(params.get("radius", 0.04))
	imp.contact = float(params.get("contact", minf(imp.radius, 0.02)))
	imp.deform = float(params.get("deform", 0.0))
	imp.kind = String(params.get("kind", "thrown"))
	imp.body = params.get("body", null)
	return impact(imp)


## Bottle-style contact (BreakableBottle.apply_impact signature): impulse N*s along the normal,
## striker_info {mass, surface, sharp, speed, radius}.
func apply_contact(point: Vector3, normal: Vector3, impulse: float, striker_info := {}) -> Dictionary:
	var m := float(striker_info.get("mass", 1.0))
	if is_inf(m):
		m = 50.0
	var v := float(striker_info.get("speed", impulse / maxf(m, 1e-3)))
	var sharp := float(striker_info.get("sharp", 1.0))
	var shape := "point" if sharp >= 2.4 else ("edge" if sharp >= 1.5 else "ball")
	var H: float = GlassImpact.SURFACE_HARDNESS.get(String(striker_info.get("surface", "stone")), 1.0)
	return apply_impact(point, normal, m, -normal * v, shape, H, striker_info)


## NightfallGrabbable / NightfallBallistics compatible: a 9 mm round.
func receive_ballistic_hit(at: Vector3, direction: Vector3) -> void:
	hit_by_projectile(at, direction, 500.0, 0.009)


## Predicted contact of a RigidBody3D (GlassPathPredictor / your own sweep). Lets the body pass through when the glass
## fails (collision exception for pass_exception_time + residual velocity), else the engine bounces it.
func impact_from_body(body: RigidBody3D, point: Vector3, velocity: Vector3, _normal := Vector3.ZERO) -> Dictionary:
	var imp := striker_from_body(body)
	imp.point = point
	imp.velocity = velocity
	var r := impact(imp)
	if r.get("pass_through", false):
		body.add_collision_exception_with(self)
		var vr: Vector3 = r["residual_velocity"]
		body.linear_velocity = vr
		body.angular_velocity += Vector3(_rng.randfn(), _rng.randfn(), _rng.randfn()) * 2.0
		if is_inside_tree():
			var tm := get_tree().create_timer(pass_exception_time, false, true)
			var wb: WeakRef = weakref(body)
			tm.timeout.connect(func():
				var bb = wb.get_ref()
				if bb and is_instance_valid(self):
					bb.remove_collision_exception_with(self))
		# a bottle flying through is hit too (shared striker model)
		if body.has_method("apply_impact") and body.get_script() and (body.get_script() as Script).get_global_name() == &"BreakableBottle":
			var dv := (velocity - vr).length()
			body.call("apply_impact", point, -velocity.normalized(), body.mass * dv,
				{"mass": get_profile().areal_mass() * 0.05, "surface": "glass", "sharp": 1.6, "kind": "glass_pane"})
	return r


## Striker parameters of a body: meta "glass_striker" = preset name or dictionary {shape, hardness, radius, contact,
## deform}; BreakableBottle -> "bottle"; else ball, hardness 0.8, radius from the shapes.
func striker_from_body(body: RigidBody3D) -> GlassImpact:
	var preset := "bottle" if body.get_script() and (body.get_script() as Script).get_global_name() == &"BreakableBottle" else ""
	var meta = body.get_meta("glass_striker", preset)
	var imp: GlassImpact
	if meta is String and meta != "":
		imp = GlassImpact.from_preset(meta)
	else:
		imp = GlassImpact.new()
		imp.shape = "ball"
		imp.hardness = 0.8
		imp.radius = GlassPathPredictor.body_radius(body)
		imp.contact = minf(imp.radius * 0.4, 0.03)
		if meta is Dictionary:
			for k in meta:
				imp.set(k, meta[k])
	imp.mass = body.mass
	imp.body = body
	imp.kind = String(body.name) if imp.kind == "custom" else imp.kind
	return imp


func damage_percent() -> float:
	if broken:
		return 100.0
	var fallen := 0.0
	var tot := 0.0
	for c in cells:
		tot += float(c["area"])
		if c["gone"]:
			fallen += float(c["area"])
	return clampf(maxf(damage, fallen / maxf(tot, 1e-6)) * 100.0, 0.0, 100.0)


func repair() -> void:
	damage = 0.0
	broken = false
	fractured = false
	history.clear()
	holes_a.clear()
	holes_b.clear()
	bulges.clear()
	cells.clear()
	_primary = {}
	_pending_falls.clear()
	_paint_queue.clear()
	_paint_head = 0
	_anim.clear()
	set_process(false)
	if mask and _sys:
		_sys.mask_released(mask.bytes())
	mask = null
	for n in [cell_instance, flap_instance]:
		if n and is_instance_valid(n):
			n.queue_free()
	cell_instance = null
	flap_instance = null
	if _cell_shape:
		_cell_shape.queue_free()
		_cell_shape = null
	_rng.seed = _seed()
	flaw = get_profile().roll_flaw(_rng)
	_setup_material()
	material.set_shader_parameter("mask", null)
	mesh_instance.visible = true
	_set_intact_collider(true)


## Damage state: replaying the stored impacts reproduces it exactly (deterministic seeds).
func get_damage_state() -> Dictionary:
	return {"glass_type": glass_type, "thickness_mm": get_profile().thickness_mm, "seed": _seed(), "impacts": history.duplicate(true)}


func set_damage_state(st: Dictionary) -> void:
	repair()
	_replaying = true
	for h in st.get("impacts", []):
		var imp := GlassImpact.new().from_dict(h["imp"])
		imp.point = global_transform * imp.point
		imp.velocity = global_transform.basis * imp.velocity
		imp.silent = true
		used_tier = int(h.get("tier", -1))
		impact(imp)
	_replaying = false


# ------------------------------------------------------------------ core

func impact(imp: GlassImpact) -> Dictionary:
	var p := get_profile()
	var inv := global_transform.affine_inverse()
	var lp := inv * imp.point
	var p2 := GlassFracture.to_2d(lp, curvature)
	p2 = p2.clamp(-half(), half())
	var n_local := GlassFracture.surf_normal(p2, curvature)
	var n_world := (global_transform.basis * n_local).normalized()
	var dir_local := (global_transform.basis.inverse() * imp.dir()).normalized()
	imp.side = 1.0 if dir_local.dot(n_local) < 0.0 else -1.0
	if broken or _in_hole(p2):
		var free := {"outcome": Outcome.NONE, "outcome_name": "none", "pass_through": true, "pierced": true,
			"residual_velocity": imp.velocity, "point": imp.point, "hole_radius": 0.0, "through_hole": true}
		return free
	var idx := history.size()
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(Vector2i(_seed(), idx))
	var ctx := _context(p2)
	ctx["normal"] = n_world
	ctx["noise"] = clampf(1.0 + rng.randfn(0.0, 0.04), 0.9, 1.1)
	var r := GlassDamageModel.assess(p, ctx, imp)
	r["point"] = imp.point
	r["p2"] = p2
	r["outcome_name"] = GlassDamageModel.outcome_name(r["outcome"])
	var t := used_tier if imp.silent and used_tier >= 0 else (_sys.effective_tier(imp.point, tier) if _sys else 0)
	used_tier = t
	r["tier"] = t
	if fractured and r["outcome"] > Outcome.NONE:
		_hit_fractured(r, imp, p2, rng, t)
	else:
		_apply(r, imp, p2, rng, t)
	if r["pass_through"] and r["projectile"] and float(r["deflect_deg"]) > 0.0:
		var v: Vector3 = r["residual_velocity"]
		var axis := v.cross(Vector3(rng.randfn(), rng.randfn(), rng.randfn())).normalized()
		if axis.length() > 0.5:
			r["residual_velocity"] = v.rotated(axis, deg_to_rad(float(r["deflect_deg"]) * rng.randf()))
	damage = clampf(damage + float(r["d_damage"]), 0.0, 1.0)
	r["damage"] = damage
	r["pierced"] = r["pass_through"]
	history.append({"imp": _local_imp(imp), "tier": t, "d_local": r["d_local"], "p2": [p2.x, p2.y],
		"L": r["crack_length"], "outcome": r["outcome"]})
	last_info = r
	if not _paint_queue.is_empty():
		_paint_some(INF if imp.silent else first_paint_ms)
		if not _paint_queue.is_empty():
			set_process(true)
	if mask:
		mask.commit()
	_push_holes()
	if not imp.silent:
		impact_assessed.emit(self, r)
		var e: float = r["energy"]
		if r["outcome"] > Outcome.NONE:
			damaged.emit(self, imp.point, r["outcome"], e)
		if r["pass_through"]:
			pierced.emit(self, imp.point, r["residual_velocity"])
		if r["outcome"] == Outcome.SHATTERED or (r["outcome"] == Outcome.PUNCHED and not r["projectile"]):
			broke.emit(self, imp.point, e, r["kind"] if r["kind"] != &"" else &"shatter")
	return r


func _local_imp(imp: GlassImpact) -> Dictionary:
	var d := imp.to_dict()
	var lp := global_transform.affine_inverse() * imp.point
	var lv := global_transform.basis.inverse() * imp.velocity
	d["point"] = [lp.x, lp.y, lp.z]
	d["velocity"] = [lv.x, lv.y, lv.z]
	return d


func _context(p2: Vector2) -> Dictionary:
	var h := half()
	var de := [p2.x + h.x, h.x - p2.x, p2.y + h.y, h.y - p2.y]   # left right bottom top
	var d_edge: float = de.min()
	var span := INF
	var nearest_free := false
	for i in 4:
		if clamped_edges & (1 << i):
			span = minf(span, de[i])
	if is_inf(span):
		span = minf(size.x, size.y) * 0.5
		nearest_free = true
	else:
		var imin: int = de.find(d_edge)
		nearest_free = not (clamped_edges & (1 << imin))
	var near := 0.0
	var loc := 0.0
	for hst in history:
		var q := Vector2(hst["p2"][0], hst["p2"][1])
		var d := q.distance_to(p2)
		near = maxf(near, exp(-d / (0.5 * minf(float(hst["L"]), 1.0) + 0.03)) if int(hst["outcome"]) >= Outcome.CRACKED else 0.0)
		if d < 0.08:
			loc += float(hst["d_local"])
	return {"d_edge": d_edge, "span": span, "free_edge": nearest_free, "damage": damage, "near": near,
		"flaw": flaw, "local_damage": clampf(loc, 0.0, 1.0), "size_min": minf(size.x, size.y)}


func _in_hole(p2: Vector2) -> bool:
	if fractured:
		for c in cells:
			if not c["gone"] and Geometry2D.is_point_in_polygon(p2, c["poly"]):
				return false
		return true
	for i in holes_a.size():
		var a := holes_a[i]
		if Vector2(a.x, a.y).distance_to(p2) < a.z * 0.8:
			return true
	if mask:
		var px := mask.to_px(p2)
		var ix := clampi(int(px.x), 0, mask.w - 1)
		var iy := clampi(int(px.y), 0, mask.h - 1)
		return mask.data[(iy * mask.w + ix) * 4 + 2] > 127
	return false


func _ensure_mask(t: int) -> bool:
	if mask:
		return true
	if _sys == null:
		return false
	var px := _sys.request_mask(size, t)
	if px <= 0.0:
		return false
	mask = GlassCrackMask.new()
	mask.setup(size, px, 1024, bool(_sys.tier_cfg(t)["mask_mips"]))
	_sys.mask_allocated(mask.bytes())
	material.set_shader_parameter("mask", mask.tex)
	material.set_shader_parameter("use_mask", true)
	material.set_shader_parameter("mask_texel", Vector2(1.0 / mask.w, 1.0 / mask.h))
	if t == GlassSystem.Tier.HIGH:
		material.shader = _sys.pane_shader(t)
	return true


func _add_hole(p2: Vector2, r_hole: float, front: float, back: float, star_len: float, radials: int, seed_f: float) -> void:
	if holes_a.size() >= MAX_HOLES:
		# bake the oldest into the mask (if any), drop the descriptor
		var a := holes_a[0]
		if mask:
			mask.disc(Vector2(a.x, a.y), a.z, 1.0, 2, 0.05)
			mask.disc(Vector2(a.x, a.y), maxf(a.w, holes_b[0].x), 0.8, 3, 0.4)
		holes_a.remove_at(0)
		holes_b.remove_at(0)
	holes_a.append(Vector4(p2.x, p2.y, r_hole, front))
	holes_b.append(Vector4(back, star_len, float(radials), seed_f))


func _push_holes() -> void:
	material.set_shader_parameter("hole_count", holes_a.size())
	if holes_a.size() > 0:
		var a := holes_a.duplicate()
		var b := holes_b.duplicate()
		a.resize(MAX_HOLES)
		b.resize(MAX_HOLES)
		material.set_shader_parameter("hole_a", a)
		material.set_shader_parameter("hole_b", b)
	material.set_shader_parameter("bulge_count", bulges.size())
	if bulges.size() > 0:
		var g := bulges.duplicate()
		g.resize(4)
		material.set_shader_parameter("bulge", g)


func _pattern(p2: Vector2, radials: int, rng: RandomNumberGenerator, t: int) -> Dictionary:
	var p := get_profile()
	var sc: float = _sys.tier_cfg(t)["radial_scale"] if _sys else 1.0
	var n := maxi(4, int(round(radials * lerpf(1.0, sc, 1.0))))
	var ratio := p.ring_ratio * (1.0 if sc >= 1.0 else 1.35)
	return GlassFracture.radial_pattern(p2, half(), rng, n, ratio, 0.012 if p.mode != "laminated" else 0.008)


## Paint the cracks of a pattern up to length L (radials), rings up to ring_frac * L.
func _draw_pattern(pat: Dictionary, L: float, rings: int, rng: RandomNumberGenerator, width := 1.6, ring_chance := 0.55) -> void:
	if mask == null:
		return
	var rr: PackedFloat32Array = pat["rings"]
	var c: Vector2 = pat["center"]
	var pts: Array = pat["pts"]
	var mids: Array = pat["mids"]
	var n: int = pat["n"]
	var ends: Array[int] = []
	for i in n:
		var Li := L * rng.randf_range(0.45, 1.0)
		var line := PackedVector2Array([c])
		var pr: PackedVector2Array = pts[i]
		var pm: PackedVector2Array = mids[i]
		var kk := 0
		for k in pr.size():
			if rr[k] > Li:
				break
			line.append(pr[k])
			kk = k
			if k < pm.size() and k + 1 < rr.size() and rr[k + 1] <= Li:
				line.append(pm[k])
		ends.append(kk)
		_crack(line, width, 1.0, 0.45)
		# a branch now and then
		if line.size() > 3 and rng.randf() < 0.45:
			var j := rng.randi_range(1, line.size() - 2)
			var a0 := line[j]
			var dirv := (line[j + 1] - line[j]).normalized().rotated(rng.randf_range(-0.6, 0.6))
			var bl := PackedVector2Array([a0, a0 + dirv * Li * 0.15, a0 + dirv.rotated(rng.randf_range(-0.3, 0.3)) * Li * 0.3])
			_crack(bl, width * 0.7, 0.7, 0.3)
	for k in mini(rings, rr.size()):
		if rr[k] > L * 0.7:
			break
		for i in n:
			var j := (i + 1) % n
			if ends[i] < k or ends[j] < k or rng.randf() > ring_chance:
				continue
			var a := (pts[i] as PackedVector2Array)[k]
			var b := (pts[j] as PackedVector2Array)[k]
			var m := (a + b) * 0.5 + (a + b - c * 2.0).normalized() * a.distance_to(b) * 0.06
			_crack(PackedVector2Array([a, m, b]), width * 0.85, 0.8, 0.8)


func _apply(r: Dictionary, imp: GlassImpact, p2: Vector2, rng: RandomNumberGenerator, t: int) -> void:
	var p := get_profile()
	var out: int = r["outcome"]
	if out == Outcome.NONE:
		return
	var front: float = r["crater_entry"] if imp.side > 0.0 else r["crater_exit"]
	var back: float = r["crater_exit"] if imp.side > 0.0 else r["crater_entry"]
	var seed_f := rng.randf() * 100.0
	var L: float = minf(float(r["crack_length"]), maxf(size.x, size.y) * 1.2)
	var has_mask := _ensure_mask(t) if out >= Outcome.CRACKED else mask != null
	var star_len := L if not has_mask else maxf(front, back) * 2.5
	var mode := p.mode
	var kind: StringName = r["kind"]
	if out == Outcome.CHIP:
		_add_hole(p2, 0.0, front if front > 0 else float(r["crater_entry"]), back, maxf(L, 0.01), int(r["radials"]), seed_f)
		return
	if out == Outcome.SHATTERED and mode == "tempered":
		_add_hole(p2, float(r["hole_radius"]), front, back, 0.0, 0, seed_f)
		_dice(r, imp, p2, rng, t)
		return
	var pat := _pattern(p2, int(r["radials"]), rng, t)
	if _primary.is_empty() or float(r["energy_n"]) > float(_primary.get("e", 0.0)):
		_primary = {"pat": pat, "e": r["energy_n"]}
	var frost_r: float = r["frost_radius"]
	if has_mask:
		_draw_pattern(pat, L, int(r["rings"]), rng, 1.7 if mode != "laminated" else 1.3, p.ring_chance)
		if frost_r > 0.0:
			mask.disc(p2, frost_r, 0.85 * p.frost, 1, 0.6, rng)
		if out == Outcome.CRACKED and not r["projectile"]:
			mask.disc(p2, float(r["crater_entry"]) * 2.0, 0.9, 3, 0.5)
	# descriptor: hole / crater / star (cheap; the only crack visual without a mask)
	if r["projectile"] or float(r["hole_radius"]) > 0.0 or out == Outcome.CRACKED:
		var hr: float = r["hole_radius"] if r["projectile"] else 0.0
		_add_hole(p2, hr, front, back, star_len, int(r["radials"]) if not has_mask else 9, seed_f)
		if not has_mask and frost_r > 0.0:
			# LOW tier: frost as a big crater on both sides
			holes_a[holes_a.size() - 1].w = maxf(front, frost_r)
			holes_b[holes_b.size() - 1].x = maxf(back, frost_r)
	if float(r["bulge"]) > 0.0 and bulges.size() < 4:
		bulges.append(Vector4(p2.x, p2.y, clampf(L * 0.6, 0.05, 0.3), float(r["bulge"]) * -imp.side))
	if r["projectile"]:
		if out == Outcome.SHATTERED:      # annealed collapse after many holes
			_break_geometry(r, imp, p2, rng, t, pat)
		return
	if out == Outcome.PUNCHED and (mode == "laminated" or mode == "wired" or mode == "resistant"):
		_punch_soft(r, imp, p2, rng, t, pat)
	elif out >= Outcome.PUNCHED:
		_break_geometry(r, imp, p2, rng, t, pat)


# --------------------------------------------------- annealed: true 2D fracture (HIGH / MEDIUM), cutout (LOW / MINIMAL)

func _break_geometry(r: Dictionary, imp: GlassImpact, p2: Vector2, rng: RandomNumberGenerator, t: int, pat: Dictionary) -> void:
	var p := get_profile()
	var shatter: bool = r["outcome"] == Outcome.SHATTERED
	var c: Dictionary = _sys.tier_cfg(t) if _sys else GlassSystem.TIERS[0]
	if not bool(c["geometry"]):
		if shatter:
			_vanish()
			if bool(c["particles"]):
				_rim_only(rng)
		else:
			_add_hole(p2, float(r["drop_radius"]), float(r["drop_radius"]) * 1.15, float(r["drop_radius"]) * 1.15,
				float(r["drop_radius"]) * 2.5, 10, rng.randf() * 100.0)
		if _sys and not imp.silent:
			var s := size if shatter else Vector2.ONE * float(r["drop_radius"]) * 2.0
			_sys.burst(global_transform * GlassFracture.surf(p2 if not shatter else Vector2.ZERO, 0.0, curvature),
				global_transform.basis, s, imp.dir(), float(r["energy"]), 60 if shatter else 24)
		return
	var h := half()
	var tm := Time.get_ticks_usec()
	var cl := GlassFracture.cells_from_pattern(pat, h, rng, 0.3 if t == GlassSystem.Tier.HIGH else 0.6)
	if shatter:
		var inset := GlassFracture.teeth_inset(h, rng)
		var cl2: Array = []
		for cc in cl:
			for q in Geometry2D.intersect_polygons(cc["poly"], inset):
				cl2.append({"poly": q, "centroid": GlassFracture.centroid(q), "area": absf(GlassFracture.area(q)), "band": cc["band"], "inner": true})
			for q in Geometry2D.clip_polygons(cc["poly"], inset):
				if absf(GlassFracture.area(q)) > 1e-6:
					cl2.append({"poly": q, "centroid": GlassFracture.centroid(q), "area": absf(GlassFracture.area(q)), "band": cc["band"], "inner": false})
		cl = cl2
	cells = []
	for cc in cl:
		cc["gone"] = false
		cc["edge"] = GlassFracture.border_contact(cc["poly"], h, clamped_edges)
		cells.append(cc)
	fractured = true
	var drop_r: float = r["drop_radius"]
	var r_body := maxf(imp.radius, 0.01) * 1.15
	var dropped: Array[int] = []
	for i in cells.size():
		var cc: Dictionary = cells[i]
		var go := false
		if shatter:
			go = cc.get("inner", true)
		else:
			go = (cc["centroid"] as Vector2).distance_to(p2) < drop_r or GlassFracture.poly_hits_circle(cc["poly"], p2, r_body)
		if go:
			dropped.append(i)
	# loose neighbours of the hole fall later (annealed); cells without edge support next to the hole
	if not shatter and not p.holds_pieces:
		var hole_keys := {}
		for i in dropped:
			var q: PackedVector2Array = cells[i]["poly"]
			for e in q.size():
				hole_keys[GlassFracture.edge_key(q[e], q[(e + 1) % q.size()])] = true
		for i in cells.size():
			if i in dropped:
				continue
			var cc: Dictionary = cells[i]
			var q: PackedVector2Array = cc["poly"]
			var adj := false
			for e in q.size():
				if hole_keys.has(GlassFracture.edge_key(q[e], q[(e + 1) % q.size()])):
					adj = true
					break
			if adj and float(cc["edge"]) < 0.02 and rng.randf() < 0.6:
				_pending_falls.append({"i": i, "t": rng.randf_range(0.15, 2.0)})
	for i in dropped:
		_drop_cell(i, imp, p2, rng, t, true)
	_rebuild_cells()
	r["fracture_ms"] = (Time.get_ticks_usec() - tm) / 1000.0
	r["cells"] = cells.size()
	r["dropped"] = dropped.size()
	if not _pending_falls.is_empty() and not imp.silent:
		set_process(true)
	elif not _pending_falls.is_empty():
		for f in _pending_falls:
			_drop_cell(int(f["i"]), imp, p2, rng, t, false)
		_pending_falls.clear()
		_rebuild_cells()
	# cracks on what is left: the cell borders (each shared edge once). Painted over the next frames under a time
	# budget (paint_budget_ms) so a shatter never costs a frame spike; replays (silent) paint at once.
	if mask:
		var seen := {}
		for cc in cells:
			if cc["gone"]:
				continue
			var q: PackedVector2Array = cc["poly"]
			for e in q.size():
				var a := q[e]
				var b := q[(e + 1) % q.size()]
				var k := GlassFracture.edge_key(a, b)
				if seen.has(k) or (absf(a.x) >= h.x - 1e-4 and absf(b.x) >= h.x - 1e-4) or (absf(a.y) >= h.y - 1e-4 and absf(b.y) >= h.y - 1e-4):
					continue
				seen[k] = true
				_crack(PackedVector2Array([a, b]), 1.2, 0.9, 0.9)


func _drop_cell(i: int, imp: GlassImpact, p2: Vector2, rng: RandomNumberGenerator, t: int, fly: bool) -> void:
	var cc: Dictionary = cells[i]
	if cc["gone"]:
		return
	cc["gone"] = true
	if imp.silent or _sys == null:
		return
	var c: Dictionary = _sys.tier_cfg(t)
	var p := get_profile()
	var area: float = cc["area"]
	var poly: PackedVector2Array = cc["poly"]
	var dist := (cc["centroid"] as Vector2).distance_to(p2)
	var travel := global_transform.basis * (GlassFracture.surf_normal(cc["centroid"], curvature) * -imp.side)
	var vel := Vector3.ZERO
	var ang := Vector3(rng.randfn(), rng.randfn(), rng.randfn())
	if fly:
		var fall := 1.0 / (1.0 + dist / 0.15)
		vel = imp.velocity * rng.randf_range(0.15, 0.55) * fall + travel * rng.randf_range(0.3, 1.5) \
			+ global_transform.basis * Vector3((cc["centroid"] as Vector2 - p2).normalized().x, (cc["centroid"] as Vector2 - p2).normalized().y, 0.0) * rng.randf_range(0.2, 1.2) * fall
		ang *= 3.0 + 6.0 * fall
	else:
		vel = travel * rng.randf_range(0.05, 0.4)
		ang *= 0.8
	if area < 0.0006 or _sys.queued_shards() + _sys.live_shards() > int(c["max_shards"]) * 2:
		# too small (or over budget): glitter granules
		_sys.spawn_granules(global_transform * GlassFracture.surf(cc["centroid"], 0.0, curvature), vel, clampi(int(area / 0.0001), 1, 6), 0.02)
		return
	_sys.queue_shard({"poly": poly, "t": p.t_m(), "size": size, "k": curvature, "xform": global_transform,
		"velocity": vel, "angular": ang, "mass": area * p.areal_mass()})


func _rebuild_cells() -> void:
	var polys: Array = []
	var cnt := {}
	for cc in cells:
		if cc["gone"]:
			continue
		var q: PackedVector2Array = cc["poly"]
		polys.append(q)
		for e in q.size():
			var k := GlassFracture.edge_key(q[e], q[(e + 1) % q.size()])
			cnt[k] = int(cnt.get(k, 0)) + 1
	var skip := {}
	for k in cnt:
		if cnt[k] > 1:
			skip[k] = true
	if cell_instance == null:
		cell_instance = MeshInstance3D.new()
		cell_instance.set_meta("_glass_gen", true)
		cell_instance.name = "Cells"
		cell_instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		cell_instance.material_override = material
		add_child(cell_instance)
	var m := GlassFracture.slab_mesh(polys, get_profile().t_m(), size, curvature, Vector3.ZERO, skip,
		0.08 if curvature.length() > 1e-4 else 0.0)
	cell_instance.mesh = m
	mesh_instance.visible = false
	_set_intact_collider(false)
	if _cell_shape == null:
		_cell_shape = CollisionShape3D.new()
		_cell_shape.set_meta("_glass_gen", true)
		add_child(_cell_shape)
	_cell_shape.shape = m.create_trimesh_shape() if m else null
	if m == null:
		broken = true
		_cell_shape.set_deferred("disabled", true)


## LOW tier shatter: one static mesh of jagged teeth left in the frame (no shards, no collider).
func _rim_only(rng: RandomNumberGenerator) -> void:
	var h := half()
	var inset := GlassFracture.teeth_inset(h, rng)
	var polys: Array = []
	# clip coarse tiles (not the whole rect: rect minus inset would be a polygon with a hole)
	for cc in GlassFracture.dice_cells(h, 0.2, rng):
		for q in Geometry2D.clip_polygons(cc["poly"], inset):
			if absf(GlassFracture.area(q)) > 1e-6 and Geometry2D.is_polygon_clockwise(q) == Geometry2D.is_polygon_clockwise(cc["poly"]):
				polys.append(q)
	var m := GlassFracture.slab_mesh(polys, get_profile().t_m(), size, curvature, Vector3.ZERO, {},
		0.08 if curvature.length() > 1e-4 else 0.0)
	if m == null:
		return
	if cell_instance == null:
		cell_instance = MeshInstance3D.new()
		cell_instance.set_meta("_glass_gen", true)
		cell_instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		cell_instance.material_override = material
		add_child(cell_instance)
	cell_instance.mesh = m
	cell_instance.visible = true


func _vanish() -> void:
	broken = true
	mesh_instance.visible = false
	if cell_instance:
		cell_instance.visible = false
	_set_intact_collider(false)
	if _cell_shape:
		_cell_shape.set_deferred("disabled", true)


## Hit on a pane that is already in pieces: the piece that was hit (and its neighbours under the striker) drops.
func _hit_fractured(r: Dictionary, imp: GlassImpact, p2: Vector2, rng: RandomNumberGenerator, t: int) -> void:
	var rad := maxf(imp.radius * 1.15, 0.02) if not r["projectile"] else 0.0
	var any := false
	for i in cells.size():
		var cc: Dictionary = cells[i]
		if cc["gone"]:
			continue
		var hit: bool = Geometry2D.is_point_in_polygon(p2, cc["poly"]) or (rad > 0.0 and GlassFracture.poly_hits_circle(cc["poly"], p2, rad))
		if hit and (not r["projectile"] or float(cc["area"]) < 0.08 or rng.randf() < 0.5):
			_drop_cell(i, imp, p2, rng, t, true)
			any = true
	if r["projectile"]:
		_add_hole(p2, float(r["hole_radius"]), float(r["crater_entry"]), float(r["crater_exit"]), 0.0, 0, rng.randf() * 100.0)
	if any:
		_rebuild_cells()
		if not r["projectile"]:
			r["outcome"] = Outcome.PUNCHED
			r["kind"] = &"hole"
			GlassDamageModel._pass(r, imp, imp.velocity, float(r["v_n"]), imp.velocity - imp.dir() * float(r["v_n"]),
				imp.dir() * signf(imp.dir().dot(imp.dir())), float(r["thresholds"]["crack"]) * 0.3, 0.0, 0.95)


## Queue a crack stroke; strokes are painted in order under a per-frame time budget (no frame spikes).
func _crack(pts: PackedVector2Array, width: float, v0: float, v1: float) -> void:
	_paint_queue.append([pts, width, v0, v1])


func _paint_some(budget_ms: float) -> void:
	if mask == null:
		_paint_queue.clear()
		_paint_head = 0
		return
	var t0 := Time.get_ticks_usec()
	var n := _paint_queue.size()
	while _paint_head < n and (Time.get_ticks_usec() - t0) < budget_ms * 1000.0:
		var s: Array = _paint_queue[_paint_head]
		_paint_head += 1
		mask.polyline(s[0], s[1], s[2], s[3], _rng)
	if _paint_head >= n:
		_paint_queue.clear()
		_paint_head = 0
	mask.commit()


func _process(dt: float) -> void:
	if not _paint_queue.is_empty():
		_paint_some(paint_budget_ms)
	var dirty := false
	var i := _pending_falls.size() - 1
	var imp := GlassImpact.new()
	imp.velocity = Vector3.ZERO
	while i >= 0:
		var f: Dictionary = _pending_falls[i]
		f["t"] = float(f["t"]) - dt
		if float(f["t"]) <= 0.0:
			_drop_cell(int(f["i"]), imp, Vector2.ZERO, _rng, used_tier, false)
			_pending_falls.remove_at(i)
			dirty = true
		i -= 1
	if dirty:
		_rebuild_cells()
	if not _anim.is_empty():
		_anim["t"] = float(_anim["t"]) + dt
		var k := clampf(float(_anim["t"]) / float(_anim["dur"]), 0.0, 1.0)
		material.set_shader_parameter("craze_radius", lerpf(0.02, float(_anim["r"]), k))
		if float(_anim["t"]) >= float(_anim["fall"]):
			var cb: Callable = _anim["then"]
			_anim = {}
			cb.call()
	if _pending_falls.is_empty() and _anim.is_empty() and _paint_queue.is_empty():
		set_process(false)


# --------------------------------------------------- tempered: crazing, then the whole pane dices and drops

func _dice(r: Dictionary, imp: GlassImpact, p2: Vector2, rng: RandomNumberGenerator, t: int) -> void:
	var p := get_profile()
	var far := 0.0
	for c in GlassFracture.rect_poly(half()):
		far = maxf(far, c.distance_to(p2))
	material.set_shader_parameter("craze", 1.0)
	material.set_shader_parameter("craze_center", p2)
	material.set_shader_parameter("craze_cell", p.dice_size * 1.2)
	material.set_shader_parameter("craze_radius", far + 0.05)
	broken = true
	if imp.silent or _sys == null:
		_vanish()
		return
	var c: Dictionary = _sys.tier_cfg(t)
	var gxf := global_transform
	var travel := gxf.basis * (GlassFracture.surf_normal(p2, curvature) * -imp.side)
	var v_imp := imp.velocity.limit_length(8.0)        # a bullet does not carry the glass with it
	var finish := func():
		_vanish()
		if t == GlassSystem.Tier.MINIMAL:
			return
		if bool(c["particles"]):
			_sys.burst(gxf * GlassFracture.surf(Vector2.ZERO, 0.0, curvature), gxf.basis, size, travel, float(r["energy"]), 90)
			return
		# granules burst right at the impact, carried by the striker
		_sys.spawn_granules(gxf * GlassFracture.surf(p2, 0.0, curvature), v_imp * 0.25 + travel * 1.5, 120, 0.05)
		if bool(c["clumps"]):
			var cl := GlassFracture.dice_cells(half(), 0.11, rng)
			for cc in cl:
				var d := (cc["centroid"] as Vector2).distance_to(p2)
				var fall := 1.0 / (1.0 + d / 0.15)
				if d < 0.12 or rng.randf() < 0.3:
					# near the hit (and here and there) the mosaic is already loose: granules, not a clump
					_sys.spawn_granules(gxf * GlassFracture.surf(cc["centroid"], 0.0, curvature),
						travel * rng.randf_range(0.2, 0.8) + v_imp * 0.1 * fall, clampi(int(float(cc["area"]) / 0.0004), 4, 24), 0.03)
					continue
				_sys.queue_shard({"poly": cc["poly"], "t": p.t_m(), "size": size, "k": curvature, "xform": gxf,
					"velocity": travel * rng.randf_range(0.1, 0.6) + v_imp * 0.15 * fall, "angular": Vector3(rng.randfn(), rng.randfn(), rng.randfn()) * 1.5,
					"mass": float(cc["area"]) * p.areal_mass(), "crazed": true, "granulate_after": rng.randf_range(0.5, 1.4)})
		else:
			# MEDIUM: granules over the whole pane area
			var n := clampi(int(size.x * size.y / 0.0012), 60, int(c["granules"]))
			_sys.spawn_granules(gxf * GlassFracture.surf(Vector2.ZERO, 0.0, curvature), travel * 0.4, n, 0.02,
				Vector3(size.x * 0.5, size.y * 0.5, 0.0))
	if t >= GlassSystem.Tier.LOW:
		finish.call()
		return
	# crazing spreads over ~60 ms, the pane hangs crazed for a moment, then lets go
	_anim = {"t": 0.0, "dur": 0.06, "r": far + 0.05, "fall": 0.06 + rng.randf_range(0.04, 0.2), "then": finish}
	material.set_shader_parameter("craze_radius", 0.02)
	set_process(true)


# --------------------------------------------------- laminated / wired: holds together, punched flap

func _punch_soft(r: Dictionary, imp: GlassImpact, p2: Vector2, rng: RandomNumberGenerator, t: int, pat: Dictionary) -> void:
	var hr: float = r["hole_radius"]
	var cl := GlassFracture.cells_from_pattern(pat, half(), rng, 0.5)
	var hole_polys: Array = []
	for cc in cl:
		var cen: Vector2 = cc["centroid"]
		if cen.distance_to(p2) < hr * rng.randf_range(0.8, 1.15):
			hole_polys.append(cc["poly"])
	if mask:
		for q in hole_polys:
			mask.fill_poly(q, 1.0, 2)
		mask.disc(p2, hr * 1.5, 0.9 * get_profile().frost, 1, 0.5, rng)
	else:
		_add_hole(p2, hr, hr * 1.6, hr * 1.6, hr * 3.0, 16, rng.randf() * 100.0)
	if hole_polys.is_empty() or imp.silent or t >= GlassSystem.Tier.LOW:
		return
	# flap: the punched-out web hangs from the upper edge of the hole, bent in the direction of travel
	var m := GlassFracture.slab_mesh(hole_polys, get_profile().t_m(), size, curvature, Vector3.ZERO)
	if m == null:
		return
	if flap_instance == null:
		flap_instance = MeshInstance3D.new()
		flap_instance.set_meta("_glass_gen", true)
		flap_instance.name = "Flap"
		var fm := material.duplicate() as ShaderMaterial
		fm.set_shader_parameter("frost_cover", 0.55)
		fm.set_shader_parameter("craze", 1.0)
		fm.set_shader_parameter("craze_radius", 10.0)
		fm.set_shader_parameter("craze_cell", 0.02)
		fm.set_shader_parameter("use_mask", false)
		fm.set_shader_parameter("hole_count", 0)
		flap_instance.material_override = fm
		add_child(flap_instance)
	flap_instance.mesh = m
	var hinge := GlassFracture.surf(p2 + Vector2(0, hr * 0.9), 0.0, curvature)
	var ang := deg_to_rad(rng.randf_range(45.0, 80.0)) * imp.side
	var xf := Transform3D(Basis(Vector3.RIGHT, ang), Vector3.ZERO)
	flap_instance.transform = Transform3D(Basis.IDENTITY, hinge) * xf * Transform3D(Basis.IDENTITY, -hinge)
