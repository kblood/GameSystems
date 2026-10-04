class_name GlassCrackMask
extends RefCounted
## Per-pane CPU damage mask (RGBA8): R = crack lines, G = frost / delamination, B = hole (discard), A = chip crater.
## Painted into a PackedByteArray with max-blend, uploaded once per frame when dirty (ImageTexture.update).
## Long cracks live here; bullet holes / craters / micro stars are analytic in the shader (descriptor array), so the
## mask can stay coarse (default 384 px/m, HIGH tier) without blurring the hole that sells the bullet.

var w := 0
var h := 0
var size := Vector2.ONE
var data := PackedByteArray()
var img: Image
var tex: ImageTexture
var dirty := false
var mipmaps := true


func setup(size_m: Vector2, px_per_m: float, max_px := 1024, mips := true) -> void:
	size = size_m
	mipmaps = mips
	var s := minf(px_per_m, float(max_px) / maxf(size_m.x, size_m.y))
	w = clampi(int(size_m.x * s), 16, max_px)
	h = clampi(int(size_m.y * s), 16, max_px)
	data = PackedByteArray()
	data.resize(w * h * 4)
	data.fill(0)
	img = Image.create_from_data(w, h, false, Image.FORMAT_RGBA8, data)
	if mipmaps:
		img.generate_mipmaps()
	tex = ImageTexture.create_from_image(img)


func bytes() -> int:
	return w * h * 4 * (4 if mipmaps else 3) / 3   # base + mip chain (~1.33x), CPU copy not counted


func clear() -> void:
	data.fill(0)
	dirty = true


func px_per_m() -> float:
	return w / size.x


func to_px(p: Vector2) -> Vector2:
	return Vector2((p.x / size.x + 0.5) * w, (0.5 - p.y / size.y) * h)


func commit() -> void:
	if not dirty:
		return
	dirty = false
	img.set_data(w, h, false, Image.FORMAT_RGBA8, data)
	if mipmaps:
		img.generate_mipmaps()
	tex.update(img)


func _put(x: int, y: int, ch: int, v: float) -> void:
	if x < 0 or y < 0 or x >= w or y >= h:
		return
	var i := (y * w + x) * 4 + ch
	var b := int(clampf(v, 0.0, 1.0) * 255.0)
	if b > data[i]:
		data[i] = b


## Anti-aliased thick line (pane metres in, width in px), value fades a->b.
func line(a: Vector2, b: Vector2, width_px: float, va: float, vb: float, ch := 0) -> void:
	var pa := to_px(a)
	var pb := to_px(b)
	var d := pb - pa
	var L2 := d.length_squared()
	if L2 < 1e-4:
		return
	var hw := width_px * 0.5
	var reach := hw + 0.5
	# walk the major axis once; per column / row fill only the span the thick line covers (each pixel visited ~once)
	var xmajor := absf(d.x) >= absf(d.y)
	var dm := d.x if xmajor else d.y
	var am := pa.x if xmajor else pa.y
	var bm := pb.x if xmajor else pb.y
	var span := reach * sqrt(L2) / absf(dm) + 0.5
	var lo := int(floor(minf(am, bm) - reach))
	var hi := int(ceil(maxf(am, bm) + reach))
	var lim_m := w if xmajor else h
	var lim_n := h if xmajor else w
	for m in range(maxi(lo, 0), mini(hi, lim_m - 1) + 1):
		var tc := clampf((m + 0.5 - am) / dm, 0.0, 1.0)
		var cn := (pa.y + d.y * tc) if xmajor else (pa.x + d.x * tc)
		for n in range(maxi(int(cn - span), 0), mini(int(cn + span), lim_n - 1) + 1):
			var px := Vector2(m + 0.5, n + 0.5) if xmajor else Vector2(n + 0.5, m + 0.5)
			var t := clampf((px - pa).dot(d) / L2, 0.0, 1.0)
			var dist := px.distance_to(pa + d * t)
			var cov := reach - dist
			if cov <= 0.0:
				continue
			var i := ((n * w + m) if xmajor else (m * w + n)) * 4 + ch
			var bv := int(clampf(lerpf(va, vb, t) * minf(cov, 1.0), 0.0, 1.0) * 255.0)
			if bv > data[i]:
				data[i] = bv
	dirty = true


## Polyline with tapering value; adds a 1-px jitter between points so straight segments read as cracks.
func polyline(pts: PackedVector2Array, width_px: float, v0: float, v1: float, rng: RandomNumberGenerator, ch := 0) -> void:
	var n := pts.size()
	if n < 2:
		return
	var jit := 0.8 / px_per_m()
	var prev := pts[0]
	for i in range(1, n):
		var f0 := float(i - 1) / (n - 1)
		var f1 := float(i) / (n - 1)
		var a := pts[i - 1]
		var b := pts[i]
		var segs := maxi(1, int(a.distance_to(b) * px_per_m() / 10.0))
		for s in segs:
			var t1 := float(s + 1) / segs
			var q := a.lerp(b, t1)
			if s < segs - 1:
				q += Vector2(rng.randf_range(-jit, jit), rng.randf_range(-jit, jit))
			var g0 := lerpf(f0, f1, float(s) / segs)
			var g1 := lerpf(f0, f1, t1)
			line(prev, q, lerpf(width_px, width_px * 0.55, g1), lerpf(v0, v1, g0), lerpf(v0, v1, g1), ch)
			prev = q


func disc(c: Vector2, r_m: float, v: float, ch: int, soft := 0.5, noise_rng: RandomNumberGenerator = null) -> void:
	var pc := to_px(c)
	var rp := r_m * px_per_m()
	var R := int(ceil(rp + 1.0))
	for oy in range(-R, R + 1):
		for ox in range(-R, R + 1):
			var d := Vector2(ox, oy).length() / maxf(rp, 0.5)
			if d > 1.0:
				continue
			var val := v * clampf((1.0 - d) / maxf(soft, 0.01), 0.0, 1.0)
			if noise_rng:
				val *= noise_rng.randf_range(0.55, 1.0)
			_put(int(pc.x) + ox, int(pc.y) + oy, ch, val)
	dirty = true


## Scanline polygon fill (hole mask for punched laminated / wired glass).
func fill_poly(poly: PackedVector2Array, v: float, ch := 2) -> void:
	var P := PackedVector2Array()
	var ymin := INF
	var ymax := -INF
	for p in poly:
		var q := to_px(p)
		P.append(q)
		ymin = minf(ymin, q.y)
		ymax = maxf(ymax, q.y)
	for y in range(maxi(0, int(ymin)), mini(h, int(ymax) + 1)):
		var yc := y + 0.5
		var xs: Array[float] = []
		for i in P.size():
			var a := P[i]
			var b := P[(i + 1) % P.size()]
			if (a.y <= yc and b.y > yc) or (b.y <= yc and a.y > yc):
				xs.append(a.x + (yc - a.y) / (b.y - a.y) * (b.x - a.x))
		xs.sort()
		for k in range(0, xs.size() - 1, 2):
			for x in range(maxi(0, int(xs[k])), mini(w, int(xs[k + 1]) + 1)):
				_put(x, y, ch, v)
	dirty = true
