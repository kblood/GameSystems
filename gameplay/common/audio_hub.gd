extends Node
## Autoload "AudioHub": owns the one BottleAudio and turns bottle events into BottleAudio.play_event kinds.
##   AudioHub.watch(bottle)            # BottleFactory does this when opts.audio is true
##   AudioHub.play("clink", pos, 0.5)  # direct use
## Mapping: broke(shatter) -> shatter (+ splash for the liquid), broke(neck_snap) -> shatter small + cap_pop,
## impact_assessed harmless -> clink / thud (plastic: bounce / dent), bullet pierce -> bullet_glass / bullet_plastic.
var audio: BottleAudio
var _last := {}


func _ready() -> void:
	audio = BottleAudio.new()
	audio.name = "BottleAudio"
	audio.audio_root = "res://audio/wav"
	add_child(audio)


func play(kind: String, pos: Vector3, energy := 1.0, params := {}) -> void:
	if audio:
		audio.play_event(kind, pos, energy, params)


func watch(b: Node) -> void:
	if not b.has_signal("broke") or b.has_meta("_audio_watched"):
		return
	b.set_meta("_audio_watched", true)
	var plastic: bool = b.has_method("is_plastic") and b.is_plastic()
	var cap := 500.0
	if "lut" in b and b.lut != null:
		cap = float(b.lut.capacity_ml)
	b.broke.connect(_on_broke.bind(plastic, cap))
	if b.has_signal("impact_assessed"):
		b.impact_assessed.connect(_on_impact.bind(b.get_instance_id(), plastic))


func _on_broke(pos: Vector3, energy: float, kind: StringName, plastic: bool, cap: float) -> void:
	var size := clampf(cap / 1000.0, 0.15, 1.0)
	var e := clampf(0.5 + log(maxf(energy, 1.0)) / log(10.0) * 0.25, 0.3, 1.2)
	if kind == &"neck_snap":
		play("shatter", pos, e * 0.7, {"size": 0.3})
		play("cap_pop", pos, 0.6)
	elif plastic:
		play("bullet_plastic", pos, e)
	else:
		play("shatter", pos, e, {"size": size})
	var t := get_tree().create_timer(0.06)
	t.timeout.connect(func(): play("splash", pos, 0.7, {"size": size}))


func _on_impact(info: Dictionary, id: int, plastic: bool) -> void:
	var out := int(info.get("outcome", 0))
	var pos: Vector3 = info.get("point", Vector3.ZERO)
	var now := Time.get_ticks_msec()
	if now - int(_last.get(id, -1000)) < 90:
		return
	if out == BottleBreakProfile.Outcome.SHATTER or out == BottleBreakProfile.Outcome.NECK_SNAP:
		return   # `broke` plays it
	_last[id] = now
	var mat := "plastic" if plastic else "glass"
	if info.get("bullet", false):
		if out == BottleBreakProfile.Outcome.PIERCE:
			play("bullet_plastic" if plastic else "bullet_glass", pos, 0.8)
		return
	var e := clampf(float(info.get("v_n", 1.0)) / 6.0, 0.1, 1.0)
	if out == BottleBreakProfile.Outcome.DENT:
		play("dent", pos, e)
	elif out == BottleBreakProfile.Outcome.CRACK:
		play("clink", pos, e, {"material": mat})
		play("thud", pos, e * 0.7, {"material": mat})
	else:
		play("clink" if e < 0.6 else "thud", pos, e, {"material": mat})
