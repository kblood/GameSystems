class_name GlassProfile
extends Resource
## Data-driven failure physics for one glass type (annealed, tempered, laminated, wired, resistant).
## All energy thresholds are joules at `ref_thickness_mm`, centre hit, 0.5 m span to the nearest support,
## hard ball striker with 2 cm contact radius. GlassDamageModel scales them (see docs/glass_system.md):
##   E_crack = crack_ref * (t/t_ref)^thickness_exp * f_span * f_edge * f_shape * flaw * f_damage
## Presets: GlassProfile.preset("annealed", 4.0). Override presets with load_json(path) (same keys as to_dict()).

@export var type_name := "annealed"
## Failure behaviour: annealed | tempered | laminated | wired | resistant
@export var mode := "annealed"
@export var thickness_mm := 4.0
@export var ref_thickness_mm := 4.0
@export var density := 2500.0
@export var young_gpa := 70.0
@export_group("Look")
@export var tint := Color(0.80, 0.92, 0.90, 0.07)          ## rgb body tint, a = base opacity at normal incidence
@export var edge_tint := Color(0.30, 0.55, 0.45)           ## colour of the cut edge (iron oxide green)
@export var frost := 0.0                                   ## laminated / resistant whitening around impacts (0..1)
@export var wire_spacing := 0.0                            ## m; >0 draws the wire mesh (wired glass)
@export_group("Thresholds (J at ref thickness)")
@export var chip_ref := 0.35                               ## local Hertzian chip / scuff onset (hard striker)
@export var crack_ref := 2.0                               ## radial + concentric cracks (blunt, global bending)
@export var break_mult := 1.8                              ## E_break = E_crack * break_mult (hole, pieces fall)
@export var shatter_mult := 6.0                            ## E_shatter = E_crack * shatter_mult (whole pane fails)
@export var thickness_exp := 2.0                           ## energy capacity ~ t^k
@export var perf_ref := 15.0                               ## fast small projectile perforation, 9 mm hard bullet
@export var perf_thickness_exp := 1.6
@export var point_ref := 2.5                               ## hard sharp point (sharpness 3) local failure
@export var punch_ref := 0.0                               ## laminated / wired / resistant: push a body through the interlayer
@export var edge_strength := 0.75                          ## strength factor right at a supported edge
@export var edge_zone := 0.06                              ## m over which the edge weakness fades out
@export var soft_k := 2.5                                  ## soft strikers spread load: f *= 1 + soft_k * (1 - hardness)
@export var span_ref := 0.5
@export var free_edge_factor := 0.7                        ## weaker when the nearest edge is unsupported
@export_group("Variation and fatigue")
@export var flaw_spread := 0.08
@export var big_flaw_chance := 0.05
@export var damage_weakening := 0.6                        ## thresholds *= 1 - w * D   (D = cumulative damage 0..1)
@export var near_weakening := 0.45                         ## thresholds *= 1 - w * near (near existing cracks / holes)
@export var bullet_damage := 0.14                          ## D added per bullet hole (x energy factor 0.6..1.6)
@export var resist_capacity := 0.0                         ## J; resistant glass: local capacity before a round gets through
@export_group("Pattern")
@export var radial_min := 7
@export var radial_max := 12
@export var ring_ratio := 1.75                             ## concentric crack spacing (geometric)
@export var crack_len_ref := 0.09                          ## m, bullet radial crack length scale
@export var ring_chance := 0.55                            ## share of concentric chords drawn for a CRACKED hit
@export var dice_size := 0.010                             ## m, tempered granule size
@export var exit_cone := 2.2                               ## exit crater radius = hole + exit_cone * t (Hertzian cone)
@export var hole_scale := 1.0
@export var absorb_mult := 1.0                             ## energy taken from a body passing through (x E_break)
@export var holds_pieces := false                          ## laminated / wired / resistant keep pieces in the frame

const KEYS := ["type_name", "mode", "thickness_mm", "ref_thickness_mm", "density", "young_gpa", "tint", "edge_tint",
	"frost", "wire_spacing", "chip_ref", "crack_ref", "break_mult", "shatter_mult", "thickness_exp", "perf_ref",
	"perf_thickness_exp", "point_ref", "punch_ref", "edge_strength", "edge_zone", "soft_k", "span_ref",
	"free_edge_factor", "flaw_spread", "big_flaw_chance", "damage_weakening", "near_weakening", "bullet_damage",
	"resist_capacity", "radial_min", "radial_max", "ring_ratio", "crack_len_ref", "ring_chance", "dice_size",
	"exit_cone", "hole_scale", "absorb_mult", "holds_pieces"]

## Built-in defaults. Numbers are documented and calibrated in docs/glass_system.md (calibration_report.json).
const PRESETS := {
	"annealed": {"mode": "annealed", "ref_thickness_mm": 4.0, "thickness_mm": 4.0},
	"tempered": {"mode": "tempered", "ref_thickness_mm": 4.0, "thickness_mm": 5.0, "chip_ref": 0.6, "crack_ref": 28.0,
		"break_mult": 1.0, "shatter_mult": 1.0, "perf_ref": 4.0, "point_ref": 0.18, "edge_strength": 0.22,
		"edge_zone": 0.05, "bullet_damage": 1.0, "absorb_mult": 0.25, "tint": Color(0.78, 0.90, 0.88, 0.08)},
	"laminated": {"mode": "laminated", "ref_thickness_mm": 5.0, "thickness_mm": 5.0, "chip_ref": 0.5, "crack_ref": 2.5,
		"break_mult": 1.0, "shatter_mult": 1.0, "perf_ref": 45.0, "punch_ref": 180.0, "point_ref": 2.5,
		"edge_strength": 0.8, "frost": 1.0, "radial_min": 14, "radial_max": 22, "ring_ratio": 1.45,
		"crack_len_ref": 0.07, "ring_chance": 0.9, "bullet_damage": 0.08, "absorb_mult": 1.0, "holds_pieces": true,
		"tint": Color(0.80, 0.90, 0.88, 0.09)},
	"wired": {"mode": "wired", "ref_thickness_mm": 6.0, "thickness_mm": 6.0, "crack_ref": 2.6, "perf_ref": 25.0,
		"punch_ref": 120.0, "wire_spacing": 0.0125, "bullet_damage": 0.12, "holds_pieces": true, "edge_strength": 0.7},
	"resistant": {"mode": "resistant", "ref_thickness_mm": 30.0, "thickness_mm": 30.0, "chip_ref": 3.0,
		"crack_ref": 60.0, "break_mult": 1.0, "shatter_mult": 1.0, "perf_ref": 2400.0, "punch_ref": 6000.0,
		"point_ref": 40.0, "frost": 0.8, "resist_capacity": 3000.0, "radial_min": 9, "radial_max": 14,
		"crack_len_ref": 0.12, "ring_chance": 0.8, "bullet_damage": 0.0, "edge_strength": 0.9, "exit_cone": 0.6,
		"holds_pieces": true, "tint": Color(0.72, 0.86, 0.82, 0.16)},
}

static var _overrides := {}


static func preset(name: String, thickness := -1.0) -> GlassProfile:
	var p := GlassProfile.new()
	var key := "annealed" if name == "float" else name
	p.type_name = key
	p.apply_dict(PRESETS.get(key, PRESETS["annealed"]))
	if _overrides.has(key):
		p.apply_dict(_overrides[key])
	if thickness > 0.0:
		p.thickness_mm = thickness
	return p


static func type_names() -> PackedStringArray:
	return PackedStringArray(PRESETS.keys())


## JSON: {"annealed": {"crack_ref": 2.2, ...}, ...}. Colours as [r, g, b, a].
static func load_json(path: String) -> bool:
	if not FileAccess.file_exists(path):
		return false
	var d = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not d is Dictionary:
		return false
	for k in d:
		_overrides[k] = d[k]
	return true


func apply_dict(d: Dictionary) -> void:
	for k in d:
		if not k in KEYS:
			continue
		var v = d[k]
		if get(k) is Color and v is Array:
			v = Color(v[0], v[1], v[2], v[3] if v.size() > 3 else 1.0)
		elif get(k) is int and v is float:
			v = int(v)
		set(k, v)


func to_dict() -> Dictionary:
	var d := {}
	for k in KEYS:
		var v = get(k)
		d[k] = [v.r, v.g, v.b, v.a] if v is Color else v
	return d


func t_m() -> float:
	return thickness_mm * 0.001


## Areal mass kg/m2.
func areal_mass() -> float:
	return density * t_m()


func thickness_factor() -> float:
	return pow(thickness_mm / ref_thickness_mm, thickness_exp)


## Seeded hidden flaw: strength factor around 1 (rare big flaws 0.6..0.8).
func roll_flaw(rng: RandomNumberGenerator) -> float:
	if rng.randf() < big_flaw_chance:
		return rng.randf_range(0.6, 0.8)
	return clampf(1.0 + rng.randfn(0.0, flaw_spread), 0.8, 1.2)
