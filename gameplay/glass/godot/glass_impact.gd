class_name GlassImpact
extends RefCounted
## Striker description for one hit on a pane (the "shared striker concept" with BreakableBottle:
## mass, normal speed, hardness ~ surface stiffness, sharpness ~ contact shape).
##   var imp := GlassImpact.from_preset("brick", 9.0)          # 9 m/s
##   var imp := GlassImpact.bullet(0.009, 500.0)               # 9 mm, 500 J
## point / velocity are world space; GlassPane fills in the pane-relative values.

## shape -> sharpness (stress concentration). Matches BottleBreakProfile: 1 flat/ball, 1.6 edge, 2.5+ point.
const SHAPES := {"point": 3.0, "edge": 1.8, "rod": 1.4, "ball": 1.0, "flat": 0.6}
## Bottle-system surface names -> hardness relative to glass (for apply_contact()).
const SURFACE_HARDNESS := {"concrete": 1.0, "stone": 1.1, "metal": 1.3, "tile": 1.0, "glass": 1.0, "bottle": 0.95,
	"wood": 0.35, "plastic": 0.2, "dirt": 0.1, "character": 0.06, "carpet": 0.05}

## mass kg, speed m/s, shape, radius = body half size (m, hole/pass-through), contact = load patch radius (m),
## hardness relative to glass (glass = 1), deform = share of energy the striker soaks up, caliber m (bullets).
const STRIKERS := {
	"bb": {"mass": 0.0002, "speed": 100.0, "shape": "ball", "radius": 0.003, "contact": 0.001, "hardness": 0.15, "deform": 0.1, "projectile": true, "caliber": 0.006},
	"pellet": {"mass": 0.00053, "speed": 240.0, "shape": "ball", "radius": 0.00225, "contact": 0.001, "hardness": 0.5, "deform": 0.3, "projectile": true, "caliber": 0.0045},
	"22lr": {"mass": 0.0026, "speed": 370.0, "shape": "ball", "radius": 0.0029, "contact": 0.002, "hardness": 0.55, "deform": 0.25, "projectile": true, "caliber": 0.0057},
	"9mm": {"mass": 0.008, "speed": 360.0, "shape": "ball", "radius": 0.0045, "contact": 0.003, "hardness": 0.9, "deform": 0.1, "projectile": true, "caliber": 0.009},
	"9mm_hp": {"mass": 0.008, "speed": 360.0, "shape": "ball", "radius": 0.0045, "contact": 0.004, "hardness": 0.8, "deform": 0.45, "projectile": true, "caliber": 0.009, "bullet": "hp"},
	"45acp": {"mass": 0.0149, "speed": 255.0, "shape": "ball", "radius": 0.0057, "contact": 0.004, "hardness": 0.85, "deform": 0.15, "projectile": true, "caliber": 0.0114},
	"556": {"mass": 0.004, "speed": 940.0, "shape": "point", "radius": 0.0028, "contact": 0.0015, "hardness": 1.1, "deform": 0.1, "projectile": true, "caliber": 0.0056},
	"762": {"mass": 0.0097, "speed": 840.0, "shape": "point", "radius": 0.0038, "contact": 0.002, "hardness": 1.1, "deform": 0.08, "projectile": true, "caliber": 0.0076},
	"stone": {"mass": 0.2, "speed": 8.0, "shape": "ball", "radius": 0.03, "contact": 0.012, "hardness": 1.1, "deform": 0.0},
	"brick": {"mass": 2.4, "speed": 8.0, "shape": "edge", "radius": 0.08, "contact": 0.02, "hardness": 0.8, "deform": 0.05},
	"bottle": {"mass": 0.9, "speed": 8.0, "shape": "ball", "radius": 0.04, "contact": 0.03, "hardness": 0.95, "deform": 0.15},
	"chair": {"mass": 5.0, "speed": 5.0, "shape": "rod", "radius": 0.25, "contact": 0.02, "hardness": 0.35, "deform": 0.1},
	"hammer": {"mass": 1.0, "speed": 9.0, "shape": "flat", "radius": 0.02, "contact": 0.012, "hardness": 1.3, "deform": 0.0},
	"punch_tool": {"mass": 0.03, "speed": 4.0, "shape": "point", "radius": 0.005, "contact": 0.0005, "hardness": 1.4, "deform": 0.0},
	"fist": {"mass": 4.0, "speed": 7.0, "shape": "flat", "radius": 0.05, "contact": 0.04, "hardness": 0.08, "deform": 0.5},
	"body": {"mass": 70.0, "speed": 3.0, "shape": "flat", "radius": 0.22, "contact": 0.12, "hardness": 0.05, "deform": 0.6},
	"sphere": {"mass": 1.0, "speed": 6.0, "shape": "ball", "radius": 0.03, "contact": 0.01, "hardness": 1.3, "deform": 0.0},
}

var kind := "custom"
var point := Vector3.ZERO
var velocity := Vector3.ZERO
var mass := 1.0
var shape := "ball"
var radius := 0.03
var contact := 0.02
var hardness := 1.0
var deform := 0.0
var caliber := 0.0
var projectile := false
var bullet_type := "fmj"
var body: Node = null                ## the striking RigidBody3D, if any
var silent := false                  ## replay (save/load, tier change): no shards, no signals

## Filled by GlassPane before assessment
var normal_speed := 0.0
var cos_incidence := 1.0
var side := 1.0                      ## +1 = came from the pane front (+Z), -1 from the back


static func from_preset(name: String, speed := -1.0) -> GlassImpact:
	var d: Dictionary = STRIKERS.get(name, STRIKERS["stone"])
	var i := GlassImpact.new()
	i.kind = name
	i.mass = d["mass"]
	i.shape = d["shape"]
	i.radius = d["radius"]
	i.contact = d["contact"]
	i.hardness = d["hardness"]
	i.deform = d["deform"]
	i.projectile = d.get("projectile", false)
	i.caliber = d.get("caliber", 0.0)
	i.bullet_type = d.get("bullet", "fmj")
	i.velocity = Vector3(0, 0, -(speed if speed > 0.0 else float(d["speed"])))
	return i


## Bullet from energy (J) and caliber (m). velocity <= 0: typical speed for the caliber (mass = 2E/v^2).
static func bullet(caliber_m: float, energy_j: float, speed := -1.0, type := "fmj") -> GlassImpact:
	var i := GlassImpact.new()
	i.kind = "bullet"
	i.projectile = true
	i.caliber = caliber_m
	i.bullet_type = type
	var v := speed if speed > 0.0 else (900.0 if caliber_m < 0.0065 and energy_j > 800.0 else 360.0)
	if energy_j < 40.0 and speed <= 0.0:
		v = 200.0
	i.mass = 2.0 * energy_j / (v * v)
	i.velocity = Vector3(0, 0, -v)
	i.radius = caliber_m * 0.5
	i.contact = caliber_m * 0.35
	i.shape = "point" if v > 700.0 else "ball"
	i.hardness = 0.9 if type == "fmj" else 0.8
	i.deform = 0.45 if type == "hp" else (0.25 if type == "lead" else 0.1)
	return i


func speed() -> float:
	return velocity.length()


func energy() -> float:
	return 0.5 * mass * velocity.length_squared()


func momentum() -> float:
	return mass * velocity.length()


func sharpness() -> float:
	return float(SHAPES.get(shape, 1.0))


func dir() -> Vector3:
	return velocity.normalized() if velocity.length_squared() > 1e-12 else Vector3.FORWARD


func with_speed(v: float) -> GlassImpact:
	var c := duplicate_impact()
	c.velocity = dir() * v
	return c


func duplicate_impact() -> GlassImpact:
	var c := GlassImpact.new()
	c.from_dict(to_dict())
	c.body = body
	return c


func to_dict() -> Dictionary:
	return {"kind": kind, "point": [point.x, point.y, point.z], "velocity": [velocity.x, velocity.y, velocity.z],
		"mass": mass, "shape": shape, "radius": radius, "contact": contact, "hardness": hardness, "deform": deform,
		"caliber": caliber, "projectile": projectile, "bullet_type": bullet_type}


func from_dict(d: Dictionary) -> GlassImpact:
	kind = d.get("kind", kind)
	var p: Array = d.get("point", [0, 0, 0])
	point = Vector3(p[0], p[1], p[2])
	var v: Array = d.get("velocity", [0, 0, -1])
	velocity = Vector3(v[0], v[1], v[2])
	mass = d.get("mass", mass)
	shape = d.get("shape", shape)
	radius = d.get("radius", radius)
	contact = d.get("contact", contact)
	hardness = d.get("hardness", hardness)
	deform = d.get("deform", deform)
	caliber = d.get("caliber", caliber)
	projectile = d.get("projectile", projectile)
	bullet_type = d.get("bullet_type", bullet_type)
	return self
