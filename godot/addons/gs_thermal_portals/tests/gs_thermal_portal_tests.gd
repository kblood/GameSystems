extends SceneTree

const Thermal = preload("../../gs_thermal/gs_thermal_system.gd")
const Portals = preload("../gs_thermal_portal_system.gd")
var passed := 0
var failed := 0

func _initialize() -> void:
	isolation_and_conservation()
	order_and_star_budget()
	validation_and_atomicity()
	checkpoint_contract()
	benchmark_max_population()
	print("GS_THERMAL_PORTALS passed=%d failed=%d" % [passed, failed])
	quit(1 if failed else 0)

func check(condition: bool, label: String) -> void:
	if condition: passed += 1
	else:
		failed += 1
		push_error("GS_THERMAL_PORTALS: " + label)

func close(a: float, b: float, tolerance: float = 1.0e-9) -> bool:
	return absf(a - b) <= tolerance * maxf(1.0, maxf(absf(a), absf(b)))

func pair() -> Thermal:
	var thermal := Thermal.new()
	thermal.add_room(&"hot", {"temperature_c": 200.0, "smoke": 10.0, "oxygen": 0.2, "heat_capacity_kj_c": 2.0})
	thermal.add_room(&"cold", {"temperature_c": 20.0, "smoke": 0.0, "oxygen": 1.0, "heat_capacity_kj_c": 6.0})
	return thermal

func totals(thermal: Thermal) -> Array[float]:
	var sum_smoke := 0.0
	var sum_oxygen := 0.0
	var sum_heat := 0.0
	for room: Dictionary in thermal.checkpoint().rooms:
		sum_smoke += float(room.smoke)
		sum_oxygen += float(room.oxygen)
		sum_heat += float(room.temperature_c) * float(room.heat_capacity_kj_c)
	return [sum_smoke, sum_oxygen, sum_heat]

func isolation_and_conservation() -> void:
	var thermal := pair()
	var portals := Portals.new(thermal)
	check(portals.add_portal(&"door", &"hot", &"cold", {"opening": 0.0}), "register closed opening")
	var initial := thermal.checkpoint()
	check(portals.step(0.05).ok and thermal.checkpoint() == initial, "closed opening fully isolates rooms")
	check(portals.set_opening(&"door", 1.0), "open the portal")
	var before := totals(thermal)
	var result := portals.step(0.05)
	var hot := thermal.room_state(&"hot")
	var cold := thermal.room_state(&"cold")
	check(result.ok and result.rooms == 2 and result.portals == 1, "one tick updates both rooms")
	check(hot.temperature_c < 200.0 and cold.temperature_c > 20.0 and cold.smoke > 0.0
		and hot.oxygen > 0.2, "open portal exchanges heat smoke and oxygen")
	var after := totals(thermal)
	check(close(before[0], after[0]) and close(before[1], after[1]) and close(before[2], after[2]),
		"unequal heat capacities conserve energy and equal-volume air concentrations")
	check(thermal.checkpoint().clock == initial.clock, "portal does not advance thermal time")
	var half_thermal := pair()
	var half := Portals.new(half_thermal)
	half.add_portal(&"door", &"hot", &"cold", {"opening": 0.5})
	half.step(0.05)
	check(close(half_thermal.room_state(&"cold").smoke, cold.smoke * 0.5), "partial opening scales isolated pair exchange")
	for i in range(200): check(portals.step(0.05).ok, "repeated bounded exchange succeeds")
	after = totals(thermal)
	check(close(before[0], after[0]) and close(before[1], after[1]) and close(before[2], after[2]),
		"repeated mixing conserves all three channels")
	check(thermal.room_state(&"cold").temperature_c <= thermal.room_state(&"hot").temperature_c,
		"mixing approaches equilibrium without crossing")

func order_and_star_budget() -> void:
	var first := Thermal.new()
	var second := Thermal.new()
	for i in range(8):
		var values := {"temperature_c": 20.0 + 30.0 * i, "oxygen": float(i) / 8.0, "smoke": float(i),
			"heat_capacity_kj_c": 1.0 + i}
		first.add_room(StringName("r%d" % i), values)
		second.add_room(StringName("r%d" % i), values)
	var a := Portals.new(first)
	var b := Portals.new(second)
	for i in range(7): a.add_portal(StringName("p%d" % i), &"r0", StringName("r%d" % (i + 1)))
	for i in range(6, -1, -1): b.add_portal(StringName("p%d" % i), StringName("r%d" % (i + 1)), &"r0")
	a.step(0.05)
	b.step(0.05)
	check(first.checkpoint() == second.checkpoint(), "reversed endpoints and insertion order produce identical results")
	var star := Thermal.new()
	star.add_room(&"center", {"temperature_c": 100.0, "smoke": 100.0, "oxygen": 1.0, "heat_capacity_kj_c": 1.0})
	var graph := Portals.new(star)
	for i in range(63):
		var id := StringName("leaf%d" % i)
		star.add_room(id, {"temperature_c": 0.0, "smoke": 0.0, "oxygen": 0.0, "heat_capacity_kj_c": 1.0})
		graph.add_portal(StringName("edge%d" % i), &"center", id,
			{"heat_fraction": 0.25, "smoke_fraction": 0.25, "oxygen_fraction": 0.25})
	var before := totals(star)
	check(graph.step(0.05).ok, "high-degree graph ticks")
	var center := star.room_state(&"center")
	check(close(center.smoke, 87.5) and close(center.oxygen, 0.875) and close(center.temperature_c, 87.5),
		"aggregate per-room weights cap star graph exchange")
	var after := totals(star)
	check(close(before[0], after[0]) and close(before[1], after[1]) and close(before[2], after[2]),
		"star graph conserves all channels")

func validation_and_atomicity() -> void:
	var thermal := pair()
	var portals := Portals.new(thermal, 1)
	check(not portals.add_portal(&"", &"hot", &"cold"), "blank portal id rejected")
	check(not portals.add_portal(&"self", &"hot", &"hot"), "self portal rejected")
	check(not portals.add_portal(&"missing", &"hot", &"missing"), "unknown room rejected")
	check(not portals.add_portal(&"bad", &"hot", &"cold", {"opening": true}), "boolean opening rejected")
	check(not portals.add_portal(&"bad", &"hot", &"cold", {"heat_fraction": 0.251}), "excess fraction rejected")
	check(not portals.add_portal(&"bad", &"hot", &"cold", {"smoke_fraction": NAN}), "nonfinite fraction rejected")
	check(not portals.add_portal(&"bad", &"hot", &"cold", {"typo": 0.1}), "unknown option rejected")
	portals.add_portal(&"door", &"hot", &"cold")
	check(not portals.add_portal(&"extra", &"hot", &"cold"), "lowered portal budget enforced")
	check(not portals.set_opening(&"door", -0.1) and not portals.set_opening(&"door", INF), "invalid opening mutation rejected")
	var before := thermal.checkpoint()
	check(not portals.step(0.1).ok and not portals.step(NAN).ok and not portals.step(-0.05).ok
		and thermal.checkpoint() == before, "only one finite 50 ms tick is accepted")
	var capped := Thermal.new()
	capped.add_room(&"a_hot", {"temperature_c": 1000000.0, "heat_capacity_kj_c": 1.0})
	capped.add_room(&"b_fueled", {"temperature_c": 999999.69, "heat_capacity_kj_c": 1.0})
	check(capped.add_object(&"fuel", {"room_id": &"b_fueled", "temperature_c": 20.0, "fuel": 1.0, "burn_rate": 0.1,
		"heat_kj_per_fuel": 1.0}), "near-limit fuel reservation fixture is valid")
	var blocked := Portals.new(capped)
	blocked.add_portal(&"door", &"a_hot", &"b_fueled", {"heat_fraction": 0.25})
	before = capped.checkpoint()
	check(not blocked.step(0.05).ok and capped.checkpoint() == before and blocked.stats().ticks == 0,
		"fuel headroom rejection leaves donor receiver and adapter tick unchanged")
	var empty := Thermal.new()
	check(thermal.restore_checkpoint(empty.checkpoint()), "host can replace thermal topology")
	check(not portals.step(0.05).ok, "stale room references fail safely")
	portals.dispose()
	portals.dispose()
	check(not portals.is_valid() and not portals.step(0.05).ok and portals.checkpoint().is_empty(), "dispose is idempotent")

func checkpoint_contract() -> void:
	var thermal := pair()
	var portals := Portals.new(thermal)
	portals.add_portal(&"door", &"hot", &"cold", {"opening": 0.3})
	var saved := portals.checkpoint()
	portals.set_opening(&"door", 0.9)
	check(portals.restore_checkpoint(JSON.stringify(saved)) and portals.checkpoint() == saved, "JSON roundtrip restores opening")
	var prepared := portals.prepare_restore(saved)
	portals.set_opening(&"door", 0.7)
	check(prepared.ok and not prepared.commit.call() and portals.state(&"door").opening == 0.7,
		"stale plan cannot overwrite a newer opening")
	prepared = portals.prepare_restore(saved)
	portals.remove_portal(&"door")
	portals.add_portal(&"door", &"hot", &"cold")
	check(prepared.ok and not prepared.commit.call(), "same-id removal and replacement invalidates prepared plan")
	var before := portals.checkpoint()
	var bad: Dictionary = saved.duplicate(true)
	bad.portals[0].a = "missing"
	check(not portals.restore_checkpoint(bad) and portals.checkpoint() == before, "unknown topology rejected atomically")
	bad = saved.duplicate(true)
	bad.portals[0].heat_fraction = 0.2
	check(not portals.restore_checkpoint(bad) and portals.checkpoint() == before, "authored rate mismatch rejected")
	bad = saved.duplicate(true)
	bad.portals[0].opening = "open"
	check(not portals.restore_checkpoint(bad) and portals.checkpoint() == before, "invalid opening type rejected")
	bad = saved.duplicate(true)
	bad.extra = true
	check(not portals.restore_checkpoint(bad), "unknown checkpoint keys rejected")
	check(not portals.restore_checkpoint("{broken"), "malformed JSON rejected")
	prepared = portals.prepare_restore(saved)
	check(prepared.ok and prepared.commit.call() and not prepared.commit.call(), "prepared restore is one-shot")

func benchmark_max_population() -> void:
	var thermal := Thermal.new()
	for i in range(64): thermal.add_room(StringName("r%d" % i), {"temperature_c": 20.0 + i,
		"smoke": float(i), "oxygen": float(i + 1) / 64.0, "heat_capacity_kj_c": 10.0 + i})
	for i in range(256): thermal.add_object(StringName("o%d" % i), {"room_id": StringName("r%d" % (i % 64)),
		"fuel": 1.0, "burn_rate": 0.1, "heat_kj_per_fuel": 1.0})
	for i in range(256):
		for offset in range(1, 5): thermal.link_objects(StringName("o%d" % i), StringName("o%d" % ((i + offset) % 256)), 0.1)
	var portals := Portals.new(thermal)
	for i in range(128): portals.add_portal(StringName("p%d" % i), StringName("r%d" % (i % 64)),
		StringName("r%d" % ((i + 1 + i / 64) % 64)))
	check(thermal.stats().objects == 256 and thermal.stats().links == 1024 and portals.stats().portals == 128,
		"max-population benchmark fixture fills every registry")
	check(not portals.add_portal(&"overflow", &"r0", &"r1"), "hard portal count cap enforced")
	for i in range(20): portals.step(0.05)
	var times: Array[int] = []
	var all_ok := true
	for i in range(200):
		var start := Time.get_ticks_usec()
		var result := portals.step(0.05)
		times.append(Time.get_ticks_usec() - start)
		all_ok = all_ok and result.ok
	check(all_ok, "max-population ticks succeed")
	times.sort()
	var sum := 0
	for value in times: sum += value
	print("GS_THERMAL_PORTALS benchmark rooms=64 objects=256 links=1024 portals=128 ticks=200 mean_ms=%.3f p95_ms=%.3f max_ms=%.3f"
		% [float(sum) / 200000.0, float(times[189]) / 1000.0, float(times[-1]) / 1000.0])
