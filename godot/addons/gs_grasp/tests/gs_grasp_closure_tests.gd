extends SceneTree

const Closure = preload("res://addons/gs_grasp/gs_grasp_closure.gd")
const GoldenPath := "res://addons/gs_grasp/tests/grasp_closure.golden.json"
const PlaceWristGoldenPath := "res://addons/gs_grasp/tests/grasp_place_wrist.golden.json"
const SegmentGapGoldenPath := "res://addons/gs_grasp/tests/grasp_segment_gaps.golden.json"
const ReferenceHandGoldenPath := "res://addons/gs_grasp_data/data/reference_hand.golden.json"
const ProfileGeometryGoldenPath := "res://addons/gs_grasp/tests/grasp_profile_geometry.golden.json"
const PlacePalmGoldenPath := "res://addons/gs_grasp/tests/grasp_place_palm.golden.json"
const CloseFingerGoldenPath := "res://addons/gs_grasp/tests/grasp_close_finger.golden.json"
const CloseAllGoldenPath := "res://addons/gs_grasp/tests/grasp_close_all.golden.json"
var passed := 0
var failed := 0

func check(ok: bool, label: String) -> void:
	if ok:
		passed += 1
	else:
		failed += 1
		push_error(label)

func compare(expected: Variant, actual: Variant, label: String) -> void:
	if expected is Dictionary:
		check(actual is Dictionary and actual.size() == expected.size(), label + " dictionary shape")
		if not actual is Dictionary:
			return
		for key: Variant in expected:
			check(actual.has(key), label + " missing " + str(key))
			if actual.has(key):
				compare(expected[key], actual[key], label + "." + str(key))
	elif expected is Array:
		check(actual is Array and actual.size() == expected.size(), label + " shape")
		if not actual is Array:
			return
		for index: int in range(mini(expected.size(), actual.size())):
			compare(expected[index], actual[index], label + "[%d]" % index)
	elif expected is float or expected is int:
		check((actual is float or actual is int) and absf(float(actual) - float(expected)) <= 1e-10 * maxf(1.0, absf(float(expected))), label + " numeric")
	else:
		check(expected == actual, label + " value")

func _initialize() -> void:
	var golden: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(GoldenPath))
	check(golden.get("schema") == "gamesystems.golden.grasp-finger-chain.v1", "golden schema")
	for row: Dictionary in golden.cases:
		var finger_before: Dictionary = row.finger.duplicate(true)
		var angles_before: Array = row.row.duplicate(true)
		compare(row.expected, Closure.finger_chain(row.finger, row.row), row.name)
		check(row.finger == finger_before, row.name + " finger model unchanged")
		check(row.row == angles_before, row.name + " row unchanged")
	var wrist_golden: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(PlaceWristGoldenPath))
	check(wrist_golden.get("schema") == "gamesystems.golden.grasp-place-wrist.v1", "place wrist golden schema")
	for row: Dictionary in wrist_golden.cases:
		var pose_before: Dictionary = row.pose.duplicate(true)
		compare(row.expected, Closure.place_wrist(row.pose, row.hand, row.reference), row.name)
		check(row.pose == pose_before, row.name + " pose unchanged")
	var gap_golden: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(SegmentGapGoldenPath))
	check(gap_golden.get("schema") == "gamesystems.golden.grasp-segment-gaps.v1", "segment gaps golden schema")
	var gap_cases := 0
	for row: Dictionary in gap_golden.cases:
		for finger_name: String in ["Thumb", "Index", "Middle", "Ring", "Little"]:
			var finger: Dictionary = row.hand.fingers[finger_name]
			var angles: Array = row.rows[["Thumb", "Index", "Middle", "Ring", "Little"].find(finger_name)]
			var chain: Array = Closure.finger_chain(finger, angles)
			var expected_segments: Array = row.expected[finger_name].segments
			compare(expected_segments, Closure.segment_gaps(chain, finger, row.shape, row.placed.wrist,
				row.placed.quat, float(row.hand.scale)), row.name + ":" + finger_name)
			for from_segment: int in [1, 2, 3]:
				var partial: Array = Closure.segment_gaps(chain, finger, row.shape, row.placed.wrist,
					row.placed.quat, float(row.hand.scale), from_segment)
				for segment: int in 3:
					if segment < from_segment:
						check(is_inf(float(partial[segment])), row.name + ":" + finger_name + " skipped segment")
					else:
						compare(expected_segments[segment], partial[segment], row.name + ":" + finger_name + " segment %d" % segment)
			gap_cases += 1
	var hand_golden: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(ReferenceHandGoldenPath))
	var hand_cases := 0
	for row: Dictionary in hand_golden.cases:
		var options: Dictionary = {"scale": hand_golden.contract.scale if row.scale == null else row.scale}
		var rest: Dictionary = hand_golden.contract.hands[row.side]
		compare(row.expected, Closure.hand_geometry(rest, options), "hand geometry " + row.side + " scale=" + str(options.scale))
		hand_cases += 1
	var profile_golden: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(ProfileGeometryGoldenPath))
	check(profile_golden.get("schema") == "gamesystems.golden.grasp-profile-geometry.v1", "profile geometry golden schema")
	for row: Dictionary in profile_golden.cases:
		var rest_before: Dictionary = row.rest.duplicate(true)
		var options_before: Dictionary = row.options.duplicate(true)
		compare(row.expected, Closure.hand_geometry(row.rest, row.options), row.name)
		check(row.rest == rest_before, row.name + " rest unchanged")
		check(row.options == options_before, row.name + " options unchanged")
		hand_cases += 1
	var palm_golden: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(PlacePalmGoldenPath))
	check(palm_golden.get("schema") == "gamesystems.golden.grasp-place-palm.v1", "place palm golden schema")
	for row: Dictionary in palm_golden.cases:
		var pose_before: Dictionary = row.pose.duplicate(true)
		var hand_before: Dictionary = row.hand.duplicate(true)
		var options_before: Dictionary = row.options.duplicate(true)
		var offset_before: Dictionary = row.offset.duplicate(true)
		var shape: Variant = row.shape
		var actual: Dictionary
		if row.get("default_thumb_row", false):
			actual = Closure.place_palm(row.pose, row.hand, shape, row.options, row.offset)
		else:
			actual = Closure.place_palm(row.pose, row.hand, shape, row.options, row.offset, row.thumb_row)
		compare(row.expected, actual, row.name)
		check(row.pose == pose_before, row.name + " pose unchanged")
		check(row.hand == hand_before, row.name + " hand unchanged")
		check(row.options == options_before, row.name + " options unchanged")
		check(row.offset == offset_before, row.name + " offset unchanged")
	var close_golden: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(CloseFingerGoldenPath))
	check(close_golden.get("schema") == "gamesystems.golden.grasp-close-finger.v1", "close finger golden schema")
	for row: Dictionary in close_golden.cases:
		var finger_before: Dictionary = row.finger.duplicate(true)
		var open_before: Array = row.open_row.duplicate(true)
		var closed_before: Array = row.closed_row.duplicate(true)
		var options_before: Dictionary = row.options.duplicate(true)
		var actual := Closure.close_finger(row.finger_name, row.finger, row.open_row, row.closed_row, row.shape,
			row.wrist, row.quat, float(row.scale), row.options)
		compare(row.expected, actual, row.name)
		check(row.finger == finger_before, row.name + " finger unchanged")
		check(row.open_row == open_before, row.name + " open row unchanged")
		check(row.closed_row == closed_before, row.name + " closed row unchanged")
		check(row.options == options_before, row.name + " options unchanged")
	var close_all_golden: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(CloseAllGoldenPath))
	check(close_all_golden.get("schema") == "gamesystems.golden.grasp-close-all.v1", "close all golden schema")
	for row: Dictionary in close_all_golden.cases:
		var hand_before: Dictionary = row.hand.duplicate(true)
		var open_before: Array = row.open_rows.duplicate(true)
		var closed_before: Array = row.closed_rows.duplicate(true)
		var options_before: Dictionary = row.options.duplicate(true)
		var actual := Closure.close_all(row.hand, row.open_rows, row.closed_rows, row.shape, row.wrist, row.quat,
			row.options, bool(row.wrap), row.keep)
		compare(row.expected, actual, row.name)
		check(row.hand == hand_before, row.name + " hand unchanged")
		check(row.open_rows == open_before, row.name + " open rows unchanged")
		check(row.closed_rows == closed_before, row.name + " closed rows unchanged")
		check(row.options == options_before, row.name + " options unchanged")
	print("GS_GRASP_CLOSURE_TESTS passed=%d failed=%d cases=%d finger_chain=%d place_wrist=%d segment_gap=%d hand_geometry=%d place_palm=%d close_finger=%d close_all=%d" % [passed, failed,
		golden.cases.size() + wrist_golden.cases.size() + gap_cases + hand_cases + palm_golden.cases.size() + close_golden.cases.size() + close_all_golden.cases.size(), golden.cases.size(), wrist_golden.cases.size(), gap_cases, hand_cases, palm_golden.cases.size(), close_golden.cases.size(), close_all_golden.cases.size()])
	quit(1 if failed else 0)
