extends SceneTree
# godot --headless --path tests/containers_godot -s test.gd   (run.ps1 copies liquid_lut_v2.gd + the cases json next to it)
func _init() -> void:
	var cases: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://containers_lut_cases.json"))
	var worst := 0.0
	var worst_f := 0.0
	var bad := 0
	var n := 0
	for name in cases:
		var c: Dictionary = cases[name]
		var info: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://" + String(c["file"]).get_file()))
		var lut := LiquidLutV2.from_info(info)
		for i in c["up"].size():
			var u: Array = c["up"][i]
			var up := Vector3(u[0], u[1], u[2])
			worst = maxf(worst, absf(lut.offset(up, c["fill"][i]) - float(c["d"][i])))
			worst_f = maxf(worst_f, absf(lut.fill_at(up, c["d_probe"][i]) - float(c["fill_at_expected"][i])))
			if c.has("spill"):
				var s := lut.spill(up, c["fill"][i])
				if s["spilled"] != c["spill"][i][0] or absf(s["fill"] - float(c["spill"][i][1])) > 1e-4:
					bad += 1
			n += 1
	var t0 := Time.get_ticks_usec()
	var lut2 := LiquidLutV2.from_info(JSON.parse_string(FileAccess.get_file_as_string("res://container_tank.liquid.json")))
	var t1 := Time.get_ticks_usec()
	var acc := 0.0
	for i in 20000:
		acc += lut2.offset(Vector3(sin(i * 0.37), cos(i * 0.11), 0.3), (i % 100) / 100.0)
	var t2 := Time.get_ticks_usec()
	print("GD cases=%d max|d err|=%s m max|fill_at err|=%s spill mismatches=%d decode=%.1fms offset=%.2fus/call" % [n, str(worst), str(worst_f), bad, (t1 - t0) / 1000.0, (t2 - t1) / 20000.0])
	quit(0 if worst < 2e-5 and worst_f < 2e-3 and bad == 0 else 1)
