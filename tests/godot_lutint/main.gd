extends Node3D
## LUT-integration test. godot --path . -- <asset> --shots <outdir>
## Loads res://<asset>.glb, calls BottleLiquid.setup() WITHOUT a sidecar (auto data loading), renders tilt 0/90/180,
## prints the plane offsets as LUTINT json lines, and checks the sleep behaviour.

var holder: Node3D
var cam: Camera3D
var model: Node3D
var ctl: BottleLiquid
var asset := "bottle_wine"
var out := ""


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		asset = args[0]
	var si := args.find("--shots")
	if si >= 0:
		out = args[si + 1]
	get_window().size = Vector2i(420, 560)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.17, 0.2, 0.24)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.6, 0.65, 0.7)
	env.ambient_light_energy = 0.8
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, 30, 0)
	sun.light_energy = 1.4
	add_child(sun)
	cam = Camera3D.new()
	add_child(cam)
	cam.position = Vector3(0, 0, 0.85)
	cam.fov = 32
	cam.current = true
	holder = Node3D.new()
	add_child(holder)
	model = (load("res://%s.glb" % asset) as PackedScene).instantiate()
	holder.add_child(model)
	ctl = BottleLiquid.new()
	holder.add_child(ctl)
	ctl.setup(model, 0.6)
	var aabb := AABB()
	var first := true
	for m in model.find_children("*", "MeshInstance3D", true, false):
		var a := (m as MeshInstance3D).get_aabb()
		aabb = a if first else aabb.merge(a)
		first = false
	model.position = -aabb.get_center()
	cam.position.z = maxf(0.6, aabb.size.length() * 1.6)
	var src := "?"
	print("LUTINT asset=%s lut_version=%d open=%s sleeping=%s" % [asset, ctl.lut.version, ctl.is_open(), ctl.is_sleeping()])
	ctl.auto_lod = false
	ctl.slosh = true
	var res := []
	for pose in [[0, 0.25], [0, 0.6], [0, 0.9], [90, 0.6], [180, 0.6], [90, 0.25]]:
		holder.basis = Basis(Vector3(0, 0, 1), deg_to_rad(pose[0]))
		ctl.fill = pose[1]
		for i in 240:
			await get_tree().process_frame
		var pl: Vector4 = ctl._mat.get_shader_parameter("plane")
		res.append({"tilt": pose[0], "fill": pose[1], "up": [pl.x, pl.y, pl.z], "d": pl.w,
			"spilled": ctl.last_spill["spilled"], "lost": ctl.last_spill["lost"], "sleeping": ctl.is_sleeping()})
		if out != "":
			DirAccess.make_dir_recursive_absolute(out)
			get_viewport().get_texture().get_image().save_png("%s/%s_t%d_f%d.png" % [out, asset, pose[0], int(pose[1] * 100)])
	print("LUTINT_JSON ", JSON.stringify({"asset": asset, "poses": res}))
	# wake test: move the holder, must wake, then sleep again
	holder.basis = Basis.IDENTITY
	for i in 240:
		await get_tree().process_frame
	var s0 := ctl.is_sleeping()
	holder.position.x += 0.05
	await get_tree().create_timer(0.3).timeout
	var woke := absf(ctl._last_pos.x - ctl.liquid.global_position.x) < 1e-6 and absf(holder.position.x) > 0.04 and ctl._last_pos.distance_to(ctl.liquid.global_position) < 1e-6
	for i in 400:
		await get_tree().process_frame
	print("LUTINT sleep: asleep_at_rest=%s woke_on_move=%s asleep_again=%s" % [s0, woke, ctl.is_sleeping()])
	ctl.fill = 0.3
	var w2 := not ctl.is_sleeping()
	print("LUTINT fill_wake=%s" % w2)
	print("SHOTS done")
	get_tree().quit()
