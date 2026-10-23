extends SceneTree
## P1 parity test: replays the shared golden vectors (res://addons/gs_backpack/data/backpack.golden.json, generated from the
## JS core by extensions/backpack/tools/gen_golden.mjs) against the GDScript implementation and requires identical results:
## approach (existing GSBackpackApproach, unchanged), handle pull (existing GSBackpackHandlePull, unchanged), profile
## validation (GSBackpackProfile) and the state machine (GSBackpackState).
##   godot --headless --path godot --script res://addons/gs_backpack/tests/gs_backpack_parity_tests.gd
## Optional: `-- --dump=<file>` writes the actual observations so tools/parity.mjs can compare them with the JS run.
const Approach = preload("res://addons/gs_backpack/gs_backpack_approach.gd")
const HandlePull = preload("res://addons/gs_backpack/gs_backpack_handle_pull.gd")
const Profile = preload("res://addons/gs_backpack/gs_backpack_profile.gd")
const State = preload("res://addons/gs_backpack/gs_backpack_state.gd")
const GOLDEN_PATH := "res://addons/gs_backpack/data/backpack.golden.json"
const EPS := 0.0000001

var checks := 0
var failures: Array[String] = []
var vectors := 0
var ops_run := 0

func _initialize() -> void:
	call_deferred("run")

func check(value: bool, label: String) -> void:
	checks += 1
	if not value:
		failures.append(label)
		push_error("GS_BACKPACK_PARITY: " + label)

func dec(v: Variant) -> Variant:
	if v is String:
		if v == "NaN": return NAN
		if v == "Infinity": return INF
		if v == "-Infinity": return -INF
		return v
	if v is Array:
		var out: Array = []
		for x in v: out.append(dec(x))
		return out
	if v is Dictionary:
		var out := {}
		for k in v: out[k] = dec(v[k])
		return out
	return v

func vec3(a: Array) -> Vector3:
	return Vector3(float(a[0]), float(a[1]), float(a[2]))

## "" when equal (numbers within EPS), else the path of the first difference.
func first_diff(a: Variant, b: Variant, path := "") -> String:
	if (a is float or a is int) and (b is float or b is int): return "" if absf(float(a) - float(b)) <= EPS else "%s: %s vs %s" % [path, a, b]
	if a is Array or b is Array:
		if not (a is Array and b is Array) or a.size() != b.size(): return "%s: array shape" % path
		for i in a.size():
			var d := first_diff(a[i], b[i], "%s[%d]" % [path, i])
			if not d.is_empty(): return d
		return ""
	if a is Dictionary and b is Dictionary:
		var ka: Array = a.keys()
		var kb: Array = b.keys()
		ka.sort()
		kb.sort()
		if ka != kb: return "%s: keys %s vs %s" % [path, ka, kb]
		for k in ka:
			var d := first_diff(a[k], b[k], "%s.%s" % [path, k])
			if not d.is_empty(): return d
		return ""
	return "" if typeof(a) == typeof(b) and a == b else "%s: %s vs %s" % [path, JSON.stringify(a), JSON.stringify(b)]

func fmt_event(e: Dictionary) -> String:
	if e.type == "state": return "state:%s>%s:%s" % [e.from, e.to, e.reason]
	if e.type == "release_blocked": return "release_blocked:" + String(e.reason)
	if e.has("side"): return "%s:%s" % [e.type, e.side]
	return String(e.type)

func observe_state(st: State, r: Dictionary, extra: Dictionary = {}) -> Dictionary:
	var snap: Dictionary = st.snapshot()
	var access: Array[String] = []
	for k in st.profile.pockets:
		if st.can_access(k.id): access.append(k.id)
	var events: Array = []
	for e in r.events: events.append(fmt_event(e))
	var out := {"ok": r.ok, "reason": r.reason, "events": events, "state": snap.state, "owner": snap.owner, "holder": snap.holder,
		"secondary": snap.secondary, "openFraction": snap.openFraction, "accessOpen": snap.accessOpen, "pullOffset": snap.pullOffset,
		"returnProgress": snap.returnProgress, "placed": snap.placed, "posture": snap.posture, "tier": st.tier, "access": ",".join(access)}
	out.merge(extra)
	return out

func run_approach(vec: Dictionary) -> Array:
	var a := Approach.new()
	var out: Array = []
	for raw in vec.ops:
		var op: Dictionary = dec(raw)
		match op.op:
			"observe":
				a.observe(op.side, op.tracked, vec3(op.hand), float(op.shoulderY), float(op.dt))
				out.append(null)
			"check":
				out.append(a.check(op.side, vec3(op.hand), float(op.shoulderY)))
			"reset":
				a.reset(op.get("side", ""))
				out.append(null)
			_: check(false, "unknown approach op " + String(op.op))
	return out

func run_pull(vec: Dictionary) -> Array:
	var p := HandlePull.new()
	var out: Array = []
	for raw in vec.ops:
		var op: Dictionary = dec(raw)
		match op.op:
			"begin": out.append(p.begin(vec3(op.hand), op.side, op.get("kind", "grip")))
			"step": out.append({"offset": p.step(vec3(op.hand), op.tracked, float(op.dt)), "target": p.target_m, "active": p.active})
			"cancel":
				p.cancel()
				out.append({"offset": p.offset_m, "target": p.target_m, "active": p.active})
			_: check(false, "unknown pull op " + String(op.op))
	return out

func build_profile(vec: Dictionary, golden: Dictionary) -> Dictionary:
	var profile: Dictionary = golden.profiles[vec.get("profile", "example")].duplicate(true)
	if vec.has("thresholds"):
		var t: Dictionary = profile.get("thresholds", {}).duplicate()
		t.merge(vec.thresholds, true)
		profile["thresholds"] = t
	if vec.has("tiers"):
		var t: Dictionary = profile.get("tiers", {}).duplicate()
		t.merge(vec.tiers, true)
		profile["tiers"] = t
	return profile

func run_state(vec: Dictionary, golden: Dictionary) -> Array:
	var st := State.new()
	var configured := st.configure(build_profile(vec, golden), vec.get("tier", "high"))
	check(configured, "configure " + String(vec.name))
	var out: Array = []
	if not configured: return out
	for raw in vec.ops:
		var op: Dictionary = dec(raw)
		var r: Dictionary
		var extra := {}
		match op.op:
			"step": r = st.step(float(op.dt), op.get("input", {}))
			"grab": r = st.grab(op.side, op.get("kind", "grip"), op.get("handleDistanceM"))
			"open": r = st.open()
			"close": r = st.close()
			"callToHand": r = st.call_to_hand(op.side)
			"die": r = st.die()
			"setTier": r = st.set_tier(op.tier)
			"setPosture":
				st.set_posture(op.posture)
				r = {"ok": true, "reason": "", "events": []}
			"capture":
				r = {"ok": true, "reason": "", "events": []}
				extra = {"capture": st.capture()}
			"restore":
				var prepared: Dictionary = st.prepare_restore(op.data)
				if bool(prepared.ok):
					st.commit_restore(prepared)
					r = {"ok": true, "reason": "", "events": []}
				else:
					r = {"ok": false, "reason": "invalid", "events": []}
			_:
				check(false, "unknown state op " + String(op.op))
				r = {"ok": false, "reason": "", "events": []}
		out.append(observe_state(st, r, extra))
	return out

func compare(group: String, vec: Dictionary, actual: Array) -> void:
	vectors += 1
	var expected: Array = vec.expected
	check(expected.size() == actual.size(), "%s/%s result count" % [group, vec.name])
	for i in mini(expected.size(), actual.size()):
		ops_run += 1
		var d := first_diff(actual[i], expected[i])
		if not d.is_empty():
			check(false, "%s/%s op %d %s" % [group, vec.name, i, d])
			return
	check(true, "%s/%s" % [group, vec.name])

func run() -> void:
	var golden_text := FileAccess.get_file_as_string(GOLDEN_PATH)
	var golden: Variant = JSON.parse_string(golden_text)
	check(golden is Dictionary and golden.get("schema") == "gamesystems.backpack-golden.v1", "golden file loads")
	if not golden is Dictionary:
		quit(1)
		return
	var dump := {"approach": {}, "pull": {}, "state": {}, "profileCases": {}}
	# the shared constants file equals the constants of the existing, unchanged Godot scripts
	var data: Dictionary = Profile.data()
	check(not data.is_empty(), "data file loads")
	var approach_constants: Dictionary = (Approach as Script).get_script_constant_map()
	var pull_constants: Dictionary = (HandlePull as Script).get_script_constant_map()
	for key in approach_constants:
		if data.APPROACH.has(key): check(absf(float(approach_constants[key]) - float(data.APPROACH[key])) < 0.0000000001, "data.APPROACH.%s equals GSBackpackApproach" % key)
	for key in pull_constants:
		if data.PULL.has(key): check(absf(float(pull_constants[key]) - float(data.PULL[key])) < 0.0000000001, "data.PULL.%s equals GSBackpackHandlePull" % key)
	check(data.APPROACH.has("MAX_SAMPLE_DT") and data.PULL.has("MAX_PULL_M") and data.PULL.has("HANDLE_REACH_M"), "data carries the ported constants")
	# the example profile file is the golden profile and is valid
	var loaded: Dictionary = Profile.load_file()
	check(bool(loaded.ok), "example profile validates: " + String(loaded.error))
	check(first_diff(JSON.parse_string(FileAccess.get_file_as_string(Profile.EXAMPLE_PATH)), golden.profiles.example).is_empty(), "profile.example.json equals the golden profile")
	for vec in golden.profileCases:
		var r: Dictionary = Profile.parse(vec.profile)
		vectors += 1
		ops_run += 1
		check(bool(r.ok) == bool(vec.expected.valid), "profileCases/%s valid=%s" % [vec.name, vec.expected.valid])
		dump.profileCases[vec.name] = {"valid": bool(r.ok)}
	for vec in golden.approach:
		var actual := run_approach(vec)
		compare("approach", vec, actual)
		dump.approach[vec.name] = actual
	for vec in golden.pull:
		var actual := run_pull(vec)
		compare("pull", vec, actual)
		dump.pull[vec.name] = actual
	for vec in golden.state:
		var actual := run_state(vec, golden)
		compare("state", vec, actual)
		dump.state[vec.name] = actual
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--dump="):
			var f := FileAccess.open(arg.substr(7), FileAccess.WRITE)
			if f != null:
				f.store_string(JSON.stringify(dump))
				f.close()
	print("GS_BACKPACK_PARITY vectors=%d ops=%d checks=%d failures=%d" % [vectors, ops_run, checks, failures.size()])
	quit(1 if not failures.is_empty() else 0)
