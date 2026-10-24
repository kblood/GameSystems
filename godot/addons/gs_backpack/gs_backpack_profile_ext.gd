class_name GSBackpackProfileExt
extends RefCounted
## P2 additions to the profile contract, kept in a NEW file so GSBackpackProfile stays untouched: `kind` (pack | stash), the BackpackMount
## block on pockets (`mount`: acceptOnly, snapMode, returnDelayS), the optional top-level `bagMount`, and the materialisation limit
## (physicalItemsMax is an integer <= data.VIEW.MAX_PHYSICAL_PROXIES). Same rules as extensions/backpack/profile.js; the golden profile cases
## prove it. parse() strips the new fields, lets GSBackpackProfile validate the rest, then puts the normalised fields back.

const Profile = preload("res://addons/gs_backpack/gs_backpack_profile.gd")
const MOUNT_KEYS := ["acceptOnly", "snapMode", "returnDelayS"]
const STASH_FORBIDDEN := ["handle", "donZone", "recall", "dominantHand", "bagMount"]
const STASH_TIER_KEYS := ["proxyItems", "physicalItems", "physicalItemsMax"]

static func profile_kinds() -> Array: return Profile.data().get("PROFILE_KINDS", [])
static func snap_modes() -> Array: return Profile.data().get("MOUNT", {}).get("SNAP_MODES", [])

## {ok, error, profile}: like GSBackpackProfile.parse(), with the P2 fields.
static func parse(raw: Variant) -> Dictionary:
	if not raw is Dictionary: return Profile.parse(raw)
	var d: Dictionary = Profile.data()
	if d.is_empty(): return {"ok": false, "error": "shared data missing", "profile": {}}
	var p: Dictionary = raw.duplicate(true)
	var kind: Variant = p.get("kind", "pack")
	if not kind is String or not kind in profile_kinds(): return _bad("kind")
	var stash: bool = kind == "stash"
	if stash:
		for k in STASH_FORBIDDEN:
			if p.has(k): return _bad("%s: a stash is stationary" % k)
		if p.get("detachable") != false: return _bad("detachable: a stash is never detachable")
	var bag_mount: Dictionary = {}
	if p.has("bagMount"):
		var m: Dictionary = _mount(p.bagMount, "bagMount")
		if not String(m.error).is_empty(): return _bad(m.error)
		bag_mount = m.mount
	var base: Dictionary = p.duplicate(true)
	base.erase("kind")
	base.erase("bagMount")
	var pocket_mounts: Dictionary = {}
	if base.get("pockets") is Array:
		for i in base.pockets.size():
			var k: Variant = base.pockets[i]
			if k is Dictionary and k.has("mount"):
				var m: Dictionary = _mount(k.mount, "pockets[%d].mount" % i)
				if not String(m.error).is_empty(): return _bad(m.error)
				pocket_mounts[i] = m.mount
				k.erase("mount")
	if stash:
		var tiers: Variant = base.get("tiers", {})
		if tiers is Dictionary:
			for tier in tiers:
				if tiers[tier] is Dictionary:
					for flag in tiers[tier]:
						if d.get("TIERS", {}).get(tier, {}).has(flag) and not flag in STASH_TIER_KEYS: return _bad("tiers.%s.%s: a stash has no carry flags" % [tier, flag])
		base["handle"] = {"local": [0, 0, 0]}
		base["dominantHand"] = "right"
	var parsed: Dictionary = Profile.parse(base)
	if not bool(parsed.ok): return parsed
	var out: Dictionary = parsed.profile
	for tier in d.TIER_NAMES:
		var f: Dictionary = Profile.tier_flags(out, tier)
		var mx: float = float(f.physicalItemsMax)
		if not (mx <= float(d.VIEW.MAX_PHYSICAL_PROXIES)) or floorf(mx) != mx: return _bad("tiers.%s.physicalItemsMax: materialisation limit" % tier)
	out["kind"] = kind
	if stash:
		out.erase("handle")
		out.erase("dominantHand")
	if p.has("bagMount"): out["bagMount"] = bag_mount
	for i in pocket_mounts: out.pockets[i]["mount"] = pocket_mounts[i]
	return {"ok": true, "error": "", "profile": out}

## Materialisation limit of a tier: max physical proxies of an open container at once (0 = slot view only).
static func material_limit(profile: Dictionary, tier: String) -> int:
	var f: Dictionary = Profile.tier_flags(profile, tier)
	if not bool(f.get("enabled", false)) or not bool(f.get("physicalItems", false)): return 0
	return mini(int(f.physicalItemsMax), int(Profile.data().VIEW.MAX_PHYSICAL_PROXIES))

static func _bad(msg: String) -> Dictionary:
	return {"ok": false, "error": msg, "profile": {}}

## {error, mount}: validates and normalises a BackpackMount block (snapMode and returnDelayS get defaults).
static func _mount(raw: Variant, path: String) -> Dictionary:
	var d: Dictionary = Profile.data()
	if not raw is Dictionary: return {"error": path, "mount": {}}
	for k in raw:
		if not k in MOUNT_KEYS: return {"error": "%s: unknown key \"%s\"" % [path, k], "mount": {}}
	var m: Dictionary = raw.duplicate(true)
	if m.has("acceptOnly"):
		var a: Variant = m.acceptOnly
		if not a is Array or a.is_empty(): return {"error": path + ".acceptOnly", "mount": {}}
		var seen := {}
		for v in a:
			if not Profile._str(v) or seen.has(v): return {"error": path + ".acceptOnly", "mount": {}}
			seen[v] = true
	if not m.has("snapMode"): m["snapMode"] = d.MOUNT.DEFAULT_SNAP_MODE
	if not m.snapMode is String or not m.snapMode in d.MOUNT.SNAP_MODES: return {"error": path + ".snapMode", "mount": {}}
	if not m.has("returnDelayS"): m["returnDelayS"] = 0.0
	if not Profile._num(m.returnDelayS) or float(m.returnDelayS) < 0.0 or float(m.returnDelayS) > float(d.MOUNT.MAX_RETURN_DELAY_S): return {"error": path + ".returnDelayS", "mount": {}}
	return {"error": "", "mount": m}
