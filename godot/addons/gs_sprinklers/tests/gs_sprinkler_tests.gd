extends SceneTree

const Thermal = preload("res://addons/gs_thermal/gs_thermal_system.gd")
const Sprinklers = preload("res://addons/gs_sprinklers/gs_sprinkler_system.gd")
const SupplyTank = preload("res://addons/gs_resource_adapters/gs_supply_tank.gd")
const Battery = preload("res://addons/gs_resource_adapters/gs_battery_adapter.gd")
const BatteryPump = preload("res://addons/gs_sprinklers/gs_sprinkler_battery_pump.gd")

class ReentrantSupply extends RefCounted:
	var module: RefCounted
	var nested_result: Dictionary = {}
	var remove_during_step := true
	var register_during_step := true
	var amount_ml := 10.0

	func state() -> Dictionary:
		return {"components": {"water": amount_ml}}

	func withdraw(_kind: String, requested: float) -> float:
		nested_result = module.step(0.1)
		remove_during_step = module.remove_head(&"guarded-head")
		register_during_step = module.register_supply(&"extra", self)
		var actual := minf(amount_ml, requested)
		amount_ml -= actual
		return actual

class FlakySupply extends RefCounted:
	var state_calls := 0

	func state() -> Dictionary:
		state_calls += 1
		return {"components": {"water": 50.0}} if state_calls == 1 else {"components": "invalid"}

	func withdraw(_kind: String, requested: float) -> float:
		return requested

class InvalidPower extends RefCounted:
	func power_fraction(_requests: Array, _dt: float) -> float:
		return NAN

class UnderDeliveringSupply extends RefCounted:
	func state() -> Dictionary:
		return {"components": {"water": 100.0}}

	func withdraw(_kind: String, _requested: float) -> float:
		return 0.0

var passed := 0
var failed := 0


func _initialize() -> void:
	var thermal = Thermal.new()
	thermal.add_room(&"engine-room", {"temperature_c": 20.0})
	thermal.add_object(&"fire-a", {"room_id": &"engine-room", "position": Vector3.ZERO,
		"temperature_c": 300.0, "ignition_c": 200.0, "fuel": 5.0, "burn_rate": 0.1})
	thermal.add_object(&"fire-b", {"room_id": &"engine-room", "position": Vector3(0.5, 0.0, 0.0),
		"temperature_c": 300.0, "ignition_c": 200.0, "fuel": 5.0, "burn_rate": 0.1})
	thermal.add_object(&"far-fire", {"room_id": &"engine-room", "position": Vector3(20.0, 0.0, 0.0),
		"temperature_c": 300.0, "ignition_c": 200.0, "fuel": 5.0, "burn_rate": 0.1})
	var tank = SupplyTank.new(2000.0, {"water": 1000.0})
	var system = Sprinklers.new(thermal)
	case_result(system.register_supply(&"main", tank), "typed tank registers as a liquid supply")
	case_result(not system.register_supply(&"main", tank), "duplicate supply identifiers are rejected")
	case_result(not system.add_head(&"missing-room", {"room_id": &"missing", "supply_id": &"main"}),
		"sprinkler cannot target an unknown thermal room")
	case_result(not system.add_head(&"missing-supply", {"room_id": &"engine-room", "supply_id": &"missing"}),
		"sprinkler cannot reference an unknown supply")
	case_result(not system.add_head(&"invalid-flow", {"room_id": &"engine-room", "supply_id": &"main", "flow_ml_s": INF}),
		"non-finite flow configuration is rejected")
	var oversized_targets: Array[StringName] = []
	for index in Sprinklers.MAX_TARGETS_PER_HEAD + 1:
		oversized_targets.append(StringName("target" + str(index)))
	case_result(not system.add_head(&"oversized", {"room_id": &"engine-room", "supply_id": &"main",
		"target_ids": oversized_targets}), "per-head thermal target list stays within its work budget")
	case_result(system.add_head(&"a", {"room_id": &"engine-room", "supply_id": &"main", "target_ids": [&"fire-a"],
		"position": Vector3.ZERO, "flow_ml_s": 2500.0, "valve_open": true}), "valid manually triggered head is authored")
	case_result(not system.add_head(&"a", {"room_id": &"engine-room", "supply_id": &"main"}), "duplicate head identifiers are rejected")
	case_result(not system.unregister_supply(&"main"), "supply cannot be removed while a head references it")
	case_result(system.set_valve_open(&"a", false) and system.trigger(&"a"), "manual trigger latches independently from valve state")
	var closed_step: Dictionary = system.step(Sprinklers.FIXED_STEP)
	case_result(closed_step.ok and closed_step.events.is_empty() and tank.state().ml == 1000.0,
		"closed valve prevents flow from a triggered head")
	case_result(system.set_valve_open(&"a", true), "valve can be opened")
	var first_step: Dictionary = system.step(Sprinklers.FIXED_STEP)
	case_result(first_step.events.size() == 1 and first_step.events[0].type == &"spray"
		and first_step.events[0].kind == &"water" and is_equal_approx(first_step.events[0].ml, 250.0),
		"manual opening emits an actual typed water receipt")
	case_result(not thermal.object_state(&"fire-a").burning and thermal.object_state(&"fire-b").burning,
		"water cools only the authored target in range")
	case_result(tank.state().components.water < 1000.0, "spray debits the finite tank")
	var partial: Dictionary = system.step(0.05)
	case_result(partial.steps == 0 and is_equal_approx(partial.pending_seconds, 0.05), "substep time is retained")
	var full: Dictionary = system.step(0.05)
	case_result(full.steps == 1, "retained time completes the fixed sprinkler tick")
	var rejected: Dictionary = system.step(Sprinklers.MAX_FRAME_DELTA + 0.1)
	case_result(not rejected.ok and is_equal_approx(float(system.stats().pending_seconds), 0.0),
		"excessive frame debt is rejected atomically")

	var auto_tank = SupplyTank.new(1000.0, {"water": 1000.0})
	var auto = Sprinklers.new(thermal)
	auto.register_supply(&"tank", auto_tank)
	case_result(thermal.configure_room(&"engine-room", {"temperature_c": 180.0}), "room heat can be raised for the detector test")
	auto.add_head(&"sensor", {"room_id": &"engine-room", "supply_id": &"tank", "target_ids": [&"fire-b"],
		"trigger_temperature_c": 68.0, "response_seconds": 0.1, "valve_open": false})
	var sensor_step: Dictionary = auto.step(0.2)
	case_result(auto.head_state(&"sensor").triggered and sensor_step.events.size() == 1
		and sensor_step.events[0].type == &"triggered", "thermal sensor triggers and emits a one-shot event")
	case_result(auto_tank.state().ml == 1000.0, "closed automatic head consumes no fluid")
	auto.set_valve_open(&"sensor", true)
	var auto_flow: Dictionary = auto.step(Sprinklers.FIXED_STEP)
	case_result(auto_flow.events.size() == 1 and auto_flow.events[0].type == &"spray",
		"latched automatic head starts flow when the valve opens")
	case_result(not auto.reset_head(&"sensor"), "spent automatic head cannot reset while its sensor remains hot")
	thermal.configure_room(&"engine-room", {"temperature_c": 20.0})
	auto.step(0.8)
	auto.step(0.2)
	case_result(auto.reset_head(&"sensor") and not auto.head_state(&"sensor").triggered,
		"cooled head can be replaced and reset")

	var fair_tank = SupplyTank.new(100.0, {"water": 100.0})
	var fair = Sprinklers.new(thermal)
	fair.register_supply(&"shared", fair_tank)
	fair.add_head(&"left", {"room_id": &"engine-room", "supply_id": &"shared", "target_ids": [&"fire-b"],
		"flow_ml_s": 1000.0})
	fair.add_head(&"right", {"room_id": &"engine-room", "supply_id": &"shared", "target_ids": [&"far-fire"],
		"flow_ml_s": 1000.0})
	fair.trigger(&"left")
	fair.trigger(&"right")
	var fair_step: Dictionary = fair.step(Sprinklers.FIXED_STEP)
	case_result(fair_step.events.size() == 2 and is_equal_approx(fair_step.events[0].ml, 50.0)
		and is_equal_approx(fair_step.events[1].ml, 50.0) and fair_tank.state().ml == 0.0,
		"nearly empty shared tank flow is allocated proportionally between heads")
	case_result(fair_step.events[1].affected_targets.is_empty()
		and fair_step.events[1].thermal_applied_ml == 0.0, "out-of-range target receives no thermal effect")

	var battery_tank = SupplyTank.new(500.0, {"water": 500.0})
	var battery_system = Sprinklers.new(thermal)
	battery_system.register_supply(&"tank", battery_tank)
	battery_system.add_head(&"powered", {"room_id": &"engine-room", "supply_id": &"tank",
		"flow_ml_s": 1000.0})
	battery_system.trigger(&"powered")
	var half_battery = Battery.new(0.0005, 0.0005, 12.0)
	var pump = BatteryPump.new(half_battery, 36.0, 1000.0)
	case_result(pump.is_valid() and battery_system.set_power_provider(pump),
		"valid battery pump can be attached as an optional power provider")
	var powered_step: Dictionary = battery_system.step(Sprinklers.FIXED_STEP)
	case_result(powered_step.events.size() == 2 and powered_step.events[0].type == &"spray"
		and is_equal_approx(powered_step.events[0].ml, 50.0) and powered_step.events[1].type == &"power"
		and is_equal_approx(powered_step.events[1].delivered_ml, 50.0) and half_battery.state().energyWh == 0.0,
		"finite battery energy scales shared sprinkler flow and is consumed in Wh")
	case_result(battery_system.stats().powered, "sprinkler runtime reports an attached power provider")
	var empty_step: Dictionary = battery_system.step(Sprinklers.FIXED_STEP)
	case_result(empty_step.events.size() == 1 and empty_step.events[0].type == &"power"
		and empty_step.events[0].fraction == 0.0 and battery_tank.state().ml == 450.0,
		"empty battery stops flow without withdrawing liquid")
	battery_system.set_power_provider(null)
	var bypass_step: Dictionary = battery_system.step(Sprinklers.FIXED_STEP)
	case_result(bypass_step.events.size() == 1 and bypass_step.events[0].type == &"spray"
		and is_equal_approx(bypass_step.events[0].ml, 100.0),
		"removing the optional pump restores direct unpowered flow")

	var capped_system = Sprinklers.new(thermal)
	var capped_tank = SupplyTank.new(500.0, {"water": 500.0})
	capped_system.register_supply(&"tank", capped_tank)
	capped_system.add_head(&"capacity", {"room_id": &"engine-room", "supply_id": &"tank", "flow_ml_s": 1000.0})
	capped_system.trigger(&"capacity")
	var full_battery = Battery.new(2.0, 2.0, 12.0)
	var capped_pump = BatteryPump.new(full_battery, 36.0, 500.0)
	capped_system.set_power_provider(capped_pump)
	var capped_pump_step: Dictionary = capped_system.step(Sprinklers.FIXED_STEP)
	case_result(capped_pump_step.events.size() == 2 and is_equal_approx(capped_pump_step.events[0].ml, 50.0)
		and is_equal_approx(capped_pump.last_fraction, 0.5),
		"pump capacity limits delivered flow even with a charged battery")
	case_result(not BatteryPump.new(full_battery, 0.0, 50.0).is_valid()
		and not BatteryPump.new(null, 10.0, 50.0).is_valid(), "invalid pump configurations are rejected")
	var invalid_power_system = Sprinklers.new(thermal)
	var invalid_power_tank = SupplyTank.new(100.0, {"water": 100.0})
	invalid_power_system.register_supply(&"tank", invalid_power_tank)
	invalid_power_system.add_head(&"head", {"room_id": &"engine-room", "supply_id": &"tank"})
	invalid_power_system.trigger(&"head")
	invalid_power_system.set_power_provider(InvalidPower.new())
	var invalid_power_step: Dictionary = invalid_power_system.step(Sprinklers.FIXED_STEP)
	case_result(invalid_power_step.ok and invalid_power_step.events.size() == 2
		and invalid_power_step.events[0].type == &"power_fault"
		and invalid_power_step.events[1].type == &"power" and invalid_power_tank.state().ml == 100.0,
		"invalid power callback result safely consumes a no-flow tick")
	var underdelivered_system = Sprinklers.new(thermal)
	var underdeliver_supply = UnderDeliveringSupply.new()
	underdelivered_system.register_supply(&"short", underdeliver_supply)
	underdelivered_system.add_head(&"short-head", {"room_id": &"engine-room", "supply_id": &"short"})
	underdelivered_system.trigger(&"short-head")
	underdelivered_system.set_power_provider(BatteryPump.new(Battery.new(1.0, 1.0, 12.0), 36.0, 600.0))
	var underdelivered_step: Dictionary = underdelivered_system.step(Sprinklers.FIXED_STEP)
	case_result(underdelivered_step.events.size() == 1 and underdelivered_step.events[0].type == &"power"
		and underdelivered_step.events[0].requested_ml == 6.0
		and underdelivered_step.events[0].delivered_ml == 0.0,
		"power receipt distinguishes planned dose from actual supply withdrawal")

	var foam_tank = SupplyTank.new(200.0, {})
	foam_tank.fill("foam", 100.0)
	var foam_system = Sprinklers.new(thermal)
	foam_system.register_supply(&"foam-tank", foam_tank)
	foam_system.add_head(&"foam-head", {"room_id": &"engine-room", "supply_id": &"foam-tank", "kind": &"foam",
		"target_ids": [&"fire-b"], "flow_ml_s": 1000.0})
	foam_system.trigger(&"foam-head")
	var foam_step: Dictionary = foam_system.step(Sprinklers.FIXED_STEP)
	case_result(foam_step.events.size() == 1 and foam_step.events[0].kind == &"foam"
		and foam_tank.state().ml == 0.0, "foam supply stays typed and is consumed by the head")
	case_result(not thermal.object_state(&"fire-b").burning, "foam effect reaches its valid in-range target")

	var fuel_tank = SupplyTank.new(200.0, {"diesel": 100.0})
	var fuel_system = Sprinklers.new(thermal)
	fuel_system.register_supply(&"fuel", fuel_tank)
	fuel_system.add_head(&"fuel-head", {"room_id": &"engine-room", "supply_id": &"fuel", "kind": &"diesel"})
	fuel_system.trigger(&"fuel-head")
	var fuel_step: Dictionary = fuel_system.step(Sprinklers.FIXED_STEP)
	case_result(fuel_step.events.size() == 1 and fuel_step.events[0].kind == &"diesel"
		and is_equal_approx(fuel_step.events[0].ml, 6.0), "non-extinguishing liquid is emitted with its original type")
	case_result(thermal.object_state(&"far-fire").burning,
		"fuel spray event does not masquerade as thermal extinguishing liquid")
	case_result(fuel_tank.fill("petrol", 10.0) == 10.0 and fuel_tank.state().components.has("petrol"),
		"supply can be refilled with a different named liquid")
	case_result(fuel_system.stats().heads == 1 and fuel_system.stats().flowing == 1,
		"runtime stats report bounded head and flow counts")
	case_result(fuel_system.remove_head(&"fuel-head") and fuel_system.unregister_supply(&"fuel"),
		"head and supply can be cleanly removed after use")
	case_result(not fuel_system.remove_head(&"fuel-head"), "unknown head removal is harmlessly rejected")
	var guarded = Sprinklers.new(thermal)
	var reentrant_supply = ReentrantSupply.new()
	reentrant_supply.module = guarded
	guarded.register_supply(&"external", reentrant_supply)
	guarded.add_head(&"guarded-head", {"room_id": &"engine-room", "supply_id": &"external"})
	guarded.trigger(&"guarded-head")
	var guarded_step: Dictionary = guarded.step(Sprinklers.FIXED_STEP)
	case_result(guarded_step.ok and not reentrant_supply.nested_result.ok
		and reentrant_supply.nested_result.steps == 0,
		"nested step from an external supply is rejected")
	case_result(not reentrant_supply.remove_during_step and not reentrant_supply.register_during_step,
		"supply callbacks cannot mutate system topology during a fixed tick")
	guarded.remove_head(&"guarded-head")
	guarded.unregister_supply(&"external")
	reentrant_supply.module = null
	var malformed = Sprinklers.new(thermal)
	var flaky_supply = FlakySupply.new()
	malformed.register_supply(&"flaky", flaky_supply)
	malformed.add_head(&"flaky-head", {"room_id": &"engine-room", "supply_id": &"flaky"})
	malformed.trigger(&"flaky-head")
	var malformed_step: Dictionary = malformed.step(Sprinklers.FIXED_STEP)
	case_result(malformed_step.ok and malformed_step.events.is_empty(),
		"supply that becomes malformed after registration produces a safe no-flow tick")

	var capped = Sprinklers.new(thermal)
	var cap_tank = SupplyTank.new(100.0, {"water": 100.0})
	capped.register_supply(&"cap", cap_tank)
	var all_added := true
	for index in Sprinklers.MAX_HEADS:
		all_added = capped.add_head(StringName("h" + str(index)), {"room_id": &"engine-room", "supply_id": &"cap"}) and all_added
	case_result(all_added and not capped.add_head(&"overflow", {"room_id": &"engine-room", "supply_id": &"cap"})
		and capped.stats().heads == Sprinklers.MAX_HEADS, "authored head population stays within the fixed cap")

	print("GS_SPRINKLERS passed=%d failed=%d" % [passed, failed])
	quit(1 if failed else 0)


func case_result(ok: bool, label: String) -> void:
	if ok: passed += 1
	else:
		failed += 1
		push_error("GS_SPRINKLERS: " + label)
