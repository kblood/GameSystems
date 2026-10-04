extends Node3D
## Bottle design viewer.  godot --path . [-- --shots <outdir>]
## Mouse: left-drag rotate, wheel zoom.  Pick a design (dropdown / PgUp / PgDn), toggle labels per slot, choose the active slot and
## drop a PNG/JPG onto the window (or type a path + Load) to put it in that slot.  Esc quits.

var designs: Array = []
var idx := 0
var holder: Node3D
var cam: Camera3D
var bd: BottleDesign
var slot_box: VBoxContainer
var slot_pick: OptionButton
var design_pick: OptionButton
var path_edit: LineEdit
var info: Label
var fill_slider: HSlider
var _rot := Basis.IDENTITY
var tier := "high"


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	var da := DirAccess.open("res://designs")
	for f in da.get_files():
		if f.ends_with(".glb") and not (f.get_basename().ends_with("_medium") or f.get_basename().ends_with("_low") or f.get_basename().ends_with("_minimal")): designs.append(f.get_basename())
	designs.sort()
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
	get_window().size = Vector2i(1000, 760)
	get_window().files_dropped.connect(_on_files_dropped)
	var si := args.find("--shots")
	if args.has("--v2") or args.has("--containers"):
		var keep: Array = []
		for d in designs:
			if (args.has("--v2") and String(d).begins_with("v2_")) or (args.has("--containers") and String(d).begins_with("container_")): keep.append(d)
		designs = keep
		if si >= 0:
			await _shots_v2(args[si + 1])
			return
	elif si >= 0:
		await _shots(args[si + 1])
		return
	_build_ui()
	_load(0)


func _load(i: int) -> void:
	idx = wrapi(i, 0, designs.size())
	if bd: bd.queue_free()
	bd = BottleDesign.load_design("res://designs/%s.glb" % designs[idx], -1.0, true, tier)
	holder.add_child(bd)
	var aabb := AABB(); var first := true
	for m in bd.root.find_children("*", "MeshInstance3D", true, false):
		var a := (m as MeshInstance3D).get_aabb()
		aabb = a if first else aabb.merge(a); first = false
	bd.root.position = -aabb.get_center()
	if design_pick: design_pick.select(idx)
	if fill_slider: fill_slider.set_value_no_signal(bd.ctl.fill)
	_rebuild_slots()


func _build_ui() -> void:
	var layer := CanvasLayer.new(); add_child(layer)
	var box := VBoxContainer.new(); box.position = Vector2(12, 10); layer.add_child(box)
	design_pick = OptionButton.new(); box.add_child(design_pick)
	for d in designs: design_pick.add_item(d)
	design_pick.item_selected.connect(_load)
	var row := HBoxContainer.new(); box.add_child(row)
	var bp := Button.new(); bp.text = "< prev"; bp.focus_mode = Control.FOCUS_NONE; bp.pressed.connect(func(): _load(idx - 1)); row.add_child(bp)
	var bn := Button.new(); bn.text = "next >"; bn.focus_mode = Control.FOCUS_NONE; bn.pressed.connect(func(): _load(idx + 1)); row.add_child(bn)
	for t in [["Front", 0.0], ["Side", 90.0], ["Back", 180.0], ["Left", 270.0]]:
		var b := Button.new(); b.text = t[0]; b.focus_mode = Control.FOCUS_NONE
		var ang: float = t[1]
		b.pressed.connect(func(): _rot = Basis(Vector3.UP, deg_to_rad(ang))); row.add_child(b)
	var tp := OptionButton.new()
	for tn in ["high", "medium", "low", "minimal"]: tp.add_item(tn)
	tp.item_selected.connect(func(i): tier = tp.get_item_text(i); _load(idx))
	row.add_child(tp)
	var frow := HBoxContainer.new(); box.add_child(frow)
	var fl := Label.new(); fl.text = "Fill"; frow.add_child(fl)
	fill_slider = HSlider.new(); fill_slider.max_value = 1.0; fill_slider.step = 0.01; fill_slider.value = 0.6
	fill_slider.custom_minimum_size = Vector2(200, 20); fill_slider.focus_mode = Control.FOCUS_NONE
	fill_slider.value_changed.connect(func(v): if bd: bd.set_fill(v))
	frow.add_child(fill_slider)
	var cp := ColorPickerButton.new(); cp.text = "Liquid"; cp.custom_minimum_size = Vector2(80, 0); cp.color = Color(0.6, 0.3, 0.1)
	cp.color_changed.connect(func(c): if bd: bd.set_liquid_color(c))
	frow.add_child(cp)
	slot_box = VBoxContainer.new(); box.add_child(slot_box)
	var srow := HBoxContainer.new(); box.add_child(srow)
	var sl := Label.new(); sl.text = "Active slot:"; srow.add_child(sl)
	slot_pick = OptionButton.new(); srow.add_child(slot_pick)
	var prow := HBoxContainer.new(); box.add_child(prow)
	path_edit = LineEdit.new(); path_edit.custom_minimum_size = Vector2(300, 0); path_edit.placeholder_text = "image path (or drop a file on the window)"; prow.add_child(path_edit)
	var lb := Button.new(); lb.text = "Load"; lb.focus_mode = Control.FOCUS_NONE
	lb.pressed.connect(func(): _assign(path_edit.text.strip_edges().trim_prefix("\"").trim_suffix("\""))); prow.add_child(lb)
	var cb := Button.new(); cb.text = "Clear slot"; cb.focus_mode = Control.FOCUS_NONE
	cb.pressed.connect(func(): if bd: bd.clear_label(_active()); _rebuild_slots_keep())
	prow.add_child(cb)
	info = Label.new(); box.add_child(info)


func _rebuild_slots() -> void:
	if slot_box == null: return
	for c in slot_box.get_children(): c.queue_free()
	slot_pick.clear()
	for s in bd.list_slots():
		var cb := CheckBox.new(); cb.focus_mode = Control.FOCUS_NONE
		cb.text = "%s  %.0fx%.0f mm  aspect %.2f  [%s]%s" % [s["name"], s["width_mm"], s["height_mm"], s["aspect"], s["material_kind"], "  (empty)" if s["empty"] else ""]
		cb.button_pressed = s["visible"]
		var nm: String = s["name"]
		cb.toggled.connect(func(on): bd.set_label_visible(nm, on))
		slot_box.add_child(cb)
		slot_pick.add_item(nm)


func _active() -> String:
	return slot_pick.get_item_text(slot_pick.selected) if slot_pick and slot_pick.item_count > 0 else ""


func _assign(path: String) -> void:
	if bd == null or path == "": return
	var ok := bd.set_label_image(_active(), path)
	info.text = ("slot '%s' <- %s" % [_active(), path.get_file()]) if ok else "could not load %s" % path
	_rebuild_slots_keep()


func _rebuild_slots_keep() -> void:
	var keep := slot_pick.selected
	_rebuild_slots()
	slot_pick.select(keep)


func _on_files_dropped(files: PackedStringArray) -> void:
	if files.size() > 0: _assign(files[0])


func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventMouseMotion and (e.button_mask & MOUSE_BUTTON_MASK_LEFT):
		_rot = (Basis(Vector3.UP, e.relative.x * 0.01) * Basis(Vector3.RIGHT, e.relative.y * 0.01) * _rot).orthonormalized()
	elif e is InputEventMouseButton and e.pressed:
		if e.button_index == MOUSE_BUTTON_WHEEL_UP: cam.position.z = clampf(cam.position.z - 0.05, 0.2, 2.0)
		elif e.button_index == MOUSE_BUTTON_WHEEL_DOWN: cam.position.z = clampf(cam.position.z + 0.05, 0.2, 2.0)
	elif e is InputEventKey and e.pressed:
		match e.keycode:
			KEY_PAGEDOWN: _load(idx + 1)
			KEY_PAGEUP: _load(idx - 1)
			KEY_ESCAPE: get_tree().quit()


func _process(delta: float) -> void:
	holder.basis = holder.basis.slerp(_rot, clampf(delta * 14.0, 0.0, 1.0))


func _frames(n: int) -> void:
	for i in n: await get_tree().process_frame


func _fit() -> void:
	## camera distance from the bottle's height (v2 bottles range from 78 mm perfume to 335 mm PET)
	var h := 0.3
	var aabb := AABB(); var first := true
	for m in bd.root.find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		if mi.name.begins_with("Label"): continue
		var a := mi.get_aabb()
		aabb = a if first else aabb.merge(a); first = false
	h = aabb.size.y
	cam.position = Vector3(0, 0, maxf(0.3, h * 2.9))


func _shots_v2(dir: String) -> void:
	DirAccess.make_dir_recursive_absolute(dir)
	get_window().size = Vector2i(420, 560)
	for i in designs.size():
		_load(i)
		bd.ctl.slosh = false
		_fit()
		_print_glass(designs[i])
		for v in [["front", 0.0], ["side", 90.0], ["back", 180.0]]:
			_rot = Basis(Vector3.UP, deg_to_rad(v[1])); holder.basis = _rot
			await _frames(25)
			_shot(dir, "%s_%s" % [designs[i], v[0]])
	# close-ups: [design, yaw, name, camera]
	for c in [["v2_apothecary_tonic", 0.0, "close_apothecary", Vector3(0.0, 0.0, 0.2)], ["v2_champagne_brut", 0.0, "close_champagne_foil", Vector3(0.0, 0.085, 0.26)],
			["v2_pet500_orange", 0.0, "close_pet500_sleeve", Vector3(0.0, -0.02, 0.28)], ["v2_contour_cola", 20.0, "close_contour", Vector3(0.0, -0.02, 0.22)],
			["v2_bordeaux_classic", 0.0, "close_bordeaux_capsule", Vector3(0.0, 0.12, 0.26)],
			["v2_pet2l_cola", 0.0, "close_pet2l_sleeve", Vector3(0.0, -0.02, 0.42)], ["v2_decanter_crest", 0.0, "close_decanter", Vector3(0.0, 0.0, 0.3)],
			["v2_roundflask_lab", 0.0, "close_roundflask", Vector3(0.0, -0.04, 0.24)],
			["container_square_gin", 0.0, "close_square", Vector3(0.0, -0.03, 0.3)], ["container_hipflask_engraved", 0.0, "close_hipflask", Vector3(0.0, -0.03, 0.26)],
			["container_jerrycan_fuel", 50.0, "close_jerrycan", Vector3(0.0, 0.0, 0.75)],
			["v2_erlenmeyer_lab", 0.0, "close_erlenmeyer", Vector3(0.0, -0.02, 0.28)]]:
		if designs.find(c[0]) < 0: continue
		_load(designs.find(c[0])); bd.ctl.slosh = false
		_rot = Basis(Vector3.UP, deg_to_rad(-c[1])); holder.basis = _rot
		cam.position = c[3]
		await _frames(25); _shot(dir, c[2])
	for tn in ["medium", "low", "minimal"]:
		tier = tn
		for dn in ["v2_bordeaux_classic", "v2_pet500_orange", "v2_apothecary_tonic"]:
			if designs.find(dn) < 0: continue
			_load(designs.find(dn)); bd.ctl.slosh = false; _fit(); _rot = Basis.IDENTITY; holder.basis = _rot
			await _frames(25); _shot(dir, "tier_%s_%s" % [tn, dn])
	tier = "high"
	for pair in [["v2_longneck_lager", "front", "res://labels/user/my_homebrew.png"], ["v2_milk_dairy", "wrap", "res://labels/beer_amber_wrap.png"],
			["container_mug_diner", "front", "res://labels/user/my_homebrew.png"]]:
		if designs.find(pair[0]) < 0: continue
		_load(designs.find(pair[0])); bd.ctl.slosh = false; _fit(); _rot = Basis.IDENTITY; holder.basis = _rot
		await _frames(25); _shot(dir, "swap_%s_before" % pair[0])
		print("swap ok: ", bd.set_label_image(pair[1], pair[2]), " slots ", bd.slot_names(), " tier ", bd.tier)
		await _frames(25); _shot(dir, "swap_%s_after" % pair[0])
	print("SHOTS done ", designs.size())
	get_tree().quit()


func _print_glass(dn: String) -> void:
	## glass override check: design sidecar glass.tint_override vs the tint the runtime glass shader got
	var want = bd.design.get("glass", {}).get("tint_override", null)
	for g in bd.root.find_children("Glass*", "MeshInstance3D", true, false):
		var m := (g as MeshInstance3D).material_override as ShaderMaterial
		if m: print("glass ", dn, " shader tint ", m.get_shader_parameter("tint"), " design tint_override ", want)
		break


func _shot(dir: String, nm: String) -> void:
	get_viewport().get_texture().get_image().save_png("%s/%s.png" % [dir, nm])


func _shots(dir: String) -> void:
	DirAccess.make_dir_recursive_absolute(dir)
	get_window().size = Vector2i(420, 560)
	for i in designs.size():
		_load(i)
		bd.ctl.slosh = false
		for v in [["front", 0.0], ["side", 90.0], ["back", 180.0]]:
			_rot = Basis(Vector3.UP, deg_to_rad(v[1])); holder.basis = _rot
			await _frames(25)
			_shot(dir, "%s_%s" % [designs[i], v[0]])
	# close-ups of the small labels
	for c in [["flask_lab", 0.0, "close_flask", Vector3(0.0, -0.045, 0.28)], ["flask_lab", 55.0, "close_flask_hand", Vector3(0.0, -0.045, 0.28)],
			["wine_classic", 0.0, "close_wine_neck", Vector3(0.0, 0.07, 0.3)], ["soda_cherry", 0.0, "close_soda_cap", Vector3(0.0, 0.1, 0.3)]]:
		_load(designs.find(c[0])); bd.ctl.slosh = false
		if c[2] == "close_soda_cap":
			_rot = Basis(Vector3.RIGHT, deg_to_rad(60.0))
		else:
			_rot = Basis(Vector3.UP, deg_to_rad(-c[1]))
		holder.basis = _rot
		cam.position = c[3]
		await _frames(25); _shot(dir, c[2])
	cam.position = Vector3(0, 0, 0.85)
	for tn in ["medium", "low", "minimal"]:
		tier = tn
		for dn in ["wine_classic", "flask_lab"]:
			_load(designs.find(dn)); bd.ctl.slosh = false; _rot = Basis.IDENTITY; holder.basis = _rot
			await _frames(25); _shot(dir, "tier_%s_%s" % [tn, dn])
	tier = "high"
	# runtime swap: before / after
	for pair in [["beer_pale", "front", "res://labels/user/my_homebrew.png"], ["wine_bare", "front", "res://labels/wine_modern_front.png"]]:
		_load(designs.find(pair[0])); bd.ctl.slosh = false; _rot = Basis.IDENTITY; holder.basis = _rot
		await _frames(25); _shot(dir, "swap_%s_before" % pair[0])
		if pair[0] == "wine_bare":
			bd.set_label_image("back", "res://labels/wine_classic_back.png"); bd.set_label_image("neck", "res://labels/wine_classic_neck.png")
		print("swap ok: ", bd.set_label_image(pair[1], pair[2]))
		await _frames(25); _shot(dir, "swap_%s_after" % pair[0])
	print("SHOTS done ", designs.size())
	get_tree().quit()
