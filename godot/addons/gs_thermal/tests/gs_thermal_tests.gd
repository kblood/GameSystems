extends SceneTree

const Thermal = preload("res://addons/gs_thermal/gs_thermal_system.gd")
const Adapter = preload("res://addons/gs_thermal/gs_puddle_fire_adapter.gd")
const Puddles = preload("res://addons/gs_bottles/gs_puddle_store.gd")

class PartialFuelStore extends RefCounted:
	var diesel_ml := 200.0
	var water_ml := 200.0
	var max_take := 1.0
	var overdraw_ml := 0.0
	var reject_deposit := false
	var mutate_thermal: Object
	var mutate_room: StringName = &""
	var mutate_target_id: StringName = &""
	var mutate_target_heat := 0.0

	func components(_id: int) -> Dictionary:
		return {"diesel": diesel_ml, "water": water_ml}

	func withdraw(_id: int, kind: StringName, requested_ml: float) -> float:
		if kind not in [&"diesel", &"water"]: return 0.0
		var actual := requested_ml + overdraw_ml if overdraw_ml > 0.0 else minf(requested_ml, max_take)
		if kind == &"diesel": diesel_ml -= actual
		else: water_ml -= actual
		if mutate_thermal != null:
			if mutate_room != &"": mutate_thermal.call("configure_room", mutate_room, {"oxygen": 0.0})
			if mutate_target_id != &"": mutate_thermal.call("add_heat", mutate_target_id, mutate_target_heat)
		return actual

	func deposit(_id: int, kind: StringName, ml: float) -> float:
		if kind not in [&"diesel", &"water"] or reject_deposit: return 0.0
		if kind == &"diesel": diesel_ml += ml
		else: water_ml += ml
		return ml

var passed := 0
var failed := 0

func _initialize() -> void:
	var system = Thermal.new()
	case_result(system.add_room(&"kitchen", {"oxygen": 1.0, "ventilation": 0.0, "heat_capacity_kj_c": 10.0}), "room accepts bounded gameplay state")
	case_result(not system.add_room(&"bad", {"oxygen": 2.0}), "invalid room state is rejected")
	case_result(system.add_object(&"pan", {"room_id": &"kitchen", "temperature_c": 20.0, "ignition_c": 100.0,
		"heat_capacity_kj_c": 1.0, "fuel": 1.0, "burn_rate": 10.0, "heat_kj_per_fuel": 10.0}), "thermal object is authored into a room")
	case_result(not system.ignite(&"pan"), "cold object does not ignite on command")
	case_result(system.add_heat(&"pan", 100.0) and system.object_state(&"pan").burning, "finite heat crosses the ignition threshold")
	var partial: Dictionary = system.step(0.025)
	case_result(partial.steps == 0 and is_equal_approx(partial.pending_seconds, 0.025), "sub-tick time remains in the fixed-step accumulator")
	var tick: Dictionary = system.step(0.025)
	case_result(tick.steps == 1 and tick.events.size() >= 1, "fixed tick advances fuel and emits a burn receipt")
	case_result(system.room_state(&"kitchen").smoke > 0.0, "confined burning adds room smoke")
	case_result(system.object_state(&"pan").fuel < 1.0, "burn consumes finite authored fuel")
	var pending_before := float(system.stats().pending_seconds)
	var rejected_step: Dictionary = system.step(Thermal.MAX_FRAME_DELTA + 0.1)
	case_result(not rejected_step.ok and is_equal_approx(system.stats().pending_seconds, pending_before),
		"excessive frame debt is rejected without changing the accumulator")

	var wet = Thermal.new()
	wet.add_object(&"wood", {"temperature_c": 300.0, "ignition_c": 200.0, "fuel": 5.0, "burn_rate": 1.0})
	case_result(wet.object_state(&"wood").burning, "hot authored wood auto-ignites")
	case_result(wet.apply_liquid(&"wood", &"diesel", 50.0) == 0.0 and wet.object_state(&"wood").burning,
		"fuel is not treated as extinguishing liquid")
	case_result(wet.apply_liquid(&"wood", &"water", 250.0) == 250.0 and not wet.object_state(&"wood").burning,
		"sufficient water quenches the fire and records wetness")
	case_result(wet.apply_liquid(&"wood", &"foam", 50.0) == 50.0, "foam dose is accepted as an inerting gameplay effect")
	var foam_only = Thermal.new()
	foam_only.add_object(&"panel", {"temperature_c": 300.0, "ignition_c": 200.0, "fuel": 5.0, "burn_rate": 1.0})
	foam_only.apply_liquid(&"panel", &"foam", 50.0)
	foam_only.step(Thermal.FIXED_STEP)
	case_result(not foam_only.object_state(&"panel").burning,
		"foam alone prevents a hot extinguished object from relighting on the next tick")

	var linked = Thermal.new()
	linked.add_object(&"hot", {"temperature_c": 300.0, "heat_capacity_kj_c": 2.0, "ignition_c": 900.0})
	linked.add_object(&"cold", {"temperature_c": 20.0, "heat_capacity_kj_c": 4.0, "ignition_c": 900.0})
	case_result(linked.link_objects(&"hot", &"cold", 1.0), "authored thermal link connects objects")
	var baseline = Thermal.new()
	baseline.add_object(&"hot", {"temperature_c": 300.0, "heat_capacity_kj_c": 2.0, "ignition_c": 900.0})
	baseline.add_object(&"cold", {"temperature_c": 20.0, "heat_capacity_kj_c": 4.0, "ignition_c": 900.0})
	linked.step(Thermal.FIXED_STEP)
	baseline.step(Thermal.FIXED_STEP)
	var linked_energy := float(linked.object_state(&"hot").temperature_c) * 2.0 + float(linked.object_state(&"cold").temperature_c) * 4.0
	var baseline_energy := float(baseline.object_state(&"hot").temperature_c) * 2.0 + float(baseline.object_state(&"cold").temperature_c) * 4.0
	case_result(is_equal_approx(linked_energy, baseline_energy) and linked.object_state(&"cold").temperature_c > baseline.object_state(&"cold").temperature_c,
		"authored link redistributes heat without changing total above ambient loss")
	var weak_link = Thermal.new()
	var strong_link = Thermal.new()
	for candidate in [weak_link, strong_link]:
		candidate.add_object(&"hot", {"temperature_c": 300.0, "heat_capacity_kj_c": 2.0, "ignition_c": 900.0})
		candidate.add_object(&"cold", {"temperature_c": 20.0, "heat_capacity_kj_c": 4.0, "ignition_c": 900.0})
	weak_link.link_objects(&"hot", &"cold", 0.1)
	strong_link.link_objects(&"hot", &"cold", 10.0)
	weak_link.step(Thermal.FIXED_STEP)
	strong_link.step(Thermal.FIXED_STEP)
	case_result(strong_link.object_state(&"cold").temperature_c > weak_link.object_state(&"cold").temperature_c,
		"authored conductance strength changes the bounded heat transfer rate")

	var store = Puddles.new()
	store.limit = 4
	var puddle_id: int = store.create()
	store.deposit(puddle_id, &"petrol", 25.0)
	store.deposit(puddle_id, &"diesel", 20.0)
	store.deposit(puddle_id, &"water", 10.0)
	var fuel_target = Thermal.new()
	fuel_target.add_object(&"target", {"temperature_c": 20.0, "ignition_c": 500.0, "heat_capacity_kj_c": 1.0})
	var bridge = Adapter.new(fuel_target)
	var burned: Dictionary = bridge.burn_fuel_puddle(store, puddle_id, &"target", 40.0)
	case_result(burned.ok and burned.kind == &"petrol" and is_equal_approx(burned.ml, 25.0)
		and is_equal_approx(store.components(puddle_id).diesel, 20.0)
		and is_equal_approx(store.components(puddle_id).water, 10.0), "puddle bridge burns actual petrol and preserves diesel/water components")
	var quenched: Dictionary = bridge.extinguish_from_puddle(store, puddle_id, &"target", &"water", 100.0)
	case_result(quenched.ok and is_equal_approx(quenched.ml, 10.0)
		and is_equal_approx(store.components(puddle_id).diesel, 20.0), "puddle bridge withdraws only actual water")
	case_result(not bridge.extinguish_from_puddle(store, puddle_id, &"target", &"diesel", 5.0).ok,
		"typed fuel cannot satisfy an extinguishing request")
	case_result(not bridge.burn_fuel_puddle(store, puddle_id, &"missing", 10.0).ok
		and is_equal_approx(store.components(puddle_id).diesel, 20.0), "invalid heat target is rejected before liquid withdrawal")
	var changed_burn_thermal = Thermal.new()
	changed_burn_thermal.add_object(&"target", {"temperature_c": 20.0, "ignition_c": 1000.0})
	var changed_burn_store := PartialFuelStore.new()
	changed_burn_store.max_take = 100.0
	changed_burn_store.mutate_thermal = changed_burn_thermal
	changed_burn_store.mutate_target_id = &"target"
	changed_burn_store.mutate_target_heat = 1.0
	var changed_burn: Dictionary = Adapter.new(changed_burn_thermal).burn_fuel_puddle(
		changed_burn_store, 1, &"target", 50.0)
	case_result(changed_burn.reason == &"world_state_changed_refunded"
		and changed_burn.refunded_ml == 50.0 and changed_burn_store.diesel_ml == 200.0
		and changed_burn_thermal.object_state(&"target").temperature_c == 21.0,
		"manual fuel burn refunds its receipt when the withdrawal callback changes target heat")
	var changed_quench_thermal = Thermal.new()
	changed_quench_thermal.add_object(&"target", {"temperature_c": 20.0, "ignition_c": 1000.0})
	var changed_quench_store := PartialFuelStore.new()
	changed_quench_store.max_take = 10.0
	changed_quench_store.mutate_thermal = changed_quench_thermal
	changed_quench_store.mutate_target_id = &"target"
	changed_quench_store.mutate_target_heat = 1.0
	var changed_quench: Dictionary = Adapter.new(changed_quench_thermal).extinguish_from_puddle(
		changed_quench_store, 1, &"target", &"water", 10.0)
	case_result(changed_quench.reason == &"world_state_changed_refunded"
		and changed_quench.refunded_ml == 10.0 and changed_quench_store.water_ml == 200.0
		and changed_quench_thermal.object_state(&"target").temperature_c == 21.0
		and changed_quench_thermal.object_state(&"target").wetness == 0.0,
		"manual quenching refunds water when its withdrawal callback changes target heat")
	var auto_store = Puddles.new()
	var auto_puddle: int = auto_store.create()
	auto_store.deposit(auto_puddle, &"diesel", 200.0)
	auto_store.deposit(auto_puddle, &"water", 50.0)
	var auto_thermal = Thermal.new()
	auto_thermal.add_object(&"hot-source", {"temperature_c": 100.0, "ignition_c": 1000.0})
	auto_thermal.add_object(&"pool-fire", {"temperature_c": 20.0, "ignition_c": 25.0,
		"heat_capacity_kj_c": 1.0, "fuel": 10.0, "burn_rate": 1.0, "heat_kj_per_fuel": 1.0})
	var auto_bridge = Adapter.new(auto_thermal)
	var cold_rejected: Dictionary = auto_bridge.try_auto_ignite_from_hot_source(
		auto_store, auto_puddle, &"hot-source", &"pool-fire", 200.0)
	case_result(not cold_rejected.ignited and cold_rejected.reason == &"fuel_below_auto_ignition"
		and auto_store.components(auto_puddle).diesel == 200.0,
		"typed diesel remains untouched below its authored auto-ignition temperature")
	auto_thermal.add_heat(&"hot-source", 200.0)
	var undersized_auto_dose: Dictionary = auto_bridge.try_auto_ignite_from_hot_source(
		auto_store, auto_puddle, &"hot-source", &"pool-fire", 1.0)
	case_result(not undersized_auto_dose.ignited and undersized_auto_dose.reason == &"ignition_dose_too_small"
		and auto_store.components(auto_puddle).diesel == 200.0,
		"auto-ignition preflights enough fuel energy before withdrawing a dose")
	var auto_ignition: Dictionary = auto_bridge.try_auto_ignite_from_hot_source(
		auto_store, auto_puddle, &"hot-source", &"pool-fire", 200.0)
	case_result(auto_ignition.ignited and auto_ignition.kind == &"diesel"
		and auto_thermal.object_state(&"pool-fire").burning
		and auto_store.components(auto_puddle) == {"water": 50.0},
		"nearby hot source ignites the typed diesel pool through an actual liquid receipt")
	var repeated_auto_ignition: Dictionary = auto_bridge.try_auto_ignite_from_hot_source(
		auto_store, auto_puddle, &"hot-source", &"pool-fire", 200.0)
	case_result(repeated_auto_ignition.reason == &"already_burning"
		and auto_store.components(auto_puddle) == {"water": 50.0},
		"automatic ignition does not withdraw another dose from an already-burning target")
	var partial_store := PartialFuelStore.new()
	var partial_thermal = Thermal.new()
	partial_thermal.add_object(&"hot", {"temperature_c": 300.0, "ignition_c": 1000.0})
	partial_thermal.add_object(&"fire", {"temperature_c": 20.0, "ignition_c": 25.0,
		"heat_capacity_kj_c": 1.0, "fuel": 10.0, "burn_rate": 1.0, "heat_kj_per_fuel": 1.0})
	var partial_receipt: Dictionary = Adapter.new(partial_thermal).try_auto_ignite_from_hot_source(
		partial_store, 1, &"hot", &"fire", 200.0)
	case_result(partial_receipt.reason == &"withdrawal_under_delivered"
		and partial_receipt.withdrawn_ml == 1.0 and partial_receipt.refunded_ml == 1.0
		and partial_store.diesel_ml == 200.0 and partial_thermal.object_state(&"fire").temperature_c == 20.0,
		"partial generic withdrawal is refunded before any target heat is committed")
	var room_change_thermal = Thermal.new()
	room_change_thermal.add_room(&"sealed", {"oxygen": 1.0})
	room_change_thermal.add_object(&"hot", {"room_id": &"sealed", "temperature_c": 300.0, "ignition_c": 1000.0})
	room_change_thermal.add_object(&"fire", {"room_id": &"sealed", "temperature_c": 20.0, "ignition_c": 25.0,
		"heat_capacity_kj_c": 1.0, "fuel": 10.0, "burn_rate": 1.0, "heat_kj_per_fuel": 1.0})
	var room_mutating_store := PartialFuelStore.new()
	room_mutating_store.max_take = 200.0
	room_mutating_store.mutate_thermal = room_change_thermal
	room_mutating_store.mutate_room = &"sealed"
	var room_change_receipt: Dictionary = Adapter.new(room_change_thermal).try_auto_ignite_from_hot_source(
		room_mutating_store, 1, &"hot", &"fire", 200.0)
	case_result(room_change_receipt.reason == &"world_state_changed_refunded"
		and room_change_receipt.refunded_ml == 200.0 and room_mutating_store.diesel_ml == 200.0
		and room_change_thermal.object_state(&"fire").temperature_c == 20.0
		and room_change_thermal.room_state(&"sealed").oxygen == 0.0,
		"a fuel callback that changes room oxygen is refunded before heat is committed")
	var broken_refund_store := PartialFuelStore.new()
	broken_refund_store.overdraw_ml = 1.0
	broken_refund_store.reject_deposit = true
	var broken_refund_receipt: Dictionary = Adapter.new(partial_thermal).try_auto_ignite_from_hot_source(
		broken_refund_store, 1, &"hot", &"fire", 200.0)
	case_result(broken_refund_receipt.reason == &"rollback_incomplete"
		and broken_refund_receipt.withdrawn_ml == 201.0 and broken_refund_receipt.refunded_ml == 0.0,
		"invalid over-withdrawal with rejected refund is reported as an incomplete rollback")
	var near_store = Puddles.new()
	var near_puddle: int = near_store.create()
	var near_amount_ml := (5.0 - 5.0e-10) / Adapter.DIESEL_KJ_PER_ML
	near_store.deposit(near_puddle, &"diesel", near_amount_ml)
	var near_thermal = Thermal.new()
	near_thermal.add_object(&"near-hot", {"temperature_c": 300.0, "ignition_c": 1000.0})
	near_thermal.add_object(&"near-fire", {"temperature_c": 20.0, "ignition_c": 25.0,
		"heat_capacity_kj_c": 1.0, "fuel": 10.0, "burn_rate": 1.0, "heat_kj_per_fuel": 1.0})
	var near_before: float = near_store.components(near_puddle).diesel
	var near_receipt: Dictionary = Adapter.new(near_thermal).try_auto_ignite_from_hot_source(
		near_store, near_puddle, &"near-hot", &"near-fire", near_amount_ml)
	case_result(not near_receipt.ignited and near_receipt.reason == &"ignition_dose_too_small"
		and near_store.components(near_puddle).diesel == near_before
		and near_thermal.object_state(&"near-fire").temperature_c == 20.0,
		"even a sub-nanokJ ignition shortfall is rejected before fuel or target heat changes")
	var mixed_auto_store = Puddles.new()
	var mixed_auto_puddle: int = mixed_auto_store.create()
	mixed_auto_store.deposit(mixed_auto_puddle, &"petrol", 1.0)
	mixed_auto_store.deposit(mixed_auto_puddle, &"diesel", 200.0)
	var mixed_auto_thermal = Thermal.new()
	mixed_auto_thermal.add_object(&"warm-source", {"temperature_c": 300.0, "ignition_c": 1000.0})
	mixed_auto_thermal.add_object(&"mixed-pool-fire", {"temperature_c": 20.0, "ignition_c": 25.0,
		"heat_capacity_kj_c": 1.0, "fuel": 10.0, "burn_rate": 1.0, "heat_kj_per_fuel": 1.0})
	var mixed_auto: Dictionary = Adapter.new(mixed_auto_thermal).try_auto_ignite_from_hot_source(
		mixed_auto_store, mixed_auto_puddle, &"warm-source", &"mixed-pool-fire", 200.0)
	case_result(mixed_auto.ignited and mixed_auto.kind == &"diesel"
		and mixed_auto_store.components(mixed_auto_puddle) == {"petrol": 1.0},
		"mixed fuel skips an insufficient petrol trace and ignites from sufficient typed diesel")
	case_result(system.configure_room(&"kitchen", {"oxygen": 0.0, "ventilation": 0.0})
		and system.room_state(&"kitchen").oxygen == 0.0, "host can close and control a room's oxygen state")
	var room_before_bad_config: Dictionary = system.room_state(&"kitchen")
	case_result(not system.configure_room(&"kitchen", {"oxygen": NAN})
		and system.room_state(&"kitchen") == room_before_bad_config, "invalid room reconfiguration is atomic")
	var quenched_events: Dictionary = system.step(Thermal.FIXED_STEP)
	case_result(not system.object_state(&"pan").burning and not quenched_events.events.is_empty(),
		"fire stops after room oxygen is depleted")
	case_result(system.move_object(&"pan", Vector3(1, 0, 0), &"")
		and system.object_state(&"pan").room_id == &"", "object can be moved out of a room without simulating air")
	case_result(not system.move_object(&"pan", Vector3(INF, 0, 0), &"missing"), "invalid position and room changes are rejected")
	var smoke_budget = Thermal.new()
	smoke_budget.add_room(&"nearly-full", {"smoke": 999999.5})
	case_result(not smoke_budget.add_object(&"fuel", {"room_id": &"nearly-full", "fuel": 1000.0, "burn_rate": 1.0,
		"heat_kj_per_fuel": 0.001, "heat_capacity_kj_c": 10.0}), "authored future smoke budget cannot overflow room state")
	var saturated_smoke = Thermal.new()
	saturated_smoke.add_room(&"nearly-full", {"smoke": 999999.5, "ventilation": 0.0})
	var smoke_fire_added: bool = saturated_smoke.add_object(&"smoke-fire", {"room_id": &"nearly-full", "fuel": 100.0, "burn_rate": 1000.0,
		"heat_kj_per_fuel": 0.001, "ignition_c": 20.0, "temperature_c": 20.0})
	saturated_smoke.step(0.2)
	case_result(smoke_fire_added and saturated_smoke.object_state(&"smoke-fire").fuel < 100.0
		and saturated_smoke.room_state(&"nearly-full").smoke > 999999.5
		and saturated_smoke.room_state(&"nearly-full").smoke <= 1000000.0,
		"active fire adds smoke near the room cap without exceeding its declared state bound")
	var heat_bound = Thermal.new()
	heat_bound.add_room(&"hot-room", {"temperature_c": 999999.9})
	heat_bound.add_object(&"hot-source", {"room_id": &"hot-room", "temperature_c": 1000000.0, "ignition_c": 1000000.0})
	heat_bound.add_object(&"fuel-object", {"room_id": &"hot-room", "temperature_c": 999999.8, "ignition_c": 999999.81,
		"fuel": 0.1, "burn_rate": 10.0, "heat_kj_per_fuel": 2.0})
	heat_bound.link_objects(&"hot-source", &"fuel-object", 100.0)
	heat_bound.step(Thermal.FIXED_STEP)
	heat_bound.step(Thermal.FIXED_STEP)
	case_result(heat_bound.object_state(&"fuel-object").fuel < 0.1
		and heat_bound.object_state(&"fuel-object").temperature_c <= 1000000.0,
		"linked heat ignites fuel while combustion keeps temperature inside its declared bound")
	var move_budget = Thermal.new()
	move_budget.add_room(&"hot-room", {"temperature_c": 999999.95, "heat_capacity_kj_c": 0.1})
	move_budget.add_object(&"outside-fuel", {"fuel": 1.0, "burn_rate": 1.0, "heat_kj_per_fuel": 0.1, "ignition_c": 900.0})
	case_result(not move_budget.move_object(&"outside-fuel", Vector3.ZERO, &"hot-room")
		and move_budget.object_state(&"outside-fuel").room_id == &"", "room reassignment preflights its remaining heat before mutation")
	var final_stats: Dictionary = system.stats()
	case_result(final_stats.objects <= Thermal.MAX_OBJECTS and final_stats.rooms <= Thermal.MAX_ROOMS
		and final_stats.links <= Thermal.MAX_LINKS, "runtime state remains within fixed object, room and link budgets")
	var bounded = Thermal.new()
	var all_objects_added := true
	for index in Thermal.MAX_OBJECTS:
		all_objects_added = bounded.add_object(StringName("n" + str(index)), {"temperature_c": 20.0}) and all_objects_added
	var made_links := 0
	for a in Thermal.MAX_OBJECTS:
		for b in range(a + 1, Thermal.MAX_OBJECTS):
			if made_links >= Thermal.MAX_LINKS: break
			if bounded.link_objects(StringName("n" + str(a)), StringName("n" + str(b)), 10.0): made_links += 1
		if made_links >= Thermal.MAX_LINKS: break
	var overflow_object := bounded.add_object(&"overflow", {"temperature_c": 20.0})
	var stress_tick: Dictionary = bounded.step(Thermal.FIXED_STEP)
	case_result(all_objects_added and made_links == Thermal.MAX_LINKS and not overflow_object and stress_tick.ok
		and bounded.stats().objects == Thermal.MAX_OBJECTS and bounded.stats().links == Thermal.MAX_LINKS,
		"maximum authored population and link count execute a bounded fixed tick")
	var checkpoint_source = Thermal.new()
	checkpoint_source.add_room(&"checkpoint-room", {"temperature_c": 40.0, "oxygen": 0.9, "smoke": 0.2})
	checkpoint_source.add_object(&"checkpoint-fire", {"room_id": &"checkpoint-room",
		"position": Vector3(1.0, 2.0, 3.0), "temperature_c": 300.0, "ignition_c": 260.0,
		"heat_capacity_kj_c": 2.0, "flammability": 0.8, "fuel": 3.0, "burn_rate": 0.2,
		"heat_kj_per_fuel": 4.0, "wetness": 0.1})
	checkpoint_source.add_object(&"z-fire", {"room_id": &"checkpoint-room", "temperature_c": 300.0,
		"ignition_c": 260.0, "fuel": 1.0, "burn_rate": 0.2})
	checkpoint_source.add_object(&"a-fire", {"room_id": &"checkpoint-room", "temperature_c": 300.0,
		"ignition_c": 260.0, "fuel": 1.0, "burn_rate": 0.2})
	checkpoint_source.add_object(&"far-object", {"position": Vector3(1.0e20, 0.0, 0.0), "temperature_c": 20.0})
	checkpoint_source.step(0.025)
	var json_checkpoint: Dictionary = JSON.parse_string(JSON.stringify(checkpoint_source.checkpoint()))
	var checkpoint_copy = Thermal.new()
	case_result(checkpoint_copy.restore_checkpoint(json_checkpoint)
		and checkpoint_copy.stats().pending_seconds == checkpoint_source.stats().pending_seconds
		and checkpoint_copy.room_state(&"checkpoint-room") == checkpoint_source.room_state(&"checkpoint-room")
		and checkpoint_copy.object_state(&"checkpoint-fire") == checkpoint_source.object_state(&"checkpoint-fire"),
		"thermal checkpoint survives JSON roundtrip with live fire and substep time")
	var invalid_checkpoint: Dictionary = json_checkpoint.duplicate(true)
	invalid_checkpoint.links = [{"a": "checkpoint-fire", "b": "missing", "conductance": 2.0}]
	var before_invalid_restore: Dictionary = checkpoint_copy.checkpoint()
	case_result(not checkpoint_copy.restore_checkpoint(invalid_checkpoint)
		and checkpoint_copy.checkpoint() == before_invalid_restore,
		"invalid thermal checkpoint fails atomically")
	var invalid_burning_checkpoint: Dictionary = json_checkpoint.duplicate(true)
	invalid_burning_checkpoint.objects[0].fuel = 0.0
	case_result(not checkpoint_copy.restore_checkpoint(invalid_burning_checkpoint)
		and checkpoint_copy.checkpoint() == before_invalid_restore,
		"checkpoint cannot restore a burning object with exhausted fuel")
	var invalid_flammability_checkpoint: Dictionary = json_checkpoint.duplicate(true)
	invalid_flammability_checkpoint.objects[0].flammability = 0.0
	case_result(not checkpoint_copy.restore_checkpoint(invalid_flammability_checkpoint)
		and checkpoint_copy.checkpoint() == before_invalid_restore,
		"checkpoint cannot restore a burning nonflammable object")
	var invalid_burn_rate_checkpoint: Dictionary = json_checkpoint.duplicate(true)
	invalid_burn_rate_checkpoint.objects[0].burn_rate = 0.0
	case_result(not checkpoint_copy.restore_checkpoint(invalid_burn_rate_checkpoint)
		and checkpoint_copy.checkpoint() == before_invalid_restore,
		"checkpoint cannot restore a burning zero-rate object")
	var invalid_wetness_checkpoint: Dictionary = json_checkpoint.duplicate(true)
	invalid_wetness_checkpoint.objects[0].wetness = 0.8
	case_result(not checkpoint_copy.restore_checkpoint(invalid_wetness_checkpoint)
		and checkpoint_copy.checkpoint() == before_invalid_restore,
		"checkpoint cannot restore an extinguished wet object as burning")
	var invalid_foam_checkpoint: Dictionary = json_checkpoint.duplicate(true)
	invalid_foam_checkpoint.objects[0].foam_ml = 50.0
	case_result(not checkpoint_copy.restore_checkpoint(invalid_foam_checkpoint)
		and checkpoint_copy.checkpoint() == before_invalid_restore,
		"checkpoint cannot restore a foam-suppressed object as burning")
	var invalid_room_id_checkpoint: Dictionary = json_checkpoint.duplicate(true)
	invalid_room_id_checkpoint.objects[0].room_id = null
	case_result(not checkpoint_copy.restore_checkpoint(invalid_room_id_checkpoint)
		and checkpoint_copy.checkpoint() == before_invalid_restore,
		"thermal checkpoint rejects non-string room IDs atomically")
	var deterministic_copy = Thermal.new()
	deterministic_copy.restore_checkpoint(json_checkpoint)
	var source_next: Dictionary = checkpoint_source.step(Thermal.FIXED_STEP - 0.025)
	var copy_next: Dictionary = deterministic_copy.step(Thermal.FIXED_STEP - 0.025)
	case_result(source_next == copy_next
		and checkpoint_source.object_state(&"checkpoint-fire") == deterministic_copy.object_state(&"checkpoint-fire")
		and checkpoint_source.object_state(&"z-fire") == deterministic_copy.object_state(&"z-fire")
		and checkpoint_source.object_state(&"a-fire") == deterministic_copy.object_state(&"a-fire")
		and checkpoint_source.object_state(&"far-object") == deterministic_copy.object_state(&"far-object"),
		"restored thermal state preserves insertion order for identical multi-fire tick results")

	print("GS_THERMAL passed=%d failed=%d" % [passed, failed])
	quit(1 if failed else 0)

func case_result(ok: bool, label: String) -> void:
	if ok: passed += 1
	else:
		failed += 1
		push_error("GS_THERMAL: " + label)
