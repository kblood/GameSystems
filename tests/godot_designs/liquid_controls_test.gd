extends SceneTree

const DESIGN := "res://designs/v2_bordeaux_classic.glb"
const LIQUID_INFO := "res://designs/v2_bordeaux_classic.liquid.json"

func _initialize() -> void:
	call_deferred("_run")


func _check(condition: bool, message: String) -> void:
	if condition: return
	push_error(message)
	quit(1)


func _new_controller(viscosity_override := -1.0) -> Array:
	var packed := load(DESIGN) as PackedScene
	_check(packed != null, "missing imported test bottle: %s" % DESIGN)
	if packed == null: return []
	var bottle := packed.instantiate() as Node3D
	root.add_child(bottle)
	var ctl := BottleLiquid.new()
	root.add_child(ctl)
	ctl.setup(bottle, 0.6, LIQUID_INFO)
	if viscosity_override >= 0.0: ctl.viscosity = viscosity_override
	return [bottle, ctl]


func _response(viscosity_value: float) -> float:
	var pair := _new_controller(viscosity_value)
	var bottle: Node3D = pair[0]
	var ctl: BottleLiquid = pair[1]
	bottle.position.x = 0.003
	ctl._apply(1.0 / 60.0)
	var ripple: float = ctl._mat.get_shader_parameter("ripple")
	bottle.queue_free()
	ctl.queue_free()
	return ripple


func _run() -> void:
	var info := JSON.parse_string(FileAccess.get_file_as_string(LIQUID_INFO)) as Dictionary
	if info == null:
		push_error("missing or invalid liquid info: %s" % LIQUID_INFO)
		quit(1)
		return
	var pair := _new_controller()
	if pair.is_empty(): return
	var ctl: BottleLiquid = pair[1]
	var expected_size := float(info.get("bubble_size", 1.0))
	_check(is_equal_approx(float(ctl._mat.get_shader_parameter("bubble_size")), expected_size), "sidecar bubble_size is applied")
	ctl.bubble_size = 2.25
	_check(is_equal_approx(float(ctl._mat.get_shader_parameter("bubble_size")), 2.25), "runtime bubble_size updates the shader uniform")
	ctl._sleep()
	_check(ctl.is_sleeping(), "controller sleeps before runtime control edits")
	ctl.bubble_size = 2.75
	_check(not ctl.is_sleeping(), "bubble_size edit wakes a sleeping controller")
	_check(is_equal_approx(float(ctl._mat.get_shader_parameter("bubble_size")), 2.75), "bubble_size remains applied after wake")
	ctl._sleep()
	ctl.viscosity = 0.7
	_check(not ctl.is_sleeping(), "viscosity edit wakes a sleeping controller")
	ctl.viscosity = 1.0
	_check(is_equal_approx(ctl._viscosity_value(), 1.0), "runtime viscosity is bounded and applied")
	var thin := _response(0.0)
	var neutral := _response(0.45)
	var thick := _response(1.0)
	_check(thin > neutral and neutral > thick, "viscosity changes slosh response: %f > %f > %f" % [thin, neutral, thick])
	var design := BottleDesign.load_design(DESIGN, 0.6, true, "high")
	root.add_child(design)
	await process_frame
	_check(design.ctl != null, "design creates its liquid controller in-tree")
	design.ctl.bubble_size = 2.4
	design.ctl.viscosity = 0.8
	design.set_tier("low")
	await process_frame
	_check(is_equal_approx(design.ctl.bubble_size, 2.4), "tier swap preserves runtime bubble size")
	_check(is_equal_approx(design.ctl.viscosity, 0.8), "tier swap preserves runtime viscosity")
	print("LIQUID_CONTROLS_OK bubble_size=2.25 viscosity=0..1")
	quit()
