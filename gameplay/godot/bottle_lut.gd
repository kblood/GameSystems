class_name BottleLut
extends RefCounted
## Read-only wrapper around the baked liquid LUT, for the break system (leaks, neck spills).
## Two formats:
##   v1 axis table  (extras.liquid / bottle_*.liquid.json with "lut"): lut[cos_tilt][fill] = plane offset d
##   v2 sphere_map  (containers, LUT v2 sidecars): delegated to LiquidLutV2 (full 3D up vector, non-axisymmetric shapes)
## liquid = { p : dot(p, up_obj) <= d } in bottle-local space. `up` arguments accept a Vector3 (object-space up, exact
## for both formats) or a float cos tilt (old call sites; v2 then assumes the tilt is around the local Z axis).

var info: Dictionary
var lut: Array
var v2: LiquidLutV2          ## non-null for sphere_map sidecars
var n_cos := 33
var n_fill := 64
var capacity_ml := 500.0
var color := Color(0.8, 0.5, 0.1)


static func from_model(root: Node, sidecar_json := "") -> BottleLut:
	var l := BottleLut.new()
	var d := {}
	for n in root.find_children("Liquid*", "MeshInstance3D", true, false):
		if n.has_meta("extras"):
			var ex = n.get_meta("extras")
			if ex is Dictionary and ex.has("liquid"):
				var v = ex["liquid"]
				d = JSON.parse_string(v) if v is String else v
		break
	if d.is_empty() and sidecar_json != "" and FileAccess.file_exists(sidecar_json):
		d = JSON.parse_string(FileAccess.get_file_as_string(sidecar_json))
	if d.is_empty():
		push_error("BottleLut: no liquid info for %s" % root.name)
		return l
	l.info = d
	l.capacity_ml = float(d.get("capacity_ml", 500.0))
	var c: Array = d.get("color", [0.8, 0.5, 0.1])
	l.color = Color(c[0], c[1], c[2], 0.9)
	if int(d.get("version", 1)) == 2 and String(d.get("kind", "")) == "sphere_map":
		l.v2 = LiquidLutV2.from_info(d)
		return l
	l.lut = d["lut"]
	l.n_cos = int(d["n_cos"])
	l.n_fill = int(d["n_fill"])
	return l


static func _up(u) -> Vector3:
	if u is Vector3:
		return (u as Vector3).normalized()
	var c := clampf(float(u), -1.0, 1.0)
	return Vector3(sqrt(1.0 - c * c), c, 0.0)


## Plane offset for an up vector (object space; Vector3 or cos tilt) and fill 0..1.
func offset(up, f: float) -> float:
	if v2:
		return v2.offset(_up(up), f)
	return BottleLiquid.lut_offset(lut, n_cos, n_fill, _up(up).y, f)


## Inverse: the fill whose plane offset is d at this orientation.
func fill_for_offset(up, d: float) -> float:
	if v2:
		return clampf(v2.fill_at(_up(up), d), 0.0, 1.0)
	if d >= offset(up, 1.0):
		return 1.0
	if d <= offset(up, 0.0):
		return 0.0
	var lo := 0.0
	var hi := 1.0
	for i in 14:
		var mid := 0.5 * (lo + hi)
		if offset(up, mid) < d:
			lo = mid
		else:
			hi = mid
	return 0.5 * (lo + hi)


## Largest fill whose liquid stays below a horizontal-ring rim (centre height open_z, radius rim_r).
## up_obj = world up expressed in bottle space. Everything above the lowest rim point spills.
func max_fill_below_rim(up_obj: Vector3, open_z: float, rim_r: float) -> float:
	var d_rim := up_obj.y * open_z - rim_r * sqrt(up_obj.x * up_obj.x + up_obj.z * up_obj.z)
	return fill_for_offset(up_obj, d_rim)


## Fill below which a point (bottle space) is no longer submerged at this tilt; 1.0 if never.
func fill_at_point(up_obj: Vector3, p: Vector3) -> float:
	return fill_for_offset(up_obj, p.dot(up_obj))
