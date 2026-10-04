# Liquid LUT v2 (`kind: "sphere_map"`)

Volume-preserving fake-liquid fill table for ANY closed interior mesh (square bottles, handles, tanks, ...).
Version 1 (`lut[cos_tilt][fill]`, rotational symmetry about the axis) keeps working; v2 is a superset, so engines can use
one code path (a lathe bottle is just a symmetric v2 table: `export/bottle_<n>.liquid_v2.json`).

## Meaning
`d = lut(up_obj, fill)`: the plane `dot(p_obj, up_obj) = d` has a fraction `fill` (0..1) of the interior volume BELOW it
(`dot <= d`; the shader discards where `dot - d > 0`). `up_obj` = world up in the Liquid node's local space = glTF node
space (Y up; the same space as the vertex positions in the GLB). Uniform scale only (divide `d` by the scale).
`fill` is a fraction of the interior mesh volume (`capacity_ml`), identical to v1.

## Where it lives
`extras.liquid` of the `Liquid` node (a JSON string, like v1) and the sidecar `export/<asset>.liquid.json`
(tiers: `.liquid.mid.json`, `.liquid.low.json`). Detect with `version === 2 && kind === "sphere_map"`; otherwise v1.

## Fields
| field | meaning |
|---|---|
| `version` 2, `kind` "sphere_map", `space` "node_yup" | |
| `capacity_ml` | interior volume (exact mesh volume) |
| `n_dir` | table is `n_dir x n_dir` directions (high 25, mid 17, low 9) |
| `n_fill`, `fill_warp: "cos"` | fill samples (64 / 48 / 32), see below |
| `d_min`, `d_max` | quantisation range (m) of the stored residual |
| `centre` | `[x,y,z]` volume centroid (m) |
| `encoding: "u16le_base64"`, `layout: "vuk"`, `data` | `uint16` little endian, index `((v*n_dir)+u)*n_fill + k`, base64 |
| `color`, `carbonation`, `foam`, `foam_height`, `bubble_size` | same as v1 |
| `open`, `closed_by`, `rim_points`, `open_height`, `brim_fill` | opening / spill info (below) |
| `bounds`, `top_y`, `spout` (jerry can), `tier` | misc |

## Decoding
1. `q` = uint16 array from `data`; `T[v][u][k] = d_min + q/65535 * (d_max - d_min)`.
2. Direction -> octahedral map (fold axis +Y, so upright = map centre (0.5,0.5), upside down = the 4 corners):
   `p = up/(|x|+|y|+|z|); a=p.x, b=p.z; if p.y<0 { a=(1-|p.z|)*sgn(p.x); b=(1-|p.x|)*sgn(p.z) }; u=a*.5+.5; v=b*.5+.5`
   (`sgn(0)=+1`). Samples sit on grid POINTS: `x = u*(n_dir-1)`, `y = v*(n_dir-1)` (corner aligned, so the fold seams are exact).
3. Fill -> index: samples are at `f_k = (1-cos(pi*k/(n_fill-1)))/2` (dense near empty/full, where `d(fill)` is steepest),
   so `t = acos(1-2*fill)/pi*(n_fill-1)`, `k0 = min(floor(t), n_fill-2)`, `ft = t-k0`; linear in `ft`.
4. Direction interpolation: bicubic Catmull-Rom (4x4 taps) in `(x,y)`; taps outside the grid are mirrored across the
   border with a flip along it (octahedral fold): `i<0: (i,j)->(-i, n-1-j)`, `i>n-1: (2(n-1)-i, n-1-j)`, `j<0: (n-1-i,-j)`,
   `j>n-1: (n-1-i, 2(n-1)-j)` (applied in that order). 16 taps x 2 fill samples = 32 reads, ~0.3 us in JS, ~8 us in GDScript.
5. `d = bicubic(T[.][.][k0])*(1-ft) + bicubic(T[.][.][k0+1])*ft + dot(centre, up)`  (the table stores the residual
   after removing the centroid term, which makes it smooth in `up`; this is what makes 25x25 enough).

Inverse `fill_at(up, d)`: build the n_fill-vector `row[k]` (bicubic per k), `d -= dot(centre, up)`, find the bracket, interpolate
`ft`, return `(1-cos(pi*(k+ft)/(n_fill-1)))/2`. Only needed for spill. Reference implementations: `shaders/three/liquid_lut_v2.js`,
`shaders/godot/liquid_lut_v2.gd`, `scripts/liquid_lut.py` (numpy, plus the offline builder). JS and GDScript decoders match the
numpy one to 3e-8 m (tests/containers_lut_test.mjs, tests/containers_godot/run.ps1).

## Offline build (scripts/liquid_lut.py, scripts/containers.py)
Interior mesh -> column-parity voxelisation along Y (lateral cell h0/2.2, stratified-jittered samples, ~0.7-1.8 M points) ->
for each of the 625 directions bin the projections `s = p.up` (8192 bins, weights) and invert the cumulative volume at the
64 fill samples -> subtract `dot(centre, up)` -> quantise to u16. Seeded, idempotent. Mid/low tiers are resampled from the high table.

## Size / cost / accuracy tiers
Volume error = |true volume below the plane - fill| in % of capacity, against an independent brute-force voxel truth on a randomly
rotated copy of the mesh (700 random orientations + axes + diagonals, random fills); see `tests/containers_lut_test.py`.

| tier | grid | json size | lookup | max error (6 containers) | rms |
|---|---|---|---|---|---|
| high | 25x25x64 | ~106 KB | 32 taps | 0.26 - 0.60 % (6 bottles: 0.29 - 0.93 %) | 0.03 - 0.14 % |
| mid  | 17x17x48 | ~38 KB  | same    | 0.27 - 1.40 % | 0.07 - 0.25 % |
| low  | 9x9x32   | ~8 KB   | same    | 1.15 - 3.63 % | 0.31 - 0.76 % |

Lookup cost is the same for all tiers (only the table gets smaller). Decoders memoise the last `(up, fill)`, so a resting container
costs one compare; `fill_at` is only called for spill. For an upright, rarely tilted container the cheapest tier is analytic:
`d = y_floor + fill*(y_top - y_floor)` (exact for straight-walled shapes).

## Open containers / spill
`open: true` (tumbler, mug, tank) or `closed_by: "Cap"` (bottles, hip flask, jerry can: the opening is only live when that node is removed).
`rim_points` = vertices of the opening rim (glTF node space, convex polygon at the real rim height, up to 48 points);
`open_height` = lowest rim `y` upright; `brim_fill` = fill at which the upright level reaches the rim (about 1.0).
Spill test each frame (only if the opening is uncapped):
```
dr = min_i dot(rim_i, up_obj)           # level at which the lowest rim point goes under
d  = offset(up_obj, fill)
if d > dr: d = dr; new_fill = min(fill, fill_at(up_obj, dr)); lost = fill - new_fill   # clamp, drain `lost` from the game volume
```
(`lut.spill(up, fill)` does exactly this.) A sideways open cup keeps about 0: the lowest rim point is at the bottom of the mouth.
Rim points sit 0.4-1 mm above the liquid lid, so the clamped plane never lies exactly on the lid face.
Jerry can: `spout.center/radius`, `rim_points` = the spout mouth ring, `closed_by: "Cap"`.

## Integration (owner of bottle_liquid.gd / bottle_liquid.js)
1. Replace `lut_offset(info.lut, n_cos, n_fill, up.y, fill)` with `makeLut(info).offset(up_obj, fill)` /
   `LiquidLutV2.from_info(info).offset(up_obj, fill)` (create the lut object once; v1 infos are still accepted). The plane
   uniform (`xyz = up_obj`, `w = d`) and the shaders are unchanged.
2. For open containers call `.spill(...)` (only when `info.open`, or the Cap is removed) and use the returned `d` / `fill`.
3. Bottles: load `export/bottle_<n>.liquid_v2.json` instead of the v1 table (more accurate: v1 wine capacity 868 vs 886 ml mesh volume).
4. Slosh: keep passing the slosh-bent `up_eff` (in object space) through `lut.offset`.
