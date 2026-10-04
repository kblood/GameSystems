class_name BreakableBottle
extends RigidBody3D
## A bottle_*.glb as a physics prop that breaks. Usage:
##   var b := BreakableBottle.create("wine", 0.7)      # RigidBody3D, model + liquid + colliders built
##   add_child(b); b.global_position = ...; b.linear_velocity = ...
##   b.broke.connect(func(pos, energy, kind): ...)     # kind: &"shatter" | &"neck_snap" (hook your audio here)
## Break sources: contacts with other bodies (assessed automatically in _integrate_forces), apply_impact()
## for things you simulate yourself, hit_by_projectile() for bullets. See BottleBreakProfile for the model.
## Surfaces: put meta "break_surface" (concrete|metal|wood|carpet|...) and optionally "break_sharp" on any collider
## (or a parent); un-tagged static bodies count as `default_surface`.

signal broke(position: Vector3, energy: float, kind: StringName)
signal damaged(damage: float, outcome: int)                ## cumulative damage 0..1 changed (cracks)
signal impact_assessed(info: Dictionary)                   ## every assessed hit (also harmless ones)
signal leaked(hole_world: Vector3)                         ## plastic: a bullet hole was made

enum ImpactSource { HISTORY, IMPULSE, MAX }

@export var bottle_name := "wine"
@export_range(0.0, 1.0) var fill := 0.6: set = set_fill
@export var asset_dir := "res://"                          ## folder with bottle_<name>.glb / .liquid.json (+ shards/broken/break.json)
@export var profile: BottleBreakProfile
@export var breakable := true
@export var free_on_break := true
@export var rng_seed := 0                                  ## 0 = random; seeds the hidden flaw
@export var use_flaw := true
@export var use_fatigue := true
@export var predict_impacts := true                        ## swept-path prediction for fast motion (see FastImpact)
@export var predict_min_speed := 4.0                       ## m/s; below this the engine contact path is enough
@export var default_surface := "concrete"
@export var impact_source := ImpactSource.MAX              ## where v_n comes from: velocity history, contact impulse, or the larger
@export var min_impact_speed := 0.4                        ## m/s; slower contacts are ignored
@export var shard_count := 28                              ## placeholder fragmentation count
@export var use_real_assets := true                        ## use bottle_<n>_shards.glb / _broken.glb when they exist (else placeholders)
@export var restitution := 0.15
@export_flags_3d_physics var bottle_layer := 9             ## world + interactables (matches NightfallGrabbable)
@export_flags_3d_physics var bottle_mask := 11

var model: Node3D
var ctl: BottleLiquid
var lut: BottleLut
var glass_node: MeshInstance3D
var damage := 0.0
var flaw := 1.0
var state := &"intact"                                     ## intact | neck_snapped | shattered
var broken: bool:
	get: return state == &"shattered"
var last_info: Dictionary = {}
var held := false
var open_z := -1.0                                         ## >0 once the neck is snapped
var leaks: Array[Dictionary] = []                          ## max 3 wet-capable holes: {p, n (local outward), r, acc, stream}
var hole_marks: Array[MeshInstance3D] = []                 ## persistent bullet-hole visuals (BulletHoleMark), every hole
var leak_flowing := false                                  ## some hole is below the liquid plane (last leak tick)

var _built := false
var _rng := RandomNumberGenerator.new()
var _hist: Array[Dictionary] = []
var _prev_contacts := {}
var _hands: Array = []
var _rprof := PackedFloat32Array()
var _rim_r := 0.015
var _cap_node: MeshInstance3D
var _label_node: MeshInstance3D
var _pending := false
var _piece_y: Array[float] = []                           ## representative axis height per collision piece
var debug_contacts := false
var _pp := PathPredictor.new()                             ## cached swept path (recomputed only when something other than gravity changed v)
var _pred_pending := {}                                    ## predicted impact waiting for the engine contact (fallback if it never comes)
var _pred_skip := {}                                       ## collider id -> physics frame until which contacts are ignored (already assessed)
var _faces := PackedVector3Array()                         ## shell triangles in bottle space (hole placement, built on first hit)
var _faces_mesh: Mesh


static func create(bottle: String, fill_ := 0.6, dir := "res://") -> BreakableBottle:
	var b := BreakableBottle.new()
	b.bottle_name = bottle
	b.asset_dir = dir
	b.fill = fill_
	b._build()
	return b


func _ready() -> void:
	if not _built:
		_build()
	ctl.setup(model, fill, "%sbottle_%s.liquid.json" % [asset_dir, bottle_name])
	set_physics_process(false)   # idle intact bottles cost nothing; leaks / neck spill switch it on
	sleeping_state_changed.connect(_on_sleep_changed)
	contact_monitor = true
	max_contacts_reported = 8
	continuous_cd = true
	collision_layer = bottle_layer
	collision_mask = bottle_mask


## A resting bottle needs no liquid slosh/bubble update; stop it 2 s after sleeping, restart on wake.
func _on_sleep_changed() -> void:
	if not sleeping:
		ctl.set_process(true)
		wake_leaks()
		return
	await get_tree().create_timer(2.0).timeout
	if is_inside_tree() and sleeping and not leak_flowing and state == &"intact":
		ctl.set_process(false)


func _fatigue_on() -> bool:
	var m := BottleBreakManager.current
	return use_fatigue and (m == null or m.fatigue_enabled)


func set_fill(v: float) -> void:
	var up_ := v > fill
	fill = clampf(v, 0.0, 1.0)
	if _built:
		ctl.fill = fill
		_update_mass()
		if up_:
			wake_leaks()   # refilled (pour receive): dry holes may be wet again


## Holes present and liquid left: run the leak check (it switches itself off again while asleep with all holes dry).
func wake_leaks() -> void:
	if not leaks.is_empty() and fill > 0.0 and state != &"shattered" and is_inside_tree():
		set_physics_process(true)


func _update_mass() -> void:
	mass = profile.total_mass(fill)


func is_plastic() -> bool:
	return profile.material == "plastic"


## While held (VR hand / joint) the hand bodies are ignored as strikers; everything else still breaks it.
func set_held(h: bool, hand_body: Node = null) -> void:
	held = h
	_hands.clear()
	if h and hand_body:
		_hands.append(hand_body)


# ---------------------------------------------------------------- build

func _build() -> void:
	_built = true
	var ps := load("%sbottle_%s.glb" % [asset_dir, bottle_name]) as PackedScene
	assert(ps != null, "BreakableBottle: bottle_%s.glb not found in %s" % [bottle_name, asset_dir])
	model = ps.instantiate()
	add_child(model)
	glass_node = model.find_child("Glass*", true, false) as MeshInstance3D
	if glass_node == null:   # opaque containers (mug, jerrycan): the shell mesh is "Body"
		glass_node = model.find_child("Body*", true, false) as MeshInstance3D
	_cap_node = model.find_child("Cap*", true, false) as MeshInstance3D
	_label_node = model.find_child("Label*", true, false) as MeshInstance3D
	var sidecar := "%sbottle_%s.liquid.json" % [asset_dir, bottle_name]
	ctl = BottleLiquid.new()
	add_child(ctl)   # BottleLiquid.setup needs the tree: it runs in _ready (see _setup_liquid)
	lut = BottleLut.from_model(model, sidecar)
	if profile == null:
		profile = BottleBreakProfile.for_bottle(bottle_name)
		profile.set_from_mesh(BottleShardSource.total_area(glass_node.mesh), lut.capacity_ml)
	var bj := "%sbottle_%s_break.json" % [asset_dir, bottle_name]
	if FileAccess.file_exists(bj):
		var d = JSON.parse_string(FileAccess.get_file_as_string(bj))
		if d is Dictionary:
			profile.apply_break_json(d)
	_rng.seed = rng_seed if rng_seed != 0 else randi()
	flaw = profile.roll_flaw(_rng)
	_scan_radius_profile()
	_build_shapes(INF)
	var pm := PhysicsMaterial.new()
	pm.bounce = 0.35 if is_plastic() else restitution
	pm.friction = 0.6
	physics_material_override = pm
	_update_mass()
	linear_damp = 0.05
	contact_monitor = true
	max_contacts_reported = 8
	continuous_cd = true
	collision_layer = bottle_layer
	collision_mask = bottle_mask


func _rel_xf(n: Node3D) -> Transform3D:
	var xf := n.transform
	var p := n.get_parent()
	while p != null and p != self:
		xf = (p as Node3D).transform * xf
		p = p.get_parent()
	return xf


func _scan_radius_profile() -> void:
	var arr := glass_node.mesh.surface_get_arrays(0)
	var V: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var xf := _rel_xf(glass_node)
	_rprof.resize(64)
	_rprof.fill(0.0)
	var hmax := profile.height + 0.01
	for v in V:
		var p := xf * v
		var bi := clampi(int(p.y / hmax * 63.0), 0, 63)
		_rprof[bi] = maxf(_rprof[bi], Vector2(p.x, p.z).length())


func _radius_at(y: float) -> float:
	var bi := clampi(int(y / (profile.height + 0.01) * 63.0), 0, 63)
	return maxf(_rprof[bi], 0.01)


## Convex pieces along the axis (body / shoulder / neck) from the visual vertices, clipped at y_max.
func _build_shapes(y_max: float) -> void:
	for c in get_children():
		if c is CollisionShape3D:
			c.queue_free()
			remove_child(c)
	var P := PackedVector3Array()
	var arr := glass_node.mesh.surface_get_arrays(0)
	var xf := _rel_xf(glass_node)
	for v in (arr[Mesh.ARRAY_VERTEX] as PackedVector3Array):
		P.append(xf * v)
	if _cap_node and _cap_node.visible and y_max == INF:
		var ca := _cap_node.mesh.surface_get_arrays(0)
		var cx := _rel_xf(_cap_node)
		for v in (ca[Mesh.ARRAY_VERTEX] as PackedVector3Array):
			P.append(cx * v)
	_piece_y.clear()
	var edges := [0.0, profile.body_z, profile.neck_z, 10.0]
	for s in 3:
		var lo: float = edges[s]
		var hi: float = edges[s + 1]
		if lo >= y_max:
			break
		var seen := {}
		var pts := PackedVector3Array()
		for p in P:
			if p.y < lo - 0.0006 or p.y > hi + 0.0006:
				continue
			var q := p
			q.y = minf(q.y, y_max)
			var key := Vector3i((q * 2000.0).round())
			if not seen.has(key):
				seen[key] = true
				pts.append(q)
		if pts.size() < 6:
			continue
		var cs := CollisionShape3D.new()
		var sh := ConvexPolygonShape3D.new()
		sh.points = pts
		cs.shape = sh
		cs.name = "Col%d" % s
		add_child(cs)
		_piece_y.append(minf(0.5 * (maxf(lo, profile.base_z) + minf(hi, profile.height)), y_max))


# ---------------------------------------------------------------- contacts

func _integrate_forces(state_: PhysicsDirectBodyState3D) -> void:
	if not breakable or state == &"shattered" or _pending:
		return
	if predict_impacts and not is_physics_processing() and state_.linear_velocity.length_squared() > predict_min_speed * predict_min_speed:
		set_physics_process(true)   # fast: the predictor runs in _physics_process until the bottle slows down
	if not is_physics_processing() and not leaks.is_empty() and fill > 0.0:
		set_physics_process(true)   # awake (moved / tipped) with holes: check whether a hole is wet now
	var inv := state_.transform.affine_inverse()
	var now := {}
	var rest_j := mass * 9.81 * state_.step * 4.0
	for i in state_.get_contact_count():
		var col := state_.get_contact_collider_object(i)
		var id := state_.get_contact_collider_id(i)
		var j := state_.get_contact_impulse(i)
		var jn := j.length()
		now[id] = maxf(float(now.get(id, 0.0)), jn)
		var is_new := not _prev_contacts.has(id)
		var spike := jn > 3.0 * float(_prev_contacts.get(id, 0.0)) + rest_j
		if not (is_new or spike):
			continue
		if held and _is_hand(col):
			continue
		if int(_pred_skip.get(id, 0)) > Engine.get_physics_frames():
			continue   # the predicted path already assessed this impact
		var n := state_.get_contact_local_normal(i)
		var pw := state_.get_contact_local_position(i)
		var y_eff := _contact_y(state_.get_contact_local_shape(i), inv.basis * n, (inv * pw).y)
		if debug_contacts:
			print("contact y=%.3f y_eff=%.3f shape=%d n=%s J=%s" % [(inv * pw).y, y_eff, state_.get_contact_local_shape(i), inv.basis * n, j])
		var vcol := state_.get_contact_collider_velocity_at_position(i)
		var striker := _striker_from(col)
		# v_n from the velocity history (pre-impact) and from the impulse J = m_red (1 + e) v_n
		var vh := 0.0
		# spin part weighted by the point effective mass share ms = (1/m) / (1/m + (r x n) I^-1 (r x n)), so a
		# slap-down (far end swinging down after the first hit) only counts the mass it really couples
		var rn := (pw - state_.transform.origin - state_.center_of_mass).cross(n)
		var ms := state_.inverse_mass / maxf(state_.inverse_mass + rn.dot(state_.inverse_inertia_tensor * rn), 1e-9)
		for h in _hist:
			var vl: float = ((h["v"] as Vector3) - vcol).dot(n)
			var vr: float = (h["w"] as Vector3).cross(pw - (h["o"] as Vector3)).dot(n)
			vh = maxf(vh, minf(sqrt(vl * vl + ms * vr * vr), absf(vl + vr)))
		var m_tot := profile.total_mass(fill)
		var m_s: float = striker["mass"]
		var m_red := m_tot if is_inf(m_s) else m_tot * m_s / (m_tot + m_s)
		var vj := absf(j.dot(n)) / (m_red * (1.0 + restitution))   # 0 when the engine reports no impulse (Jolt in 4.7)
		var v_n := vh if impact_source == ImpactSource.HISTORY else (vj if impact_source == ImpactSource.IMPULSE else maxf(vh, vj))
		if not _pred_pending.is_empty() and int(_pred_pending["id"]) == id:
			v_n = maxf(v_n, float(_pred_pending["v_n"]))   # pre-solver speed from the swept prediction
			_pred_pending = {}
		if v_n < min_impact_speed:
			continue
		if jn <= 0.0:
			jn = m_red * (1.0 + restitution) * v_n   # engine gave no impulse: estimate J = m_red (1+e) v_n
		var pl := inv * pw
		pl.y = y_eff
		_resolve(pw, pl, n, v_n, striker, jn, state_.linear_velocity, {"v_hist": vh, "v_impulse": vj})
		break   # one assessed hit per step is enough (it may have broken us)
	_prev_contacts = now
	_hist.append({"v": state_.linear_velocity, "w": state_.angular_velocity, "o": state_.transform.origin})
	if _hist.size() > 2:
		_hist.pop_front()


## True once per 6 physics frames per striker: the caller may assess this impact (prediction vs. engine contact).
func take_prediction(striker_id: int) -> bool:
	var f := Engine.get_physics_frames()
	if int(_pred_skip.get(striker_id, 0)) > f:
		return false
	_pred_skip[striker_id] = f + 6
	return true


## Swept-path prediction of our own motion: the break check uses the pre-solver impact velocity at the predicted contact.
func _predict(dt: float) -> void:
	var ex: Array = []
	for h in _hands:
		if h is CollisionObject3D:
			ex.append((h as CollisionObject3D).get_rid())
	var p := _pp.step(self, dt, bottle_mask, ex)
	if p.is_empty():
		return
	var v_n: float = p["v_n"]
	if v_n < min_impact_speed:
		return
	var col: Object = p["collider"]
	if held and _is_hand(col):
		return
	if not _pred_pending.is_empty():
		return
	var striker := _striker_from(col)
	var m_tot := profile.total_mass(fill)
	var m_s: float = striker["mass"]
	var m_red := m_tot if is_inf(m_s) else m_tot * m_s / (m_tot + m_s)
	var pw: Vector3 = p["point"]
	var pl := to_local(pw)
	pl.y = _contact_y(int(p["shape_idx"]), global_transform.basis.inverse() * (p["normal"] as Vector3), pl.y)
	_pred_pending = {"id": int(p["collider_id"]), "v_n": v_n, "pw": pw, "pl": pl, "n": p["normal"], "striker": striker,
		"j": m_red * (1.0 + restitution) * v_n, "due": Engine.get_physics_frames() + 3}


## Prediction whose engine contact never arrived (tunnelling / missed contact): assess it from the predicted data.
func _flush_prediction() -> void:
	var pp := _pred_pending
	_pred_pending = {}
	_resolve(pp["pw"], pp["pl"], pp["n"], pp["v_n"], pp["striker"], pp["j"], linear_velocity,
		{"v_pred": pp["v_n"], "predicted": true})


## Zone height for a contact. A point on a lying bottle is arbitrary along the contact line, so lateral hits use the
## representative height of the hull piece that was touched; only a push on the bottom face counts as base.
func _contact_y(shape_idx: int, n_local: Vector3, y_point: float) -> float:
	if shape_idx < 0 or shape_idx >= _piece_y.size():
		return y_point
	if shape_idx == 0 and absf(n_local.y) > 0.7 and y_point < profile.base_z + 0.02:
		return profile.base_z * 0.5
	if shape_idx == 0 and y_point < profile.base_z * 0.5:
		return profile.base_z * 0.5
	return _piece_y[shape_idx]


func _is_hand(col: Object) -> bool:
	return _hands.has(col) or (col is Node and (col as Node).is_in_group("bottle_hands"))


func _striker_from(col: Object) -> Dictionary:
	var d := {"mass": INF, "surface": default_surface, "sharp": -1.0, "kind": "static"}
	if col is Node:
		var cur := col as Node
		var got_s := false
		var got_k := false
		while cur != null and not (got_s and got_k):
			if not got_s and cur.has_meta("break_surface"):
				d["surface"] = String(cur.get_meta("break_surface"))
				got_s = true
			if not got_k and cur.has_meta("break_sharp"):
				d["sharp"] = float(cur.get_meta("break_sharp"))
				got_k = true
			cur = cur.get_parent()
		if col is BreakableBottle:
			d["surface"] = "bottle"
			d["mass"] = (col as BreakableBottle).profile.total_mass((col as BreakableBottle).fill)
			d["kind"] = "bottle"
		elif col is RigidBody3D:
			d["mass"] = (col as RigidBody3D).mass
			d["kind"] = "dynamic"
			if not got_s:
				d["surface"] = "wood"
		elif col is CharacterBody3D and not got_s:
			d["surface"] = "character"
	return d


## Public: you simulated a hit yourself. impulse = normal impulse in N*s on the bottle.
## striker_info: {mass (kg, default INF), surface, sharp, speed (m/s, overrides the J-derived speed)}.
func apply_impact(point: Vector3, normal: Vector3, impulse: float, striker_info := {}) -> Dictionary:
	var st := {"mass": INF, "surface": default_surface, "sharp": -1.0, "kind": "api"}
	st.merge(striker_info, true)
	if st.has("collider_id"):
		_pred_skip[int(st["collider_id"])] = Engine.get_physics_frames() + 6
	var m_s: float = st["mass"]
	var m_tot := profile.total_mass(fill)
	var m_red := m_tot if is_inf(m_s) else m_tot * m_s / (m_tot + m_s)
	var v_n: float = float(st["speed"]) if st.has("speed") else impulse / (m_red * (1.0 + restitution))
	return _resolve(point, to_local(point), normal, v_n, st, impulse, linear_velocity)


func _resolve(point: Vector3, point_local: Vector3, normal: Vector3, v_n: float, striker: Dictionary,
		j_n: float, vel: Vector3, extra := {}) -> Dictionary:
	var h := {"v_n": v_n, "y": point_local.y, "fill": fill, "surface": striker["surface"],
		"striker_mass": striker["mass"], "sharp": striker["sharp"],
		"damage": damage if _fatigue_on() else 0.0, "flaw": flaw if use_flaw else 1.0,
		"noise": clampf(1.0 + _rng.randfn(0.0, profile.hit_noise), 0.85, 1.15) if use_flaw else 1.0}
	var info := profile.assess(h)
	info.merge(extra, true)
	info["j_n"] = j_n
	info["point"] = point
	info["normal"] = normal
	info["damage"] = damage
	info["held"] = held
	info["striker_kind"] = striker.get("kind", "")
	if _fatigue_on():
		damage = clampf(damage + float(info["d_damage"]), 0.0, 1.0)
	info["damage_after"] = damage
	last_info = info
	impact_assessed.emit(info)
	var out: int = info["outcome"]
	if out == BottleBreakProfile.Outcome.CRACK or out == BottleBreakProfile.Outcome.DENT:
		damaged.emit(damage, out)
		if use_fatigue and damage >= 1.0:   # fatigue collapse: the next hit of any size breaks it
			pass
	elif out == BottleBreakProfile.Outcome.PIERCE and leaks.size() < 3:   # non-shattering shell cracked: leak hole
		_add_leak(point, -normal, profile.leak_hole_m / 0.55, 0.0)
	elif out == BottleBreakProfile.Outcome.SHATTER or out == BottleBreakProfile.Outcome.NECK_SNAP:
		var tang := vel - normal * vel.dot(normal)
		_pending = true
		call_deferred("_execute_break", out, point, normal, float(info["energy"]),
			tang, float(info["energy"]), point_local.y)
	return info


# ---------------------------------------------------------------- bullets

## energy_joules: muzzle-ish energy at the target (9 mm ~ 500 J, .22 ~ 150 J, airgun ~ 15 J). caliber in metres.
func hit_by_projectile(point: Vector3, direction: Vector3, energy_joules: float, caliber := 0.009) -> Dictionary:
	if state == &"shattered":
		return {}
	var dir := direction.normalized()
	var pl := to_local(point)
	var a := profile.assess_bullet(energy_joules, pl.y, fill)
	a["point"] = point
	a["bullet"] = true
	last_info = a
	impact_assessed.emit(a)
	var out: int = a["outcome"]
	match out:
		BottleBreakProfile.Outcome.PIERCE:
			_add_leak(point, dir, caliber, energy_joules)
			apply_impulse(dir * energy_joules / 350.0 * 0.6, point - global_position)
		BottleBreakProfile.Outcome.CRACK:
			damage = clampf(damage + float(a["d_damage"]), 0.0, 1.0)
			damaged.emit(damage, out)
		_:
			if not _pending:
				_pending = true
				call_deferred("_execute_break", out, point, dir, float(a["burst_energy"]), linear_velocity,
					energy_joules, pl.y, true)
	return a


## NightfallGrabbable-compatible alias.
func receive_ballistic_hit(at: Vector3, direction: Vector3) -> void:
	hit_by_projectile(at, direction, 500.0)


## Bullet hole: entry (and, energy > 150 J, exit) on the real shell mesh. Every hole gets a persistent BulletHoleMark (up to 6);
## the first 3 holes also become leaks (dry ones above the liquid start leaking as soon as the level reaches them).
func _add_leak(point_w: Vector3, dir_w: Vector3, caliber: float, energy: float) -> void:
	var inv := global_transform.affine_inverse()
	var p := inv * point_w
	var d := (inv.basis * dir_w).normalized()
	var r_in := maxf(caliber * 0.55, 0.002)
	var n := Vector3(p.x, 0.0, p.z).normalized() if Vector2(p.x, p.z).length() > 1e-4 else -d
	var pe := Vector3.INF
	var ne := Vector3.ZERO
	var hits := _shell_hits(p, d)
	if hits.size() > 0:   # entry / exit on the real shell mesh (also non-round containers)
		p = hits[0][0]
		n = hits[0][1]
		if hits.size() > 1 and (hits[-1][0] as Vector3).distance_to(p) > 0.01:
			pe = hits[-1][0]
			ne = hits[-1][1]
	elif Vector2(d.x, d.z).length() > 0.1:   # no mesh data: round-body estimate
		var dxz := Vector2(d.x, d.z)
		var t := -2.0 * (Vector2(p.x, p.z).dot(dxz)) / dxz.length_squared()
		pe = p + d * t
		ne = Vector3(pe.x, 0.0, pe.z).normalized()
	_add_hole(p, n, r_in, false)
	if energy > 150.0 and pe != Vector3.INF and pe.y > 0.004 and pe.y < profile.height:
		_add_hole(pe, ne, r_in * 1.5, true)
	set_physics_process(true)
	ctl.set_process(true)


func _add_hole(p: Vector3, n: Vector3, r: float, is_exit: bool) -> void:
	if leaks.size() < 3:
		leaks.append({"p": p, "n": n, "r": r, "acc": 0.0, "stream": null})
	var mgr := BottleBreakManager.current if is_instance_valid(BottleBreakManager.current) else BottleBreakManager.get_for(self)
	if BulletHoleMark.tier_allows(mgr.quality):
		BulletHoleMark.add(self, hole_marks, p, n, r, is_exit, _shell_tint(), _rng.randf() * 6.28)
	leaked.emit(global_transform * p)


func _shell_tint() -> Color:
	if _shell_node() == null:
		return Color(0.86, 0.9, 0.95)
	var m: Material = glass_node.material_override
	if m == null:
		m = glass_node.get_active_material(0)
	if m is BaseMaterial3D:
		var c := (m as BaseMaterial3D).albedo_color
		return Color(c.r, c.g, c.b, 1.0)
	return Color(0.86, 0.9, 0.95)


## First and last intersection of the line p + d*s with the shell mesh (bottle space), sorted along d:
## [[entry point, outward normal], [exit point, outward normal]] or [] when the line misses. Own Moller-Trumbore without
## Geometry3D's absolute epsilon (it rejects mm-sized triangles). Runs once per bullet hit.
func _shell_hits(p: Vector3, d: Vector3) -> Array:
	var sn := _shell_node()
	if sn == null or sn.mesh == null:
		return []
	if _faces_mesh != sn.mesh:
		_faces_mesh = sn.mesh
		var xf := _rel_xf(sn)
		_faces = sn.mesh.get_faces()
		for i in _faces.size():
			_faces[i] = xf * _faces[i]
	var best0 := INF
	var best1 := -INF
	var h0 := []
	var h1 := []
	for i in range(0, _faces.size(), 3):
		var v0 := _faces[i]
		var e1 := _faces[i + 1] - v0
		var e2 := _faces[i + 2] - v0
		var h := d.cross(e2)
		var a := e1.dot(h)
		if absf(a) < 1e-15:
			continue
		var f := 1.0 / a
		var sv := p - v0
		var u := f * sv.dot(h)
		if u < 0.0 or u > 1.0:
			continue
		var qv := sv.cross(e1)
		var v := f * d.dot(qv)
		if v < 0.0 or u + v > 1.0:
			continue
		var t := f * e2.dot(qv)
		var nn := e1.cross(e2)
		if nn.length_squared() < 1e-18:
			continue
		nn = nn.normalized()
		if t < best0:
			best0 = t
			h0 = [p + d * t, -nn if nn.dot(d) > 0.0 else nn]
		if t > best1:
			best1 = t
			h1 = [p + d * t, nn if nn.dot(d) > 0.0 else -nn]
	if h0.is_empty():
		return []
	return [h0, h1]


## The shell mesh (glass, or "Body" of opaque containers; survives model swaps that only look for Glass*).
func _shell_node() -> MeshInstance3D:
	if glass_node == null and model:
		glass_node = model.find_child("Glass*", true, false) as MeshInstance3D
		if glass_node == null:
			glass_node = model.find_child("Body*", true, false) as MeshInstance3D
	return glass_node


## Torricelli outflow per hole from the LUT liquid plane at the current orientation (re-evaluated every tick, so a dry hole starts
## leaking when the bottle is tipped / sloshes / is refilled, and stops again when the level drops below it).
## HIGH: a LeakStream per wet hole (thin continuous jet, volume delivered at its landing point); other tiers / over the global
## LeakStream cap: droplets from the hole as before.
func _process_leaks(dt: float) -> void:
	leak_flowing = false
	if leaks.is_empty() or fill <= 0.0:
		return
	var up := (global_transform.basis.orthonormalized().inverse() * Vector3.UP)
	var plane := lut.offset(up, fill)
	var mgr: BottleBreakManager = BottleBreakManager.current if is_instance_valid(BottleBreakManager.current) else null
	var f := fill
	var gxf := global_transform
	var bas := gxf.basis.orthonormalized()
	var com_w := gxf * center_of_mass
	for lk in leaks:
		var p: Vector3 = lk["p"]
		var head := plane - p.dot(up)   # metres of liquid above the hole (Torricelli)
		if head <= 0.002:
			continue
		leak_flowing = true
		var v_e := 0.62 * sqrt(2.0 * 9.81 * head)
		var q: float = PI * float(lk["r"]) * float(lk["r"]) * v_e           # m3/s
		var dv_ml := minf(q * dt * 1.0e6, f * lut.capacity_ml)
		f -= dv_ml / lut.capacity_ml
		if mgr == null:
			mgr = BottleBreakManager.get_for(self)
		var hw := gxf * p
		var nl: Vector3 = lk.get("n", Vector3(p.x, 0.0, p.z).normalized())
		var vel := (bas * nl).normalized() * v_e + linear_velocity + angular_velocity.cross(hw - com_w)
		if mgr.quality == BottleBreakManager.Quality.HIGH:
			var s = lk.get("stream")
			if s == null or not is_instance_valid(s) or (s as LeakStream).finished:
				s = LeakStream.acquire(mgr, get_rid(), mgr.droplet_mask)
				lk["stream"] = s
			if s != null:
				(s as LeakStream).feed(hw, vel, q, dv_ml, lut.color)
				continue
		lk["acc"] = float(lk["acc"]) + dv_ml
		var drop := maxf(0.4, q * 1.0e6 / 60.0)
		var k := 0
		while float(lk["acc"]) >= drop and k < 4:
			mgr.emit_droplet(hw, vel, drop, lut.color)
			lk["acc"] = float(lk["acc"]) - drop
			k += 1
	if f != fill:
		fill = maxf(f, 0.0)
		ctl.fill = fill
		_update_mass()


# ---------------------------------------------------------------- breaking

func _execute_break(outcome: int, point: Vector3, dir: Vector3, burst_e: float, tang: Vector3, impact_e: float,
		y_hit: float, bullet := false) -> void:
	_pending = false
	if state == &"shattered" or not is_inside_tree():
		return
	if outcome == BottleBreakProfile.Outcome.NECK_SNAP and state == &"intact":
		_neck_snap(point, dir, burst_e, tang, impact_e, y_hit)
	else:
		_shatter(point, dir, burst_e, tang, impact_e, bullet)


func _shard_speed(burst_e: float, mass_kg: float) -> float:
	return clampf(sqrt(2.0 * profile.shard_energy_fraction * maxf(burst_e, 0.1) / maxf(mass_kg, 0.05)), 0.8, 14.0)


func _shatter(point: Vector3, dir: Vector3, burst_e: float, tang: Vector3, impact_e: float, bullet: bool) -> void:
	var mgr := BottleBreakManager.get_for(self)
	var gxf := global_transform
	var il := gxf.affine_inverse() * point
	var q := mgr.quality_at(point)
	var frac: float = BottleBreakManager.TIERS[q]["shard_frac"]
	var defs: Array = []
	if frac > 0.0:
		if use_real_assets and BottleShardSource.has_real_shards(bottle_name, asset_dir):
			defs = mgr.reduce_defs(BottleShardSource.real_shards(bottle_name, asset_dir), frac)
		else:
			defs = BottleShardSource.fragment(glass_node, _rel_xf(glass_node), il, maxi(5, int(shard_count * frac)), _rng)
	var gm := glass_node.material_override
	var vmag := _shard_speed(burst_e, profile.glass_mass)
	var mix := 0.7 if bullet else 0.25   # how much the shards follow the bullet / bounce direction
	for d in defs:
		var xf := gxf * (d["xform"] as Transform3D)
		var out := xf.origin - point
		var dist := out.length()
		out = out / maxf(dist, 1e-4)
		var dv := (out + dir * mix).normalized()
		var fall := 1.0 / (1.0 + dist / 0.12)
		var cls_k := 0.75 if d["cls"] == "chunk" else (1.25 if d["cls"] == "sliver" else 1.0)
		var vel := tang * 0.8 + dv * vmag * (0.35 + 1.1 * fall) * cls_k * _rng.randf_range(0.7, 1.3)
		var ang := Vector3(_rng.randfn(), _rng.randfn(), _rng.randfn()) * (2.0 + vmag * 0.8)
		mgr.spawn_shard(d["mesh"], d["shape"], xf, float(d["mass_fraction"]) * profile.glass_mass, vel, ang, gm)
	if frac > 0.0:
		_spawn_cap(mgr, point, dir, tang, vmag)
	var ml := lut.capacity_ml * fill
	mgr.splash(point, (dir * 0.5 + Vector3.UP * 0.5).normalized() if not bullet else dir, ml, lut.color, burst_e * 0.1, tang, q)
	fill = 0.0
	ctl.fill = 0.0
	_finish_break(point, impact_e, &"shatter")


func _spawn_cap(mgr: BottleBreakManager, point: Vector3, dir: Vector3, tang: Vector3, vmag: float) -> void:
	if _cap_node == null or not _cap_node.visible:
		return
	var ca := _cap_node.mesh.surface_get_arrays(0)
	var xf := global_transform * _rel_xf(_cap_node)
	var pts := ca[Mesh.ARRAY_VERTEX] as PackedVector3Array
	var sh := ConvexPolygonShape3D.new()
	sh.points = pts
	var v := tang + (xf.origin - point).normalized() * vmag * 0.8 + dir * 0.5
	mgr.spawn_shard(_cap_node.mesh, sh, xf, profile.cap_mass, v, Vector3(_rng.randfn(), _rng.randfn(), _rng.randfn()) * 6.0,
		_cap_node.material_override)
	_cap_node.visible = false


func _finish_break(point: Vector3, energy: float, kind: StringName) -> void:
	state = &"shattered"
	model.visible = false
	for c in get_children():
		if c is CollisionShape3D:
			(c as CollisionShape3D).set_deferred("disabled", true)
	collision_layer = 0
	collision_mask = 0
	freeze = true
	broke.emit(point, energy, kind)
	if free_on_break:
		queue_free()


func _neck_snap(point: Vector3, dir: Vector3, burst_e: float, tang: Vector3, impact_e: float, y_hit: float) -> void:
	var mgr := BottleBreakManager.get_for(self)
	var snap_z := clampf(y_hit, profile.neck_z + 0.012, profile.height - 0.02)
	var parts := {}
	if use_real_assets and BottleShardSource.has_real_broken(bottle_name, asset_dir):
		parts = BottleShardSource.real_broken(bottle_name, asset_dir)
	if parts.is_empty() or not parts.has("body") or not parts.has("neck"):
		parts = BottleShardSource.split_at_height(glass_node.mesh, snap_z, _rng)
	var gxf := global_transform
	var gm := glass_node.material_override
	glass_node.mesh = parts["body"]
	if _label_node and parts.has("label"):
		_label_node.mesh = parts["label"]
	open_z = float(parts.get("open_z", snap_z))
	if open_z <= 0.0:
		open_z = snap_z
	_rim_r = float(parts.get("rim_r", _radius_at(open_z + 0.015)))
	# the neck: own rigid body
	var neck_mesh: Mesh = parts["neck"]
	var nxf: Transform3D = parts.get("neck_xform", Transform3D.IDENTITY)
	var na := neck_mesh.surface_get_arrays(0)
	var npts := PackedVector3Array()
	var nnor := PackedVector3Array()
	var pv := na[Mesh.ARRAY_VERTEX] as PackedVector3Array
	var pn := na[Mesh.ARRAY_NORMAL] as PackedVector3Array
	npts = pv   # shape points live in the neck body's own space (= mesh space)
	var frac: float = float(parts["neck_area_frac"]) if parts.has("neck_area_frac") else 		BottleShardSource.total_area(neck_mesh) / maxf(BottleShardSource.total_area(neck_mesh) + BottleShardSource.total_area(glass_node.mesh), 1e-6)
	var nm := profile.glass_mass * frac
	var vmag := _shard_speed(burst_e, nm + 0.1)
	var nbody := mgr.spawn_shard(neck_mesh, BottleShardSource.hull_shape(npts, pn if pn.size() == npts.size() else PackedVector3Array()),
		gxf * nxf, nm + profile.cap_mass, tang + (dir * 0.4 + Vector3.UP * 0.6).normalized() * vmag,
		Vector3(_rng.randfn(), _rng.randfn(), _rng.randfn()) * 4.0, gm)
	if _cap_node and _cap_node.visible:
		if nbody:
			var cap_mi := _cap_node.duplicate() as MeshInstance3D
			cap_mi.transform = nxf.affine_inverse() * (_rel_xf(_cap_node))
			cap_mi.visible = true
			nbody.add_child(cap_mi)
		_cap_node.visible = false   # MINIMAL tier: the neck + cap just pop away (no body)
	profile.glass_mass *= 1.0 - frac
	profile.cap_mass = 0.0
	state = &"neck_snapped"
	set_physics_process(true)
	ctl.set_process(true)
	_build_shapes(open_z)
	_update_mass()
	# a first spurt of liquid at the break
	mgr.splash(point, (dir * 0.3 + Vector3.UP * 0.7).normalized(), lut.capacity_ml * fill * 0.05, lut.color, burst_e * 0.05, tang)
	broke.emit(point, impact_e, &"neck_snap")


## Neck snapped: whatever is above the lowest rim point at the current tilt pours out (rate limited).
func _process_spill(dt: float) -> void:
	if state != &"neck_snapped" or fill <= 0.0:
		return
	var up := global_transform.basis.orthonormalized().inverse() * Vector3.UP
	var fmax := lut.max_fill_below_rim(up, open_z, _rim_r)
	if fill <= fmax:
		return
	var spill_ml := minf((fill - fmax) * lut.capacity_ml, 320.0 * dt)
	var mgr := BottleBreakManager.get_for(self)
	var low := Vector3(-up.x, 0.0, -up.z)
	low = low.normalized() * _rim_r if low.length() > 0.01 else Vector3.ZERO
	var wp := global_transform * Vector3(low.x, open_z, low.z)
	var outv := global_transform.basis * Vector3(low.x, 0.0, low.z).normalized() * 0.6 if low != Vector3.ZERO else Vector3.ZERO
	var n := clampi(int(spill_ml / 3.0) + 1, 1, 4)
	for i in n:
		mgr.emit_droplet(wp + Vector3(_rng.randfn(), 0, _rng.randfn()) * 0.003, outv + linear_velocity * 0.9
			+ Vector3(_rng.randfn(), 0, _rng.randfn()) * 0.15, spill_ml / n, lut.color)
	fill = maxf(fill - spill_ml / lut.capacity_ml, 0.0)
	ctl.fill = fill
	_update_mass()


func _physics_process(dt: float) -> void:
	if state == &"shattered":
		return
	var fast := predict_impacts and linear_velocity.length() > predict_min_speed
	if fast:
		_predict(dt)
	if not _pred_pending.is_empty() and Engine.get_physics_frames() >= int(_pred_pending["due"]):
		_flush_prediction()
	_process_leaks(dt)
	_process_spill(dt)
	var leak_idle := leaks.is_empty() or (not leak_flowing and (sleeping or freeze))
	if not fast and _pred_pending.is_empty() and (fill <= 0.0 or (leak_idle and state == &"intact")):
		set_physics_process(false)   # nothing to predict, leak or pour; woken again by _integrate_forces / wake / wake_leaks
