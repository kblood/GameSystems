class_name GlassPrefabs
extends RefCounted
## Procedural glazing prefabs: frames / seals are low-poly boxes or curved strips (1 unit = 1 m).
## Origin conventions: house windows / doors / shop fronts = centre of the glass plane, +Z = outside (front);
## car glass = centre of the pane, +Z = outside of the car. Every builder returns a Node3D whose GlassPane
## children are listed in meta "panes".
##   add_child(GlassPrefabs.house_window("casement", Vector2(1.2, 1.3)))

static var _mats := {}


static func mat(name: String, col: Color, rough := 0.6, metal := 0.0) -> StandardMaterial3D:
	if _mats.has(name):
		return _mats[name]
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.roughness = rough
	m.metallic = metal
	_mats[name] = m
	return m


static func box(parent: Node3D, size: Vector3, pos: Vector3, m: Material, collide := true) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = m
	mi.position = pos
	parent.add_child(mi)
	if collide:
		var sb := StaticBody3D.new()
		var cs := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = size
		cs.shape = sh
		sb.add_child(cs)
		mi.add_child(sb)
	return mi


static func pane(parent: Node3D, size: Vector2, type: String, mm: float, pos := Vector3.ZERO, curv := Vector2.ZERO) -> GlassPane:
	var p := GlassPane.new()
	p.size = size
	p.glass_type = type
	p.thickness_mm = mm
	p.curvature = curv
	p.position = pos
	p.name = "Pane%d" % parent.get_child_count()
	parent.add_child(p)
	var arr: Array = parent.get_meta("panes", [])
	arr.append(p)
	parent.set_meta("panes", arr)
	return p


## Rectangular frame around an opening (inner size), profile w x depth.
static func frame(parent: Node3D, inner: Vector2, w: float, depth: float, m: Material, z := 0.0) -> void:
	var hx := inner.x * 0.5
	var hy := inner.y * 0.5
	box(parent, Vector3(inner.x + 2 * w, w, depth), Vector3(0, hy + w * 0.5, z), m)
	box(parent, Vector3(inner.x + 2 * w, w, depth), Vector3(0, -hy - w * 0.5, z), m)
	box(parent, Vector3(w, inner.y, depth), Vector3(-hx - w * 0.5, 0, z), m)
	box(parent, Vector3(w, inner.y, depth), Vector3(hx + w * 0.5, 0, z), m)


## style: "single" | "casement" (2 side-hung sashes) | "sash" (2 vertical sliding) | "igu" (double glazed single).
static func house_window(style := "casement", size := Vector2(1.2, 1.3), type := "annealed", mm := 4.0) -> Node3D:
	var root := Node3D.new()
	root.name = "Window_" + style
	var wood := mat("frame_white", Color(0.92, 0.91, 0.88), 0.55)
	var fw := 0.07
	frame(root, size, fw, 0.12, wood)
	box(root, Vector3(size.x + 0.26, 0.035, 0.22), Vector3(0, -size.y * 0.5 - fw - 0.0175, 0.06), wood)   # sill
	var sash := 0.045
	match style:
		"casement":
			var w := (size.x - sash) * 0.5
			box(root, Vector3(sash, size.y, 0.06), Vector3.ZERO, wood)
			pane(root, Vector2(w - 0.01, size.y - 0.01), type, mm, Vector3(-(w + sash) * 0.5, 0, 0))
			pane(root, Vector2(w - 0.01, size.y - 0.01), type, mm, Vector3((w + sash) * 0.5, 0, 0))
		"sash":
			var hh := (size.y - sash) * 0.5
			box(root, Vector3(size.x, sash, 0.06), Vector3.ZERO, wood)
			pane(root, Vector2(size.x - 0.01, hh - 0.01), type, mm, Vector3(0, (hh + sash) * 0.5, 0.012))
			pane(root, Vector2(size.x - 0.01, hh - 0.01), type, mm, Vector3(0, -(hh + sash) * 0.5, -0.012))
		"igu":
			igu_into(root, size - Vector2(0.01, 0.01), type, mm, "annealed", 4.0, 0.016)
		_:
			pane(root, size - Vector2(0.01, 0.01), type, mm)
	return root


## Double glazing: outer (front, +Z) and inner pane, gap in metres, aluminium spacer.
static func igu_into(root: Node3D, size: Vector2, outer: String, outer_mm: float, inner: String, inner_mm: float, gap := 0.016) -> void:
	var o := pane(root, size, outer, outer_mm, Vector3(0, 0, gap * 0.5))
	o.name = "Outer"
	var i := pane(root, size, inner, inner_mm, Vector3(0, 0, -gap * 0.5))
	i.name = "Inner"
	i.pane_seed = 77
	var al := mat("spacer", Color(0.6, 0.62, 0.64), 0.4, 0.8)
	var s := 0.008
	box(root, Vector3(size.x, s, gap), Vector3(0, size.y * 0.5 - s * 0.5, 0), al, false)
	box(root, Vector3(size.x, s, gap), Vector3(0, -size.y * 0.5 + s * 0.5, 0), al, false)
	box(root, Vector3(s, size.y, gap), Vector3(size.x * 0.5 - s * 0.5, 0, 0), al, false)
	box(root, Vector3(s, size.y, gap), Vector3(-size.x * 0.5 + s * 0.5, 0, 0), al, false)


static func igu(size := Vector2(1.0, 1.2)) -> Node3D:
	var root := Node3D.new()
	root.name = "IGU"
	frame(root, size, 0.06, 0.1, mat("frame_pvc", Color(0.95, 0.95, 0.95), 0.4))
	igu_into(root, size - Vector2(0.01, 0.01), "annealed", 4.0, "annealed", 4.0)
	return root


static func shop_front(size := Vector2(3.0, 2.5), type := "tempered", mm := 10.0) -> Node3D:
	var root := Node3D.new()
	root.name = "ShopFront"
	var al := mat("alu_dark", Color(0.15, 0.15, 0.16), 0.35, 0.8)
	frame(root, size, 0.06, 0.12, al)
	pane(root, size - Vector2(0.01, 0.01), type, mm)
	return root


static func glass_door(size := Vector2(0.9, 2.1), type := "tempered", mm := 8.0) -> Node3D:
	var root := Node3D.new()
	root.name = "GlassDoor"
	var al := mat("alu", Color(0.7, 0.71, 0.72), 0.3, 0.9)
	box(root, Vector3(size.x, 0.1, 0.04), Vector3(0, -size.y * 0.5 + 0.05, 0), al)
	box(root, Vector3(size.x, 0.06, 0.04), Vector3(0, size.y * 0.5 - 0.03, 0), al)
	var p := pane(root, Vector2(size.x, size.y - 0.16), type, mm, Vector3(0, 0.02, 0))
	p.clamped_edges = 4 | 8     # clamped top and bottom only (patch fittings)
	box(root, Vector3(0.025, 0.6, 0.025), Vector3(size.x * 0.38, 0, 0.05), al, false)
	return root


## Curved seal strip around a (possibly curved) pane: a ring of slab quads on the same surface.
static func seal(parent: Node3D, size: Vector2, curv: Vector2, w := 0.025, depth := 0.016) -> void:
	var h := size * 0.5
	var polys := [
		PackedVector2Array([Vector2(-h.x - w, h.y), Vector2(h.x + w, h.y), Vector2(h.x + w, h.y + w), Vector2(-h.x - w, h.y + w)]),
		PackedVector2Array([Vector2(-h.x - w, -h.y - w), Vector2(h.x + w, -h.y - w), Vector2(h.x + w, -h.y), Vector2(-h.x - w, -h.y)]),
		PackedVector2Array([Vector2(-h.x - w, -h.y), Vector2(-h.x, -h.y), Vector2(-h.x, h.y), Vector2(-h.x - w, h.y)]),
		PackedVector2Array([Vector2(h.x, -h.y), Vector2(h.x + w, -h.y), Vector2(h.x + w, h.y), Vector2(h.x, h.y)]),
	]
	var m := GlassFracture.slab_mesh(polys, depth, size, curv, Vector3.ZERO, {}, 0.1)
	var mi := MeshInstance3D.new()
	mi.mesh = m
	mi.material_override = mat("rubber", Color(0.03, 0.03, 0.03), 0.85)
	mi.name = "Seal"
	parent.add_child(mi)


## Laminated windscreen, curved across the width (and a little in height), shade band at the top.
static func car_windscreen(size := Vector2(1.45, 0.8)) -> Node3D:
	var root := Node3D.new()
	root.name = "Windscreen"
	var k := Vector2(0.75, 0.25)
	var p := pane(root, size, "laminated", 5.0, Vector3.ZERO, k)
	p.band_height = 0.14
	seal(root, size, k)
	return root


static func car_side_window(size := Vector2(0.78, 0.42)) -> Node3D:
	var root := Node3D.new()
	root.name = "SideWindow"
	var k := Vector2(0.0, 0.55)
	var p := pane(root, size, "tempered", 4.0, Vector3.ZERO, k)
	p.clamped_edges = 1 | 2 | 4 | 8
	seal(root, size, k, 0.02)
	return root


static func car_rear_window(size := Vector2(1.2, 0.55)) -> Node3D:
	var root := Node3D.new()
	root.name = "RearWindow"
	var k := Vector2(0.5, 0.3)
	var p := pane(root, size, "tempered", 4.0, Vector3.ZERO, k)
	p.heater_lines = 12
	seal(root, size, k)
	return root


static func wired_partition(size := Vector2(1.0, 1.0)) -> Node3D:
	var root := Node3D.new()
	root.name = "WiredPartition"
	frame(root, size, 0.05, 0.08, mat("steel", Color(0.35, 0.36, 0.38), 0.5, 0.7))
	pane(root, size - Vector2(0.01, 0.01), "wired", 6.0)
	return root


static func teller_window(size := Vector2(1.0, 0.9)) -> Node3D:
	var root := Node3D.new()
	root.name = "ResistantWindow"
	frame(root, size, 0.08, 0.12, mat("steel", Color(0.35, 0.36, 0.38), 0.5, 0.7))
	pane(root, size - Vector2(0.01, 0.01), "resistant", 30.0)
	return root


## Prefab by name (test scenes): annealed, tempered, laminated, igu, wired, resistant, casement, sash, shop,
## door, windscreen, side, rear.
static func by_name(n: String, mm := -1.0) -> Node3D:
	match n:
		"annealed": return house_window("single", Vector2(1.0, 1.2), "annealed", mm if mm > 0 else 4.0)
		"tempered": return car_side_window() if mm <= 0 else house_window("single", Vector2(1.0, 1.2), "tempered", mm)
		"laminated": return car_windscreen() if mm <= 0 else house_window("single", Vector2(1.0, 1.2), "laminated", mm)
		"igu": return igu()
		"wired": return wired_partition()
		"resistant": return teller_window()
		"casement": return house_window("casement")
		"sash": return house_window("sash")
		"shop": return shop_front()
		"door": return glass_door()
		"windscreen": return car_windscreen()
		"side": return car_side_window()
		"rear": return car_rear_window()
	return house_window("single")


static func panes_of(n: Node) -> Array:
	return n.get_meta("panes", [])
