class_name BottlePour
extends Node
## Pour / empty / receive for one container (phase 1 of docs/liquid_system_brainstorm.md). See docs/pour_system.md.
## Child of a BreakableBottle or BottleProp (BottleFactory adds it, opts.pour = true). Needs body.fill, body.ctl (BottleLiquid).
##  - Drain: each physics tick, the volume above the low lip of the mouth (LUT: fill - fill_at(up, s_lo)) leaves at a
##    Torricelli/weir rate over the submerged part of the mouth disc, capped by a glug (counter-flow) limit when the lip is
##    fully under the liquid. Stops at the rim, keeps going when inverted until empty.
##  - Stream: one parcel per tick carries the exact volume on its parabola. Parcels land in another container's mouth disc
##    (receive(): fill rises, empty receiver adopts the colour, overflow leaves over its own rim as parcels), or on the world
##    (puddle + splash droplets through BottleBreakManager). The visible stream is one tube mesh bent in the vertex shader.
##  - Cost: physics_process only while pouring, parcels in flight, or the body is awake. Sleeping / capped: 0.
## Tiers: only HIGH is built (quality is stored; _stream_mode() is the hook for cheaper tiers later).

signal poured_into(receiver: Node3D, ml: float)
signal stream_started
signal stream_stopped

const GRAV := 9.81
const HIGH := 3

static var registry: Array[BottlePour] = []     ## every live pour node (receiver candidates)
static var world_puddle_ml := 0.0               ## ledger for tests: volume deposited on the world (puddles + splash drops)
static var world_lost_ml := 0.0                 ## parcels that flew past max_flight / below the world

@export var cd := 0.62                          ## discharge coefficient (orifice / weir)
@export var glug_k := 0.9                       ## glug cap Q = k A sqrt(g D); 0.37 = brainstorm inverted-bottle calibration, 0.9 = spec pour speed
@export var min_excess_ml := 0.15               ## less than this above the lip does not flow (surface film)
@export var max_exit_speed := 3.0
@export var max_flight := 1.6                   ## s; parcels older than this are dropped (counted in world_lost_ml)
@export_flags_3d_physics var ray_mask := 1 | 2 | 8
@export var can_receive := true
@export var quality := HIGH                     ## only HIGH implemented

var body: RigidBody3D
var pouring := false
var flow_ml_s := 0.0                            ## current outflow
var poured_ml := 0.0                            ## total that left this container (stream + overflow)
var received_ml := 0.0                          ## total accepted from other pourers
var delivered_ml := 0.0                         ## of poured_ml: landed in receivers (incl. what overflowed there)
var spilled_ml := 0.0                           ## of poured_ml: landed on the world
var stream_p0 := Vector3.ZERO                   ## current exit point / velocity (world), for aiming and drawing
var stream_v0 := Vector3.ZERO
var last_land := Vector3.ZERO
var jet_area := 0.0                             ## m2, wetted mouth area (or glug area) the stream leaves through (last drain tick)

var _active := false
var _ctl: BottleLiquid
# parcels (SoA, swap-remove)
var _pp := PackedVector3Array()
var _pv := PackedVector3Array()
var _pvol := PackedFloat64Array()
var _page := PackedFloat32Array()
var _pcol := PackedColorArray()
var _np := 0
var _overflow_ml := 0.0
var _plugged := false
var _q_vis := 0.0                               ## smoothed flow for the tube radius (m3/s)
var _t_land := 0.4
var _stop_t := -1.0                             ## time since the stream stopped (tail falls off the lip)
var _glug_t := 0.0
var _pulse := 1.0
var _splash_k := 0
var _rng := RandomNumberGenerator.new()
var _stream: MeshInstance3D
var _smat: ShaderMaterial
static var _shader: Shader
static var _tube: ArrayMesh


func _enter_tree() -> void:
	registry.append(self)


func _exit_tree() -> void:
	registry.erase(self)


func _ready() -> void:
	if body == null:
		body = get_parent() as RigidBody3D
	set_physics_process(false)
	body.sleeping_state_changed.connect(_on_body_sleep)
	_hook_ctl.call_deferred()
	activate.call_deferred()


func _hook_ctl() -> void:
	_ctl = body.ctl
	if _ctl and not _ctl.woke.is_connected(activate):
		_ctl.woke.connect(activate)
		_ctl.opened.connect(activate)
	if _ctl:
		_ctl.drain_driven = true


func _on_body_sleep() -> void:
	if not body.sleeping:
		activate()


## Start per-tick processing (cheap no-op when the container cannot pour).
func activate() -> void:
	if not _active and is_inside_tree():
		_active = true
		set_physics_process(true)


func _deactivate() -> void:
	_active = false
	set_physics_process(false)


func _ready_ctl() -> bool:
	if _ctl == null or not is_instance_valid(_ctl):
		_hook_ctl()
	return _ctl != null and _ctl.lut != null and _ctl.liquid != null and _ctl.mouth_radius > 0.0


func is_open() -> bool:
	return _ready_ctl() and _ctl.is_open()


func capacity_ml() -> float:
	return _ctl.capacity_ml() if _ready_ctl() else 0.0


func volume_ml() -> float:
	return body.fill * capacity_ml()


func in_flight_ml() -> float:
	var s := 0.0
	for i in _np:
		s += _pvol[i]
	return s + _overflow_ml


## Stream mode by tier. Only HIGH (tube + parcels + splash) exists; lower tiers would branch here (see docs/pour_system.md).
func _stream_mode() -> int:
	return HIGH


func _physics_process(dt: float) -> void:
	if not _ready_ctl() or body.state != &"intact":
		if _np == 0:
			_set_pouring(false)
			_deactivate()
		return
	var flowed := 0.0
	flow_ml_s = 0.0   # (stale rate bug: an emptied / closed container kept its last flow value)
	if body.fill > 0.0 and _ctl.is_open():
		flowed = _drain(dt)
	if _overflow_ml > 0.0:
		_emit_overflow()
	if _np > 0:
		_step_parcels(dt)
	_set_pouring(flowed > 0.0)
	_update_stream(flowed, dt)
	if flowed <= 0.0 and _np == 0 and _overflow_ml <= 0.0 and (_stream == null or not _stream.visible):
		if body.fill <= 0.0 or not _ctl.is_open() or body.sleeping or _ctl.is_sleeping():
			_deactivate()


# ------------------------------------------------------------------ drain (flow law)

func _drain(dt: float) -> float:
	var lxf := _ctl.liquid.global_transform
	var bas := lxf.basis.orthonormalized()
	var u := (bas.inverse() * Vector3.UP).normalized()
	var cap := _ctl.capacity_ml()
	var f: float = body.fill
	var lut := _ctl.lut
	var a := _ctl.mouth_axis
	var c := _ctl.mouth_centre
	var r := _ctl.mouth_radius
	var au := a.dot(u)
	var sig := sqrt(maxf(0.0, 1.0 - au * au))
	var cu := c.dot(u)
	var s_lo := cu - r * sig
	var s_hi := cu + r * sig
	var d := lut.offset(u, f)
	if d <= s_lo:
		flow_ml_s = 0.0
		return 0.0
	var vol := f * cap
	var excess := (f - minf(f, lut.fill_at(u, s_lo))) * cap
	if excess < min_excess_ml and vol - excess > 0.01:
		flow_ml_s = 0.0
		return 0.0
	# weir / orifice over the submerged part of the disc (16 strips across the steepest-descent direction)
	var q := 0.0
	var wet := 0.0
	var dx := 2.0 * r / 16.0
	for i in 16:
		var x := -r + (i + 0.5) * dx
		var h := d - (cu + x * sig)
		if h > 0.0:
			var w := 2.0 * sqrt(maxf(0.0, r * r - x * x))
			q += w * sqrt(2.0 * GRAV * h) * dx
			wet += w * dx
	q *= cd
	var area := PI * r * r
	_plugged = s_hi <= d
	var a_jet := maxf(wet, area * 0.05)   # no vena-contracta: the stream leaves as thick as the wetted part of the mouth
	if _plugged:
		q = minf(q, glug_k * area * sqrt(GRAV * 2.0 * r))
		a_jet = 0.5 * area
	var dv := minf(minf(excess, q * dt * 1.0e6), vol)
	if excess < min_excess_ml:
		dv = excess   # the last film when inverted
	if dv <= 0.0:
		flow_ml_s = 0.0
		return 0.0
	flow_ml_s = dv / dt
	body.fill = maxf(0.0, (vol - dv) / cap)
	poured_ml += dv
	# exit: low lip point, velocity along the mouth axis + rigid-body velocity there
	var e := Vector3.ZERO
	if sig > 1e-4:
		e = -(u - au * a) / sig
	# start the stream at the middle of the wetted part of the mouth, not on the lip edge
	var x_top := minf(r, (d - cu) / maxf(sig, 1e-4)) if sig > 1e-4 else 0.0
	var x_c := 0.5 * (-r + x_top) if sig > 1e-4 else 0.0
	var p0 := lxf * (c - e * x_c)
	var aw := (bas * a).normalized()
	jet_area = a_jet
	var sp := minf(q / maxf(a_jet, 1e-7), max_exit_speed)
	var vb := body.linear_velocity + body.angular_velocity.cross(p0 - body.global_transform * body.center_of_mass)
	stream_p0 = p0 + aw * 0.002
	stream_v0 = aw * sp + vb
	_q_vis = lerpf(_q_vis, dv * 1.0e-6 / dt, 0.25)
	_add_parcel(stream_p0, stream_v0, dv, _ctl.liquid_color())
	return dv


# ------------------------------------------------------------------ parcels

func _add_parcel(p: Vector3, v: Vector3, ml: float, col: Color) -> void:
	if _np >= _pp.size():
		var n := maxi(32, _pp.size() * 2)
		_pp.resize(n)
		_pv.resize(n)
		_pvol.resize(n)
		_page.resize(n)
		_pcol.resize(n)
	_pp[_np] = p
	_pv[_np] = v
	_pvol[_np] = ml
	_page[_np] = 0.0
	_pcol[_np] = col
	_np += 1


func _remove_parcel(i: int) -> void:
	_np -= 1
	_pp[i] = _pp[_np]
	_pv[i] = _pv[_np]
	_pvol[i] = _pvol[_np]
	_page[i] = _page[_np]
	_pcol[i] = _pcol[_np]


## Open, upright-ish receiver mouths in world space: [pour, centre, normal, radius]. Built once per tick while parcels fly.
func _receivers() -> Array:
	var out := []
	for rp in registry:
		if rp == self or not rp.can_receive or not rp._ready_ctl() or not is_instance_valid(rp.body) or rp.body.state != &"intact":
			continue
		if not rp._ctl.is_open():
			continue
		var lxf := rp._ctl.liquid.global_transform
		var n := (lxf.basis * rp._ctl.mouth_axis).normalized()
		if n.y < 0.2:
			continue
		var cw := lxf * rp._ctl.mouth_centre
		if cw.distance_squared_to(body.global_position) > 9.0:
			continue
		out.append([rp, cw, n, rp._ctl.mouth_radius * lxf.basis.get_scale().x])
	return out


func _step_parcels(dt: float) -> void:
	var recv := _receivers()
	var space := body.get_world_3d().direct_space_state
	var excl: Array[RID] = [body.get_rid()]
	var g := Vector3(0.0, -GRAV, 0.0)
	var i := 0
	while i < _np:
		var p := _pp[i]
		var v := _pv[i]
		var v1 := v + g * dt
		var p1 := p + (v + v1) * 0.5 * dt
		_page[i] += dt
		var done := false
		for rc in recv:
			var cw: Vector3 = rc[1]
			var n: Vector3 = rc[2]
			var s0 := (p - cw).dot(n)
			var s1 := (p1 - cw).dot(n)
			if s0 >= 0.0 and s1 < 0.0:
				var x := p.lerp(p1, s0 / (s0 - s1))
				if x.distance_to(cw) < float(rc[3]) * 0.97:
					var ml := _pvol[i]
					(rc[0] as BottlePour).receive(ml, _pcol[i], self)
					delivered_ml += ml
					last_land = x
					_t_land = lerpf(_t_land, _page[i], 0.3)
					poured_into.emit((rc[0] as BottlePour).body, ml)
					done = true
					break
		if not done:
			var q := PhysicsRayQueryParameters3D.create(p, p1, ray_mask, excl)
			var hit := space.intersect_ray(q)
			if not hit.is_empty():
				_land(hit["position"], hit["normal"], _pvol[i], _pcol[i], space, excl, _page[i])
				_t_land = lerpf(_t_land, _page[i], 0.3)
				done = true
			elif _page[i] > max_flight or p1.y < -50.0:
				world_lost_ml += _pvol[i]
				spilled_ml += _pvol[i]
				done = true
		if done:
			_remove_parcel(i)
			continue
		_pp[i] = p1
		_pv[i] = v1
		i += 1


## World landing: puddle (+ a few splash droplets carrying part of the volume). Steep hits drop straight down to the floor.
func _land(pos: Vector3, n: Vector3, ml: float, col: Color, space: PhysicsDirectSpaceState3D, excl: Array[RID], age := 1.0) -> void:
	spilled_ml += ml
	world_puddle_ml += ml
	last_land = pos
	var mgr := BottleBreakManager.get_for(self)
	if n.y < 0.5:
		var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(pos + n * 0.01, pos + Vector3.DOWN * 6.0, ray_mask, excl))
		if hit.is_empty():
			return
		pos = hit["position"]
		n = hit["normal"]
	_splash_k += 1
	var sml := 0.0
	# splash beads: never fatter than the stream tube at the landing point (a bead bigger than the tube reads as a row of balls),
	# none when the stream lands right next to the mouth (age < 0.08 s: it hit the container's surroundings, not a free fall)
	if _splash_k % 3 == 0 and ml > 0.3 and age > 0.08:
		var rd := maxf(0.6 * stream_radius_at(age), 0.0025)
		var each := minf(ml * 0.1, rd * rd * rd * 4.18879e6)
		sml = each * 2.0
		for k in 2:
			var dv := Vector3(_rng.randfn(), 0.0, _rng.randfn()) * 0.5 + n * _rng.randf_range(0.4, 1.0)
			mgr.emit_droplet(pos + n * 0.01, dv, each, col)
	mgr.add_puddle(pos, n, ml - sml, col)


# ------------------------------------------------------------------ receiving

## Liquid arriving from another pourer. Returns the accepted ml; the rest overflows over this container's rim.
func receive(ml: float, col: Color, _from: BottlePour = null) -> float:
	if not _ready_ctl():
		return 0.0
	var cap := _ctl.capacity_ml()
	var have: float = body.fill * cap
	if have < 0.5:
		_ctl.set_liquid_color(col)
	var acc := clampf(cap - have, 0.0, ml)
	body.fill = clampf((have + acc) / cap, 0.0, 1.0)
	received_ml += acc
	_overflow_ml += ml - acc
	_ctl.agitate(clampf(ml * 0.02, 0.0, 0.3))
	if body.sleeping:
		body.sleeping = false
	activate()
	return acc


## Volume that did not fit leaves over the low side of the rim as parcels (they land as puddle / in another receiver).
func _emit_overflow() -> void:
	var lxf := _ctl.liquid.global_transform
	var bas := lxf.basis.orthonormalized()
	var u := (bas.inverse() * Vector3.UP).normalized()
	var a := _ctl.mouth_axis
	var au := a.dot(u)
	var e := u - au * a
	if e.length() < 0.05:
		var ang := _rng.randf() * TAU
		e = Vector3(cos(ang), 0.0, sin(ang))
		e = e - a * e.dot(a)
	e = -e.normalized()
	var r := _ctl.mouth_radius * 1.05
	var p := lxf * (_ctl.mouth_centre + e * r)
	var ew := (bas * e).normalized()
	_add_parcel(p, ew * 0.25 + body.linear_velocity, _overflow_ml, _ctl.liquid_color())
	poured_ml += _overflow_ml
	_overflow_ml = 0.0


# ------------------------------------------------------------------ stream drawing (HIGH: tube on the exit parabola)

func _set_pouring(on: bool) -> void:
	if on == pouring:
		return
	pouring = on
	if on:
		_stop_t = -1.0
		stream_started.emit()
	else:
		_stop_t = 0.0
		stream_stopped.emit()


## Tube radius at flight time t: the SAME formula as the STREAM_SHADER vertex stage (flow continuity r = sqrt(q / (pi v)),
## clamped to [0.7 mm, mouth radius], times the glug pulse, capped at the mouth radius). Waves / rounded tip are cosmetic and
## left out. Used by tests/pour_proj-style numeric tests.
func stream_radius_at(t: float) -> float:
	var v := stream_v0 + Vector3(0.0, -GRAV * t, 0.0)
	var sp := maxf(v.length(), 0.25)
	var rm := _stream_r_max()
	return minf(clampf(sqrt(_q_vis / (PI * sp)), 0.0007, rm) * _pulse, rm)


func _stream_r_max() -> float:
	return maxf(_ctl.mouth_radius, 0.002) if _ctl else 0.014


func _update_stream(flowed: float, dt: float) -> void:
	if _stream_mode() != HIGH:
		return
	if flowed <= 0.0:
		if _stop_t < 0.0 or _stream == null or not _stream.visible:
			return
		_stop_t += dt
		if _stop_t >= _t_land:
			_stream.visible = false
			_q_vis = 0.0
			return
	if _stream == null:
		_make_stream()
	_stream.visible = true
	_glug_t += dt
	var pulse := 1.0
	if _plugged:
		var period: float = 0.11 + 0.21 * float(body.fill)
		pulse = 1.0 + 0.18 * sin(TAU * _glug_t / period)
	var oldest := 0.0
	for i in _np:
		oldest = maxf(oldest, _page[i])
	var t1 := minf(_t_land if _np == 0 or oldest > _t_land * 0.9 else oldest, max_flight)
	_smat.set_shader_parameter("p0", stream_p0)
	_smat.set_shader_parameter("v0", stream_v0)
	_smat.set_shader_parameter("t0", maxf(_stop_t, 0.0))
	_smat.set_shader_parameter("t1", maxf(t1, maxf(_stop_t, 0.0) + 0.005))
	_smat.set_shader_parameter("q", _q_vis)
	_pulse = pulse
	_smat.set_shader_parameter("pulse", pulse)
	_smat.set_shader_parameter("r_max", _stream_r_max())
	_smat.set_shader_parameter("color", _ctl.liquid_color())


func _make_stream() -> void:
	if _shader == null:
		_shader = Shader.new()
		_shader.code = STREAM_SHADER
		_tube = _build_tube(10, 40)
	_smat = ShaderMaterial.new()
	_smat.shader = _shader
	_stream = MeshInstance3D.new()
	_stream.name = "PourStream"
	_stream.mesh = _tube
	_stream.material_override = _smat
	_stream.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_stream.top_level = true
	_stream.custom_aabb = AABB(Vector3(-500, -500, -500), Vector3(1000, 1000, 1000))
	add_child(_stream)
	_stream.global_transform = Transform3D.IDENTITY


static func _build_tube(sides: int, rings: int) -> ArrayMesh:
	var v := PackedVector3Array()
	var uv := PackedVector2Array()
	var idx := PackedInt32Array()
	for j in rings:
		for i in sides + 1:
			v.append(Vector3.ZERO)
			uv.append(Vector2(float(i) / sides, float(j) / (rings - 1)))
	for j in rings - 1:
		for i in sides:
			var a := j * (sides + 1) + i
			var b := a + sides + 1
			idx.append_array([a, b, a + 1, a + 1, b, b + 1])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	arr[Mesh.ARRAY_TEX_UV] = uv
	arr[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m


const STREAM_SHADER := """
shader_type spatial;
render_mode world_vertex_coords, cull_disabled;   // opaque: a transparent self-overlapping tube sorts badly
uniform vec3 p0;
uniform vec3 v0;
uniform float t0 = 0.0;
uniform float t1 = 0.3;
uniform float q = 0.0001;
uniform float pulse = 1.0;
uniform vec4 color : source_color = vec4(0.5, 0.1, 0.1, 1.0);
uniform float r_max = 0.014;
varying float vt;
varying float vs;
void vertex() {
	float t = mix(t0, t1, UV.y);
	vec3 g = vec3(0.0, -9.81, 0.0);
	vec3 P = p0 + v0 * t + 0.5 * g * t * t;
	vec3 V = v0 + g * t;
	float sp = max(length(V), 0.25);
	vec3 T = V / sp;
	// the parabola lies in the vertical plane through v0: its normal is a twist-free side vector for the whole tube
	vec3 side = vec3(-v0.z, 0.0, v0.x);
	side = dot(side, side) > 1e-6 ? normalize(side) : vec3(1.0, 0.0, 0.0);
	vec3 N1 = normalize(cross(side, T));
	vec3 B1 = side;
	float r = clamp(sqrt(q / (3.14159 * sp)), 0.0007, r_max) * pulse;
	r *= 1.0 + 0.05 * sin(t * 90.0 - TIME * 25.0);            // surface waves travelling down
	r *= smoothstep(0.0, 0.04, (t1 - t)) * 0.6 + 0.4;          // rounded tip
	r = min(r, r_max);
	float a = UV.x * 6.2831853;
	vec3 o = cos(a) * N1 + sin(a) * B1;
	VERTEX = P + o * r;
	NORMAL = o;
	vt = t;
	vs = UV.x;
}
void fragment() {
	float fres = pow(1.0 - clamp(abs(dot(NORMAL, VIEW)), 0.0, 1.0), 2.5);
	float streak = sin(vs * 37.0 + vt * 60.0 - TIME * 18.0) * 0.5 + 0.5;
	vec3 base = color.rgb;
	ALBEDO = base * (0.8 + 0.06 * streak);
	ROUGHNESS = 0.05 + 0.1 * (1.0 - fres);
	SPECULAR = 0.8;
	EMISSION = base * 0.08;
}
"""
