class_name BottleProp
extends RigidBody3D
## Unbreakable physics container with a BottleLiquid (used for assets BreakableBottle cannot build: the container_* family has
## no Glass-shell break data and its sidecars are LUT v2 only). Same fields BottleBinding / BottleFactory use on BreakableBottle:
## model, ctl, glass_node, state, fill, capacity_ml. Duck-types hit_by_projectile so FastImpact bullets push it.

var model: Node3D
var ctl: BottleLiquid
var glass_node: MeshInstance3D
var state := &"intact"
var fill := 0.6:
	set(v):
		fill = clampf(v, 0.0, 1.0)
		if ctl:
			ctl.fill = fill
		_update_mass()
var capacity_ml := 300.0
var empty_mass := 0.25
var asset_path := ""


func build(glb: String, fill_: float, cap_ml: float, layer: int, mask: int) -> void:
	capacity_ml = cap_ml
	empty_mass = clampf(0.08 + cap_ml * 0.0003, 0.1, 2.0)
	var ps := load(glb) as PackedScene
	assert(ps != null, "BottleProp: cannot load " + glb)
	asset_path = glb
	model = ps.instantiate()
	add_child(model)
	glass_node = model.find_child("Glass*", true, false) as MeshInstance3D
	ctl = BottleLiquid.new()
	add_child(ctl)
	_build_shape()
	collision_layer = layer
	collision_mask = mask
	continuous_cd = true
	var pm := PhysicsMaterial.new()
	pm.friction = 0.6
	pm.bounce = 0.2
	physics_material_override = pm
	fill = fill_


func _build_shape() -> void:
	var pts := PackedVector3Array()
	for m in model.find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		if mi.name.begins_with("Liquid") or mi.mesh == null:
			continue
		var xf := Transform3D.IDENTITY
		var p: Node = mi
		while p != null and p != self:
			xf = (p as Node3D).transform * xf
			p = p.get_parent()
		var seen := {}
		for v in mi.mesh.get_faces():
			var q := xf * v
			var key := Vector3i((q * 1000.0).round())
			if not seen.has(key):
				seen[key] = true
				pts.append(q)
	if pts.size() > 4000:   # keep the hull cheap
		var thin := PackedVector3Array()
		var k := ceili(pts.size() / 4000.0)
		for i in range(0, pts.size(), k):
			thin.append(pts[i])
		pts = thin
	var cs := CollisionShape3D.new()
	var sh := ConvexPolygonShape3D.new()
	sh.points = pts
	cs.shape = sh
	add_child(cs)


func _update_mass() -> void:
	mass = empty_mass + capacity_ml * 0.001 * fill


func is_plastic() -> bool:
	return false


func hit_by_projectile(point: Vector3, direction: Vector3, energy_joules: float, _caliber := 0.009) -> Dictionary:
	apply_impulse(direction.normalized() * sqrt(2.0 * energy_joules * 0.01 * mass), point - global_position)
	return {"outcome": 0, "point": point}


func receive_ballistic_hit(at: Vector3, direction: Vector3) -> void:
	hit_by_projectile(at, direction, 500.0)
