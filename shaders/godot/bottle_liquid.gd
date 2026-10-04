class_name BottleLiquid
extends Node
## Drives the bottle_*.glb liquid. Add as a child of the bottle root (or call setup()), then set `fill` (0..1).
## Volume-preserving: the plane offset comes from a LiquidLutV2 table (v2 sphere_map or v1 lathe table, same code path).
## Data order: explicit `sidecar_json` -> `<glb>.liquid_v2.json` -> `<glb>.liquid.json` next to the GLB -> GLB extras.liquid.
## Open containers (info.open, `cap_open`, or the Cap node removed/hidden) clamp the level at the rim via lut.spill().
## Sleep: a resting bottle (no motion, slosh settled, no fizz) turns process off; a 10 Hz poll Timer wakes it.
## Works at any tilt (sideways, upside down). `slosh` adds a damped spring lag + acceleration kick.
## Bubbles rise in a "flow frame" whose y axis is world up; it is parallel-transported here every frame so the
## bubble field never jumps, at any tilt. Foam builds from agitation (scaled by extras `foam`) and settles slowly.
## Pour support (BottlePour): capacity_ml(), mouth_centre/mouth_radius/mouth_axis (node space, from rim_points or the
## Liquid mesh top), set_liquid_color() (survives setup()), agitate(), signal `woke` (emitted when leaving sleep).

signal woke
signal opened                           ## cap_open set true (BottlePour listens: an awake but closed bottle is not polled)

@export_range(0.0, 1.0) var fill := 0.6:
	set(v):
		fill = v
		wake()
@export var slosh := true:
	set(v):
		slosh = v
		wake()
@export_range(0.0, 1.0) var bubbles := 1.0:   ## scales bubbles + foam (0 = off)
	set(v):
		bubbles = v
		wake()
@export var carbonation := -1.0:             ## -1 = use the value baked into the GLB (soda/beer fizz)
	set(v):
		carbonation = v
		wake()
## Force the opening live (cap removed / uncapped). Default false: capped bottles never spill. Open containers
## (info.open) and a removed/hidden `Cap` node are detected automatically.
@export var cap_open := false:
	set(v):
		cap_open = v
		wake()
		if v:
			opened.emit()
## Table tier for containers that ship .liquid.mid/.low.json: -1 = from `quality` at setup (3 high, 2 mid, <=1 low),
## 0 high, 1 mid, 2 low. Lookup cost is identical for all tiers (only memory/accuracy differ), so distance LOD does not swap tables.
@export var table_tier := -1
@export var allow_sleep := true
@export var foam_capacity := -1.0            ## -1 = use extras `foam` (how much head a shake makes, 0..1)
@export var foam_settle := 0.18              ## foam decay rate (1/s)
## Realism tier: 3 HIGH, 2 MEDIUM, 1 LOW, 0 MINIMAL (see bottle_liquid.gdshader). With auto_lod the tier used is
## min(quality, tier_for_distance(camera distance)), so far bottles drop tiers automatically.
@export_range(0, 3) var quality := 3:
	set(v):
		quality = v
		wake()
@export var auto_lod := true
@export var lod_distances := Vector3(0.9, 2.5, 6.0)   ## metres: beyond x -> MEDIUM, beyond y -> LOW, beyond z -> MINIMAL
@export var liquid_shader: Shader = preload("res://bottle_liquid.gdshader")
@export var glass_shader: Shader = preload("res://bottle_glass.gdshader")

var liquid: MeshInstance3D
var _info: Dictionary
var _mat: ShaderMaterial
var _up_eff := Vector3.UP
var _vel := Vector3.ZERO
var _last_pos := Vector3.ZERO
var _last_vel := Vector3.ZERO
var _first := true
var _kick := 0.0
var _agit := 0.0
var _foam := 0.0
var _rise := 0.0
var _flow := Basis.IDENTITY      # columns = flow axes in liquid object space, y = world up
var _flow_up := Vector3.UP
var _foam_h := 0.022
var _tier := -1
var lut: LiquidLutV2                 ## the decoder (v1 and v2 tables)
## Set by BottlePour: the stored fill is drained for real, so draw the true volume (lut.offset) instead of the
## visual-only rim clamp (lut.spill, which shows an inverted open bottle as empty).
var drain_driven := false
var last_spill := {"d": 0.0, "fill": 0.0, "spilled": false, "lost": 0.0}   ## result of the last spill() (open containers)
var _cap: Node3D
var _glb_base := ""
var _sleeping := false
var _poll: Timer
var _last_basis := Basis.IDENTITY
var _app_fill := -1.0
var _app_open := false
var _memo_up := Vector3(9, 9, 9)
var _memo_fill := -1.0
var _memo_open := false
var _foam_scale := 1.0
var _stable_frames := 0
var _glass_mats: Array[ShaderMaterial] = []
var color_override := Color(0, 0, 0, 0)  ## alpha > 0: replaces the sidecar colour (set by set_liquid_color, e.g. a filled receiver)
var mouth_centre := Vector3.ZERO          ## opening disc in liquid-node space (rim_points, else top of the Liquid mesh)
var mouth_radius := 0.0
var mouth_axis := Vector3.UP

enum { MINIMAL, LOW, MEDIUM, HIGH }


## Tier for a bottle `dist` metres from the camera. `current` adds 10 % hysteresis so the tier does not flicker.
static func tier_for_distance(dist: float, cuts := Vector3(0.9, 2.5, 6.0), current := -1) -> int:
	var t := HIGH
	for i in 3:
		var c: float = cuts[i]
		if current >= 0 and current <= HIGH - 1 - i:   # already beyond this cut -> must come 10 % closer to go back up
			c *= 0.9
		if dist > c:
			t = HIGH - 1 - i
	return t


## The tier actually rendered (after distance LOD).
func current_tier() -> int:
	return _tier


func setup(root: Node, fill_: float = 0.6, sidecar_json := "") -> void:
	fill = fill_
	for n in root.find_children("Liquid*", "MeshInstance3D", true, false):
		liquid = n
		break
	assert(liquid != null, "no Liquid mesh under %s" % root.name)
	_glb_base = _glb_path(root, liquid).get_basename()
	_info = _read_info(liquid, sidecar_json)
	lut = LiquidLutV2.from_info(_info)
	_cap = null
	for cn in root.find_children("Cap*", "Node3D", true, false):
		_cap = cn
		break
	_mat = ShaderMaterial.new()
	_mat.shader = liquid_shader
	_apply_color()
	_compute_mouth()
	var bnd: Dictionary = _info.get("bounds", {})
	var z0 := float(_info.get("z0", bnd["min"][1] if bnd.has("min") else 0.0))
	var z1 := float(_info.get("z1", bnd["max"][1] if bnd.has("max") else 0.2))
	_mat.set_shader_parameter("base_y", z0)
	_mat.set_shader_parameter("flow_pivot", Vector3(0.0, lerpf(z0, z1, 0.4), 0.0))
	_mat.set_shader_parameter("bubble_size", float(_info.get("bubble_size", 1.0)))
	_foam_h = float(_info.get("foam_height", 0.022))
	_mat.set_shader_parameter("foam_height", _foam_h)
	_mat.set_shader_parameter("flip_faces", _signed_volume(liquid.mesh) < 0.0)
	liquid.material_override = _mat
	_setup_glass(root)
	if _poll == null:
		_poll = Timer.new()
		_poll.wait_time = 0.1
		_poll.one_shot = false
		_poll.timeout.connect(_on_poll)
		add_child(_poll)
	_sleeping = false
	_memo_fill = -1.0
	_first = true
	_apply(0.0)
	set_process(true)


## Signed volume of the closed Liquid mesh (Godot winding: > 0 when the faces point outward). A mesh exported with
## inverted winding would make the shader treat the wall as the surface, so it is detected here once.
static func _signed_volume(m: Mesh) -> float:
	var v := 0.0
	for s in m.get_surface_count():
		var arr := m.surface_get_arrays(s)
		var p: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
		var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
		if idx.is_empty():
			for i in range(0, p.size() - 2, 3):
				v += p[i].dot(p[i + 1].cross(p[i + 2]))
		else:
			for i in range(0, idx.size() - 2, 3):
				v += p[idx[i]].dot(p[idx[i + 1]].cross(p[idx[i + 2]]))
	return -v / 6.0


## Current liquid colour (override if set, else the sidecar colour).
func liquid_color() -> Color:
	if color_override.a > 0.0:
		return Color(color_override.r, color_override.g, color_override.b)
	var c: Array = _info.get("color", [0.5, 0.5, 0.5])
	return Color(c[0], c[1], c[2])


## Recolour the liquid (kept across setup() / tier swaps). Mixing is not done here (see docs/pour_system.md).
func set_liquid_color(c: Color) -> void:
	color_override = Color(c.r, c.g, c.b, 1.0)
	if _mat:
		_apply_color()


func _apply_color() -> void:
	var c := liquid_color()
	_mat.set_shader_parameter("liquid_color", c)
	_mat.set_shader_parameter("surface_color", c.lightened(0.12))


## Interior volume in ml from the liquid sidecar (v2 tables carry the mesh-verified value).
func capacity_ml() -> float:
	return float(_info.get("capacity_ml", _info.get("v1_capacity_ml", 500.0)))


## A slosh kick from outside (liquid poured in). Wakes the controller.
func agitate(amount: float) -> void:
	wake()
	_kick = minf(1.0, _kick + amount)
	_agit = minf(1.0, maxf(_agit, amount))


## Opening disc: from rim_points (containers) or, for bottles without them, the ring of Liquid-mesh vertices within 3 mm
## of the top. Also gives the LUT rim points so lut.spill() clamps uncapped bottles at their mouth. One pass at setup.
func _compute_mouth() -> void:
	mouth_axis = Vector3.UP
	if not lut.rim.is_empty():
		var cs := Vector3.ZERO
		for p in lut.rim:
			cs += p
		cs /= lut.rim.size()
		var rs := 0.0
		for p in lut.rim:
			rs += Vector2(p.x - cs.x, p.z - cs.z).length()
		mouth_centre = cs
		mouth_radius = rs / lut.rim.size()
		return
	var ymax := -INF
	var pts := PackedVector3Array()
	for s in liquid.mesh.get_surface_count():
		pts.append_array(liquid.mesh.surface_get_arrays(s)[Mesh.ARRAY_VERTEX])
	for p in pts:
		ymax = maxf(ymax, p.y)
	var cx := 0.0
	var cz := 0.0
	var k := 0
	for p in pts:
		if p.y > ymax - 0.003:
			cx += p.x
			cz += p.z
			k += 1
	cx /= maxi(k, 1)
	cz /= maxi(k, 1)
	var r := 0.0
	for p in pts:
		if p.y > ymax - 0.003:
			r = maxf(r, Vector2(p.x - cx, p.z - cz).length())
	mouth_centre = Vector3(cx, ymax, cz)
	mouth_radius = maxf(r, 0.004)
	for i in 16:
		var a := TAU * i / 16.0
		lut.rim.append(mouth_centre + Vector3(cos(a), 0.0, sin(a)) * mouth_radius)


func _setup_glass(root: Node) -> void:
	for n in root.find_children("Glass*", "MeshInstance3D", true, false):
		var g := n as MeshInstance3D
		var tint := Color(0.85, 0.95, 0.95)
		var src := g.get_active_material(0)
		if src is BaseMaterial3D:
			tint = (src as BaseMaterial3D).albedo_color
		var gm := ShaderMaterial.new()
		gm.shader = glass_shader
		gm.set_shader_parameter("tint", tint)
		g.material_override = gm
		_glass_mats.append(gm)
		g.sorting_offset = 1.0   # draw after the liquid


static func _glb_path(root: Node, mesh: Node) -> String:
	for n in [root, mesh.owner, mesh]:
		if n != null and n.scene_file_path != "":
			return n.scene_file_path
	return ""


func _load_json(path: String) -> Dictionary:
	if path == "" or not FileAccess.file_exists(path):
		return {}
	var v = JSON.parse_string(FileAccess.get_file_as_string(path))
	return v if v is Dictionary else {}


## Order: explicit sidecar -> <glb>.liquid_v2.json -> <glb>.liquid.json (mid/low tier first if asked) -> GLB extras.liquid.
func _read_info(mesh: MeshInstance3D, sidecar_json: String) -> Dictionary:
	var d := _load_json(sidecar_json)
	if d.is_empty() and _glb_base != "":
		d = _load_json(_glb_base + ".liquid_v2.json")
		if d.is_empty():
			var t := table_tier if table_tier >= 0 else (0 if quality >= 3 else (1 if quality == 2 else 2))
			if t > 0:
				d = _load_json(_glb_base + (".liquid.mid.json" if t == 1 else ".liquid.low.json"))
			if d.is_empty():
				d = _load_json(_glb_base + ".liquid.json")
	if not d.is_empty():
		return d
	if mesh.has_meta("extras"):
		var ex = mesh.get_meta("extras")
		if ex is Dictionary and ex.has("liquid"):
			var v = ex["liquid"]
			return JSON.parse_string(v) if v is String else v
	push_error("BottleLiquid: no liquid table for %s (extras.liquid missing; pass a .liquid.json sidecar)" % mesh.name)
	return {}


static func lut_offset(lut: Array, n_cos: int, n_fill: int, c: float, f: float) -> float:
	var x := (clampf(c, -1.0, 1.0) * 0.5 + 0.5) * (n_cos - 1)
	var y := clampf(f, 0.0, 1.0) * (n_fill - 1)
	var x0 := mini(n_cos - 2, int(floor(x)))
	var y0 := mini(n_fill - 2, int(floor(y)))
	var fx := x - x0
	var fy := y - y0
	var a: float = lerpf(lut[x0][y0], lut[x0][y0 + 1], fy)
	var b: float = lerpf(lut[x0 + 1][y0], lut[x0 + 1][y0 + 1], fy)
	return lerpf(a, b, fx)


func _process(delta: float) -> void:
	if liquid:
		_apply(delta)
		if allow_sleep and _at_rest():
			_sleep()


## Wake from sleep (automatic on property changes and on movement; call it yourself after swapping the table etc.).
func wake() -> void:
	if not _sleeping:
		return
	_sleeping = false
	_first = true
	_last_vel = Vector3.ZERO
	if _poll:
		_poll.stop()
	set_process(true)
	woke.emit()


func is_sleeping() -> bool:
	return _sleeping


## True when the container is currently treated as open: info.open, `cap_open`, or the Cap node removed/hidden.
func is_open() -> bool:
	if _info.get("open", false) or cap_open:
		return true
	if _info.get("closed_by", null) != null and (_cap == null or not is_instance_valid(_cap) or not _cap.is_visible_in_tree()):
		return true
	return false


func _at_rest() -> bool:
	var carb := float(_info.get("carbonation", 0.0)) if carbonation < 0.0 else carbonation
	if carb * bubbles > 0.001:
		return false   # fizz animates with `rise`: keep running
	if _agit > 0.001 or _foam > 0.004 or _kick > 0.001:
		return false
	if slosh and (_vel.length() > 0.002 or (_up_eff - Vector3.UP).length() > 0.0002):
		return false
	return _stable_frames >= 3


func _sleep() -> void:
	_agit = 0.0
	_foam = 0.0
	_kick = 0.0
	_vel = Vector3.ZERO
	_up_eff = Vector3.UP
	_mat.set_shader_parameter("ripple", 0.0)
	_mat.set_shader_parameter("foam", 0.0)
	_mat.set_shader_parameter("agitation", 0.0)
	_mat.set_shader_parameter("up_world", Vector3.UP)
	_sleeping = true
	set_process(false)
	_poll.start()


func _on_poll() -> void:
	if not is_instance_valid(liquid) or not liquid.is_inside_tree():
		return
	var gt := liquid.global_transform
	if gt.origin.distance_squared_to(_last_pos) > 1e-12 or not gt.basis.is_equal_approx(_last_basis) \
			or is_open() != _app_open or absf(fill - _app_fill) > 1e-7:
		wake()
		return
	_update_tier()


func _apply(delta: float) -> void:
	delta = clampf(delta, 1.0 / 240.0, 1.0 / 30.0)
	var pos := liquid.global_position
	if _first:
		_last_pos = pos
		_first = false
	var gb := liquid.global_transform.basis
	var still := pos.is_equal_approx(_last_pos) and gb.is_equal_approx(_last_basis) and absf(fill - _app_fill) < 1e-7
	_stable_frames = _stable_frames + 1 if still else 0
	_last_basis = gb
	_app_fill = fill
	var vel := (pos - _last_pos) / delta
	var acc := (vel - _last_vel) / delta
	_last_pos = pos
	_last_vel = vel
	var target := Vector3.UP
	if slosh:
		target = (Vector3.UP - acc * (0.06 / 9.81) - vel * 0.01).normalized()
		_vel += (target - _up_eff) * 160.0 * delta
		_vel *= maxf(0.0, 1.0 - 5.5 * delta)
		_up_eff = (_up_eff + _vel * delta).normalized()
		_kick = minf(1.0, _kick * maxf(0.0, 1.0 - 2.5 * delta) + _vel.length() * 0.15)
		_agit = minf(1.0, maxf(_agit * maxf(0.0, 1.0 - 1.0 * delta), _vel.length() * 0.5))
	else:
		_up_eff = target
	var up_obj := (liquid.global_transform.basis.orthonormalized().inverse() * _up_eff).normalized()
	var open := is_open()
	_app_open = open
	if open != _memo_open or fill != _memo_fill or absf(up_obj.x - _memo_up.x) + absf(up_obj.y - _memo_up.y) + absf(up_obj.z - _memo_up.z) > 1e-7:
		_memo_up = up_obj
		_memo_fill = fill
		_memo_open = open
		var d: float
		if open and not drain_driven:
			last_spill = lut.spill(up_obj, fill)
			d = last_spill["d"]
		else:
			d = lut.offset(up_obj, fill)
			last_spill = {"d": d, "fill": fill, "spilled": false, "lost": 0.0}
		_mat.set_shader_parameter("plane", Vector4(up_obj.x, up_obj.y, up_obj.z, d))
		# the head keeps its volume: thickness ~ 1 / surface area. Area = dV/d(offset), read from the same LUT.
		var f0 := clampf(fill, 0.05, 0.95)
		var dd := lut.offset(up_obj, f0 + 0.04) - lut.offset(up_obj, f0 - 0.04)
		var dd_up := lut.offset(Vector3.UP, f0 + 0.04) - lut.offset(Vector3.UP, f0 - 0.04)
		_foam_scale = clampf(dd / maxf(dd_up, 1e-5), 0.2, 1.5)
		_mat.set_shader_parameter("foam_height", _foam_h * _foam_scale)
	_mat.set_shader_parameter("up_world", _up_eff)
	_mat.set_shader_parameter("ripple", _kick)
	# flow frame: rotate by the minimal arc from last frame's up to this frame's (never flips, no singularity)
	if _flow_up.dot(up_obj) < 0.9999:
		_flow = Basis(Quaternion(_flow_up, up_obj)) * _flow
	_flow_up = up_obj
	var fx := (_flow.x - up_obj * _flow.x.dot(up_obj)).normalized()
	_flow = Basis(fx, up_obj, fx.cross(up_obj))
	_mat.set_shader_parameter("flow_basis", _flow)
	_rise = fposmod(_rise + delta, 600.0)
	_mat.set_shader_parameter("rise", _rise)
	var cap := float(_info.get("foam", 0.0)) if foam_capacity < 0.0 else foam_capacity
	var ft := _agit * cap
	_foam = minf(ft, _foam + 4.0 * delta) if ft > _foam else _foam * maxf(0.0, 1.0 - foam_settle * delta)
	_mat.set_shader_parameter("foam", _foam)
	_mat.set_shader_parameter("agitation", _agit)
	_mat.set_shader_parameter("carbonation", float(_info.get("carbonation", 0.0)) if carbonation < 0.0 else carbonation)
	_mat.set_shader_parameter("bubble_scale", bubbles)
	_update_tier()


func _update_tier() -> void:
	var t := quality
	if auto_lod:
		var cam := liquid.get_viewport().get_camera_3d() if liquid.is_inside_tree() else null
		if cam:
			t = mini(quality, tier_for_distance(cam.global_position.distance_to(liquid.global_position), lod_distances, _tier))
	if t != _tier:
		_tier = t
		_mat.set_shader_parameter("quality", t)
		for gm in _glass_mats:
			gm.set_shader_parameter("quality", t)
