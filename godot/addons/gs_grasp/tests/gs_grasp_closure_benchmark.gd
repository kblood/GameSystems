extends SceneTree

const Closure = preload("res://addons/gs_grasp/gs_grasp_closure.gd")
const GoldenPath := "res://addons/gs_grasp/tests/grasp_close_to_contact.golden.json"
const SAMPLE_COUNT := 3

func _initialize() -> void:
	var doc: Variant = JSON.parse_string(FileAccess.get_file_as_string(GoldenPath))
	if not doc is Dictionary or not doc.get("cases") is Array:
		push_error("close-to-contact golden missing")
		quit(1)
		return
	for index: int in [0, 1]:
		var row: Dictionary = doc.cases[index]
		var expected_tries := int(row.expected.tried)
		var warm: Dictionary = Closure.close_to_contact(row.pose, row.hand, row.shape, row.options)
		if int(warm.tried) != expected_tries:
			push_error("benchmark fixture attempt count changed: %s" % row.name)
			quit(1)
			return
		var samples: Array[int] = []
		for _sample: int in SAMPLE_COUNT:
			var started := Time.get_ticks_usec()
			var result: Dictionary = Closure.close_to_contact(row.pose, row.hand, row.shape, row.options)
			samples.append(Time.get_ticks_usec() - started)
			if int(result.tried) != expected_tries:
				push_error("benchmark result changed: %s" % row.name)
				quit(1)
				return
		samples.sort()
		var total := 0
		for elapsed: int in samples:
			total += elapsed
		print("GS_GRASP_CLOSURE_BENCH name=%s tries=%d samples=%d avg_usec=%d max_usec=%d" % [
			row.name, expected_tries, SAMPLE_COUNT, roundi(float(total) / SAMPLE_COUNT), samples.back()])
	# The proposed adapter would keep native wrist placement fixed and retain
	# the authored thumb. Measure this bounded box-only fixture separately.
	var box_row: Dictionary = doc.cases[6]
	var fixed_options: Dictionary = box_row.options.duplicate(true)
	fixed_options["wrist"] = box_row.pose.wrist.duplicate()
	fixed_options["quat"] = box_row.pose.quat.duplicate()
	fixed_options["keep"] = ["Thumb"]
	var fixed_samples: Array[int] = []
	var fixed_warm: Dictionary = Closure.close_to_contact(box_row.pose, box_row.hand, box_row.shape, fixed_options)
	if int(fixed_warm.tried) != 1:
		push_error("fixed-wrist closure unexpectedly searched placement")
		quit(1)
		return
	for _sample: int in SAMPLE_COUNT:
		var started := Time.get_ticks_usec()
		var result: Dictionary = Closure.close_to_contact(box_row.pose, box_row.hand, box_row.shape, fixed_options)
		fixed_samples.append(Time.get_ticks_usec() - started)
		if int(result.tried) != 1:
			push_error("fixed-wrist closure unexpectedly searched placement")
			quit(1)
			return
	fixed_samples.sort()
	var fixed_total := 0
	for elapsed: int in fixed_samples:
		fixed_total += elapsed
	print("GS_GRASP_CLOSURE_BENCH mode=fixed_wrist_box_keep_thumb name=%s tries=1 samples=%d avg_usec=%d max_usec=%d" % [
		box_row.name, SAMPLE_COUNT, roundi(float(fixed_total) / SAMPLE_COUNT), fixed_samples.back()])
	quit(0)
