class_name LeakStream
extends MeshInstance3D
## Thin continuous liquid jet out of a bullet hole (HIGH tier). One per wet leak hole, owned by BreakableBottle._process_leaks,
## parented to the BottleBreakManager (world space, top_level) so it can finish falling when the bottle breaks or stops feeding.
##  - Geometry: one shared tube mesh bent along the cached ballistic parabola p0 + v0 t + g t^2 / 2 in the vertex shader,
##    t in [t0, t_land]. Radius from flow continuity r = sqrt(q / (pi |v|)) clamped to [R_MIN, R_MAX]; travelling surface waves and
##    a pinch-off into droplets over the last ~40 % (both move with the liquid: pattern f(t - phase)); `phase` advances per tick.
##  - Parabola + landing point are recomputed only when the hole moves > 2 mm or the exit velocity changes noticeably:
##    one ray straight down from the hole gives the ground height, solved analytically; one ray down at the predicted landing
##    point verifies it (a third ray re-solves if the stream went over an edge). No per-frame rays.
##  - Volume: feed() receives the exact ml the bottle lost this tick; it is batched (FLUSH s) and delivered to the landing point
##    after the flight time as puddle volume (+ two small splash droplets, never fatter than the stream) through BottleBreakManager.
##    Ledger: emitted_ml = landed_ml + lost_ml + in_flight_ml() (static, for tests).
##  - Stops when not fed for a tick (head below the hole, empty, bottle gone): the tail falls off the hole and the radius fades;
##    restarts if fed again. Frees itself when the tail has landed. Global cap MAX_STREAMS (callers fall back to droplets).

const GRAV := 9.81
const MAX_STREAMS := 12
const R_MIN := 0.0005
const R_MAX := 0.002
const FLUSH := 0.08
const MAX_FLIGHT := 1.5
const FADE_T := 0.12                 ## s: radius fade after the stream stopped (tail also falls)
const RINGS := 96
const SIDES := 6

static var live: Array[LeakStream] = []
static var emitted_ml := 0.0
static var landed_ml := 0.0
static var lost_ml := 0.0
static var recomputes := 0
static var rays := 0
static var _shader: Shader
static var _tube: ArrayMesh

var p0 := Vector3.ZERO               ## cached parabola (world)
var v0 := Vector3.ZERO
var q := 0.0                         ## m3/s (last fed)
var t_land := 0.3
var land_pos := Vector3.ZERO
var land_n := Vector3.UP
var landed := false                  ## landing point found by the rays
var stopping := false
var finished := false
var phase := 0.0
var color := Color(0.5, 0.3, 0.1)
var _q_set := -1.0
var _has_path := false
var _stop_t := 0.0
var _last_feed := -10
var _acc := 0.0
var _acc_t := 0.0
var _clock := 0.0
var _fifo_t := PackedFloat64Array()
var _fifo_ml := PackedFloat64Array()
var _excl: Array[RID] = []
var _mask := 1
var _mat: ShaderMaterial
var _splash_k := 0
var _rng := RandomNumberGenerator.new()


static func in_flight_total() -> float:
	var s := 0.0
	for ls in live:
		s += ls.in_flight_ml()
	return s


static func reset_ledger() -> void:
	emitted_ml = 0.0
	landed_ml = 0.0
	lost_ml = 0.0
	recomputes = 0
	rays = 0


## New stream under `parent` (world-space), or null when MAX_STREAMS are live.
static func acquire(parent: Node, exclude: RID, mask: int) -> LeakStream:
	if live.size() >= MAX_STREAMS:
		return null
	if _shader == null:
		_shader = Shader.new()
		_shader.code = SHADER
		_tube = _build_tube(SIDES, RINGS)
	var s := LeakStream.new()
	s.name = "LeakStream"
	s._excl = [exclude]
	s._mask = mask
	s._mat = ShaderMaterial.new()
	s._mat.shader = _shader
	s.mesh = _tube
	s.material_override = s._mat
	s.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	s.top_level = true
	s._rng.randomize()
	live.append(s)
	parent.add_child(s)
	s.global_transform = Transform3D.IDENTITY
	return s


func in_flight_ml() -> float:
	var s := _acc
	for m in _fifo_ml:
		s += m
	return s


## Called by the bottle every physics tick the hole flows. p / v: hole position and exit velocity (world), q_m3s flow, ml this tick.
func feed(p: Vector3, v: Vector3, q_m3s: float, ml: float, col: Color) -> void:
	_last_feed = Engine.get_physics_frames()
	if stopping:
		stopping = false
		_stop_t = 0.0
		visible = true
	emitted_ml += ml
	_acc += ml
	q = q_m3s
	var tol := 0.04 + 0.04 * v0.length()
	if not _has_path or p.distance_to(p0) > 0.002 or v.distance_to(v0) > tol:
		_recompute(p, v)
	if absf(q - _q_set) > 0.05 * _q_set:
		_q_set = q
		_mat.set_shader_parameter("q", q)
	if col != color:
		color = col
		_mat.set_shader_parameter("color", col)


func _ray(a: Vector3, b: Vector3) -> Dictionary:
	rays += 1
	return get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(a, b, _mask, _excl))


func _t_at_height(y: float) -> float:
	var dy := p0.y - y
	var disc := v0.y * v0.y + 2.0 * GRAV * dy
	if disc < 0.0:
		return MAX_FLIGHT
	return clampf((v0.y + sqrt(disc)) / GRAV, 0.0, MAX_FLIGHT)


func pos_at(t: float) -> Vector3:
	return p0 + v0 * t + Vector3(0.0, -0.5 * GRAV * t * t, 0.0)


func _recompute(p: Vector3, v: Vector3) -> void:
	recomputes += 1
	_has_path = true
	p0 = p
	v0 = v
	landed = false
	t_land = MAX_FLIGHT
	var h := _ray(p0, p0 + Vector3.DOWN * 30.0)
	if not h.is_empty():
		var y: float = (h["position"] as Vector3).y
		land_n = h["normal"]
		var top := p0.y + maxf(v0.y, 0.0) * maxf(v0.y, 0.0) / (2.0 * GRAV) + 0.005
		for it in 2:   # verify below the predicted landing point (stream may cross a table edge)
			var t := _t_at_height(y)
			var lp := pos_at(t)
			var h2 := _ray(Vector3(lp.x, top, lp.z), Vector3(lp.x, -30.0, lp.z))
			if h2.is_empty():
				break
			var y2: float = (h2["position"] as Vector3).y
			land_n = h2["normal"]
			if absf(y2 - y) < 0.004 or y2 > p0.y:
				y = y2 if y2 <= p0.y else y
				break
			y = y2
		t_land = _t_at_height(y)
		land_pos = pos_at(t_land)
		landed = t_land < MAX_FLIGHT
	land_pos = pos_at(t_land)
	_mat.set_shader_parameter("p0", p0)
	_mat.set_shader_parameter("v0", v0)
	_mat.set_shader_parameter("t1", t_land)
	_mat.set_shader_parameter("bead_f", 1.0 / maxf(0.01, t_land * 0.045))
	var lo := p0.min(land_pos)
	var hi := p0.max(land_pos)
	hi.y = maxf(hi.y, p0.y + maxf(v0.y, 0.0) * maxf(v0.y, 0.0) / (2.0 * GRAV))
	custom_aabb = AABB(lo, hi - lo).grow(0.01)


func _physics_process(dt: float) -> void:
	_clock += dt
	phase += dt
	_mat.set_shader_parameter("phase", phase)
	if not stopping and Engine.get_physics_frames() - _last_feed > 1:
		stopping = true
		_stop_t = 0.0
	var t0 := 0.0
	var fade := 1.0
	if stopping:
		_stop_t += dt
		t0 = minf(_stop_t, t_land)
		fade = clampf(1.0 - _stop_t / maxf(FADE_T, t_land), 0.0, 1.0)
	_mat.set_shader_parameter("t0", t0)
	_mat.set_shader_parameter("fade", fade)
	_acc_t += dt
	if _acc > 0.0 and (_acc_t >= FLUSH or stopping):
		_fifo_t.append(_clock + t_land)
		_fifo_ml.append(_acc)
		_acc = 0.0
		_acc_t = 0.0
	while _fifo_t.size() > 0 and _fifo_t[0] <= _clock:
		_deposit(_fifo_ml[0])
		_fifo_t.remove_at(0)
		_fifo_ml.remove_at(0)
	if stopping and _stop_t >= t_land and _fifo_t.is_empty() and _acc <= 0.0:
		_finish()


func _deposit(ml: float) -> void:
	if not landed:
		lost_ml += ml
		return
	landed_ml += ml
	var mgr := BottleBreakManager.get_for(self)
	_splash_k += 1
	var sml := 0.0
	if _splash_k % 2 == 0 and land_n.y > 0.5:
		var rd := maxf(radius_at(t_land, phase) * 0.8, 0.0012)
		var each := minf(ml * 0.1, rd * rd * rd * 4.18879e6)
		for k in 2:
			var dv := Vector3(_rng.randfn(), 0.0, _rng.randfn()) * 0.35 + land_n * _rng.randf_range(0.3, 0.8)
			mgr.emit_droplet(land_pos + land_n * 0.004, dv, each, color)
			sml += each
	mgr.add_puddle(land_pos, land_n, ml - sml, color)


func _finish() -> void:
	if finished:
		return
	finished = true
	set_physics_process(false)
	live.erase(self)
	queue_free()


func _exit_tree() -> void:
	if not finished:
		finished = true
		lost_ml += in_flight_ml()
		live.erase(self)


## GDScript mirror of the shader radius (incl. waves / pinch-off) at flight time t and phase ph. t0 / fade not applied.
func radius_at(t: float, ph: float) -> float:
	var v := v0 + Vector3(0.0, -GRAV * t, 0.0)
	var sp := maxf(v.length(), 0.25)
	var r := clampf(sqrt(q / (PI * sp)), R_MIN, R_MAX)
	var f := 1.0 / maxf(0.01, t_land * 0.045)
	var u := (t - ph) * f
	r *= 1.0 + 0.12 * sin(TAU * u * 0.5)
	var s := t / maxf(t_land, 1e-4)
	var brk := smoothstep(0.6, 0.95, s)
	var bead := 0.5 + 0.5 * sin(TAU * u)
	r *= lerpf(1.0, smoothstep(0.2, 0.75, bead) * 1.3, brk)
	return r


## Centreline samples (RINGS points from the hole to the landing point), same t mapping as the shader.
func centreline() -> PackedVector3Array:
	var out := PackedVector3Array()
	for j in RINGS:
		out.append(pos_at(lerpf(0.0, t_land, float(j) / (RINGS - 1))))
	return out


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


const SHADER := """
shader_type spatial;
render_mode world_vertex_coords, cull_disabled;
uniform vec3 p0;
uniform vec3 v0;
uniform float t0 = 0.0;
uniform float t1 = 0.3;
uniform float q = 0.00001;
uniform float phase = 0.0;
uniform float bead_f = 70.0;
uniform float fade = 1.0;
uniform vec4 color : source_color = vec4(0.5, 0.3, 0.1, 1.0);
const float R_MIN = 0.0005;
const float R_MAX = 0.002;
varying float vu;
varying float vs;
void vertex() {
	float t = mix(t0, t1, UV.y);
	vec3 g = vec3(0.0, -9.81, 0.0);
	vec3 P = p0 + v0 * t + 0.5 * g * t * t;
	vec3 V = v0 + g * t;
	float sp = max(length(V), 0.25);
	vec3 T = V / sp;
	vec3 side = vec3(-v0.z, 0.0, v0.x);
	side = dot(side, side) > 1e-6 ? normalize(side) : vec3(1.0, 0.0, 0.0);
	vec3 N1 = normalize(cross(side, T));
	float r = clamp(sqrt(q / (3.14159265 * sp)), R_MIN, R_MAX);
	float u = (t - phase) * bead_f;                         // pattern travels with the liquid
	r *= 1.0 + 0.12 * sin(6.2831853 * u * 0.5);             // surface waves
	float s = t / max(t1, 1e-4);
	float brk = smoothstep(0.6, 0.95, s);                    // Rayleigh-Plateau pinch-off toward the end
	float bead = 0.5 + 0.5 * sin(6.2831853 * u);
	r *= mix(1.0, smoothstep(0.2, 0.75, bead) * 1.3, brk);
	r *= fade;
	float a = UV.x * 6.2831853;
	vec3 o = cos(a) * N1 + sin(a) * side;
	VERTEX = P + o * r;
	NORMAL = o;
	vu = u;
	vs = UV.x;
}
void fragment() {
	float fres = pow(1.0 - clamp(abs(dot(NORMAL, VIEW)), 0.0, 1.0), 2.5);
	float streak = sin(vs * 31.0 + vu * 3.1) * 0.5 + 0.5;
	ALBEDO = color.rgb * (0.75 + 0.12 * streak);
	ROUGHNESS = 0.04 + 0.1 * (1.0 - fres);
	SPECULAR = 0.85;
	EMISSION = color.rgb * (0.06 + 0.1 * fres);
}
"""
