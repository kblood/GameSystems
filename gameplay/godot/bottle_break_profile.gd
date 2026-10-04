class_name BottleBreakProfile
extends Resource
## FORCE ASSESSMENT for one bottle type: how hard must it be hit to break?
##
## Contact model (linearised Hertz, engine quantities only):
##   m_eff  = reduced mass of bottle (glass + cap + liquid_coupling * liquid) and striker (INF for static world)
##   k_eff  = series stiffness of striker surface (stiffens when it bottoms out) and the bottle wall
##   F_peak = v_n * sqrt(k_eff * m_eff)            (E = 0.5 m v^2 = F^2 / 2k, so the mass enters through the energy)
##   F_crit = f_crit_ref * (wall/ref_wall)^p * zone_factor(y) / sharpness * flaw * (1 - fatigue_weakening * D)
##   ratio  = F_peak / F_crit      < crack_start: nothing | < 1: cracks (damage D += fatigue_gain * ratio^3)
##                                 >= 1: breaks (neck snap or shatter, see assess())
## v_n comes from the contact impulse (J = m_eff (1+e) v_n) and/or the pre-impact velocity history.
## Surface/striker hardness = k_s (N/m); bottom_v = speed where a soft surface "bottoms out" on the floor below.

enum Outcome { NONE, CRACK, NECK_SNAP, SHATTER, DENT, PIERCE }
enum Zone { BASE, BODY, SHOULDER, NECK }

const G := 9.81

## surface name -> { k: stiffness N/m, bottom_v: m/s where it bottoms out, sharp: default striker sharpness }
const SURFACES := {
	"concrete": {"k": 8.0e6, "bottom_v": 999.0, "sharp": 1.0},
	"stone": {"k": 8.0e6, "bottom_v": 999.0, "sharp": 1.1},
	"metal": {"k": 6.0e6, "bottom_v": 999.0, "sharp": 1.0},
	"tile": {"k": 6.0e6, "bottom_v": 999.0, "sharp": 1.0},
	"glass": {"k": 1.2e6, "bottom_v": 999.0, "sharp": 0.9},
	"bottle": {"k": 1.2e6, "bottom_v": 999.0, "sharp": 0.9},
	"wood": {"k": 8.0e5, "bottom_v": 8.0, "sharp": 1.0},
	"plastic": {"k": 3.0e5, "bottom_v": 8.0, "sharp": 0.9},
	"dirt": {"k": 1.5e5, "bottom_v": 6.0, "sharp": 0.9},
	"character": {"k": 3.0e4, "bottom_v": 3.0, "sharp": 0.8},
	"carpet": {"k": 4.0e4, "bottom_v": 4.5, "sharp": 0.8},
}

@export var bottle_name := "wine"
@export var material := "glass"                    ## glass | plastic (plastic never shatters)
@export var wall_m := 0.003
@export var ref_wall_m := 0.003
@export var wall_exponent := 1.2                   ## strength ~ wall^p (bending stress ~ F / t^p)
@export var wall_stiff_ref := 1.2e6                ## local shell stiffness at ref wall (N/m)
@export var f_crit_ref := 4300.0                   ## peak contact force that breaks a 3 mm wall, body zone (N)
@export var glass_density := 2500.0
@export var glass_mass := 0.5                      ## kg (recomputed from the mesh area by set_from_mesh)
@export var cap_mass := 0.01
@export var liquid_density := 1000.0               ## kg/m3 (break.json: liquid_mass_per_ml * 1e3)
@export var capacity_ml := 700.0
@export var liquid_coupling := 0.5                 ## share of the liquid mass acting at impact (not rigid)
@export var height := 0.34
@export var base_z := 0.012                        ## zone borders along the bottle axis (m)
@export var body_z := 0.19
@export var neck_z := 0.277
@export var open_z := 0.34                         ## intact mouth height
@export var broken_open_z := -1.0                  ## rim height of the pre-fractured neck-snap variant (break.json open_z)
@export var weak_zone_weight := 0.5
@export var zone_factor := {Zone.BASE: 1.4, Zone.BODY: 1.0, Zone.SHOULDER: 0.85, Zone.NECK: 0.55}
@export var weak_zones: Array = []                 ## [{name, z0, z1, thinness}] (break.json); thinness>1 = more fragile
@export var flaw_spread := 0.07                    ## stddev of the hidden per-bottle strength factor
@export var big_flaw_chance := 0.05                ## chance of a serious hidden flaw (strength x0.6..0.8)
@export var hit_noise := 0.04                      ## per-hit random strength jitter
@export var crack_start := 0.5                     ## ratio where hits start to add damage
@export var fatigue_gain := 0.5                    ## dD = gain * ratio^3 for sub-threshold hits
@export var fatigue_weakening := 0.5               ## F_crit *= 1 - weakening * D
@export var snap_ratio_max := 1.8                  ## neck/shoulder hits below this ratio snap, above shatter
@export var min_bullet_energy := 8.0               ## J; below that a bullet only cracks (BB / airsoft)
@export var neck_bullet_energy := 150.0            ## J; neck hits below this only snap the neck
@export var shard_energy_fraction := 0.15          ## share of impact energy that becomes shard kinetic energy
@export var liquid_burst := 3.0                    ## extra burst factor for a filled bottle hit by a bullet
@export var min_mass_scale := 0.25                 ## floor for the point effective-mass share (end / slap-down hits)
@export var shatters := true                      ## false: ceramic mug / plastic jerrycan / PET: dent or leak, no shards
@export var leak_ratio := INF                      ## non-shattering: impact ratio that cracks/pierces the shell -> leak
@export var leak_hole_m := 0.003                   ## radius of that leak hole
@export var calib_v := -1.0                        ## >0: f_crit_ref is solved so this v_n breaks it (calib_* below)
@export var calib_fill := 1.0
@export var calib_surface := "concrete"
var has_neck := true                               ## false (tumbler, tank, jar-like): rim hits shatter, never neck-snap
var mass_from_json := false                        ## break.json gave the measured shell mass: set_from_mesh keeps it


static func for_bottle(name: String) -> BottleBreakProfile:
	var p := BottleBreakProfile.new()
	p.bottle_name = name
	match name:
		"wine":
			p.wall_m = 0.003; p.height = 0.34; p.base_z = 0.012; p.body_z = 0.19; p.neck_z = 0.277; p.open_z = 0.34
		"beer":
			p.wall_m = 0.0025; p.height = 0.256; p.base_z = 0.010; p.body_z = 0.135; p.neck_z = 0.205; p.open_z = 0.256
		"whiskey":
			p.wall_m = 0.004; p.height = 0.226; p.base_z = 0.010; p.body_z = 0.135; p.neck_z = 0.19; p.open_z = 0.226
		"jar":
			p.wall_m = 0.003; p.height = 0.122; p.base_z = 0.012; p.body_z = 0.090; p.neck_z = 0.108; p.open_z = 0.122
		"flask":
			p.wall_m = 0.002; p.height = 0.202; p.base_z = 0.012; p.body_z = 0.085; p.neck_z = 0.155; p.open_z = 0.202
		"soda":
			p.material = "plastic"; p.wall_m = 0.0012; p.height = 0.262; p.base_z = 0.014; p.body_z = 0.14
			p.neck_z = 0.232; p.open_z = 0.262; p.glass_density = 1380.0; p.f_crit_ref = 900.0
			p.zone_factor = {Zone.BASE: 1.2, Zone.BODY: 1.0, Zone.SHOULDER: 1.0, Zone.NECK: 0.9}
	return p


## Mass from the mesh: the Glass mesh is a double shell, so shell area = triangle area / 2.
func set_from_mesh(glass_tri_area: float, capacity := -1.0) -> void:
	if capacity > 0.0:
		capacity_ml = capacity
	if not mass_from_json:
		glass_mass = 0.5 * glass_tri_area * wall_m * glass_density * 1.12   # +12 % thick base / finish
	calibrate()


## break.json "calibration": solve f_crit_ref (closed form) so a hit at calib_v on calib_surface, mid body, fill
## calib_fill, flaw 1, is exactly the threshold. Keeps every bottle / container at ~the v1 wine drop strength.
func calibrate() -> void:
	if calib_v <= 0.0:
		return
	var y := 0.5 * (base_z + body_z)
	var m := self_mass(calib_fill)
	var k := contact_stiffness(calib_surface, calib_v)
	var sharp := float(surface_info(calib_surface)["sharp"])
	f_crit_ref = calib_v * sqrt(k * m) * sharp / (pow(wall_m / ref_wall_m, wall_exponent) * strength_at(y))


## Apply a bottle_<name>_break.json from the fracture pipeline.
## Keys used: wall_thickness_m, glass_mass_kg | shell_mass_kg, liquid_mass_kg_per_ml, capacity_ml, height_m, base_z, shoulder_z
## (= end of the body zone), neck_z, open_z (= rim height of the *broken* variant, kept in broken_open_z), weak_zones[].
## weak_zones[].thinness is the pipeline's fragility factor (>1 breaks more easily); it scales strength_at() by
## thinness^-weak_zone_weight on top of the zone factors (weight 0.5 keeps the physical "necks are weak" ordering).
func apply_break_json(d: Dictionary) -> void:
	wall_m = float(d.get("wall_thickness_m", d.get("wall", wall_m)))
	glass_mass = float(d.get("glass_mass_kg", d.get("shell_mass_kg", d.get("glass_mass", glass_mass))))
	if d.has("liquid_mass_kg_per_ml"):
		liquid_density = float(d["liquid_mass_kg_per_ml"]) * 1.0e6
	capacity_ml = float(d.get("capacity_ml", capacity_ml))
	height = float(d.get("height_m", height))
	base_z = float(d.get("base_z", base_z))
	body_z = float(d.get("shoulder_z", body_z))
	neck_z = float(d.get("neck_z", neck_z))
	broken_open_z = float(d.get("open_z", broken_open_z))
	weak_zones = d.get("weak_zones", weak_zones)
	# fracture_glb.py keys (v2 bottles, containers, whiskey re-run); v1 files without them behave as before
	var mat := String(d.get("material", ""))
	if mat in ["glass", "plastic", "ceramic", "metal"]:
		material = mat
		glass_density = float(d.get("density_kg_m3", glass_density))
	if d.has("shatters"):
		shatters = bool(d["shatters"]) and material != "plastic"
	if d.has("glass_mass_kg") or d.has("shell_mass_kg"):
		mass_from_json = true
	if d.has("has_neck"):
		open_z = height
	var zf: Dictionary = d.get("zone_factor", {})
	for zn in zf:
		var zi := ["base", "body", "shoulder", "neck"].find(String(zn))
		if zi >= 0:
			zone_factor[zi] = float(zf[zn])
	var lk: Dictionary = d.get("leak", {})
	if not lk.is_empty():
		leak_ratio = float(lk.get("ratio", 1.0))
		leak_hole_m = float(lk.get("hole_r_m", leak_hole_m))
	var cb: Dictionary = d.get("calibration", {})
	if not cb.is_empty():
		calib_v = float(cb.get("v_n", 4.3))
		calib_fill = float(cb.get("fill", 1.0))
		calib_surface = String(cb.get("surface", "concrete"))
	calibrate()


func liquid_mass(fill: float) -> float:
	return capacity_ml * 1.0e-6 * liquid_density * clampf(fill, 0.0, 1.0)


func total_mass(fill: float) -> float:
	return glass_mass + cap_mass + liquid_mass(fill)


## Mass taking part in an impact (liquid only partly coupled).
func self_mass(fill: float) -> float:
	return glass_mass + cap_mass + liquid_coupling * liquid_mass(fill)


func zone_at(y: float) -> int:
	if y < base_z:
		return Zone.BASE
	if y < body_z:
		return Zone.BODY
	if y < neck_z:
		return Zone.SHOULDER
	return Zone.NECK


func zone_name(z: int) -> String:
	return ["base", "body", "shoulder", "neck"][z]


## Strength factor at height y: zone factor x weak-zone thinness^p (if the fracture pipeline gave any).
func strength_at(y: float) -> float:
	var f: float = zone_factor[zone_at(y)]
	for wz in weak_zones:
		if y >= float(wz.get("z0", 1e9)) and y <= float(wz.get("z1", -1e9)):
			f *= pow(maxf(float(wz.get("thinness", 1.0)), 0.1), -weak_zone_weight)
	return f


static func surface_info(surface: String) -> Dictionary:
	return SURFACES.get(surface, SURFACES["concrete"])


func f_crit_base() -> float:
	return f_crit_ref * pow(wall_m / ref_wall_m, wall_exponent)


## Effective contact stiffness (surface bottoms out above bottom_v, then series with the bottle wall).
func contact_stiffness(surface: String, v_n: float) -> float:
	var s := surface_info(surface)
	var bv: float = float(s["bottom_v"])
	var ks: float = float(s["k"]) * (1.0 + (v_n / bv) * (v_n / bv))
	var kw := wall_stiff_ref * (wall_m / ref_wall_m)
	return 1.0 / (1.0 / ks + 1.0 / kw)


## Core assessment. h: v_n (m/s), y (hit height on the axis, m), fill, surface (String), striker_mass (kg, INF = static),
## sharp (<0 = surface default; 1 flat, 1.6 edge, 2.5 point), damage (0..1), flaw (strength factor), noise (extra factor).
func assess(h: Dictionary) -> Dictionary:
	var v: float = h.get("v_n", 0.0)
	var fill: float = h.get("fill", 0.5)
	var y: float = h.get("y", body_z * 0.5)
	var surface: String = h.get("surface", "concrete")
	var m_s: float = h.get("striker_mass", INF)
	var sharp: float = h.get("sharp", -1.0)
	if sharp <= 0.0:
		sharp = float(surface_info(surface)["sharp"])
	var damage: float = h.get("damage", 0.0)
	var flaw: float = float(h.get("flaw", 1.0)) * float(h.get("noise", 1.0))
	var m_b := self_mass(fill) * clampf(float(h.get("mass_scale", 1.0)), min_mass_scale, 1.0)
	var m_eff := m_b if is_inf(m_s) else m_b * m_s / (m_b + m_s)
	var k := contact_stiffness(surface, v)
	var f_peak := v * sqrt(k * m_eff)
	var zone := zone_at(y)
	var f_crit := f_crit_base() * strength_at(y) / sharp * flaw * (1.0 - fatigue_weakening * damage)
	var ratio := f_peak / maxf(f_crit, 1.0)
	var out := {"v_n": v, "y": y, "zone": zone, "zone_name": zone_name(zone), "surface": surface, "sharp": sharp,
		"m_eff": m_eff, "k_eff": k, "energy": 0.5 * m_eff * v * v, "f_peak": f_peak, "f_crit": f_crit,
		"ratio": ratio, "d_damage": 0.0, "outcome": Outcome.NONE}
	if material == "plastic" or not shatters:
		if ratio >= leak_ratio:
			out["outcome"] = Outcome.PIERCE          # shell cracked / punctured: the bottle leaks (BreakableBottle._resolve)
		else:
			out["outcome"] = Outcome.DENT if ratio >= crack_start else Outcome.NONE
		return out
	if ratio >= 1.0 or damage >= 1.0:
		var snap := has_neck and (zone == Zone.NECK or (zone == Zone.SHOULDER and ratio < 1.2)) and ratio < snap_ratio_max
		out["outcome"] = Outcome.NECK_SNAP if snap else Outcome.SHATTER
	elif ratio >= crack_start:
		out["d_damage"] = fatigue_gain * ratio * ratio * ratio
		out["outcome"] = Outcome.CRACK
	return out


## Impact speed (m/s) that breaks it for a given contact (flaw 1, no damage). INF if > 300 m/s.
func critical_speed(surface: String, fill: float, y: float, striker_mass := INF, sharp := -1.0,
		flaw := 1.0, damage := 0.0) -> float:
	var h := {"fill": fill, "y": y, "surface": surface, "striker_mass": striker_mass, "sharp": sharp,
		"flaw": flaw, "damage": damage}
	h["v_n"] = 300.0
	if material == "plastic" or not shatters or float(assess(h)["ratio"]) < 1.0:
		return INF
	var lo := 0.0
	var hi := 300.0
	for i in 40:
		var mid := 0.5 * (lo + hi)
		h["v_n"] = mid
		if float(assess(h)["ratio"]) >= 1.0:
			hi = mid
		else:
			lo = mid
	return hi


func critical_drop_height(surface: String, fill: float, y: float) -> float:
	var v := critical_speed(surface, fill, y)
	return INF if is_inf(v) else v * v / (2.0 * G)


## Bullet assessment: any glass bottle breaks from a real bullet; plastic is pierced.
func assess_bullet(energy_j: float, y: float, fill: float) -> Dictionary:
	var zone := zone_at(y)
	var out := {"energy": energy_j, "y": y, "zone": zone, "zone_name": zone_name(zone), "outcome": Outcome.NONE,
		"burst_energy": energy_j * (1.0 + liquid_burst * clampf(fill, 0.0, 1.0)), "d_damage": 0.0}
	if material == "plastic" or not shatters:
		out["outcome"] = Outcome.PIERCE
	elif energy_j < min_bullet_energy:
		out["outcome"] = Outcome.CRACK
		out["d_damage"] = clampf(energy_j / min_bullet_energy, 0.2, 0.9)
	elif zone == Zone.NECK and energy_j < neck_bullet_energy:
		out["outcome"] = Outcome.NECK_SNAP
	else:
		out["outcome"] = Outcome.SHATTER
	return out


## Per-bottle hidden flaw (seeded): strength factor around 1.
func roll_flaw(rng: RandomNumberGenerator) -> float:
	if rng.randf() < big_flaw_chance:
		return rng.randf_range(0.6, 0.8)
	return clampf(1.0 + rng.randfn(0.0, flaw_spread), 0.8, 1.15)
