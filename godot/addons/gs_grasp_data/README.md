# gs_grasp_data

This data-only G3 addon has separate readers for validator ranges/gates, closure
defaults, held-drive tuning, prop catalogs, the reference rest hand and recorded grasps.
Each reads a versioned JSON contract shared with JavaScript. Generated goldens record
the source data and public JS exports or API outputs.

`GSGraspValidatorData` loads hard joint ranges, comfort bands and contact gates.
Angles and comfort widths are degrees. Gate units are named in their keys (`Mm` for
millimetres, `Deg` for degrees); `minFingersTouching` is a whole-number count.

`GSGraspClosureData` loads `CLOSURE`, `PAD_RADIUS`, `REFERENCE_HAND` and `THUMB_TILT`.
Reference-hand lengths/vectors and closure contact lengths are metres. Pad radii are
fractions of hand length, thumb tilt is radians, and opposition is degrees.
Overshoot/backoff/step are dimensionless finger-row blend amounts; `bisect` is a
nonnegative whole-number iteration count and `thumbSearch` is a boolean.
`REFERENCE_HAND.palm` uses the closure hand-local frame described in `closure.js`,
while `palmCenter` uses the profile frame (+X radial for either hand). These defaults
are distinct from `extensions/grasp/reference_hand.json`, the recorded rest-hand fixture.

`GSGraspHeldDriveData` loads the six public scalars from `held_drive.js`:
`STIFFNESS` (`s^-2`, acceleration-normalized), `DAMPING` (`s^-1`),
`MAX_ACCELERATION` (`m/s^2`), `MAX_TORQUE` (`N m`), `MAX_HOLD_FORCE` (`N`) and
`HAND_MOTION_SAMPLES` (a positive whole-number count). The five tuning coefficients
must be finite and nonnegative. Reading the torque cap does not apply torque;
the host physics adapter remains responsible for using it.

`GSGraspCatalogData` loads `DEFAULT_MASS` and the `CATALOG` prop records (label, mass,
grip, shape and optional presentation/breakable fields). Geometry is item-local metres,
+Y up; mass is kilograms, fill is a fraction in [0, 1], and colors are 24-bit RGB numbers.
Supported shapes are `box` (three positive full dimensions), `cylinder` (positive
radius and half-height), `lathe` (at least two `[height, radius]` rows, strictly
increasing finite heights and nonnegative radii with some nonzero radius), and `parts`
(a nonempty flat union of primitives). Primitive `at` offsets are finite three-vectors;
nested unions and union-level offsets are rejected because the JS SDF does not handle
them. The reader validates data structure; it does not generate meshes, compute signed
distances, build colliders or certify agreement among those later algorithms.

`GSGraspReferenceHandData` reads a generated copy of the existing canonical
`extensions/grasp/reference_hand.json`; the source fixture and JS `referenceHand()`
API are unchanged. Its two rest hands contain rig-space wrist/chain points in metres,
three segment lengths per finger in metres, rest yaw in radians, and normalized frame
axes F (forward), D (dorsal), R (radial). R has opposite handedness between sides.
The root `scale` is a positive world-scale multiplier and `restLength` a rounded rig
hand length. Exact field sets, finite values, five fingers, four points per chain,
positive lengths and frame conventions are validated. Frame norm/dot tolerance is
`1e-4`; segment/point agreement allows `1e-5` metres for the six-decimal export.

The reference-hand golden contains the raw contract and six full public API outputs:
left/right at default scale, scale 1 and scale 2. Godot tests compare raw data and
direct side/scale/segment-length correspondences. They do not reconstruct or verify
the derived profile, palm, axes or thenar geometry. Those outputs are captured for
later algorithm tests; JS regressions pin current geometry, caching and scaling.

`GSGraspRecordedData` reads a generated copy of the unchanged canonical
`extensions/grasp/recorded_grasps.json`. The strict document requires its versioned
schema and poses array, with an optional text note. Each pose requires nonempty
id/kind/grasp, left/right side, finite wrist and approximately unit `[x,y,z,w]`
quaternion (the JS `1e-3` tolerance), and five `angles`/`open` digit rows. Rows contain
four degree values; the thumb may contain a fifth twist value. Optional hand length
must be strictly between 0.08 and 0.35 metres. Optional mode/mirror-origin text,
default/mirrored booleans, palm vector and recording metadata are type-checked;
metadata requires source/timestamp text, with optional nonnegative integer frames
and finite score in [0, 100]. Timestamp text is preserved, not date-parsed.

This canonical-artifact reader rejects the entire document if any pose is invalid,
requires the schema and rejects unknown fields. JS `recordedPoses` instead filters
geometry failures, permits an omitted schema and does not validate metadata. The
golden therefore preserves the raw document, filtered public `RECORDED` array and
accepted/rejected indices separately. All ten current records pass the JS filter.
Structural validity does not imply anatomical/contact quality: raw rows, including
thumb twists outside `HARD`, are preserved for the existing runtime clamp. Duplicate
ids are retained as data; variant merging remains the JS runtime's responsibility.

The readers do not clamp finger rows, score grasps, calculate contacts, solve closure,
apply drive forces, sample/capture/mirror recordings or convert coordinates. Algorithm ports and
their parity tests remain separate G4/G6 work.

```gdscript
var data := GSGraspValidatorData.load_data()
var thumb_limits: Dictionary = data["HARD"]["Thumb"]
var closure := GSGraspClosureData.load_data()
var thumb_tilt_radians: float = closure["THUMB_TILT"]
var drive := GSGraspHeldDriveData.load_data()
var force_limit_newtons: float = drive["MAX_HOLD_FORCE"]
var catalog := GSGraspCatalogData.load_data()
var beer_shape: Dictionary = catalog["CATALOG"]["bottle_beer"]["shape"]
var reference := GSGraspReferenceHandData.load_data()
var left_rest: Dictionary = reference["hands"]["left"]
var recordings := GSGraspRecordedData.load_data()
var raw_poses: Array = recordings["poses"]
```

Run the source contract with Godot 4.7+:

```powershell
godot --headless --path godot --script res://addons/gs_grasp_data/tests/gs_grasp_validator_data_tests.gd
godot --headless --path godot --script res://addons/gs_grasp_data/tests/gs_grasp_closure_data_tests.gd
godot --headless --path godot --script res://addons/gs_grasp_data/tests/gs_grasp_held_drive_data_tests.gd
godot --headless --path godot --script res://addons/gs_grasp_data/tests/gs_grasp_catalog_data_tests.gd
godot --headless --path godot --script res://addons/gs_grasp_data/tests/gs_grasp_reference_hand_data_tests.gd
godot --headless --path godot --script res://addons/gs_grasp_data/tests/gs_grasp_recorded_data_tests.gd
```
