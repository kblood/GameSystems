class_name TestWorld
extends RefCounted
## Static test geometry tagged with break surfaces.

const COLORS := {"concrete": Color(0.55, 0.55, 0.57), "metal": Color(0.45, 0.5, 0.58), "wood": Color(0.52, 0.34, 0.18),
	"carpet": Color(0.5, 0.12, 0.14), "tile": Color(0.75, 0.78, 0.8), "stone": Color(0.4, 0.4, 0.42)}


## Box with its TOP face at pos.y, centred on pos.xz.
static func pad(parent: Node, pos: Vector3, size: Vector3, surface: String, name := "") -> StaticBody3D:
	var b := StaticBody3D.new()
	b.name = name if name != "" else "pad_" + surface
	b.set_meta("break_surface", surface)
	b.collision_layer = 1
	b.collision_mask = 0
	var cs := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = size
	cs.shape = sh
	b.add_child(cs)
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	var m := StandardMaterial3D.new()
	m.albedo_color = COLORS.get(surface, Color.GRAY)
	m.roughness = 0.9 if surface == "carpet" else 0.6
	bm.material = m
	mi.mesh = bm
	b.add_child(mi)
	parent.add_child(b)
	b.position = pos - Vector3(0, size.y * 0.5, 0)
	return b


static func set_surface(b: StaticBody3D, surface: String) -> void:
	b.set_meta("break_surface", surface)
	for c in b.get_children():
		if c is MeshInstance3D:
			((c as MeshInstance3D).mesh.material as StandardMaterial3D).albedo_color = COLORS.get(surface, Color.GRAY)
