class_name GSBackpackStash
extends RefCounted
## P2: stationary container (chest, locker, wardrobe): the Godot twin of extensions/backpack/stash.js. Profile kind "stash", the same pockets and
## the same GSBackpackContainer as the backpack, with no carry states: only open/closed. Pockets with access "always" are always reachable,
## "open" and "worn" pockets only while the stash is open. Additive: it uses the provider as it is (NightfallGearInventory or the adapter's facade).

const BpContainer = preload("res://addons/gs_backpack/gs_backpack_container.gd")
const ProfileExt = preload("res://addons/gs_backpack/gs_backpack_profile_ext.gd")
const STASH_SCHEMA := "gamesystems.backpack-stash.v1"

var container: BpContainer
var profile: Dictionary = {}
var is_open := false
var _access: Dictionary = {}
var _emit: Callable

## options as GSBackpackContainer.configure() (can_access is replaced by the stash's own open/closed rule).
func configure(raw_profile: Variant, provider: Object, options: Dictionary = {}) -> bool:
	var parsed: Dictionary = ProfileExt.parse(raw_profile)
	if not bool(parsed.ok) or parsed.profile.kind != "stash": return false
	_emit = options.get("emit", Callable())
	_access = {}
	for k in parsed.profile.pockets: _access[k.id] = k.access
	var o: Dictionary = options.duplicate()
	o["can_access"] = Callable(self, "can_access")
	container = BpContainer.new()
	if not container.configure(raw_profile, provider, o): return false
	profile = container.profile
	is_open = false
	return true

func can_access(pocket_id: String) -> bool:
	var a: Variant = _access.get(pocket_id)
	return a == "always" or (a != null and is_open)

func open() -> Dictionary:
	if not is_open:
		is_open = true
		_note("backpack:stash_open")
		container.refresh()
	return {"ok": true, "reason": ""}

func close() -> Dictionary:
	if is_open:
		is_open = false
		_note("backpack:stash_closed")
		container.refresh()
	return {"ok": true, "reason": ""}

func capture() -> Dictionary:
	return {"schema": STASH_SCHEMA, "profileId": profile.id, "open": is_open, "backpack": container.capture_checkpoint()}

## {ok, reason, open, plan}: validates without mutation. Commit with commit_restore().
func prepare_restore(raw: Variant) -> Dictionary:
	var bad := {"ok": false, "reason": "invalid"}
	if not raw is Dictionary: return bad
	if raw.get("schema") != STASH_SCHEMA or raw.get("profileId") != profile.id or not raw.get("open") is bool: return bad
	var plan: Dictionary = container.prepare_checkpoint(raw.get("backpack"))
	if not bool(plan.ok): return bad
	return {"ok": true, "reason": "", "open": bool(raw.open), "plan": plan}

func commit_restore(prepared: Dictionary) -> bool:
	if not bool(prepared.get("ok", false)): return false
	if not container.commit_checkpoint(prepared.plan): return false
	is_open = bool(prepared.open)
	return true

func notify_restored(prepared: Dictionary) -> void:
	if bool(prepared.get("ok", false)): container.notify_checkpoint(prepared.plan)

func restore(raw: Variant) -> bool:
	var p: Dictionary = prepare_restore(raw)
	if not commit_restore(p): return false
	notify_restored(p)
	return true

func _note(type: String) -> void:
	if _emit.is_valid(): _emit.call(type, {"profileId": profile.id})
