class_name LiquidLutV2
extends RefCounted
## Liquid fill table lookup: version 2 ("sphere_map") with a version 1 ("axis table") fallback.
## Spec: docs/liquid_lut_v2.md. Gameplay agnostic, depends on nothing else.
##
##   var info: Dictionary = JSON.parse_string(sidecar_json_text)      # or the Liquid node's extras["liquid"] (JSON string)
##   var lut := LiquidLutV2.from_info(info)
##   var d := lut.offset(up_obj, fill)       # plane dot(p_obj, up_obj) = d keeps `fill` of the interior below it
##   var f := lut.fill_at(up_obj, d)         # inverse
##   var s := lut.spill(up_obj, fill)        # {d, fill, spilled, lost}: level clamped at the lowest rim point
## up_obj = world up in the node's local space: (node.global_transform.basis.orthonormalized().inverse() * Vector3.UP).
## Uniform scale assumed (divide d by the scale otherwise).

var version := 2
var n := 0                      # directions per axis (v2) / n_cos (v1)
var nf := 0                     # fill samples
var t := PackedFloat32Array()   # v2: [v][u][k] residual offsets, metres
var centre := Vector3.ZERO
var rim: Array = []             # rim_points (Vector3), may be empty
var info: Dictionary = {}
var _v1: Array = []



static func from_info(p_info: Dictionary) -> LiquidLutV2:
	var l := LiquidLutV2.new()
	l.info = p_info
	l.version = int(p_info.get("version", 1))
	for p in p_info.get("rim_points", []):
		l.rim.append(Vector3(p[0], p[1], p[2]))
	if l.version == 2:
		assert(p_info.get("kind", "") == "sphere_map")
		l.n = int(p_info["n_dir"])
		l.nf = int(p_info["n_fill"])
		var c: Array = p_info.get("centre", [0, 0, 0])
		l.centre = Vector3(c[0], c[1], c[2])
		var raw := Marshalls.base64_to_raw(p_info["data"])
		var cnt := l.n * l.n * l.nf
		assert(raw.size() >= cnt * 2)
		l.t.resize(cnt)
		var d0: float = p_info["d_min"]
		var sc: float = (float(p_info["d_max"]) - d0) / 65535.0
		for i in cnt:
			l.t[i] = d0 + raw.decode_u16(i * 2) * sc
	else:
		l.n = int(p_info["n_cos"])
		l.nf = int(p_info["n_fill"])
		l._v1 = p_info["lut"]
	return l


static func oct_encode(d: Vector3) -> Vector2:
	## unit direction -> octahedral map coords in [0,1]; fold axis +Y (upright = centre).
	var l := absf(d.x) + absf(d.y) + absf(d.z)
	var a := d.x / l
	var b := d.z / l
	if d.y < 0.0:
		var a2 := (1.0 - absf(b)) * (1.0 if d.x >= 0.0 else -1.0)
		var b2 := (1.0 - absf(a)) * (1.0 if d.z >= 0.0 else -1.0)
		a = a2
		b = b2
	return Vector2(a * 0.5 + 0.5, b * 0.5 + 0.5)


static func oct_decode(uv: Vector2) -> Vector3:
	var a := uv.x * 2.0 - 1.0
	var b := uv.y * 2.0 - 1.0
	var y := 1.0 - absf(a) - absf(b)
	if y < 0.0:
		var a2 := (1.0 - absf(b)) * (1.0 if a >= 0.0 else -1.0)
		var b2 := (1.0 - absf(a)) * (1.0 if b >= 0.0 else -1.0)
		a = a2
		b = b2
	return Vector3(a, y, b).normalized()


static func _cr(x: float) -> Array:
	var x2 := x * x
	var x3 := x2 * x
	return [(-x3 + 2.0 * x2 - x) * 0.5, (3.0 * x3 - 5.0 * x2 + 2.0) * 0.5, (-3.0 * x3 + 4.0 * x2 + x) * 0.5, (x3 - x2) * 0.5]


## 16 Catmull-Rom taps: returns [PackedInt32Array indices (v*n+u), PackedFloat32Array weights].
func _taps(up: Vector3) -> Array:
	var uv := oct_encode(up.normalized())
	var x := clampf(uv.x, 0.0, 1.0) * (n - 1)
	var y := clampf(uv.y, 0.0, 1.0) * (n - 1)
	var x0 := mini(int(floor(x)), n - 2)
	var y0 := mini(int(floor(y)), n - 2)
	var wx := _cr(x - x0)
	var wy := _cr(y - y0)
	var ix := PackedInt32Array()
	var w := PackedFloat32Array()
	ix.resize(16)
	w.resize(16)
	var k := 0
	for b in 4:
		for a in 4:
			var i := x0 + a - 1
			var j := y0 + b - 1
			if i < 0:
				i = -i
				j = n - 1 - j
			if i > n - 1:
				i = 2 * (n - 1) - i
				j = n - 1 - j
			if j < 0:
				j = -j
				i = n - 1 - i
			if j > n - 1:
				j = 2 * (n - 1) - j
				i = n - 1 - i
			ix[k] = j * n + i
			w[k] = wx[a] * wy[b]
			k += 1
	return [ix, w]


var _cu := Vector3.ZERO
var _cf := -1.0
var _cd := 0.0


func offset(up: Vector3, fill: float) -> float:
	# memo: a resting container (same orientation + fill) costs one compare
	if _cf >= 0.0 and absf(_cu.x - up.x) + absf(_cu.y - up.y) + absf(_cu.z - up.z) + absf(_cf - fill) < 1e-7:
		return _cd
	_cd = _offset(up, fill)
	_cu = up
	_cf = fill
	return _cd


func _offset(up: Vector3, fill: float) -> float:
	if version != 2:
		return _offset_v1(up, fill)
	var f := clampf(fill, 0.0, 1.0)
	var tt := acos(1.0 - 2.0 * f) / PI * (nf - 1)
	var k0 := mini(int(floor(tt)), nf - 2)
	var ft := tt - k0
	var tp := _taps(up)
	var ix: PackedInt32Array = tp[0]
	var w: PackedFloat32Array = tp[1]
	var acc := 0.0
	for k in 16:
		var o := ix[k] * nf + k0
		acc += w[k] * (t[o] * (1.0 - ft) + t[o + 1] * ft)
	return acc + up.normalized().dot(centre)


func fill_at(up: Vector3, d: float) -> float:
	if version != 2:
		var lo := 0.0
		var hi := 1.0
		for i in 30:
			var m := (lo + hi) * 0.5
			if _offset_v1(up, m) < d:
				lo = m
			else:
				hi = m
		return (lo + hi) * 0.5
	var tp := _taps(up)
	var ix: PackedInt32Array = tp[0]
	var w: PackedFloat32Array = tp[1]
	var row := PackedFloat32Array()
	row.resize(nf)
	for k in 16:
		var o := ix[k] * nf
		for q in nf:
			row[q] += w[k] * t[o + q]
	var dd := d - up.normalized().dot(centre)
	var c := 0
	for q in nf:
		if row[q] <= dd:
			c += 1
	var k0 := clampi(c - 1, 0, nf - 2)
	var a := row[k0]
	var b := row[k0 + 1]
	var ft := clampf((dd - a) / maxf(b - a, 1e-12), 0.0, 1.0)
	return 0.5 - 0.5 * cos(PI * (k0 + ft) / (nf - 1))


## Open container / uncapped opening: clamp the level at the lowest rim point.
## Returns {d, fill, spilled, lost}; `lost` is the fill fraction that ran out compared to the request.
func spill(up: Vector3, fill: float, rim_points: Array = []) -> Dictionary:
	var rp := rim_points if not rim_points.is_empty() else rim
	var d := offset(up, fill)
	if rp.is_empty():
		return {"d": d, "fill": fill, "spilled": false, "lost": 0.0}
	var u := up.normalized()
	var dr := INF
	for p in rp:
		dr = minf(dr, (p as Vector3).dot(u))
	if d <= dr:
		return {"d": d, "fill": fill, "spilled": false, "lost": 0.0}
	var f2 := minf(fill, fill_at(up, dr))
	return {"d": dr, "fill": f2, "spilled": true, "lost": fill - f2}


func _offset_v1(up: Vector3, fill: float) -> float:
	var c := clampf(up.normalized().y, -1.0, 1.0)
	var x := (c * 0.5 + 0.5) * (n - 1)
	var y := clampf(fill, 0.0, 1.0) * (nf - 1)
	var x0 := mini(n - 2, int(floor(x)))
	var y0 := mini(nf - 2, int(floor(y)))
	var fx := x - x0
	var fy := y - y0
	var a: float = lerpf(_v1[x0][y0], _v1[x0][y0 + 1], fy)
	var b: float = lerpf(_v1[x0 + 1][y0], _v1[x0 + 1][y0 + 1], fy)
	return lerpf(a, b, fx)
