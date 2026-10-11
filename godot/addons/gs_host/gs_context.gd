class_name GSContext
extends RefCounted
## What one extension gets from GSHost (the JS ctx). Listeners registered through on() are removed when the
## extension is disposed; after that on() returns a no-op unsubscriber and emit() does nothing.

var id: StringName
var scene_root: Node
var camera: Node
var xr_origin: Node
var game: Variant
var physics: Object ## GSPhysicsAdapter (duck-typed) or null
var options: Dictionary ## options passed to GSHost.load_extension
var _host: Node # null once the extension is torn down

## Current tier of this extension (String), or null.
var quality: Variant:
	get: return _host.tier(id) if _host != null else null

func asset_path(path: String) -> String:
	return _host.asset_path(path) if _host != null else path

func emit(event: StringName, data: Variant = {}) -> int:
	return _host.emit(event, data) if _host != null else 0

func on(event: StringName, cb: Callable) -> Callable:
	return _host._context_on(self, event, cb) if _host != null else func() -> void: pass

## Public api of another ready extension, else null.
func get_ext(other: StringName) -> Variant:
	return _host.get_ext(other) if _host != null else null

## Report a failure (GDScript has no exceptions): the extension is disposed and the game keeps running.
func fail(reason: String) -> void:
	if _host != null: _host._context_fail(self, reason)
