class_name GlassDamageModel
extends RefCounted
## Analytic, deterministic impact assessment for a glass pane. Pure functions (no scene access): used by GlassPane,
## the calibration and the unit tests. Formulas and default numbers: docs/glass_system.md.
##
##   v_n      = |v . n|, cos = v_n / |v|, E_n = 1/2 m v_n^2 (1 - deform)            normal energy delivered
##   f_t      = (t / t_ref)^k_t                                                      thickness
##   f_span   = clamp(sqrt(R / span_ref), 0.6, 1.5)   R = distance to the nearest supported edge (plate compliance)
##   f_edge   = lerp(edge_strength, 1, smoothstep(0, edge_zone, d_edge))             edge flaws / tempering edge
##   f_shape  = sharp^-0.8 * (1 + soft_k (1 - min(H,1))) * clamp(a/0.02, 0.25, 6)^0.25   load spreading
##   f_dmg    = max(0.15, (1 - w_d D) (1 - w_n near))                                fatigue / nearby cracks
##   E_crack  = crack_ref f_t f_span f_edge f_shape flaw f_dmg       (blunt, global bending)
##   E_point  = point_ref f_t^0.5 flaw f_dmg (3/sharp)^2             (hard sharp points, H >= 1, sharp >= 1.8)
##   E_chip   = chip_ref (t/t_ref)^0.5 / sharp^2                     (H >= 0.5 only)
##   E_break  = E_crack break_mult,  E_shatter = E_crack shatter_mult
##   E_perf   = perf_ref (t/t_ref)^k_p (d / 9 mm)^0.9 (1 + deform) / max(H,0.3)^0.5 f_edge^0.3 f_dmg   (projectiles)
## Projectiles (fast & light: speed > 60 m/s, mass < 0.1 kg) use the local perforation branch.

enum Outcome { NONE, CHIP, CRACKED, PUNCHED, SHATTERED }
const OUTCOME_NAMES := ["none", "chip", "cracked", "punched", "shattered"]
const RICOCHET_COS := 0.26            ## grazing below ~15 deg from the surface can ricochet
const PROJECTILE_SPEED := 60.0


static func outcome_name(o: int) -> String:
	return OUTCOME_NAMES[clampi(o, 0, 4)]


## ctx keys: d_edge (m to nearest supported edge), span (m), free_edge (bool), damage (0..1), near (0..1),
## flaw (strength factor), local_damage (0..1, resistant glass), noise (per-hit factor, default 1).
static func thresholds(p: GlassProfile, ctx: Dictionary, imp: GlassImpact) -> Dictionary:
	var t_ratio := p.thickness_mm / p.ref_thickness_mm
	var f_t := pow(t_ratio, p.thickness_exp)
	var span: float = ctx.get("span", p.span_ref)
	var f_span := clampf(sqrt(maxf(span, 0.0) / p.span_ref), 0.6, 1.5)
	var d_edge: float = ctx.get("d_edge", 1.0)
	var f_edge := lerpf(p.edge_strength, 1.0, smoothstep(0.0, p.edge_zone, d_edge))
	if ctx.get("free_edge", false):
		f_edge *= p.free_edge_factor
	var sharp := imp.sharpness()
	var H := imp.hardness
	var f_shape := pow(sharp, -0.8) * (1.0 + p.soft_k * (1.0 - minf(H, 1.0))) * pow(clampf(imp.contact / 0.02, 0.25, 6.0), 0.25)
	var D: float = ctx.get("damage", 0.0)
	var near: float = ctx.get("near", 0.0)
	var f_dmg := maxf(0.15, (1.0 - p.damage_weakening * D) * (1.0 - p.near_weakening * near))
	var flaw: float = float(ctx.get("flaw", 1.0)) * float(ctx.get("noise", 1.0))
	var e_crack := p.crack_ref * f_t * f_span * f_edge * f_shape * flaw * f_dmg
	var e_point := INF
	if H >= 1.0 and sharp >= 1.8:
		e_point = p.point_ref * sqrt(f_t) * flaw * f_dmg * pow(3.0 / sharp, 2.0) * f_edge
		e_crack = minf(e_crack, e_point)
	var e_chip := INF if H < 0.5 else p.chip_ref * sqrt(t_ratio) / (sharp * sharp)
	var cal := imp.caliber if imp.caliber > 0.0 else imp.contact * 2.0
	var loc: float = ctx.get("local_damage", 0.0)
	var e_perf := p.perf_ref * pow(t_ratio, p.perf_thickness_exp) * pow(cal / 0.009, 0.9) * (1.0 + imp.deform) \
		/ sqrt(maxf(H, 0.3)) * pow(f_edge, 0.3) * f_dmg * (1.0 - 0.85 * loc)
	var e_punch := INF
	if p.punch_ref > 0.0:
		e_punch = p.punch_ref * pow(t_ratio, 1.5) * pow(sharp, -0.6) * pow(clampf(imp.contact / 0.02, 0.25, 6.0), 0.3) \
			* (1.0 + 0.5 * p.soft_k * (1.0 - minf(H, 1.0))) * f_dmg * (1.0 - 0.85 * loc)
	return {"chip": e_chip, "crack": e_crack, "break": e_crack * p.break_mult, "shatter": e_crack * p.shatter_mult,
		"perf": e_perf, "punch": e_punch, "point": e_point, "f_t": f_t, "f_span": f_span, "f_edge": f_edge,
		"f_shape": f_shape, "f_dmg": f_dmg}


## Normal of the pane in world space must be in ctx["normal"] (any side). Returns the assessment dictionary:
## outcome, pass_through, ricochet, residual_velocity (world), hole_radius, crater_entry, crater_exit, crack_length,
## radials, rings, drop_radius, d_damage, d_local, energy, energy_n, momentum, thresholds, mode, bulge.
static func assess(p: GlassProfile, ctx: Dictionary, imp: GlassImpact) -> Dictionary:
	var n: Vector3 = ctx.get("normal", Vector3.BACK)
	var v := imp.velocity
	var speed := v.length()
	var dir := imp.dir()
	var cos_i := absf(dir.dot(n))
	var v_n := speed * cos_i
	var into := -n if dir.dot(n) < 0.0 else n            # direction of travel through the pane
	var v_t := v - into * v_n
	var e_full := 0.5 * imp.mass * speed * speed
	var e_n := 0.5 * imp.mass * v_n * v_n * (1.0 - imp.deform)
	var th := thresholds(p, ctx, imp)
	var proj := imp.projectile or (speed > PROJECTILE_SPEED and imp.mass < 0.1)
	var t := p.t_m()
	var r := {"outcome": Outcome.NONE, "pass_through": false, "ricochet": false, "residual_velocity": Vector3.ZERO,
		"hole_radius": 0.0, "crater_entry": 0.0, "crater_exit": 0.0, "crack_length": 0.0, "radials": 0, "rings": 0,
		"drop_radius": 0.0, "d_damage": 0.0, "d_local": 0.0, "energy": e_full, "energy_n": e_n,
		"momentum": imp.mass * speed, "v_n": v_n, "cos": cos_i, "thresholds": th, "mode": p.mode,
		"projectile": proj, "bulge": 0.0, "frost_radius": 0.0, "kind": &"", "deflect_deg": 0.0}
	var D: float = ctx.get("damage", 0.0)
	var seedf: float = ctx.get("noise", 1.0)
	if proj:
		_assess_projectile(p, r, th, imp, e_n, v, v_n, v_t, into, cos_i, t, D)
	else:
		_assess_blunt(p, r, th, imp, e_n, v, v_n, v_t, into, t, D, ctx)
	r["seed_noise"] = seedf
	return r


static func _crack_len(p: GlassProfile, e: float, e_ref: float) -> float:
	return p.crack_len_ref * pow(maxf(e / maxf(e_ref, 1e-4), 0.0), 0.35) * pow(p.ref_thickness_mm / p.thickness_mm, 0.3)


static func _radials(p: GlassProfile, x: float) -> int:
	return clampi(int(round(lerpf(float(p.radial_min), float(p.radial_max), clampf(x, 0.0, 1.0)))), 3, 32)


static func _assess_projectile(p: GlassProfile, r: Dictionary, th: Dictionary, imp: GlassImpact, e_n: float, v: Vector3,
		v_n: float, v_t: Vector3, into: Vector3, cos_i: float, t: float, D: float) -> void:
	var e_perf: float = th["perf"]
	var e_chip: float = minf(th["chip"], e_perf * 0.05)
	var cal := maxf(imp.caliber, imp.contact * 2.0)
	if cos_i < RICOCHET_COS and e_n < e_perf * 1.5:
		# grazing: skips off, leaves a gouge
		r["ricochet"] = true
		r["residual_velocity"] = v_t * 0.8 - into * v_n * 0.25
		if e_n > e_chip:
			r["outcome"] = Outcome.CHIP
			r["crater_entry"] = cal * 1.2
			r["crack_length"] = _crack_len(p, e_n, e_perf) * 0.4
			r["radials"] = 3
			r["d_damage"] = 0.03
		return
	if e_n < e_chip:
		r["residual_velocity"] = -into * v_n * 0.2 + v_t * 0.3     # bounces off (airsoft)
		return
	if p.mode == "tempered":
		r["outcome"] = Outcome.SHATTERED if e_n >= e_perf else Outcome.CHIP
		r["crater_entry"] = cal
		if e_n >= e_perf:
			r["kind"] = &"dice"
			_pass(r, imp, v, v_n, v_t, into, e_perf, 0.0, 1.0)
			r["hole_radius"] = cal * 0.5
		else:
			r["d_damage"] = 0.15 * e_n / e_perf
		return
	if e_n < e_perf:
		# stopped in / by the glass: star with crater, no hole (BB on thick glass, rounds in resistant glass)
		var res := p.mode == "resistant"
		# bullet-resistant: the round flattens in the strike ply -> wide white crushed splash + short radials
		r["outcome"] = Outcome.CRACKED if e_n > e_perf * (0.05 if res else 0.25) else Outcome.CHIP
		r["crater_entry"] = cal * ((2.6 + 3.0 * e_n / e_perf) if res else (1.3 + 0.8 * e_n / e_perf))
		r["crater_exit"] = (cal * 0.5 + p.exit_cone * t * 0.6) * (e_n / e_perf) if p.mode == "resistant" else 0.0
		r["crack_length"] = _crack_len(p, e_n, e_perf * 0.35)
		r["radials"] = _radials(p, e_n / e_perf)
		r["rings"] = 1 + int(2.0 * e_n / e_perf)
		r["frost_radius"] = p.frost * cal * (1.5 + 2.5 * e_n / e_perf) if not res else cal * (3.5 + 4.0 * e_n / e_perf)
		r["d_damage"] = p.bullet_damage * 0.5
		if p.resist_capacity > 0.0:
			r["d_local"] = e_n / p.resist_capacity
		r["residual_velocity"] = Vector3.ZERO
		return
	r["outcome"] = Outcome.PUNCHED
	r["kind"] = &"bullet"
	var deform_k := 1.0 + 0.4 * imp.deform
	r["hole_radius"] = 0.5 * cal * deform_k * p.hole_scale
	var ex := clampf(e_n / (8.0 * e_perf), 0.0, 1.0)
	r["crater_entry"] = r["hole_radius"] * (1.35 + 0.25 * ex)
	r["crater_exit"] = r["hole_radius"] + p.exit_cone * t * (0.65 + 0.35 * ex)
	var e_dep := e_perf + 0.02 * e_n
	r["crack_length"] = _crack_len(p, e_dep, th["crack"]) if p.mode != "resistant" else _crack_len(p, e_dep, e_perf * 0.3)
	r["radials"] = _radials(p, e_dep / (e_perf * 3.0))
	r["rings"] = 1 + int(clampf(e_dep / (e_perf * 2.0), 0.0, 2.0))
	r["frost_radius"] = p.frost * cal * (2.0 + 1.5 * ex)
	# heavier rounds leave longer radials that link up sooner: 9 mm ~1.0, 5.56 ~1.5, .22 ~0.8
	var d_bullet := p.bullet_damage * clampf(pow(e_n / maxf(e_perf * 30.0, 1e-3), 0.3), 0.6, 1.6)
	r["d_damage"] = d_bullet
	if p.resist_capacity > 0.0:
		r["d_local"] = e_n / p.resist_capacity
	r["deflect_deg"] = 0.6 + 5.0 * (1.0 - cos_i)
	_pass(r, imp, v, v_n, v_t, into, e_perf, 0.0, 1.0)
	if p.mode == "annealed" and D + d_bullet >= 1.0:
		r["outcome"] = Outcome.SHATTERED          # cumulative: the crack network links up, the pane collapses
		r["kind"] = &"collapse"
		r["drop_radius"] = 10.0


## Residual velocity after losing e_abs (J) in the glass and sharing momentum with a plug of glass.
static func _pass(r: Dictionary, imp: GlassImpact, v: Vector3, v_n: float, v_t: Vector3, into: Vector3, e_abs: float,
		plug_mass: float, t_keep: float) -> void:
	var m := imp.mass
	var vn2 := v_n * v_n - 2.0 * e_abs / maxf(m * (1.0 - imp.deform * 0.5), 1e-6)
	if vn2 <= 0.0:
		r["pass_through"] = false
		r["residual_velocity"] = Vector3.ZERO
		return
	var vn_res := sqrt(vn2) * m / (m + plug_mass)
	r["pass_through"] = true
	r["residual_velocity"] = into * vn_res + v_t * t_keep


static func _assess_blunt(p: GlassProfile, r: Dictionary, th: Dictionary, imp: GlassImpact, e_n: float, v: Vector3,
		v_n: float, v_t: Vector3, into: Vector3, t: float, D: float, ctx: Dictionary) -> void:
	var e_chip: float = th["chip"]
	var e_crack: float = th["crack"]
	var e_break: float = th["break"]
	var e_shat: float = th["shatter"]
	var e_punch: float = th["punch"]
	var areal := p.areal_mass()
	var r_body := maxf(imp.radius, 0.01)
	var size_min: float = ctx.get("size_min", 1.0)
	if e_n < minf(e_chip, e_crack):
		return
	if e_n < e_crack:
		r["outcome"] = Outcome.CHIP
		r["crater_entry"] = clampf(imp.contact * 0.25, 0.0015, 0.006)
		r["crack_length"] = 0.01 + 0.03 * e_n / e_crack
		r["radials"] = 3
		r["d_damage"] = 0.05 * pow(e_n / e_crack, 2.0)
		return
	match p.mode:
		"tempered":
			r["outcome"] = Outcome.SHATTERED
			r["kind"] = &"dice"
			r["drop_radius"] = 10.0
			r["hole_radius"] = r_body
			_pass(r, imp, v, v_n, v_t, into, e_crack * p.absorb_mult, 0.0, 0.9)
		"laminated", "wired", "resistant":
			var x := e_n / e_crack
			if e_n < e_punch:
				r["outcome"] = Outcome.CRACKED
				r["kind"] = &"cobweb"
				r["crack_length"] = clampf(0.08 * pow(x, 0.45) * (1.0 + 2.0 * imp.contact), 0.03, size_min * 0.6)
				r["radials"] = _radials(p, x / 20.0)
				r["rings"] = 2 + int(clampf(log(x) * 1.5, 0.0, 6.0))
				r["frost_radius"] = p.frost * clampf(imp.contact * 1.5 + 0.02 * log(x + 1.0), 0.01, 0.2)
				r["bulge"] = clampf(0.035 * e_n / e_punch, 0.0, 0.035) if p.mode == "laminated" else 0.0
				r["d_damage"] = 0.12 * clampf(e_n / e_punch, 0.0, 1.0) + 0.04
				r["crater_entry"] = clampf(imp.contact * 0.3, 0.002, 0.01)
				if p.resist_capacity > 0.0:
					r["d_local"] = e_n / p.resist_capacity
			else:
				r["outcome"] = Outcome.PUNCHED
				r["kind"] = &"punch"
				r["hole_radius"] = r_body * 1.15 + 0.01
				r["crack_length"] = clampf(r_body * 2.5 + 0.1, 0.1, size_min * 0.7)
				r["radials"] = p.radial_max
				r["rings"] = 5
				r["frost_radius"] = p.frost * (r_body * 1.6 + 0.03)
				r["d_damage"] = 0.5
				var plug := areal * PI * r_body * r_body
				_pass(r, imp, v, v_n, v_t, into, e_punch * p.absorb_mult, plug, 0.85)
		_:
			# annealed: cracks, then a ragged hole with fall-out, then the whole pane
			var x := e_n / e_crack
			if e_n < e_break:
				r["outcome"] = Outcome.CRACKED
				r["crack_length"] = clampf(0.12 * pow(x, 0.8) * (1.0 + 3.0 * imp.contact), 0.04, size_min * 0.8)
				r["radials"] = _radials(p, (x - 1.0) / (p.break_mult - 1.0))
				r["rings"] = 1 + int((x - 1.0) * 2.0)
				r["crater_entry"] = clampf(imp.contact * 0.2, 0.0015, 0.006)
				r["d_damage"] = 0.35 * x / p.break_mult
				return
			var drop := maxf(r_body * 1.15, 0.05 * sqrt(e_n / e_break) + r_body * 0.5)
			r["hole_radius"] = r_body * 1.1
			r["crack_length"] = 10.0
			r["radials"] = p.radial_max
			r["rings"] = 6
			r["d_damage"] = 1.0
			var plug := areal * PI * drop * drop * 0.5
			if e_n >= e_shat or drop > size_min * 0.45:
				r["outcome"] = Outcome.SHATTERED
				r["kind"] = &"shatter"
				r["drop_radius"] = 10.0
				plug = areal * PI * r_body * r_body * 2.0
			else:
				r["outcome"] = Outcome.PUNCHED
				r["kind"] = &"hole"
				r["drop_radius"] = drop
			_pass(r, imp, v, v_n, v_t, into, e_break * p.absorb_mult, plug, 0.9)
