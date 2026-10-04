// Volume-preserving fake liquid with bubbles + foam for bottle_*.glb. Apply to the "Liquid" mesh (BottleLiquid.gd does it).
// The surface is a plane fixed in WORLD space, so it holds at any tilt, sideways and upside down.
//
// Body:    Beer-Lambert absorption along the real path through the liquid (ray vs. the bottle's radius around its
//          object Y axis, capped by the surface plane and the bottom) -> thin edges lighter, centre darker/saturated.
// Bubbles: 4 cheap layers. Each layer samples a view-INDEPENDENT 3D surface (the glass wall, or a cylinder shell at
//          a fraction of the local radius, found by ray/cylinder intersection), so bubbles have true parallax and
//          are stereo-correct in VR. Bubbles are shaded as gas spheres (ray impact parameter): transparent lensing
//          centre, total-internal-reflection rim, dark outline, specular glint and a bottom caustic.
//          Rising layers live in a "flow frame" (y = world up, parallel-transported on the CPU) so they always rise
//          toward world up; each column has its own size + speed (bigger = faster) and a slight wobble.
// Foam:    cellular foam head (thickness = foam * foam_height) under the plane + foam / bubble ring on the surface.
shader_type spatial;
render_mode cull_disabled;

uniform vec4 plane = vec4(0.0, 1.0, 0.0, 1.0);   // xyz = world up in OBJECT space, w = plane offset (from the baked table)
uniform vec3 up_world = vec3(0.0, 1.0, 0.0);      // effective (slosh-bent) up in world space
uniform vec4 liquid_color : source_color = vec4(0.8, 0.5, 0.1, 1.0);   // colour seen through ref_path of liquid
uniform vec4 surface_color : source_color = vec4(0.9, 0.6, 0.15, 1.0); // unused (kept so existing callers still work)
uniform float ripple = 0.0;
uniform float agitation = 0.0;       // 0..1, rises when the bottle is shaken, decays over ~2-3 s
uniform float carbonation = 0.0;     // 0..1 constant fizz (streams + bubbles clinging to the glass)
uniform float bubble_scale = 1.0;    // global on/off/strength for bubbles + foam
uniform float foam = 0.0;            // 0..1 current foam head (BottleLiquid builds it from agitation * extras.foam)
uniform float foam_height = 0.022;   // head thickness (m) at foam = 1
uniform float bubble_size = 1.0;     // per-bottle bubble radius multiplier
uniform mat3 flow_basis = mat3(1.0); // columns = flow axes in object space (column 1 = world up)
uniform vec3 flow_pivot = vec3(0.0, 0.08, 0.0);
uniform float rise = 0.0;            // accumulated bubble time (s), drives the rise
uniform float base_y = 0.0;          // liquid bottom (object Y)
uniform float ref_path = 0.045;
uniform bool flip_faces = false;
// Realism tier (BottleLiquid.quality / distance LOD). Uniform branches only -> switchable at runtime, no recompiles.
//   3 HIGH    3 rising bubble shells + glass-wall bubbles (2 cell lookups each), cellular foam head + surface foam
//   2 MEDIUM  1 rising shell + wall bubbles, cellular foam head, single-scale surface foam
//   1 LOW     1 rising shell, flat foam band (noise edge), flat surface foam, absorption kept
//   0 MINIMAL clipped plane only: flat colour body + flat surface, no bubbles / foam / absorption
uniform int quality : hint_range(0, 3) = 3;     // set by BottleLiquid when the Liquid mesh has inverted winding      // path length (m) through which the liquid looks exactly liquid_color

varying vec3 obj_pos;
varying vec3 cam_obj;

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

vec3 hash33(vec3 p3) {
	p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
	p3 += dot(p3, p3.yxz + 33.33);
	return fract((p3.xxy + p3.yxx) * p3.zyx);
}

vec2 hash22(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.xx + p3.yz) * p3.zy);
}

mat2 rot2(float a) {
	float c = cos(a), s = sin(a);
	return mat2(vec2(c, s), vec2(-s, c));
}

// Bubble field: one candidate bubble per 3D cell (cell x cell_y x cell) in the layer frame (y = up); columns (xz)
// rise at their own speed. q = sample point (m) on the layer's surface, v = toward the viewer, same frame.
// Each cell's bubble is a real sphere tested against the eye ray, so it has true parallax / stereo.
float col_yoff(vec2 cid, float seed, float spd, out float sf, out float colh) {
	vec2 hc = hash22(cid + seed);
	colh = hc.y;
	sf = 0.22 + 0.78 * hc.x * hc.x * hc.x;            // power law: many small, few big
	return rise * spd * (0.35 + 0.65 * sf);            // bigger rises faster
}

void bubble_cell(inout vec3 col, inout vec3 em, vec3 q, vec3 v, vec2 cid, float cy, float yoff, float sf,
		float cell, float cell_y, float rmax, float dens, float seed, vec3 tk, float px, float fade) {
	vec3 id = vec3(cid.x, cy, cid.y) + seed;
	vec3 h = hash33(id);
	if (h.x > dens) {
		return;
	}
	float r = rmax * sf * (0.7 + 0.3 * h.y);
	// jitter as far as the bubble still fits in its cell (big bubbles stay nearer the centre)
	vec3 jr = max(vec3(0.0), 1.0 - 2.4 * r / vec3(cell, cell_y, cell));
	vec3 j = 0.5 + (hash33(id + 17.17) - 0.5) * jr;
	float yc = (cy + j.y) * cell_y + yoff;
	vec2 wob = (0.06 * cell * sf) * vec2(sin(yc * 230.0 + h.z * 6.283), cos(yc * 170.0 + h.z * 11.0));   // zig-zag rise
	vec3 c = vec3((cid.x + j.x) * cell + wob.x, yc, (cid.y + j.z) * cell + wob.y);
	vec3 d = c - q;
	vec3 perp = d - v * dot(d, v);
	float re = max(r, 0.6 * px);
	float x = length(perp) / re;
	if (x >= 1.0) {
		return;
	}
	float sub = clamp(r / max(px, 1e-6), 0.0, 1.0);           // sub-pixel bubbles fade instead of aliasing
	float aa = clamp(px / re, 0.08, 0.6);
	float a = (1.0 - smoothstep(1.0 - aa, 1.0, x)) * fade * mix(sub * sub, 1.0, 0.25);
	// gas sphere in liquid: lensing centre (brighter, a little paler), total-internal-reflection band that mirrors the
	// bright surface above (crescent on top) and the dark liquid below, thin dark outline, sharp glint.
	vec3 m = -perp / re;
	vec3 n = m + v * sqrt(max(1.0 - x * x, 0.0));
	vec3 up = vec3(0.0, 1.0, 0.0);
	vec3 R = reflect(-v, n);
	float ring = smoothstep(0.6, 0.9, x);
	float env = mix(0.1, 1.0, smoothstep(-0.3, 0.8, R.y));
	float spec = pow(max(dot(n, normalize(v + up * 1.1 + vec3(-0.4, 0.0, 0.0))), 0.0), 60.0);
	vec3 upp = up - v * dot(up, v);
	upp *= inversesqrt(max(dot(upp, upp), 1e-4));
	float caus = 1.0 - smoothstep(0.0, 0.42, length(m + upp * 0.45)); // light focused through the bubble (below centre)
	float rim = smoothstep(0.86, 1.0, x);
	float lum = dot(col, vec3(0.3, 0.59, 0.11));
	vec3 lens = mix(col, vec3(lum), 0.3) * 1.25 + 0.012;
	vec3 inside = mix(lens, col * 0.4, ring) * (1.0 - rim * 0.7);
	col = mix(col, inside, a);
	vec3 tw = mix(tk, vec3(1.0), 0.35);   // reflections are less tinted than transmitted light
	em += a * (tw * ring * (1.0 - rim * 0.6) * (env * 0.42 + 0.05) + tw * spec * 1.8 + tk * caus * 0.3 * (1.0 - ring));
}

// One layer = the cell containing q plus its neighbour across the nearest cell face, so a bubble whose disk straddles
// a cell border (where the sampled surface leaves the cell) is never clipped. 2 lookups, both early-out.
void bubble_layer(inout vec3 col, inout vec3 em, vec3 q, vec3 v, float cell, float cell_y, float rmax,
		float spd, float d_small, float d_big, float colfrac, float seed, vec3 tk, float px, float fade) {
	vec2 g = q.xz / cell;
	vec2 cid = floor(g);
	vec2 fg = g - cid;
	float sf, ch;
	float yoff = col_yoff(cid, seed, spd, sf, ch);
	float gy = (q.y - yoff) / cell_y;
	float cy = floor(gy);
	float fy = gy - cy;
	if (ch <= colfrac) {
		bubble_cell(col, em, q, v, cid, cy, yoff, sf, cell, cell_y, rmax, mix(d_small, d_big, sf), seed, tk, px, fade);
	}
	vec3 dist = vec3(min(fg.x, 1.0 - fg.x) * cell, min(fy, 1.0 - fy) * cell_y, min(fg.y, 1.0 - fg.y) * cell);
	if (dist.y <= min(dist.x, dist.z)) {
		if (ch <= colfrac) {
			bubble_cell(col, em, q, v, cid, cy + (fy < 0.5 ? -1.0 : 1.0), yoff, sf, cell, cell_y, rmax, mix(d_small, d_big, sf), seed, tk, px, fade);
		}
	} else {
		vec2 nid = cid + (dist.x < dist.z ? vec2(fg.x < 0.5 ? -1.0 : 1.0, 0.0) : vec2(0.0, fg.y < 0.5 ? -1.0 : 1.0));
		float sf2, ch2;
		float yoff2 = col_yoff(nid, seed, spd, sf2, ch2);
		if (ch2 <= colfrac) {
			bubble_cell(col, em, q, v, nid, floor((q.y - yoff2) / cell_y), yoff2, sf2, cell, cell_y, rmax, mix(d_small, d_big, sf2), seed, tk, px, fade);
		}
	}
}

// cellular foam, 2x2(x2) neighbourhood (cheap, jitter limited so it stays correct enough)
vec2 voro3(vec3 x) {
	vec3 n = floor(x - 0.5);
	vec3 f = x - n;
	float f1 = 8.0, f2 = 8.0;
	for (int k = 0; k < 8; k++) {
		vec3 g = vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
		vec3 r = g + 0.2 + 0.6 * hash33(n + g) - f;
		float dd = dot(r, r);
		if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) { f2 = dd; }
	}
	return sqrt(vec2(f1, f2));
}

vec2 voro2(vec2 x) {
	vec2 n = floor(x - 0.5);
	vec2 f = x - n;
	float f1 = 8.0, f2 = 8.0;
	for (int k = 0; k < 4; k++) {
		vec2 g = vec2(float(k & 1), float(k >> 1));
		vec2 r = g + 0.2 + 0.6 * hash22(n + g) - f;
		float dd = dot(r, r);
		if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) { f2 = dd; }
	}
	return sqrt(vec2(f1, f2));
}

float snoise(vec3 p) {   // smooth, cheap pseudo-noise in [0,1]
	return 0.5 + 0.25 * (sin(p.x * 1.7 + sin(p.z * 2.3)) * sin(p.y * 1.9 + sin(p.x * 1.3)) + sin(p.z * 2.9 + p.y * 1.1) * 0.6);
}

// foam look: (shade, cell edge)
vec2 foam_cells(vec3 p, float scale) {
	vec2 a = voro3(p * scale);
	vec2 b = voro3(p * scale * 2.7 + 13.1);
	float edge = 1.0 - smoothstep(0.0, 0.16, a.y - a.x);
	float edge2 = 1.0 - smoothstep(0.0, 0.2, b.y - b.x);
	float shade = 0.72 + 0.28 * smoothstep(0.1, 0.75, a.x) * (1.0 - edge2 * 0.5);
	return vec2(shade, max(edge, edge2 * 0.6));
}

void vertex() {
	obj_pos = VERTEX;
	cam_obj = (inverse(MODEL_MATRIX) * vec4(CAMERA_POSITION_WORLD, 1.0)).xyz;
}

void fragment() {
	float px = length(fwidth(obj_pos));
	vec3 u = normalize(plane.xyz);
	float h = dot(obj_pos, u) - plane.w;
	h -= ripple * 0.0015 * sin(TIME * 9.0 + obj_pos.x * 90.0 + obj_pos.z * 70.0);
	if (h > 0.0) {
		discard;
	}
	if (quality <= 0) {
		bool fr = FRONT_FACING != flip_faces;
		if (!fr) {
			NORMAL = normalize((VIEW_MATRIX * vec4(up_world, 0.0)).xyz);
		}
		ALBEDO = pow(liquid_color.rgb, vec3(1.4)) * (fr ? 0.8 : 0.9);   // ~ absorption through a typical path
		EMISSION = pow(liquid_color.rgb, vec3(1.4)) * 0.2;
		ROUGHNESS = fr ? 0.1 : 0.05;
		SPECULAR = fr ? 0.12 : 0.5;
	} else {
	vec3 vd = normalize(cam_obj - obj_pos);   // toward the viewer, object space
	vec3 lc = log(max(liquid_color.rgb, vec3(1e-4)));
	float bs = clamp(bubble_scale, 0.0, 1.0);
	float carb = carbonation * bs;
	float ag = agitation * bs;
	float fm = clamp(foam * bs, 0.0, 1.0);
	vec3 foam_col = mix(vec3(0.95, 0.93, 0.88), pow(liquid_color.rgb, vec3(0.25)), 0.35);   // cream for beer, tan for cola
	mat3 F = flow_basis;
	vec3 vq = vd * F;                         // view dir in the flow frame

	if (FRONT_FACING != flip_faces) {
		vec3 rd = -vd;
		// path through the liquid: radius about the axis, capped by the plane and the bottom
		vec2 o2 = obj_pos.xz;
		vec2 d2 = rd.xz;
		float a2 = max(dot(d2, d2), 1e-5);
		float b2 = dot(o2, d2);
		float rr = dot(o2, o2);
		float L = b2 < 0.0 ? -2.0 * b2 / a2 : 0.002;
		float ru = dot(rd, u);
		if (ru > 1e-4) { L = min(L, -h / ru); }
		if (rd.y < -1e-4) { L = min(L, (obj_pos.y - base_y) / -rd.y); }
		L = max(L, 0.0);
		vec3 col = exp(lc * clamp(L / ref_path, 0.3, 3.0));
		// shaken: micro-bubble haze, tinted by the liquid (stays brown for cola)
		col = mix(col, col * 1.4 + liquid_color.rgb * 0.03, ag * ag * (0.2 + 0.4 * carb));   // micro-bubble scatter, keeps the hue
		vec3 em = vec3(0.0);
		float dsurf0 = -h;

		if (carb + ag > 0.001) {
			// three shells at fractions of the local radius (deep -> near), then the glass wall layer
			float shell_f[3] = float[3](0.25, 0.58, 0.84);
			for (int k = 0; k < 3; k++) {
				if (quality < 3 && k != 1) {
					continue;
				}
				float f = shell_f[k];
				float cc = rr * (1.0 - f * f);
				float disc = b2 * b2 - a2 * cc;
				if (disc <= 0.0 || b2 >= 0.0) {
					continue;
				}
				float t = (-b2 - sqrt(disc)) / a2;
				float fade = smoothstep(0.0, 0.2 * b2 * b2, disc) * (1.0 - smoothstep(L - 0.004, L, t));
				if (fade <= 0.0) {
					continue;
				}
				vec3 p = obj_pos + rd * t;
				float ds = plane.w - dot(p, u);
				vec3 q = (p - flow_pivot) * F;
				vec3 v = vq;
				mat2 R2 = rot2(1.3 + float(k) * 2.1);
				q.xz = R2 * q.xz;
				v.xz = R2 * v.xz;
				vec3 tk = exp(lc * (t / ref_path));
				// shaken cloud clears from the bottom up (larger bubbles first)
				float agd = clamp(ag * 1.7 - ds * 3.0, 0.0, 1.0);
				float d_small = carb * 0.25 + smoothstep(0.03, 0.45, agd) * 0.9;
				float d_big = carb * 0.06 + smoothstep(0.45, 0.95, agd) * 0.9;
				float pxk = px * (1.0 + t * 3.0);
				if (k == 0) {
					bubble_layer(col, em, q, v, 0.003, 0.003, 0.0008 * bubble_size, 0.03, d_small, d_big, 1.0, 11.0, tk, pxk, fade);
				} else if (k == 1) {
					bubble_layer(col, em, q, v, 0.0085, 0.0085, 0.0021 * bubble_size, 0.06, d_small, d_big, 1.0, 23.0, tk, pxk, fade);
				} else {
					// streams: sparse columns of tiny bubbles, densely spaced vertically
					float st = carb * 0.4 + ag * 0.3;
					bubble_layer(col, em, q, v, 0.011, 0.0035, 0.0009 * bubble_size, 0.07, 0.8, 0.8, st, 37.0, tk, pxk, fade);
				}
			}
			// bubbles clinging to the inside of the glass (object space, they do not rise)
			vec3 qw = obj_pos * mat3(vec3(0.8, 0.36, -0.48), vec3(-0.6, 0.48, -0.64), vec3(0.0, 0.8, 0.6));
			vec3 vw = vd * mat3(vec3(0.8, 0.36, -0.48), vec3(-0.6, 0.48, -0.64), vec3(0.0, 0.8, 0.6));
			float dw = (carb * 0.5 + ag * 0.35) * step(1.5, float(quality));
			if (dw > 0.0) bubble_layer(col, em, qw, vw, 0.0055, 0.0055, 0.0016 * bubble_size, 0.0, dw, dw * 0.6, 1.0, 51.0, vec3(1.0), px, 1.0);
		}

		// foam head below the surface + meniscus line
		float head = fm * foam_height;
		float fmask = 0.0;
		if (head > 0.0004 && dsurf0 < head * 1.4) {
			vec3 qf = (obj_pos - flow_pivot) * F + vec3(0.0, rise * 0.0003, 0.0);
			float fd = clamp(dsurf0 / head, 0.0, 1.4);       // 0 = top of the head, 1 = its bottom
			// foam bubbles pressed against the glass: small and dry on top, bigger and wetter toward the bottom
			vec2 a = quality >= 2 ? voro3(qf * (900.0 * mix(1.1, 0.55, min(fd, 1.0)))) : vec2(0.45, 1.0);
			float edge = 1.0 - smoothstep(0.0, 0.1, a.y - a.x);          // Plateau borders (thin, slightly darker)
			float nz = snoise(qf * 260.0);
			float fb = fd + (nz - 0.5) * 0.4 + (a.x - 0.45) * 0.3;     // ragged lower edge that follows bubble outlines
			fmask = 1.0 - smoothstep(0.82, 1.0, fb);
			float wet = smoothstep(0.35, 0.95, fd);
			vec3 fcol = foam_col * (0.9 + 0.1 * smoothstep(0.05, 0.6, a.x)) * (1.0 - edge * mix(0.08, 0.3, wet));
			// wet lower head: bigger bubbles show the liquid through their faces
			fcol = mix(fcol, mix(col * 1.3 + 0.03, foam_col, 0.45), wet * 0.55 * (1.0 - edge));
			col = mix(col, fcol, fmask);
			em = mix(em, fcol * 0.12, fmask);
		}
		float men = 1.0 - smoothstep(0.0, 0.0014, dsurf0);
		em += vec3(0.22) * men * (1.0 - fmask);

		ALBEDO = col * 0.8;
		BACKLIGHT = col * 0.6;
		EMISSION = col * 0.2 + em;
		ROUGHNESS = mix(0.1, 0.65, fmask);
		SPECULAR = mix(0.12, 0.2, fmask);
	} else {
		// seen through the cut: the liquid surface, facing world up. Find where the eye ray crosses the plane.
		float vu = max(dot(vd, u), 0.03);
		float st = -h / vu;                       // distance from the plane down to this back-wall fragment
		vec3 ps = obj_pos + vd * st;
		vec3 qs = (ps - flow_pivot) * F;
		vec3 col = exp(lc * clamp(st / ref_path, 0.3, 3.0));
		col = mix(col, col * 1.4 + liquid_color.rgb * 0.03, ag * ag * (0.2 + 0.4 * carb));   // micro-bubble scatter, keeps the hue
		// ripples (normal only)
		vec2 g = vec2(cos(qs.x * 140.0 + TIME * 7.0) + 0.6 * cos(qs.x * 90.0 + qs.z * 120.0 - TIME * 9.0),
				cos(qs.z * 150.0 - TIME * 8.0) + 0.6 * cos(qs.x * 90.0 + qs.z * 120.0 - TIME * 9.0));
		vec3 nobj = normalize(u + (F * vec3(g.x, 0.0, g.y)) * (0.02 + ripple * 0.12));
		vec3 nw = normalize(mat3(MODEL_MATRIX) * nobj);
		nw = normalize(mix(up_world, nw, 0.999));
		NORMAL = normalize((VIEW_MATRIX * vec4(nw, 0.0)).xyz);
		// foam: islands that grow from the rim, plus a ring of small bubbles for fizzy drinks
		float rim = 1.0 - smoothstep(0.0, 0.006, st * vu);
		vec2 v1 = quality >= 2 ? voro2(qs.xz * 520.0) : vec2(0.5, 1.0);
		vec2 v2 = quality >= 3 ? voro2(qs.xz * 1300.0 + 7.3) : vec2(0.2, 1.0);
		float isl = snoise(vec3(qs.xz * 90.0, 3.1).xzy);
		float cover = clamp(fm * 1.6 + rim * (0.35 * carb + fm) - 0.5 + isl * 0.6, 0.0, 1.0);
		cover = smoothstep(0.35, 0.65, cover) * step(0.001, fm + carb);
		float edge = 1.0 - smoothstep(0.0, 0.14, v1.y - v1.x);
		float edge2 = 1.0 - smoothstep(0.0, 0.18, v2.y - v2.x);
		vec3 fcol = foam_col * (0.68 + 0.32 * smoothstep(0.1, 0.7, v1.x)) + vec3(0.15) * max(edge, edge2 * 0.6);
		// bubbles at the edge of a foam island read as separate rings
		float holes = smoothstep(0.25, 0.45, v2.x) * (1.0 - smoothstep(0.65, 0.95, cover + fm * 0.4));
		fcol = mix(fcol, col * 1.4 + 0.05, holes * 0.6);
		col = mix(col, fcol, cover);
		ALBEDO = col * 0.8;
		BACKLIGHT = col * 0.5;
		EMISSION = col * 0.25;
		ROUGHNESS = mix(0.04, 0.7, cover);
		SPECULAR = mix(0.5, 0.25, cover);
	}
	}
	METALLIC = 0.0;
}
