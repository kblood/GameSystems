extends SceneTree
## Structural catalog consumption only; SDF/collision algorithms are not ported here.

const Data = preload("res://addons/gs_grasp_data/gs_grasp_catalog_data.gd")
const GOLDEN_PATH := "res://addons/gs_grasp_data/data/catalog.golden.json"
var passed := 0
var failed := 0

func _initialize() -> void:
	var contract: Dictionary = Data.load_data()
	var golden: Variant = JSON.parse_string(FileAccess.get_file_as_string(GOLDEN_PATH))
	check(not contract.is_empty(), "shared catalog loads")
	check(golden is Dictionary and golden.get("schema") == "gamesystems.golden.grasp-catalog-data.v1", "JS export golden loads")
	if not contract.is_empty() and golden is Dictionary:
		check(contract == golden.get("contract"), "Godot reads exact JS catalog records")
		check(Data.validate(golden.get("contract")), "JS golden validates")
		for invalid: Variant in [null, [], 2, "data", {}, {"schema": Data.SCHEMA}]:
			check(not Data.validate(invalid), "invalid root rejected: %s" % str(invalid))
		var cases := [
			[["schema"], "gamesystems.grasp-catalog-data.v2", "unknown schema"],
			[["DEFAULT_MASS"], 0, "zero default mass"],
			[["DEFAULT_MASS"], INF, "infinite default mass"],
			[["CATALOG"], [], "catalog type"],
			[["CATALOG"], {}, "empty catalog"],
			[["CATALOG", "can"], [], "prop type"],
			[["CATALOG", "can", "label"], "", "empty label"],
			[["CATALOG", "can", "grip"], false, "grip type"],
			[["CATALOG", "can", "mass"], -1, "negative prop mass"],
			[["CATALOG", "can", "color"], 1.5, "fractional color"],
			[["CATALOG", "can", "color"], 0x1000000, "color over RGB range"],
			[["CATALOG", "can", "color"], -1, "negative color"],
			[["CATALOG", "bottle_beer", "breakable"], 1, "breakable type"],
			[["CATALOG", "bottle_beer", "fill"], 1.1, "fill over one"],
			[["CATALOG", "bottle_beer", "fill"], -0.1, "negative fill"],
			[["CATALOG", "bottle_beer", "fill"], NAN, "NaN fill"],
			[["CATALOG", "can", "shape"], null, "shape type"],
			[["CATALOG", "can", "shape", "type"], "sphere", "unknown shape type"],
			[["CATALOG", "can", "shape", "radius"], 0, "zero cylinder radius"],
			[["CATALOG", "can", "shape", "half"], -1, "negative cylinder half-height"],
			[["CATALOG", "can", "shape", "axis"], null, "null cylinder axis"],
			[["CATALOG", "can", "shape", "axis"], 2, "numeric cylinder axis"],
			[["CATALOG", "can", "shape", "axis"], "X", "uppercase cylinder axis"],
			[["CATALOG", "can", "shape", "axis"], "unknown", "unknown cylinder axis"],
			[["CATALOG", "can", "shape", "radius"], false, "boolean dimension"],
			[["CATALOG", "carton", "shape", "size"], [1, 2], "box dimension count"],
			[["CATALOG", "carton", "shape", "size"], [1, 0, 1], "zero box dimension"],
			[["CATALOG", "carton", "shape", "size"], [1, INF, 1], "infinite box dimension"],
			[["CATALOG", "bottle_beer", "shape", "profile"], [[0, 1]], "short lathe profile"],
			[["CATALOG", "bottle_beer", "shape", "profile"], [[0, 1], [0, 2]], "duplicate profile height"],
			[["CATALOG", "bottle_beer", "shape", "profile"], [[1, 1], [0, 2]], "decreasing profile height"],
			[["CATALOG", "bottle_beer", "shape", "profile"], [[0, 1], [1, -1]], "negative profile radius"],
			[["CATALOG", "bottle_beer", "shape", "profile"], [[0, 0], [1, 0]], "zero-volume lathe"],
			[["CATALOG", "bottle_beer", "shape", "profile"], [[0, 1], [INF, 1]], "infinite profile height"],
			[["CATALOG", "bottle_beer", "shape", "profile"], [[0, 1, 2], [1, 1]], "profile row count"],
			[["CATALOG", "mug", "shape", "parts"], [], "empty union"],
			[["CATALOG", "mug", "shape", "parts"], [null], "invalid union child"],
			[["CATALOG", "mug", "shape", "parts"], [{"type": "parts", "parts": [{"type": "box", "size": [1, 1, 1]}]}], "nested union unsupported by JS SDF"],
		]
		for case: Array in cases:
			var invalid := contract.duplicate(true)
			var parent: Dictionary = invalid
			var path: Array = case[0]
			for i: int in range(path.size() - 1):
				parent = parent[path[i]]
			parent[path[-1]] = case[1]
			check(not Data.validate(invalid), "rejects %s" % case[2])
		var malformed_offset := contract.duplicate(true)
		malformed_offset.CATALOG.mug.shape.parts[0].at = [0, "0", 0]
		check(not Data.validate(malformed_offset), "offset requires finite vector")
		var union_offset := contract.duplicate(true)
		union_offset.CATALOG.mug.shape["at"] = [1, 0, 0]
		check(not Data.validate(union_offset), "union offset unsupported by JS SDF")
		var missing := contract.duplicate(true)
		missing.CATALOG.can.erase("shape")
		check(not Data.validate(missing), "missing shape rejected")
		var typo := contract.duplicate(true)
		typo.CATALOG.can.shape["raduis"] = 1
		check(not Data.validate(typo), "unknown primitive field rejected")
		var tapered := contract.duplicate(true)
		tapered.CATALOG.bottle_beer.shape.profile = [[-1, 0], [0, 1], [1, 0]]
		check(Data.validate(tapered), "lathe tips may have zero radius and heights may be negative")
	print("GS_GRASP_CATALOG_DATA passed=%d failed=%d" % [passed, failed])
	quit(1 if failed else 0)

func check(condition: bool, label: String) -> void:
	if condition:
		passed += 1
	else:
		failed += 1
		print("FAIL ", label)
