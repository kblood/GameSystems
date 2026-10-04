extends SceneTree
## Unit tests for the glass damage model, fracture patterns and mask painting.
## timeout 60 godot --headless --path tests/godot_glass --script res://tests/test_glass_model.gd

var fails := 0
var passes := 0


func check(cond: bool, what: String) -> void:
	if cond:
		passes += 1
	else:
		fails += 1
		print("FAIL: ", what)


func ctx() -> Dictionary:
	return {"d_edge": 0.5, "span": 0.5, "damage": 0.0, "near": 0.0, "flaw": 1.0, "normal": Vector3.BACK, "size_min": 1.0}


func out(p: GlassProfile, imp: GlassImpact, c := {}) -> Dictionary:
	var cc := ctx()
	cc.merge(c, true)
	return GlassDamageModel.assess(p, cc, imp)


func _init() -> void:
	var O := GlassDamageModel.Outcome
	var ann := GlassProfile.preset("annealed", 4.0)
	# stone 0.2 kg: 1 m/s nothing, 8 m/s breaks through
	check(out(ann, GlassImpact.from_preset("stone", 1.0))["outcome"] == O.NONE, "stone 1 m/s no damage")
	check(out(ann, GlassImpact.from_preset("stone", 8.0))["outcome"] >= O.PUNCHED, "stone 8 m/s breaks 4 mm annealed")
	# thicker is stronger, monotonic in speed
	var e4: float = GlassDamageModel.thresholds(ann, ctx(), GlassImpact.from_preset("stone"))["crack"]
	var e10: float = GlassDamageModel.thresholds(GlassProfile.preset("annealed", 10.0), ctx(), GlassImpact.from_preset("stone"))["crack"]
	check(e10 > e4 * 5.0, "10 mm needs > 5x the energy of 4 mm")
	var last := -1
	var mono := true
	for v in range(1, 30):
		var o: int = out(ann, GlassImpact.from_preset("brick", float(v)))["outcome"]
		mono = mono and o >= last
		last = o
	check(mono, "outcome monotonic in speed (brick)")
	# 9 mm pierces 4 mm annealed with a small hole, keeps most of its speed
	var b := GlassImpact.from_preset("9mm")
	var r := out(ann, b)
	check(r["outcome"] == O.PUNCHED and r["pass_through"], "9mm pierces annealed")
	check(float(r["hole_radius"]) < 0.008 and float(r["crack_length"]) > 0.03, "small hole + radial cracks")
	check((r["residual_velocity"] as Vector3).length() > 320.0, "bullet keeps speed")
	check(float(r["crater_exit"]) > float(r["crater_entry"]), "exit crater bigger than entry")
	# tempered: any bullet dices, edge hits weaker
	var tem := GlassProfile.preset("tempered", 5.0)
	check(out(tem, GlassImpact.from_preset("22lr"))["outcome"] == O.SHATTERED, "22lr dices tempered")
	var ec: float = GlassDamageModel.thresholds(tem, ctx(), GlassImpact.from_preset("stone"))["crack"]
	var ee: float = GlassDamageModel.thresholds(tem, {"d_edge": 0.005, "span": 0.3}, GlassImpact.from_preset("stone"))["crack"]
	check(ee < ec * 0.4, "tempered edge much weaker")
	check(out(tem, GlassImpact.from_preset("punch_tool"))["outcome"] == O.SHATTERED, "window punch tool dices tempered")
	check(out(tem, GlassImpact.from_preset("stone", 8.0))["outcome"] < O.CRACKED, "stone 8 m/s does not break tempered")
	# laminated: bullet pierces without dropping pieces, brick at 8 m/s cracks but stays
	var lam := GlassProfile.preset("laminated", 5.0)
	var rl := out(lam, GlassImpact.from_preset("9mm"))
	check(rl["outcome"] == O.PUNCHED and float(rl["drop_radius"]) == 0.0, "laminated bullet: hole, nothing drops")
	check(out(lam, GlassImpact.from_preset("brick", 8.0))["outcome"] == O.CRACKED, "laminated holds a brick at 8 m/s")
	check(out(lam, GlassImpact.from_preset("brick", 16.0))["pass_through"], "brick at 16 m/s punches laminated")
	# resistant stops 9mm several times, then fails
	var res := GlassProfile.preset("resistant", 30.0)
	var loc := 0.0
	var stopped := 0
	for i in 12:
		var rr := out(res, GlassImpact.from_preset("9mm"), {"local_damage": clampf(loc, 0.0, 1.0)})
		if rr["pass_through"]:
			break
		stopped += 1
		loc += float(rr["d_local"])
	check(stopped >= 4 and stopped <= 8, "resistant stops %d x 9mm (expected 4..8)" % stopped)
	# cumulative damage weakens
	var w0: float = GlassDamageModel.thresholds(ann, ctx(), GlassImpact.from_preset("stone"))["crack"]
	var w1: float = GlassDamageModel.thresholds(ann, {"damage": 0.6, "near": 0.8}, GlassImpact.from_preset("stone"))["crack"]
	check(w1 < w0 * 0.6, "damaged pane weaker")
	# grazing bullet ricochets on thick glass
	var g := GlassImpact.from_preset("22lr")
	g.velocity = Vector3(1, 0, -0.12).normalized() * 370.0
	check(out(GlassProfile.preset("annealed", 10.0), g)["ricochet"], "grazing bullet ricochets")
	# fracture: cells cover the pane
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	var half := Vector2(0.5, 0.6)
	var pat := GlassFracture.radial_pattern(Vector2(0.1, -0.2), half, rng, 10, 1.75)
	var cl := GlassFracture.cells_from_pattern(pat, half, rng)
	var A := 0.0
	for c in cl:
		A += float(c["area"])
	check(absf(A - 1.2) < 0.02, "cells cover the pane (%.3f m2 of 1.2)" % A)
	var dc := GlassFracture.dice_cells(half, 0.1, rng)
	A = 0.0
	for c in dc:
		A += float(c["area"])
	check(absf(A - 1.2) < 0.01, "dice cover the pane")
	# curved mapping round trip
	var k := Vector2(0.8, 0.2)
	var q := GlassFracture.surf(Vector2(0.4, -0.3), 0.0, k)
	check(GlassFracture.to_2d(q, k).distance_to(Vector2(0.4, -0.3)) < 1e-4, "curved surface inverse")
	# mask painting
	var m := GlassCrackMask.new()
	m.setup(Vector2(1, 1.2), 128.0, 1024, false)
	m.line(Vector2(-0.3, 0), Vector2(0.3, 0.1), 1.5, 1.0, 1.0, 0)
	var lit := 0
	for i in range(0, m.data.size(), 4):
		if m.data[i] > 100:
			lit += 1
	check(lit > 60 and lit < 400, "mask line (%d px)" % lit)
	# profile json round trip
	var d := ann.to_dict()
	var p2 := GlassProfile.new()
	p2.apply_dict(JSON.parse_string(JSON.stringify(d)))
	check(is_equal_approx(p2.crack_ref, ann.crack_ref) and p2.tint.is_equal_approx(ann.tint), "profile json round trip")
	# determinism
	var r1 := GlassDamageModel.assess(ann, ctx(), GlassImpact.from_preset("brick", 5.0))
	var r2 := GlassDamageModel.assess(ann, ctx(), GlassImpact.from_preset("brick", 5.0))
	check(r1["outcome"] == r2["outcome"] and r1["crack_length"] == r2["crack_length"], "deterministic")
	print("UNIT TESTS: %d passed, %d failed" % [passes, fails])
	quit(1 if fails > 0 else 0)
