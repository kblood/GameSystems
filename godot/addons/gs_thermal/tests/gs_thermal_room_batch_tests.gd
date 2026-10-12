extends SceneTree

const Thermal = preload("../gs_thermal_system.gd")
var passed := 0
var failed := 0

func _initialize() -> void:
	var thermal := Thermal.new()
	thermal.add_room(&"a", {"temperature_c": 40.0})
	thermal.add_room(&"b", {"temperature_c": 20.0})
	thermal.add_object(&"fuel", {"room_id": &"b", "fuel": 1.0, "burn_rate": 0.1})
	thermal.step(0.05)
	var before := thermal.checkpoint()
	check(thermal.configure_rooms_batch({&"a": {"temperature_c": 35.0}, "b": {"temperature_c": 25.0}}), "valid mixed string/name room patches commit")
	check(thermal.room_state(&"a").temperature_c == 35.0 and thermal.room_state(&"b").temperature_c == 25.0, "both rooms update")
	var after := thermal.checkpoint()
	check(after.objects == before.objects and after.links == before.links and after.clock == before.clock
		and after.pending_seconds == before.pending_seconds, "batch preserves objects links and time")
	before = thermal.checkpoint()
	check(not thermal.configure_rooms_batch({"a": {"oxygen": 0.5}, "b": {"oxygen": 2.0}})
		and thermal.checkpoint() == before, "invalid later patch rejects the whole batch")
	check(not thermal.configure_rooms_batch({"a": {"temperature_c": 30.0}, "b": {"temperature_c": 1000000.0}})
		and thermal.checkpoint() == before, "reserved future fuel heat is checked before all commits")
	check(not thermal.configure_rooms_batch({"a": {"smoke": 1.0}, "b": {"smoke": 1000000.0}})
		and thermal.checkpoint() == before, "reserved future smoke is checked before all commits")
	check(not thermal.configure_rooms_batch({"missing": {"oxygen": 0.5}}), "unknown room rejected")
	check(not thermal.configure_rooms_batch({1: {"oxygen": 0.5}}), "non-string room id rejected")
	check(not thermal.configure_rooms_batch({"a": false}), "nondictionary patch rejected")
	check(not thermal.configure_rooms_batch({"a": {"typo": 1.0}}), "unknown room property rejected")
	check(not thermal.configure_rooms_batch({"a": {"oxygen": NAN}}), "nonfinite patch rejected")
	check(not thermal.configure_rooms_batch({"a": {"oxygen": true}}), "boolean numeric patch rejected")
	check(thermal.configure_rooms_batch({}) and thermal.checkpoint() == before, "empty batch is a no-op")
	check(thermal.configure_room(&"a", {"oxygen": 0.4}) and thermal.room_state(&"a").oxygen == 0.4,
		"single-room API still delegates successfully")
	print("GS_THERMAL_ROOM_BATCH passed=%d failed=%d" % [passed, failed])
	quit(1 if failed else 0)

func check(condition: bool, label: String) -> void:
	if condition: passed += 1
	else:
		failed += 1
		push_error(label)
