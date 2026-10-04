class_name GlassSystem
extends Node3D
## Scene-wide manager for glass panes (no autoload needed: GlassSystem.get_for(node) finds or creates one).
##  - realism TIER (one setting) + automatic per-hit LOD by camera distance / frustum
##  - budgets: live shard bodies, mask texture memory, granules, particle bursts (scaled by tier)
##  - pools: shard RigidBody3Ds (built from a queue under a per-frame time budget), tempered granules (one MultiMesh),
##    pre-baked particle bursts (LOW)
##  - fire_bullet(): ray bullets through any number of panes (sorted along the ray, residual energy, deflection)
##  - track(body): cached path prediction for thrown bodies (GlassPathPredictor), pane impact BEFORE the engine contact
## Idle cost: _process/_physics_process are switched off when nothing is live.

signal pane_damaged(pane: Node3D, point: Vector3, outcome: int, energy: float)
signal pane_broke(pane: Node3D, position: Vector3, energy: float, kind: StringName)
signal pane_pierced(pane: Node3D, point: Vector3, residual_velocity: Vector3)
signal shard_settled(position: Vector3, energy: float)
signal granules_landed(position: Vector3, count: int)

enum Tier { HIGH, MEDIUM, LOW, MINIMAL }
const TIER_NAMES := ["high", "medium", "low", "minimal"]

## Per-tier settings. mask_px: crack mask texels per metre (0 = no mask, analytic star only).
const TIERS := {
	Tier.HIGH: {"mask_px": 384.0, "mask_budget_mb": 32.0, "mask_mips": true, "max_shards": 120, "shards_per_break": 70,
		"granules": 1600, "clumps": true, "geometry": true, "radial_scale": 1.0, "particles": false, "refraction": true},
	Tier.MEDIUM: {"mask_px": 192.0, "mask_budget_mb": 10.0, "mask_mips": true, "max_shards": 40, "shards_per_break": 18,
		"granules": 500, "clumps": false, "geometry": true, "radial_scale": 0.6, "particles": false, "refraction": false},
	Tier.LOW: {"mask_px": 0.0, "mask_budget_mb": 0.0, "mask_mips": false, "max_shards": 0, "shards_per_break": 0,
		"granules": 0, "clumps": false, "geometry": false, "radial_scale": 0.5, "particles": true, "refraction": false},
	Tier.MINIMAL: {"mask_px": 0.0, "mask_budget_mb": 0.0, "mask_mips": false, "max_shards": 0, "shards_per_break": 0,
		"granules": 0, "clumps": false, "geometry": false, "radial_scale": 0.5, "particles": false, "refraction": false},
}

@export var tier: Tier = Tier.HIGH:
	set(v):
		tier = v
		_apply_tier()
@export var use_refraction := false                ## HIGH only: screen-texture refraction variant (costs a screen copy)
@export_group("Auto LOD (evaluated at hit time, zero idle cost)")
@export var auto_lod := true
@export var lod_medium_distance := 6.0
@export var lod_low_distance := 15.0
@export var lod_minimal_distance := 40.0
@export var offscreen_tier: Tier = Tier.LOW
@export_group("Shards")
@export var shard_lifetime := 10.0
@export var shard_fade := 0.8
@export var rest_freeze_time := 1.5
@export var build_budget_ms := 1.5                  ## shard mesh building per physics frame (spike control)
@export_flags_3d_physics var shard_layer := 1 << 19 ## keep out of the player's mask
@export_flags_3d_physics var shard_mask := 1
@export_group("Granules / prediction")
@export var granule_life := 45.0
@export_flags_3d_physics var floor_mask := 1
@export_flags_3d_physics var pane_layer := 1 << 20 ## extra layer every pane is on (prediction + bullets query it)
@export var predict_min_speed := 2.0

var cfg: Dictionary = TIERS[Tier.HIGH]
var shader: Shader
var shader_refract: Shader
var shard_material: ShaderMaterial
var crazed_material: ShaderMaterial
var granule_material: StandardMaterial3D
var time := 0.0
var stats := {"shards_spawned": 0, "shards_recycled": 0, "granules": 0, "bursts": 0, "predict_recomputes": 0,
	"predicted_hits": 0, "build_ms_max": 0.0}

var _shards: Array[Dictionary] = []                  # live
var _shard_free: Array[Dictionary] = []
var _queue: Array[Dictionary] = []                   # pending shard builds
var _mm: MultiMesh
var _gp := PackedVector3Array()
var _gv := PackedVector3Array()
var _gfloor := PackedFloat32Array()
var _gage := PackedFloat32Array()
var _gstate := PackedByteArray()                     # 0 free, 1 flying, 2 landed
var _gnext := 0
var _gmoving := 0
var _bursts: Array[CPUParticles3D] = []
var _burst_i := 0
var _tracked := {}                                    # instance id -> GlassPathPredictor
var _mask_bytes := 0
var _rng := RandomNumberGenerator.new()
var _xbuf := PackedFloat32Array()


static func get_for(node: Node) -> GlassSystem:
	var tree := node.get_tree()
	var s := tree.get_first_node_in_group("glass_system") as GlassSystem
	if s:
		return s
	s = GlassSystem.new()
	s.name = "GlassSystem"
	tree.root.add_child(s)
	return s


func _enter_tree() -> void:
	add_to_group("glass_system")


func _ready() -> void:
	_rng.seed = 12345
	shader = load(_dir() + "glass_pane.gdshader")
	shader_refract = Shader.new()
	shader_refract.code = shader.code.replace("shader_type spatial;", "shader_type spatial;\n#define USE_SCREEN_REFRACTION")
	shard_material = ShaderMaterial.new()
	shard_material.shader = shader
	crazed_material = ShaderMaterial.new()
	crazed_material.shader = shader
	crazed_material.set_shader_parameter("craze", 1.0)
	crazed_material.set_shader_parameter("craze_cell", 0.01)
	granule_material = StandardMaterial3D.new()
	granule_material.albedo_color = Color(0.75, 0.88, 0.85, 0.55)
	granule_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	granule_material.roughness = 0.15
	granule_material.metallic_specular = 0.9
	var box := BoxMesh.new()
	box.size = Vector3(1, 0.7, 1)
	box.material = granule_material
	_mm = MultiMesh.new()
	_mm.transform_format = MultiMesh.TRANSFORM_3D
	_mm.mesh = box
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = _mm
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mmi.extra_cull_margin = 16384.0
	add_child(mmi)
	_apply_tier()
	set_process(false)
	set_physics_process(false)


func _dir() -> String:
	return (get_script() as Script).resource_path.get_base_dir() + "/"


func _apply_tier() -> void:
	cfg = TIERS[tier]
	if _mm == null:
		return
	var n: int = maxi(int(cfg["granules"]), 1)
	_mm.instance_count = n
	_gp.resize(n)
	_gv.resize(n)
	_gfloor.resize(n)
	_gage.resize(n)
	_gstate.resize(n)
	_gstate.fill(0)
	_xbuf.resize(n * 12)
	_xbuf.fill(0.0)
	_mm.buffer = _xbuf
	_gmoving = 0
	_gnext = 0
	while _shards.size() > int(cfg["max_shards"]):
		_release(_shards[0])


func tier_cfg(t: int) -> Dictionary:
	return TIERS[t]


func pane_shader(t: int) -> Shader:
	return shader_refract if (t == Tier.HIGH and use_refraction) else shader


## Tier used for a hit at `pos`: the global tier, made cheaper by distance / off-screen when auto_lod.
func effective_tier(pos: Vector3, pane_tier := -1) -> int:
	var t: int = tier if pane_tier < 0 else maxi(pane_tier, tier)
	if not auto_lod:
		return t
	var cam := get_viewport().get_camera_3d() if is_inside_tree() else null
	if cam == null:
		return t
	var d := cam.global_position.distance_to(pos)
	var lod := Tier.HIGH
	if d > lod_minimal_distance:
		lod = Tier.MINIMAL
	elif d > lod_low_distance:
		lod = Tier.LOW
	elif d > lod_medium_distance:
		lod = Tier.MEDIUM
	if not cam.is_position_in_frustum(pos):
		lod = maxi(lod, offscreen_tier)
	return maxi(t, lod)


## Mask texture budget: returns texels/m for a new mask (halved while over budget, 0 = none).
func request_mask(size: Vector2, t: int) -> float:
	var c: Dictionary = TIERS[t]
	var px: float = c["mask_px"]
	if px <= 0.0:
		return 0.0
	var budget := float(c["mask_budget_mb"]) * 1048576.0
	while px >= 48.0 and _mask_bytes + size.x * size.y * px * px * 5.4 > budget:
		px *= 0.5
	return px if px >= 48.0 else 0.0


func mask_allocated(bytes: int) -> void:
	_mask_bytes += bytes


func mask_released(bytes: int) -> void:
	_mask_bytes = maxi(0, _mask_bytes - bytes)


func mask_megabytes() -> float:
	return _mask_bytes / 1048576.0


# ------------------------------------------------------------------ shards

## Queue a shard (built later within build_budget_ms per frame). def: {poly, t, size, k, xform (pane global),
## velocity, angular, mass, material, crazed, granulate_after}
func queue_shard(def: Dictionary) -> void:
	if int(cfg["max_shards"]) <= 0:
		return
	_queue.append(def)
	set_physics_process(true)


func live_shards() -> int:
	return _shards.size()


func queued_shards() -> int:
	return _queue.size()


func _build_from_queue() -> void:
	var t0 := Time.get_ticks_usec()
	while not _queue.is_empty():
		var d: Dictionary = _queue.pop_front()
		_spawn_shard(d)
		var ms := (Time.get_ticks_usec() - t0) / 1000.0
		if ms > build_budget_ms:
			stats["build_ms_max"] = maxf(stats["build_ms_max"], ms)
			return
	stats["build_ms_max"] = maxf(stats["build_ms_max"], (Time.get_ticks_usec() - t0) / 1000.0)


func _spawn_shard(d: Dictionary) -> void:
	var poly: PackedVector2Array = d["poly"]
	var k: Vector2 = d["k"]
	var c := GlassFracture.centroid(poly)
	var origin := GlassFracture.surf(c, 0.0, k)
	var mesh := GlassFracture.slab_mesh([poly], d["t"], d["size"], k, origin)
	if mesh == null:
		return
	var s: Dictionary
	if not _shard_free.is_empty():
		s = _shard_free.pop_back()
	elif _shards.size() >= int(cfg["max_shards"]):
		s = _shards[0]
		_release(s)
		_shard_free.pop_back()
		stats["shards_recycled"] += 1
	else:
		var b := RigidBody3D.new()
		var mi := MeshInstance3D.new()
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var cs := CollisionShape3D.new()
		b.add_child(mi)
		b.add_child(cs)
		b.continuous_cd = false
		var pm := PhysicsMaterial.new()
		pm.bounce = 0.15
		pm.friction = 0.7
		b.physics_material_override = pm
		s = {"body": b, "mi": mi, "cs": cs}
	var body: RigidBody3D = s["body"]
	var shape := ConvexPolygonShape3D.new()
	shape.points = GlassFracture.slab_points(poly, d["t"], k, origin)
	(s["cs"] as CollisionShape3D).shape = shape
	(s["mi"] as MeshInstance3D).mesh = mesh
	(s["mi"] as MeshInstance3D).material_override = crazed_material if d.get("crazed", false) else (d.get("material") if d.get("material") else shard_material)
	(s["mi"] as MeshInstance3D).scale = Vector3.ONE
	body.collision_layer = shard_layer
	body.collision_mask = shard_mask
	body.mass = maxf(float(d["mass"]), 0.005)
	if body.get_parent() == null:
		add_child(body)
	var xf: Transform3D = d["xform"]
	body.global_transform = Transform3D(xf.basis.orthonormalized(), xf * origin)
	body.freeze = false
	body.sleeping = false
	body.visible = true
	body.process_mode = Node.PROCESS_MODE_INHERIT
	body.linear_velocity = d.get("velocity", Vector3.ZERO)
	body.angular_velocity = d.get("angular", Vector3.ZERO)
	s["age"] = 0.0
	s["rest"] = 0.0
	s["vprev"] = body.linear_velocity
	s["settles"] = 0
	s["granulate"] = float(d.get("granulate_after", -1.0))
	s["area"] = absf(GlassFracture.area(poly))
	_shards.append(s)
	stats["shards_spawned"] += 1


func _release(s: Dictionary) -> void:
	_shards.erase(s)
	var b: RigidBody3D = s["body"]
	b.freeze = true
	b.visible = false
	b.collision_layer = 0
	b.collision_mask = 0
	b.process_mode = Node.PROCESS_MODE_DISABLED
	_shard_free.append(s)


func clear_all() -> void:
	_queue.clear()
	while not _shards.is_empty():
		_release(_shards[0])
	_gstate.fill(0)
	_xbuf.fill(0.0)
	_mm.buffer = _xbuf
	_gmoving = 0


func _physics_process(dt: float) -> void:
	time += dt
	if not _queue.is_empty():
		_build_from_queue()
	_step_predictions(dt)
	var i := _shards.size() - 1
	while i >= 0:
		var s: Dictionary = _shards[i]
		var b: RigidBody3D = s["body"]
		s["age"] = float(s["age"]) + dt
		var age: float = s["age"]
		if float(s["granulate"]) > 0.0 and age > float(s["granulate"]):
			# tempered clump hits the floor / times out: falls apart into granules
			spawn_granules(b.global_position, b.linear_velocity * 0.4, int(clampf(float(s["area"]) / 0.00012, 4.0, 60.0)), 0.06)
			_release(s)
			i -= 1
			continue
		if not b.freeze:
			var v := b.linear_velocity
			var dv := (v - (s["vprev"] as Vector3)).length()
			if dv > 1.2 and int(s["settles"]) < 2 and age > 0.05:
				s["settles"] = int(s["settles"]) + 1
				shard_settled.emit(b.global_position, clampf(dv / 6.0, 0.1, 1.0))
				if float(s["granulate"]) > 0.0:
					s["granulate"] = minf(float(s["granulate"]), age + 0.02)
			s["vprev"] = v
			if v.length() < 0.08 and b.angular_velocity.length() < 0.3:
				s["rest"] = float(s["rest"]) + dt
				if float(s["rest"]) > rest_freeze_time:
					b.freeze = true
			else:
				s["rest"] = 0.0
		if age > shard_lifetime:
			var f := 1.0 - (age - shard_lifetime) / shard_fade
			if f <= 0.0:
				_release(s)
			else:
				(s["mi"] as MeshInstance3D).scale = Vector3.ONE * f
		i -= 1
	if _queue.is_empty() and _shards.is_empty() and _tracked.is_empty():
		set_physics_process(false)


# ------------------------------------------------------------------ granules (tempered dice)

func spawn_granules(center: Vector3, vel: Vector3, count: int, spread: float, extent := Vector3.ZERO) -> void:
	var cap := _gstate.size()
	if int(cfg["granules"]) <= 0 or count <= 0:
		return
	var floor_y := _floor_below(center)
	for i in mini(count, cap):
		var j := _gnext
		_gnext = (_gnext + 1) % cap
		if _gstate[j] == 1:
			_gmoving -= 1
		var off := Vector3(_rng.randf_range(-1, 1) * extent.x, _rng.randf_range(-1, 1) * extent.y, _rng.randf_range(-1, 1) * extent.z)
		_gp[j] = center + off + Vector3(_rng.randfn(), _rng.randfn(), _rng.randfn()) * spread * 0.3
		_gv[j] = vel + Vector3(_rng.randfn(), _rng.randfn() * 0.5, _rng.randfn()) * (0.6 + vel.length() * 0.15)
		_gfloor[j] = floor_y + _rng.randf_range(0.0, 0.012)
		_gage[j] = 0.0
		_gstate[j] = 1
		_gmoving += 1
	stats["granules"] += count
	set_process(true)


func _floor_below(p: Vector3) -> float:
	if not is_inside_tree():
		return p.y - 1.0
	var q := PhysicsRayQueryParameters3D.create(p + Vector3.UP * 0.05, p + Vector3.DOWN * 30.0, floor_mask)
	var ex: Array[RID] = []
	var space := get_world_3d().direct_space_state
	for i in 4:
		var h := space.intersect_ray(q)
		if h.is_empty():
			break
		# skip glass (the breaking pane's collider is only switched off at the next physics step)
		if _pane_of(h["collider"]) != null:
			ex.append(h["rid"])
			q.exclude = ex
			continue
		return (h["position"] as Vector3).y
	return p.y - 30.0


func _process(dt: float) -> void:
	var cap := _gstate.size()
	var landed_at := Vector3.ZERO
	var landed := 0
	var any := false
	for j in cap:
		var st := _gstate[j]
		if st == 0:
			continue
		any = true
		_gage[j] += dt
		var s := 0.009
		if st == 1:
			var v := _gv[j] + Vector3(0, -9.81, 0) * dt
			var p := _gp[j] + v * dt
			if p.y <= _gfloor[j]:
				p.y = _gfloor[j]
				if absf(v.y) > 1.2:
					v = Vector3(v.x * 0.35, -v.y * 0.18, v.z * 0.35)
				else:
					_gstate[j] = 2
					_gmoving -= 1
					landed += 1
					landed_at = p
			_gp[j] = p
			_gv[j] = v
		if _gage[j] > granule_life:
			s *= maxf(0.0, 1.0 - (_gage[j] - granule_life) / 2.0)
			if s <= 0.0:
				if _gstate[j] == 1:
					_gmoving -= 1
				_gstate[j] = 0
		var p2 := _gp[j]
		var k := j * 12
		var r := float(j % 7) * 0.9
		var cr := cos(r) * s
		var sr := sin(r) * s
		_xbuf[k] = cr; _xbuf[k + 1] = 0.0; _xbuf[k + 2] = sr; _xbuf[k + 3] = p2.x
		_xbuf[k + 4] = 0.0; _xbuf[k + 5] = s; _xbuf[k + 6] = 0.0; _xbuf[k + 7] = p2.y + s * 0.35
		_xbuf[k + 8] = -sr; _xbuf[k + 9] = 0.0; _xbuf[k + 10] = cr; _xbuf[k + 11] = p2.z
		if _gstate[j] == 0:
			for q in 12:
				_xbuf[k + q] = 0.0
	_mm.buffer = _xbuf
	if landed > 0:
		granules_landed.emit(landed_at, landed)
	if not any or (_gmoving <= 0 and _all_landed_static()):
		set_process(false)


var _static_check := 0.0
func _all_landed_static() -> bool:
	# landed granules only need updates when they start fading
	for j in _gstate.size():
		if _gstate[j] == 2 and _gage[j] > granule_life - 0.1:
			return false
	_wake_for_fade()
	return true


func _wake_for_fade() -> void:
	if not is_inside_tree():
		return
	var tmr := get_tree().create_timer(granule_life * 0.5, false)
	tmr.timeout.connect(func(): set_process(true))


# ------------------------------------------------------------------ particle burst (LOW tier)

func burst(center: Vector3, basis: Basis, size: Vector2, dir: Vector3, energy: float, amount := 48) -> void:
	if not bool(cfg["particles"]):
		return
	if _bursts.size() < 4:
		var p := CPUParticles3D.new()
		p.one_shot = true
		p.emitting = false
		p.explosiveness = 0.95
		p.lifetime = 1.6
		var bm := BoxMesh.new()
		bm.size = Vector3(0.03, 0.004, 0.022)
		bm.material = granule_material
		p.mesh = bm
		p.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
		p.gravity = Vector3(0, -9.81, 0)
		p.spread = 35.0
		p.angular_velocity_min = -720.0
		p.angular_velocity_max = 720.0
		p.particle_flag_rotate_y = true
		p.scale_amount_min = 0.4
		p.scale_amount_max = 1.6
		p.local_coords = false
		add_child(p)
		_bursts.append(p)
	var e := _bursts[_burst_i]
	_burst_i = (_burst_i + 1) % 4
	e.global_transform = Transform3D(basis.orthonormalized(), center)
	e.emission_box_extents = Vector3(size.x * 0.5, size.y * 0.5, 0.002)
	e.amount = amount
	e.direction = basis.orthonormalized().inverse() * dir.normalized() if dir.length() > 0.01 else Vector3.DOWN
	e.initial_velocity_min = 0.3
	e.initial_velocity_max = clampf(1.0 + sqrt(energy) * 0.3, 1.0, 6.0)
	e.restart()
	stats["bursts"] += 1


# ------------------------------------------------------------------ bullets

## Ray bullet through panes. speed <= 0: hitscan (straight ray of max_range); else ballistic segments of step_dt with
## gravity drop. Every GlassPane on the way is hit in distance order and the bullet continues with the residual
## velocity / deflected direction. A non-glass collider stops it. Returns
## {hits: [{pane, point, result}], stop: {collider, point, normal} or {}, energy (left), velocity (left)}.
func fire_bullet(from: Vector3, direction: Vector3, energy_joules: float, caliber := 0.009, mask := 0xFFFFFFFF,
		speed := -1.0, max_range := 150.0, exclude: Array = [], params := {}) -> Dictionary:
	var imp := GlassImpact.bullet(caliber, energy_joules, speed if speed > 0.0 else -1.0, params.get("bullet", "fmj"))
	var m := imp.mass
	var v := direction.normalized() * imp.speed()
	var pos := from
	var ex := exclude.duplicate()
	var hits: Array = []
	var stop := {}
	var travelled := 0.0
	var step_dt := 1.0 / 240.0
	var space := get_world_3d().direct_space_state
	var guard := 0
	while travelled < max_range and v.length() > 5.0 and guard < 2000:
		guard += 1
		var seg := v * step_dt + 0.5 * Vector3(0, -9.81, 0) * step_dt * step_dt if speed > 0.0 else v.normalized() * (max_range - travelled)
		var q := PhysicsRayQueryParameters3D.create(pos, pos + seg, mask, ex)
		q.hit_back_faces = true
		var h := space.intersect_ray(q)
		if h.is_empty():
			travelled += seg.length()
			pos += seg
			if speed > 0.0:
				v += Vector3(0, -9.81, 0) * step_dt
			continue
		var pane := _pane_of(h["collider"])
		if pane == null:
			stop = {"collider": h["collider"], "point": h["position"], "normal": h["normal"]}
			break
		var e := 0.5 * m * v.length_squared()
		var res: Dictionary = pane.hit_by_projectile(h["position"], v.normalized(), e, caliber,
			{"speed": v.length(), "bullet": params.get("bullet", "fmj")})
		hits.append({"pane": pane, "point": h["position"], "result": res})
		travelled += pos.distance_to(h["position"])
		ex.append(h["rid"])
		if res.get("pass_through", false):
			v = res["residual_velocity"]
			pos = h["position"] + v.normalized() * 0.001
		elif res.get("ricochet", false):
			v = res["residual_velocity"]
			pos = h["position"] + v.normalized() * 0.001
		else:
			v = Vector3.ZERO
			break
	return {"hits": hits, "stop": stop, "energy": 0.5 * m * v.length_squared(), "velocity": v}


static func _pane_of(o: Object) -> GlassPane:
	var n := o as Node
	while n != null:
		if n is GlassPane:
			return n
		n = n.get_parent()
	return null


# ------------------------------------------------------------------ thrown bodies (predicted crossing)

## Start predicting a thrown body (call on VR release / spawn). Bodies near panes are also added automatically by the
## pane sensors. The predictor stays registered until untrack() or the body stops / is freed.
func track(body: RigidBody3D) -> GlassPathPredictor:
	var id := body.get_instance_id()
	if _tracked.has(id):
		(_tracked[id] as GlassPathPredictor).invalidate()
		return _tracked[id]
	var p := GlassPathPredictor.new(body, pane_layer)
	p.min_speed = predict_min_speed
	_tracked[id] = p
	body.continuous_cd = true    # engine fallback
	set_physics_process(true)
	return p


func untrack(body: Object) -> void:
	if body:
		_tracked.erase(body.get_instance_id())


func predictor_for(body: Object) -> GlassPathPredictor:
	return _tracked.get(body.get_instance_id())


## Panes moved / removed: every cached path is re-swept on the next step.
func invalidate_all() -> void:
	for p in _tracked.values():
		(p as GlassPathPredictor).invalidate()


func _step_predictions(dt: float) -> void:
	if _tracked.is_empty():
		return
	for id in _tracked.keys():
		var pr: GlassPathPredictor = _tracked[id]
		if not is_instance_valid(pr.body):
			_tracked.erase(id)
			continue
		var before := pr.recomputes
		var c := pr.step(time, dt)
		stats["predict_recomputes"] += pr.recomputes - before
		if c.is_empty():
			continue
		var pane := _pane_of(c["collider"])
		if pane == null:
			continue
		stats["predicted_hits"] += 1
		pane.impact_from_body(pr.body, c["point"], c["v_impact"], c["normal"])
