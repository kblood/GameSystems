extends SceneTree

const Sdf = preload("res://addons/gs_grasp/gs_grasp_shape_sdf.gd")
const CatalogData = preload("res://addons/gs_grasp_data/gs_grasp_catalog_data.gd")
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
		var distance: Variant = Sdf.signed_distance(shape, point)
		check(distance is float or distance is int, row.name + " signed distance type")
		if distance is float or distance is int:
			check(absf(float(distance) - float(row.distance)) <= 1e-10, row.name + " signed distance")
		var normal: Variant = Sdf.surface_normal(shape, point)
		check(normal is Array and normal.size() == 3, row.name + " normal shape")
		if normal is Array and normal.size() == 3:
			for axis: int in 3:
				check(absf(float(normal[axis]) - float(row.normal[axis])) <= 1e-7, row.name + " normal[%d]" % axis)
	check(Sdf.signed_distance({"type":"unknown"}, [0.0, 0.0, 0.0]) == null, "unknown shape rejected")
	check(Sdf.signed_distance(catalog.CATALOG.values()[0].shape, [NAN, 0.0, 0.0]) == null, "nonfinite point rejected")
	check(Sdf.surface_normal(catalog.CATALOG.values()[0].shape, [0.0, 0.0, 0.0], 0.0) == null, "invalid normal step rejected")
	print("GS_GRASP_SDF_TESTS passed=%d failed=%d cases=%d" % [passed, failed, golden.cases.size()])
	quit(1 if failed else 0)
