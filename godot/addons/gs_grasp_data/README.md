# gs_grasp_data

This data-only G3 addon has separate readers for validator ranges/gates and closure
defaults. Each has a versioned JSON contract imported by its JavaScript module and
a generated golden that checks the Godot copy against the public JS exports.

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

The readers do not clamp finger rows, score grasps, calculate contacts, solve closure,
or convert coordinates. Algorithm ports and their parity tests remain separate G4/G6 work.

```gdscript
var data := GSGraspValidatorData.load_data()
var thumb_limits: Dictionary = data["HARD"]["Thumb"]
var closure := GSGraspClosureData.load_data()
var thumb_tilt_radians: float = closure["THUMB_TILT"]
```

Run the source contract with Godot 4.7+:

```powershell
godot --headless --path godot --script res://addons/gs_grasp_data/tests/gs_grasp_validator_data_tests.gd
godot --headless --path godot --script res://addons/gs_grasp_data/tests/gs_grasp_closure_data_tests.gd
```
