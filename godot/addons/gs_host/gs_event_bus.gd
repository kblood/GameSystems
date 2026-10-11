class_name GSEventBus
extends RefCounted
## Small synchronous event bus, port of GameSystems/extensions/host/events.js. A failing listener is reported and
## skipped, so one broken extension never stops an event from reaching the others. Godot signals stay local to nodes;
## cross-extension events go through this bus. Payloads are Dictionaries with the same keys as the JS events
## (snake_case): grab {owner, side, body, pose_id}, release {owner, side, body}, broken {body, at},
## disconnect {owner, handedness}, hand_tracking_changed {owner, handedness, hand}, xr_start {}, xr_end {}.

const ErrorTrap = preload("gs_error_trap.gd")

## Events the core game sends. Extensions may emit their own names too (prefix them with their id, e.g. &"avatar:ready").
const CORE_EVENTS: Array[StringName] = [&"grab", &"release", &"broken", &"xr_start", &"xr_end", &"disconnect", &"hand_tracking_changed"]
## Godot name -> JS name (extensions/host/events.js CORE_EVENTS), for tools that compare both engines.
const JS_NAMES := {&"grab": "grab", &"release": "release", &"broken": "broken", &"xr_start": "xrStart", &"xr_end": "xrEnd",
	&"disconnect": "disconnect", &"hand_tracking_changed": "handTrackingChanged"}

## Called as on_error.call(message: String, event: StringName) when a listener crashed (script error during the call).
var on_error: Callable = func(message: String, event: StringName) -> void: push_warning("Extension event '%s' failed: %s" % [event, message])

var _listeners := {} # StringName -> Array[Callable]

## Subscribe; returns an unsubscribe Callable.
func on(event: StringName, cb: Callable) -> Callable:
	if not cb.is_valid():
		on_error.call("on('%s') needs a valid Callable" % event, event)
		return func() -> void: pass
	var list: Array = _listeners.get(event, [])
	if list.is_empty(): _listeners[event] = list
	if not list.has(cb): list.append(cb)
	return off.bind(event, cb)

func off(event: StringName, cb: Callable) -> void:
	var list: Array = _listeners.get(event, [])
	list.erase(cb)
	if list.is_empty(): _listeners.erase(event)

## Calls every listener in subscription order. Returns how many listeners ran without a script error.
## Listeners whose object was freed are dropped silently.
func emit(event: StringName, data: Variant = {}) -> int:
	var list: Array = _listeners.get(event, [])
	if list.is_empty(): return 0
	var ok := 0
	for cb: Callable in list.duplicate(): # listeners may unsubscribe while handling the event
		if not cb.is_valid():
			off(event, cb)
			continue
		var before := ErrorTrap.count()
		cb.call(data)
		if before >= 0 and ErrorTrap.count() != before:
			on_error.call("listener %s crashed (script error)" % cb, event)
		else:
			ok += 1
	return ok

func count(event: StringName) -> int:
	return (_listeners.get(event, []) as Array).size()

func clear() -> void:
	_listeners.clear()
