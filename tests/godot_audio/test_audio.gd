extends SceneTree
## Headless test: godot --headless --path . --script res://test_audio.gd
var fails := 0

func check(cond: bool, msg: String) -> void:
	if not cond:
		fails += 1
		printerr("FAIL: ", msg)

func _initialize() -> void:
	var ba := BottleAudio.new()
	ba.max_voices = 6  # small pool to exercise stealing
	root.add_child(ba)
	await process_frame
	var expected := {}  # name -> min variants from catalog
	var cat = JSON.parse_string(FileAccess.get_file_as_string("res://audio/catalog.json"))
	check(cat is Dictionary, "catalog.json parse")
	for n in BottleAudio.all_sound_names():
		var v := ba.get_variants(n)
		var want: int = int(cat[n]["variants"]) if cat is Dictionary and cat.has(n) else 4
		check(v.size() == want, "%s: %d variants loaded, want %d" % [n, v.size(), want])
		for s in v:
			check(s is AudioStream and s.get_length() > 0.05, "%s invalid stream" % n)
	print("SOUNDS_LOADED ", BottleAudio.all_sound_names().size())
	var pos := Vector3(1, 1, -2)
	for kind in ["clink", "thud", "shatter", "splash", "cap_pop", "bullet_glass", "bullet_plastic", "shard_settle", "bubble_pop", "slosh", "dent"]:
		ba.stop_all()
		for e in [0.1, 0.5, 1.0, 1.8]:
			var p := ba.play_event(kind, pos, e)
			check(p != null, "%s e=%s returned null" % [kind, e])
			ba.stop_all()
		await process_frame
	# stealing: flood pool with 20 loud shatters, then a very quiet tick must be dropped, a loud one must steal
	for i in 20:
		ba.play_event("shatter", pos, 1.0)
	check(ba.play_event("shard_settle", pos, 0.1) == null, "quiet sound dropped when pool full of loud")
	check(ba.play_event("bullet_glass", pos, 1.5) != null, "loud sound steals a voice")
	ba.stop_all()
	for mat in ["plastic", "glass"]:
		check(ba.play_event("clink", pos, 0.8, {"material": mat}) != null, "clink " + mat)
		check(ba.play_event("thud", pos, 0.8, {"material": mat}) != null, "thud " + mat)
	for cap in ["cork", "crown", "screw", "clink"]:
		check(ba.play_event("cap_pop", pos, 1.0, {"cap": cap}) != null, "cap " + cap)
	# no-immediate-repeat
	var prev := ""
	var rep := 0
	for i in 40:
		ba.play_event("shard_settle", pos, 0.5)
		var nm = ba._last_idx.get("shard_settle", -1)
		if str(nm) == prev:
			rep += 1
		prev = str(nm)
	check(rep == 0, "immediate variant repeats: %d" % rep)
	# pool bound
	var playing := 0
	for c in ba.get_children():
		if c is AudioStreamPlayer3D and c.playing:
			playing += 1
	check(ba.get_child_count() <= 6 + ba.max_loops, "pool grew")
	# loops
	var bottle := Node.new()
	ba.play_event("pour_start", pos, 0.8, {"source": bottle, "fill": 0.4})
	ba.play_event("fizz_start", pos, 0.6, {"source": bottle})
	check(ba.is_loop_active("pour", bottle) and ba.is_loop_active("fizz", bottle), "loops active")
	for i in 20:
		ba.update_loop("pour", bottle, pos + Vector3(0, 0, i * 0.01), 0.5)
		await process_frame
	check(ba._loop_players.size() == 3, "3 loop players (pour, glug, fizz), got %d" % ba._loop_players.size())
	for k in ba._loop_players:
		var s = ba._loop_players[k].player.stream
		check(s is AudioStreamWAV and s.loop_mode == AudioStreamWAV.LOOP_FORWARD and s.loop_end > 1000, "loop meta " + k)
	ba.play_event("pour_stop", pos, 0.0, {"source": bottle})
	ba.play_event("fizz_loop", pos, 0.0, {"source": bottle})
	check(not ba.is_loop_active("pour", bottle), "pour stopped")
	for i in 150:
		await process_frame
	check(not ba._loop_players.has("pour:" + str(bottle)), "pour loop freed after fade")
	ba.play_event("nonsense_kind", pos)  # warns only
	await create_timer(0.3).timeout
	ba.stop_all()
	print("TEST_RESULT ", "PASS" if fails == 0 else "FAIL(%d)" % fails)
	quit(0 if fails == 0 else 1)
