extends SceneTree

const Store = preload("../gs_puddle_store.gd")
const Manager = preload("../bottle_break_manager.gd")
const Pour = preload("../bottle_pour.gd")
const Bottle = preload("../breakable_bottle.gd")
const Leak = preload("../leak_stream.gd")
class PourBody extends RigidBody3D:
	var ctl: GSBottleLiquid
class SilentBottle extends GSBreakableBottle:
	func _ready() -> void: pass
var checks := 0
var failures := 0

func check(value: bool, message: String) -> void:
	checks += 1
	if not value:
		failures += 1
		push_error(message)

func balanced(state: Dictionary) -> bool:
	return absf(float(state.added_ml) - (float(state.held_ml) + float(state.consumed_ml)
		+ float(state.evaporated_ml) + float(state.removed_ml) + float(state.get("airborne_ml", 0.0)))) < 0.00001

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var store := Store.new()
	store.limit = 2
	var id := store.create()
	check(store.deposit(id, &"petrol", 100.0) == 100.0 and store.deposit(id, &"water", 40.0) == 40.0,
		"typed deposits preserve both fuel and extinguishing liquid")
	check(store.components(id) == {"petrol": 100.0, "water": 40.0}, "mixing retains separate components")
	var detached := store.components(id)
	detached.petrol = 999.0
	check(store.components(id).petrol == 100.0, "host cannot mutate storage through component views")
	check(store.withdraw(id, &"diesel", 200.0) == 0.0 and store.withdraw(id, &"petrol", 30.0) == 30.0,
		"consumption removes only the requested chemical")
	check(store.evaporate(id, &"water", 10.0) == 10.0 and balanced(store.ledger()),
		"partial evaporation and fuel consumption conserve actual volume")
	var original := store.snapshot()
	var restored := Store.new()
	restored.limit = 2
	check(restored.restore(JSON.parse_string(JSON.stringify(original))) and restored.snapshot() == original,
		"JSON checkpoint restores stable IDs, components and terminal sinks")
	var corrupt := original.duplicate(true)
	corrupt.ledger.added_ml += 1.0
	check(not restored.restore(corrupt) and restored.snapshot() == original, "imbalanced restore is atomic")
	corrupt = original.duplicate(true)
	corrupt.records.append(corrupt.records[0].duplicate(true))
	check(not restored.restore(corrupt) and restored.snapshot() == original, "duplicate ID restore is atomic")
	corrupt = original.duplicate(true)
	corrupt.records[0].components.petrol = NAN
	check(not restored.restore(corrupt), "non-finite snapshot component is rejected")
	check(store.deposit(9999, &"petrol", 7.0) == 0.0 and balanced(store.ledger()),
		"invalid destination accepts nothing and accounts owned incoming liquid as removal")
	check(store.deposit(id, &"petrol", INF) == 0.0 and store.withdraw(id, &"water", -1.0) == 0.0,
		"invalid resource operations cannot mint or consume liquid")
	store.create()
	store.create()
	check(not store.contains(id) and store.ledger().removed_ml == 107.0 and balanced(store.ledger()),
		"bounded storage explicitly retires the oldest remaining 100 mL")
	var capped := Store.new()
	var cap_id := capped.create()
	for i in Store.MAX_COMPONENTS: capped.deposit(cap_id, StringName("kind_%d" % i), 1.0)
	check(capped.deposit(cap_id, &"extra", 2.0) == 0.0 and capped.components(cap_id).size() == Store.MAX_COMPONENTS
		and capped.ledger().removed_ml == 2.0 and balanced(capped.ledger()), "component budget has an explicit removal sink")
	var volume_store := Store.new()
	var volume_id := volume_store.create()
	volume_store.deposit(volume_id, &"petrol", Store.MAX_VOLUME_ML)
	check(volume_store.deposit(volume_id, &"petrol", 5.0) == 0.0 and balanced(volume_store.ledger()),
		"finite per-puddle volume budget conserves rejected volume")

	var scene := Node3D.new()
	root.add_child(scene)
	current_scene = scene
	var manager: GSBottleBreakManager = Manager.get_for(scene)
	await process_frame
	manager.set_physics_process(false)
	manager.puddle_decals = false
	var fuel_id := manager.add_puddle(Vector3.ZERO, Vector3.UP, 100.0, Color.RED, &"petrol")
	manager.add_puddle(Vector3.ZERO, Vector3.UP, 50.0, Color.BLUE, &"water")
	check(manager._puddles.size() == 1 and manager.puddle_store.components(fuel_id) == {"petrol": 100.0, "water": 50.0},
		"physical puddle merge preserves typed mixture despite different colors")
	manager.puddle_life = 0.0
	manager.puddle_evaporate_time = 2.0
	manager._step_puddles(1.0)
	check(is_equal_approx(manager.puddle_store.components(fuel_id).water, 25.0)
		and manager.puddle_store.components(fuel_id).petrol == 100.0 and balanced(manager.liquid_ledger()),
		"legacy water evaporation is ledgered while petrol remains permanent")
	manager._step_puddles(1.0)
	check(manager.puddle_store.components(fuel_id) == {"petrol": 100.0}, "visual expiry does not discard stored fuel")
	var unknown_id := manager.add_puddle(Vector3(3, 0, 0), Vector3.UP, 10.0, Color.RED)
	check(manager.puddle_store.withdraw(unknown_id, &"petrol", 10.0) == 0.0, "fuel-colored unknown liquid never becomes petrol")
	manager._step_puddles(2.0)
	check(not manager.puddle_store.contains(unknown_id) and balanced(manager.liquid_ledger()),
		"legacy unknown puddle evaporates with a terminal volume receipt")
	check(manager.puddle_store.withdraw(fuel_id, &"petrol", 20.0) == 20.0, "fire adapter seam consumes actual mL")
	manager.emit_droplet(Vector3(0, 2, 0), Vector3.ZERO, 3.0, Color.GREEN, &"diesel")
	var checkpoint := manager.capture_liquid()
	check(checkpoint.droplets[0].kind == "diesel" and balanced(manager.liquid_ledger()),
		"checkpoint includes captured airborne liquid identity and amount")
	check(manager.restore_liquid(JSON.parse_string(JSON.stringify(checkpoint))) and balanced(manager.liquid_ledger())
		and manager.puddle_store.components(fuel_id).petrol == 80.0 and manager.live_droplets == 1,
		"liquid checkpoint restores physical storage and flight without duplication")
	var stable := manager.capture_liquid()
	corrupt = stable.duplicate(true)
	corrupt.droplets[0].ml += 1.0
	check(not manager.restore_liquid(corrupt) and manager.capture_liquid() == stable, "corrupt flight restore leaves live state unchanged")
	corrupt = stable.duplicate(true)
	corrupt.puddles[0].normal = [0, 0, 0]
	check(not manager.restore_liquid(corrupt) and manager.capture_liquid() == stable, "corrupt geometry restore is atomic")
	# Register a real floor and let the restored diesel droplet hit it.
	var floor := StaticBody3D.new()
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(100, 0.2, 100)
	collision.shape = shape
	floor.add_child(collision)
	scene.add_child(floor)
	floor.position.y = -0.1
	manager.set_physics_process(false)
	await physics_frame
	manager._step_droplets(1.0)
	check(manager.live_droplets == 0 and manager.puddle_store.components(fuel_id).diesel == 3.0
		and balanced(manager.liquid_ledger()), "ray-tested droplet landing transfers identity without counting volume twice")
	manager.set_physics_process(false)
	for i in 4: manager.add_puddle(Vector3(float(i + 1) * 3.0, 0, 0), Vector3.UP, 10.0, Color.WHITE, &"foam")
	var removed_before: float = manager.liquid_ledger().removed_ml
	manager.set_quality(Manager.Quality.MINIMAL)
	check(manager._puddles.size() == 2 and manager.liquid_ledger().removed_ml > removed_before
		and balanced(manager.liquid_ledger()), "quality downgrade respects bounds and receipts every removed component")
	for i in 15: manager.emit_droplet(Vector3(0, 3, 0), Vector3.ZERO, 1.0, Color.BLUE, &"water")
	check(manager.live_droplets == 12 and balanced(manager.liquid_ledger()), "recycled droplet pool explicitly accounts replaced fluid")
	manager.clear_debris()
	check(manager.live_droplets == 0 and manager._puddles.is_empty() and manager.liquid_ledger().held_ml == 0.0
		and balanced(manager.liquid_ledger()), "scene cleanup retires all liquid without disappearing volume")
	manager.set_quality(Manager.Quality.HIGH)
	manager.set_physics_process(false)
	var pouring: GSBottlePour = Pour.new()
	var pour_body := PourBody.new()
	scene.add_child(pour_body)
	pour_body.add_child(pouring)
	pouring._splash_k = 2
	pouring._land(Vector3.ZERO, Vector3.UP, 4.0, Color.CYAN, null, [], 0.5, &"petrol")
	var landed: Dictionary = manager.puddle_store.components(int(manager._puddles.back().id))
	check(landed.has("petrol") and manager._dkind[manager._dnext - 1] == &"petrol" and balanced(manager.liquid_ledger()),
		"pour spill threads its captured kind into puddle and splash parcels")
	pour_body.queue_free()
	var bottle: GSBreakableBottle = Bottle.new()
	bottle.spill_liquid_kind = &"diesel"
	check(bottle._spill_kind() == &"diesel", "host-authored bottle identity is available without pour adapter")
	var attached: GSBottlePour = Pour.new()
	attached.liquid_kind = &"petrol"
	bottle.add_child(attached)
	check(bottle._spill_kind() == &"petrol", "break spill follows attached pour contents instead of original style")
	bottle.free()
	var stream: GSBottleLeakStream = Leak.acquire(manager, RID(), 1)
	stream.set_physics_process(false)
	stream._has_path = true
	stream.t_land = 0.0
	stream.landed = true
	stream.land_pos = Vector3(20, 0, 0)
	stream.feed(Vector3.ZERO, Vector3.ZERO, 0.00001, 1.0, Color.RED, &"petrol")
	stream.feed(Vector3.ZERO, Vector3.ZERO, 0.00001, 2.0, Color.BLUE, &"water")
	check(stream._fifo_kind[0] == &"petrol" and stream._acc_kind == &"water", "HIGH leak FIFO captures chemical changes separately")
	check(manager.capture_liquid().is_empty() and not manager.restore_liquid(checkpoint),
		"liquid-only checkpoint refuses uncaptured live hole streams")
	stream._physics_process(0.1)
	var leaked: Dictionary = manager.puddle_store.components(int(manager._puddles.back().id))
	var airborne_water := 0.0
	for i in Manager.DROPLET_POOL:
		if manager._dalive[i] == 1 and manager._dkind[i] == &"water": airborne_water += manager._dvol[i]
	check(leaked.get("petrol", 0.0) == 1.0 and is_equal_approx(float(leaked.get("water", 0.0)) + airborne_water, 2.0)
		and balanced(manager.liquid_ledger()),
		"HIGH leak delivery preserves both queued kinds and volume")
	stream._finish()
	manager.clear_debris()
	manager.set_physics_process(false)
	Leak.reset_ledger()
	var moving: GSBottleLeakStream = Leak.acquire(manager, RID(), 1)
	moving.set_physics_process(false)
	moving.feed(Vector3(-10, 1, 0), Vector3.ZERO, 0.00000001, 2.0, Color.RED, &"petrol")
	var old_endpoint := moving.land_pos
	var old_normal := moving.land_n
	var old_delay := moving.t_land
	moving.feed(Vector3(10, 3, 0), Vector3.ZERO, 0.00000001, 3.0, Color.RED, &"petrol")
	check(moving._fifo_landing.size() == 1 and moving._fifo_landing[0].position == old_endpoint
		and moving._fifo_landing[0].normal == old_normal and is_equal_approx(moving._fifo_t[0], old_delay),
		"source motion flushes its previous accumulated volume with old endpoint/normal/delay")
	moving._flush_accumulator()
	check(moving._fifo_landing[0].position.x < -9.0 and moving._fifo_landing[1].position.x > 9.0,
		"same-kind FIFO batches capture distinct real ray-tested landing positions")
	var captured_radius: float = moving._fifo_landing[1].splash_radius
	check(moving._fifo_t[1] > moving._fifo_t[0] and is_equal_approx(captured_radius, 0.0012),
		"each batch captures its own flight delay and splash radius")
	# The current trajectory can disappear while both previously emitted batches fall.
	moving.landed = false
	moving.land_pos = Vector3(35, 0, 0)
	moving.land_n = Vector3.RIGHT
	moving.q = 10.0
	moving._physics_process(2.0)
	var left_ml := 0.0
	var right_ml := 0.0
	var right_splash_ml := 0.0
	for p: Dictionary in manager._puddles:
		if absf(float(p.pos.x) - float(old_endpoint.x)) < 0.01: left_ml += float(p.vol)
		if absf(float(p.pos.x) - 10.0) < 0.01: right_ml += float(p.vol)
	for i in Manager.DROPLET_POOL:
		if manager._dalive[i] == 0: continue
		if absf(float(manager._dpos[i].x) - float(old_endpoint.x)) < 0.01: left_ml += manager._dvol[i]
		if absf(float(manager._dpos[i].x) - 10.0) < 0.01:
			right_ml += manager._dvol[i]
			right_splash_ml += manager._dvol[i]
	check(is_equal_approx(left_ml, 2.0) and is_equal_approx(right_ml, 3.0) and manager._puddles.size() == 2,
		"earlier volume and splash land at their captured endpoints despite later path mutation")
	check(is_equal_approx(right_splash_ml, 2.0 * captured_radius * captured_radius * captured_radius * 4.18879e6),
		"queued splash dose uses its original source radius after later flow mutation")
	check(Leak.emitted_ml == 5.0 and Leak.landed_ml == 5.0 and Leak.lost_ml == 0.0
		and moving.in_flight_ml() == 0.0 and balanced(manager.liquid_ledger()), "moving-source transfer conserves stream and manager ledgers")
	moving._finish()
	manager.clear_debris()
	manager.set_physics_process(false)
	Leak.reset_ledger()
	var missing: GSBottleLeakStream = Leak.acquire(manager, RID(), 1)
	missing.set_physics_process(false)
	missing.feed(Vector3(200, 1, 0), Vector3.ZERO, 0.00001, 1.0, Color.RED, &"petrol")
	missing.feed(Vector3.ZERO + Vector3.UP, Vector3.ZERO, 0.00001, 2.0, Color.RED, &"petrol")
	missing._flush_accumulator()
	check(missing._fifo_landing[0].landed and not missing._fifo_landing[1].landed,
		"miss-to-hit motion captures each batch's actual floor result")
	var input_before: float = manager.liquid_ledger().added_ml
	missing._physics_process(2.0)
	check(Leak.emitted_ml == 3.0 and Leak.lost_ml == 1.0 and Leak.landed_ml == 2.0
		and manager.liquid_ledger().added_ml - input_before == 2.0 and balanced(manager.liquid_ledger()),
		"earlier missed batch cannot acquire a later floor and is explicitly lost")
	missing._finish()
	manager.clear_debris()
	manager.set_physics_process(false)
	Leak.reset_ledger()
	var descending: GSBottleLeakStream = Leak.acquire(manager, RID(), 1)
	descending.set_physics_process(false)
	descending.feed(Vector3(-10, 3, 0), Vector3.ZERO, 0.00001, 2.0, Color.RED, &"petrol")
	var long_delay := descending.t_land
	descending.feed(Vector3(10, 0.2, 0), Vector3.ZERO, 0.00001, 3.0, Color.BLUE, &"water")
	var short_delay := descending.t_land
	descending._flush_accumulator()
	check(short_delay < long_delay and descending._fifo_t[0] < descending._fifo_t[1]
		and descending._fifo_kind == [&"water", &"petrol"]
		and descending._fifo_color == [Color.BLUE, Color.RED]
		and descending._fifo_ml[0] == 3.0 and descending._fifo_landing[0].position.x > 9.0,
		"high-to-low source motion sorts due times together with every captured batch field")
	input_before = manager.liquid_ledger().added_ml
	descending._physics_process((short_delay + long_delay) * 0.5)
	var short_id := int(manager._puddles.back().id)
	check(manager._puddles.size() == 1 and manager.puddle_store.components(short_id) == {"water": 3.0}
		and descending.in_flight_ml() == 2.0 and descending._fifo_kind == [&"petrol"],
		"ready short flight lands at its own endpoint while earlier long flight stays airborne")
	check(Leak.emitted_ml == 5.0 and Leak.landed_ml == 3.0 and Leak.lost_ml == 0.0
		and manager.liquid_ledger().added_ml - input_before == 3.0 and balanced(manager.liquid_ledger()),
		"partial due-time delivery preserves the stream and manager volume ledgers")
	descending._physics_process(long_delay)
	check(descending.in_flight_ml() == 0.0 and Leak.landed_ml == 5.0
		and is_equal_approx(float(manager.liquid_ledger().added_ml) - input_before, 5.0) and manager._puddles.size() == 2
		and manager.puddle_store.components(int(manager._puddles.back().id)).has("petrol")
		and absf(float(manager._puddles.back().pos.x) + 10.0) < 0.01
		and balanced(manager.liquid_ledger()), "later long-flight delivery retains its captured identity and volume")
	descending._finish()
	manager.clear_debris()
	manager.set_physics_process(false)
	Leak.reset_ledger()
	var limited: GSBottleLeakStream = Leak.acquire(manager, RID(), 1)
	limited.set_physics_process(false)
	for i in Leak.MAX_BATCHES + 1:
		limited.feed(Vector3.UP, Vector3.ZERO, 0.00001, 1.0, Color.RED, &"petrol")
		limited._flush_accumulator()
	check(limited._fifo_t.size() == Leak.MAX_BATCHES and limited._fifo_landing.size() == Leak.MAX_BATCHES
		and Leak.lost_ml == 1.0 and limited.in_flight_ml() == float(Leak.MAX_BATCHES),
		"pending batch geometry has a hard bound with explicit excess-volume receipt")
	limited._physics_process(2.0)
	check(Leak.emitted_ml == Leak.landed_ml + Leak.lost_ml + limited.in_flight_ml()
		and balanced(manager.liquid_ledger()), "bounded FIFO delivery conserves excess, stored and recycled splash amounts")
	limited._finish()
	manager.clear_debris()
	manager.set_physics_process(false)
	var neck := SilentBottle.new()
	neck.fill = 1.0
	neck.spill_liquid_kind = &"diesel"
	neck.lut = GSBottleLut.new()
	neck.lut.capacity_ml = 500.0
	neck.profile = GSBottleBreakProfile.new()
	neck.profile.capacity_ml = 500.0
	neck.ctl = GSBottleLiquid.new()
	scene.add_child(neck)
	input_before = manager.liquid_ledger().added_ml
	neck._emit_neck_spurt(manager, Vector3.UP, Vector3.RIGHT, 1.0, Vector3.ZERO)
	var emitted := float(manager.liquid_ledger().added_ml) - input_before
	check(is_equal_approx(emitted, 25.0) and is_equal_approx(neck.fill * 500.0 + emitted, 500.0)
		and is_equal_approx(neck.ctl.fill, neck.fill) and is_equal_approx(neck.mass, neck.profile.total_mass(neck.fill)),
		"neck spurt debits exactly 5% and synchronizes source fill, liquid display and physical mass")
	check(manager._dkind[manager._dnext - 1] == &"diesel" and balanced(manager.liquid_ledger()),
		"neck spurt transfers explicitly authored identity into a balanced manager")
	neck.fill = 0.0
	input_before = manager.liquid_ledger().added_ml
	neck._emit_neck_spurt(manager, Vector3.UP, Vector3.RIGHT, 1.0, Vector3.ZERO)
	check(manager.liquid_ledger().added_ml == input_before, "empty neck source cannot mint splash liquid")
	neck.ctl.free()
	neck.queue_free()
	var viewport := SubViewport.new()
	viewport.own_world_3d = true
	scene.add_child(viewport)
	var other := Node3D.new()
	viewport.add_child(other)
	var isolated: GSBottleBreakManager = Manager.get_for(other)
	await process_frame
	isolated.set_physics_process(false)
	manager.set_physics_process(false)
	check(isolated != manager and isolated.get_parent() == viewport, "different World3D gets a separate bounded store")
	isolated.add_puddle(Vector3.ZERO, Vector3.UP, 8.0, Color.WHITE, &"diesel")
	var unaffected := manager.liquid_ledger()
	var isolated_store := isolated.puddle_store
	viewport.queue_free()
	await process_frame
	check(manager.liquid_ledger() == unaffected and isolated_store.ledger().held_ml == 0.0
		and balanced(isolated_store.ledger()), "world teardown clears only its own stored liquid and books removal")
	scene.queue_free()
	await process_frame
	print("GS_PUDDLES: %d checks, %d failures" % [checks, failures])
	quit(1 if failures else 0)
