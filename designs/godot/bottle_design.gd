class_name BottleDesign
extends Node3D
## Runtime side of the bottle design system (see docs/bottle_designs.md).
##   var b := BottleDesign.load_design("res://designs/wine_classic.glb")   # GLB with embedded label textures
##   add_child(b);  b.set_fill(0.7)
##   b.list_slots()                         -> [{name, kind, width_mm, height_mm, aspect, arc_deg, material_kind, empty, visible}]
##   b.set_label_image("front", "C:/pics/my.png")   # path (png/jpg/webp), Image or Texture2D; works for any slot
##   b.set_label_tint("front", Color.ORANGE); b.set_label_visible("back", false); b.clear_label("neck")
## Needs bottle_liquid.gd/.gdshader/bottle_glass.gdshader (shaders/godot) in res:// root (BottleLiquid preloads them).
## The Liquid node is driven by BottleLiquid; remaining unsupported design settings are listed in UNSUPPORTED.

const LABEL_ROUGH := {"paper_matte": 0.85, "paper_gloss": 0.25, "foil_metal": 0.28, "clear_film": 0.12, "plastic_sleeve": 0.16, "tape": 0.4, "handwritten_tag": 0.95}

## TODO(owner of bottle_liquid.*): extras.liquid keys that are stored in the design but not yet used by the shader/controller.
const UNSUPPORTED := {
	"density": "not a rendering parameter; use mass_kg(fill) for gameplay",
}

var root: Node3D
var ctl: BottleLiquid
var design: Dictionary = {}      # <name>.design.json sidecar (may be empty)
var liquid_info: Dictionary = {}
var design_path := ""
var _labels := {}                # slot -> MeshInstance3D


var tier := "high"
var _base_path := ""
var _pending_fill := -1.0
var _want_liquid := true


static func tier_path(path: String, tier_name: String) -> String:
	## "res://designs/wine_classic.glb" + "low" -> "res://designs/wine_classic_low.glb" (high = the plain file)
	var base := path.get_basename()
	for t in ["_medium", "_low", "_minimal"]:
		if base.ends_with(t): base = base.trim_suffix(t)
	return base + ("" if tier_name == "high" else "_" + tier_name) + ".glb"


static func load_design(path: String, fill := -1.0, with_liquid := true, tier_name := "high") -> BottleDesign:
	## tiers: high (separate slot meshes, wear masks) | medium (no wear masks, <=512px) | low (ONE atlas mesh, no per-slot swap)
	##        | minimal (single tinted band). Draw calls / texture memory per tier: docs/bottle_designs.md
	var b := BottleDesign.new()
	b._base_path = path
	b._build(tier_path(path, tier_name), fill, with_liquid)
	b.tier = tier_name
	return b


func set_tier(tier_name: String) -> void:
	## rebuilds from the tier variant, keeping fill/colour state of the liquid (label swaps are lost: re-apply them)
	var f: float = ctl.fill if ctl else -1.0
	var had_liquid := ctl != null
	var old_bubble_size := ctl.bubble_size if ctl else -1.0
	var old_viscosity := ctl.viscosity if ctl else -1.0
	var old_tint_strength := ctl.tint_strength if ctl else -1.0
	var old_opacity := ctl.opacity if ctl else -1.0
	var old_foam_static := ctl.foam_static if ctl else -1.0
	for c in get_children(): c.queue_free()
	_labels.clear()
	ctl = null
	_build(tier_path(_base_path, tier_name), f, had_liquid)
	if ctl:
		ctl.bubble_size = old_bubble_size
		ctl.viscosity = old_viscosity
		ctl.tint_strength = old_tint_strength
		ctl.opacity = old_opacity
		ctl.foam_static = old_foam_static
	tier = tier_name


func supports_slot_swap() -> bool:
	return tier == "high" or tier == "medium"


func _build(path: String, fill: float, with_liquid: bool) -> void:
	var b := self
	design_path = path
	var ps := load(path) as PackedScene
	assert(ps != null, "BottleDesign: cannot load %s" % path)
	b.root = ps.instantiate()
	b.add_child(b.root)
	var side := path.get_basename() + ".design.json"
	if FileAccess.file_exists(side):
		b.design = JSON.parse_string(FileAccess.get_file_as_string(side))
	var liq_json := path.get_basename() + ".liquid.json"
	for n in b.root.find_children("Label_*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		var ex = mi.get_meta("extras", {})
		var slot := String(ex.get("slot", mi.name.trim_prefix("Label_")))
		b._labels[slot] = mi
		var m := mi.get_active_material(0)
		if m is BaseMaterial3D:
			mi.set_surface_override_material(0, m.duplicate())   # unique material per label: swapping never leaks
		if ex.get("empty", false):
			mi.visible = false
	_pending_fill = fill
	_want_liquid = with_liquid
	if with_liquid and is_inside_tree():
		_setup_liquid()


func _ready() -> void:
	if _want_liquid and ctl == null:
		_setup_liquid()   # BottleLiquid needs global transforms -> only once inside the tree


func _setup_liquid() -> void:
	ctl = BottleLiquid.new()
	add_child(ctl)
	var lj := design_path.get_basename() + ".liquid.json"
	ctl.setup(root, 0.6, lj if FileAccess.file_exists(lj) else "")
	liquid_info = ctl._info
	apply_liquid_settings(_pending_fill)


func apply_liquid_settings(fill := -1.0) -> void:
	## maps extras.liquid design values onto what BottleLiquid exposes today
	if ctl == null:
		return
	ctl.fill = fill if fill >= 0.0 else float(liquid_info.get("fill_default", 0.6))
	ctl.carbonation = float(liquid_info.get("carbonation", 0.0))
	ctl.foam_capacity = float(liquid_info.get("foam", 0.0))
	ctl.bubble_size = float(liquid_info.get("bubble_size", 1.0))
	ctl.viscosity = clampf(float(liquid_info.get("viscosity", 0.45)), 0.0, 1.0)
	ctl.tint_strength = clampf(float(liquid_info.get("tint_strength", 1.0)), 0.0, 4.0)
	ctl.opacity = clampf(float(liquid_info.get("opacity", 1.0)), 0.0, 1.0)
	ctl.foam_static = clampf(float(liquid_info.get("foam_static", 0.0)), 0.0, 1.0)
	# colour: setup() already uses extras.liquid.color; kept in sync by set_liquid_color()


func set_fill(f: float) -> void:
	if ctl: ctl.fill = f


func set_liquid_color(c: Color) -> void:
	if ctl == null or ctl.liquid == null: return
	var m := ctl.liquid.material_override as ShaderMaterial
	m.set_shader_parameter("liquid_color", c)
	m.set_shader_parameter("surface_color", c.lightened(0.12))


func mass_kg(fill: float = NAN) -> float:
	var raw_fill: float = ctl.fill if is_nan(fill) and ctl else (float(liquid_info.get("fill_default", 0.6)) if is_nan(fill) else fill)
	if not is_finite(raw_fill):
		return 0.0
	var f := clampf(raw_fill, 0.0, 1.0)
	var capacity := float(liquid_info.get("capacity_ml", 0.0))
	var density := float(liquid_info.get("density", 1.0))
	if not is_finite(capacity) or not is_finite(density) or capacity < 0.0 or density < 0.0:
		return 0.0
	var mass := capacity / 1000.0 * density * f
	return mass if is_finite(mass) else 0.0


# ------------------------------------------------------------------ labels
func list_slots() -> Array:
	var out := []
	for s in _labels:
		var mi: MeshInstance3D = _labels[s]
		var ex: Dictionary = mi.get_meta("extras", {})
		out.append({"name": s, "kind": ex.get("material_kind", ""), "material_kind": ex.get("material_kind", ""),
			"width_mm": float(ex.get("width_m", 0.0)) * 1000.0, "height_mm": float(ex.get("height_m", 0.0)) * 1000.0,
			"aspect": float(ex.get("aspect", 1.0)), "arc_deg": float(ex.get("arc_deg", 0.0)),
			"empty": ex.get("empty", false), "visible": mi.visible})
	out.sort_custom(func(a, b): return a["name"] < b["name"])
	return out


func slot_names() -> PackedStringArray:
	var n := PackedStringArray()
	for d in list_slots(): n.append(d["name"])
	return n


func has_slot(slot: String) -> bool:
	return _labels.has(slot)


func label_node(slot: String) -> MeshInstance3D:
	return _labels.get(slot)


static func _to_texture(src) -> Texture2D:
	if src is Texture2D: return src
	var img: Image
	if src is Image:
		img = src
	else:
		img = Image.load_from_file(String(src))   # absolute / res:// / user:// path; png jpg webp
		if img == null or img.is_empty(): return null
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


func set_label_image(slot: String, src, keep_tint := true) -> bool:
	## src: path String, Image or Texture2D. The image should have the slot's aspect (see list_slots()); sRGB.
	var mi: MeshInstance3D = _labels.get(slot)
	if mi == null: return false
	var tex := _to_texture(src)
	if tex == null: return false
	var m := mi.get_surface_override_material(0) as StandardMaterial3D
	m.albedo_texture = tex
	m.roughness_texture = null          # a previous wear mask does not fit the new art
	var kind := String(mi.get_meta("extras", {}).get("material_kind", "paper_matte"))
	m.roughness = LABEL_ROUGH.get(kind, 0.6)
	var img := tex.get_image()
	var alpha := kind == "clear_film" or (img != null and img.detect_alpha() != Image.ALPHA_NONE)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA if alpha else BaseMaterial3D.TRANSPARENCY_DISABLED
	if not keep_tint: m.albedo_color = Color.WHITE
	mi.visible = true
	return true


func set_label_tint(slot: String, c: Color) -> void:
	var mi: MeshInstance3D = _labels.get(slot)
	if mi: (mi.get_surface_override_material(0) as StandardMaterial3D).albedo_color = c


func set_label_visible(slot: String, on: bool) -> void:
	var mi: MeshInstance3D = _labels.get(slot)
	if mi: mi.visible = on


func clear_label(slot: String) -> void:
	set_label_visible(slot, false)
