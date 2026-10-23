extends SceneTree

const Receiver = preload("../gs_pour_receiver.gd")
const Pour = preload("../bottle_pour.gd")

class SourceBody extends RigidBody3D:
	var ctl: GSBottleLiquid
	var state := &"intact"

class SilentPour extends GSBottlePour:
	func _ready() -> void:
		set_physics_process(false)

class CountingReceiver extends GSPourReceiver:
	var segment_checks := 0
	func segment_fraction(from: Vector3, to: Vector3) -> float:
		segment_checks += 1
		return super.segment_fraction(from, to)

var checks := 0
var failures := 0
var scene: Node3D


func check(value: bool, label: String) -> void:
	checks += 1
	if not value:
		failures += 1
		push_error("GS_POUR_RECEIVER: " + label)


func _initialize() -> void:
	run.call_deferred()


func source() -> GSBottlePour:
	var body := SourceBody.new()
	body.freeze = true
	body.collision_layer = 0
	body.collision_mask = 0
	scene.add_child(body)
	var pour := SilentPour.new()
	pour.body = body
	body.add_child(pour)
	return pour


func solid(position: Vector3, size: Vector3) -> StaticBody3D:
	var body := StaticBody3D.new()
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size
	shape.shape = box
	body.add_child(shape)
	body.position = position
	scene.add_child(body)
	return body


func endpoint(position: Vector3, callback: Callable) -> GSPourReceiver:
	var result := Receiver.new()
	result.position = position
	result.radius = 0.1
	result.accept_ml = callback
	scene.add_child(result)
	return result


func fly(pour: GSBottlePour, p := Vector3(0, 1.2, 0), ml := 10.0) -> void:
	pour._add_parcel(p, Vector3(0, -2, 0), ml, Color.ORANGE)
	pour.poured_ml += ml
	pour._step_parcels(0.2)


func run() -> void:
	scene = Node3D.new()
	root.add_child(scene)
	current_scene = scene
	solid(Vector3(0, -0.1, 0), Vector3(10, 0.2, 10))
	await physics_frame
	await process_frame
	var kinds: Array[StringName] = []
	var accepted := [0.0]
	var receiver := endpoint(Vector3(0, 1, 0), func(ml: float, kind: StringName, _source: GSBottlePour) -> float:
		kinds.append(kind)
		accepted[0] += ml
		return ml)
	var donor := source()
	fly(donor)
	check(kinds == [&"unknown"] and is_equal_approx(accepted[0], 10.0), "an untyped parcel remains unknown")
	check(is_equal_approx(donor.poured_ml, donor.delivered_ml + donor.spilled_ml + donor.in_flight_ml()),
		"accepted opening transfer balances the donor ledger")
	donor.liquid_kind = &"petrol"
	donor._add_parcel(Vector3(0, 1.2, 0), Vector3(0, -2, 0), 4.0, Color.BLUE)
	donor.poured_ml += 4.0
	donor.liquid_kind = &"water"
	donor._step_parcels(0.2)
	check(kinds.back() == &"petrol", "parcel identity is captured at emission, independent of later source edits")
	check(Pour._mixed_kind(&"unknown", 0.1, &"petrol") == &"unknown"
		and Pour._mixed_kind(&"water", 5.0, &"petrol") == &"unknown"
		and Pour._mixed_kind(&"petrol", 5.0, &"petrol") == &"petrol"
		and Pour._mixed_kind(&"unknown", 0.0, &"petrol") == &"petrol",
		"only a genuinely empty or same-kind receiver can retain a known liquid identity")
	var wall := solid(Vector3(0, 1.1, 0), Vector3(1, 0.04, 1))
	await physics_frame
	await process_frame
	var accepted_before: float = accepted[0]
	fly(donor)
	check(is_equal_approx(accepted[0], accepted_before) and is_equal_approx(donor.spilled_ml, 10.0),
		"a solid before the opening receives the parcel instead of allowing transfer through the wall")
	wall.free()
	receiver.free()
	# Far registered first: segment order must still choose the nearer opening.
	var chosen: Array[String] = []
	var far := endpoint(Vector3(0, 0.8, 0), func(ml: float, _kind: StringName, _source: GSBottlePour) -> float:
		chosen.append("far")
		return ml)
	var near := endpoint(Vector3(0, 1.0, 0), func(ml: float, _kind: StringName, _source: GSBottlePour) -> float:
		chosen.append("near")
		return ml)
	fly(donor)
	check(chosen == ["near"], "nearest opening wins regardless of registration order")
	far.free()
	near.free()
	var distant := CountingReceiver.new()
	distant.position = Vector3(4, 1, 0)
	distant.radius = 0.1
	distant.accept_ml = func(ml: float, _kind: StringName, _source: GSBottlePour) -> float:
		chosen.append("distant")
		return ml
	scene.add_child(distant)
	fly(donor)
	check(distant.segment_checks == 0, "openings beyond three metres from the airborne segment skip geometry checks")
	check(not chosen.has("distant") and is_equal_approx(donor.in_flight_ml(), 10.0),
		"distant openings cannot consume a parcel outside their spatial opening")
	for tick in 8:
		donor._step_parcels(0.1)
	distant.free()
	var half := endpoint(Vector3(0, 1, 0), func(ml: float, _kind: StringName, _source: GSBottlePour) -> float: return ml * 0.5)
	var delivered_before := donor.delivered_ml
	var spilled_before := donor.spilled_ml
	fly(donor)
	check(is_equal_approx(donor.delivered_ml - delivered_before, 5.0) and is_equal_approx(donor.in_flight_ml(), 5.0),
		"unaccepted volume remains a real parcel rather than a puddle at a virtual opening")
	for tick in 8:
		donor._step_parcels(0.1)
	check(is_equal_approx(donor.spilled_ml - spilled_before, 5.0) and is_zero_approx(donor.in_flight_ml()),
		"rejected volume flies to the actual floor and remains accounted for")
	check(is_equal_approx(donor.poured_ml, donor.delivered_ml + donor.spilled_ml + donor.in_flight_ml()),
		"partial acceptance plus real spill balances all emitted volume")
	half.scale = Vector3(2, 1, 0.5)
	check(half.segment_fraction(Vector3(0.15, 1.2, 0), Vector3(0.15, 0.8, 0)) >= 0.0
		and half.segment_fraction(Vector3(0, 1.2, 0.075), Vector3(0, 0.8, 0.075)) < 0.0,
		"scaled opening checks the actual local disc rather than a global bounding circle")
	check(half.segment_fraction(Vector3(0, 0.8, 0), Vector3(0, 1.2, 0)) < 0.0,
		"an opening rejects back-to-front travel")
	half.free()
	var other_world := SubViewport.new()
	other_world.own_world_3d = true
	root.add_child(other_world)
	var other_receiver := Receiver.new()
	other_receiver.position = Vector3(0, 1, 0)
	other_receiver.radius = 0.1
	other_receiver.accept_ml = func(ml: float, _kind: StringName, _source: GSBottlePour) -> float:
		chosen.append("other-world")
		return ml
	other_world.add_child(other_receiver)
	check(other_receiver.get_world_3d() != donor.body.get_world_3d(), "cross-world fixture uses distinct physics worlds")
	fly(donor)
	check(not chosen.has("other-world") and is_equal_approx(donor.in_flight_ml(), 10.0),
		"an overlapping opening in another World3D cannot consume the parcel")
	check(is_zero_approx(other_receiver.receive(3.0, &"petrol", donor)), "direct cross-world receiver delivery is rejected too")
	var lost_before := Pour.world_lost_ml
	var interrupted := donor.in_flight_ml()
	scene.remove_child(donor.body)
	check(is_zero_approx(donor.in_flight_ml()) and is_equal_approx(Pour.world_lost_ml - lost_before, interrupted)
		and is_equal_approx(donor.poured_ml, donor.delivered_ml + donor.spilled_ml),
		"source removal settles remaining parcels into the interrupted/lost ledger exactly once")
	donor.body.free()
	other_world.free()
	check(Receiver.registry.is_empty(), "receiver removal clears its registry entries")
	var interrupted_source := source()
	var interrupting := endpoint(Vector3(0, 1, 0), func(ml: float, _kind: StringName, _source: GSBottlePour) -> float: return ml * 0.5)
	interrupting.received.connect(func(_ml: float, _kind: StringName, current: GSBottlePour) -> void:
		current._step_parcels(0.2) # A receiver observer cannot replay the current parcel.
		scene.remove_child(current.body))
	var callback_lost_before := Pour.world_lost_ml
	fly(interrupted_source)
	check(is_equal_approx(interrupted_source.delivered_ml, 5.0) and is_equal_approx(interrupted_source.spilled_ml, 5.0)
		and is_zero_approx(interrupted_source.in_flight_ml()) and is_equal_approx(Pour.world_lost_ml - callback_lost_before, 5.0),
		"receiver callback removal settles only the unaccepted volume and cannot replay the active parcel")
	interrupted_source.body.free()
	interrupting.free()
	var broken_overflow := source()
	broken_overflow._overflow_ml = 7.0
	broken_overflow._overflow_kind = &"petrol"
	broken_overflow.body.state = &"shattered"
	var overflow_lost_before := Pour.world_lost_ml
	broken_overflow._physics_process(0.1)
	check(is_zero_approx(broken_overflow.in_flight_ml()) and is_equal_approx(broken_overflow.poured_ml, 7.0)
		and is_equal_approx(broken_overflow.spilled_ml, 7.0) and is_equal_approx(Pour.world_lost_ml - overflow_lost_before, 7.0),
		"broken receiver without remaining mouth geometry settles pending overflow into matching outgoing/lost ledgers")
	broken_overflow._physics_process(0.1)
	check(is_equal_approx(broken_overflow.spilled_ml, 7.0) and is_equal_approx(Pour.world_lost_ml - overflow_lost_before, 7.0),
		"broken overflow is settled exactly once")
	broken_overflow.body.free()
	var removed_overflow := source()
	removed_overflow._overflow_ml = 9.0
	var removal_lost_before := Pour.world_lost_ml
	scene.remove_child(removed_overflow.body)
	check(is_zero_approx(removed_overflow.in_flight_ml()) and is_equal_approx(removed_overflow.poured_ml, 9.0)
		and is_equal_approx(removed_overflow.spilled_ml, 9.0) and is_equal_approx(Pour.world_lost_ml - removal_lost_before, 9.0),
		"removal settles never-emitted overflow into matching outgoing/lost ledgers")
	removed_overflow.body.free()
	# Colour mixing of a non-empty receiver (same rule as liquid_color.js; see docs/pour_system.md)
	var red := Color(0.9, 0.08, 0.08)
	var blue := Color(0.08, 0.1, 0.9)
	var purple := Pour.mix_colors(red, 100.0, blue, 100.0)
	var avg := red.srgb_to_linear().lerp(blue.srgb_to_linear(), 0.5)
	check(purple.srgb_to_linear().g < avg.g and purple.srgb_to_linear().r < avg.r and purple.r > purple.g and purple.b > purple.g,
		"red + blue 50/50 mixes subtractively to a dark purple, darker than the linear average")
	check(Pour.mix_colors(red, 190.0, blue, 10.0).r > Pour.mix_colors(red, 190.0, blue, 10.0).b * 3.0
		and Pour.mix_colors(red, 10.0, blue, 190.0).b > Pour.mix_colors(red, 10.0, blue, 190.0).r * 3.0,
		"a skewed ml distribution stays near the majority colour")
	check(Pour.mix_colors(red, 0.0, blue, 50.0).is_equal_approx(blue) and Pour.mix_colors(red, 50.0, blue, 0.0).is_equal_approx(red),
		"zero ml on one side leaves the other colour unchanged")
	var mixer_ctl := GSBottleLiquid.new()
	mixer_ctl.set_liquid_color(red)
	for tier in [Pour.HIGH, Pour.LOW]:
		var mixer := SilentPour.new()
		mixer._ctl = mixer_ctl
		mixer.quality = tier
		mixer_ctl.set_liquid_color(red)
		mixer._logical = Color(0, 0, 0, 0)
		mixer._foreign_ml = 0.0
		mixer._foreign_shown = false
		mixer._mix_colour(100.0, blue, 40.0)
		var exact_40 := Pour.mix_colors(red, 100.0, blue, 40.0)
		check(mixer.liquid_color_now().is_equal_approx(exact_40), "tier %d: the poured-out colour is the exact ml-weighted mix" % tier)
		if tier == Pour.HIGH:
			check(mixer_ctl.liquid_color().is_equal_approx(exact_40), "high: the shader shows the mix at once")
		else:
			check(mixer_ctl.liquid_color().is_equal_approx(red), "low: the shader keeps the colour until half of it is foreign")
			mixer._mix_colour(140.0, blue, 60.0)
			check(mixer_ctl.liquid_color().is_equal_approx(Pour.mix_colors(red, 100.0, blue, 100.0)) or mixer_ctl.liquid_color().is_equal_approx(Pour.mix_colors(Pour.mix_colors(red, 100.0, blue, 40.0), 140.0, blue, 60.0)),
				"low: one switch to the mix at the half-foreign mark")
		mixer.free()
	mixer_ctl.free()
	scene.queue_free()
	await process_frame
	print("GS_POUR_RECEIVER: %d checks, %d failures" % [checks, failures])
	quit(1 if failures else 0)
