class_name GSThermalPortalSystem
extends RefCounted
## Equal-volume gameplay room mixing. No pressure, direction, airflow or CFD.

const Thermal = preload("../gs_thermal/gs_thermal_system.gd")
const FIXED_STEP := 0.05
const MAX_PORTALS := 128
const MAX_ROOM_FRACTION := 0.25
const SCHEMA := "gamesystems.godot.thermal_portals.v1"
const CHANNELS := ["smoke_fraction", "oxygen_fraction", "heat_fraction"]

var _thermal: Thermal
var _portals: Dictionary = {}
var _max_portals := MAX_PORTALS
var _valid := false
var _revision := 0
var _ticks := 0


func _init(heat_system: Thermal, max_portals: int = MAX_PORTALS) -> void:
	if heat_system == null or max_portals < 1 or max_portals > MAX_PORTALS: return
	_thermal = heat_system
	_max_portals = max_portals
	_valid = true


func is_valid() -> bool:
	return _valid and is_instance_valid(_thermal)


## Fractions describe progress toward pair equilibrium per 50 ms tick at opening=1.
func add_portal(id: StringName, room_a: StringName, room_b: StringName, values: Dictionary = {}) -> bool:
	if not is_valid() or not _id_valid(id) or _portals.has(id) or _portals.size() >= _max_portals \
			or not _id_valid(room_a) or not _id_valid(room_b) or room_a == room_b \
			or _thermal.room_state(room_a).is_empty() or _thermal.room_state(room_b).is_empty(): return false
	if not _keys(values, ["opening", "smoke_fraction", "oxygen_fraction", "heat_fraction"], false): return false
	var opening: Variant = values.get("opening", 1.0)
	var smoke: Variant = values.get("smoke_fraction", 0.1)
	var oxygen: Variant = values.get("oxygen_fraction", 0.1)
	var heat: Variant = values.get("heat_fraction", 0.05)
	if not _bounded(opening, 0.0, 1.0) or not _bounded(smoke, 0.0, MAX_ROOM_FRACTION) \
			or not _bounded(oxygen, 0.0, MAX_ROOM_FRACTION) or not _bounded(heat, 0.0, MAX_ROOM_FRACTION): return false
	# Canonical undirected endpoints also make reversed authoring numerically identical.
	var a := room_a if String(room_a) < String(room_b) else room_b
	var b := room_b if a == room_a else room_a
	_portals[id] = {"a": a, "b": b, "opening": float(opening), "smoke_fraction": float(smoke),
		"oxygen_fraction": float(oxygen), "heat_fraction": float(heat)}
	_revision += 1
	return true


func set_opening(id: StringName, opening: Variant) -> bool:
	if not is_valid() or not _portals.has(id) or not _bounded(opening, 0.0, 1.0): return false
	if float(_portals[id].opening) == float(opening): return true
	_portals[id].opening = float(opening)
	_revision += 1
	return true


func remove_portal(id: StringName) -> bool:
	if not is_valid() or not _portals.erase(id): return false
	_revision += 1
	return true


func state(id: StringName) -> Dictionary:
	if not is_valid() or not _portals.has(id): return {}
	var result: Dictionary = _portals[id].duplicate()
	result["id"] = String(id)
	result.a = String(result.a)
	result.b = String(result.b)
	return result


## Host calls exactly once after each successful thermal 50 ms tick. No independent clock/debt.
## Snapshots and deltas are simultaneous; one public atomic batch commits all room changes.
func step(delta: float) -> Dictionary:
	var failure := {"ok": false, "portals": 0, "rooms": 0}
	if not is_valid() or not is_finite(delta) or absf(delta - FIXED_STEP) > 1.0e-9: return failure
	var ids := _ordered_ids()
	var rooms: Dictionary = {}
	var weights: Dictionary = {}
	var deltas: Dictionary = {}
	var active := 0
	for id: StringName in ids:
		var portal: Dictionary = _portals[id]
		for room_id: StringName in [portal.a, portal.b]:
			if rooms.has(room_id): continue
			var room := _thermal.room_state(room_id)
			if room.is_empty(): return failure
			rooms[room_id] = room
			weights[room_id] = [0.0, 0.0, 0.0]
			deltas[room_id] = [0.0, 0.0, 0.0]
		var weight := _weights(portal)
		for channel in range(3):
			weights[portal.a][channel] += weight[channel]
			weights[portal.b][channel] += weight[channel]
		if weight[0] > 0.0 or weight[1] > 0.0 or weight[2] > 0.0: active += 1
	for id: StringName in ids:
		var portal: Dictionary = _portals[id]
		var a: Dictionary = rooms[portal.a]
		var b: Dictionary = rooms[portal.b]
		var raw := _weights(portal)
		var sum_a: Array = weights[portal.a]
		var sum_b: Array = weights[portal.b]
		var weight := [_limit(raw[0], sum_a[0], sum_b[0]), _limit(raw[1], sum_a[1], sum_b[1]),
			_limit(raw[2], sum_a[2], sum_b[2])]
		# Air values are concentrations in equal-volume rooms; heat uses authored capacities.
		var smoke: float = (float(a.smoke) - float(b.smoke)) * 0.5 * weight[0]
		var oxygen: float = (float(a.oxygen) - float(b.oxygen)) * 0.5 * weight[1]
		var heat := (float(a.temperature_c) - float(b.temperature_c)) \
			/ (1.0 / float(a.heat_capacity_kj_c) + 1.0 / float(b.heat_capacity_kj_c)) * float(weight[2])
		var transfer := [smoke, oxygen, heat]
		for channel in range(3):
			deltas[portal.a][channel] -= transfer[channel]
			deltas[portal.b][channel] += transfer[channel]
	var patches: Dictionary = {}
	for room_id: StringName in rooms:
		var room: Dictionary = rooms[room_id]
		var change: Array = deltas[room_id]
		if change[0] == 0.0 and change[1] == 0.0 and change[2] == 0.0: continue
		patches[room_id] = {"smoke": float(room.smoke) + float(change[0]), "oxygen": float(room.oxygen) + float(change[1]),
			"temperature_c": float(room.temperature_c) + float(change[2]) / float(room.heat_capacity_kj_c)}
	# Native thermal validation includes finite values, bounds and reserved fuel heat/smoke.
	if not _thermal.configure_rooms_batch(patches): return failure
	_ticks += 1
	return {"ok": true, "portals": active, "rooms": patches.size()}


func stats() -> Dictionary:
	if not is_valid(): return {}
	return {"portals": _portals.size(), "max_portals": _max_portals, "ticks": _ticks,
		"fixed_step": FIXED_STEP, "max_room_fraction": MAX_ROOM_FRACTION}


## Saves only this adapter's authored topology/rates and live openings, not thermal room state.
func checkpoint() -> Dictionary:
	if not is_valid(): return {}
	var portals: Array[Dictionary] = []
	for id: StringName in _ordered_ids(): portals.append(state(id))
	return {"schema": SCHEMA, "portals": portals}


## Exact topology and rates must already exist. All validation completes before any opening changes.
func prepare_restore(payload: Variant) -> Dictionary:
	var failure := {"ok": false}
	if not is_valid(): return failure
	var data: Variant = payload
	if data is String:
		if data.length() > 65536: return failure
		var parser := JSON.new()
		if parser.parse(data) != OK: return failure
		data = parser.data
	if not data is Dictionary or not _keys(data, ["schema", "portals"], true) \
			or not data.schema is String or data.schema != SCHEMA or not data.portals is Array \
			or data.portals.size() != _portals.size(): return failure
	var openings: Dictionary = {}
	for row: Variant in data.portals:
		if not row is Dictionary or not _keys(row, ["id", "a", "b", "opening", "smoke_fraction", "oxygen_fraction", "heat_fraction"], true) \
				or not row.id is String or not row.a is String or not row.b is String \
				or not _id_valid(row.id) or not _bounded(row.opening, 0.0, 1.0): return failure
		var id := StringName(row.id)
		if not _portals.has(id) or openings.has(id): return failure
		var portal: Dictionary = _portals[id]
		if row.a != String(portal.a) or row.b != String(portal.b): return failure
		for channel: String in CHANNELS:
			if not _bounded(row[channel], 0.0, MAX_ROOM_FRACTION) or float(row[channel]) != float(portal[channel]): return failure
		openings[id] = float(row.opening)
	if not _rooms_live(): return failure
	var revision := _revision
	var plan := {"openings": openings, "used": false}
	return {"ok": true, "commit": func() -> bool: return _commit_restore(plan, revision)}


func restore_checkpoint(payload: Variant) -> bool:
	var plan := prepare_restore(payload)
	return plan.commit.call() if plan.ok else false


func dispose() -> void:
	_portals.clear()
	_thermal = null
	_valid = false
	_revision += 1


func _commit_restore(plan: Dictionary, revision: int) -> bool:
	if not is_valid() or plan.used or revision != _revision or not _rooms_live(): return false
	plan.used = true
	for id: StringName in plan.openings: _portals[id].opening = plan.openings[id]
	_revision += 1
	return true


func _rooms_live() -> bool:
	for portal: Dictionary in _portals.values():
		if _thermal.room_state(portal.a).is_empty() or _thermal.room_state(portal.b).is_empty(): return false
	return true


func _ordered_ids() -> Array:
	var ids := _portals.keys()
	ids.sort()
	return ids


static func _weights(portal: Dictionary) -> Array[float]:
	return [float(portal.smoke_fraction) * float(portal.opening),
		float(portal.oxygen_fraction) * float(portal.opening), float(portal.heat_fraction) * float(portal.opening)]


static func _limit(raw: float, a: float, b: float) -> float:
	return raw * minf(1.0, MAX_ROOM_FRACTION / maxf(MAX_ROOM_FRACTION, maxf(a, b)))


static func _id_valid(id: Variant) -> bool:
	return (id is String or id is StringName) and not String(id).strip_edges().is_empty() and String(id).length() <= 128


static func _bounded(value: Variant, low: float, high: float) -> bool:
	return (value is int or value is float) and is_finite(float(value)) and value >= low and value <= high


static func _keys(data: Dictionary, allowed: Array, exact: bool) -> bool:
	if exact and data.size() != allowed.size(): return false
	for key: Variant in data:
		if exact and not key is String: return false
		if not (key is String or key is StringName) or not allowed.has(String(key)): return false
	return true
