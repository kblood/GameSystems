class_name GlassFracture
extends RefCounted
## 2D fracture patterns in pane space (metres, origin = pane centre, +x right, +y up) and slab mesh building.
## radial_pattern(): radial cracks from the impact + geometric concentric rings (annealed / laminated cobweb).
## cells_from_pattern(): the polygons between those cracks, clipped to the pane (= the shards).
## dice_cells(): jittered grid (tempered clumps). The same pattern drives the crack mask, so the cracks you see
## before a pane fails are exactly the shard borders after it fails.

## Pattern: {center, n, rings: PackedFloat32Array, pts: Array[PackedVector2Array] (per radial, one point per ring),
## mids: Array[PackedVector2Array] (per radial, wiggle point between ring k and k+1)}
static func radial_pattern(center: Vector2, half: Vector2, rng: RandomNumberGenerator, n_rad: int, ring_ratio: float,
		r0 := 0.014) -> Dictionary:
	var far := 0.0
	for c in [Vector2(-half.x, -half.y), Vector2(half.x, -half.y), Vector2(half.x, half.y), Vector2(-half.x, half.y)]:
		far = maxf(far, center.distance_to(c))
	var rings := PackedFloat32Array()
	var r := r0
	while r < far * 1.08:
		rings.append(r)
		r *= ring_ratio * rng.randf_range(0.9, 1.12)
	rings.append(far * 1.1)
	var angles := PackedFloat32Array()
	var a0 := rng.randf() * TAU
	for i in n_rad:
		angles.append(a0 + (i + rng.randf_range(-0.3, 0.3)) * TAU / n_rad)
	var pts: Array[PackedVector2Array] = []
	var mids: Array[PackedVector2Array] = []
	var dth := TAU / n_rad
	for i in n_rad:
		var a := angles[i]
		var pr := PackedVector2Array()
		var pm := PackedVector2Array()
		for k in rings.size():
			a += rng.randf_range(-0.12, 0.12) * dth   # radials wander a little
			pr.append(center + Vector2.from_angle(a) * rings[k] * rng.randf_range(0.96, 1.04))
		for k in rings.size() - 1:
			var m := (pr[k] + pr[k + 1]) * 0.5
			var t := (pr[k + 1] - pr[k])
			m += t.orthogonal().normalized() * t.length() * rng.randf_range(-0.07, 0.07)
			pm.append(m)
		pts.append(pr)
		mids.append(pm)
	return {"center": center, "n": n_rad, "rings": rings, "pts": pts, "mids": mids}


static func rect_poly(half: Vector2) -> PackedVector2Array:
	return PackedVector2Array([Vector2(-half.x, -half.y), Vector2(half.x, -half.y), Vector2(half.x, half.y), Vector2(-half.x, half.y)])


## Cells: [{poly, centroid, area, band}] clipped to the pane rectangle. max_cell splits wide outer cells once.
static func cells_from_pattern(pat: Dictionary, half: Vector2, rng: RandomNumberGenerator, max_cell := 0.3) -> Array:
	var out: Array = []
	var rect := rect_poly(half)
	var n: int = pat["n"]
	var pts: Array = pat["pts"]
	var mids: Array = pat["mids"]
	var rings: PackedFloat32Array = pat["rings"]
	var c: Vector2 = pat["center"]
	for i in n:
		var j := (i + 1) % n
		var pi: PackedVector2Array = pts[i]
		var pj: PackedVector2Array = pts[j]
		_add_cells(out, PackedVector2Array([c, pi[0], pj[0]]), rect, 0)
		for k in rings.size() - 1:
			var poly := PackedVector2Array([pi[k], (mids[i] as PackedVector2Array)[k], pi[k + 1],
				pj[k + 1], (mids[j] as PackedVector2Array)[k], pj[k]])
			var w := pi[k + 1].distance_to(pj[k + 1])
			if w > max_cell and rings[k] < 3.0:
				# secondary crack across the wide wedge
				var f := rng.randf_range(0.35, 0.65)
				var a := pi[k].lerp(pi[k + 1], f)
				var b := pj[k].lerp(pj[k + 1], clampf(f + rng.randf_range(-0.15, 0.15), 0.1, 0.9))
				_add_cells(out, PackedVector2Array([pi[k], (mids[i] as PackedVector2Array)[k], a, b, (mids[j] as PackedVector2Array)[k], pj[k]]), rect, k + 1)
				_add_cells(out, PackedVector2Array([a, pi[k + 1], pj[k + 1], b]), rect, k + 1)
			else:
				_add_cells(out, poly, rect, k + 1)
	return out


static func _add_cells(out: Array, poly: PackedVector2Array, rect: PackedVector2Array, band: int) -> void:
	for q in Geometry2D.intersect_polygons(poly, rect):
		var a := absf(area(q))
		if a < 2e-6:
			continue
		out.append({"poly": q, "centroid": centroid(q), "area": a, "band": band})


## Tempered: jittered grid of clumps (cell ~ size m). Each clump later bursts into granules.
static func dice_cells(half: Vector2, cell: float, rng: RandomNumberGenerator) -> Array:
	var nx := maxi(1, int(ceil(half.x * 2.0 / cell)))
	var ny := maxi(1, int(ceil(half.y * 2.0 / cell)))
	var cx := half.x * 2.0 / nx
	var cy := half.y * 2.0 / ny
	var grid := []
	for y in ny + 1:
		var row := PackedVector2Array()
		for x in nx + 1:
			var p := Vector2(-half.x + x * cx, -half.y + y * cy)
			if x > 0 and x < nx:
				p.x += rng.randf_range(-0.22, 0.22) * cx
			if y > 0 and y < ny:
				p.y += rng.randf_range(-0.22, 0.22) * cy
			row.append(p)
		grid.append(row)
	var out: Array = []
	for y in ny:
		for x in nx:
			var q := PackedVector2Array([grid[y][x], grid[y][x + 1], grid[y + 1][x + 1], grid[y + 1][x]])
			out.append({"poly": q, "centroid": centroid(q), "area": absf(area(q)), "band": 0})
	return out


## Jagged inset rectangle: what stays in the frame as "teeth" when an annealed pane shatters.
static func teeth_inset(half: Vector2, rng: RandomNumberGenerator, dmin := 0.015, dmax := 0.07) -> PackedVector2Array:
	var out := PackedVector2Array()
	var corners := rect_poly(half)
	for s in 4:
		var a := corners[s]
		var b := corners[(s + 1) % 4]
		var nseg := maxi(2, int(a.distance_to(b) / 0.07))
		var inward := (b - a).orthogonal().normalized() * -1.0
		if inward.dot(-a) < 0.0:
			inward = -inward
		for i in nseg:
			var f := float(i) / nseg
			var d := rng.randf_range(dmin, dmax) if rng.randf() < 0.7 else dmin
			var p := a.lerp(b, f) + inward * d
			p.x = clampf(p.x, -half.x + dmin, half.x - dmin)
			p.y = clampf(p.y, -half.y + dmin, half.y - dmin)
			out.append(p)
	return out


static func area(p: PackedVector2Array) -> float:
	var s := 0.0
	for i in p.size():
		s += p[i].cross(p[(i + 1) % p.size()])
	return s * 0.5


static func centroid(p: PackedVector2Array) -> Vector2:
	var c := Vector2.ZERO
	for q in p:
		c += q
	return c / maxf(p.size(), 1)


static func poly_hits_circle(p: PackedVector2Array, c: Vector2, r: float) -> bool:
	if Geometry2D.is_point_in_polygon(c, p):
		return true
	for i in p.size():
		var q := Geometry2D.get_closest_point_to_segment(c, p[i], p[(i + 1) % p.size()])
		if q.distance_to(c) <= r:
			return true
	return false


## Length of polygon edges lying on supported pane borders. edges bitmask: 1 left, 2 right, 4 bottom, 8 top.
static func border_contact(p: PackedVector2Array, half: Vector2, edges: int) -> float:
	var L := 0.0
	var e := 1e-4
	for i in p.size():
		var a := p[i]
		var b := p[(i + 1) % p.size()]
		if (edges & 1) and absf(a.x + half.x) < e and absf(b.x + half.x) < e: L += a.distance_to(b)
		elif (edges & 2) and absf(a.x - half.x) < e and absf(b.x - half.x) < e: L += a.distance_to(b)
		elif (edges & 4) and absf(a.y + half.y) < e and absf(b.y + half.y) < e: L += a.distance_to(b)
		elif (edges & 8) and absf(a.y - half.y) < e and absf(b.y - half.y) < e: L += a.distance_to(b)
	return L


# ------------------------------------------------------------------ surface mapping (cylindrical bends)

## Pane 2D (u, v) + offset w along the normal -> pane-local 3D. k = curvature (1/m) about Y (x bend) and X (y bend).
static func surf(p: Vector2, w: float, k: Vector2) -> Vector3:
	var s := Vector3(p.x, p.y, 0.0)
	if absf(k.x) > 1e-5:
		s.x = sin(p.x * k.x) / k.x
		s.z += (cos(p.x * k.x) - 1.0) / k.x
	if absf(k.y) > 1e-5:
		s.y = sin(p.y * k.y) / k.y
		s.z += (cos(p.y * k.y) - 1.0) / k.y
	return s + surf_normal(p, k) * w


static func surf_normal(p: Vector2, k: Vector2) -> Vector3:
	var su := sin(p.x * k.x)
	var cu := cos(p.x * k.x)
	var sv := sin(p.y * k.y)
	var cv := cos(p.y * k.y)
	return Vector3(su * cv, cu * sv, cu * cv).normalized()


## Inverse of surf() for a pane-local point (ignores the offset along the normal).
static func to_2d(l: Vector3, k: Vector2) -> Vector2:
	var u := l.x if absf(k.x) < 1e-5 else asin(clampf(l.x * k.x, -1.0, 1.0)) / k.x
	var v := l.y if absf(k.y) < 1e-5 else asin(clampf(l.y * k.y, -1.0, 1.0)) / k.y
	return Vector2(u, v)


## Slab mesh from 2D polygons: front (+n), back (-n) and edge walls. Faces get COLOR.a = 1, walls COLOR.a = 0
## (the shader tints walls green). origin: subtracted from every vertex (shard bodies are centred on their centroid).
## skip_edges: Dictionary of edge keys not to wall (edges shared by two remaining cells). Returns ArrayMesh or null.
static func slab_mesh(polys: Array, t: float, size: Vector2, k: Vector2, origin := Vector3.ZERO, skip_edges := {},
		sub := 0.0) -> ArrayMesh:
	var V := PackedVector3Array()
	var N := PackedVector3Array()
	var UV := PackedVector2Array()
	var C := PackedColorArray()
	var T := PackedFloat32Array()
	var I := PackedInt32Array()
	var h := t * 0.5
	var flat := k.length_squared() < 1e-10
	var inv := Vector2(1.0 / size.x, -1.0 / size.y)
	for poly0 in polys:
		var poly: PackedVector2Array = poly0
		if sub > 0.0:
			poly = subdivide(poly, sub)
		var tri := Geometry2D.triangulate_polygon(poly)
		if tri.is_empty():
			continue
		var ccw := area(poly) > 0.0
		for side: float in [1.0, -1.0]:
			var base := V.size()
			var nf := Vector3(0, 0, side)
			for p in poly:
				if flat:
					V.append(Vector3(p.x, p.y, h * side) - origin)
					N.append(nf)
				else:
					V.append(surf(p, h * side, k) - origin)
					N.append(surf_normal(p, k) * side)
				UV.append(p * inv + Vector2(0.5, 0.5))
				C.append(Color(1, 1, 1, 1))
				T.append_array([1.0, 0.0, 0.0, side])
			for ti in range(0, tri.size(), 3):
				var a := tri[ti]
				var b := tri[ti + 1]
				var c := tri[ti + 2]
				# Godot front faces are clockwise seen from the normal side
				if (side > 0.0) == ccw:
					I.append_array([base + a, base + c, base + b])
				else:
					I.append_array([base + a, base + b, base + c])
		for i in poly.size():
			var a2 := poly[i]
			var b2 := poly[(i + 1) % poly.size()]
			if not skip_edges.is_empty() and skip_edges.has(edge_key(a2, b2)):
				continue
			var e := (b2 - a2)
			var out2 := Vector2(e.y, -e.x) if ccw else Vector2(-e.y, e.x)
			var base2 := V.size()
			var nrm := Vector3(out2.x, out2.y, 0.0).normalized()
			if flat:
				V.append_array([Vector3(a2.x, a2.y, h) - origin, Vector3(b2.x, b2.y, h) - origin,
					Vector3(b2.x, b2.y, -h) - origin, Vector3(a2.x, a2.y, -h) - origin])
			else:
				V.append_array([surf(a2, h, k) - origin, surf(b2, h, k) - origin, surf(b2, -h, k) - origin, surf(a2, -h, k) - origin])
			var ua := a2 * inv + Vector2(0.5, 0.5)
			var ub := b2 * inv + Vector2(0.5, 0.5)
			UV.append_array([ua, ub, ub, ua])
			N.append_array([nrm, nrm, nrm, nrm])
			var c0 := Color(1, 1, 1, 0)
			C.append_array([c0, c0, c0, c0])
			T.append_array([0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0])
			I.append_array([base2, base2 + 2, base2 + 1, base2, base2 + 3, base2 + 2])
	if I.is_empty():
		return null
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = V
	arr[Mesh.ARRAY_NORMAL] = N
	arr[Mesh.ARRAY_TANGENT] = T
	arr[Mesh.ARRAY_TEX_UV] = UV
	arr[Mesh.ARRAY_COLOR] = C
	arr[Mesh.ARRAY_INDEX] = I
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m


## Insert points so no polygon edge is longer than step (curved / bulging panes need vertices inside large cells too:
## only edges are subdivided, which is enough for cylinders of modest curvature).
static func subdivide(p: PackedVector2Array, step: float) -> PackedVector2Array:
	var out := PackedVector2Array()
	for i in p.size():
		var a := p[i]
		var b := p[(i + 1) % p.size()]
		var n := maxi(1, int(ceil(a.distance_to(b) / step)))
		for j in n:
			out.append(a.lerp(b, float(j) / n))
	return out


static func edge_key(a: Vector2, b: Vector2) -> Vector4i:
	var ka := Vector2i((a * 10000.0).round())
	var kb := Vector2i((b * 10000.0).round())
	if ka.x > kb.x or (ka.x == kb.x and ka.y > kb.y):
		var t := ka
		ka = kb
		kb = t
	return Vector4i(ka.x, ka.y, kb.x, kb.y)


## Convex hull points of a slab (for ConvexPolygonShape3D of a shard).
static func slab_points(poly: PackedVector2Array, t: float, k: Vector2, origin: Vector3) -> PackedVector3Array:
	var out := PackedVector3Array()
	var hull := Geometry2D.convex_hull(poly)
	for p in hull:
		out.append(surf(p, t * 0.5, k) - origin)
		out.append(surf(p, -t * 0.5, k) - origin)
	return out
