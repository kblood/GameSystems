class_name GSBottleLeakStream
extends MeshInstance3D
## Thin continuous liquid jet out of a bullet hole (HIGH tier). One per wet leak hole, owned by GSBreakableBottle._process_leaks,
## parented to the GSBottleBreakManager (world space, top_level) so it can finish falling when the bottle breaks or stops feeding.
##  - Geometry: one shared tube mesh bent along the cached ballistic parabola p0 + v0 t + g t^2 / 2 in the vertex shader,
##    t in [t0, t_land]. Radius from flow continuity r = sqrt(q / (pi |v|)) clamped to [R_MIN, R_MAX]; travelling surface waves and
##    a pinch-off into droplets over the last ~40 % (both move with the liquid: pattern f(t - phase)); `phase` advances per tick.
##  - Parabola + landing point are recomputed only when the hole moves > 2 mm or the exit velocity changes noticeably:
##    one ray straight down from the hole gives the ground height, solved analytically; one ray down at the predicted landing
##    point verifies it (a third ray re-solves if the stream went over an edge). No per-frame rays.
##  - Volume: feed() receives the exact ml the bottle lost this tick; it is batched (FLUSH s) and delivered to the landing point
##    after the flight time as puddle volume (+ two small splash droplets, never fatter than the stream) through GSBottleBreakManager.
##    Each batch captures kind/color, endpoint/normal, hit-or-miss and splash radius. Source movement flushes the previous path;
##    MAX_BATCHES bounds pending metadata and excess emission is explicitly classified as lost volume.
##    Ledger: emitted_ml = landed_ml + lost_ml + in_flight_ml() (static, for tests).
##  - Stops when not fed for a tick (head below the hole, empty, bottle gone): the tail falls off the hole and the radius fades;
##    restarts if fed again. Frees itself when the tail has landed. Global cap MAX_STREAMS (callers fall back to droplets).

const GRAV := 9.81
const MAX_STREAMS := 12
const MAX_BATCHES := 256             ## hard bound per stream; excess volume has a lost_ml receipt
const R_MIN := 0.0005
const R_MAX := 0.002
const FLUSH := 0.08
const MAX_FLIGHT := 1.5
const FADE_T := 0.12                 ## s: radius fade after the stream stopped (tail also falls)
const RINGS := 96
const SIDES := 6

static var live: Array[GSBottleLeakStream] = []
static var _next_checkpoint_id := 1
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
var _fifo_kind: Array[StringName] = []
var _fifo_color: Array[Color] = []
var _fifo_landing: Array[Dictionary] = []
var _acc_kind: StringName = &"unknown"
var _acc_color := Color(0.5, 0.3, 0.1)
var _excl: Array[RID] = []
var _mask := 1
var _source_rid := RID()
var _mat: ShaderMaterial
var _splash_k := 0
var _rng := RandomNumberGenerator.new()
var checkpoint_id := 0
var _emitted_total := 0.0
var _landed_total := 0.0
var _lost_total := 0.0


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
static func acquire(parent: Node, exclude: RID, mask: int, attach_to_parent: bool = true) -> GSBottleLeakStream:
	if attach_to_parent and live.size() >= MAX_STREAMS:
		return null
	if _shader == null:
		_shader = Shader.new()
		_shader.code = SHADER
		_tube = _build_tube(SIDES, RINGS)
	var s := GSBottleLeakStream.new()
	s.name = "GSBottleLeakStream"
	s.checkpoint_id = _next_checkpoint_id
	_next_checkpoint_id += 1
	s._excl = [exclude]
	s._mask = mask
	s._source_rid = exclude
	s._mat = ShaderMaterial.new()
	s._mat.shader = _shader
	s.mesh = _tube
	s.material_override = s._mat
	s.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	s.top_level = true
	s._rng.randomize()
	if attach_to_parent:
		live.append(s)
		parent.add_child(s)
		s.global_transform = Transform3D.IDENTITY
	return s


## Registers a prebuilt replacement group before firing any tree-entry callbacks.
static func activate_staged(parent: Node, streams: Array[GSBottleLeakStream]) -> bool:
	if live.size() + streams.size() > MAX_STREAMS: return false
	for stream in streams:
		if stream.finished or stream.get_parent() != null: return false
	for stream in streams: live.append(stream)
	for stream in streams:
		parent.add_child(stream)
		stream.global_transform = Transform3D.IDENTITY
	return true


func in_flight_ml() -> float:
	var s := _acc
	for m in _fifo_ml:
		s += m
	return s


static func find_checkpoint_id(parent: Node, wanted_id: int) -> GSBottleLeakStream:
	for stream in live:
		if is_instance_valid(stream) and stream.get_parent() == parent and stream.checkpoint_id == wanted_id:
			return stream
	return null


static func checkpoints_equal(a: Variant, b: Variant) -> bool:
	return _normalize_checkpoint_value(a) == _normalize_checkpoint_value(b)


static func _normalize_checkpoint_value(value: Variant) -> Variant:
	if typeof(value) in [TYPE_INT, TYPE_FLOAT]: return float(value)
	if value is Array:
		var normalized: Array = []
		for item in value: normalized.append(_normalize_checkpoint_value(item))
		return normalized
	if value is Dictionary:
		var normalized: Dictionary = {}
		for key in value:
			if String(key) in ["land_n", "normal"] and value[key] is Array and value[key].size() == 3:
				var normal := _array_vector(value[key]).normalized()
				normalized[key] = _vector_array(normal)
			else:
				normalized[key] = _normalize_checkpoint_value(value[key])
		return normalized
	return value


static func validate_checkpoint(raw: Variant) -> bool:
	if not raw is Dictionary or raw.get("version") != 1 or not _integer(raw.get("id")) \
			or not _number_between(raw.get("id"), 1.0, 1.0e12) \
			or not _integer(raw.get("mask")) or not _number_between(raw.get("mask"), 0.0, 4294967295.0) \
			or not _finite_vector_array(raw.get("p0")) or not _finite_vector_array(raw.get("v0")) \
			or not _finite_vector_array(raw.get("land_pos")) or not _finite_vector_array(raw.get("land_n")) \
			or not _valid_normal(_array_vector(raw.get("land_n"))) \
			or not _number_between(raw.get("q"), 0.0, 1.0) \
			or not _number_between(raw.get("t_land"), 0.0, MAX_FLIGHT) \
			or not _number_between(raw.get("phase"), 0.0, 1.0e6) \
			or not _finite_color_array(raw.get("color")) \
			or not _number_between(raw.get("q_set"), -1.0, 1.0) \
			or typeof(raw.get("landed")) != TYPE_BOOL or typeof(raw.get("stopping")) != TYPE_BOOL \
			or typeof(raw.get("finished")) != TYPE_BOOL or raw.finished \
			or typeof(raw.get("has_path")) != TYPE_BOOL or not _number_between(raw.get("stop_t"), 0.0, 10.0) \
			or not _integer(raw.get("feed_age_frames")) or int(raw.feed_age_frames) < 0 or int(raw.feed_age_frames) > 100000 \
			or not _number_between(raw.get("acc"), 0.0, GSPuddleStore.MAX_VOLUME_ML) \
			or not _number_between(raw.get("acc_t"), 0.0, 10.0) \
			or not _number_between(raw.get("clock"), 0.0, 1.0e9) \
			or not _valid_kind(raw.get("acc_kind")) or not _finite_color_array(raw.get("acc_color")) \
			or not _integer(raw.get("splash_k")) or int(raw.splash_k) < 0 or int(raw.splash_k) > 2147483647 \
			or not _valid_rng_state(raw.get("rng_state")) \
			or not _number_between(raw.get("emitted_ml"), 0.0, 1.0e12) \
			or not _number_between(raw.get("landed_ml"), 0.0, 1.0e12) \
			or not _number_between(raw.get("lost_ml"), 0.0, 1.0e12) \
			or not raw.get("fifo") is Array or raw.fifo.size() > MAX_BATCHES:
		return false
	var fifo_volume := 0.0
	var previous_due := float(raw.clock)
	for batch: Variant in raw.fifo:
		if not batch is Dictionary or not _number_between(batch.get("due"), previous_due, float(raw.clock) + MAX_FLIGHT + 0.01) \
				or not _number_between(batch.get("ml"), 0.0, GSPuddleStore.MAX_VOLUME_ML) or float(batch.ml) <= 0.0 \
				or not _valid_kind(batch.get("kind")) or not _finite_color_array(batch.get("color")) \
				or not batch.get("landing") is Dictionary:
			return false
		var landing: Dictionary = batch.landing
		if not _finite_vector_array(landing.get("position")) or not _finite_vector_array(landing.get("normal")) \
				or not _valid_normal(_array_vector(landing.get("normal"))) \
				or typeof(landing.get("landed")) != TYPE_BOOL \
				or not _number_between(landing.get("splash_radius"), 0.0, 1.0):
			return false
		previous_due = float(batch.due)
		fifo_volume += float(batch.ml)
	var total := float(raw.acc) + fifo_volume
	if absf(float(raw.emitted_ml) - (float(raw.landed_ml) + float(raw.lost_ml) + total)) \
			> maxf(0.000001, float(raw.emitted_ml) * 0.00000001):
		return false
	return true


func capture_checkpoint() -> Dictionary:
	if finished or not _valid_normal(land_n) or not _finite_color(color) or not _finite_color(_acc_color): return {}
	if _fifo_t.size() != _fifo_ml.size() or _fifo_t.size() != _fifo_kind.size() \
			or _fifo_t.size() != _fifo_color.size() or _fifo_t.size() != _fifo_landing.size(): return {}
	var fifo: Array[Dictionary] = []
	for i in _fifo_t.size():
		if i >= _fifo_ml.size() or i >= _fifo_kind.size() or i >= _fifo_color.size() or i >= _fifo_landing.size(): return {}
		var landing: Dictionary = _fifo_landing[i]
		fifo.append({"due": _fifo_t[i], "ml": _fifo_ml[i], "kind": String(_fifo_kind[i]),
			"color": _color_array(_fifo_color[i]), "landing": {"position": _vector_array(landing.get("position", Vector3.ZERO)),
			"normal": _vector_array(landing.get("normal", Vector3.UP)), "landed": bool(landing.get("landed", false)),
			"splash_radius": float(landing.get("splash_radius", 0.0))}})
	var state := {"version": 1, "id": checkpoint_id, "mask": _mask,
		"p0": _vector_array(p0), "v0": _vector_array(v0), "q": q, "t_land": t_land,
		"land_pos": _vector_array(land_pos), "land_n": _vector_array(land_n), "landed": landed,
		"stopping": stopping, "finished": finished, "phase": phase, "color": _color_array(color),
		"q_set": _q_set, "has_path": _has_path, "stop_t": _stop_t,
		"feed_age_frames": maxi(0, Engine.get_physics_frames() - _last_feed),
		"acc": _acc, "acc_t": _acc_t, "clock": _clock, "fifo": fifo,
		"acc_kind": String(_acc_kind), "acc_color": _color_array(_acc_color), "splash_k": _splash_k,
		"rng_state": str(_rng.state), "emitted_ml": _emitted_total, "landed_ml": _landed_total, "lost_ml": _lost_total}
	return state if validate_checkpoint(state) else {}


func restore_checkpoint(raw: Dictionary, exclude: RID) -> bool:
	if not validate_checkpoint(raw): return false
	checkpoint_id = int(raw.id)
	_next_checkpoint_id = maxi(_next_checkpoint_id, checkpoint_id + 1)
	_mask = int(raw.mask)
	_excl = [exclude]
	_source_rid = exclude
	p0 = _array_vector(raw.p0)
	v0 = _array_vector(raw.v0)
	q = float(raw.q)
	t_land = float(raw.t_land)
	land_pos = _array_vector(raw.land_pos)
	land_n = _array_vector(raw.land_n).normalized()
	landed = raw.landed
	stopping = raw.stopping
	finished = false
	phase = float(raw.phase)
	color = _array_color(raw.color)
	_q_set = float(raw.q_set)
	_has_path = raw.has_path
	_stop_t = float(raw.stop_t)
	_last_feed = Engine.get_physics_frames() - int(raw.feed_age_frames)
	_acc = float(raw.acc)
	_acc_t = float(raw.acc_t)
	_clock = float(raw.clock)
	_fifo_t.clear(); _fifo_ml.clear(); _fifo_kind.clear(); _fifo_color.clear(); _fifo_landing.clear()
	for batch: Dictionary in raw.fifo:
		_fifo_t.append(float(batch.due)); _fifo_ml.append(float(batch.ml))
		_fifo_kind.append(StringName(batch.kind)); _fifo_color.append(_array_color(batch.color))
		var landing: Dictionary = batch.landing
		_fifo_landing.append({"position": _array_vector(landing.position), "normal": _array_vector(landing.normal).normalized(),
			"landed": landing.landed, "splash_radius": float(landing.splash_radius)})
	_acc_kind = StringName(raw.acc_kind)
	_acc_color = _array_color(raw.acc_color)
	_splash_k = int(raw.splash_k)
	_rng.state = int(raw.rng_state)
	_emitted_total = float(raw.emitted_ml)
	_landed_total = float(raw.landed_ml)
	_lost_total = float(raw.lost_ml)
	emitted_ml += _emitted_total
	landed_ml += _landed_total
	lost_ml += _lost_total
	_apply_visual_state()
	set_physics_process(true)
	return true


func _apply_visual_state() -> void:
	_mat.set_shader_parameter("p0", p0)
	_mat.set_shader_parameter("v0", v0)
	_mat.set_shader_parameter("t1", t_land)
	_mat.set_shader_parameter("bead_f", 1.0 / maxf(0.01, t_land * 0.045))
	_mat.set_shader_parameter("q", q)
	_mat.set_shader_parameter("phase", phase)
	_mat.set_shader_parameter("color", color)
	_mat.set_shader_parameter("t0", minf(_stop_t, t_land) if stopping else 0.0)
	_mat.set_shader_parameter("fade", clampf(1.0 - _stop_t / maxf(0.12, t_land), 0.0, 1.0) if stopping else 1.0)
	var lo := p0.min(land_pos)
	var hi := p0.max(land_pos)
	hi.y = maxf(hi.y, p0.y + maxf(v0.y, 0.0) * maxf(v0.y, 0.0) / (2.0 * GRAV))
	custom_aabb = AABB(lo, hi - lo).grow(0.01)
	visible = not stopping or _stop_t < maxf(0.12, t_land)


func can_bind_source(exclude: RID) -> bool:
	return not _source_rid.is_valid() or _source_rid == exclude


func bind_source(exclude: RID) -> bool:
	if not can_bind_source(exclude): return false
	_excl = [exclude]
	_source_rid = exclude
	return true


func retire_for_restore() -> void:
	if finished: return
	emitted_ml -= _emitted_total
	landed_ml -= _landed_total
	lost_ml -= _lost_total
	finished = true
	set_physics_process(false)
	live.erase(self)
	queue_free()


static func _integer(value: Variant) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] and is_finite(float(value)) \
		and floorf(float(value)) == float(value)


static func _number_between(value: Variant, lo: float, hi: float) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] and is_finite(float(value)) and float(value) >= lo and float(value) <= hi


static func _finite_vector_array(value: Variant) -> bool:
	if not value is Array or value.size() != 3: return false
	for number in value:
		if typeof(number) not in [TYPE_INT, TYPE_FLOAT] or not is_finite(float(number)) or absf(float(number)) > 1.0e6: return false
	return true


static func _finite_color_array(value: Variant) -> bool:
	if not value is Array or value.size() != 4: return false
	for component in value:
		if typeof(component) not in [TYPE_INT, TYPE_FLOAT] or not is_finite(float(component)): return false
	var color := Color(float(value[0]), float(value[1]), float(value[2]), float(value[3]))
	return _finite_color(color)


static func _finite_color(value: Color) -> bool:
	return is_finite(value.r) and is_finite(value.g) and is_finite(value.b) and is_finite(value.a)


static func _valid_normal(value: Vector3) -> bool:
	if not value.is_finite(): return false
	var length_sq := value.length_squared()
	# Engine raycast/landing normals are unit vectors. Keeping the serialized
	# contract tight ensures restore normalization cannot change source equality.
	return is_finite(length_sq) and length_sq >= 0.98 and length_sq <= 1.02


static func _valid_kind(value: Variant) -> bool:
	return value is String and String(value) == GSPuddleStore.normalize_kind(StringName(value))


static func _valid_rng_state(value: Variant) -> bool:
	if not value is String or not String(value).is_valid_int(): return false
	return str(String(value).to_int()) == String(value)


static func _vector_array(value: Vector3) -> Array:
	return [value.x, value.y, value.z]


static func _color_array(value: Color) -> Array:
	return [value.r, value.g, value.b, value.a]


static func _array_vector(value: Array) -> Vector3:
	return Vector3(float(value[0]), float(value[1]), float(value[2]))


static func _array_color(value: Array) -> Color:
	return Color(float(value[0]), float(value[1]), float(value[2]), float(value[3]))


## Called by the bottle every physics tick the hole flows. p / v: hole position and exit velocity (world), q_m3s flow, ml this tick.
func feed(p: Vector3, v: Vector3, q_m3s: float, ml: float, col: Color, kind: StringName = &"unknown") -> void:
	var incoming := StringName(GSPuddleStore.normalize_kind(kind))
	var tol := 0.04 + 0.04 * v0.length()
	var path_changed := not _has_path or p.distance_to(p0) > 0.002 or v.distance_to(v0) > tol
	# Previously emitted liquid keeps its old endpoint even when the source moves
	# before the regular flush interval. Capture before changing the cached path.
	if _acc > 0.0 and (incoming != _acc_kind or col != _acc_color or path_changed): _flush_accumulator()
	_acc_kind = incoming
	_acc_color = col
	_last_feed = Engine.get_physics_frames()
	if stopping:
		stopping = false
		_stop_t = 0.0
		visible = true
	emitted_ml += ml
	_emitted_total += ml
	q = q_m3s
	if path_changed:
		_recompute(p, v)
	_acc += ml
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
		_flush_accumulator()
	while _fifo_t.size() > 0 and _fifo_t[0] <= _clock:
		_deposit(_fifo_ml[0], _fifo_kind[0], _fifo_color[0], _fifo_landing[0])
		_fifo_t.remove_at(0)
		_fifo_ml.remove_at(0)
		_fifo_kind.remove_at(0)
		_fifo_color.remove_at(0)
		_fifo_landing.remove_at(0)
	if stopping and _stop_t >= t_land and _fifo_t.is_empty() and _acc <= 0.0:
		_finish()


func _flush_accumulator() -> void:
	if _acc <= 0.0: return
	if _fifo_t.size() >= MAX_BATCHES:
		lost_ml += _acc
		_lost_total += _acc
		_acc = 0.0
		_acc_t = 0.0
		return
	# A later emission can have a shorter fall. Keep all parallel arrays ordered
	# by arrival time so an older long flight cannot block a ready short flight.
	var due := _clock + t_land
	var index := _fifo_t.size()
	while index > 0 and due < _fifo_t[index - 1]: index -= 1
	_fifo_t.insert(index, due)
	_fifo_ml.insert(index, _acc)
	_fifo_kind.insert(index, _acc_kind)
	_fifo_color.insert(index, _acc_color)
	_fifo_landing.insert(index, {"position": land_pos, "normal": land_n, "landed": landed,
		"splash_radius": maxf(radius_at(t_land, phase) * 0.8, 0.0012)})
	_acc = 0.0
	_acc_t = 0.0


func _deposit(ml: float, kind: StringName, captured_color: Color, landing: Dictionary) -> void:
	if not landing.landed:
		lost_ml += ml
		_lost_total += ml
		return
	landed_ml += ml
	_landed_total += ml
	var mgr := GSBottleBreakManager.get_for(self)
	var position: Vector3 = landing.position
	var normal: Vector3 = landing.normal
	_splash_k += 1
	var sml := 0.0
	if _splash_k % 2 == 0 and normal.y > 0.5:
		var rd: float = landing.splash_radius
		var each := minf(ml * 0.1, rd * rd * rd * 4.18879e6)
		for k in 2:
			var dv := Vector3(_rng.randfn(), 0.0, _rng.randfn()) * 0.35 + normal * _rng.randf_range(0.3, 0.8)
			mgr.emit_droplet(position + normal * 0.004, dv, each, captured_color, kind)
			sml += each
	mgr.add_puddle(position, normal, ml - sml, captured_color, kind)


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
		var remainder := in_flight_ml()
		lost_ml += remainder
		_lost_total += remainder
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
