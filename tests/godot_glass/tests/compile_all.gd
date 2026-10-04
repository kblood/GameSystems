extends SceneTree
## Loads every script / shader in res://glass to surface parse errors. Exit code 1 on failure.
func _init() -> void:
	var bad := 0
	for f in DirAccess.get_files_at("res://glass"):
		if f.ends_with(".gd") or f.ends_with(".gdshader"):
			var r = load("res://glass/" + f)
			if r == null or (r is GDScript and not (r as GDScript).can_instantiate()):
				print("COMPILE FAIL: ", f)
				bad += 1
	for f in ["res://main.gd", "res://tests/test_glass_model.gd"]:
		var s = load(f)
		if s == null or not (s as GDScript).can_instantiate():
			print("COMPILE FAIL: ", f)
			bad += 1
	print("COMPILE: %d failures" % bad)
	quit(1 if bad else 0)
