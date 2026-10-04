class_name BottleAudio
extends Node3D
## Pooled 3D sound player for the procedural bottle sound set (audio/wav/*.wav). MIT/CC0.
## No dependency on other project code. Add one instance to your scene (or autoload), then:
##   audio.play_event("shatter", pos, energy)
##   audio.play_event("pour_start", pos, flow, {"source": bottle, "fill": 0.6})
##   audio.play_event("pour_stop", pos, 0.0, {"source": bottle})
## Sounds are loaded from `audio_root` (default res://audio/wav): <name>_NN.wav, NN = 01..

## Bus the players are routed to (falls back to Master if missing).
@export var bus: StringName = &"SFX"
## Max simultaneous one-shot voices (loops are counted separately).
@export var max_voices := 16
@export var max_loops := 6
@export var audio_root := "res://audio/wav"
@export var master_db := 0.0
## VR-friendly 3D settings: gentle inverse-square, small unit size (bottles are handheld).
@export var unit_size := 1.5
@export var max_distance := 30.0
@export var max_db := 3.0
@export var attenuation_model := AudioStreamPlayer3D.ATTENUATION_INVERSE_SQUARE_DISTANCE
@export var attenuation_filter_cutoff_hz := 16000.0
## On "shatter": automatically schedule shard_settle ticks around the position.
@export var auto_shard_settle := true
@export var loop_fade_speed := 24.0  ## dB per second for loop volume smoothing

## kind -> base config. names: candidate sound names (one picked by rule in _pick_names).
const KIND_DB := {
	"clink": -6.0, "thud": -3.0, "shatter": -2.0, "splash": -4.0, "cap_pop": -4.0,
	"bullet_glass": -2.0, "bullet_plastic": -3.0, "shard_settle": -9.0, "bubble_pop": -9.0,
	"slosh": -6.0, "dent": -6.0,
}
const LOOP_NAMES := {"pour": "liquid_stream_loop", "glug": "liquid_glug", "fizz": "fizz_loop"}
const LOOP_DB := {"pour": -4.0, "glug": -6.0, "fizz": -10.0}
const GLUG_FILLS := [0.95, 0.8, 0.65, 0.5, 0.35, 0.2]  # matches synth_sounds.GLUG_FILLS

var _variants := {}      # name -> Array[AudioStream]
var _last_idx := {}      # name -> last played index (avoid immediate repeats)
var _voices: Array[AudioStreamPlayer3D] = []
var _loop_players := {}  # "pour:<id>" -> {player, target_db, stopping}
var _rng := RandomNumberGenerator.new()
var _t := 0.0

func _ready() -> void:
	_rng.randomize()
	for i in max_voices:
		_voices.append(_make_player())
	set_process(true)

func _make_player() -> AudioStreamPlayer3D:
	var p := AudioStreamPlayer3D.new()
	p.bus = bus if AudioServer.get_bus_index(bus) >= 0 else &"Master"
	p.unit_size = unit_size
	p.max_distance = max_distance
	p.max_db = max_db
	p.attenuation_model = attenuation_model
	p.attenuation_filter_cutoff_hz = attenuation_filter_cutoff_hz
	p.doppler_tracking = AudioStreamPlayer3D.DOPPLER_TRACKING_DISABLED
	p.panning_strength = 1.0
	add_child(p)
	return p

# ------------------------------------------------------------------ loading
## Returns all variants of a sound name (cached). Empty array if none found.
func get_variants(sound_name: String) -> Array:
	if _variants.has(sound_name):
		return _variants[sound_name]
	var arr: Array = []
	var i := 1
	while true:
		var path := "%s/%s_%02d.wav" % [audio_root, sound_name, i]
		if not ResourceLoader.exists(path):
			break
		var s = ResourceLoader.load(path)
		if s is AudioStream:
			arr.append(s)
		i += 1
	_variants[sound_name] = arr
	return arr

## Names of all sound sets this helper can use (for tests / preloading).
static func all_sound_names() -> PackedStringArray:
	return PackedStringArray([
		"glass_clink_soft", "glass_clink_hard", "glass_impact_thud", "plastic_bottle_bounce",
		"plastic_bottle_dent", "glass_shatter_small", "glass_shatter_large", "shard_settle",
		"liquid_splash_small", "liquid_splash_large", "liquid_glug", "liquid_stream_loop",
		"liquid_slosh", "fizz_loop", "bubble_pop", "cork_pop", "crown_cap_pop", "screw_cap_twist",
		"cap_clink", "bullet_hit_glass", "bullet_hit_plastic"])

static func loop_sound_names() -> PackedStringArray:
	return PackedStringArray(["liquid_glug", "liquid_stream_loop", "fizz_loop"])

func preload_all() -> void:
	for n in all_sound_names():
		get_variants(n)

func _pick(sound_name: String) -> AudioStream:
	var v := get_variants(sound_name)
	if v.is_empty():
		return null
	var idx := _rng.randi() % v.size()
	if v.size() > 1 and _last_idx.get(sound_name, -1) == idx:
		idx = (idx + 1 + _rng.randi() % (v.size() - 1)) % v.size()  # never the same twice in a row
	_last_idx[sound_name] = idx
	return v[idx]

func _set_loop(s: AudioStream) -> void:
	if s is AudioStreamWAV:
		var w := s as AudioStreamWAV
		if w.loop_mode != AudioStreamWAV.LOOP_FORWARD:
			var frames := int(round(w.get_length() * w.mix_rate))
			w.loop_mode = AudioStreamWAV.LOOP_FORWARD
			w.loop_begin = 0
			w.loop_end = frames
	elif s is AudioStreamOggVorbis:
		(s as AudioStreamOggVorbis).loop = true
	s.set_meta("loop", true)

# ------------------------------------------------------------------ public API
## kind: clink, thud, shatter, splash, pour_start, pour_stop, fizz_start / fizz_stop
## (or fizz_loop with energy>0 = on, 0 = off), cap_pop, bullet_glass, bullet_plastic,
## shard_settle, bubble_pop, slosh.
## energy: ~0..1 typical (up to 2). params (optional): "material" ("glass"/"plastic" for thud/clink),
## "size" (0..1 small..large for shatter/splash), "cap" ("cork"/"crown"/"screw"/"clink"),
## "source" (any Variant id for loops, e.g. the bottle node), "fill" (0..1, pour/glug).
## Returns the AudioStreamPlayer3D used (or null if nothing played).
func play_event(kind: String, position: Vector3, energy := 1.0, params := {}) -> AudioStreamPlayer3D:
	var e := clampf(energy, 0.0, 2.0)
	var src = params.get("source", 0)
	match kind:
		"clink":
			var mat: String = params.get("material", "glass")
			if mat == "plastic":
				return _shot("plastic_bottle_bounce", position, e, "clink", 0.97, 1.03, 0.0)
			var nm := "glass_clink_hard" if e > 0.55 else "glass_clink_soft"
			return _shot(nm, position, e, "clink", 0.94, 1.06, 0.08)
		"thud":
			var mat2: String = params.get("material", "glass")
			if mat2 == "plastic":
				return _shot("plastic_bottle_dent" if e < 0.35 else "plastic_bottle_bounce", position, e, "thud", 0.95, 1.05, 0.0)
			return _shot("glass_impact_thud", position, e, "thud", 0.92, 1.08, 0.12)
		"dent":
			return _shot("plastic_bottle_dent", position, e, "dent", 0.95, 1.05, 0.0)
		"shatter":
			var size: float = params.get("size", clampf(e, 0.0, 1.0))
			var big := size > 0.5
			var pl := _shot("glass_shatter_large" if big else "glass_shatter_small", position, e, "shatter", 0.95, 1.05, 0.05)
			if auto_shard_settle:
				_schedule_shards(position, e, big)
			return pl
		"splash":
			var size2: float = params.get("size", clampf(e, 0.0, 1.0))
			return _shot("liquid_splash_large" if size2 > 0.5 else "liquid_splash_small", position, e, "splash", 0.93, 1.07, 0.1)
		"slosh":
			return _shot("liquid_slosh", position, e, "slosh", 0.95, 1.05, 0.0)
		"cap_pop":
			var cap: String = params.get("cap", ["cork_pop", "crown_cap_pop", "screw_cap_twist", "cap_clink"][_rng.randi() % 3])
			var nm2: String = {"cork": "cork_pop", "crown": "crown_cap_pop", "screw": "screw_cap_twist", "clink": "cap_clink"}.get(cap, cap)
			return _shot(nm2, position, e, "cap_pop", 0.96, 1.04, 0.0)
		"bullet_glass":
			return _shot("bullet_hit_glass", position, e, "bullet_glass", 0.96, 1.04, 0.0)
		"bullet_plastic":
			return _shot("bullet_hit_plastic", position, e, "bullet_plastic", 0.96, 1.04, 0.0)
		"shard_settle":
			return _shot("shard_settle", position, e, "shard_settle", 0.9, 1.15, 0.2)
		"bubble_pop":
			return _shot("bubble_pop", position, e, "bubble_pop", 0.8, 1.25, 0.2)
		"pour_start":
			var fill: float = params.get("fill", 0.6)
			_loop_on("pour", src, position, e)
			_loop_on("glug", src, position, e, _glug_variant(fill))
			return null
		"pour_stop":
			_loop_off("pour", src)
			_loop_off("glug", src)
			return null
		"fizz_start":
			_loop_on("fizz", src, position, e)
			return null
		"fizz_stop":
			_loop_off("fizz", src)
			return null
		"fizz_loop":
			if e > 0.0:
				_loop_on("fizz", src, position, e)
			else:
				_loop_off("fizz", src)
			return null
		_:
			push_warning("BottleAudio: unknown kind '%s'" % kind)
	return null

## Update a running loop (position follows the bottle, level from flow / carbonation).
## loop: "pour" | "fizz"; level 0..1.  For pour you may also pass fill to change glug pitch.
func update_loop(loop: String, source, position: Vector3, level: float, fill := -1.0) -> void:
	var key := "%s:%s" % [loop, str(source)]
	if _loop_players.has(key):
		var d = _loop_players[key]
		d.player.global_position = position
		d.target_db = _level_db(loop, level)
	if loop == "pour":
		update_loop("glug", source, position, level)
		if fill >= 0.0:
			pass  # glug variant is chosen at pour_start; restart pour to change fill bucket

func is_loop_active(loop: String, source = 0) -> bool:
	var key := "%s:%s" % [loop, str(source)]
	return _loop_players.has(key) and not _loop_players[key].stopping

func stop_all() -> void:
	for p in _voices:
		p.stop()
	for k in _loop_players.keys():
		_loop_players[k].player.stop()
		_loop_players[k].player.queue_free()
	_loop_players.clear()

# ------------------------------------------------------------------ internals
func _energy_db(e: float) -> float:
	return clampf(20.0 * log(maxf(e, 0.02)) / log(10.0) * 0.8, -40.0, 4.0)

func _level_db(loop: String, level: float) -> float:
	return LOOP_DB[loop] + master_db + clampf(20.0 * log(maxf(level, 0.001)) / log(10.0), -60.0, 3.0)

func _glug_variant(fill: float) -> int:
	var best := 0
	for i in GLUG_FILLS.size():
		if absf(GLUG_FILLS[i] - fill) < absf(GLUG_FILLS[best] - fill):
			best = i
	return best

func _shot(sound_name: String, position: Vector3, e: float, kind: String, pmin: float, pmax: float, vol_jitter: float) -> AudioStreamPlayer3D:
	var s := _pick(sound_name)
	if s == null:
		push_warning("BottleAudio: no variants for '%s' under %s" % [sound_name, audio_root])
		return null
	var db: float = KIND_DB.get(kind, -4.0) + _energy_db(e) + master_db + _rng.randf_range(-vol_jitter, vol_jitter) * 20.0
	var p := _acquire(db)
	if p == null:
		return null
	p.stream = s
	p.global_position = position
	p.volume_db = db
	# higher energy -> slightly brighter / higher; jitter always
	p.pitch_scale = _rng.randf_range(pmin, pmax) * (1.0 + 0.03 * (clampf(e, 0.0, 1.5) - 0.5))
	p.set_meta("start_t", _t)
	p.play()
	return p

## Pool: free voice, else steal the quietest (oldest on ties); drop the new sound if it is
## much quieter than everything playing.
func _acquire(new_db: float) -> AudioStreamPlayer3D:
	var victim: AudioStreamPlayer3D = null
	for p in _voices:
		if not p.playing:
			return p
		if victim == null or p.volume_db < victim.volume_db - 1.0 \
				or (absf(p.volume_db - victim.volume_db) <= 1.0 and p.get_meta("start_t", 0.0) < victim.get_meta("start_t", 0.0)):
			victim = p
	if victim != null and victim.volume_db > new_db + 9.0:
		return null
	if victim != null:
		victim.stop()
	return victim

func _schedule_shards(pos: Vector3, e: float, big: bool) -> void:
	var n := int(lerp(3.0, 9.0, clampf(e, 0.0, 1.0))) + (3 if big else 0)
	for i in n:
		var delay := _rng.randf_range(0.25, 1.4)
		var off := Vector3(_rng.randf_range(-0.3, 0.3), 0.0, _rng.randf_range(-0.3, 0.3))
		var tmr := get_tree().create_timer(delay)
		tmr.timeout.connect(func(): play_event("shard_settle", pos + off, _rng.randf_range(0.3, 0.9)))

func _loop_on(loop: String, source, position: Vector3, level: float, variant := -1) -> void:
	var key := "%s:%s" % [loop, str(source)]
	var db := _level_db(loop, level)
	if _loop_players.has(key):
		var d = _loop_players[key]
		d.stopping = false
		d.target_db = db
		d.player.global_position = position
		if not d.player.playing:
			d.player.play()
		return
	if _loop_players.size() >= max_loops:
		return
	var v := get_variants(LOOP_NAMES[loop])
	if v.is_empty():
		push_warning("BottleAudio: loop sound '%s' missing" % LOOP_NAMES[loop])
		return
	var s: AudioStream = v[variant] if (variant >= 0 and variant < v.size()) else v[_rng.randi() % v.size()]
	_set_loop(s)
	var p := _make_player()
	p.stream = s
	p.volume_db = -60.0
	p.global_position = position
	p.play(_rng.randf() * s.get_length())  # random start phase
	_loop_players[key] = {"player": p, "target_db": db, "stopping": false}

func _loop_off(loop: String, source) -> void:
	var key := "%s:%s" % [loop, str(source)]
	if _loop_players.has(key):
		_loop_players[key].stopping = true
		_loop_players[key].target_db = -60.0

func _process(delta: float) -> void:
	_t += delta
	for k in _loop_players.keys():
		var d = _loop_players[k]
		var p: AudioStreamPlayer3D = d.player
		p.volume_db = move_toward(p.volume_db, d.target_db, loop_fade_speed * delta)
		if d.stopping and p.volume_db <= -55.0:
			p.stop()
			p.queue_free()
			_loop_players.erase(k)
