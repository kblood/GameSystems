class_name BottleShardSource
extends RefCounted
## Where shard / broken-bottle geometry comes from. One interface, two back-ends:
##   REAL        export/bottle_<name>_shards.glb (Shard_00.. nodes, origin at centroid, extras mass_fraction/radius/class)
##               export/bottle_<name>_broken.glb (Glass with jagged rim + Neck node, extras open_z)
##   PLACEHOLDER procedural: the intact Glass mesh is cut into Voronoi patches around the impact point (small near it,
##               large far away); the neck snap clips the mesh at a jagged height. Used until the real files exist.
## Shard dict: {mesh: Mesh, xform: Transform3D (bottle space), mass_fraction, radius, cls, shape: Shape3D, real: bool}

static var _real_cache := {}


static func shards_path(name: String, dir: String) -> String:
	return "%sbottle_%s_shards.glb" % [dir, name]


static func broken_path(name: String, dir: String) -> String:
	return "%sbottle_%s_broken.glb" % [dir, name]


static func has_real_shards(name: String, dir: String) -> bool:
	return ResourceLoader.exists(shards_path(name, dir))


static func has_real_broken(name: String, dir: String) -> bool:
	return ResourceLoader.exists(broken_path(name, dir))


static func total_area(mesh: Mesh) -> float:
	var a := 0.0
	for s in mesh.get_surface_count():
		var arr := mesh.surface_get_arrays(s)
		var v: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
		var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX] if arr[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
		for i in range(0, idx.size() - 2, 3):
			a += (v[idx[i + 1]] - v[idx[i]]).cross(v[idx[i + 2]] - v[idx[i]]).length() * 0.5
	return a


## Thin shell hulls are fragile in the physics engine: add points +-t along the vertex normals.
static func hull_shape(points: PackedVector3Array, normals: PackedVector3Array, inflate := 0.0015) -> Shape3D:
	var seen := {}
	var pts := PackedVector3Array()
	for i in points.size():
		var p := points[i]
		var key := Vector3i((p * 20000.0).round())
		if seen.has(key):
			continue
		seen[key] = true
		pts.append(p)
		if i < normals.size():
			pts.append(p + normals[i] * inflate)
			pts.append(p - normals[i] * inflate)
	var cs := ConvexPolygonShape3D.new()
	cs.points = pts
	return cs


# ---------------------------------------------------------------- real shards

static func real_shards(name: String, dir: String) -> Array[Dictionary]:
	if _real_cache.has(name):
		return _real_cache[name]
	var out: Array[Dictionary] = []
	var ps := load(shards_path(name, dir)) as PackedScene
	if ps == null:
		return out
	var root := ps.instantiate()
	var tot := 0.0
	for n in root.find_children("Shard*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		var ex: Dictionary = mi.get_meta("extras", {}) if mi.has_meta("extras") else {}
		var xf := mi.transform
		var p := mi.get_parent()
		while p != null and p != root:
			xf = (p as Node3D).transform * xf
			p = p.get_parent()
		var mf := float(ex.get("mass_fraction", 0.0))
		tot += mf
		var shp := mi.mesh.create_convex_shape(true, false)
		out.append({"mesh": mi.mesh, "xform": xf, "mass_fraction": mf, "radius": float(ex.get("radius", 0.02)),
			"cls": String(ex.get("class", "shard")), "shape": shp, "real": true})
	root.free()
	if tot <= 0.0 and out.size() > 0:
		for d in out:
			d["mass_fraction"] = 1.0 / out.size()
	elif tot > 0.0:
		for d in out:
			d["mass_fraction"] = float(d["mass_fraction"]) / tot
	_real_cache[name] = out
	return out


# ---------------------------------------------------------------- placeholder shards

## Cut the glass mesh into ~count patches. xf maps mesh space to bottle space. impact_local in bottle space.
static func fragment(glass: MeshInstance3D, xf: Transform3D, impact_local: Vector3, count: int,
		rng: RandomNumberGenerator, sep_near := 0.012, sep_far := 0.055) -> Array[Dictionary]:
	var mesh := glass.mesh
	var arr := mesh.surface_get_arrays(0)
	var V: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var N: PackedVector3Array = arr[Mesh.ARRAY_NORMAL]
	var UV: PackedVector2Array = arr[Mesh.ARRAY_TEX_UV] if arr[Mesh.ARRAY_TEX_UV] != null else PackedVector2Array()
	var I: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
	var ntri := I.size() / 3
	var cen := PackedVector3Array()
	cen.resize(ntri)
	for t in ntri:
		cen[t] = xf * ((V[I[t * 3]] + V[I[t * 3 + 1]] + V[I[t * 3 + 2]]) / 3.0)
	# seeds: dart throwing, density falls off with distance from the impact
	var seeds := PackedVector3Array()
	var tries := 0
	while seeds.size() < count and tries < count * 30:
		tries += 1
		var c := cen[rng.randi() % ntri]
		var sep := lerpf(sep_near, sep_far, clampf(c.distance_to(impact_local) / 0.16, 0.0, 1.0))
		var ok := true
		for s in seeds:
			if s.distance_squared_to(c) < sep * sep:
				ok = false
				break
		if ok:
			seeds.append(c)
	if seeds.is_empty():
		seeds.append(cen[0])
	var cells: Array = []
	for s in seeds.size():
		cells.append([])
	for t in ntri:
		var best := 0
		var bd := 1e9
		for s in seeds.size():
			var d := cen[t].distance_squared_to(seeds[s])
			if d < bd:
				bd = d
				best = s
		cells[best].append(t)
	var mat := mesh.surface_get_material(0)
	var out: Array[Dictionary] = []
	var tot_area := 0.0
	var basis := xf.basis
	for cell in cells:
		if cell.size() < 2:
			continue
		var area := 0.0
		var c3 := Vector3.ZERO
		for t in cell:
			var a := (xf * V[I[t * 3]])
			var b := (xf * V[I[t * 3 + 1]])
			var c := (xf * V[I[t * 3 + 2]])
			var ar := (b - a).cross(c - a).length() * 0.5
			area += ar
			c3 += cen[t] * ar
		c3 /= maxf(area, 1e-9)
		var pv := PackedVector3Array()
		var pn := PackedVector3Array()
		var puv := PackedVector2Array()
		var rad := 0.0
		for t in cell:
			for k in 3:
				var vi := I[t * 3 + k]
				var p := xf * V[vi] - c3
				pv.append(p)
				pn.append((basis * N[vi]).normalized())
				if UV.size() > 0:
					puv.append(UV[vi])
				rad = maxf(rad, p.length())
		var am := ArrayMesh.new()
		var a2 := []
		a2.resize(Mesh.ARRAY_MAX)
		a2[Mesh.ARRAY_VERTEX] = pv
		a2[Mesh.ARRAY_NORMAL] = pn
		if puv.size() > 0:
			a2[Mesh.ARRAY_TEX_UV] = puv
		am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, a2)
		if mat:
			am.surface_set_material(0, mat)
		tot_area += area
		out.append({"mesh": am, "xform": Transform3D(Basis.IDENTITY, c3), "mass_fraction": area, "radius": rad,
			"cls": "chunk" if rad > 0.045 else ("shard" if rad > 0.022 else "sliver"),
			"shape": hull_shape(pv, pn), "real": false})
	for d in out:
		d["mass_fraction"] = float(d["mass_fraction"]) / maxf(tot_area, 1e-9)
	return out


# ---------------------------------------------------------------- neck snap

## Real broken variant if the file exists: {body: Mesh, neck: Mesh, open_z, real: true}. Else {}.
static func real_broken(name: String, dir: String) -> Dictionary:
	var ps := load(broken_path(name, dir)) as PackedScene
	if ps == null:
		return {}
	var root := ps.instantiate()
	var out := {"real": true, "open_z": -1.0}
	for n in root.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		if mi.name.begins_with("Neck"):
			out["neck"] = mi.mesh
			out["neck_xform"] = mi.transform
		elif mi.name.begins_with("Label"):
			out["label"] = mi.mesh
		elif mi.name.begins_with("Glass"):
			out["body"] = mi.mesh
			var ex: Dictionary = mi.get_meta("extras", {}) if mi.has_meta("extras") else {}
			if ex.has("open_z"):
				out["open_z"] = float(ex["open_z"])
	for n in root.find_children("*", "Node", true, false):
		if n.has_meta("extras"):
			var ex2 = n.get_meta("extras")
			if ex2 is Dictionary and ex2.has("open_z") and float(out["open_z"]) < 0.0:
				out["open_z"] = float(ex2["open_z"])
	root.free()
	return out


## Placeholder: clip the glass mesh at a jagged height around snap_z. {body, neck, rim_r, neck_area_frac, open_z}
static func split_at_height(mesh: Mesh, snap_z: float, rng: RandomNumberGenerator, jag := 0.012) -> Dictionary:
	var arr := mesh.surface_get_arrays(0)
	var V: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var N: PackedVector3Array = arr[Mesh.ARRAY_NORMAL]
	var UV: PackedVector2Array = arr[Mesh.ARRAY_TEX_UV] if arr[Mesh.ARRAY_TEX_UV] != null else PackedVector2Array()
	var I: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
	var p1 := rng.randf() * TAU
	var p2 := rng.randf() * TAU
	var parts := [{"v": PackedVector3Array(), "n": PackedVector3Array(), "u": PackedVector2Array()},
		{"v": PackedVector3Array(), "n": PackedVector3Array(), "u": PackedVector2Array()}]   # 0 body, 1 neck
	var rim_r := 0.0
	var area_body := 0.0
	var area_neck := 0.0
	for t in range(0, I.size() - 2, 3):
		var tri: Array = []
		var cx := 0.0
		var cz := 0.0
		for k in 3:
			var vi := I[t + k]
			tri.append([V[vi], N[vi], UV[vi] if UV.size() > 0 else Vector2.ZERO])
			cx += V[vi].x
			cz += V[vi].z
		var th := atan2(cx, cz)
		var h := snap_z + jag * (0.6 * sin(6.0 * th + p1) + 0.4 * sin(15.0 * th + p2)) + rng.randf_range(-0.003, 0.003)
		for side in 2:
			var poly := _clip(tri, h, side == 1)
			if poly.size() < 3:
				continue
			var pr: Dictionary = parts[side]
			for j in range(1, poly.size() - 1):
				for e in [poly[0], poly[j], poly[j + 1]]:
					pr["v"].append(e[0])
					pr["n"].append(e[1])
					pr["u"].append(e[2])
				var ar: float = ((poly[j][0] - poly[0][0]).cross(poly[j + 1][0] - poly[0][0])).length() * 0.5
				if side == 0:
					area_body += ar
				else:
					area_neck += ar
			if absf(poly[0][0].y - h) < 1e-6 or poly.size() > 3:
				for e in poly:
					if absf(e[0].y - h) < 1e-5:
						rim_r = maxf(rim_r, Vector2(e[0].x, e[0].z).length())
	var mat := mesh.surface_get_material(0)
	var out := {"real": false, "rim_r": maxf(rim_r, 0.012), "open_z": snap_z - jag,
		"neck_area_frac": area_neck / maxf(area_neck + area_body, 1e-9)}
	for side in 2:
		var pr: Dictionary = parts[side]
		var am := ArrayMesh.new()
		var a2 := []
		a2.resize(Mesh.ARRAY_MAX)
		a2[Mesh.ARRAY_VERTEX] = pr["v"]
		a2[Mesh.ARRAY_NORMAL] = pr["n"]
		if UV.size() > 0:
			a2[Mesh.ARRAY_TEX_UV] = pr["u"]
		if (pr["v"] as PackedVector3Array).size() > 0:
			am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, a2)
			if mat:
				am.surface_set_material(0, mat)
		out["body" if side == 0 else "neck"] = am
	return out


static func _clip(poly: Array, h: float, above: bool) -> Array:
	var out: Array = []
	var sgn := 1.0 if above else -1.0
	for i in poly.size():
		var a: Array = poly[i]
		var b: Array = poly[(i + 1) % poly.size()]
		var da: float = (a[0].y - h) * sgn
		var db: float = (b[0].y - h) * sgn
		if da >= 0.0:
			out.append(a)
		if (da >= 0.0) != (db >= 0.0):
			var t := da / (da - db)
			var p: Vector3 = a[0].lerp(b[0], t)
			p.y = h
			out.append([p, (a[1] as Vector3).lerp(b[1], t).normalized(), (a[2] as Vector2).lerp(b[2], t)])
	return out
