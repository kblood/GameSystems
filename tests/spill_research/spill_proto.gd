extends RefCounted
## Spill research prototype (docs/spill_system_research.md). Pure logic, no nodes, no per-step rays.
## One puddle on the TOP FACE of a box collider (analytic rectangle in the face frame) that
##  - spreads with the viscous gravity-current law (Huppert 1982: R = 0.894 (rho g V^3 / 3 mu)^(1/8) t^(1/8)),
##    capped at the capillary equilibrium thickness h_eq = 2 l_c sin(theta/2) and at V_SPREAD_MAX,
##  - is clipped by the rectangle (16-strip area integral), keeps its contact line when volume leaves (no receding),
##  - overflows an edge when its mean thickness h exceeds the edge pinning height h_pin (Gibbs edge pinning),
##    flux per edge length = min(broad-crested weir, viscous film flux),
##  - feeds edge emitters (spacing = Rayleigh-Taylor wavelength) that drip (Tate volume + visco-capillary neck time),
##    run as a continuous jet (high flux) or as a honey-like strand (long visco-capillary breakup time),
##  - drops / strands fall analytically (fall time from ONE cached floor ray per edge) into a floor ledger,
##  - goes to sleep (asleep = true) when nothing flows: the caller stops calling step() -> zero cost.
## Volume (m^3) is conserved exactly: v_in == vol + beads + strands_in_air + falling + v_floor.

const G := 9.81
const V_SPREAD_MAX := 0.3        ## m/s, inertial cap of the contact line (water spreading on a table)
const Q_PINNED := 2.0e-9         ## m^3/s per site (0.002 ml/s): below this the edge stays pinned (contact angle hysteresis)
const Q_STRAND_MIN := 5.0e-9     ## m^3/s per site: a strand needs at least this feed, else it thins and breaks
const STRAND_TAU_MIN := 0.08     ## s: liquids whose strand breakup time exceeds this form threads (oil, syrup, honey)
const Q_CREEP := 5.0e-8          ## m^3/s total (0.05 ml/s): below this the spill only creeps -> 1 Hz ticks
const CREEP_DT := 1.0
const CREEP_MAX := 60.0          ## s of creeping before the puddle freezes for good (until liquid is added again)
const MAX_SITES := 6             ## drip sites per edge
const SLEEP_SPREAD := 5.0e-4     ## m/s: slower spreading than this counts as settled (the t^(1/8) tail can be shown in closed form)

## Physical inputs per liquid. mu Pa s, rho kg/m3, gamma N/m, theta = static contact angle on varnished wood (deg),
## pin = edge pinning factor (h_pin = pin * h_eq), evap = mm/min of film thickness lost (not used by the test).
const LIQUIDS := {
	"water":      {"mu": 0.001, "rho": 1000.0, "gamma": 0.072, "theta": 50.0, "pin": 1.35, "evap": 0.002},
	"beer":       {"mu": 0.0018, "rho": 1010.0, "gamma": 0.042, "theta": 30.0, "pin": 1.3, "evap": 0.002},
	"red_wine":   {"mu": 0.0015, "rho": 990.0, "gamma": 0.047, "theta": 35.0, "pin": 1.3, "evap": 0.002},
	"spirits40":  {"mu": 0.0024, "rho": 950.0, "gamma": 0.030, "theta": 15.0, "pin": 1.2, "evap": 0.02},
	"milk":       {"mu": 0.002, "rho": 1030.0, "gamma": 0.045, "theta": 40.0, "pin": 1.3, "evap": 0.0015},
	"cola":       {"mu": 0.0015, "rho": 1040.0, "gamma": 0.065, "theta": 45.0, "pin": 1.35, "evap": 0.0015},
	"blood_like": {"mu": 0.004, "rho": 1060.0, "gamma": 0.058, "theta": 45.0, "pin": 1.4, "evap": 0.001},
	"olive_oil":  {"mu": 0.08, "rho": 915.0, "gamma": 0.032, "theta": 10.0, "pin": 1.2, "evap": 0.0},
	"syrup":      {"mu": 0.15, "rho": 1330.0, "gamma": 0.070, "theta": 60.0, "pin": 1.5, "evap": 0.0},
	"honey":      {"mu": 5.0, "rho": 1420.0, "gamma": 0.060, "theta": 70.0, "pin": 1.6, "evap": 0.0},
}


## Derived numbers (SI) for a liquid: capillary length, equilibrium/pin thickness, drip volume, neck and strand times...
static func derive(id: String) -> Dictionary:
	var L: Dictionary = LIQUIDS[id].duplicate()
	var mu: float = L["mu"]
	var rho: float = L["rho"]
	var ga: float = L["gamma"]
	var lc := sqrt(ga / (rho * G))
	L["lc"] = lc
	L["h_eq"] = 2.0 * lc * sin(deg_to_rad(float(L["theta"])) * 0.5)
	L["h_pin"] = float(L["pin"]) * float(L["h_eq"])
	L["v_drop"] = TAU * lc * ga / (rho * G)                     # Tate's law with the pendant radius ~ l_c at a flat edge
	L["tau_neck"] = maxf(0.02, 3.0 * mu * lc / ga)               # visco-capillary pinch-off time (+ a 20 ms floor)
	L["tau_strand"] = 20.0 * mu * lc / ga                        # viscous thread lifetime (Rayleigh-Plateau, viscous)
	L["strand"] = float(L["tau_strand"]) > STRAND_TAU_MIN
	L["lambda"] = TAU * sqrt(2.0) * lc                           # drip site spacing (Rayleigh-Taylor wavelength)
	L["q_jet"] = PI * lc * lc * sqrt(ga / (rho * lc))            # drip -> jet transition (We ~ 1 at the site)
	L["v_rivulet"] = minf(rho * G * pow(maxf(float(L["h_eq"]), 1.0e-3), 2) / (3.0 * mu), 0.25)   # Nusselt film speed, capped
	return L


var id := ""
var liq: Dictionary
var hx := 0.1                    ## top-face half extents (face frame x / z)
var hz := 0.1
var face_xf := Transform3D.IDENTITY   ## world <- face frame (origin = face centre, y = face normal)
var floor_query: Callable        ## func(world_point: Vector3) -> float drop height; called once per edge, cached
var edge_drop := [-1.0, -1.0, -1.0, -1.0]

# puddle (face frame)
var c := Vector2.ZERO
var vol := 0.0
var R := 0.0
var h := 0.0
var spread_v := 0.0
# edge emitters: 4 edges x MAX_SITES {bead, neck, strand, strand_age, strand_vol}
var em: Array = []
var falling: Array = []          ## [t_left, m3]
# ledger (m^3)
var v_in := 0.0
var v_floor := 0.0
# stats
var t := 0.0
var steps := 0
var drops := 0
var drop_times := PackedFloat32Array()
var strand_time := 0.0
var strand_breaks := 0
var jet_time := 0.0
var first_overflow := -1.0
var asleep := true
var _pending_in := 0.0
var _edge_flowing := false
var creeping := false
var creep_t := 0.0


func _init(liquid_id: String, face: Transform3D, half_x: float, half_z: float) -> void:
	id = liquid_id
	liq = derive(liquid_id)
	face_xf = face
	hx = half_x
	hz = half_z
	for e in 4:
		var row := []
		for s in MAX_SITES:
			row.append({"bead": 0.0, "neck": 0.0, "strand": false, "strand_age": 0.0, "strand_vol": 0.0})
		em.append(row)


## SpillSystem.add_liquid equivalent for a landing ON this face (world position, m^3).
func add_liquid(world_pos: Vector3, m3: float) -> void:
	var lp := face_xf.affine_inverse() * world_pos
	var p := Vector2(clampf(lp.x, -hx, hx), clampf(lp.z, -hz, hz))
	if vol <= 0.0 and R <= 0.0:
		c = p
		R = 0.004
	else:   # mass-weighted centre drift (a second pour nearby pulls the puddle)
		c = c.lerp(p, m3 / (vol + _pending_in + m3) * 0.5)
	_pending_in += m3
	v_in += m3
	asleep = false
	creeping = false
	creep_t = 0.0


func in_flight() -> float:
	var s := 0.0
	for f in falling:
		s += float(f[1])
	return s


func on_edges() -> float:
	var s := 0.0
	for row in em:
		for e in row:
			s += float(e["bead"]) + float(e["strand_vol"])
	return s


func ledger_error() -> float:
	return v_in - (vol + _pending_in + on_edges() + in_flight() + v_floor)


## Area of the disc (c, r) inside the rectangle, 16 strips across x.
func area(r: float) -> float:
	var x0 := maxf(c.x - r, -hx)
	var x1 := minf(c.x + r, hx)
	if x1 <= x0:
		return 0.0
	var dx := (x1 - x0) / 16.0
	var a := 0.0
	for i in 16:
		var x := x0 + (i + 0.5) * dx - c.x
		var hc := sqrt(maxf(0.0, r * r - x * x))
		a += maxf(0.0, minf(c.y + hc, hz) - maxf(c.y - hc, -hz)) * dx
	return a


## Wetted length of edge e (0 +x, 1 -x, 2 +z, 3 -z) and its centre coordinate along the edge.
func chord(e: int) -> Vector2:
	var d: float
	var along: float
	var lim: float
	match e:
		0: d = hx - c.x; along = c.y; lim = hz
		1: d = hx + c.x; along = c.y; lim = hz
		2: d = hz - c.y; along = c.x; lim = hx
		_: d = hz + c.y; along = c.x; lim = hx
	if R <= d:
		return Vector2.ZERO
	var half := sqrt(R * R - d * d)
	var a0 := maxf(along - half, -lim)
	var a1 := minf(along + half, lim)
	return Vector2(maxf(0.0, a1 - a0), 0.5 * (a0 + a1))


func _solve_r(a_target: float) -> float:
	var lo := R
	var hi := 0.0                         # radius that covers the whole face: farthest corner
	for k in [Vector2(hx, hz), Vector2(-hx, hz), Vector2(hx, -hz), Vector2(-hx, -hz)]:
		hi = maxf(hi, c.distance_to(k))
	if area(hi) <= a_target:
		return hi
	for i in 18:
		var m := 0.5 * (lo + hi)
		if area(m) < a_target:
			lo = m
		else:
			hi = m
	return hi


func _edge_world(e: int, along: float) -> Vector3:
	var p: Vector3
	match e:
		0: p = Vector3(hx + 0.002, 0.0, along)
		1: p = Vector3(-hx - 0.002, 0.0, along)
		2: p = Vector3(along, 0.0, hz + 0.002)
		_: p = Vector3(along, 0.0, -hz - 0.002)
	return face_xf * p


func _fall_time(e: int, along: float) -> float:
	if edge_drop[e] < 0.0:
		edge_drop[e] = float(floor_query.call(_edge_world(e, along))) if floor_query.is_valid() else 0.9
	return sqrt(2.0 * maxf(edge_drop[e], 0.01) / G)


## Overflow per metre of wetted edge (m^2/s) for mean thickness h, excess e over h_pin, centre-to-edge distance d:
## min(broad-crested weir, lubrication film flux with slope e / (d + l_c)).
static func edge_flux(L: Dictionary, h_: float, e: float, d: float) -> float:
	var weir := 0.5 * sqrt(G) * pow(e, 1.5)
	var film := float(L["rho"]) * G * h_ * h_ * h_ / (3.0 * float(L["mu"])) * e / (maxf(d, 0.0) + float(L["lc"]))
	return minf(weir, film)


## Interval (s) at which the owner should call step(): every physics tick while ACTIVE, 1 s while CREEPing, never when asleep.
func tick_interval() -> float:
	return INF if asleep else (CREEP_DT if creeping else 0.0)


func _fall(ft: float, m3: float) -> void:
	# merge with an entry that lands at the same time (same edge, same step): O(1) per step instead of per site
	if not falling.is_empty() and absf(float(falling[-1][0]) - ft) < 1.0e-6:
		falling[-1][1] += m3
	else:
		falling.append([ft, m3])


func step(dt: float) -> void:
	if asleep:
		return
	steps += 1
	t += dt
	vol += _pending_in
	_pending_in = 0.0
	var mu: float = liq["mu"]
	var rho: float = liq["rho"]
	# --- spread (only grows; the contact line does not recede)
	spread_v = 0.0
	if vol > 0.0:
		var rt := _solve_r(vol / float(liq["h_eq"]))
		if R < rt:
			var k8 := 0.894 * pow(rho * G * vol * vol * vol / (3.0 * mu), 0.125)
			var te := pow(R / k8, 8.0)
			var rn := minf(minf(k8 * pow(te + dt, 0.125), R + V_SPREAD_MAX * dt), rt)
			spread_v = (rn - R) / dt
			R = rn
	var A := maxf(area(R), 1.0e-6)
	h = vol / A
	# --- edge overflow
	var feeds := []
	feeds.resize(4 * MAX_SITES)
	feeds.fill(0.0)
	# contact-angle hysteresis band: an edge needs 4 % over h_pin to start and stops below 1 %, so the
	# exponential tail of the overflow ends in finite time (otherwise viscous liquids trickle forever)
	var hp: float = float(liq["h_pin"]) * (1.01 if _edge_flowing else 1.04)
	_edge_flowing = false
	if h > hp:
		_edge_flowing = true
		hp = liq["h_pin"]
		var e_h := h - hp
		var qs := []
		var q_tot := 0.0
		for e in 4:
			var ch := chord(e)
			var d_e: float = [hx - c.x, hx + c.x, hz - c.y, hz + c.y][e]
			var q := edge_flux(liq, h, e_h, d_e) * ch.x
			qs.append([ch, q])
			q_tot += q
		var cap := e_h * A / dt          # never drain below the pin height in one step
		var sc := minf(1.0, cap / maxf(q_tot, 1e-18))
		for e in 4:
			var ch: Vector2 = qs[e][0]
			if ch.x <= 0.0:
				continue
			var n := clampi(roundi(ch.x / float(liq["lambda"])), 1, MAX_SITES)
			var qi := float(qs[e][1]) * sc / n
			if qi < Q_PINNED:
				continue
			for s in n:
				feeds[e * MAX_SITES + s] = qi
				vol -= qi * dt
			if first_overflow < 0.0:
				first_overflow = t
	# --- emitters
	var busy := false
	for e in 4:
		var ch := chord(e)
		for s in MAX_SITES:
			var q: float = feeds[e * MAX_SITES + s]
			var site: Dictionary = em[e][s]
			if q <= 0.0 and site["bead"] <= 0.0 and not site["strand"]:
				continue
			busy = _site_step(site, q, dt, e, ch.y) or busy
	# --- falling volume
	var i := 0
	while i < falling.size():
		falling[i][0] -= dt
		if falling[i][0] <= 0.0:
			v_floor += float(falling[i][1])
			falling.remove_at(i)
			continue
		i += 1
	# --- sleep: nothing flows, nothing in the air, spreading slower than the freeze threshold
	var flowing := false
	for q in feeds:
		if q > 0.0:
			flowing = true
			break
	# ACTIVE -> CREEP (slow trickle / slow spread: stepped at 1 Hz) -> FROZEN (asleep: static decal, zero cost).
	var q_sum := 0.0
	for q in feeds:
		q_sum += q
	if not flowing and not busy and falling.is_empty() and spread_v < SLEEP_SPREAD:
		asleep = true
	elif q_sum < Q_CREEP and falling.is_empty() and spread_v < SLEEP_SPREAD * 2.0:
		creeping = true
		creep_t += dt
		if creep_t > CREEP_MAX:
			asleep = true                # the remaining excess stays on the face (puddle a bit above h_pin)
	else:
		creeping = false


## One drip site. Returns true while it is still changing state (strand thinning / neck forming).
func _site_step(site: Dictionary, q: float, dt: float, e: int, along: float) -> bool:
	var dv := q * dt
	var ft := _fall_time(e, along)
	if q > float(liq["q_jet"]):                                       # continuous jet / sheet over the edge
		jet_time += dt
		_fall(ft, dv)
		return true
	if liq["strand"] and q >= Q_STRAND_MIN and (site["strand"] or site["bead"] + dv >= float(liq["v_drop"])):
		if not site["strand"]:                                         # the hanging bead becomes the thread's head
			site["strand"] = true
			_fall(ft * 2.0, site["bead"])                  # viscous head falls slower than free fall
			site["bead"] = 0.0
		site["strand_age"] = 0.0
		strand_time += dt
		_fall(ft * 2.0, dv)
		return true
	if site["strand"]:                                                 # feed stopped: the thread thins, then breaks
		site["strand_age"] += dt
		site["bead"] += dv
		if site["strand_age"] >= float(liq["tau_strand"]):
			site["strand"] = false
			strand_breaks += 1
		return true
	site["bead"] += dv
	if site["bead"] >= float(liq["v_drop"]):
		site["neck"] += dt
		if site["neck"] >= float(liq["tau_neck"]):
			var dv_drop: float = site["bead"] * 0.85                   # a small residual bead stays on the edge
			site["bead"] -= dv_drop
			site["neck"] = 0.0
			_fall(ft, dv_drop)
			drops += 1
			drop_times.append(t)
		return true
	return false
