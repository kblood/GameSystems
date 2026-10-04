extends Node3D
## Breakage v2 test.  godot --headless --path tests/breakv2_proj res://test_break.tscn            -> drop matrix
##                    godot --path tests/breakv2_proj res://test_break.tscn -- --shots <dir>       -> screenshots
const V2 := ["apothecary", "bordeaux", "burgundy", "champagne", "contour", "cruet", "decanter", "erlenmeyer", "growler",
	"longneck", "mason", "milk", "perfume", "pet2l", "pet500", "roundflask", "spirit", "stubby", "swingtop", "whisky"]
const CONT := ["square", "hipflask", "tumbler", "tank", "mug", "jerrycan"]
var res := {}
var cam: Camera3D


func _ready() -> void:
	var fl := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	var bx := BoxShape3D.new()
	bx.size = Vector3(80, 1, 20)
	cs.shape = bx
	cs.position.y = -0.5
	fl.add_child(cs)
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = bx.size
	mi.mesh = bm
	mi.position.y = -0.5
	var fm := StandardMaterial3D.new()
	fm.albedo_color = Color(0.42, 0.42, 0.40)
	fm.roughness = 0.9
	mi.material_override = fm
	fl.add_child(mi)
	fl.collision_layer = 1
	add_child(fl)
	var args := OS.get_cmdline_user_args()
	if "--shots" in args:
		await _shots(args[args.find("--shots") + 1])
	else:
		await _drops(args[args.find("--only") + 1] if "--only" in args else "")
	get_tree().quit()


func spawn(id: String, pos: Vector3, rot: Vector3, fill := 1.0) -> BreakableBottle:
	var b: BreakableBottle
	if id.begins_with("container_"):
		# containers driven by BreakableBottle directly (BottleFactory still returns BottleProp; see handoff)
		b = BreakableBottle.new()
		b.bottle_name = id.trim_prefix("container_")
		b.asset_dir = "res://assets/container/"
		b.fill = fill
		b.rng_seed = 7
		b.bottle_layer = 8
		b.bottle_mask = 1 | 2 | 8
		b._build()
		b.position = pos
		b.rotation_degrees = rot
		add_child(b)
		AudioHub.watch(b)
	else:
		b = BottleFactory.spawn(id, {"fill": fill, "position": pos, "rotation_degrees": rot, "seed": 7}) as BreakableBottle
		add_child(b)
	var key := "%s@%s" % [id, pos]
	res[key] = {"broke": "", "leak": false, "max_ratio": 0.0}
	b.broke.connect(func(_p, _e, k): res[key]["broke"] = String(k))
	b.leaked.connect(func(_p): res[key]["leak"] = true)
	b.impact_assessed.connect(func(i): res[key]["max_ratio"] = maxf(res[key]["max_ratio"], float(i.get("ratio", 0.0))))
	b.set_meta("key", key)
	b.debug_contacts = "--only" in OS.get_cmdline_user_args() and pos.z > 1.0
	return b


func _ids() -> Array:
	var ids := []
	for n in V2:
		ids.append("bottle_v2_" + n)
	for n in CONT:
		ids.append("container_" + n)
	ids.append("bottle_whiskey")
	ids.append("bottle_wine")
	return ids


func _drops(only := "") -> void:
	var ids := _ids() if only == "" else [only]
	var rows := {}
	for i in ids.size():
		var id: String = ids[i]
		var x := (i - ids.size() * 0.5) * 1.2
		var b := spawn(id, Vector3(x, 2.0, -6), Vector3(84, 0, 0))
		var s1 := spawn(id, Vector3(x, 0.3, 0), Vector3.ZERO)
		var s2 := spawn(id, Vector3(x, 0.38, 6), Vector3(84, 0, 0))
		var p := b.profile
		var nm: String = b.bottle_name
		var dir: String = b.asset_dir
		var sh := BottleShardSource.real_shards(nm, dir).size() if BottleShardSource.has_real_shards(nm, dir) else 0
		var br := BottleShardSource.real_broken(nm, dir) if BottleShardSource.has_real_broken(nm, dir) else {}
		rows[id] = {"keys": [b.get_meta("key"), s1.get_meta("key"), s2.get_meta("key")],
			"vcrit": p.critical_speed("concrete", 1.0, 0.5 * (p.base_z + p.body_z)), "mass": p.total_mass(1.0),
			"mat": p.material, "shat": p.shatters, "shards": sh, "broken": br.has("body") and br.has("neck"),
			"lutv2": b.lut.v2 != null, "audio": b.has_meta("_audio_watched")}
	for i in 240:
		await get_tree().physics_frame
	var fails := 0
	for id in ids:
		var r: Dictionary = rows[id]
		var h: Dictionary = res[r["keys"][0]]
		var a: Dictionary = res[r["keys"][1]]
		var c: Dictionary = res[r["keys"][2]]
		var hard_ok: bool = h["broke"] != "" or h["leak"]
		var soft_ok: bool = a["broke"] == "" and not a["leak"] and c["broke"] == "" and not c["leak"]
		var shard_ok: bool = (not r["shat"]) or r["shards"] > 0
		var ok := hard_ok and soft_ok and shard_ok
		fails += 0 if ok else 1
		print("%s %-24s %-8s vcrit=%5.2f m=%.2fkg hard2m=%-10s r=%.2f | soft0.3 up r=%.2f side r=%.2f | shards=%d broken=%s lutv2=%s audio=%s" % [
			"PASS" if ok else "FAIL", id, r["mat"], r["vcrit"], r["mass"], (h["broke"] if h["broke"] != "" else ("leak" if h["leak"] else "none")),
			h["max_ratio"], a["max_ratio"], c["max_ratio"], r["shards"], r["broken"], r["lutv2"], r["audio"]])
	print("BREAKV2 RESULT fails=%d of %d" % [fails, ids.size()])


func _env() -> void:
	var we := WorldEnvironment.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.55, 0.62, 0.7)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.7, 0.72, 0.75)
	env.ambient_light_energy = 0.6
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, 30, 0)
	sun.shadow_enabled = true
	add_child(sun)
	cam = Camera3D.new()
	cam.fov = 50
	add_child(cam)


func _shot(id: String, path: String, rot: Vector3, height: float, after_s: float, cam_off: Vector3, x: float) -> void:
	var b := spawn(id, Vector3(x, height, 0), rot)
	var key: String = b.get_meta("key")
	cam.position = Vector3(x, 0, 0) + cam_off
	cam.look_at(Vector3(x, 0.06, 0))
	var t := 0
	while res[key]["broke"] == "" and not res[key]["leak"] and t < 240:
		await get_tree().physics_frame
		t += 1
	await get_tree().create_timer(after_s).timeout
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(path)
	print("SHOT %s %s broke=%s leak=%s" % [path, id, res[key]["broke"], res[key]["leak"]])


func _shots(dir: String) -> void:
	DirAccess.make_dir_recursive_absolute(dir)
	_env()
	await get_tree().create_timer(0.3).timeout
	await _shot("bottle_v2_bordeaux", dir + "/01_v2_bordeaux_shatter.png", Vector3(84, 0, 0), 2.0, 0.07, Vector3(0.5, 0.35, 0.8), 0.0)
	await _shot("container_tumbler", dir + "/02_tumbler_shatter.png", Vector3(70, 0, 0), 2.0, 0.07, Vector3(0.45, 0.3, 0.7), 10.0)
	await _shot("container_mug", dir + "/03_mug_leak.png", Vector3.ZERO, 2.0, 1.2, Vector3(0.35, 0.22, 0.5), 20.0)
	await _shot("bottle_whiskey", dir + "/04_whiskey_shatter.png", Vector3(84, 0, 0), 2.0, 0.07, Vector3(0.5, 0.35, 0.8), 30.0)
	await _shot("container_square", dir + "/05_square_shatter.png", Vector3(84, 0, 0), 2.0, 0.12, Vector3(0.6, 0.5, 0.9), -12.0)
