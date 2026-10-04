extends Control
## Interactive audition board: one button per sound variant family + helper kinds. Run without --headless.
var ba: BottleAudio
func _ready() -> void:
	ba = BottleAudio.new()
	add_child(ba)
	var cam := Camera3D.new()  # listener
	var vp := SubViewport.new()
	var scroll := ScrollContainer.new()
	scroll.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(scroll)
	var grid := GridContainer.new()
	grid.columns = 4
	scroll.add_child(grid)
	var kinds := ["clink", "thud", "shatter", "splash", "cap_pop", "bullet_glass", "bullet_plastic", "shard_settle", "bubble_pop", "slosh", "dent"]
	for k in kinds:
		for e in [0.3, 1.0]:
			var b := Button.new()
			b.text = "%s  e=%.1f" % [k, e]
			b.pressed.connect(func(): ba.play_event(k, Vector3.ZERO, e, {"size": e}))
			grid.add_child(b)
	for n in BottleAudio.all_sound_names():
		var b2 := Button.new()
		b2.text = "raw: " + n
		b2.pressed.connect(func():
			var v := ba.get_variants(n)
			if v.size() > 0:
				var p := ba._voices[0]
				p.stream = v[randi() % v.size()]
				p.play())
		grid.add_child(b2)
	for lp in [["pour", "pour_start", "pour_stop"], ["fizz", "fizz_start", "fizz_stop"]]:
		var on := Button.new(); on.text = lp[1]
		on.pressed.connect(func(): ba.play_event(lp[1], Vector3.ZERO, 0.8, {"source": "demo", "fill": 0.5}))
		grid.add_child(on)
		var off := Button.new(); off.text = lp[2]
		off.pressed.connect(func(): ba.play_event(lp[2], Vector3.ZERO, 0.0, {"source": "demo"}))
		grid.add_child(off)
