class_name GSBackpackSceneAdapter
extends Node
## P3: the ADDITIVE scene adapter for the detachable backpack. It sits on top of an unchanged scene adapter / ledger (the host passes the
## ledger only through the alias provider, whose cells map onto slots that already exist), so the gear-inventory API and its checkpoint
## format are untouched. This is the one object that connects the pure state machine (GSBackpackState) and the container
## (GSBackpackContainer) to nodes.
##
## What it does
##  * Moves the bag as ONE node group (`pack`): WORN -> DRAWING -> HELD_CLOSED/HELD_OPEN -> PLACED -> RETURNING -> WORN. While DRAWING the
##    host's own guided pull still owns the pose; from the release (detach) the adapter owns it through `move_pack`.
##    Every scene transition is atomic: a refused move rolls the pack back to the worn frame and the state machine back to WORN.
##  * Never loses the pack: a release without a valid surface, tracking loss past the grace time (`return_delay_s`), being too far away
##    and putting it back on the back all end as RETURNING, an eased flight back to the worn frame, never a drop.
##  * Keeps the body mounts (hips/chest/back, GSBackpackBodyMounts) on the body while the bag is away.
##  * One refresh path for the open bag: the container's refresh() is the ONLY thing that touches item proxies. High tier: at most
##    `physicalItemsMax` (<= 12) real items per page on cell anchors (host layout), the rest hidden. Below high: a slot view from above.
##  * Collision exceptions: collision_exclusions() lists the pack's own colliders and the bagged items' colliders (a container ignores its
##    own inner rigids); GSBackpackBodyMounts.zone_may_snap() keeps a zone from snapping its own ancestor.
##  * Summon (call to hand) is an optional gesture, also seated; weight uses the shared held-drive model when it is installed.
##
## Everything is event- or tick-cheap: one state step per physics tick, one pose write while detached, no per-frame scans.
## Host contract: see configure(). Audio/haptic hooks are the `cue` signal (empty unless the host connects it).

const Profile = preload("res://addons/gs_backpack/gs_backpack_profile.gd")
const ProfileExt = preload("res://addons/gs_backpack/gs_backpack_profile_ext.gd")
const BpState = preload("res://addons/gs_backpack/gs_backpack_state.gd")
const BpContainer = preload("res://addons/gs_backpack/gs_backpack_container.gd")
const SlotAlias = preload("res://addons/gs_backpack/gs_backpack_slot_alias.gd")
const HELD_DRIVE_PATH := "res://addons/gs_grasp/gs_grasp_held_drive.gd"
const SIDES := ["left", "right"]
const SNAP_FAR_M := 1.0
const MAX_STEP_S := 0.05

signal state_changed(from: String, to: String, reason: String)
## kind: grab | detach | place | return | snap | open | close | summon | handoff | reject. Empty by default: hosts map it to haptics/audio.
signal cue(kind: String, side: String)
## Discrete state rejection; cue("reject", side) remains the haptic channel.
signal draw_blocked(side: String, reason: String)
signal view_refreshed(view: Dictionary)
signal rolled_back(reason: String)

var state: BpState
var container: BpContainer
var provider: Object
var pack: Node3D
var mounts: Object
var tier := "high"
var detach_pull_m := 0.26
var carry_blend_s := 0.12
var summon_blend_s := 0.35
var place_blend_s := 0.15
var summon_enabled := true
var summon_standing := true
var auto_step := true
## Test seam: the next pack move is refused (proves the atomic rollback).
var fail_next_move := false

var _profile: Dictionary = {}
var _hand_input: Callable
var _hand_free: Callable
var _secondary_grip_access: Callable
var _weapon_busy: Callable
var _surface_probe: Callable
var _path_clear: Callable
var _move_pack_fn: Callable
var _constrain_carry_fn: Callable
var _release_fn: Callable
var _flap_fn: Callable
var _cell_anchor: Callable
var _item_node: Callable
var _cell_layout: Callable
var _mass_fn: Callable
var _exclusion_sink: Callable
var _handle_node: Node3D
var _alias: Object
var _external := false
var _from_pose := Transform3D.IDENTITY
var _pose := Transform3D.IDENTITY
var _blend_t := 1.0
var _blend_s := 0.12
var _lag_pos := Vector3.ZERO
var _lag_vel := Vector3.ZERO
var _placed_xf := Transform3D.IDENTITY
var _surface_xf := Transform3D.IDENTITY
var _last_frame := Transform3D.IDENTITY
var _last_hand := Transform3D.IDENTITY
var _carry_handle_offset := Vector3.ZERO
var _prev_grip := {"left": false, "right": false}
## Acquisition requires observed neutral; held-pack tracking recovery is independent.
var _summon_armed := {"left": false, "right": false}
var _hands: Dictionary = {}
var _syncing := false
var _flap_open := false
var _saved_anchor: Dictionary = {}
var _hidden_anchors: Dictionary = {}
var _slot_view: Node3D
var _slot_marks: Dictionary = {}
var _drive: Variant
var _last_view: Dictionary = {}
var _cells_bag: Array = []
var _steps := 0

## opts:
##  required  profile: Dictionary (gamesystems.backpack-profile.v1), pack: Node3D (the bag node group), anchors: GSBackpackBodyAnchorProvider
##  optional  tier: String, ledger + cell_slots (container over an alias of existing slots: {cell_id: real_slot_id}),
##            item_info: Callable(item_id) -> {category,size,owner,tags}, item_node: Callable(item_id) -> Node3D,
##            cell_anchor: Callable(cell_id) -> Node3D, cell_layout: Callable(index:int, count:int, cell:String) -> Transform3D (open frame),
##            handle: Node3D, hand_input: Callable(side) -> {tracked, grip, world:Transform3D}, hand_free: Callable(side) -> bool,
##            secondary_grip_access: Callable(side, hand_world:Transform3D) -> bool (optional cover check after reach/free qualification),
##            weapon_busy: Callable(side) -> bool, path_clear: Callable(side) -> bool,
##            surface_probe: Callable(pack_world:Transform3D, hand_world:Transform3D) -> {stable, position:[x,y,z], rotation:[x,y,z,w]},
##            move_pack: Callable(world:Transform3D) -> bool (default writes pack.global_transform; the host takes the pose while detached),
##            constrain_carry_pose: Callable(desired:Transform3D) -> Transform3D (optional safe held pose; invalid result freezes pose),
##            release_pack: Callable(world:Transform3D) (the host takes the pose back at the worn frame; default writes pack.global_transform),
##            flap: Callable(open:bool) (host animates its flap), mass: Callable() -> float (kg), exclusion_sink: Callable(Array[RID]),
##            mounts: GSBackpackBodyMounts, return_delay_s: float (tracking-loss grace), detach_pull_m, summon (bool), summon_standing (bool)
func configure(opts: Dictionary) -> bool:
	var raw: Variant = opts.get("profile")
	pack = opts.get("pack") as Node3D
	provider = opts.get("anchors")
	if not raw is Dictionary or not is_instance_valid(pack) or provider == null: return false
	for m in ["is_valid", "pack_frame", "posture", "head_position"]:
		if not provider.has_method(m): return false
	var parsed: Dictionary = ProfileExt.parse(raw)
	if not bool(parsed.ok): return false
	_profile = parsed.profile
	if opts.has("return_delay_s"):
		var th: Dictionary = _profile.get("thresholds", {}).duplicate()
		th["trackingGraceS"] = maxf(0.0, float(opts.return_delay_s))
		_profile["thresholds"] = th
	tier = String(opts.get("tier", "high"))
	state = BpState.new()
	if not state.configure(_state_profile(_profile), tier): return false
	_prev_grip = {"left": false, "right": false}
	_summon_armed = {"left": false, "right": false}
	detach_pull_m = float(opts.get("detach_pull_m", detach_pull_m))
	summon_enabled = bool(opts.get("summon", summon_enabled))
	summon_standing = bool(opts.get("summon_standing", summon_standing))
	_hand_input = opts.get("hand_input", Callable())
	_hand_free = opts.get("hand_free", Callable())
	_secondary_grip_access = opts.get("secondary_grip_access", Callable())
	_weapon_busy = opts.get("weapon_busy", Callable())
	_path_clear = opts.get("path_clear", Callable())
	_surface_probe = opts.get("surface_probe", Callable())
	_move_pack_fn = opts.get("move_pack", Callable())
	_constrain_carry_fn = opts.get("constrain_carry_pose", Callable())
	_release_fn = opts.get("release_pack", Callable())
	_flap_fn = opts.get("flap", Callable())
	_cell_anchor = opts.get("cell_anchor", Callable())
	_item_node = opts.get("item_node", Callable())
	_cell_layout = opts.get("cell_layout", Callable())
	_mass_fn = opts.get("mass", Callable())
	_exclusion_sink = opts.get("exclusion_sink", Callable())
	_handle_node = opts.get("handle") as Node3D
	mounts = opts.get("mounts")
	var real: Object = opts.get("ledger")
	var cell_slots: Dictionary = opts.get("cell_slots", {})
	if real != null and not cell_slots.is_empty():
		_alias = SlotAlias.new()
		if not bool(_alias.configure(real, cell_slots)): return false
		container = BpContainer.new()
		var copts := {"can_access": Callable(self, "_can_access"), "tier": Callable(self, "get_tier"), "transit_owner": "world"}
		if opts.has("item_info"): copts["info_provider"] = opts.item_info
		if not container.configure(_profile, _alias, copts): return false
		container.on_refresh(Callable(self, "_apply_view"))
		_cells_bag = []
		for pid in container.pocket_ids():
			for k in _profile.pockets:
				if k.id == pid and String(k.container) == "bag": _cells_bag.append_array(container.cell_ids(pid))
		if real.has_signal("ownership_changed"): real.connect("ownership_changed", Callable(self, "_on_ownership_changed"))
	if ResourceLoader.exists(HELD_DRIVE_PATH): _drive = load(HELD_DRIVE_PATH)
	_last_frame = provider.pack_frame() if bool(provider.is_valid()) else pack.global_transform
	set_physics_process(auto_step)
	process_priority = 100 # after the host's own body-follow tick
	return true

func get_tier() -> String: return tier

func set_tier(name: String) -> bool:
	if state == null or not name in Profile.tier_names(): return false
	tier = name
	_process_events(state.set_tier(name).events)
	if container != null: container.refresh()
	return true

func is_detached() -> bool: return _external
func current_state() -> String: return state.state if state != null else "WORN"
## During move_pack, false means this PLACED target is the final blend pose;
## the callback can still refuse it before publication.
func placement_in_progress() -> bool:
	return state != null and state.state == "PLACED" and _blend_t < 1.0
func holder_side() -> String: return state.holder if state != null else ""
func profile() -> Dictionary: return _profile

## Host-authorized rigid origin motion. Call once for each applied delta, before
## the next step; the pack's parent may already have moved. Carries only a held
## pack: placed/returning bags remain world anchored.
## The host owns clearance policy through move_pack. No state, grip edges or
## body-local pull history changes; physical hand motion remains in the next sample.
func transport_carried_pose(delta: Transform3D) -> bool:
	if state == null or not BpState.is_held(state.state) or not _external: return true
	if not delta.is_finite() or not delta.basis.is_equal_approx(delta.basis.orthonormalized()) or delta.basis.determinant() < 0.999: return false
	if not is_instance_valid(pack): return false
	# _pose is adapter-owned world history; the node may already have inherited
	# its parent's translation. Reading it here would apply that translation twice.
	var moved := delta * _pose
	# Publish first: refusal must leave every history in the original space.
	if not _move_pack(moved): return false
	_pose = moved
	_from_pose = delta * _from_pose
	_lag_pos = delta * _lag_pos
	_lag_vel = delta.basis * _lag_vel
	_last_hand = delta * _last_hand
	_last_frame = delta * _last_frame
	return true

func _physics_process(dt: float) -> void:
	if auto_step: step(dt)

# ------------------------------------------------------------------------------------------------ tick
## One state step and (while detached) one pose write. Call once per physics tick (auto when auto_step).
func step(dt: float) -> void:
	if state == null or not is_instance_valid(pack): return
	dt = clampf(dt, 0.0, MAX_STEP_S)
	_steps += 1
	_read_hands()
	var frame := _body_frame()
	var inv := frame.affine_inverse()
	_poll_summon(frame)
	var st: String = state.state
	var hands_in := {}
	for side in SIDES:
		var h: Dictionary = _hands[side]
		hands_in[side] = {"tracked": h.tracked, "grip": h.grip, "local": _arr(inv * (h.world as Transform3D).origin) if h.tracked else null}
	if BpState.is_held(st) and bool(state.flags.twoHand):
		# State inputs describe a usable secondary hold, not an arbitrary
		# squeeze elsewhere. Keep raw samples/neutral arming untouched.
		var other := "right" if state.holder == "left" else "left"
		hands_in[other].grip = _secondary_hold_usable()
	var input := {"hands": hands_in, "posture": String(provider.posture())}
	if st == "DRAWING":
		var side: String = state._draw_side
		var h2: Dictionary = _hands[side]
		var outward := 0.0
		if h2.tracked: outward = float(state.pull.start_local.z) - (inv * (h2.world as Transform3D).origin).z
		var clear := outward >= detach_pull_m
		if clear and _path_clear.is_valid(): clear = bool(_path_clear.call(side))
		input["pathClear"] = clear
		input["weaponBusy"] = _weapon_busy.is_valid() and bool(_weapon_busy.call(side))
	elif BpState.is_held(st):
		var hs: String = state.holder
		var hh: Dictionary = _hands[hs]
		if hh.tracked:
			_last_hand = hh.world
			if not bool(hh.grip): input["surface"] = _probe_surface(hh.world)
		input["donDistanceM"] = pack.global_position.distance_to(frame.origin)
	elif st == "PLACED":
		input["bagDistanceM"] = pack.global_position.distance_to(frame.origin)
	var result: Dictionary = state.step(dt, input)
	_process_events(result.events)
	# Handoff may have changed holder in this step. Presentation must use the
	# receiving hand immediately, rather than one frame of the released hand.
	if BpState.is_held(state.state):
		var current_hand: Dictionary = _hands[String(state.holder)]
		if current_hand.tracked: _last_hand = current_hand.world
	_update_pose(dt, frame)
	for side in SIDES: _prev_grip[side] = _hands[side].grip

## A hand grip landed on the pack handle (the host's rig reports it). Returns true when the adapter consumed the grip (picked up a
## placed pack), so the host skips its own flap toggle; false = the host continues (WORN starts the DRAWING pull next to the host's own
## guided pull; a second hand on a held pack toggles the flap through notify_flap()).
func on_handle_grip(side: String, hand_world: Transform3D, kind := "grip") -> bool:
	if state == null or not side in SIDES or not hand_world.is_finite(): return false
	var st: String = state.state
	if st != "WORN" and st != "PLACED": return false
	if _hand_free.is_valid() and not bool(_hand_free.call(side)): return false
	_read_hands()
	var frame := _body_frame()
	var inv := frame.affine_inverse()
	var hands_in := {}
	for s in SIDES:
		var h: Dictionary = _hands[s]
		if s == side:
			# The event's own pose is authoritative for the grabbing hand.
			h = {"tracked": true, "grip": kind == "grip" or bool(h.grip), "world": hand_world}
		hands_in[s] = {"tracked": h.tracked, "grip": h.grip, "local": _arr(inv * (h.world as Transform3D).origin) if h.tracked else null}
	_process_events(state.step(0.0, {"hands": hands_in, "posture": String(provider.posture())}).events)
	var d := hand_world.origin.distance_to(handle_world())
	var r: Dictionary = state.grab(side, "grip" if kind == "grip" else "interact", d)
	_process_events(r.events)
	if bool(r.ok):
		cue.emit("grab", side)
		return st == "PLACED"
	return false

## The host's flap finished toggling (or was toggled by the other hand). Keeps the state machine's open fraction and the pockets' access in
## step with it; a refused open (one hand on a two-hand tier) reverts the host flap.
func notify_flap(opened: bool) -> void:
	_flap_open = opened
	if state == null or _syncing: return
	var st: String = state.state
	if not (BpState.is_held(st) or st == "PLACED"): return
	var secondary_now: Variant = null
	if opened and BpState.is_held(st) and bool(state.flags.twoHand):
		# The host toggle can precede our physics step. Refresh eligibility only;
		# do not synthesize a state step/release/handoff to update a cached flag.
		_read_hands()
		secondary_now = _secondary_hold_usable(true)
	var r: Dictionary = state.open(secondary_now) if opened else state.close()
	_process_events(r.events)
	if opened and not bool(r.ok):
		_set_flap(false)
		cue.emit("reject", String(state.holder))
	else:
		cue.emit("open" if opened else "close", String(state.holder))
	if container != null: container.refresh()

func on_player_died() -> void:
	if state == null: return
	_process_events(state.die().events)

# ------------------------------------------------------------------------------------------------ events and scene transitions
func _process_events(events: Array) -> void:
	for e in events:
		match String(e.type):
			"state": _transition(String(e.from), String(e.to), String(e.reason))
			"detached": cue.emit("detach", String(e.side))
			"handoff": cue.emit("handoff", String(e.side))
			"release_blocked":
				# DRAWING has no holder yet. Capture the initiating hand before
				# synchronous host callbacks can change state.
				var side := String(state._draw_side)
				cue.emit("reject", side)
				draw_blocked.emit(side, String(e.reason))

func _transition(from: String, to: String, reason: String) -> void:
	var ok := true
	var frame := _body_frame()
	match to:
		"HELD_CLOSED", "HELD_OPEN":
			if from == "WORN" or from == "DRAWING" or from == "PLACED": ok = _begin_hold(from, reason)
		"PLACED":
			ok = _begin_place()
		"RETURNING":
			_from_pose = pack.global_transform
			_lag_vel = Vector3.ZERO
			_set_flap(false)
			cue.emit("snap" if reason == "don" else "return", String(state.holder))
		"WORN":
			if _external: _end_external(frame)
	if not ok:
		_rollback("move_refused:%s" % reason)
		return
	state_changed.emit(from, to, reason)
	if container != null: container.refresh()

func _begin_hold(from: String, reason: String) -> bool:
	_from_pose = pack.global_transform
	_pose = _from_pose
	_carry_handle_offset = handle_local()
	_lag_pos = _from_pose.origin
	_lag_vel = Vector3.ZERO
	_blend_t = 0.0
	_blend_s = summon_blend_s if reason == "call_to_hand" else carry_blend_s
	if from == "DRAWING" or from == "WORN":
		_set_flap(false)
		if mounts != null: mounts.set_detached(true)
	if not _external:
		if not _move_pack(_from_pose): return false
		_external = true
	_push_exclusions()
	if reason == "call_to_hand": cue.emit("summon", String(state.holder))
	return true

func _begin_place() -> bool:
	_from_pose = pack.global_transform
	_placed_xf = _surface_xf
	_blend_t = 0.0
	_blend_s = place_blend_s
	if not _placed_xf.is_finite(): return false
	cue.emit("place", String(state.holder))
	_push_exclusions()
	return true

## Back at the worn frame: hand the pose back to the host and re-attach the body mounts.
func _end_external(frame: Transform3D) -> void:
	_external = false
	if mounts != null: mounts.set_detached(false)
	_move_pack_release(frame)
	_set_flap(false)
	_blend_t = 1.0
	_push_exclusions()

## Atomic rollback: the state machine goes back to WORN, the pack to the worn frame, the host gets its pose back. Never a drop.
func _rollback(reason: String) -> void:
	state.reset()
	_external = false
	if mounts != null: mounts.set_detached(false)
	_move_pack_release(_body_frame())
	_set_flap(false)
	_blend_t = 1.0
	rolled_back.emit(reason)
	state_changed.emit("?", "WORN", reason)
	if container != null: container.refresh()

func _update_pose(dt: float, frame: Transform3D) -> void:
	if not _external: return
	var st: String = state.state
	var target := _pose
	match st:
		"HELD_CLOSED", "HELD_OPEN":
			# The state machine's unknown-tracking grace retains ownership and
			# freezes the last pose. A stale hand plus a changed body frame must
			# not drive the bag (or advance blend/lag) during that grace.
			if not bool(_hands.get(String(state.holder), {}).get("tracked", false)): return
			target = _carry_target(frame)
			var attachment := handle_local()
			var attachment_delta := attachment - _carry_handle_offset
			# Internal compartment animation is not hand acceleration. Rebase
			# blend/lag anchors only; the actual pose still passes host clearance.
			_from_pose.origin -= _from_pose.basis * attachment_delta
			_lag_pos -= target.basis * attachment_delta
			_carry_handle_offset = attachment
			if _blend_t < 1.0:
				_blend_t = minf(1.0, _blend_t + (dt / maxf(_blend_s, 0.001)))
				target = _from_pose.interpolate_with(target, _smooth(_blend_t))
			target = _weighted(target, dt)
			if _constrain_carry_fn.is_valid():
				var safe: Variant = _constrain_carry_fn.call(target)
				var constrained := _pose
				if safe is Transform3D and safe.is_finite() and safe.basis.determinant() > 0.001:
					constrained = safe
				if not constrained.is_equal_approx(target):
					# Keep contact from storing spring velocity that would launch
					# the bag when the real hand moves back into clear space.
					_lag_pos = constrained.origin
					_lag_vel = Vector3.ZERO
				target = constrained
		"PLACED":
			if _blend_t < 1.0:
				_blend_t = minf(1.0, _blend_t + (dt / maxf(place_blend_s, 0.001)))
				target = _from_pose.interpolate_with(_placed_xf, _smooth(_blend_t))
			else:
				target = _placed_xf
		"RETURNING":
			var p: float = float(state.snapshot().returnProgress)
			target = _from_pose.interpolate_with(frame, _smooth(p))
		_:
			return
	_pose = target
	if not _move_pack(target): _rollback("move_refused:pose")

func _carry_target(frame: Transform3D) -> Transform3D:
	var fwd := -frame.basis.z
	var yaw := atan2(-fwd.x, -fwd.z)
	var basis := Basis(Vector3.UP, yaw)
	return Transform3D(basis, _last_hand.origin - basis * handle_local())

func _weighted(target: Transform3D, dt: float) -> Transform3D:
	if not bool(state.flags.get("weightLag", false)) or _drive == null or dt <= 0.0:
		_lag_pos = target.origin
		_lag_vel = Vector3.ZERO
		return target
	var mass := float(_mass_fn.call()) if _mass_fn.is_valid() else float(_profile.get("mass", {}).get("emptyKg", 1.0))
	var a: Variant = _drive.drive_acceleration(_lag_pos, _lag_vel, target.origin, mass, dt, Vector3.ZERO, Vector3.ZERO)
	if a is Vector3:
		_lag_vel += a * dt
		_lag_pos += _lag_vel * dt
	else:
		_lag_pos = target.origin
	if _lag_pos.distance_to(target.origin) > SNAP_FAR_M or not _lag_pos.is_finite():
		_lag_pos = target.origin
		_lag_vel = Vector3.ZERO
	return Transform3D(target.basis, _lag_pos)

# ------------------------------------------------------------------------------------------------ summon
func _poll_summon(frame: Transform3D) -> void:
	if not summon_enabled: return
	var st: String = state.state
	if st != "WORN" and st != "PLACED": return
	for side in SIDES:
		var h: Dictionary = _hands[side]
		if not h.tracked or not h.grip or _prev_grip[side] or not _summon_armed[side]: continue
		_summon_armed[side] = false
		if _hand_free.is_valid() and not bool(_hand_free.call(side)): continue
		if not _in_summon_zone((h.world as Transform3D).origin): continue
		var real_posture := String(provider.posture())
		var hands_in := {}
		var inv := frame.affine_inverse()
		for s in SIDES:
			var hs: Dictionary = _hands[s]
			hands_in[s] = {"tracked": hs.tracked, "grip": hs.grip, "local": _arr(inv * (hs.world as Transform3D).origin) if hs.tracked else null}
		var posture := real_posture
		if summon_standing and real_posture != "seated": posture = "seated" # assisted: same recall, any posture
		_process_events(state.step(0.0, {"hands": hands_in, "posture": posture}).events)
		var r: Dictionary = state.call_to_hand(side)
		state.set_posture(real_posture)
		_process_events(r.events)
		if bool(r.ok): return
		cue.emit("reject", side)

## A hand raised above head height next to the head: "reach back over the head and squeeze".
func _in_summon_zone(world: Vector3) -> bool:
	var head: Vector3 = provider.head_position()
	var flat := Vector2(world.x - head.x, world.z - head.z)
	return world.y >= head.y - 0.05 and flat.length() <= 0.45

# ------------------------------------------------------------------------------------------------ view (the one refresh path)
func _can_access(pocket_id: String) -> bool:
	return state != null and state.can_access(pocket_id)

func _on_ownership_changed(_item_id: String, _from: String, _to: String, _slot: String) -> void:
	if container != null: container.refresh()

func _open_in_air() -> bool:
	if state == null: return false
	var st: String = state.state
	return st == "HELD_OPEN" or (st == "PLACED" and bool(state.snapshot().accessOpen))

func _apply_view(view: Dictionary) -> void:
	_last_view = view
	var open_air := _open_in_air()
	var visible_cells := {}
	if open_air and String(view.mode) == "physical":
		var i := 0
		var n: int = (view.items as Array).size()
		for row in view.items:
			visible_cells[row.cell] = true
			var placed_anchor := _anchor_of(row.cell)
			if placed_anchor != null:
				if not _saved_anchor.has(row.cell): _saved_anchor[row.cell] = placed_anchor.transform
				if _cell_layout.is_valid(): placed_anchor.transform = _cell_layout.call(i, n, row.cell)
			i += 1
	for cell in _cells_bag:
		var anchor := _anchor_of(cell)
		if anchor == null: continue
		var show := not open_air or visible_cells.has(cell)
		if open_air and String(view.mode) == "slots": show = false # the slot view replaces the real items
		if not show and not _hidden_anchors.has(cell): _hidden_anchors[cell] = anchor.visible
		if show and _hidden_anchors.has(cell):
			anchor.visible = bool(_hidden_anchors[cell])
			_hidden_anchors.erase(cell)
		elif not show:
			anchor.visible = false
		if (not open_air or not visible_cells.has(cell)) and _saved_anchor.has(cell):
			anchor.transform = _saved_anchor[cell]
			_saved_anchor.erase(cell)
	_update_slot_view(view, open_air and String(view.mode) == "slots")
	view_refreshed.emit(view)

func last_view() -> Dictionary: return _last_view

func _anchor_of(cell: String) -> Node3D:
	if not _cell_anchor.is_valid(): return null
	var a: Variant = _cell_anchor.call(cell)
	return a as Node3D if a is Node3D and is_instance_valid(a) else null

## Low tiers: a cheap slot tray seen from above (one flat box and one label per cell), built on first use.
func _update_slot_view(view: Dictionary, show: bool) -> void:
	if not show:
		if is_instance_valid(_slot_view): _slot_view.visible = false
		return
	if not is_instance_valid(_slot_view):
		_slot_view = Node3D.new()
		_slot_view.name = "SlotViewFromAbove"
		pack.add_child(_slot_view)
		_slot_view.position = _vec(_profile.get("handle", {}).get("local", [0.0, 0.4, 0.2])) + Vector3(0.0, 0.05, -0.2)
	_slot_view.visible = true
	var rows: Array = view.items
	var n := rows.size()
	for i in n:
		var row: Dictionary = rows[i]
		var cell := String(row.cell)
		var mark: MeshInstance3D = _slot_marks.get(cell)
		if mark == null:
			mark = MeshInstance3D.new()
			var box := BoxMesh.new()
			box.size = Vector3(0.10, 0.012, 0.10)
			mark.mesh = box
			mark.material_override = StandardMaterial3D.new()
			var label := Label3D.new()
			label.pixel_size = 0.0016
			label.font_size = 28
			label.rotation_degrees = Vector3(-90.0, 0.0, 0.0)
			label.position = Vector3(0.0, 0.012, 0.0)
			mark.add_child(label)
			_slot_view.add_child(mark)
			_slot_marks[cell] = mark
		mark.position = Vector3((float(i) - float(n - 1) * 0.5) * 0.12, 0.0, 0.0)
		var item_id := String(row.itemId)
		(mark.material_override as StandardMaterial3D).albedo_color = Color(0.25, 0.7, 0.4) if not item_id.is_empty() else Color(0.3, 0.3, 0.32)
		(mark.get_child(0) as Label3D).text = item_id.get_slice(":", item_id.get_slice_count(":") - 1) if not item_id.is_empty() else "-"
		mark.visible = true
	for cell in _slot_marks:
		var found := false
		for row in rows:
			if String(row.cell) == cell: found = true
		if not found: (_slot_marks[cell] as MeshInstance3D).visible = false

# ------------------------------------------------------------------------------------------------ collision exceptions
## RIDs the pack's own sweeps and probes must ignore: its own colliders and the colliders of every item in its cells.
func collision_exclusions() -> Array[RID]:
	var out: Array[RID] = []
	if not is_instance_valid(pack): return out
	_collect_rids(pack, out)
	if container != null and _item_node.is_valid():
		for cell in _cells_bag:
			var id := String(_alias.item_in_slot(cell))
			if id.is_empty(): continue
			var n: Variant = _item_node.call(id)
			if n is Node: _collect_rids(n, out)
	return out

func _collect_rids(node: Node, out: Array[RID]) -> void:
	if node is CollisionObject3D:
		var rid := (node as CollisionObject3D).get_rid()
		if rid.is_valid() and not rid in out: out.append(rid)
	for c in node.get_children(): _collect_rids(c, out)

func _push_exclusions() -> void:
	if _exclusion_sink.is_valid(): _exclusion_sink.call(collision_exclusions())

# ------------------------------------------------------------------------------------------------ checkpoint of the layer
## The layer's own checkpoint (container v2: ledger cells + bag state). WORN or
## settled PLACED only; mid-states, including the placement blend, store WORN.
## {} when there is no container.
func capture_layer() -> Dictionary:
	if container == null or state == null: return {}
	var captured: Dictionary = container.capture_checkpoint(state)
	if state.state == "PLACED" and _blend_t < 1.0:
		# State already owns the destination, but presentation has not completed
		# its route. Do not restore directly to an uncompleted placement target.
		# This edits only the newly allocated snapshot, never live state or cells.
		var bag: Dictionary = captured.bag
		bag.state = "WORN"
		bag.owner = "worn"
		bag.openFraction = 0.0
		bag.placedPose = null
	return captured

## PURE shape check, safe BEFORE the host restores its own inventory: schema, profile id, the exact cell set, string cells without
## duplicates, and the state block. Returns {ok, absent, reason}. null = an old checkpoint without the layer (absent, ok).
func validate_layer(raw: Variant) -> Dictionary:
	if raw == null: return {"ok": true, "absent": true, "reason": ""}
	if container == null or state == null: return {"ok": false, "absent": false, "reason": "no_layer"}
	if not raw is Dictionary or raw.get("schema") != BpContainer.CHECKPOINT_SCHEMA or raw.get("profileId") != String(_profile.id):
		return {"ok": false, "absent": false, "reason": "schema"}
	var ledger: Variant = raw.get("ledger")
	if not ledger is Dictionary or ledger.get("schema") != BpContainer.LEDGER_SCHEMA or ledger.get("profileId") != String(_profile.id):
		return {"ok": false, "absent": false, "reason": "ledger"}
	var cells: Variant = ledger.get("cells")
	var live: Dictionary = container.capture().cells
	if not cells is Dictionary or cells.size() != live.size(): return {"ok": false, "absent": false, "reason": "cells"}
	var seen := {}
	for c in cells:
		if not live.has(c) or not cells[c] is String: return {"ok": false, "absent": false, "reason": "cells"}
		var id := String(cells[c])
		if id.is_empty(): continue
		if seen.has(id): return {"ok": false, "absent": false, "reason": "duplicate"}
		seen[id] = true
	var bag: Variant = raw.get("bag")
	if not raw.has("bag") or (bag != null and not bag is Dictionary) or (bag is Dictionary and not bool(state.prepare_restore(bag).ok)):
		return {"ok": false, "absent": false, "reason": "bag"}
	return {"ok": true, "absent": false, "reason": ""}

## Applies a validated layer AFTER the host restored its inventory. The ledger part is only compared (the host's own checkpoint owns
## ownership; nothing here retrieves or stores items): when the cells disagree with the live ledger the layer is ignored and the bag
## stays WORN (returns false). WORN: pack to the worn frame. PLACED: pack to its saved world pose, mounts stay on the body.
func commit_layer(raw: Variant) -> bool:
	if raw == null: return true
	var v := validate_layer(raw)
	if not bool(v.ok): return false
	var live: Dictionary = container.capture().cells
	var saved: Dictionary = raw.ledger.cells
	for c in live:
		if String(live[c]) != String(saved[c]):
			_force_worn()
			return false
	var prepared: Dictionary = state.prepare_restore(raw.bag) if raw.bag is Dictionary else {}
	_force_worn()
	if bool(prepared.get("ok", false)):
		state.commit_restore(prepared)
		if state.state == "PLACED":
			var pose: Dictionary = state.capture().placedPose
			_placed_xf = Transform3D(Basis(Quaternion(float(pose.rotation[0]), float(pose.rotation[1]), float(pose.rotation[2]), float(pose.rotation[3])).normalized()),
				Vector3(float(pose.position[0]), float(pose.position[1]), float(pose.position[2])))
			if mounts != null: mounts.set_detached(true)
			if not _move_pack(_placed_xf):
				_rollback("restore_move_refused")
				return false
			_external = true
			_pose = _placed_xf
			_blend_t = 1.0
			if state.open_fraction >= float(state.thresholds.openAccessFraction): _set_flap(true)
			_push_exclusions()
	if container != null: container.refresh()
	state_changed.emit("?", state.state, "restore")
	return true

func _force_worn() -> void:
	state.reset()
	if _external or (mounts != null and mounts.detached):
		_external = false
		if mounts != null: mounts.set_detached(false)
		_move_pack_release(_body_frame())
	_set_flap(false)
	_blend_t = 1.0

# ------------------------------------------------------------------------------------------------ helpers
func _secondary_hold_usable(require_holder_grip := false) -> bool:
	if state == null or not BpState.is_held(state.state) or not bool(state.flags.twoHand): return false
	var primary: Dictionary = _hands.get(String(state.holder), {})
	if not bool(primary.get("tracked", false)) or (require_holder_grip and not bool(primary.get("grip", false))): return false
	var other := "right" if state.holder == "left" else "left"
	var secondary: Dictionary = _hands.get(other, {})
	if not bool(secondary.get("tracked", false)) or not bool(secondary.get("grip", false)): return false
	if (secondary.world as Transform3D).origin.distance_to(handle_world()) > float(_profile.handle.reachM): return false
	if _hand_free.is_valid() and not bool(_hand_free.call(other)): return false
	return not _secondary_grip_access.is_valid() or bool(_secondary_grip_access.call(other, secondary.world))

func _read_hands() -> void:
	for side in SIDES:
		var h := {"tracked": false, "grip": false, "world": Transform3D.IDENTITY}
		if _hand_input.is_valid():
			var r: Variant = _hand_input.call(side)
			if r is Dictionary and bool(r.get("tracked", false)) and r.get("grip") is bool and r.get("world") is Transform3D and (r.world as Transform3D).is_finite():
				h = {"tracked": true, "grip": bool(r.get("grip", false)), "world": r.world}
		if not h.tracked: _summon_armed[side] = false
		elif not h.grip: _summon_armed[side] = true
		_hands[side] = h

func _body_frame() -> Transform3D:
	if bool(provider.is_valid()):
		var f: Transform3D = provider.pack_frame()
		if f.is_finite(): _last_frame = f
	return _last_frame

## The authored handle may move with compartment animation. Use its current
## pack-local attachment consistently for carry, reach and candidate placement.
func handle_local() -> Vector3:
	if is_instance_valid(pack) and is_instance_valid(_handle_node) and _handle_node.is_inside_tree():
		var frame := pack.global_transform
		if frame.is_finite() and absf(frame.basis.determinant()) > 0.001:
			var local := frame.affine_inverse() * _handle_node.global_position
			if local.is_finite(): return local
	return _vec(_profile.handle.local)

func handle_world() -> Vector3:
	return pack.global_transform * handle_local()

func _probe_surface(hand_world: Transform3D) -> Dictionary:
	if not _surface_probe.is_valid(): return {"stable": false}
	var r: Variant = _surface_probe.call(pack.global_transform, hand_world)
	if not r is Dictionary or r.get("stable") != true: return {"stable": false}
	var pos: Variant = r.get("position")
	var rot: Variant = r.get("rotation")
	if not pos is Array or not rot is Array: return {"stable": false}
	_surface_xf = Transform3D(Basis(Quaternion(float(rot[0]), float(rot[1]), float(rot[2]), float(rot[3])).normalized()),
		Vector3(float(pos[0]), float(pos[1]), float(pos[2])))
	return {"stable": true, "position": pos, "rotation": rot}

func _set_flap(open: bool) -> void:
	if _flap_open == open: return
	_flap_open = open
	if _flap_fn.is_valid():
		_syncing = true
		_flap_fn.call(open)
		_syncing = false

func _move_pack(xf: Transform3D) -> bool:
	if fail_next_move:
		fail_next_move = false
		return false
	if not xf.is_finite() or absf(xf.basis.determinant()) < 0.001 or not is_instance_valid(pack): return false
	var before := pack.global_transform
	var ok := true
	if _move_pack_fn.is_valid(): ok = bool(_move_pack_fn.call(xf))
	else: pack.global_transform = xf
	if ok and pack.global_transform.origin.distance_to(xf.origin) > 0.002: ok = false
	if not ok:
		pack.global_transform = before
		return false
	return true

## Final write when the host takes the pose back: must not fail, so it bypasses the test seam and the verification.
func _move_pack_release(xf: Transform3D) -> void:
	if not is_instance_valid(pack): return
	if _release_fn.is_valid(): _release_fn.call(xf)
	elif _move_pack_fn.is_valid(): _move_pack_fn.call(xf)
	else: pack.global_transform = xf

## Back to WORN at the worn frame (new game, restore of an old checkpoint without the layer). Never drops anything.
func reset_to_worn() -> void:
	if state != null: _force_worn()
	if container != null: container.refresh()

func snapshot() -> Dictionary:
	var s: Dictionary = state.snapshot() if state != null else {}
	s["detached"] = _external
	s["steps"] = _steps
	return s

static func _smooth(t: float) -> float:
	var x := clampf(t, 0.0, 1.0)
	return x * x * (3.0 - 2.0 * x)

static func _arr(v: Vector3) -> Array: return [v.x, v.y, v.z]
static func _vec(a: Variant) -> Vector3:
	return Vector3(float(a[0]), float(a[1]), float(a[2])) if a is Array and a.size() == 3 else Vector3.ZERO

## GSBackpackState validates the BASE profile only: take the P2 additions (kind, bagMount, pocket mounts) out for it.
static func _state_profile(p: Dictionary) -> Dictionary:
	var base: Dictionary = p.duplicate(true)
	base.erase("kind")
	base.erase("bagMount")
	for k in base.pockets: (k as Dictionary).erase("mount")
	return base

func _exit_tree() -> void:
	if _external and is_instance_valid(pack) and provider != null:
		_external = false
		if mounts != null and is_instance_valid(mounts): mounts.set_detached(false)
		_move_pack_release(_body_frame())
