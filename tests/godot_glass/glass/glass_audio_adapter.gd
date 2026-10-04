class_name GlassAudioAdapter
extends Node
## Maps GlassSystem signals to BottleAudio.play_event() kinds (audio/godot/bottle_audio.gd). No hard dependency:
## the audio node is found by script class name "BottleAudio" (or any node with play_event(kind, pos, energy, params)).
##   pierced (bullet)                -> "bullet_glass"   energy ~ log10(E)/3
##   damaged CHIP / CRACKED          -> "clink" (hard) / "thud" for blunt cracks
##   broke shatter/collapse/hole     -> "shatter" size from pane area (large > 0.4 m2)
##   broke dice (tempered)           -> "shatter" size 1 + granule rain "shard_settle" x N
##   broke punch (laminated / wired) -> "thud" + "clink"
##   shard_settled / granules_landed -> "shard_settle" / "clink"

@export var audio_path: NodePath
@export var system_path: NodePath
@export var volume_scale := 1.0

var audio: Node
var system: GlassSystem


func _ready() -> void:
	audio = get_node_or_null(audio_path) if audio_path != NodePath() else null
	if audio == null:
		audio = _find_audio(get_tree().root)
	system = get_node_or_null(system_path) as GlassSystem if system_path != NodePath() else GlassSystem.get_for(self)
	system.pane_damaged.connect(_on_damaged)
	system.pane_broke.connect(_on_broke)
	system.pane_pierced.connect(_on_pierced)
	system.shard_settled.connect(func(pos, e): _play("shard_settle", pos, e * 0.8))
	system.granules_landed.connect(func(pos, n): _play("shard_settle", pos, clampf(n / 80.0, 0.2, 1.0)))


func _find_audio(n: Node) -> Node:
	var s := n.get_script() as Script
	if s and s.get_global_name() == &"BottleAudio":
		return n
	for c in n.get_children():
		var f := _find_audio(c)
		if f:
			return f
	return null


func _play(kind: String, pos: Vector3, e: float, params := {}) -> void:
	if audio and audio.has_method("play_event"):
		audio.call("play_event", kind, pos, clampf(e * volume_scale, 0.0, 2.0), params)


static func energy_level(joules: float) -> float:
	return clampf(log(maxf(joules, 0.1)) / log(10.0) / 3.0, 0.05, 1.5)


func _on_pierced(pane: Node3D, point: Vector3, _v: Vector3) -> void:
	if pane is GlassPane and (pane as GlassPane).last_info.get("projectile", false):
		_play("bullet_glass", point, energy_level(float((pane as GlassPane).last_info.get("energy", 500.0))))


func _on_damaged(pane: Node3D, point: Vector3, outcome: int, energy: float) -> void:
	var proj: bool = pane is GlassPane and bool((pane as GlassPane).last_info.get("projectile", false))
	if outcome == GlassDamageModel.Outcome.CHIP:
		_play("clink", point, energy_level(energy) * 0.8, {"material": "glass"})
	elif outcome == GlassDamageModel.Outcome.CRACKED:
		if proj:
			_play("bullet_glass", point, energy_level(energy) * 0.8)
		else:
			_play("thud", point, energy_level(energy), {"material": "glass"})
			_play("clink", point, 0.6, {"material": "glass"})


func _on_broke(pane: Node3D, pos: Vector3, energy: float, kind: StringName) -> void:
	var area := 1.0
	if pane is GlassPane:
		area = (pane as GlassPane).size.x * (pane as GlassPane).size.y
	match kind:
		&"dice":
			_play("shatter", pos, clampf(energy_level(energy) + 0.4, 0.5, 1.5), {"size": 1.0})
			for i in 6:
				var t := get_tree().create_timer(0.25 + i * 0.12)
				t.timeout.connect(func(): _play("shard_settle", pos + Vector3(randf_range(-0.3, 0.3), -0.5, randf_range(-0.2, 0.2)), 0.7))
		&"punch", &"cobweb":
			_play("thud", pos, energy_level(energy), {"material": "glass"})
			_play("clink", pos, 0.8, {"material": "glass"})
		_:
			_play("shatter", pos, clampf(energy_level(energy) + 0.2, 0.3, 1.5), {"size": clampf(area / 0.8, 0.2, 1.0)})
