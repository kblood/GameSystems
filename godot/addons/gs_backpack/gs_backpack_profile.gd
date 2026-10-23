class_name GSBackpackProfile
extends RefCounted
## Reader and validator for the shared backpack contract (P1). Reads the same JSON the JS core reads
## (extensions/backpack/data/backpack.data.json and profiles such as profile.example.json) and applies the same rules as
## extensions/backpack/profile.js. Pure data: no scene access. The frame is the body-local frame of GSBackpackApproach
## (+X right, +Z behind, metres). lossPolicy has exactly one legal value, "never": the pack can never be lost.

const DATA_PATH := "res://addons/gs_backpack/data/backpack.data.json"
const EXAMPLE_PATH := "res://addons/gs_backpack/data/profile.example.json"
const DATA_SCHEMA := "gamesystems.backpack-data.v1"
const PROFILE_SCHEMA := "gamesystems.backpack-profile.v1"
const ACCESS := ["always", "worn", "open"]
const CONTAINERS := ["bag", "body"]
const HANDS := ["left", "right"]
const TOP_KEYS := ["schema", "id", "displayName", "detachable", "lossPolicy", "dominantHand", "handle", "donZone", "recall", "mass", "thresholds", "tiers", "pockets"]
const POCKET_KEYS := ["id", "container", "access", "categories", "maxSize", "capacity"]

static var _data_cache: Dictionary = {}

## The shared constants file (APPROACH, PULL, STATE, TIERS...). Cached; {} when missing or invalid.
static func data(path: String = DATA_PATH) -> Dictionary:
	if path == DATA_PATH and not _data_cache.is_empty(): return _data_cache
	if not FileAccess.file_exists(path):
		push_error("GSBackpackProfile: data file not found: %s" % path)
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not parsed is Dictionary or parsed.get("schema") != DATA_SCHEMA:
		push_error("GSBackpackProfile: invalid data file: %s" % path)
		return {}
	if path == DATA_PATH: _data_cache = parsed
	return parsed

static func tier_names() -> Array: return data().get("TIER_NAMES", [])
static func state_names() -> Array: return data().get("STATES", [])

static func load_file(path: String = EXAMPLE_PATH) -> Dictionary:
	if not FileAccess.file_exists(path): return {"ok": false, "error": "file not found", "profile": {}}
	return parse(JSON.parse_string(FileAccess.get_file_as_string(path)))

## {ok, error, profile}: a validated, normalised deep copy (defaults filled in), like parseProfile() in JS.
static func parse(raw: Variant) -> Dictionary:
	var err := _validate(raw)
	if not err.is_empty(): return {"ok": false, "error": err, "profile": {}}
	var p: Dictionary = _normalise(raw)
	return {"ok": true, "error": "", "profile": p}

static func thresholds_of(profile: Dictionary) -> Dictionary:
	var out: Dictionary = data().get("STATE", {}).duplicate(true)
	for k in profile.get("thresholds", {}): out[k] = profile.thresholds[k]
	return out

static func tier_flags(profile: Dictionary, tier: String) -> Dictionary:
	var base: Dictionary = data().get("TIERS", {}).get(tier, {}).duplicate(true)
	var over: Dictionary = profile.get("tiers", {}).get(tier, {})
	for k in over: base[k] = over[k]
	return base

static func canonical_size(size: Array) -> Array:
	var axes := [float(size[0]), float(size[1]), float(size[2])]
	axes.sort()
	axes.reverse()
	return axes

static func size_fits(item: Array, cavity: Array) -> bool:
	var a := canonical_size(item)
	var b := canonical_size(cavity)
	for i in 3:
		if a[i] > b[i] + 0.000001: return false
	return true

static func _normalise(raw: Dictionary) -> Dictionary:
	var p: Dictionary = raw.duplicate(true)
	if not p.handle.has("reachM"): p.handle["reachM"] = float(data().PULL.HANDLE_REACH_M)
	if not p.has("recall"): p["recall"] = {"seated": true}
	if not p.recall.has("seated"): p.recall["seated"] = true
	if not p.has("mass"): p["mass"] = {"emptyKg": 0.0}
	if not p.mass.has("emptyKg"): p.mass["emptyKg"] = 0.0
	if not p.has("thresholds"): p["thresholds"] = {}
	if not p.has("tiers"): p["tiers"] = {}
	return p

static func _num(v: Variant) -> bool:
	return (v is int or v is float) and is_finite(float(v))

static func _str(v: Variant) -> bool:
	return v is String and not v.strip_edges().is_empty()

static func _vec3(v: Variant) -> bool:
	if not v is Array or v.size() != 3: return false
	for x in v:
		if not _num(x): return false
	return true

static func _size3(v: Variant) -> bool:
	if not _vec3(v): return false
	for x in v:
		if float(x) <= 0.0: return false
	return true

static func _only_keys(obj: Dictionary, keys: Array, path: String) -> String:
	for k in obj:
		if not k in keys: return "%s: unknown key \"%s\"" % [path, k]
	return ""

## "" when valid, else the first problem (same rule order as parseProfile in profile.js).
static func _validate(p: Variant) -> String:
	var d := data()
	if d.is_empty(): return "shared data missing"
	if not p is Dictionary: return "profile: must be an object"
	var e := _only_keys(p, TOP_KEYS, "profile")
	if not e.is_empty(): return e
	if p.get("schema") != PROFILE_SCHEMA: return "schema"
	if not _str(p.get("id")): return "id"
	if not p.get("detachable") is bool: return "detachable"
	if p.get("lossPolicy") != "never": return "lossPolicy must be \"never\" (the pack can never be lost)"
	if not p.get("dominantHand") in HANDS: return "dominantHand"
	var handle: Variant = p.get("handle")
	if not handle is Dictionary: return "handle"
	e = _only_keys(handle, ["local", "reachM"], "handle")
	if not e.is_empty(): return e
	if not _vec3(handle.get("local")): return "handle.local"
	if handle.has("reachM") and (not _num(handle.reachM) or float(handle.reachM) <= 0.0): return "handle.reachM"
	if p.has("donZone"):
		if not p.donZone is Dictionary: return "donZone"
		e = _only_keys(p.donZone, ["local"], "donZone")
		if not e.is_empty(): return e
		if not _vec3(p.donZone.get("local")): return "donZone.local"
	if p.has("recall"):
		if not p.recall is Dictionary: return "recall"
		e = _only_keys(p.recall, ["seated"], "recall")
		if not e.is_empty(): return e
		if p.recall.has("seated") and not p.recall.seated is bool: return "recall.seated"
	if p.has("mass"):
		if not p.mass is Dictionary: return "mass"
		e = _only_keys(p.mass, ["emptyKg"], "mass")
		if not e.is_empty(): return e
		if p.mass.has("emptyKg") and (not _num(p.mass.emptyKg) or float(p.mass.emptyKg) < 0.0): return "mass.emptyKg"
	var thresholds: Variant = p.get("thresholds", {})
	if not thresholds is Dictionary: return "thresholds"
	for k in thresholds:
		if not d.STATE.has(k): return "thresholds.%s: unknown threshold" % k
		if not _num(thresholds[k]) or float(thresholds[k]) < 0.0: return "thresholds.%s" % k
	var th: Dictionary = d.STATE.duplicate(true)
	for k in thresholds: th[k] = thresholds[k]
	if not (float(th.openAccessFraction) > 0.0 and float(th.openAccessFraction) <= 1.0) or not (float(th.closeAccessFraction) >= 0.0 and float(th.closeAccessFraction) <= float(th.openAccessFraction)):
		return "thresholds: open/closeAccessFraction"
	if not (float(th.donEnterM) <= float(th.donExitM)): return "thresholds: donEnterM must not exceed donExitM"
	if not (float(th.releaseOffsetM) > float(d.PULL.PULL_DEADZONE_M) and float(th.releaseOffsetM) <= float(d.PULL.MAX_PULL_M)): return "thresholds.releaseOffsetM"
	if not (float(th.returnDurationS) > 0.0 and float(th.openDurationS) > 0.0 and float(th.maxStepS) > 0.0): return "thresholds: durations must be positive"
	var tiers: Variant = p.get("tiers", {})
	if not tiers is Dictionary: return "tiers"
	for tier in tiers:
		if not tier in d.TIER_NAMES: return "tiers.%s: unknown tier" % tier
		if not tiers[tier] is Dictionary: return "tiers.%s" % tier
		for k in tiers[tier]:
			if not d.TIERS[tier].has(k): return "tiers.%s.%s: unknown flag" % [tier, k]
			if typeof(tiers[tier][k]) != typeof(d.TIERS[tier][k]): return "tiers.%s.%s: wrong type" % [tier, k]
	var probe := {"thresholds": thresholds, "tiers": tiers}
	for tier in d.TIER_NAMES:
		var f := tier_flags(probe, tier)
		if bool(f.physicalItems) and tier != "high": return "tiers.%s.physicalItems: only allowed on tier high" % tier
		if bool(f.physicalItems) and not float(f.physicalItemsMax) >= 1.0: return "tiers.%s.physicalItemsMax" % tier
		if not bool(f.enabled) and (bool(f.pull) or bool(f.detach) or bool(f.open)): return "tiers.%s: disabled tier cannot enable pull/detach/open" % tier
		if bool(f.detach) and not bool(f.pull): return "tiers.%s: detach needs pull" % tier
		if bool(f.open) and not bool(f.detach): return "tiers.%s: open needs detach" % tier
	var pockets: Variant = p.get("pockets")
	if not pockets is Array or pockets.is_empty(): return "pockets"
	var seen := {}
	for i in pockets.size():
		var k: Variant = pockets[i]
		var at := "pockets[%d]" % i
		if not k is Dictionary: return at
		e = _only_keys(k, POCKET_KEYS, at)
		if not e.is_empty(): return e
		if not _str(k.get("id")) or "/" in String(k.id): return at + ".id"
		if seen.has(k.id): return at + ".id duplicate"
		seen[k.id] = true
		if not k.get("container") in CONTAINERS: return at + ".container"
		if not k.get("access") in ACCESS: return at + ".access"
		if k.container == "body" and k.access != "always": return at + ".access (body mounts are always accessible)"
		var cats: Variant = k.get("categories")
		if not cats is Array or cats.is_empty(): return at + ".categories"
		var cat_seen := {}
		for c in cats:
			if not _str(c) or cat_seen.has(c): return at + ".categories"
			cat_seen[c] = true
		if not _size3(k.get("maxSize")): return at + ".maxSize"
		var cap: Variant = k.get("capacity")
		if not _num(cap) or floorf(float(cap)) != float(cap) or float(cap) < 1.0: return at + ".capacity"
	return ""
