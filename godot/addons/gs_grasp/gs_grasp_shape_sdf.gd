class_name GSGraspShapeSdf
extends RefCounted
## Item-local signed distance and finite-difference surface normal for catalog shapes.

const CatalogData = preload("res://addons/gs_grasp_data/gs_grasp_catalog_data.gd")

static func signed_distance(shape: Dictionary, point: Array) -> Variant:
	if not CatalogData.validate_shape(shape):
		return null
	return _signed_distance_validated(shape, point)

## Internal batch path: caller validates the unchanged shape in this synchronous call.
## Point validation remains per sample. Never use with unvalidated external geometry.
static func _signed_distance_validated(shape: Dictionary, point: Array) -> Variant:
	if not _finite_vector(point):
		return null
	return _shape_distance(shape, point)

static func surface_normal(shape: Dictionary, point: Array, step: float = 0.0001) -> Variant:
	if not CatalogData.validate_shape(shape) or not _finite_vector(point) or not is_finite(step) or step <= 0.0:
		return null
	var gradient: Array[float] = []
	for axis: int in 3:
		var a: Array = point.duplicate()
		var b: Array = point.duplicate()
		a[axis] = float(a[axis]) + step
		b[axis] = float(b[axis]) - step
		gradient.append(float(_shape_distance(shape, a)) - float(_shape_distance(shape, b)))
	var length := _hypot3(gradient[0], gradient[1], gradient[2])
	if length == 0.0:
		return [0.0, 0.0, 0.0]
	return [gradient[0] / length, gradient[1] / length, gradient[2] / length]

static func _shape_distance(shape: Dictionary, point: Array) -> float:
	if shape.type != "parts":
		return _primitive_distance(shape, point)
	var distance := INF
	for part: Dictionary in shape.parts:
		distance = minf(distance, _primitive_distance(part, point))
	return distance

static func _primitive_distance(shape: Dictionary, point: Array) -> float:
	var at: Array = shape.get("at", [0.0, 0.0, 0.0])
	var x := float(point[0]) - float(at[0])
	var y := float(point[1]) - float(at[1])
	var z := float(point[2]) - float(at[2])
	match shape.type:
		"box":
			var size: Array = shape.size
			var q := [absf(x) - float(size[0]) * 0.5, absf(y) - float(size[1]) * 0.5, absf(z) - float(size[2]) * 0.5]
			var outside := _hypot3(maxf(q[0], 0.0), maxf(q[1], 0.0), maxf(q[2], 0.0))
			return outside + minf(maxf(q[0], maxf(q[1], q[2])), 0.0)
		"cylinder":
			# Match JS catalog.signedDistance: move the selected local axis into Y.
			# Translation above applies before permutation, also for union parts.
			var u := x
			var v := y
			var w := z
			match shape.get("axis", "y"):
				"x":
					u = y
					v = x
				"z":
					v = z
					w = y
			var radial := _hypot2(u, w) - float(shape.radius)
			var axial := absf(v) - float(shape.half)
			return minf(maxf(radial, axial), 0.0) + _hypot2(maxf(radial, 0.0), maxf(axial, 0.0))
		"lathe":
			var profile: Array = shape.profile
			var y0 := float(profile[0][0])
			var y1 := float(profile[profile.size() - 1][0])
			var radius := _hypot2(x, z)
			var clamped_y := clampf(y, y0, y1)
			var radial := radius - _radius_at(profile, clamped_y)
			var axial := maxf(y0 - y, y - y1)
			var index := 0
			while index < profile.size() and float(profile[index][0]) < clamped_y:
				index += 1
			var a: Array = profile[maxi(0, index - 1)]
			var b: Array = profile[mini(index, profile.size() - 1)]
			var slope := 0.0
			if float(b[0]) > float(a[0]):
				slope = (float(b[1]) - float(a[1])) / (float(b[0]) - float(a[0]))
			var corrected_radial := radial / sqrt(1.0 + slope * slope)
			return minf(maxf(corrected_radial, axial), 0.0) + _hypot2(maxf(corrected_radial, 0.0), maxf(axial, 0.0))
	return INF

static func _radius_at(profile: Array, y: float) -> float:
	if y <= float(profile[0][0]):
		return float(profile[0][1])
	for index: int in range(1, profile.size()):
		var y1 := float(profile[index][0])
		if y <= y1:
			var a: Array = profile[index - 1]
			var b: Array = profile[index]
			var dy := maxf(1e-9, float(b[0]) - float(a[0]))
			return float(a[1]) + (float(b[1]) - float(a[1])) * (y - float(a[0])) / dy
	return float(profile[profile.size() - 1][1])

static func _finite_vector(value: Variant) -> bool:
	if not value is Array or value.size() != 3:
		return false
	for coordinate: Variant in value:
		if not (coordinate is int or coordinate is float) or not is_finite(float(coordinate)):
			return false
	return true

static func _hypot2(a: float, b: float) -> float:
	var scale := maxf(absf(a), absf(b))
	if scale == 0.0:
		return 0.0
	return scale * sqrt(pow(a / scale, 2.0) + pow(b / scale, 2.0))

static func _hypot3(a: float, b: float, c: float) -> float:
	var scale := maxf(absf(a), maxf(absf(b), absf(c)))
	if scale == 0.0:
		return 0.0
	return scale * sqrt(pow(a / scale, 2.0) + pow(b / scale, 2.0) + pow(c / scale, 2.0))
