class_name GSBackpackState
extends RefCounted
## Pure state machine of a detachable backpack (P1): the GDScript twin of extensions/backpack/state.js. Same transitions,
## same rules, proven against the same golden vectors (tests/gs_backpack_parity_tests.gd). Owns no nodes, physics or
## rendering; the host feeds hand input and surface/zone distances and applies the outcome.
##
## WORN -> DRAWING -> HELD_CLOSED <-> HELD_OPEN -> PLACED -> (grab) HELD_* ; HELD_*/PLACED -> RETURNING -> WORN.
## Owner of the BAG (never of the items): WORN/DRAWING "worn", HELD_* "hand:left|right", PLACED "world", RETURNING "in_transit".
## The pack can never be lost: tracking loss while held freezes the bag for trackingGraceS and then sends it RETURNING;
## a release without a stable surface goes RETURNING (never a drop); death puts it WORN again.
## Uses the existing GSBackpackHandlePull unchanged (its constants equal data.PULL; the parity test checks that).

const Profile = preload("res://addons/gs_backpack/gs_backpack_profile.gd")
const HandlePull = preload("res://addons/gs_backpack/gs_backpack_handle_pull.gd")

const STATE_SCHEMA := "gamesystems.backpack.v1"
const EPS := 0.000000001
const POSTURES := ["standing", "crouch", "seated"]
const TRANSITIONS := {
	"WORN": ["DRAWING", "HELD_CLOSED"],
	"DRAWING": ["WORN", "HELD_CLOSED"],
	"HELD_CLOSED": ["HELD_OPEN", "PLACED", "RETURNING"],
	"HELD_OPEN": ["HELD_CLOSED", "PLACED", "RETURNING"],
	"PLACED": ["HELD_CLOSED", "HELD_OPEN", "RETURNING"],
	"RETURNING": ["WORN"],
}

var profile: Dictionary = {}
var thresholds: Dictionary = {}
var tier := "high"
var flags: Dictionary = {}
var state := "WORN"
var holder := ""
var secondary := false
var open_fraction := 0.0
var pull = HandlePull.new()

var _draw_side := ""
var _open_target := 0.0
var _access_open := false
var _hold_s := 0.0
var _prev_outward := 0.0
var _has_prev_outward := false
var _blocked := ""
var _grace_s := 0.0
var _grace_on := false
var _don_on := false
var _don_s := 0.0
var _return_s := 0.0
var _placed_pose: Dictionary = {}
var _posture := "standing"
var _hands: Dictionary = {"left": _normal_hand(null), "right": _normal_hand(null)}
var _events: Array = []

## Returns false (and leaves the object unusable) when the profile is invalid.
func configure(raw_profile: Variant, initial_tier := "high") -> bool:
	var parsed: Dictionary = Profile.parse(raw_profile)
	if not bool(parsed.ok) or not initial_tier in Profile.tier_names(): return false
	profile = parsed.profile
	thresholds = Profile.thresholds_of(profile)
	tier = initial_tier
	flags = Profile.tier_flags(profile, tier)
	_force_worn("configure")
	_events = []
	return true

static func can_transition(from: String, to: String) -> bool:
	return to in TRANSITIONS.get(from, [])

static func is_held(s: String) -> bool:
	return s == "HELD_CLOSED" or s == "HELD_OPEN"

func owner_id() -> String:
	if is_held(state): return "hand:" + holder
	match state:
		"PLACED": return "world"
		"RETURNING": return "in_transit"
	return "worn"

func snapshot() -> Dictionary:
	return {"state": state, "owner": owner_id(), "holder": holder, "secondary": secondary, "openFraction": open_fraction, "accessOpen": _access_open,
		"pullOffset": pull.offset_m, "returnProgress": clampf(_return_s / float(thresholds.returnDurationS), 0.0, 1.0) if state == "RETURNING" else 0.0,
		"placed": not _placed_pose.is_empty(), "posture": _posture}

func can_access(pocket_id: String) -> bool:
	var pocket: Dictionary = {}
	for k in profile.pockets:
		if k.id == pocket_id: pocket = k
	if pocket.is_empty() or not bool(flags.enabled): return false
	var open_here := _access_open and (is_held(state) or state == "PLACED")
	if pocket.access == "always": return true
	if pocket.access == "worn": return state == "WORN" or open_here
	return open_here

func set_posture(p: String) -> bool:
	if not p in POSTURES: return false
	_posture = p
	return true

func set_tier(name: String) -> Dictionary:
	if not name in Profile.tier_names(): return _done(false, "invalid_tier")
	tier = name
	flags = Profile.tier_flags(profile, name)
	if not bool(flags.enabled): _force_worn("tier_off")
	elif not bool(flags.pull) and state == "DRAWING": _cancel_draw("tier_lowered")
	elif not _can_detach() and (is_held(state) or state == "PLACED"): _to_returning("tier_lowered")
	return _done(true)

func grab(side: String, kind := "grip", handle_distance_m: Variant = null) -> Dictionary:
	if side != "left" and side != "right": return _done(false, "invalid_hand")
	if kind != "grip" and kind != "interact": return _done(false, "invalid_kind")
	if not bool(flags.enabled) or not bool(flags.pull): return _done(false, "tier_off")
	if state == "RETURNING": return _done(false, "returning")
	if state != "WORN" and state != "PLACED": return _done(false, "busy")
	var hand: Dictionary = _hands[side]
	if not bool(hand.tracked): return _done(false, "not_tracked")
	if not bool(hand.grip): return _done(false, "not_gripping")
	if not (handle_distance_m is float or handle_distance_m is int) or not is_finite(float(handle_distance_m)) or float(handle_distance_m) > float(profile.handle.reachM) + EPS:
		return _done(false, "out_of_reach")
	if state == "WORN":
		if not pull.begin(hand.local, side, kind): return _done(false, "busy")
		_draw_side = side
		_hold_s = 0.0
		_has_prev_outward = false
		_blocked = ""
		_go("DRAWING", "grab")
	else:
		if not _can_detach(): return _done(false, "tier_no_detach")
		_to_held(side, "grab_placed")
	return _done(true)

## A scene host may supply current eligibility without advancing simulation.
## Omitted/null keeps the pure state's most recently stepped secondary flag.
func open(secondary_now: Variant = null) -> Dictionary:
	if not is_held(state) and state != "PLACED": return _done(false, "invalid_state")
	if not bool(flags.open): return _done(false, "tier_no_open")
	var supported: bool = bool(secondary_now) if secondary_now is bool else secondary
	if is_held(state) and bool(flags.twoHand) and not supported: return _done(false, "needs_two_hands")
	_open_target = 1.0
	return _done(true)

func close() -> Dictionary:
	if not is_held(state) and state != "PLACED": return _done(false, "invalid_state")
	_open_target = 0.0
	return _done(true)

func call_to_hand(side: String) -> Dictionary:
	if side != "left" and side != "right": return _done(false, "invalid_hand")
	if not bool(flags.enabled) or not _can_detach(): return _done(false, "tier_no_detach")
	if not bool(profile.recall.seated): return _done(false, "recall_disabled")
	if state != "WORN" and state != "PLACED": return _done(false, "returning" if state == "RETURNING" else "busy")
	if _posture != "seated": return _done(false, "not_seated")
	var hand: Dictionary = _hands[side]
	if not bool(hand.tracked): return _done(false, "not_tracked")
	if not bool(hand.grip): return _done(false, "not_gripping")
	if state == "WORN": _access_open = false
	_to_held(side, "call_to_hand")
	return _done(true)

func die() -> Dictionary:
	_force_worn("death_restore")
	return _done(true)

## input: {hands:{left,right:{tracked,grip,local:[x,y,z]|null}}, posture, pathClear, weaponBusy, surface:{stable,position,rotation}, donDistanceM, bagDistanceM}
func step(dt: float, input: Dictionary = {}) -> Dictionary:
	if not is_finite(dt) or dt < 0.0: return _done(false, "invalid_dt")
	dt = minf(dt, float(thresholds.maxStepS))
	var hands_in: Dictionary = input.get("hands", {}) if input.get("hands") is Dictionary else {}
	_hands = {"left": _normal_hand(hands_in.get("left")), "right": _normal_hand(hands_in.get("right"))}
	if input.get("posture") in POSTURES: _posture = input.posture
	if not bool(flags.enabled): return _done(true)
	match state:
		"WORN": pull.step(Vector3.ZERO, false, dt)
		"DRAWING": _step_drawing(dt, input)
	if is_held(state):
		_step_held(dt, input)
	elif state == "PLACED":
		var bag_d: Variant = input.get("bagDistanceM")
		if _finite(bag_d) and float(bag_d) > float(thresholds.autoReturnDistanceM): _to_returning("too_far")
	if is_held(state) or state == "PLACED" or state == "RETURNING": _advance_open(dt)
	if state == "RETURNING":
		_return_s += dt
		if _return_s + EPS >= float(thresholds.returnDurationS): _force_worn("returned")
	return _done(true)

func capture() -> Dictionary:
	var placed := state == "PLACED" and not _placed_pose.is_empty()
	return {"schema": STATE_SCHEMA, "profileId": profile.id, "state": "PLACED" if placed else "WORN", "owner": "world" if placed else "worn",
		"openFraction": open_fraction if placed else 0.0,
		"placedPose": _placed_pose.duplicate(true) if placed else null}

## {ok, reason}; validates without mutation. Commit with commit_restore(prepared).
func prepare_restore(raw: Variant) -> Dictionary:
	if not raw is Dictionary: return {"ok": false, "reason": "invalid"}
	var d: Dictionary = raw
	if d.get("schema") != STATE_SCHEMA or d.get("profileId") != profile.id: return {"ok": false, "reason": "invalid"}
	var st: Variant = d.get("state")
	if not st in ["WORN", "PLACED"]: return {"ok": false, "reason": "invalid"}
	var of: Variant = d.get("openFraction")
	if not _finite(of) or float(of) < 0.0 or float(of) > 1.0: return {"ok": false, "reason": "invalid"}
	var pose: Variant = d.get("placedPose")
	if st == "WORN" and (d.get("owner") != "worn" or pose != null or float(of) != 0.0): return {"ok": false, "reason": "invalid"}
	if st == "PLACED" and (d.get("owner") != "world" or not _valid_pose(pose)): return {"ok": false, "reason": "invalid"}
	return {"ok": true, "reason": "", "state": st, "openFraction": float(of), "placedPose": _copy_pose(pose) if st == "PLACED" else {}}

func commit_restore(prepared: Dictionary) -> bool:
	if not bool(prepared.get("ok", false)): return false
	_force_worn("restore")
	if prepared.state == "PLACED" and _can_detach():
		state = "PLACED"
		_placed_pose = prepared.placedPose
		open_fraction = float(prepared.openFraction)
		_access_open = open_fraction >= float(thresholds.openAccessFraction)
		_open_target = 1.0 if _access_open else 0.0
	_events = []
	return true

func restore(raw: Variant) -> bool:
	return commit_restore(prepare_restore(raw))

func reset() -> void:
	_force_worn("reset")
	_events = []

# ---- internals

func _step_drawing(dt: float, input: Dictionary) -> void:
	var hand: Dictionary = _hands[_draw_side]
	if not bool(hand.tracked):
		_cancel_draw("tracking_lost")
		pull.step(Vector3.ZERO, false, dt)
		return
	if not bool(hand.grip):
		_cancel_draw("grip_released")
		pull.step(Vector3.ZERO, false, dt)
		return
	var local: Vector3 = hand.local
	var offset: float = pull.step(local, true, dt)
	var outward: float = pull.start_local.z - local.z
	var speed := 0.0 if (not _has_prev_outward or dt <= 0.0) else (outward - _prev_outward) / dt
	_prev_outward = outward
	_has_prev_outward = true
	var ready := offset + EPS >= float(thresholds.releaseOffsetM)
	_hold_s = _hold_s + dt if ready else 0.0
	if not ready:
		_blocked = ""
		return
	if not (_hold_s + EPS >= float(thresholds.releaseHoldS) or speed >= float(thresholds.releaseSpeedMps)): return
	var block := ""
	if not _can_detach(): block = "tier_no_detach"
	elif input.get("pathClear") == false: block = "path_blocked"
	elif input.get("weaponBusy") == true: block = "weapon_busy"
	if not block.is_empty():
		if block != _blocked: _note("release_blocked", {"reason": block})
		_blocked = block
		return
	var side := _draw_side
	_pull_clear()
	_draw_side = ""
	_hold_s = 0.0
	_has_prev_outward = false
	_blocked = ""
	_to_held(side, "released")
	_note("detached", {"side": side})

func _step_held(dt: float, input: Dictionary) -> void:
	var hand: Dictionary = _hands[holder]
	var other_side := "right" if holder == "left" else "left"
	var other: Dictionary = _hands[other_side]
	secondary = bool(flags.twoHand) and bool(other.tracked) and bool(other.grip)
	if not bool(hand.tracked):
		if not _grace_on:
			_grace_on = true
			_note("tracking_grace", {"side": holder})
		_grace_s += dt
		if _grace_s + EPS >= float(thresholds.trackingGraceS): _to_returning("tracking_lost")
		return
	if _grace_on: _note("tracking_regained", {"side": holder})
	_grace_s = 0.0
	_grace_on = false
	var d: Variant = input.get("donDistanceM")
	if _finite(d):
		_don_on = (float(d) <= float(thresholds.donExitM)) if _don_on else (float(d) <= float(thresholds.donEnterM))
		_don_s = _don_s + dt if _don_on else 0.0
	else:
		_don_on = false
		_don_s = 0.0
	if bool(hand.grip): return
	if bool(flags.twoHand) and bool(other.tracked) and bool(other.grip):
		holder = other_side
		secondary = false
		_note("handoff", {"side": holder})
	elif _don_on and _don_s + EPS >= float(thresholds.donDwellS):
		_to_returning("don")
	else:
		var surface: Variant = input.get("surface")
		if surface is Dictionary and surface.get("stable") == true and _valid_pose(surface):
			var pose := _copy_pose(surface)
			_go("PLACED", "placed")
			holder = ""
			secondary = false
			_grace_s = 0.0
			_grace_on = false
			_don_on = false
			_don_s = 0.0
			_placed_pose = pose
		else:
			_to_returning("no_surface")

func _advance_open(dt: float) -> void:
	var step := dt / float(thresholds.openDurationS)
	if open_fraction < _open_target: open_fraction = minf(_open_target, open_fraction + step)
	elif open_fraction > _open_target: open_fraction = maxf(_open_target, open_fraction - step)
	if not _access_open and _open_target == 1.0 and open_fraction + EPS >= float(thresholds.openAccessFraction): _access_open = true
	elif _access_open and open_fraction < float(thresholds.closeAccessFraction) - EPS: _access_open = false
	if state == "HELD_CLOSED" and _access_open: _go("HELD_OPEN", "opened")
	elif state == "HELD_OPEN" and not _access_open: _go("HELD_CLOSED", "closed")

func _can_detach() -> bool:
	return bool(flags.enabled) and bool(flags.detach) and bool(profile.detachable)

func _go(to: String, reason: String) -> void:
	var from := state
	assert(can_transition(from, to), "Illegal backpack transition %s -> %s" % [from, to])
	state = to
	_note("state", {"from": from, "to": to, "reason": reason})

func _pull_clear() -> void:
	pull.cancel()
	pull.offset_m = 0.0

func _force_worn(reason: String) -> void:
	var from := state
	_pull_clear()
	state = "WORN"
	holder = ""
	secondary = false
	_draw_side = ""
	open_fraction = 0.0
	_open_target = 0.0
	_access_open = false
	_hold_s = 0.0
	_has_prev_outward = false
	_blocked = ""
	_grace_s = 0.0
	_grace_on = false
	_don_on = false
	_don_s = 0.0
	_return_s = 0.0
	_placed_pose = {}
	if from != "WORN": _note("state", {"from": from, "to": "WORN", "reason": reason})

func _to_returning(reason: String) -> void:
	_go("RETURNING", reason)
	holder = ""
	secondary = false
	_open_target = 0.0
	_grace_s = 0.0
	_grace_on = false
	_don_on = false
	_don_s = 0.0
	_return_s = 0.0
	_placed_pose = {}

func _to_held(side: String, reason: String) -> void:
	_go("HELD_OPEN" if _access_open else "HELD_CLOSED", reason)
	holder = side
	secondary = false
	_grace_s = 0.0
	_grace_on = false
	_don_on = false
	_don_s = 0.0
	_placed_pose = {}

func _cancel_draw(reason: String) -> void:
	pull.cancel()
	_draw_side = ""
	_hold_s = 0.0
	_has_prev_outward = false
	_blocked = ""
	_go("WORN", reason)

func _note(type: String, data: Dictionary = {}) -> void:
	var e := {"type": type}
	e.merge(data)
	_events.append(e)

func _done(ok: bool, reason := "") -> Dictionary:
	var r := {"ok": ok, "reason": reason, "events": _events}
	_events = []
	return r

static func _finite(v: Variant) -> bool:
	return (v is float or v is int) and is_finite(float(v))

static func _valid_pose(p: Variant) -> bool:
	if not p is Dictionary: return false
	var pos: Variant = p.get("position")
	var rot: Variant = p.get("rotation")
	if not pos is Array or pos.size() != 3 or not rot is Array or rot.size() != 4: return false
	var n := 0.0
	for v in pos:
		if not _finite(v): return false
	for v in rot:
		if not _finite(v): return false
		n += float(v) * float(v)
	return sqrt(n) > 0.000000001

static func _copy_pose(p: Dictionary) -> Dictionary:
	return {"position": (p.position as Array).duplicate(), "rotation": (p.rotation as Array).duplicate()}

static func _normal_hand(h: Variant) -> Dictionary:
	var local := Vector3.ZERO
	var has_local := false
	if h is Dictionary:
		var l: Variant = h.get("local")
		if l is Array and l.size() == 3 and _finite(l[0]) and _finite(l[1]) and _finite(l[2]):
			local = Vector3(float(l[0]), float(l[1]), float(l[2]))
			has_local = true
	return {"tracked": h is Dictionary and h.get("tracked") == true and has_local, "grip": h is Dictionary and h.get("grip") == true, "local": local}
