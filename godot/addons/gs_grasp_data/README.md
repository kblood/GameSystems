# gs_grasp_data

This data-only G3 slice loads and validates the grasp validator's hard joint ranges,
comfort bands and contact gates. The same versioned JSON is imported by the JavaScript
validator; a generated golden checks the Godot copy against those public JS exports.
Angles and comfort widths are degrees. Gate units are named in their keys (`Mm` for
millimetres, `Deg` for degrees); `minFingersTouching` is a whole-number count.

The reader does not clamp finger rows, score grasps, calculate contacts or convert
coordinates. Those algorithms are separate G4 work.

```gdscript
var data := GSGraspValidatorData.load_data()
var thumb_limits: Dictionary = data["HARD"]["Thumb"]
```

Run the source contract with Godot 4.7+:

```powershell
godot --headless --path godot --script res://addons/gs_grasp_data/tests/gs_grasp_validator_data_tests.gd
```
