class_name GSThermalSystem
extends RefCounted
## Bounded gameplay heat/fire model. It is intentionally not an airflow or chemistry solver.

const FIXED_STEP := 0.05
const MAX_CATCHUP_STEPS := 8
const MAX_FRAME_DELTA := FIXED_STEP * MAX_CATCHUP_STEPS
const MAX_OBJECTS := 256
const MAX_ROOMS := 64
const MAX_LINKS := 1024
const MAX_FUEL := 1000000.0
const AMBIENT_C := 20.0

var _rooms: Dictionary = {}
var _objects: Dictionary = {}
var _links: Array[Dictionary] = []
var _accumulator := 0.0
var _clock := 0.0


func add_room(id: StringName, values: Dictionary = {}) -> bool:
	if id == &"" or _rooms.size() >= MAX_ROOMS or _rooms.has(id): return false
	var temperature: Variant = values.get("temperature_c", AMBIENT_C)
	var oxygen: Variant = values.get("oxygen", 1.0)
	var smoke: Variant = values.get("smoke", 0.0)
	var vent: Variant = values.get("ventilation", 0.0)
	var capacity: Variant = values.get("heat_capacity_kj_c", 1000.0)
	if not _bounded(temperature, -273.15, 1000000.0) or not _bounded(oxygen, 0.0, 1.0) \
			or not _bounded(smoke, 0.0, 1000000.0) or not _bounded(vent, 0.0, 1.0) \
			or not _bounded(capacity, 0.1, 1.0e12): return false
	_rooms[id] = {"temperature_c": float(temperature), "oxygen": float(oxygen),
		"smoke": float(smoke), "ventilation": float(vent), "heat_capacity_kj_c": float(capacity)}
	return true


func configure_room(id: StringName, values: Dictionary) -> bool:
	if not _rooms.has(id): return false
	var current: Dictionary = _rooms[id]
	var staged := current.duplicate(true)
	for key: String in values:
		if not staged.has(key): return false
		staged[key] = values[key]
	if not _bounded(staged.temperature_c, -273.15, 1000000.0) or not _bounded(staged.oxygen, 0.0, 1.0) \
			or not _bounded(staged.smoke, 0.0, 1000000.0) or not _bounded(staged.ventilation, 0.0, 1.0) \
			or not _bounded(staged.heat_capacity_kj_c, 0.1, 1.0e12): return false
	if float(staged.temperature_c) + _room_remaining_heat(id) / float(staged.heat_capacity_kj_c) > 1000000.0:
		return false
	if float(staged.smoke) + _room_remaining_smoke(id) > 1000000.0: return false
	_rooms[id] = staged
	return true


func add_object(id: StringName, values: Dictionary) -> bool:
	if id == &"" or _objects.size() >= MAX_OBJECTS or _objects.has(id): return false
	var room_id := StringName(values.get("room_id", &""))
	if room_id != &"" and not _rooms.has(room_id): return false
	var position: Variant = values.get("position", Vector3.ZERO)
	var temperature: Variant = values.get("temperature_c", _room_temperature(room_id))
	var ignition: Variant = values.get("ignition_c", 260.0)
	var capacity: Variant = values.get("heat_capacity_kj_c", 1.0)
	var flammability: Variant = values.get("flammability", 1.0)
	var fuel: Variant = values.get("fuel", 0.0)
	var burn_rate: Variant = values.get("burn_rate", 0.0)
	var heat_yield: Variant = values.get("heat_kj_per_fuel", 1.0)
	var wetness: Variant = values.get("wetness", 0.0)
	if not position is Vector3 or not position.is_finite() \
			or not _bounded(temperature, -273.15, 1000000.0) or not _bounded(ignition, -273.15, 1000000.0) \
			or not _bounded(capacity, 0.001, 1.0e12) or not _bounded(flammability, 0.0, 1.0) \
			or not _bounded(fuel, 0.0, MAX_FUEL) or not _bounded(burn_rate, 0.0, MAX_FUEL) \
			or not _bounded(heat_yield, 0.0, 1.0e9) or not _bounded(wetness, 0.0, 1.0): return false
	var can_burn := float(flammability) > 0.0 and float(burn_rate) > 0.0
	var remaining_item_heat := float(fuel) * float(heat_yield) * 0.7 / float(capacity) if can_burn else 0.0
	if float(temperature) + remaining_item_heat > 1000000.0: return false
	if room_id != &"":
		var room: Dictionary = _rooms[room_id]
		var new_room_heat := float(fuel) * float(heat_yield) * 0.3 if can_burn else 0.0
		if float(room.temperature_c) + (_room_remaining_heat(room_id) + new_room_heat) / float(room.heat_capacity_kj_c) > 1000000.0: return false
		var new_smoke := float(fuel) * 0.002 if can_burn else 0.0
		if float(room.smoke) + _room_remaining_smoke(room_id) + new_smoke > 1000000.0: return false
	_objects[id] = {"room_id": room_id, "position": position, "temperature_c": float(temperature),
		"ignition_c": float(ignition), "heat_capacity_kj_c": float(capacity), "flammability": float(flammability),
		"fuel": float(fuel), "burn_rate": float(burn_rate), "heat_kj_per_fuel": float(heat_yield),
		"wetness": float(wetness), "foam_ml": 0.0, "burning": false}
	if temperature >= ignition: ignite(id)
	return true


func remove_object(id: StringName) -> bool:
	if not _objects.erase(id): return false
	for i in range(_links.size() - 1, -1, -1):
		if _links[i].a == id or _links[i].b == id: _links.remove_at(i)
	return true


func move_object(id: StringName, position: Vector3, room_id: StringName) -> bool:
	if not _objects.has(id) or not position.is_finite() or (room_id != &"" and not _rooms.has(room_id)):
		return false
	var item: Dictionary = _objects[id]
	var old_room: StringName = item.room_id
	if room_id != old_room and room_id != &"":
		var destination: Dictionary = _rooms[room_id]
		var can_burn := float(item.flammability) > 0.0 and float(item.burn_rate) > 0.0
		var added_heat := float(item.fuel) * float(item.heat_kj_per_fuel) * 0.3 if can_burn else 0.0
		var added_smoke := float(item.fuel) * 0.002 if can_burn else 0.0
		if float(destination.temperature_c) + (_room_remaining_heat(room_id) + added_heat) / float(destination.heat_capacity_kj_c) > 1000000.0 \
				or float(destination.smoke) + _room_remaining_smoke(room_id) + added_smoke > 1000000.0:
			return false
	item.position = position
	item.room_id = room_id
	return true


func link_objects(a: StringName, b: StringName, conductance: float) -> bool:
	if a == b or not _objects.has(a) or not _objects.has(b) or _links.size() >= MAX_LINKS \
			or not is_finite(conductance) or conductance <= 0.0 or conductance > 100.0:
		return false
	for link in _links:
		if (link.a == a and link.b == b) or (link.a == b and link.b == a): return false
	_links.append({"a": a, "b": b, "conductance": conductance})
	return true


func ignite(id: StringName) -> bool:
	if not _objects.has(id): return false
	var item: Dictionary = _objects[id]
	if item.burning or item.flammability <= 0.0 or item.fuel <= 0.0 or item.burn_rate <= 0.0 \
			or item.temperature_c < item.ignition_c or item.wetness >= 0.8 or item.foam_ml > 0.0:
		return false
	var room_id: StringName = item.room_id
	if room_id != &"" and _rooms[room_id].oxygen < 0.08: return false
	item.burning = true
	return true


func add_heat(id: StringName, energy_kj: float) -> bool:
	if not can_add_heat(id, energy_kj): return false
	var item: Dictionary = _objects[id]
	var next_temp := float(item.temperature_c) + energy_kj / float(item.heat_capacity_kj_c)
	item.temperature_c = next_temp
	if next_temp >= item.ignition_c: ignite(id)
	return true


func can_add_heat(id: StringName, energy_kj: float) -> bool:
	if not _objects.has(id) or not is_finite(energy_kj) or energy_kj <= 0.0: return false
	var item: Dictionary = _objects[id]
	var next_temp := float(item.temperature_c) + energy_kj / float(item.heat_capacity_kj_c)
	var remaining_burn_heat := float(item.fuel) * float(item.heat_kj_per_fuel) * 0.7 / float(item.heat_capacity_kj_c) \
		if float(item.flammability) > 0.0 and float(item.burn_rate) > 0.0 else 0.0
	return is_finite(next_temp) and next_temp + remaining_burn_heat <= 1000000.0


func apply_liquid(id: StringName, kind: StringName, amount_ml: float) -> float:
	if not _objects.has(id) or not is_finite(amount_ml) or amount_ml <= 0.0: return 0.0
	var item: Dictionary = _objects[id]
	match kind:
		&"water":
			var dose := minf(amount_ml, 100000.0)
			item.temperature_c = maxf(AMBIENT_C, float(item.temperature_c) - dose * 0.08 / float(item.heat_capacity_kj_c))
			item.wetness = minf(1.0, float(item.wetness) + dose / 250.0)
			if item.wetness >= 0.8 and item.burning:
				item.burning = false
			return dose
		&"foam":
			var dose := minf(amount_ml, 100000.0)
			item.foam_ml = minf(100000.0, float(item.foam_ml) + dose)
			if item.foam_ml >= 50.0 and item.burning: item.burning = false
			return dose
		_:
			return 0.0


## Advances at most eight 20 Hz ticks; remaining elapsed time is retained for a later call.
func step(delta: float) -> Dictionary:
	if not is_finite(delta) or delta < 0.0 or delta > MAX_FRAME_DELTA \
			or _accumulator + delta > MAX_FRAME_DELTA + 1.0e-9:
		return {"ok": false, "steps": 0, "pending_seconds": _accumulator, "events": []}
	_accumulator += delta
	var events: Array[Dictionary] = []
	var steps := 0
	while _accumulator + 1.0e-9 >= FIXED_STEP and steps < MAX_CATCHUP_STEPS:
		_tick(FIXED_STEP, events)
		_accumulator -= FIXED_STEP
		_clock += FIXED_STEP
		steps += 1
	return {"ok": true, "steps": steps, "pending_seconds": _accumulator, "events": events}


func _tick(dt: float, events: Array[Dictionary]) -> void:
	var room_energy: Dictionary = {}
	var room_smoke: Dictionary = {}
	var room_oxygen: Dictionary = {}
	for room_id: StringName in _rooms:
		room_energy[room_id] = 0.0
		room_smoke[room_id] = 0.0
		room_oxygen[room_id] = 0.0
	for id: StringName in _objects:
		var item: Dictionary = _objects[id]
		var room_id: StringName = item.room_id
		var ambient := _room_temperature(room_id)
		var temperature := float(item.temperature_c)
		var cooling := (temperature - ambient) * minf(0.25, dt * (0.04 + float(item.wetness) * 0.45))
		item.temperature_c = clampf(temperature - cooling, AMBIENT_C, 1000000.0)
		item.wetness = maxf(0.0, float(item.wetness) - dt * 0.002)
		item.foam_ml = maxf(0.0, float(item.foam_ml) - dt * 0.25)
		if not item.burning and item.temperature_c >= item.ignition_c: ignite(id)
		if not item.burning: continue
		var oxygen := 1.0 if room_id == &"" else float(_rooms[room_id].oxygen)
		if oxygen < 0.08 or item.fuel <= 0.0:
			item.burning = false
			events.append({"type": &"extinguished", "id": id, "reason": &"oxygen" if oxygen < 0.08 else &"fuel"})
			continue
		var foam_factor := 1.0 / (1.0 + float(item.foam_ml) / 50.0)
		var burned := minf(float(item.fuel), float(item.burn_rate) * dt * oxygen * foam_factor * float(item.flammability))
		if burned <= 0.0: continue
		item.fuel = maxf(0.0, float(item.fuel) - burned)
		var energy := burned * float(item.heat_kj_per_fuel)
		item.temperature_c = minf(1000000.0, float(item.temperature_c) + energy * 0.7 / float(item.heat_capacity_kj_c))
		if room_id != &"":
			room_energy[room_id] = float(room_energy[room_id]) + energy * 0.3
			room_smoke[room_id] = float(room_smoke[room_id]) + burned * 0.002
			room_oxygen[room_id] = float(room_oxygen[room_id]) + burned * 0.0005
		events.append({"type": &"burned", "id": id, "fuel": burned, "energy_kj": energy})
		if item.fuel <= 1.0e-9:
			item.burning = false
			events.append({"type": &"extinguished", "id": id, "reason": &"fuel"})
	for room_id: StringName in _rooms:
		var room: Dictionary = _rooms[room_id]
		var capacity := float(room.heat_capacity_kj_c)
		var vent := float(room.ventilation)
		room.temperature_c = clampf(float(room.temperature_c) + float(room_energy[room_id]) / capacity
			- (float(room.temperature_c) - AMBIENT_C) * vent * dt * 0.2, AMBIENT_C, 1000000.0)
		room.oxygen = clampf(float(room.oxygen) - float(room_oxygen[room_id]) + (1.0 - float(room.oxygen)) * vent * dt * 0.05, 0.0, 1.0)
		room.smoke = clampf(float(room.smoke) + float(room_smoke[room_id]) - float(room.smoke) * vent * dt * 0.1, 0.0, 1000000.0)
	var link_weights: Array[float] = []
	var weight_sums: Dictionary = {}
	for link in _links:
		var weight := minf(0.25, float(link.conductance) * dt)
		link_weights.append(weight)
		weight_sums[link.a] = float(weight_sums.get(link.a, 0.0)) + weight
		weight_sums[link.b] = float(weight_sums.get(link.b, 0.0)) + weight
	var thermal_energy_delta: Dictionary = {}
	for index in _links.size():
		var link: Dictionary = _links[index]
		var a: Dictionary = _objects[link.a]
		var b: Dictionary = _objects[link.b]
		var weight: float = link_weights[index]
		var sum_a := float(weight_sums[link.a])
		var sum_b := float(weight_sums[link.b])
		weight *= minf(1.0, minf(0.25 / sum_a, 0.25 / sum_b))
		var ca := float(a.heat_capacity_kj_c)
		var cb := float(b.heat_capacity_kj_c)
		var transfer := (float(a.temperature_c) - float(b.temperature_c)) / (1.0 / ca + 1.0 / cb) * weight
		thermal_energy_delta[link.a] = float(thermal_energy_delta.get(link.a, 0.0)) - transfer
		thermal_energy_delta[link.b] = float(thermal_energy_delta.get(link.b, 0.0)) + transfer
	for id: StringName in thermal_energy_delta:
		var item: Dictionary = _objects[id]
		item.temperature_c = clampf(float(item.temperature_c) + float(thermal_energy_delta[id]) / float(item.heat_capacity_kj_c),
			AMBIENT_C, 1000000.0)
		if item.temperature_c >= item.ignition_c: ignite(id)


func object_state(id: StringName) -> Dictionary:
	if not _objects.has(id): return {}
	var result: Dictionary = _objects[id].duplicate(true)
	result.position = result.position as Vector3
	return result


func room_state(id: StringName) -> Dictionary:
	return (_rooms.get(id, {}) as Dictionary).duplicate(true)


func stats() -> Dictionary:
	var burning := 0
	for item: Dictionary in _objects.values():
		if item.burning: burning += 1
	return {"objects": _objects.size(), "rooms": _rooms.size(), "links": _links.size(),
		"burning": burning, "clock": _clock, "pending_seconds": _accumulator}


func _room_temperature(room_id: StringName) -> float:
	return float(_rooms[room_id].temperature_c) if _rooms.has(room_id) else AMBIENT_C


func _room_remaining_heat(room_id: StringName) -> float:
	var energy := 0.0
	for item: Dictionary in _objects.values():
		if item.room_id == room_id and float(item.flammability) > 0.0 and float(item.burn_rate) > 0.0:
			energy += float(item.fuel) * float(item.heat_kj_per_fuel) * 0.3
	return energy


func _room_remaining_smoke(room_id: StringName) -> float:
	var smoke := 0.0
	for item: Dictionary in _objects.values():
		if item.room_id == room_id and float(item.flammability) > 0.0 and float(item.burn_rate) > 0.0:
			smoke += float(item.fuel) * 0.002
	return smoke


static func _bounded(value: Variant, low: float, high: float) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] and is_finite(float(value)) and float(value) >= low and float(value) <= high
