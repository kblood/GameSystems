class_name GSPhysicsAdapter
extends RefCounted
## Physics adapter interface, the Godot form of GameSystems/extensions/host/physics.js. Extensions never touch a
## physics engine; they get ctx.physics, which the game builds from its engine (Nightfall: Jolt via RigidBody3D,
## implemented together with gs_bottles in step G2). Override every method; the base only documents the contract.
##
##   add_body(shape: Dictionary | Array, mass: float, pose: Transform3D, options := {}) -> Variant handle
##       shape: {type="box", size=Vector3} | {type="sphere", radius} | {type="cylinder", radius, height, radius_bottom?}
##              (Y-up, centred) each with optional offset: Vector3 and orientation: Quaternion; an Array = compound.
##       mass 0 = static. options: {user_data, linear_damping=0.12, angular_damping=0.18, sleep_time_limit, group, mask,
##       velocity, spin, contacts=true}; user_data.surface names the material others report on contact.
##   pose(h) -> Transform3D; velocity(h) -> {linear: Vector3, angular: Vector3} (world space, m/s, rad/s; 0 while held)
##   set_mass(h, mass); hold(h, target: Transform3D) (kinematic follow until release)
##   release(h, velocity := Vector3.ZERO, spin := Vector3.ZERO); is_held(h) -> bool
##   on_contact(cb) -> Callable unsubscribe; cb({a, b, speed, point, normal, local_point?, local_normal?, velocity?,
##       spin?, other_mass?, impulse?, surface}) delivered after the physics step, never during it
##   on_step(cb) -> Callable unsubscribe; cb(dt) after every step and its contact reports (_physics_process)
##   remove(h) safe during a step and from listeners; later calls on a removed handle are ignored
## Vectors are world space, metres and radians. Handles are opaque. The game owns stepping.

const METHODS: PackedStringArray = ["add_body", "pose", "velocity", "set_mass", "hold", "release", "is_held",
	"on_contact", "on_step", "remove"]

## Names of interface methods the object lacks (empty: it is an adapter). Duck-typed, like assertPhysicsAdapter.
static func missing_methods(adapter: Object) -> PackedStringArray:
	var missing := PackedStringArray()
	for name in METHODS:
		if adapter == null or not adapter.has_method(name): missing.append(name)
	return missing

func add_body(_shape: Variant, _mass: float, _pose: Transform3D, _options: Dictionary = {}) -> Variant: return null
func pose(_handle: Variant) -> Transform3D: return Transform3D.IDENTITY
func velocity(_handle: Variant) -> Dictionary: return {"linear": Vector3.ZERO, "angular": Vector3.ZERO}
func set_mass(_handle: Variant, _mass: float) -> void: pass
func hold(_handle: Variant, _target: Transform3D) -> void: pass
func release(_handle: Variant, _velocity := Vector3.ZERO, _spin := Vector3.ZERO) -> void: pass
func is_held(_handle: Variant) -> bool: return false
func on_contact(_cb: Callable) -> Callable: return func() -> void: pass
func on_step(_cb: Callable) -> Callable: return func() -> void: pass
func remove(_handle: Variant) -> void: pass
