extends Node3D
## Interactive bottle-liquid test (no VR).
##   godot --path . [-- <bottle> --shots <outdir>]     (--shots = render poses to PNG and quit)
## Mouse: left-drag rotate | right-drag move (liquid sloshes) | wheel zoom.  Keys: 1-6 bottle, 0/9/8 upright/side/upside down,
## Up/Down fill, Space shake, S slosh on/off, Esc quit.

const BOTTLES := ["wine", "beer", "soda", "whiskey", "jar", "flask"]

var holder: Node3D
var cam: Camera3D
var model: Node3D
var ctl: BottleLiquid
var current := "flask"
var label: Label
var fill_slider: HSlider
var shake_t := 0.0
var _rot := Basis.IDENTITY


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	var shots_dir := ""
	if args.size() > 0 and args[0] in BOTTLES:
		current = args[0]
	var si := args.find("--shots")
	if si >= 0 and args.size() > si + 1:
		shots_dir = args[si + 1]
	get_window().size = Vector2i(900, 700)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.17, 0.2, 0.24)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.6, 0.65, 0.7)
	env.ambient_light_energy = 0.8
	var we := WorldEnvironment.new(); we.environment = env; add_child(we)
	var sun := DirectionalLight3D.new(); sun.rotation_degrees = Vector3(-50, 30, 0); sun.light_energy = 1.4; add_child(sun)
	cam = Camera3D.new(); add_child(cam); cam.position = Vector3(0, 0, 0.85); cam.fov = 32; cam.current = true
	holder = Node3D.new(); add_child(holder)
	_load(current)
	var qi := args.find("--quality")
	if qi >= 0 and args.size() > qi + 1:
		ctl.quality = int(args[qi + 1])
	if shots_dir != "":
		ctl.auto_lod = false
		if args.has("--tiers"):
			await _tiers(shots_dir)
		else:
			await _shots(shots_dir)
		return
	_build_ui()


func _load(name: String) -> void:
	current = name
	if model:
		model.queue_free()
		ctl.queue_free()
	model = (load("res://bottle_%s.glb" % name) as PackedScene).instantiate()
	holder.add_child(model)
	ctl = BottleLiquid.new()
	holder.add_child(ctl)
	ctl.setup(model, fill_slider.value if fill_slider else 0.6, "res://bottle_%s.liquid.json" % name)
	var aabb := AABB()
	var first := true
	for m in model.find_children("*", "MeshInstance3D", true, false):
		var a := (m as MeshInstance3D).get_aabb()
		aabb = a if first else aabb.merge(a)
		first = false
	model.position = -aabb.get_center()


func _build_ui() -> void:
	var layer := CanvasLayer.new(); add_child(layer)
	var box := VBoxContainer.new(); box.position = Vector2(12, 10); layer.add_child(box)
	label = Label.new(); box.add_child(label)
	var row := HBoxContainer.new(); box.add_child(row)
	for b in BOTTLES:
		var btn := Button.new(); btn.text = b; btn.focus_mode = Control.FOCUS_NONE
		btn.pressed.connect(_load.bind(b)); row.add_child(btn)
	var row2 := HBoxContainer.new(); box.add_child(row2)
	for p in [["Upright", 0.0], ["Side", 90.0], ["Upside down", 180.0], ["45°", 45.0]]:
		var btn := Button.new(); btn.text = p[0]; btn.focus_mode = Control.FOCUS_NONE
		btn.pressed.connect(_set_tilt.bind(p[1])); row2.add_child(btn)
	var shake := Button.new(); shake.text = "Shake"; shake.focus_mode = Control.FOCUS_NONE
	shake.pressed.connect(func(): shake_t = 0.8); row2.add_child(shake)
	var sl := CheckButton.new(); sl.text = "Slosh"; sl.button_pressed = true; sl.focus_mode = Control.FOCUS_NONE
	sl.toggled.connect(func(on): ctl.slosh = on); row2.add_child(sl)
	var bb := CheckButton.new(); bb.text = "Bubbles"; bb.button_pressed = true; bb.focus_mode = Control.FOCUS_NONE
	bb.toggled.connect(func(on): ctl.bubbles = 1.0 if on else 0.0); row2.add_child(bb)
	var frow := HBoxContainer.new(); box.add_child(frow)
	var fl := Label.new(); fl.text = "Fill"; frow.add_child(fl)
	fill_slider = HSlider.new(); fill_slider.min_value = 0.0; fill_slider.max_value = 1.0; fill_slider.step = 0.01
	fill_slider.value = 0.6; fill_slider.custom_minimum_size = Vector2(260, 20); fill_slider.focus_mode = Control.FOCUS_NONE
	fill_slider.value_changed.connect(func(v): ctl.fill = v); frow.add_child(fill_slider)


func _set_tilt(deg: float) -> void:
	_rot = Basis(Vector3(0, 0, 1), deg_to_rad(deg))


func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventMouseMotion:
		var m := e as InputEventMouseMotion
		if m.button_mask & MOUSE_BUTTON_MASK_LEFT:
			_rot = (Basis(Vector3.UP, m.relative.x * 0.01) * Basis(Vector3.RIGHT, m.relative.y * 0.01) * _rot).orthonormalized()
		elif m.button_mask & MOUSE_BUTTON_MASK_RIGHT:
			holder.position += Vector3(m.relative.x, -m.relative.y, 0) * 0.0016
	elif e is InputEventMouseButton and e.pressed:
		if e.button_index == MOUSE_BUTTON_WHEEL_UP:
			cam.position.z = clampf(cam.position.z - 0.05, 0.3, 2.0)
		elif e.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			cam.position.z = clampf(cam.position.z + 0.05, 0.3, 2.0)
	elif e is InputEventKey and e.pressed:
		var k := (e as InputEventKey).keycode
		if k >= KEY_1 and k <= KEY_6:
			_load(BOTTLES[k - KEY_1])
		elif k == KEY_0: _set_tilt(0.0)
		elif k == KEY_9: _set_tilt(90.0)
		elif k == KEY_8: _set_tilt(180.0)
		elif k == KEY_SPACE: shake_t = 0.8
		elif k == KEY_S: ctl.slosh = not ctl.slosh
		elif k == KEY_UP: fill_slider.value = minf(1.0, fill_slider.value + 0.05)
		elif k == KEY_DOWN: fill_slider.value = maxf(0.0, fill_slider.value - 0.05)
		elif k == KEY_ESCAPE: get_tree().quit()


func _process(delta: float) -> void:
	if shake_t > 0.0:
		shake_t -= delta
		holder.position.x = sin(shake_t * 38.0) * 0.03 * (shake_t / 0.8)
	holder.basis = holder.basis.slerp(_rot, clampf(delta * 14.0, 0.0, 1.0))   # smooth, so the liquid reacts to the turn
	if label and ctl:
		var tilt := rad_to_deg(acos(clampf((holder.basis * Vector3.UP).y, -1.0, 1.0)))
		label.text = "%s   fill %d%%   tilt %d°   slosh %s     (drag = rotate, right-drag = move, wheel = zoom, Space = shake)" % [
			current, int(ctl.fill * 100), int(tilt), "on" if ctl.slosh else "off"]


func _shots(out: String) -> void:
	DirAccess.make_dir_recursive_absolute(out)
	get_window().size = Vector2i(420, 560)
	ctl.slosh = true
	for pose in [[0, 0.6], [45, 0.6], [90, 0.6], [135, 0.6], [180, 0.6], [90, 0.25], [180, 0.9]]:
		_rot = Basis(Vector3(0, 0, 1), deg_to_rad(pose[0]))
		holder.basis = _rot
		ctl.fill = pose[1]
		for i in 300:
			await get_tree().process_frame
		get_viewport().get_texture().get_image().save_png("%s/%s_t%d_f%d.png" % [out, current, pose[0], int(pose[1] * 100)])
	for pose in [[0, 0.7], [90, 0.7]]:   # agitated (just shaken): bubbles + foam
		_rot = Basis(Vector3(0, 0, 1), deg_to_rad(pose[0]))
		holder.basis = _rot
		ctl.fill = pose[1]
		for i in 20:
			ctl._agit = 1.0
			await get_tree().process_frame
		get_viewport().get_texture().get_image().save_png("%s/%s_shaken_t%d.png" % [out, current, pose[0]])
	# close-ups (~30 cm, VR handling distance): calm, shaken, and the shaken cloud clearing over time
	get_window().size = Vector2i(700, 700)
	var cam_z := cam.position.z
	cam.position = Vector3(0.0, -0.03, 0.30)
	for lb in model.find_children("Label*", "MeshInstance3D", true, false):
		(lb as MeshInstance3D).visible = false   # close-ups look at the liquid, not the label
	for pose in [[0, "calm"], [90, "calm"], [0, "shaken"], [90, "shaken"]]:
		_rot = Basis(Vector3(0, 0, 1), deg_to_rad(pose[0])) # label hidden
		holder.basis = _rot
		ctl.fill = 0.7
		for i in 120:
			if pose[1] == "shaken":
				ctl._agit = 1.0
			elif i < 90:   # the pose jump itself agitates: let it settle, then show the calm state
				ctl._agit = 0.0
				ctl._foam = 0.0
			await get_tree().process_frame
		get_viewport().get_texture().get_image().save_png("%s/%s_close_%s_t%d.png" % [out, current, pose[1], pose[0]])
	_rot = Basis.IDENTITY
	holder.basis = _rot
	for i in 60:
		ctl._agit = 1.0
		await get_tree().process_frame
	var t0 := Time.get_ticks_msec()
	for t in [0.75, 1.5, 3.0]:
		while Time.get_ticks_msec() - t0 < int(t * 1000.0):
			await get_tree().process_frame
		get_viewport().get_texture().get_image().save_png("%s/%s_close_clear_%dms.png" % [out, current, int(t * 1000.0)])
	cam.position = Vector3(0, 0, cam_z)
	print("SHOTS done flip=", ctl._mat.get_shader_parameter("flip_faces"), " vol=", BottleLiquid._signed_volume(ctl.liquid.mesh))
	get_tree().quit()


## --tiers: close-up of the shaken bottle at every realism tier + measured GPU time. The timing uses a 3072^2 offscreen
## viewport whose camera sits so close that the liquid covers the whole frame (amplifies the shader cost above noise).
func _tiers(out: String) -> void:
	DirAccess.make_dir_recursive_absolute(out)
	get_window().size = Vector2i(700, 700)
	for lb in model.find_children("Label*", "MeshInstance3D", true, false):
		(lb as MeshInstance3D).visible = false
	cam.position = Vector3(0.0, -0.03, 0.30)
	var sv := SubViewport.new()
	sv.size = Vector2i(3072, 3072)
	sv.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(sv)
	var c2 := Camera3D.new()
	c2.fov = 32
	c2.position = Vector3(0.0, -0.05, 0.12)
	sv.add_child(c2)
	c2.current = true
	var rid := sv.get_viewport_rid()
	RenderingServer.viewport_set_measure_render_time(rid, true)
	ctl.fill = 0.7
	for i in 60:
		await get_tree().process_frame
	var names := ["minimal", "low", "medium", "high"]
	var res := {}
	for rep in 6:   # interleave tiers 6x, keep the best (least disturbed by other GPU work) average
		for t in ([3, 2, 1, 0] if rep % 2 == 0 else [0, 1, 2, 3]):
			ctl.quality = t
			for i in 20:
				ctl._agit = 1.0
				await get_tree().process_frame
			var acc := 0.0
			for i in 120:
				ctl._agit = 1.0
				await get_tree().process_frame
				acc += RenderingServer.viewport_get_measured_render_time_gpu(rid)
			var ms := acc / 120.0
			res[t] = minf(res.get(t, 1e9), ms)
			if rep == 0:
				get_viewport().get_texture().get_image().save_png("%s/%s_tier%d_%s.png" % [out, current, t, names[t]])
	model.visible = false
	var acc0 := 0.0
	for i in 120:
		await get_tree().process_frame
		acc0 += RenderingServer.viewport_get_measured_render_time_gpu(rid)
	for t in [3, 2, 1, 0]:
		print("TIER %d %s gpu_ms %.3f" % [t, names[t], res[t]])
	print("TIER none(empty 3072^2 view) gpu_ms %.3f" % (acc0 / 120.0))
	print("SHOTS done")
	get_tree().quit()
