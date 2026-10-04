class_name BottleBreakManager
extends Node
## Scene-wide pools for broken-bottle debris: physics shards (capped, recycled, frozen at rest, faded),
## liquid droplets (one MultiMesh, ballistic, ray-tested) and puddles (HIGH: decals; lower tiers: quads clipped to the surface edge; they grow, then evaporate).
## Created on demand by BottleBreakManager.get_for(node), or drop one in your scene to change the settings.

signal shard_spawned(body: RigidBody3D)

## ONE setting: BottleBreakManager.set_quality(tier), switchable at runtime (BottleBreakManager.default_quality for new managers).
##  HIGH    full real shard set, 192 droplets, 24 growing puddles, fatigue (crack accumulation)
##  MEDIUM  half the shards (largest kept), 96 droplets, 12 puddles
##  LOW     ~5 big pieces, shard physics stops 1 s after the break (frozen), 32 droplets, 6 static puddles, no fatigue
##  MINIMAL no physics shards: bottle just vanishes (or neck pops) + a small droplet burst + 1 puddle, no fatigue
## Breaks that are far away (> far_distance) or outside the camera frustum always take the MINIMAL path.
enum Quality { HIGH, MEDIUM, LOW, MINIMAL }
const TIERS := [
	{"name": "HIGH", "shards": 150, "droplets": 192, "puddles": 24, "shard_frac": 1.0, "splash": 1.0, "phys_time": 0.0, "anim": true, "fatigue": true, "decal": true},
	{"name": "MEDIUM", "shards": 80, "droplets": 96, "puddles": 12, "shard_frac": 0.5, "splash": 0.5, "phys_time": 0.0, "anim": true, "fatigue": true},
	{"name": "LOW", "shards": 24, "droplets": 32, "puddles": 6, "shard_frac": 0.2, "splash": 0.25, "phys_time": 1.0, "anim": false, "fatigue": false},
	{"name": "MINIMAL", "shards": 0, "droplets": 12, "puddles": 2, "shard_frac": 0.0, "splash": 0.1, "phys_time": 0.0, "anim": false, "fatigue": false},
]
const DROPLET_POOL := 192
static var default_quality := Quality.HIGH
static var current: BottleBreakManager
@export var far_distance := 25.0
var quality := Quality.HIGH
var shard_fraction := 1.0
var splash_scale := 1.0
var shard_physics_time := 0.0
var animate_puddles := true
var fatigue_enabled := true
var _dcap := DROPLET_POOL

@export_group("Shards")
@export var max_shards := 150                    ## live shard bodies; the oldest is recycled when exceeded
@export var shard_lifetime := 25.0               ## s until a shard starts to shrink away
@export var shard_fade_time := 1.5
@export var rest_freeze_time := 3.0              ## s of rest before the shard is frozen (no physics cost)
@export_flags_3d_physics var shard_layer := 1 << 19   ## "Shards" - keep out of the player's mask so they never block it
@export_flags_3d_physics var shard_mask := 1          ## world only (shards do not collide with each other / bottles)
@export var shard_bounce := 0.2
@export var shard_friction := 0.6
@export_group("Liquid")
@export var max_droplets := 192
@export var max_puddles := 24
@export_flags_3d_physics var droplet_mask := 1        ## what droplets land on
@export var puddle_thickness := 0.0015           ## m, sets the puddle radius from the spilled volume
@export var puddle_life := 60.0                  ## s before a puddle starts to evaporate
@export var puddle_evaporate_time := 40.0
## HIGH tier decal puddles paint only on these render layers. Default: every layer except 20, so put
## bottles / held props on render layer 20 to keep puddles off them.
@export_flags_3d_render var puddle_decal_cull_mask := 0xFFFFF & ~(1 << 19)
@export var puddle_decal_depth := 0.08           ## m, projection box height (half above, half below the surface)
@export var gravity := 9.81

var _all: Array[Dictionary] = []
var _active: Array[Dictionary] = []
var _free: Array[Dictionary] = []
var _dmm: MultiMesh
var _dpos := PackedVector3Array()
var _dvel := PackedVector3Array()
var _dvol := PackedFloat32Array()
var _dsize := PackedFloat32Array()
var _dalive := PackedByteArray()
var _dnext := 0
var _puddles: Array[Dictionary] = []
var _puddle_shader: Shader
var _puddle_tex: ImageTexture        ## HIGH decal mask, built once on first use
var _puddle_orm: ImageTexture
var puddle_decals := false           ## set by the tier (HIGH); used only when the renderer supports decals
var puddle_rays := 0                 ## stat: physics rays cast for puddle placement/clipping (never per frame)
var _rng := RandomNumberGenerator.new()
var live_shards: int:
	get: return _active.size()
var live_droplets := 0


static func get_for(node: Node) -> BottleBreakManager:
	var tree := node.get_tree()
	var m := tree.get_first_node_in_group("bottle_break_manager") as BottleBreakManager
	if m:
		return m
	m = BottleBreakManager.new()
	m.name = "BottleBreakManager"
	tree.root.add_child(m)
	return m


func set_quality(q: int) -> void:
	quality = q
	var t: Dictionary = TIERS[q]
	max_shards = t["shards"]
	max_droplets = t["droplets"]
	_dcap = mini(max_droplets, DROPLET_POOL)
	max_puddles = t["puddles"]
	shard_fraction = t["shard_frac"]
	splash_scale = t["splash"]
	shard_physics_time = t["phys_time"]
	animate_puddles = t["anim"]
	fatigue_enabled = t["fatigue"]
	while _active.size() > max_shards:
		_retire(_active.pop_front())
	puddle_decals = t.get("decal", false)
	while _puddles.size() > max_puddles:
		(_puddles[0]["node"] as Node).queue_free()
		_puddles.remove_at(0)
	for i in DROPLET_POOL:
		if i >= _dcap and _dalive.size() > i and _dalive[i] == 1:
			_kill_droplet(i)


## Tier for a break at world position p: MINIMAL when far from the camera or outside its frustum.
func quality_at(p: Vector3) -> int:
	var cam := get_viewport().get_camera_3d()
	if cam == null or quality == Quality.MINIMAL:
		return quality
	if cam.global_position.distance_to(p) > far_distance or not cam.is_position_in_frustum(p):
		return Quality.MINIMAL
	return quality


## Keep the biggest pieces (at least 3), mass fractions renormalised.
func reduce_defs(defs: Array, frac := -1.0) -> Array:
	var f := shard_fraction if frac < 0.0 else frac
	if f >= 0.99 or defs.is_empty():
		return defs
	var d := defs.duplicate()
	d.sort_custom(func(a, b): return float(a["mass_fraction"]) > float(b["mass_fraction"]))
	d.resize(mini(d.size(), maxi(3, int(ceil(defs.size() * f)))))
	var tot := 0.0
	for x in d:
		tot += float(x["mass_fraction"])
	var out := []
	for x in d:
		var c: Dictionary = (x as Dictionary).duplicate()
		c["mass_fraction"] = float(x["mass_fraction"]) / maxf(tot, 1e-6)
		out.append(c)
	return out


func _ready() -> void:
	current = self
	add_to_group("bottle_break_manager")
	_rng.randomize()
	# droplets: a single MultiMesh with per-instance colour
	var sm := SphereMesh.new()
	sm.radius = 1.0
	sm.height = 2.0
	sm.radial_segments = 6
	sm.rings = 4
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.roughness = 0.05
	mat.metallic_specular = 0.9
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	sm.material = mat
	_dmm = MultiMesh.new()
	_dmm.transform_format = MultiMesh.TRANSFORM_3D
	_dmm.use_colors = true
	_dmm.mesh = sm
	_dmm.instance_count = DROPLET_POOL
	_dpos.resize(DROPLET_POOL)
	_dvel.resize(DROPLET_POOL)
	_dvol.resize(DROPLET_POOL)
	_dsize.resize(DROPLET_POOL)
	_dalive.resize(DROPLET_POOL)
	for i in DROPLET_POOL:
		_dmm.set_instance_transform(i, Transform3D(Basis.IDENTITY.scaled(Vector3.ZERO), Vector3.ZERO))
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = _dmm
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mmi.extra_cull_margin = 16384.0
	add_child(mmi)
	_puddle_shader = Shader.new()
	_puddle_shader.code = PUDDLE_SHADER
	set_quality(default_quality)
	set_physics_process(false)   # zero cost until a shard / droplet / puddle exists


const PUDDLE_SHADER := """
shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_disabled, shadows_disabled;
// The mesh is the puddle's square (half size = checked radius, metres) already clipped to the surface
// it lies on; the wobbly disc grows inside it through `radius`.
uniform vec4 col : source_color = vec4(0.5, 0.3, 0.1, 0.8);
uniform float fade = 1.0;
uniform float seed = 0.0;
uniform float radius = 0.01;
varying vec2 lp;
void vertex() {
	lp = VERTEX.xz;
}
void fragment() {
	vec2 p = lp / max(radius, 1e-4);
	float a = atan(p.y, p.x);
	float e = 1.0 + 0.09 * sin(a * 5.0 + seed) + 0.06 * sin(a * 9.0 + seed * 2.3) + 0.04 * sin(a * 14.0 + seed * 4.1);
	float d = length(p) / e;
	float m = smoothstep(1.0, 0.86, d);
	ALBEDO = col.rgb * 0.55;
	ALPHA = m * col.a * fade;
	ROUGHNESS = 0.04;
	SPECULAR = 0.9;
}
"""


# ------------------------------------------------------------------ shards

func spawn_shard(mesh: Mesh, shape: Shape3D, xf: Transform3D, mass: float, lin_vel: Vector3, ang_vel: Vector3,
		material: Material = null) -> RigidBody3D:
	if max_shards <= 0:
		return null
	var s: Dictionary
	if _active.size() >= max_shards:
		s = _active.pop_front()   # tier cap reached: recycle the oldest
	elif not _free.is_empty():
		s = _free.pop_back()
	else:
		s = _make_shard()
	var b: RigidBody3D = s["body"]
	var mi: MeshInstance3D = s["mi"]
	var cs: CollisionShape3D = s["cs"]
	b.freeze = true
	b.collision_layer = shard_layer
	b.collision_mask = shard_mask
	b.visible = true
	b.global_transform = xf
	b.mass = maxf(mass, 0.002)
	cs.shape = shape
	cs.disabled = false
	mi.mesh = mesh
	mi.material_override = material
	mi.scale = Vector3.ONE
	b.freeze = false
	b.sleeping = false
	b.linear_velocity = lin_vel
	b.angular_velocity = ang_vel
	s["age"] = 0.0
	s["rest"] = 0.0
	_active.append(s)
	set_physics_process(true)
	shard_spawned.emit(b)
	return b


func _make_shard() -> Dictionary:
	var b := RigidBody3D.new()
	b.can_sleep = true
	b.linear_damp = 0.05
	b.angular_damp = 0.3
	var pm := PhysicsMaterial.new()
	pm.bounce = shard_bounce
	pm.friction = shard_friction
	b.physics_material_override = pm
	var mi := MeshInstance3D.new()
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var cs := CollisionShape3D.new()
	b.add_child(mi)
	b.add_child(cs)
	add_child(b)
	var s := {"body": b, "mi": mi, "cs": cs, "age": 0.0, "rest": 0.0}
	_all.append(s)
	return s


func _retire(s: Dictionary) -> void:
	var b: RigidBody3D = s["body"]
	b.freeze = true
	b.collision_layer = 0
	b.collision_mask = 0
	b.visible = false
	(s["cs"] as CollisionShape3D).disabled = true
	_free.append(s)


func clear_debris() -> void:
	for s in _active:
		_retire(s)
	_active.clear()
	for i in DROPLET_POOL:
		_dalive[i] = 0
		_dmm.set_instance_transform(i, Transform3D(Basis.IDENTITY.scaled(Vector3.ZERO), Vector3.ZERO))
	for p in _puddles:
		(p["node"] as Node).queue_free()
	_puddles.clear()
	live_droplets = 0


func _physics_process(dt: float) -> void:
	var i := 0
	while i < _active.size():
		var s := _active[i]
		var b: RigidBody3D = s["body"]
		s["age"] += dt
		if not b.freeze:
			if shard_physics_time > 0.0 and s["age"] > shard_physics_time:
				b.freeze_mode = RigidBody3D.FREEZE_MODE_STATIC   # LOW tier: no per-shard physics after the first second
				b.freeze = true
			elif b.linear_velocity.length_squared() < 0.0036 and b.angular_velocity.length_squared() < 0.09:
				s["rest"] += dt
				if s["rest"] > rest_freeze_time:
					b.freeze_mode = RigidBody3D.FREEZE_MODE_STATIC
					b.freeze = true
			else:
				s["rest"] = 0.0
		var over: float = s["age"] - shard_lifetime
		if over > 0.0:
			var k := 1.0 - over / shard_fade_time
			if k <= 0.02:
				_retire(s)
				_active.remove_at(i)
				continue
			(s["mi"] as MeshInstance3D).scale = Vector3.ONE * k
		i += 1
	_step_droplets(dt)
	_step_puddles(dt)
	if _active.is_empty() and live_droplets <= 0 and _puddles.is_empty():
		set_physics_process(false)


# ------------------------------------------------------------------ droplets

func emit_droplet(pos: Vector3, vel: Vector3, vol_ml: float, color: Color) -> void:
	var i := _dnext
	_dnext = (_dnext + 1) % _dcap
	set_physics_process(true)
	if _dalive[i] == 0:
		live_droplets += 1
	_dalive[i] = 1
	_dpos[i] = pos
	_dvel[i] = vel
	_dvol[i] = vol_ml
	_dsize[i] = clampf(pow(3.0 * vol_ml * 1.0e-6 / (4.0 * PI), 1.0 / 3.0), 0.0025, 0.009)
	_dmm.set_instance_color(i, color)
	_write_droplet(i)


func _write_droplet(i: int) -> void:
	var v := _dvel[i]
	var sp := v.length()
	var b := Basis.IDENTITY
	if sp > 0.1:
		b = Basis(Quaternion(Vector3.UP, v / sp))
	var r := _dsize[i]
	b = b.scaled(Vector3(r, r * (1.0 + minf(sp * 0.35, 3.0)), r))
	_dmm.set_instance_transform(i, Transform3D(b, _dpos[i]))


func _step_droplets(dt: float) -> void:
	if live_droplets <= 0:
		return
	var space := get_viewport().world_3d.direct_space_state
	for i in DROPLET_POOL:
		if _dalive[i] == 0:
			continue
		_dvel[i].y -= gravity * dt
		var p1 := _dpos[i] + _dvel[i] * dt
		var q := PhysicsRayQueryParameters3D.create(_dpos[i], p1, droplet_mask)
		var hit := space.intersect_ray(q)
		if not hit.is_empty():
			var n: Vector3 = hit["normal"]
			if n.y > 0.5:
				add_puddle(hit["position"], n, _dvol[i], _dmm.get_instance_color(i))
			_kill_droplet(i)
		elif p1.y < -100.0:
			_kill_droplet(i)
		else:
			_dpos[i] = p1
			_write_droplet(i)


func _kill_droplet(i: int) -> void:
	_dalive[i] = 0
	live_droplets -= 1
	_dmm.set_instance_transform(i, Transform3D(Basis.IDENTITY.scaled(Vector3.ZERO), Vector3.ZERO))


## Burst of droplets from a shattered/pierced container. dir = main splash direction (world).
func splash(pos: Vector3, dir: Vector3, volume_ml: float, color: Color, energy: float, base_vel := Vector3.ZERO, tier := -1) -> void:
	if volume_ml <= 1.0:
		return
	var sc := splash_scale if tier < 0 else minf(splash_scale, float(TIERS[tier]["splash"]))
	var n := maxi(int(clampi(int(volume_ml / 14.0), 10, 64) * sc), 6 if sc >= 0.2 else 4)
	n = mini(n, _dcap)
	var vol_each := volume_ml * 0.45 / n
	var speed := clampf(0.8 + sqrt(maxf(energy, 0.0)) * 0.35, 1.0, 8.0)
	for k in n:
		var d := (dir + Vector3(_rng.randfn(), _rng.randfn(), _rng.randfn()) * 0.7).normalized()
		emit_droplet(pos, base_vel * 0.5 + d * speed * _rng.randf_range(0.3, 1.0), vol_each, color)
	# the rest of the volume lands straight below as a puddle
	var space := get_viewport().world_3d.direct_space_state
	var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(pos, pos + Vector3.DOWN * 6.0, droplet_mask))
	if not hit.is_empty():
		add_puddle(hit["position"], hit["normal"], volume_ml * 0.55, color)


# ------------------------------------------------------------------ puddles
# HIGH: a Decal projected down onto whatever is below (stops at edges by itself).
# MEDIUM / LOW / MINIMAL (and HIGH without decal support): a quad clipped to the surface it lies on.
# The clip is computed when the puddle is created and when it outgrows the clipped area, never per frame:
# one centre ray finds the collider; a BoxShape3D top face is clipped analytically (Sutherland-Hodgman),
# a WorldBoundaryShape3D needs no clip, any other shape probes 8 rays just beyond the radius.

const PUDDLE_SHAPE_MARGIN := 1.2     ## wobbly outline reaches 1.19 x the nominal radius
const PUDDLE_GROW_HEADROOM := 1.3    ## clip area = needed size x this, so growth rarely re-clips


func decals_supported() -> bool:
	var m := ""
	if RenderingServer.has_method("get_current_rendering_method"):
		m = RenderingServer.call("get_current_rendering_method")
	else:
		m = str(ProjectSettings.get_setting("rendering/renderer/rendering_method", "forward_plus"))
	return m != "gl_compatibility"


func add_puddle(pos: Vector3, normal: Vector3, vol_ml: float, color: Color) -> void:
	for p in _puddles:
		var c: Vector3 = p["pos"]
		if c.distance_to(pos) < float(p["r"]) * 1.1 + 0.07 and p["normal"].dot(normal) > 0.9:
			p["vol"] += vol_ml
			p["age"] = minf(p["age"], 0.0)
			return
	if max_puddles <= 0:
		return
	while _puddles.size() >= max_puddles:
		(_puddles[0]["node"] as Node).queue_free()
		_puddles.remove_at(0)
	var up := normal.normalized()
	var x := up.cross(Vector3.FORWARD if absf(up.dot(Vector3.FORWARD)) < 0.9 else Vector3.RIGHT).normalized()
	var basis := Basis(x, up, x.cross(up))
	var p := {"pos": pos, "normal": up, "vol": vol_ml, "r": 0.01, "age": 0.0, "rc": 0.0,
		"poly": PackedVector2Array(), "mat": null, "decal": false, "rays": 0}
	var col := Color(color.r * 0.55, color.g * 0.55, color.b * 0.55, 0.85)
	if puddle_decals and decals_supported():
		_ensure_decal_textures()
		var d := Decal.new()
		d.texture_albedo = _puddle_tex
		d.texture_orm = _puddle_orm
		d.modulate = col
		d.albedo_mix = 1.0
		d.normal_fade = 0.5          # no paint on vertical faces (table sides) inside the box
		d.upper_fade = 0.6
		d.lower_fade = 0.6
		d.cull_mask = puddle_decal_cull_mask
		d.distance_fade_enabled = true
		d.distance_fade_begin = far_distance
		d.distance_fade_length = 5.0
		d.size = Vector3(0.02, puddle_decal_depth, 0.02)
		add_child(d)
		d.global_transform = Transform3D(basis.rotated(up, _rng.randf() * TAU), pos)
		p["node"] = d
		p["decal"] = true
		p["col"] = col
	else:
		var mi := MeshInstance3D.new()
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var m := ShaderMaterial.new()
		m.shader = _puddle_shader
		m.set_shader_parameter("col", Color(color.r, color.g, color.b, 0.85))
		m.set_shader_parameter("seed", _rng.randf() * 6.28)
		m.set_shader_parameter("radius", 0.01)
		mi.material_override = m
		add_child(mi)
		mi.global_transform = Transform3D(basis, pos + up * 0.002)
		p["node"] = mi
		p["mat"] = m
		p["x"] = x
		p["z"] = basis.z
		_fit_puddle(p, _target_radius(vol_ml))
	set_physics_process(true)
	_puddles.append(p)


func _target_radius(vol_ml: float) -> float:
	return minf(sqrt(vol_ml * 1.0e-6 / (puddle_thickness * PI)), 0.7)


## Rebuild the clipped quad of puddle p so it covers radius `target` (with headroom). Called on creation / growth only.
func _fit_puddle(p: Dictionary, target: float) -> void:
	var R := target * PUDDLE_SHAPE_MARGIN * PUDDLE_GROW_HEADROOM
	p["rc"] = R
	var poly := PackedVector2Array([Vector2(-R, -R), Vector2(R, -R), Vector2(R, R), Vector2(-R, R)])
	for hp in _surface_clip_planes(p, R):
		poly = _clip_half_plane(poly, hp[0], hp[1])
		if poly.size() < 3:
			break
	p["poly"] = poly
	var mi: MeshInstance3D = p["node"]
	if poly.size() < 3:
		mi.mesh = null
		return
	var verts := PackedVector3Array()
	for i in range(1, poly.size() - 1):   # triangle fan (the clipped polygon is convex)
		verts.append(Vector3(poly[0].x, 0.0, poly[0].y))
		verts.append(Vector3(poly[i].x, 0.0, poly[i].y))
		verts.append(Vector3(poly[i + 1].x, 0.0, poly[i + 1].y))
	var norms := PackedVector3Array()
	norms.resize(verts.size())
	norms.fill(Vector3.UP)
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_NORMAL] = norms
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	mi.mesh = am


func _puddle_ray(from: Vector3, to: Vector3, p: Dictionary) -> Dictionary:
	puddle_rays += 1
	p["rays"] += 1
	return get_viewport().world_3d.direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(from, to, droplet_mask))


## Half-planes [n: Vector2, c: float] (inside: n.dot(q) <= c) in the puddle's 2D frame bounding the surface.
func _surface_clip_planes(p: Dictionary, R: float) -> Array:
	var pos: Vector3 = p["pos"]
	var up: Vector3 = p["normal"]
	var hit := _puddle_ray(pos + up * 0.03, pos - up * 0.03, p)
	if hit.is_empty():
		return []
	var co := hit["collider"] as CollisionObject3D
	var shape: Shape3D = null
	var sxf := Transform3D.IDENTITY
	if co:
		var owner_id := co.shape_find_owner(int(hit["shape"]))
		if co.shape_owner_get_shape_count(owner_id) > 0:
			shape = co.shape_owner_get_shape(owner_id, 0)
			sxf = co.global_transform * co.shape_owner_get_transform(owner_id)
	if shape is WorldBoundaryShape3D:
		return []
	if shape is BoxShape3D:
		var r := _box_top_rect(shape as BoxShape3D, sxf, p)
		if r.size() == 4:
			return _polygon_planes(r)
	return _probe_planes(p, R)


## Top face of a box (the face whose normal best matches the puddle normal), projected into the puddle frame.
func _box_top_rect(box: BoxShape3D, xf: Transform3D, p: Dictionary) -> PackedVector2Array:
	var up: Vector3 = p["normal"]
	var h := box.size * 0.5
	var best := -2.0
	var ax := 0
	var sg := 1.0
	for i in 3:
		for s in [1.0, -1.0]:
			var d: float = (xf.basis[i] * s).normalized().dot(up)
			if d > best:
				best = d
				ax = i
				sg = s
	if best < 0.9:
		return PackedVector2Array()
	var j := (ax + 1) % 3
	var k := (ax + 2) % 3
	var out := PackedVector2Array()
	for c in [Vector2(-1, -1), Vector2(1, -1), Vector2(1, 1), Vector2(-1, 1)]:
		var l := Vector3.ZERO
		l[ax] = sg * h[ax]
		l[j] = c.x * h[j]
		l[k] = c.y * h[k]
		out.append(_to_puddle_2d(xf * l, p))
	return out


func _to_puddle_2d(w: Vector3, p: Dictionary) -> Vector2:
	var d: Vector3 = w - p["pos"]
	return Vector2(d.dot(p["x"]), d.dot(p["z"]))


func _polygon_planes(poly: PackedVector2Array) -> Array:
	var area := 0.0
	for i in poly.size():
		area += poly[i].cross(poly[(i + 1) % poly.size()])
	var s := 1.0 if area >= 0.0 else -1.0
	var out := []
	for i in poly.size():
		var a := poly[i]
		var e := poly[(i + 1) % poly.size()] - a
		var n := Vector2(e.y, -e.x) * s
		out.append([n, n.dot(a)])
	return out


## Fallback for non-box colliders: 8 rays just beyond the clip radius; where one misses the surface,
## bisect toward the centre (3 steps) and clip with a half-plane at the last point still on the surface.
func _probe_planes(p: Dictionary, R: float) -> Array:
	var pos: Vector3 = p["pos"]
	var up: Vector3 = p["normal"]
	var out := []
	for k in 8:
		var a := TAU * k / 8.0
		var d2 := Vector2(cos(a), sin(a))
		var dw: Vector3 = p["x"] * d2.x + p["z"] * d2.y
		if _on_surface(pos + dw * R, p):
			continue
		var lo := 0.0
		var hi := R
		for s in 3:
			var mid := (lo + hi) * 0.5
			if _on_surface(pos + dw * mid, p):
				lo = mid
			else:
				hi = mid
		out.append([d2, lo])
	return out


func _on_surface(w: Vector3, p: Dictionary) -> bool:
	var up: Vector3 = p["normal"]
	var hit := _puddle_ray(w + up * 0.03, w - up * 0.03, p)
	if hit.is_empty():
		return false
	return absf((hit["position"] - p["pos"]).dot(up)) < 0.008 and (hit["normal"] as Vector3).dot(up) > 0.8


## Sutherland-Hodgman against one half-plane n.dot(q) <= c.
func _clip_half_plane(poly: PackedVector2Array, n: Vector2, c: float) -> PackedVector2Array:
	var out := PackedVector2Array()
	var cnt := poly.size()
	for i in cnt:
		var cur := poly[i]
		var prv := poly[(i + cnt - 1) % cnt]
		var fc := n.dot(cur) - c
		var fp := n.dot(prv) - c
		if fc <= 0.0:
			if fp > 0.0:
				out.append(prv + (cur - prv) * (fp / (fp - fc)))
			out.append(cur)
		elif fp <= 0.0:
			out.append(prv + (cur - prv) * (fp / (fp - fc)))
	return out


## Soft wobbly radial mask (albedo) + wet ORM for the decal puddles, generated once.
func _ensure_decal_textures() -> void:
	if _puddle_tex:
		return
	const N := 128
	var img := Image.create(N, N, false, Image.FORMAT_RGBA8)
	var orm := Image.create(N, N, false, Image.FORMAT_RGBA8)
	for yy in N:
		for xx in N:
			var q := Vector2((xx + 0.5) / N * 2.0 - 1.0, (yy + 0.5) / N * 2.0 - 1.0)
			var a := atan2(q.y, q.x)
			var e := 1.0 + 0.07 * sin(a * 5.0) + 0.05 * sin(a * 9.0 + 1.3) + 0.03 * sin(a * 14.0 + 2.9)
			var d := q.length() * 1.15 / e
			var m := clampf((1.0 - d) / 0.12, 0.0, 1.0)
			m = m * m * (3.0 - 2.0 * m)
			img.set_pixel(xx, yy, Color(1, 1, 1, m))
			orm.set_pixel(xx, yy, Color(1.0, 0.05, 0.0, m))   # wet: low roughness
	img.generate_mipmaps()
	orm.generate_mipmaps()
	_puddle_tex = ImageTexture.create_from_image(img)
	_puddle_orm = ImageTexture.create_from_image(orm)


func _step_puddles(dt: float) -> void:
	var i := 0
	while i < _puddles.size():
		var p := _puddles[i]
		p["age"] += dt
		var vol: float = p["vol"]
		var fade := 1.0
		if p["age"] > puddle_life:
			var e: float = (p["age"] - puddle_life) / puddle_evaporate_time
			if e >= 1.0:
				(p["node"] as Node).queue_free()
				_puddles.remove_at(i)
				continue
			vol *= 1.0 - e
			fade = 1.0 - e * e
		var target := _target_radius(vol)
		var r: float = p["r"]
		r = lerpf(r, target, minf(1.0, 3.0 * dt)) if (target > r and animate_puddles) else target
		p["r"] = r
		if p["decal"]:
			var d: Decal = p["node"]
			d.size = Vector3(r * 2.3, puddle_decal_depth, r * 2.3)
			var c: Color = p["col"]
			d.modulate = Color(c.r, c.g, c.b, c.a * fade)
		else:
			if target * PUDDLE_SHAPE_MARGIN > float(p["rc"]):   # outgrew the clipped area (more liquid added)
				_fit_puddle(p, target)
			var m: ShaderMaterial = p["mat"]
			m.set_shader_parameter("radius", r)
			m.set_shader_parameter("fade", fade)
		i += 1
