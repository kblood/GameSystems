extends SceneTree
## Acceptance tests for time-sliced annealed remnant construction.

var passes := 0
var fails := 0

func check(condition: bool, label: String) -> void:
	if condition:
		passes += 1
	else:
		fails += 1
		push_error("FAIL: " + label)

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var cases := [
		# Hashes captured by invoking git HEAD's pre-refactor slab_mesh implementation in a temporary renamed test script,
		# with these exact pane seeds, tiers, curvature, cells and edge-skip topology. The temporary copy is not retained.
		{"name":"flat HIGH", "curvature":Vector2.ZERO, "tier":GlassSystem.Tier.HIGH,
			"baseline_mesh":3522329944, "baseline_faces":1230675807},
		{"name":"curved MEDIUM", "curvature":Vector2(0.65, 0.12), "tier":GlassSystem.Tier.MEDIUM,
			"baseline_mesh":1526344618, "baseline_faces":4080525442},
	]
	for test_case in cases:
		await _parity_case(test_case)
	await _restart_and_cancel_cases()
	await _replay_case()
	await _physics_callback_case()
	print("STAGED REMNANT: %d passed, %d failed" % [passes, fails])
	quit(1 if fails else 0)

func _pane(case: Dictionary, seed_value := 171, auto_track := false) -> GlassPane:
	var pane := GlassPane.new()
	pane.name = "RemnantTest_%d" % seed_value
	pane.pane_seed = seed_value
	pane.curvature = case.curvature
	pane.tier = case.tier
	pane.auto_track_bodies = auto_track
	root.add_child(pane)
	return pane

func _impact(pane: GlassPane, x := 0.0, y := 0.0) -> Dictionary:
	var imp := GlassImpact.from_preset("brick", 10.0)
	imp.point = pane.global_transform * Vector3(x, y, 0.0)
	imp.velocity = pane.global_transform.basis * Vector3(0.0, 0.0, -10.0)
	return pane.impact(imp)

func _finish_job(pane: GlassPane) -> void:
	var guard := 0
	while pane.remnant_build_pending() and guard < 2000:
		pane._step_remnant_build()
		guard += 1
	check(not pane.remnant_build_pending(), "staged build reaches publish before guard")

func _mesh_arrays(pane: GlassPane) -> Array:
	if not is_instance_valid(pane.cell_instance) or pane.cell_instance.mesh == null:
		return []
	return pane.cell_instance.mesh.surface_get_arrays(0)

func _intact_colliders_enabled(pane: GlassPane) -> bool:
	for shape in pane._shape_nodes:
		if is_instance_valid(shape) and shape.disabled:
			return false
	return not pane._shape_nodes.is_empty()

func _parity_case(case: Dictionary) -> void:
	var staged := _pane(case, 171)
	var sync := _pane(case, 171)
	await process_frame
	var staged_assessed := [0]
	var staged_broke := [0]
	staged.impact_assessed.connect(func(_p, _info): staged_assessed[0] += 1)
	staged.broke.connect(func(_p, _pos, _energy, _kind): staged_broke[0] += 1)
	var impact_t0 := Time.get_ticks_usec()
	var staged_result := _impact(staged)
	var impact_ms := float(Time.get_ticks_usec() - impact_t0) / 1000.0
	var sync_result := _impact(sync)
	check(staged_result.get("outcome") == GlassPane.Outcome.SHATTERED,
		"%s fixture reaches shatter outcome" % case.name)
	check(staged.remnant_build_pending(), "%s shatter schedules remnant" % case.name)
	check(staged.collision_layer == 0 and not staged.mesh_instance.visible,
		"%s staged pane immediately removes intact collision and visuals" % case.name)
	check(staged_assessed[0] == 1 and staged_broke[0] == 1,
		"%s logical impact signals fire synchronously" % case.name)
	# Force the sync reference path from the same final logical cells/history.
	sync._replaying = true
	sync._rebuild_cells(false)
	sync._replaying = false
	check(staged.cells == sync.cells and staged.history == sync.history,
		"%s staging leaves logical cells and impact history unchanged" % case.name)
	_finish_job(staged)
	check(_mesh_arrays(staged) == _mesh_arrays(sync), "%s staged mesh arrays equal synchronous mesh" % case.name)
	check(hash(_mesh_arrays(staged)) == int(case.baseline_mesh),
		"%s incremental mesh matches pre-change slab_mesh signature" % case.name)
	var staged_faces: PackedVector3Array = staged._cell_shape.shape.get_faces() if staged._cell_shape.shape is ConcavePolygonShape3D else PackedVector3Array()
	var sync_faces: PackedVector3Array = sync._cell_shape.shape.get_faces() if sync._cell_shape.shape is ConcavePolygonShape3D else PackedVector3Array()
	check(staged_faces == sync_faces, "%s staged collision faces equal synchronous collision" % case.name)
	check(hash(staged_faces) == int(case.baseline_faces),
		"%s staged collision matches pre-change slab_mesh face signature" % case.name)
	check(staged.collision_layer == staged.pane_layer and staged.cell_instance.visible,
		"%s publish atomically restores pane layer and remnant visuals" % case.name)
	var diagnostics := staged.remnant_build_diagnostics
	var scripted_peak := maxf(float(diagnostics.get("edges_peak_ms", INF)),
		maxf(float(diagnostics.get("skip_peak_ms", INF)), float(diagnostics.get("mesh_peak_ms", INF))))
	check(is_finite(scripted_peak) and staged.remnant_build_diagnostics.slices > 1
		and staged.remnant_build_max_cells == 32,
		"%s scripted work uses multiple bounded slices; native upload/collision remain separate" % case.name)
	check(is_finite(float(diagnostics.get("upload_peak_ms", NAN)))
		and is_finite(float(diagnostics.get("collision_peak_ms", NAN))),
		"%s native mesh upload and collision phases have separate timing diagnostics" % case.name)
	print("REMNANT %s impact_ms=%.3f diagnostics=%s" % [case.name, impact_ms, diagnostics])
	staged.queue_free()
	sync.queue_free()
	await process_frame

func _restart_and_cancel_cases() -> void:
	var case := {"curvature":Vector2.ZERO, "tier":GlassSystem.Tier.HIGH}
	var pane := _pane(case, 212)
	await process_frame
	_impact(pane)
	check(pane.remnant_build_pending(), "first hit opens staged job")
	var generation_before: int = pane._remnant_generation
	var second := _impact(pane, 0.48, 0.58)
	check(int(second.get("outcome", 0)) > GlassPane.Outcome.NONE and pane.remnant_build_pending() and pane._remnant_generation > generation_before,
		"later impact restarts staging against latest logical cells")
	_finish_job(pane)
	var published_mesh: Mesh = pane.cell_instance.mesh
	# Repair before any slice has run; generation invalidation must win over stale publish.
	pane._rebuild_cells(true)
	var immediate_stale: Dictionary = pane._remnant_job.duplicate(true)
	pane.repair()
	pane._publish_remnant_build(immediate_stale)
	await physics_frame
	check(not pane.remnant_build_pending() and pane.mesh_instance.visible and _intact_colliders_enabled(pane),
		"immediate repair wins over queued build after deferred physics flush")
	pane._rebuild_cells(true)
	check(pane.remnant_build_pending(), "post-publish remnant regeneration starts a new staged revision")
	var stale_job: Dictionary = pane._remnant_job.duplicate(true)
	pane._step_remnant_build()
	pane.repair()
	check(not pane.remnant_build_pending() and pane.collision_layer == pane.pane_layer and pane.mesh_instance.visible,
		"repair cancels pending job and restores intact pane")
	pane._publish_remnant_build(stale_job)
	for i in 4:
		pane._step_remnant_build()
	check(not pane.remnant_build_pending() and pane.cell_instance == null and pane.mesh_instance.visible,
		"stale pre-repair job cannot publish after cancellation")
	await physics_frame
	check(pane.collision_layer == pane.pane_layer and _intact_colliders_enabled(pane),
		"deferred physics flush leaves repaired intact collider enabled")
	_impact(pane)
	var resize_stale_job: Dictionary = pane._remnant_job.duplicate(true)
	pane._step_remnant_build()
	pane.size = Vector2(1.1, 1.0)
	pane._publish_remnant_build(resize_stale_job)
	check(not pane.remnant_build_pending() and pane.history.is_empty() and pane.cells.is_empty()
		and pane.mesh_instance.visible and pane.collision_layer == pane.pane_layer,
		"authored geometry rebuild repairs pane and invalidates older staged publication")
	check(published_mesh != null, "previous published revision existed before cancellation")
	_impact(pane)
	check(pane.remnant_build_pending(), "shatter job exists before vanish")
	pane._vanish()
	for i in 4:
		pane._step_remnant_build()
	check(not pane.remnant_build_pending() and pane.collision_layer == 0,
		"vanish cancels pending geometry and remains absent")
	pane.queue_free()
	await process_frame

func _replay_case() -> void:
	var case := {"curvature":Vector2(0.4, 0.0), "tier":GlassSystem.Tier.HIGH}
	var source := _pane(case, 333)
	var replay := _pane(case, 333)
	await process_frame
	_impact(source)
	_finish_job(source)
	var state := source.get_damage_state()
	replay.set_damage_state(JSON.parse_string(JSON.stringify(state)))
	check(not replay.remnant_build_pending(), "silent checkpoint replay builds synchronously")
	check(source.cells == replay.cells and _mesh_arrays(source) == _mesh_arrays(replay),
		"checkpoint replay reproduces logical cells and final remnant mesh")
	var source_faces: PackedVector3Array = source._cell_shape.shape.get_faces() if source._cell_shape.shape is ConcavePolygonShape3D else PackedVector3Array()
	var replay_faces: PackedVector3Array = replay._cell_shape.shape.get_faces() if replay._cell_shape.shape is ConcavePolygonShape3D else PackedVector3Array()
	check(source_faces == replay_faces, "checkpoint replay reproduces remnant collision")
	source.queue_free()
	replay.queue_free()
	await process_frame

func _physics_callback_case() -> void:
	var pane := _pane({"curvature":Vector2.ZERO, "tier":GlassSystem.Tier.HIGH}, 440, true)
	await physics_frame
	pane._sys.tier = GlassSystem.Tier.HIGH
	pane._sys.auto_lod = false
	var striker := RigidBody3D.new()
	striker.name = "CallbackBrick"
	striker.mass = 2.0
	striker.set_meta("glass_striker", "brick")
	striker.collision_layer = 1
	striker.collision_mask = 1
	var collision := CollisionShape3D.new()
	var sphere := SphereShape3D.new()
	sphere.radius = 0.08
	collision.shape = sphere
	striker.add_child(collision)
	root.add_child(striker)
	striker.global_position = Vector3(0.0, 0.0, 0.45)
	var hit := [false]
	var callback_result := [{}]
	var callback_pending := [false]
	var callback_layer := [-1]
	pane._sensor.body_entered.connect(func(body: Node3D):
		if hit[0] or not body is RigidBody3D:
			return
		hit[0] = true
		callback_result[0] = _impact(pane)
		pane._rebuild_cells(true)
		callback_pending[0] = pane.remnant_build_pending()
		callback_layer[0] = pane.collision_layer)
	for i in 6:
		await physics_frame
	check(hit[0], "physics Area3D callback receives real rigid body")
	check(int(callback_result[0].get("outcome", 0)) > GlassPane.Outcome.NONE and callback_pending[0] and callback_layer[0] == 0,
		"physics callback schedules staged build with pane collision layer removed")
	var guard := 0
	while pane.remnant_build_pending() and guard < 120:
		await process_frame
		guard += 1
	check(not pane.remnant_build_pending(), "normal process loop completes staged build across frames")
	await physics_frame
	check(pane.collision_layer == pane.pane_layer and is_instance_valid(pane._cell_shape) and not pane._cell_shape.disabled,
		"physics-flush ordering leaves published remnant collider active")
	striker.queue_free()
	pane.queue_free()
	await process_frame
