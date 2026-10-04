class_name BottleFactory
extends RefCounted
## ONE entry point for every bottle / container in the library:
##   var b := BottleFactory.spawn("bottle_wine", {"fill": 0.7, "design": "wine_classic", "position": Vector3(0, 1, 0)})
##   add_child(b)
## asset ids = catalog.json ids: bottle_<v1>, bottle_v2_<name>, container_<name>, design_<name>. opts (all optional):
##   fill 0..1 (0.6) | tier -1..3 per-object QualityTier override | design "wine_classic" / "design_wine_classic" / path
##   breakable true | position / rotation_degrees | carbonation (-1 = from sidecar) | lod -1 auto / 0 / 1 / 2
##   audio true | seed 0 | layer / mask (physics layers; default bottles on layer 4 so shards never hit intact bottles)
##   pour true (BottlePour child, meta "pour": open containers / uncapped bottles drain, stream, fill receivers)
## Returns BreakableBottle for everything (containers too: glass ones shatter, mug / jerrycan / PET dent or leak).
## Both expose model, ctl (BottleLiquid), fill, state, glass_node; the child BottleBinding handles tier / LOD / audio.
## Files live under res://assets/{v1,v2,container,designs}/bottle_<name>*.glb (BreakableBottle naming convention;
## demo/sync.ps1 renames container_* and design files to it).

const ROOT := "res://assets/"
const LAYER_BOTTLE := 8         ## physics layer 4
const MASK_BOTTLE := 1 | 2 | 8  ## world + props + bottles
static var _cat := {}


static func catalog() -> Dictionary:
	if _cat.is_empty():
		var d = JSON.parse_string(FileAccess.get_file_as_string(ROOT + "catalog.json"))
		for a in d["assets"]:
			_cat[a["id"]] = a
	return _cat


static func _exists(p: String) -> bool:
	return FileAccess.file_exists(p) or ResourceLoader.exists(p)


## Resolved description of an asset id (+ optional design). {} when unknown.
static func resolve(asset_id: String, design := "") -> Dictionary:
	var cat := catalog()
	if design != "":
		var dn := design.get_file().get_basename().get_basename()
		dn = dn.trim_prefix("design_")
		if _exists("%sdesigns/bottle_%s.glb" % [ROOT, dn]):
			asset_id = "design_" + dn
		else:
			push_warning("BottleFactory: design '%s' not in this project (run demo/sync.ps1), using the bare bottle" % design)
	if not cat.has(asset_id):
		push_error("BottleFactory: unknown asset id " + asset_id)
		return {}
	var e: Dictionary = cat[asset_id]
	var fam: String = e["family"]
	var out := {"id": asset_id, "family": fam, "entry": e}
	var base_e := e
	match fam:
		"bottle":
			out["dir"] = ROOT + "v1/"
			out["name"] = asset_id.trim_prefix("bottle_")
			out["v1"] = true
		"bottle_v2":
			out["dir"] = ROOT + "v2/"
			out["name"] = asset_id.trim_prefix("bottle_v2_")
		"container":
			out["dir"] = ROOT + "container/"
			out["name"] = asset_id.trim_prefix("container_")
		"bottle_design":
			out["dir"] = ROOT + "designs/"
			out["name"] = asset_id.trim_prefix("design_")
			out["design"] = true
			var base: String = e.get("base", "")
			if cat.has(base):
				base_e = cat[base]
				out["base"] = base
				out["v1"] = base_e["family"] == "bottle"
				out["base_name"] = base.trim_prefix("bottle_v2_") if base.begins_with("bottle_v2_") else base.trim_prefix("bottle_")
		_:
			push_error("BottleFactory: %s is not a bottle asset" % asset_id)
			return {}
	out["capacity_ml"] = float(base_e.get("capacity_ml", 500))
	out["height_m"] = float(base_e.get("height_m", 0.25))
	out["glb"] = "%sbottle_%s.glb" % [out["dir"], out["name"]]
	out["has_break_json"] = _exists("%sbottle_%s_break.json" % [out["dir"], out["name"]])
	out["breakable"] = fam != "container"
	return out


static func variant_path(info: Dictionary, tier: int, lod: int) -> String:
	var d: String = info["dir"]
	var n: String = info["name"]
	if info.get("design", false):
		var i := clampi(maxi(tier, lod), 0, 3)
		while i > 0 and not _exists("%sbottle_%s%s.glb" % [d, n, ["", "_medium", "_low", "_minimal"][i]]):
			i -= 1   # lower tiers are not built for every design (v2 / containers are HIGH only): fall back to the next higher tier
		return "%sbottle_%s%s.glb" % [d, n, ["", "_medium", "_low", "_minimal"][i]]
	if info["family"] == "bottle_v2":
		return "%sbottle_%s%s.glb" % [d, n, ["", "_lod1", "_lod2"][clampi(lod, 0, 2)]]
	if info["family"] == "container":
		return "%sbottle_%s%s.glb" % [d, n, "_lod1" if lod >= 1 else ""]
	return info["glb"]


## Liquid data file for BottleLiquid.setup (mid / low LUT tables for containers at lower quality; LUT v2 file for v1 bottles).
static func liquid_sidecar(info: Dictionary, quality: int) -> String:
	var d: String = info["dir"]
	var n: String = info["name"]
	if info["family"] == "bottle":
		var p := "%sbottle_%s.liquid_v2.json" % [d, n]
		if _exists(p):
			return p
	if info["family"] == "container" and quality <= 2:
		var p2 := "%sbottle_%s.liquid.%s.json" % [d, n, "mid" if quality == 2 else "low"]
		if _exists(p2):
			return p2
	return "%sbottle_%s.liquid.json" % [d, n]


## Shell mesh of a model, same rule as BreakableBottle._build: "Glass*", else "Body*" (opaque containers: mug, jerrycan).
static func find_glass(model: Node) -> MeshInstance3D:
	var g := model.find_child("Glass*", true, false) as MeshInstance3D
	if g == null:
		g = model.find_child("Body*", true, false) as MeshInstance3D
	return g


static func swap_model(body: Node3D, path: String) -> void:
	var ps := load(path) as PackedScene
	if ps == null:
		return
	var nm := ps.instantiate() as Node3D
	var old: Node3D = body.model
	body.remove_child(old)
	old.queue_free()
	body.add_child(nm)
	body.model = nm
	body.glass_node = find_glass(nm)
	if body is BreakableBottle:
		body._cap_node = nm.find_child("Cap*", true, false) as MeshInstance3D
		body._label_node = nm.find_child("Label*", true, false) as MeshInstance3D


## Break profile for assets without *_break.json: derived from capacity, height and (v2) profile.json wall thickness / glass kind.
static func generic_profile(info: Dictionary) -> BottleBreakProfile:
	var p := BottleBreakProfile.new()
	var h: float = info["height_m"]
	var cap: float = info["capacity_ml"]
	p.bottle_name = info["name"]
	p.height = h
	p.capacity_ml = cap
	p.base_z = 0.04 * h
	p.body_z = 0.55 * h
	p.neck_z = 0.82 * h
	p.open_z = h
	p.broken_open_z = 0.8 * h
	var wall := 0.003
	var pj := "%sbottle_%s.profile.json" % [info["dir"], info["name"]]
	if info.get("design", false):
		pj = "%sbottle_%s.profile.json" % [ROOT + "v2/", info.get("base_name", "")]
	if FileAccess.file_exists(pj):
		var d = JSON.parse_string(FileAccess.get_file_as_string(pj))
		if d is Dictionary:
			var w: Dictionary = d.get("wall", {})
			if w.has("body"):
				wall = float(w["body"])
			if String(d.get("glass", "")).begins_with("pet"):
				p.material = "plastic"
				p.glass_density = 1380.0
				p.f_crit_ref = 900.0
	p.wall_m = wall
	var v := cap * 1.0e-6
	var r := sqrt(v / (PI * 0.6 * h))
	p.glass_mass = (2.0 * PI * r * h * 1.15 + 2.0 * PI * r * r) * wall * p.glass_density * 1.1
	return p


static func spawn(asset_id: String, opts := {}) -> Node3D:
	var info := resolve(asset_id, String(opts.get("design", "")))
	if info.is_empty():
		return null
	var fill := float(opts.get("fill", 0.6))
	var layer := int(opts.get("layer", LAYER_BOTTLE))
	var mask := int(opts.get("mask", MASK_BOTTLE))
	var body: Node3D
	var b := BreakableBottle.new()
	b.bottle_name = info["name"]
	b.asset_dir = info["dir"]
	b.fill = fill
	b.breakable = bool(opts.get("breakable", true))
	b.rng_seed = int(opts.get("seed", 0))
	b.bottle_layer = layer
	b.bottle_mask = mask
	b.free_on_break = true
	var is_container: bool = info["family"] == "container"
	if info.get("v1", false):
		b.profile = BottleBreakProfile.for_bottle(info.get("base_name", info["name"]))
		b.profile.bottle_name = info["name"]
	elif not is_container:
		b.profile = generic_profile(info)   # containers: BreakableBottle builds its own profile from *_break.json
	b._build()
	if not info.get("v1", false) and not is_container and b.glass_node:
		b.profile.set_from_mesh(BottleShardSource.total_area(b.glass_node.mesh), info["capacity_ml"])
		b._update_mass()
	body = b
	_tune_physics(body)
	if opts.has("position"):
		body.position = opts["position"]
	if opts.has("rotation_degrees"):
		body.rotation_degrees = opts["rotation_degrees"]
	body.set_meta("bottle_info", info)
	body.add_to_group("bottles")
	var bd := BottleBinding.new()
	bd.name = "Binding"
	bd.body = body
	bd.info = info
	bd.tier_override = int(opts.get("tier", -1))
	bd.carbonation = float(opts.get("carbonation", -1.0))
	bd.audio = bool(opts.get("audio", true))
	bd.lod_override = int(opts.get("lod", -1))
	if bool(opts.get("pour", true)):
		var pr := BottlePour.new()   # pours when open (containers, uncapped bottles); receives from other pourers
		pr.name = "Pour"
		pr.body = body
		body.add_child(pr)
		body.set_meta("pour", pr)
		bd.pour = pr
	body.add_child(bd)
	body.set_meta("binding", bd)
	return body


## Resting stability. The real cause of jittering bottles is Jolt's default penetration slop (20 mm) in project settings:
## set physics/jolt_physics_3d/simulation/penetration_slop = 0.002 (see docs/integration.md). Here: a small hull margin and damping.
static func _tune_physics(body: RigidBody3D) -> void:
	for c in body.get_children():
		if c is CollisionShape3D and (c as CollisionShape3D).shape:
			(c as CollisionShape3D).shape.margin = 0.002
	body.linear_damp = 0.1
	body.angular_damp = 0.5


## Re-evaluate distance LOD for every bottle (call when the camera moved a few metres; costs nothing otherwise).
static func refresh_all(tree: SceneTree) -> void:
	for b in tree.get_nodes_in_group("bottles"):
		if b.has_meta("binding"):
			(b.get_meta("binding") as BottleBinding).refresh()


## Swap the image of a label slot ("front", "back", "neck"...) on a designed bottle. Returns false when the slot is missing.
static func set_label_image(body: Node, slot: String, path: String) -> bool:
	if not ("model" in body):
		return false
	var mi := body.model.find_child("Label_" + slot, true, false) as MeshInstance3D
	if mi == null:
		return false
	var img := Image.load_from_file(path)
	if img == null:
		return false
	var m := mi.get_active_material(0)
	if m is BaseMaterial3D:
		m = m.duplicate()
		(m as BaseMaterial3D).albedo_texture = ImageTexture.create_from_image(img)
		mi.set_surface_override_material(0, m)
	mi.visible = true
	return true
