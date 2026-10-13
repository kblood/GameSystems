# gs_grasp_data

This data-only G3 addon has separate readers for validator ranges/gates, closure
defaults, held-drive tuning, prop catalogs and the recorded-grasp reference rest hand.
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

The readers do not clamp finger rows, score grasps, calculate contacts, solve closure,
apply drive forces, sample hand motion or convert coordinates. Algorithm ports and
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
```

Run the source contract with Godot 4.7+:

```powershell
godot --headless --path godot --script res://addons/gs_grasp_data/tests/gs_grasp_validator_data_tests.gd
godot --headless --path godot --script res://addons/gs_grasp_data/tests/gs_grasp_closure_data_tests.gd
godot --headless --path godot --script res://addons/gs_grasp_data/tests/gs_grasp_held_drive_data_tests.gd
godot --headless --path godot --script res://addons/gs_grasp_data/tests/gs_grasp_catalog_data_tests.gd
godot --headless --path godot --script res://addons/gs_grasp_data/tests/gs_grasp_reference_hand_data_tests.gd
```
