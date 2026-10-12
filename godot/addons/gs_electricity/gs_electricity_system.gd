class_name GSElectricitySystem
extends RefCounted
## Bounded resistive DC network with finite batteries and replaceable fuses.

const CHECKPOINT_SCHEMA := "gamesystems.electricity.v1"
const MAX_COMPONENTS := 256
const MAX_NODES := 128
const MAX_STEP_SECONDS := 10.0
const EPSILON := 1.0e-10

var _components: Dictionary = {}
var _emit: Callable
var _max_components := MAX_COMPONENTS
var _max_nodes := MAX_NODES
var _dirty := true
var _disposed := false
var _phase := ""


func _init(emit: Callable = Callable(), max_components: int = MAX_COMPONENTS, max_nodes: int = MAX_NODES) -> void:
	_emit = emit
	if max_components > 0: _max_components = mini(max_components, MAX_COMPONENTS)
	if max_nodes > 0: _max_nodes = mini(max_nodes, MAX_NODES)


func add(id: StringName, config: Dictionary) -> Dictionary:
	if not _allowed("add"): return {}
	if id == &"" or _components.has(id): return {}
	if _components.size() >= _max_components: return {}
	var kind := StringName(config.get("kind", &"load"))
	if kind not in [&"source", &"battery", &"wire", &"switch", &"fuse", &"load"]: return {}
	var a := StringName(config.get("a", &""))
	var b := StringName(config.get("b", &""))
	if a == &"" or b == &"" or a == b: return {}
	var nodes := _terminal_ids()
	nodes[a] = true
	nodes[b] = true
	if nodes.size() > _max_nodes: return {}
	var resistance: Variant = config.get("resistance", 0.08 if kind == &"battery" else 10.0)
	var voltage: Variant = config.get("voltage", 12.0)
	var rating: Variant = config.get("rating", 2.0)
	var enabled: Variant = config.get("enabled", true)
	if not _positive(resistance) or not _finite(voltage) or not _positive(rating) or typeof(enabled) != TYPE_BOOL:
		return {}
	var component := {"id": id, "kind": kind, "a": a, "b": b,
		"resistance": float(resistance), "voltage": float(voltage), "enabled": enabled,
		"rating": float(rating), "blown": false, "current": 0.0, "power": 0.0, "volts": 0.0}
	if kind == &"battery":
		var capacity: Variant = config.get("capacity_wh", 600.0)
		var energy: Variant = config.get("energy_wh", capacity)
		if not _positive(capacity) or not _nonnegative(energy) or float(energy) > float(capacity) or not _positive(voltage):
			return {}
		component.merge({"capacity_wh": float(capacity), "energy_wh": float(energy),
			"initial_wh": float(energy), "charged_wh": 0.0, "supplied_wh": 0.0}, true)
	_components[id] = component
	_dirty = true
	return state(id)


func state(id: StringName) -> Dictionary:
	if not _is_live(): return {}
	if not _components.has(id): return {}
	return (_components[id] as Dictionary).duplicate(true)


func all() -> Array[Dictionary]:
	if not _is_live(): return []
	var result: Array[Dictionary] = []
	for id: StringName in _components: result.append(state(id))
	return result


func set_enabled(id: StringName, enabled: bool) -> bool:
	if not _allowed("set enabled"): return false
	if not _components.has(id): return false
	var component: Dictionary = _components[id]
	if bool(component.enabled) != enabled:
		component.enabled = enabled
		_dirty = true
	return true


func configure(id: StringName, changes: Dictionary) -> bool:
	if not _allowed("configure"): return false
	if not _components.has(id): return false
	var component: Dictionary = _components[id]
	var staged := component.duplicate(true)
	for key: Variant in changes:
		if key not in [&"resistance", &"voltage", &"rating", &"enabled"]: return false
		var value: Variant = changes[key]
		if key == &"enabled":
			if typeof(value) != TYPE_BOOL: return false
		elif key == &"voltage" and component.kind == &"battery":
			if not _positive(value): return false
		elif key == &"voltage":
			if not _finite(value): return false
		else:
			if not _positive(value): return false
		staged[key] = value
	_components[id] = staged
	_dirty = true
	return true


func replace_fuse(id: StringName) -> bool:
	if not _allowed("replace fuse"): return false
	if not _components.has(id) or _components[id].kind != &"fuse": return false
	_components[id].blown = false
	_dirty = true
	return true


func remove(id: StringName) -> bool:
	if not _allowed("remove"): return false
	if not _components.has(id): return false
	_components.erase(id)
	_dirty = true
	return true


func draw(id: StringName, wh: float) -> float:
	return _battery_energy(id, wh, false)


func charge(id: StringName, wh: float) -> float:
	return _battery_energy(id, wh, true)


func battery_adapter(id: StringName) -> RefCounted:
	if not _allowed("create battery adapter"): return null
	if not _components.has(id) or _components[id].kind != &"battery": return null
	var adapter := GSElectricityBatteryView.new(self, id)
	return adapter


func evaluate(silent := false) -> Dictionary:
	if not _allowed("evaluate"): return {"ok": false, "reason": &"unavailable"}
	return _evaluate(silent, "")


func step(seconds: float) -> Dictionary:
	if not _allowed("step"): return {"ok": false, "reason": &"unavailable"}
	if not _nonnegative(seconds) or seconds > MAX_STEP_SECONDS:
		return {"ok": false, "reason": &"step_budget"}
	_phase = "step"
	var energy_j: Dictionary = {}
	var remaining := seconds
	var failure: Variant = null
	var failed := false
	if _dirty:
		var solved := _evaluate(false, "step")
		if not solved.ok: failure = solved.get("error", &"solve_fault"); failed = true
	for pass_index in range(2 * _components.size() + 2):
		if remaining <= EPSILON: break
		var batteries: Array[StringName] = []
		for id: StringName in _components:
			var component: Dictionary = _components[id]
			if component.kind == &"battery" and component.enabled and absf(component.current) > EPSILON:
				batteries.append(id)
		var span := remaining
		for id: StringName in batteries:
			var battery: Dictionary = _components[id]
			var chemical_w := float(battery.voltage) * float(battery.current)
			var available := float(battery.energy_wh) if chemical_w < 0.0 else float(battery.capacity_wh) - float(battery.energy_wh)
			span = minf(span, available * 3600.0 / absf(chemical_w))
		if span <= 0.0:
			_dirty = true
			var recheck := _evaluate(false, "step")
			if not recheck.ok and not failed: failure = recheck.get("error", &"solve_fault"); failed = true
			continue
		for id: StringName in _components:
			var component: Dictionary = _components[id]
			energy_j[id] = float(energy_j.get(id, 0.0)) + float(component.power) * span
		for id: StringName in batteries:
			var battery: Dictionary = _components[id]
			var wh := float(battery.voltage) * float(battery.current) * span / 3600.0
			if wh < 0.0:
				battery.energy_wh = maxf(0.0, float(battery.energy_wh) + wh)
				battery.supplied_wh = float(battery.supplied_wh) - wh
			else:
				battery.energy_wh = minf(float(battery.capacity_wh), float(battery.energy_wh) + wh)
				battery.charged_wh = float(battery.charged_wh) + wh
			if float(battery.energy_wh) < 1.0e-12: battery.energy_wh = 0.0
			if float(battery.capacity_wh) - float(battery.energy_wh) < 1.0e-12: battery.energy_wh = battery.capacity_wh
		remaining = maxf(0.0, remaining - span)
		if remaining > EPSILON or _battery_at_boundary(batteries):
			_dirty = true
			var boundary_solve := _evaluate(false, "step")
			if not boundary_solve.ok and not failed: failure = boundary_solve.get("error", &"solve_fault"); failed = true
	if remaining > 1.0e-8:
		_phase = ""
		return {"ok": false, "reason": &"battery_boundary_budget", "seconds": seconds, "energy_j": energy_j}
	var result := {"ok": not failed, "seconds": seconds, "energy_j": energy_j}
	if _emit.is_valid():
		var observer_result: Variant = _emit.call(&"electricity:energy", {"seconds": seconds, "energy_j": energy_j.duplicate(true)})
		if observer_result is Dictionary and not observer_result.get("ok", true):
			result.ok = false
			result.error = observer_result.get("error", &"observer_error")
	_phase = ""
	return result


func checkpoint() -> Dictionary:
	if not _allowed("checkpoint"): return {}
	if _dirty:
		var solved := _evaluate(true, "")
		if not solved.ok: return {}
	var rows := all()
	for row: Dictionary in rows:
		row.id = str(row.id)
		row.a = str(row.a)
		row.b = str(row.b)
	return {"schema": CHECKPOINT_SCHEMA, "components": rows}


func restore_checkpoint(payload: Variant) -> bool:
	var staged := prepare_restore(payload)
	if staged.is_empty(): return false
	var commit: Callable = staged.get("commit", Callable())
	if not commit.is_valid() or not commit.call(): return false
	var notify: Callable = staged.get("notify", Callable())
	if notify.is_valid(): notify.call()
	return true


func prepare_restore(payload: Variant) -> Dictionary:
	if not _allowed("prepare restore"): return {}
	if not payload is Dictionary or payload.get("schema") != CHECKPOINT_SCHEMA \
			or not payload.get("components") is Array or payload.components.size() != _components.size():
		return {}
	var staged: Dictionary = {}
	for saved: Variant in payload.components:
		if not saved is Dictionary: return {}
		if typeof(saved.get("id")) != TYPE_STRING or typeof(saved.get("a")) != TYPE_STRING \
				or typeof(saved.get("b")) != TYPE_STRING:
			return {}
		var id := StringName(saved.id)
		if not _components.has(id) or staged.has(id): return {}
		var current: Dictionary = _components[id]
		if saved.get("kind") != current.kind or StringName(saved.a) != current.a \
				or StringName(saved.b) != current.b:
			return {}
		var resistance: Variant = saved.get("resistance", NAN)
		var voltage: Variant = saved.get("voltage", NAN)
		var rating: Variant = saved.get("rating", NAN)
		var enabled: Variant = saved.get("enabled")
		var blown: Variant = saved.get("blown")
		if not _positive(resistance) or not _positive(rating) or typeof(enabled) != TYPE_BOOL \
				or typeof(blown) != TYPE_BOOL:
			return {}
		if (current.kind == &"battery" and not _positive(voltage)) or (current.kind != &"battery" and not _finite(voltage)):
			return {}
		if blown and current.kind != &"fuse": return {}
		var next := current.duplicate(true)
		next.resistance = float(resistance)
		next.voltage = float(voltage)
		next.rating = float(rating)
		next.enabled = enabled
		next.blown = blown
		next.current = 0.0
		next.power = 0.0
		next.volts = 0.0
		if current.kind == &"battery":
			for key: StringName in [&"capacity_wh", &"initial_wh"]:
				if not _nonnegative(saved.get(key, NAN)) or not is_equal_approx(float(saved[key]), float(current[key])): return {}
			for key: StringName in [&"energy_wh", &"charged_wh", &"supplied_wh"]:
				if not _nonnegative(saved.get(key, NAN)): return {}
				next[key] = float(saved[key])
			if float(next.energy_wh) > float(current.capacity_wh) \
					or absf(float(current.initial_wh) + float(next.charged_wh) - float(next.supplied_wh) - float(next.energy_wh)) > 1.0e-7:
				return {}
		staged[id] = next
	var commit := func() -> bool:
		if _disposed or not _phase.is_empty(): return false
		_components = staged.duplicate(true)
		_dirty = true
		_phase = "restore"
		_evaluate(true, "restore")
		_phase = ""
		return true
	var notify := func() -> Dictionary: return evaluate()
	return {"commit": commit, "notify": notify}


func dispose() -> void:
	if _disposed: return
	if not _allowed("dispose"): return
	_components.clear()
	_disposed = true


func _evaluate(silent: bool, owner: String) -> Dictionary:
	if _disposed: return {"ok": false, "reason": &"disposed"}
	if not _phase.is_empty() and _phase != owner:
		return {"ok": false, "reason": &"reentrant"}
	var previous := _phase
	_phase = "evaluate"
	var fault := ""
	var blocked: Dictionary = {}
	for pass_index in range(_components.size() + 1):
		var active: Array[StringName] = []
		for id: StringName in _components:
			var component: Dictionary = _components[id]
			if component.enabled and not component.blown and not blocked.has(id): active.append(id)
		for id: StringName in _components:
			_components[id].current = 0.0
			_components[id].power = 0.0
			_components[id].volts = 0.0
		var adjacent: Dictionary = {}
		for id: StringName in active:
			var component: Dictionary = _components[id]
			for pair: Array in [[component.a, component.b], [component.b, component.a]]:
				if not adjacent.has(pair[0]): adjacent[pair[0]] = []
				if pair[1] not in adjacent[pair[0]]: adjacent[pair[0]].append(pair[1])
		var seen: Dictionary = {}
		var sources_for_pass: Array[StringName] = []
		for start: StringName in adjacent:
			if seen.has(start): continue
			var queue: Array[StringName] = [start]
			var component_nodes: Array[StringName] = []
			seen[start] = true
			var cursor := 0
			while cursor < queue.size():
				var node := queue[cursor]
				cursor += 1
				component_nodes.append(node)
				for neighbor: StringName in adjacent[node]:
					if not seen.has(neighbor): seen[neighbor] = true; queue.append(neighbor)
			var node_set: Dictionary = {}
			for node: StringName in component_nodes: node_set[node] = true
			var group: Array[StringName] = []
			var sources: Array[StringName] = []
			for id: StringName in active:
				var component: Dictionary = _components[id]
				if node_set.has(component.a):
					group.append(id)
					if component.kind in [&"source", &"battery"]: sources.append(id)
			if sources.is_empty(): continue
			for id: StringName in sources: sources_for_pass.append(id)
			var solved := _solve_component(component_nodes, group, sources)
			if not solved.ok:
				fault = str(solved.error)
				if not silent: _publish(&"electricity:fault", {"nodes": component_nodes.duplicate(), "message": fault})
				continue
		var limited_source: StringName = &""
		for id: StringName in sources_for_pass:
			var source: Dictionary = _components[id]
			if source.kind != &"battery": continue
			if (float(source.energy_wh) <= 0.0 and float(source.current) < -EPSILON) \
					or (float(source.energy_wh) >= float(source.capacity_wh) and float(source.current) > EPSILON):
				limited_source = id
				break
		if limited_source != &"":
			# Block only one limited source per solve to preserve lower-voltage battery order.
			blocked[limited_source] = true
			continue
		var tripped := false
		for id: StringName in active:
			var component: Dictionary = _components[id]
			if component.kind == &"fuse" and absf(float(component.current)) > float(component.rating):
				component.blown = true
				tripped = true
				if not silent: _publish(&"electricity:fuse-blown", {"id": id, "current": component.current, "rating": component.rating})
		if tripped: continue
		_dirty = false
		if not silent:
			for id: StringName in _components: _publish(&"electricity:changed", state(id))
		_phase = previous
		return {"ok": true, "fault": fault, "components": all()}
	_dirty = true
	_phase = previous
	return {"ok": false, "reason": &"solve_budget", "fault": fault}


func _solve_component(nodes: Array[StringName], group: Array[StringName], sources: Array[StringName]) -> Dictionary:
	var ground := StringName(_components[sources[0]].b)
	var unknown_nodes: Array[StringName] = []
	for node: StringName in nodes:
		if node != ground: unknown_nodes.append(node)
	var indices: Dictionary = {}
	for index in range(unknown_nodes.size()): indices[unknown_nodes[index]] = index
	var source_index := unknown_nodes.size()
	var size := unknown_nodes.size() + sources.size()
	var matrix: Array = []
	var rhs: Array[float] = []
	for _row in range(size):
		matrix.append([])
		for _col in range(size): matrix.back().append(0.0)
		rhs.append(0.0)
	for id: StringName in group:
		var component: Dictionary = _components[id]
		if component.kind in [&"source", &"battery"]: continue
		var a_index: int = int(indices.get(component.a, -1))
		var b_index: int = int(indices.get(component.b, -1))
		var conductance := 1.0 / float(component.resistance)
		if a_index >= 0: matrix[a_index][a_index] += conductance
		if b_index >= 0: matrix[b_index][b_index] += conductance
		if a_index >= 0 and b_index >= 0:
			matrix[a_index][b_index] -= conductance
			matrix[b_index][a_index] -= conductance
	for source_number in range(sources.size()):
		var id := sources[source_number]
		var component: Dictionary = _components[id]
		var a_index: int = int(indices.get(component.a, -1))
		var b_index: int = int(indices.get(component.b, -1))
		var branch := source_index + source_number
		if a_index >= 0: matrix[a_index][branch] += 1.0; matrix[branch][a_index] += 1.0
		if b_index >= 0: matrix[b_index][branch] -= 1.0; matrix[branch][b_index] -= 1.0
		if component.kind == &"battery": matrix[branch][branch] = -float(component.resistance)
		rhs[branch] = float(component.voltage)
	var solution := _linear_solve(matrix, rhs)
	if not solution.ok: return solution
	var values: Array = solution.values
	for id: StringName in group:
		var component: Dictionary = _components[id]
		var volts := (0.0 if component.a == ground else float(values[indices[component.a]])) \
			- (0.0 if component.b == ground else float(values[indices[component.b]]))
		var source_number := sources.find(id)
		var current := float(values[source_index + source_number]) if source_number >= 0 else volts / float(component.resistance)
		component.volts = volts
		component.current = current
		component.power = volts * current
	return {"ok": true}


func _linear_solve(matrix: Array, rhs: Array[float]) -> Dictionary:
	var count := rhs.size()
	var augmented: Array = []
	for row in range(count):
		var values: Array = matrix[row].duplicate()
		values.append(rhs[row])
		augmented.append(values)
	for column in range(count):
		var pivot := column
		for row in range(column + 1, count):
			if absf(float(augmented[row][column])) > absf(float(augmented[pivot][column])): pivot = row
		if absf(float(augmented[pivot][column])) < 1.0e-10:
			return {"ok": false, "error": &"singular_circuit"}
		var swap: Array = augmented[column]
		augmented[column] = augmented[pivot]
		augmented[pivot] = swap
		var divisor := float(augmented[column][column])
		for item in range(column, count + 1): augmented[column][item] = float(augmented[column][item]) / divisor
		for row in range(count):
			if row == column: continue
			var factor := float(augmented[row][column])
			for item in range(column, count + 1): augmented[row][item] = float(augmented[row][item]) - factor * float(augmented[column][item])
	var result: Array[float] = []
	for row in range(count):
		var value := float(augmented[row][count])
		if not is_finite(value): return {"ok": false, "error": &"unstable_circuit"}
		result.append(value)
	return {"ok": true, "values": result}


func _battery_energy(id: StringName, wh: float, charging: bool) -> float:
	if not _allowed("charge battery" if charging else "draw battery"): return 0.0
	if not _nonnegative(wh) or not _components.has(id) or _components[id].kind != &"battery": return 0.0
	var component: Dictionary = _components[id]
	if not component.enabled: return 0.0
	var actual := minf(wh, float(component.capacity_wh) - float(component.energy_wh) if charging else float(component.energy_wh))
	component.energy_wh += actual if charging else -actual
	component.charged_wh += actual if charging else 0.0
	component.supplied_wh += actual if not charging else 0.0
	_dirty = true
	return actual


func _battery_at_boundary(ids: Array[StringName]) -> bool:
	for id: StringName in ids:
		var battery: Dictionary = _components[id]
		if float(battery.energy_wh) == 0.0 or float(battery.energy_wh) == float(battery.capacity_wh): return true
	return false


func _terminal_ids() -> Dictionary:
	var result: Dictionary = {}
	for component: Dictionary in _components.values():
		result[component.a] = true
		result[component.b] = true
	return result


func _publish(event: StringName, payload: Dictionary) -> void:
	if _emit.is_valid(): _emit.call(event, payload.duplicate(true))


func _allowed(_operation: String) -> bool:
	if not _is_live(): return false
	return _phase.is_empty()


func _is_live() -> bool:
	return not _disposed


static func _finite(value: Variant) -> bool:
	return typeof(value) in [TYPE_FLOAT, TYPE_INT] and is_finite(float(value))


static func _nonnegative(value: Variant) -> bool:
	return _finite(value) and float(value) >= 0.0


static func _positive(value: Variant) -> bool:
	return _finite(value) and float(value) > 0.0


class GSElectricityBatteryView:
	extends RefCounted
	var _system: GSElectricitySystem
	var _id: StringName
	func _init(system: GSElectricitySystem, id: StringName) -> void:
		_system = system
		_id = id
	func state() -> Dictionary:
		var value: Dictionary = _system.state(_id)
		value.voltage = float(value.voltage) if value.enabled and float(value.energy_wh) > 0.0 else 0.0
		return value
	func draw(wh: float) -> float:
		return _system.draw(_id, wh)
	func charge(wh: float) -> float:
		return _system.charge(_id, wh)
