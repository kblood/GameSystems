// Glass pane / glass shard shader. Mobile + Forward+ compatible (no screen texture unless USE_SCREEN_REFRACTION
// is defined; GlassSystem builds that variant at runtime by prepending the define).
// Coordinates: UV covers the whole pane; p = pane metres (origin centre, +y up) -> masks, holes and cracks line up
// on the intact pane, on the remaining-cell mesh and on shards.
shader_type spatial;
render_mode blend_premul_alpha, depth_draw_opaque, cull_disabled, specular_schlick_ggx;

uniform vec4 tint : source_color = vec4(0.80, 0.92, 0.90, 0.07);
uniform vec3 edge_tint : source_color = vec3(0.30, 0.55, 0.45);
uniform vec2 pane_size = vec2(1.0, 1.0);
uniform float thickness = 0.004;
uniform bool use_mask = false;
uniform sampler2D mask : hint_default_black, filter_linear_mipmap, repeat_disable;
uniform vec2 mask_texel = vec2(0.002);
// bullet / chip descriptors: a = (x, y, hole radius, front crater radius) in metres,
// b = (back crater radius, star length, star radial count, seed)
uniform int hole_count = 0;
uniform vec4 hole_a[16];
uniform vec4 hole_b[16];
uniform float frost_cover = 0.0;      // 0..1 whole-pane frosting (MINIMAL tier "broken" laminated)
uniform vec4 bulge[4];                // x, y, radius, depth (laminated sag)
uniform int bulge_count = 0;
uniform float craze = 0.0;            // tempered crazing amount
uniform vec2 craze_center = vec2(0.0);
uniform float craze_radius = 10.0;
uniform float craze_cell = 0.012;
uniform float wire_spacing = 0.0;
uniform vec4 band_color : source_color = vec4(0.1, 0.25, 0.3, 0.0);
uniform float band_height = 0.0;      // m from the top
uniform int heater_lines = 0;
uniform float star_gain = 1.0;

#ifdef USE_SCREEN_REFRACTION
uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;
#endif
varying vec2 pm;
varying float face_side;

float hash1(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
vec2 hash2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }

void vertex() {
	pm = (UV - 0.5) * vec2(pane_size.x, -pane_size.y);
	face_side = NORMAL.z;
	for (int i = 0; i < bulge_count; i++) {
		vec2 d = pm - bulge[i].xy;
		VERTEX.z -= bulge[i].w * exp(-dot(d, d) / (bulge[i].z * bulge[i].z));
	}
}

// voronoi border distance (tempered crazing)
float vor_edge(vec2 x) {
	vec2 n = floor(x);
	vec2 f = fract(x);
	vec2 mr;
	float md = 8.0;
	for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
		vec2 g = vec2(float(i), float(j));
		vec2 r = g + hash2(n + g) - f;
		float d = dot(r, r);
		if (d < md) { md = d; mr = r; }
	}
	md = 8.0;
	for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
		vec2 g = vec2(float(i), float(j));
		vec2 r = g + hash2(n + g) - f;
		if (dot(mr - r, mr - r) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
	}
	return md;
}

void fragment() {
	float edge = 1.0 - COLOR.a;
	vec3 alb = tint.rgb;
	float alpha = tint.a;
	float rough = 0.03;
	float crack = 0.0;
	float frost = frost_cover;
	float ink = 0.0;
	vec2 grad = vec2(0.0);
	float side = face_side >= 0.0 ? 1.0 : -1.0;

	if (use_mask) {
		vec4 m = texture(mask, UV);
		if (m.b > 0.5) discard;
		crack = m.r;
		frost = max(frost, m.g);
		float halo = textureLod(mask, UV, 2.0).r;
		ink = clamp(halo * 1.6 - crack, 0.0, 1.0);
		grad.x = texture(mask, UV + vec2(mask_texel.x, 0.0)).r - texture(mask, UV - vec2(mask_texel.x, 0.0)).r;
		grad.y = texture(mask, UV + vec2(0.0, mask_texel.y)).r - texture(mask, UV - vec2(0.0, mask_texel.y)).r;
		frost = max(frost, m.a * 0.8);
		rough = max(rough, m.a * 0.6);
	}

	// analytic bullet holes, craters and micro stars
	float crater = 0.0;
	float rim = 0.0;
	for (int i = 0; i < hole_count; i++) {
		vec4 a = hole_a[i];
		vec4 b = hole_b[i];
		vec2 d = pm - a.xy;
		float r = length(d);
		float reach = max(max(a.w, b.x), b.y);
		if (r > reach * 1.05 + 0.002) continue;
		float ang = atan(d.y, d.x);
		float jag = 1.0 + 0.22 * (hash1(floor(ang * 5.0 + b.w) ) - 0.5) + 0.12 * sin(ang * 13.0 + b.w * 7.0);
		float rh = a.z * jag;
		if (r < rh) discard;
		float rc = side > 0.0 ? a.w : b.x;
		rc = max(rc, rh);
		if (rc > rh && r < rc * jag) {
			float t = (r - rh) / max(rc * jag - rh, 1e-5);
			crater = max(crater, (1.0 - 0.45 * t) * (0.75 + 0.25 * sin(t * 26.0 + b.w * 3.0)));
			rim = max(rim, smoothstep(0.75, 1.0, t));
		}
		if (r < rh + 0.0015 && a.z > 0.0) ink = max(ink, 0.8);
		// micro / analytic star (LOW tier: the only cracks)
		if (b.y > 0.0 && b.z > 0.5) {
			float n = b.z;
			float k = floor(ang / 6.2831853 * n + 0.5);
			float best = 1.0;
			float len = 0.0;
			for (int q = -1; q <= 1; q++) {
				float kk = k + float(q);
				float th = (kk + 0.4 * (hash1(kk + b.w) - 0.5)) * 6.2831853 / n;
				float dl = r * abs(sin(ang - th));
				if (dl < best && cos(ang - th) > 0.0) { best = dl; len = b.y * (0.45 + 0.55 * hash1(kk * 3.1 + b.w)); }
			}
			float wid = 0.0006 + 0.0012 * (1.0 - clamp(r / max(len, 1e-4), 0.0, 1.0));
			float line = (1.0 - smoothstep(0.0, wid, best)) * (1.0 - smoothstep(len * 0.6, len, r)) * step(rc * 0.8, r);
			// partial concentric rings
			float ring_r = max(rc, 0.004) * 2.2;
			float ringd = abs(r - ring_r * (1.0 + 0.6 * floor(log(max(r / ring_r, 1.0)) / 0.47)));
			float ringm = step(0.55, hash1(floor(ang * n / 6.2831853 + 0.5) + floor(r / ring_r * 2.0) + b.w));
			float ringl = (1.0 - smoothstep(0.0, 0.0008, ringd)) * ringm * (1.0 - smoothstep(len * 0.25, len * 0.5, r));
			crack = max(crack, max(line, ringl) * star_gain);
		}
	}

	if (craze > 0.0) {
		float dd = length(pm - craze_center);
		if (dd < craze_radius) {
			float e = vor_edge(pm / craze_cell);
			float c2 = 1.0 - smoothstep(0.02, 0.07, e);
			crack = max(crack, c2 * craze * 0.85);
			frost = max(frost, craze * 0.12);
		}
	}

	if (wire_spacing > 0.0) {
		vec2 g = abs(fract(pm / wire_spacing + 0.5) - 0.5) * wire_spacing;
		// anti-aliased 0.5 mm wire; fades to its average coverage once the mesh nears pixel size (no moire)
		float fw = max(max(fwidth(pm.x), fwidth(pm.y)), 1e-6);
		float wl = 1.0 - smoothstep(0.00025 - fw * 0.5, 0.00025 + fw * 0.5, min(g.x, g.y));
		wl = mix(wl, 0.12, smoothstep(0.08, 0.35, fw / wire_spacing));
		alb = mix(alb, vec3(0.18, 0.18, 0.17), wl);
		alpha = max(alpha, wl * 0.9);
		rough = max(rough, wl * 0.4);
	}
	if (band_height > 0.0) {
		float top = pane_size.y * 0.5 - pm.y;
		float bm = 1.0 - smoothstep(band_height * 0.8, band_height, top);
		alb = mix(alb, band_color.rgb, bm);
		alpha = mix(alpha, band_color.a, bm);
	}
	if (heater_lines > 0) {
		float yy = (pm.y / pane_size.y + 0.5) * float(heater_lines + 1);
		float hl = 1.0 - smoothstep(0.0, 0.05, abs(fract(yy) - 0.5) * 2.0 - 0.95);
		hl *= step(1.0, yy) * step(yy, float(heater_lines)) * step(abs(pm.x), pane_size.x * 0.42);
		alb = mix(alb, vec3(0.35, 0.12, 0.05), hl);
		alpha = max(alpha, hl * 0.85);
	}

	// cracks: bright refractive line with a darker halo, normal bent across the crack
	alb = mix(alb, vec3(0.92, 0.96, 0.95), clamp(crack, 0.0, 1.0));
	alpha = max(alpha, crack * 0.75);
	alb = mix(alb, vec3(0.02, 0.03, 0.03), ink * 0.5 * (1.0 - crack));
	alpha = max(alpha, ink * 0.22);
	alb = mix(alb, vec3(0.86, 0.9, 0.9), frost);
	alpha = max(alpha, frost * 0.78);
	rough = max(rough, frost * 0.55 + crack * 0.15);
	alb = mix(alb, vec3(0.88, 0.92, 0.92), crater);
	alpha = max(alpha, crater * 0.85);
	rough = max(rough, crater * 0.7);
	alb = mix(alb, vec3(1.0), rim * 0.6);
	alpha = max(alpha, rim * 0.95);

	float edgef = clamp(edge, 0.0, 1.0);
	alb = mix(alb, edge_tint, edgef);
	alpha = mix(alpha, 0.9, edgef);
	rough = mix(rough, 0.25, edgef);

	vec3 nb = (TANGENT * grad.x * -2.5 + BINORMAL * grad.y * 2.5) * (1.0 - edgef);
	NORMAL = normalize(NORMAL + nb);

	float fres = pow(1.0 - clamp(abs(dot(NORMAL, VIEW)), 0.0, 1.0), 5.0);
	alpha = mix(alpha, max(alpha, 0.6), fres * (1.0 - edgef));
#ifdef USE_SCREEN_REFRACTION
	// refracted background, bent along cracks; written as emission so it stays independent of the lighting
	vec2 off = (grad * 0.02 + vec2(crack) * 0.004) * (1.0 - edgef);
	EMISSION = texture(screen_tex, SCREEN_UV + off).rgb * (1.0 - alpha);
	alpha = 1.0;
#endif
	ALBEDO = alb * alpha;   // premultiplied
	ALPHA = alpha;
	ROUGHNESS = rough;
	METALLIC = 0.0;
	SPECULAR = 0.5;
}
