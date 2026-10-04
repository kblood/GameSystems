extends SceneTree
## Micro-profile of the fracture pipeline pieces (HIGH tier sizes).
## timeout 60 godot --headless --path tests/godot_glass --script res://tests/profile_glass.gd

func _ms(t0: int) -> float:
	return (Time.get_ticks_usec() - t0) / 1000.0


func _init() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 5
	var half := Vector2(0.5, 0.6)
	var m := GlassCrackMask.new()
	var t0 := Time.get_ticks_usec()
	m.setup(Vector2(1.0, 1.2), 384.0, 1024, true)
	print("mask setup %.2f ms (%dx%d)" % [_ms(t0), m.w, m.h])
	t0 = Time.get_ticks_usec()
	var pat := GlassFracture.radial_pattern(Vector2(0.05, -0.1), half, rng, 12, 1.75)
	print("radial_pattern %.2f ms" % _ms(t0))
	t0 = Time.get_ticks_usec()
	var total_px := 0.0
	for i in int(pat["n"]):
		var pr: PackedVector2Array = (pat["pts"] as Array)[i]
		var line := PackedVector2Array([pat["center"]])
		line.append_array(pr)
		for k in range(1, line.size()):
			total_px += line[k - 1].distance_to(line[k]) * 384.0
		m.polyline(line, 1.7, 1.0, 0.45, rng)
	print("radials polyline %.2f ms (%.0f px of line, %.2f us/px)" % [_ms(t0), total_px, _ms(t0) * 1000.0 / total_px])
	t0 = Time.get_ticks_usec()
	var cl := GlassFracture.cells_from_pattern(pat, half, rng, 0.3)
	print("cells_from_pattern %.2f ms (%d cells)" % [_ms(t0), cl.size()])
	t0 = Time.get_ticks_usec()
	var inset := GlassFracture.teeth_inset(half, rng)
	var cl2: Array = []
	for cc in cl:
		for q in Geometry2D.intersect_polygons(cc["poly"], inset):
			cl2.append(q)
		for q in Geometry2D.clip_polygons(cc["poly"], inset):
			cl2.append(q)
	print("teeth clip %.2f ms (%d polys)" % [_ms(t0), cl2.size()])
	t0 = Time.get_ticks_usec()
	var polys: Array = []
	for cc in cl:
		polys.append(cc["poly"])
	var mesh := GlassFracture.slab_mesh(polys, 0.004, Vector2(1, 1.2), Vector2.ZERO, Vector3.ZERO, {}, 0.0)
	print("slab_mesh %.2f ms" % _ms(t0))
	t0 = Time.get_ticks_usec()
	var sh := mesh.create_trimesh_shape()
	print("trimesh %.2f ms (%d faces)" % [_ms(t0), sh.get_faces().size() / 3])
	t0 = Time.get_ticks_usec()
	for cc in cl:
		var q: PackedVector2Array = cc["poly"]
		var loop := q.duplicate()
		loop.append(q[0])
		m.polyline(loop, 1.2, 0.9, 0.9, rng)
	print("cell border polylines %.2f ms" % _ms(t0))
	t0 = Time.get_ticks_usec()
	m.commit()
	print("commit (mips) %.2f ms" % _ms(t0))
	t0 = Time.get_ticks_usec()
	for i in 20:
		var one := GlassFracture.slab_mesh([cl[i % cl.size()]["poly"]], 0.004, Vector2(1, 1.2), Vector2.ZERO, Vector3.ZERO, {}, 0.0)
		one.create_convex_shape()
	print("20 single shard mesh+convex %.2f ms" % _ms(t0))
	quit()
