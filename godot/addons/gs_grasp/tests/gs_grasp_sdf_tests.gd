extends SceneTree

const Sdf = preload("res://addons/gs_grasp/gs_grasp_shape_sdf.gd")
const CatalogData = preload("res://addons/gs_grasp_data/gs_grasp_catalog_data.gd")
const Closure = preload("res://addons/gs_grasp/gs_grasp_closure.gd")
const GoldenPath := "res://addons/gs_grasp/tests/grasp_sdf.golden.json"
var passed := 0
var failed := 0

func check(ok: bool, label: String) -> void:
	if ok:
		passed += 1
	else:
		failed += 1
		push_error(label)

func _initialize() -> void:
	var golden: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(GoldenPath))
	var catalog: Dictionary = CatalogData.load_data()
	check(golden.schema == "gamesystems.golden.grasp-sdf.v1", "golden schema")
	check(not catalog.is_empty(), "catalog data loads")
	for row: Dictionary in golden.cases:
		var shape: Dictionary = row.shape if row.has("shape") else catalog.CATALOG[row.kind].shape
		var point: Array = row.point
		var shape_before: Dictionary = shape.duplicate(true)
		var point_before: Array = point.duplicate(true)
		var distance: Variant = Sdf.signed_distance(shape, point)
		check(distance is float or distance is int, row.name + " signed distance type")
		if distance is float or distance is int:
			check(absf(float(distance) - float(row.distance)) <= 1e-10, row.name + " signed distance")
			check(Sdf.signed_distance(shape, point) == distance, row.name + " deterministic distance")
			check(Sdf._signed_distance_validated(shape, point) == distance, row.name + " validated batch distance parity")
		check(shape == shape_before, row.name + " shape unchanged")
		check(point == point_before, row.name + " point unchanged")
		var normal: Variant = Sdf.surface_normal(shape, point)
		check(normal is Array and normal.size() == 3, row.name + " normal shape")
		if normal is Array and normal.size() == 3:
			for axis: int in 3:
				check(absf(float(normal[axis]) - float(row.normal[axis])) <= 1e-7, row.name + " normal[%d]" % axis)
	check(Sdf.signed_distance({"type":"unknown"}, [0.0, 0.0, 0.0]) == null, "unknown shape rejected")
	check(Sdf.signed_distance(catalog.CATALOG.values()[0].shape, [NAN, 0.0, 0.0]) == null, "nonfinite point rejected")
	check(Sdf.signed_distance(catalog.CATALOG.values()[0].shape, [0.0, NAN]) == null, "short point rejected")
	check(Sdf.signed_distance(catalog.CATALOG.values()[0].shape, [0.0, "bad", 0.0]) == null, "nonnumeric point rejected")
	check(Sdf.signed_distance({"type":"box","at":[0.0,0.0,0.0],"size":[0.0,1.0,1.0]}, [0.0,0.0,0.0]) == null, "malformed public shape rejected")
	check(Sdf._signed_distance_validated(catalog.CATALOG.values()[0].shape, [0.0, NAN, 0.0]) == null, "validated batch path retains per-point validation")
	if not golden.cases.is_empty():
		var gap_case: Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://addons/gs_grasp/tests/grasp_segment_gaps.golden.json")).cases[0]
		var finger: Dictionary=gap_case.hand.fingers.Thumb
		var row: Array=gap_case.rows[0]
		var chain: Array=Closure.finger_chain(finger,row)
		var bad_gaps: Array=Closure.segment_gaps(chain,finger,{"type":"malformed"},gap_case.placed.wrist,gap_case.placed.quat,float(gap_case.hand.scale))
		check(bad_gaps.size()==3 and bad_gaps.all(func(gap):return is_inf(float(gap))), "closure batch rejects malformed public shape")
		var minimal_hand := {"scale":1.0,"palm":{"samples":[[0.0,0.0,0.0]]},
			"thenar":{"points":[],"a":[0.0,0.0,0.0],"b":[0.0,0.0,0.0],"radius":0.005}}
		var bad_palm: Dictionary=Closure._palm_gaps(minimal_hand,[0.0,0.0,0.0],[0.0,0.0,0.0,1.0],{"type":"malformed"},null)
		check(is_inf(float(bad_palm.palm)) and is_inf(float(bad_palm.thenar)), "palm batch rejects malformed public shape")
	check(Sdf.surface_normal(catalog.CATALOG.values()[0].shape, [0.0, 0.0, 0.0], 0.0) == null, "invalid normal step rejected")
	for axis: String in ["x", "y", "z"]:
		var axial := [0.0, 0.0, 0.0]
		var radial := [0.0, 0.0, 0.0]
		var outside_radial := [0.0, 0.0, 0.0]
		var outside_axial := [0.0, 0.0, 0.0]
		var axis_index: int = {"x": 0, "y": 1, "z": 2}[axis]
		var radial_index: int = {"x": 1, "y": 0, "z": 0}[axis]
		var offset := [0.13, -0.27, 0.41]
		axial[axis_index] = 0.2; radial[radial_index] = 0.5
		outside_radial[radial_index] = 0.7; outside_axial[axis_index] = 1.2
		var shape := {"type": "cylinder", "radius": 0.5, "half": 1.0, "at": offset, "axis": axis}
		check(CatalogData.validate_shape(shape), axis + " cylinder validates")
		check(absf(float(Sdf.signed_distance(shape, _vadd(offset, axial))) + 0.5) < 1e-12, axis + " cylinder interior distance")
		check(absf(float(Sdf.signed_distance(shape, _vadd(offset, radial)))) < 1e-12, axis + " cylinder side distance")
		check(absf(float(Sdf.signed_distance(shape, _vadd(offset, outside_radial))) - 0.2) < 1e-12, axis + " cylinder radial outside distance")
		check(absf(float(Sdf.signed_distance(shape, _vadd(offset, outside_axial))) - 0.2) < 1e-12, axis + " cylinder axial outside distance")
		var radial_normal: Variant = Sdf.surface_normal(shape, _vadd(offset, outside_radial))
		var expected_normal := [0.0, 0.0, 0.0]; expected_normal[radial_index] = 1.0
		check(radial_normal is Array and Vector3(radial_normal[0], radial_normal[1], radial_normal[2]).distance_to(Vector3(expected_normal[0], expected_normal[1], expected_normal[2])) < 1e-7, axis + " cylinder radial normal")
		var axial_normal: Variant = Sdf.surface_normal(shape, _vadd(offset, outside_axial))
		var expected_axial := [0.0, 0.0, 0.0]; expected_axial[axis_index] = 1.0
		check(axial_normal is Array and Vector3(axial_normal[0], axial_normal[1], axial_normal[2]).distance_to(Vector3(expected_axial[0], expected_axial[1], expected_axial[2])) < 1e-7, axis + " cylinder axial normal")
	var default_y := {"type": "cylinder", "radius": 0.4, "half": 0.8, "at": [0.1, 0.2, 0.3]}
	var explicit_y := default_y.duplicate(true); explicit_y.axis = "y"
	for point: Array in [[0.0, 0.0, 0.0], [0.2, 0.1, -0.1], [0.4, 1.0, 0.3], [-0.1, -0.8, 0.3]]:
		check(Sdf.signed_distance(default_y, point) == Sdf.signed_distance(explicit_y, point), "default Y equals explicit Y distance")
		check(Sdf.surface_normal(default_y, point) == Sdf.surface_normal(explicit_y, point), "default Y equals explicit Y normal")
	for bad_axis: Variant in [null, 2, "X", "unknown", []]:
		var malformed := default_y.duplicate(true); malformed.axis = bad_axis
		check(not CatalogData.validate_shape(malformed) and Sdf.signed_distance(malformed, [0.0, 0.0, 0.0]) == null, "malformed cylinder axis rejected: " + str(bad_axis))
	var parts := {"type": "parts", "parts": [{"type": "cylinder", "axis": "z", "radius": 0.5, "half": 1.0, "at": [0.2, 0.1, -0.3]}, {"type": "box", "size": [0.2, 0.2, 0.2], "at": [2.0, 0.0, 0.0]}]}
	check(absf(float(Sdf.signed_distance(parts, [0.4, 0.1, -0.1])) + 0.3) < 1e-12, "offset z cylinder part distances in translated coordinates")
	var fresh_fixture := ""
	for arg: String in OS.get_cmdline_user_args():
		if arg.begins_with("--fresh-sdf-fixture="): fresh_fixture = arg.trim_prefix("--fresh-sdf-fixture=")
	if not fresh_fixture.is_empty():
		var fresh: Variant = JSON.parse_string(FileAccess.get_file_as_string(fresh_fixture))
		check(fresh is Dictionary and fresh.get("cases") is Array and fresh.cases.size() == 115, "fresh JS SDF fixture has expected 115 cases")
		if fresh is Dictionary and fresh.get("cases") is Array:
			for row: Dictionary in fresh.cases:
				var shape: Dictionary = row.shape if row.has("shape") else catalog.CATALOG[row.kind].shape
				var distance: Variant = Sdf.signed_distance(shape, row.point)
				check(distance is float or distance is int, "fresh JS " + row.name + " distance type")
				if distance is float or distance is int:
					check(absf(float(distance) - float(row.distance)) <= 1e-10, "fresh JS " + row.name + " distance")
				var normal: Variant = Sdf.surface_normal(shape, row.point)
				check(normal is Array and normal.size() == 3, "fresh JS " + row.name + " normal type")
				if normal is Array and normal.size() == 3:
					for axis: int in 3:
						check(absf(float(normal[axis]) - float(row.normal[axis])) <= 1e-7, "fresh JS " + row.name + " normal[%d]" % axis)
		check(fresh is Dictionary and fresh.get("axis_cases") is Array and fresh.axis_cases.size() == 22, "fresh JS axis fixture has 22 cylinder/parts probes")
		if fresh is Dictionary and fresh.get("axis_cases") is Array:
			for row: Dictionary in fresh.axis_cases:
				var distance: Variant = Sdf.signed_distance(row.shape, row.point)
				check(distance is float or distance is int, "fresh JS " + row.name + " distance type")
				if distance is float or distance is int:
					check(absf(float(distance) - float(row.distance)) <= 1e-10, "fresh JS " + row.name + " distance")
				var normal: Variant = Sdf.surface_normal(row.shape, row.point)
				check(normal is Array and normal.size() == 3, "fresh JS " + row.name + " normal type")
				if normal is Array and normal.size() == 3:
					for axis: int in 3:
						check(absf(float(normal[axis]) - float(row.normal[axis])) <= 1e-7, "fresh JS " + row.name + " normal[%d]" % axis)
		check(Sdf.surface_normal({"type": "cylinder", "axis": "X", "radius": 0.5, "half": 1.0}, [0.0, 0.0, 0.0]) == null, "malformed cylinder axis rejected by public normal")
		check(Sdf.surface_normal({"type": "cylinder", "axis": "z", "radius": 0.5, "half": 1.0}, [NAN, 0.0, 0.0]) == null, "nonfinite normal point rejected")
	print("GS_GRASP_SDF_TESTS passed=%d failed=%d cases=%d" % [passed, failed, golden.cases.size()])
	quit(1 if failed else 0)

func _vadd(a: Array, b: Array) -> Array:
	return [float(a[0]) + float(b[0]), float(a[1]) + float(b[1]), float(a[2]) + float(b[2])]
