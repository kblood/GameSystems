class_name BulletHoleMark
extends RefCounted
## Persistent bullet-hole marks on plastic containers (PET bottles, jerrycans). BreakableBottle._add_leak calls add() for
## every hole (entry + exit, also dry holes above the liquid). A mark is one tiny MeshInstance3D child of the bottle (bottle-local
## transform, so it moves with it and frees with it): a shared unit quad + ONE shared ShaderMaterial; per-mark variation
## (seed, exit roughness, tint) goes through instance uniforms. No script, no process callback: zero per-frame cost.
## Tiers: HIGH / MEDIUM / LOW (MINIMAL creates none). Capped at MAX_PER_BOTTLE per bottle.

const MAX_PER_BOTTLE := 6
const LIFT := 0.0003                 ## m along the surface normal (no z-fight)
const HS_MIN := 0.003                ## half size of the quad (m); the dark hole is HOLE_FRAC of it
const HS_MAX := 0.008
const HOLE_FRAC := 0.42

static var _mat: ShaderMaterial
static var _quad: QuadMesh


## Half size of the mark quad for a leak-hole radius (m). Exit holes are 1.25x larger.
static func half_size(r_hole: float, is_exit: bool) -> float:
	var hs := clampf(r_hole * 1.4, HS_MIN, HS_MAX)
	return minf(hs * 1.25, HS_MAX * 1.2) if is_exit else hs


static func tier_allows(q: int) -> bool:
	return q != BottleBreakManager.Quality.MINIMAL


## p / n in bottle-local space (n = outward surface normal). Returns null when capped.
static func add(bottle: Node3D, marks: Array, p: Vector3, n: Vector3, r_hole: float, is_exit: bool, tint: Color,
		seed := 0.0) -> MeshInstance3D:
	if marks.size() >= MAX_PER_BOTTLE:
		return null
	if _mat == null:
		var sh := Shader.new()
		sh.code = SHADER
		_mat = ShaderMaterial.new()
		_mat.shader = sh
		_mat.render_priority = 2      # after the (transparent) bottle shell
		_quad = QuadMesh.new()
		_quad.size = Vector2(1, 1)
	var nn := n.normalized() if n.length_squared() > 1e-8 else Vector3.UP
	var x := nn.cross(Vector3.UP if absf(nn.y) < 0.9 else Vector3.RIGHT).normalized()
	x = x.rotated(nn, seed * 1.37)
	var hs := half_size(r_hole, is_exit)
	var b := Basis(x, nn.cross(x), nn).scaled(Vector3(hs * 2.0, hs * 2.0, hs * 2.0))
	var mi := MeshInstance3D.new()
	mi.name = "HoleMark%d" % marks.size()
	mi.mesh = _quad
	mi.material_override = _mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.transform = Transform3D(b, p + nn * LIFT)
	mi.set_meta("hole_p", p)
	mi.set_meta("hole_n", nn)
	mi.set_meta("exit", is_exit)
	bottle.add_child(mi)
	mi.set_instance_shader_parameter("tint", tint)
	mi.set_instance_shader_parameter("seed", seed)
	mi.set_instance_shader_parameter("rough", 1.0 if is_exit else 0.0)
	marks.append(mi)
	return mi


const SHADER := """
shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_back, shadows_disabled;
// Unit quad (VERTEX.xy in -0.5..0.5). Dark punched hole, whitened / stressed plastic ring, petal flaps on exit holes.
instance uniform vec4 tint : source_color = vec4(0.85, 0.9, 0.95, 1.0);
instance uniform float seed = 0.0;
instance uniform float rough = 0.0;
varying vec2 lp;
void vertex() {
	lp = VERTEX.xy * 2.0;
}
void fragment() {
	float a = atan(lp.y, lp.x);
	float n = 0.5 * sin(a * 7.0 + seed) + 0.3 * sin(a * 13.0 + seed * 1.7) + 0.2 * sin(a * 23.0 + seed * 3.1);
	float d = length(lp) * (1.0 + (0.05 + 0.16 * rough) * n);
	float hr = 0.42 - 0.03 * rough;
	float hole = 1.0 - smoothstep(hr - 0.04, hr + 0.02, d);
	float fall = 1.0 - smoothstep(hr, 0.9 + 0.1 * rough, d);
	float ring = fall * fall * (1.0 - hole);   // soft whitened ring, strongest at the rim (visible on clear plastic)
	float petal = rough * smoothstep(0.55, 1.0, sin(a * 4.0 + seed * 2.0)) * (1.0 - smoothstep(hr, hr + 0.3, d)) * (1.0 - hole);
	vec3 stress = mix(tint.rgb, vec3(0.97), 0.8);
	vec3 c = mix(stress, vec3(0.015), hole);
	c = mix(c, tint.rgb * 0.45, petal);
	ALBEDO = c;
	ALPHA = clamp(max(hole * 0.95, ring * (0.8 + 0.1 * rough) + petal * 0.7), 0.0, 1.0);
	ROUGHNESS = mix(0.75, 0.95, hole);
	SPECULAR = 0.3;
}
"""
