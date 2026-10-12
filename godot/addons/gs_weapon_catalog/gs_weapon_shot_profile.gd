class_name GSWeaponShotProfile
extends RefCounted
## Validated, data-only firearm range and presentation tuning. All distances are
## metres, angles radians and durations seconds. Defaults preserve Kestrel.
## Damage, ammunition and the tracked VR hand pose remain separate authorities.

const LIMITS := {
	"range_m": [1.0, 500.0],
	"recoil_rad": [0.0, 0.2],
	"supported_recoil_rad": [0.0, 0.2],
	"recoil_recovery_rad_s": [0.01, 5.0],
	"haptic_amplitude": [0.0, 1.0],
	"supported_haptic_amplitude": [0.0, 1.0],
	"haptic_duration_s": [0.0, 0.5],
	"flash_duration_s": [0.0, 0.25],
	"flash_energy": [0.0, 20.0],
}

var range_m := 70.0
var recoil_rad := 0.016
var supported_recoil_rad := 0.008
var recoil_recovery_rad_s := 0.3
var haptic_amplitude := 0.7
var supported_haptic_amplitude := 0.45
var haptic_duration_s := 0.06
var flash_duration_s := 0.045
var flash_energy := 2.8

## Missing fields inherit defaults. Wrong types, unknown keys and non-finite or
## out-of-range values fail the entire profile; authored errors are not clamped.
static func parse(data: Variant) -> Dictionary:
	var errors: Array[String] = []
	if not data is Dictionary:
		return {"ok":false, "errors":["shot_profile must be an object"]}
	for key in data:
		if not LIMITS.has(key):
			errors.append("shot_profile has unknown field %s" % str(key))
			continue
		var value: Variant = data[key]
		var limits: Array = LIMITS[key]
		if typeof(value) not in [TYPE_INT, TYPE_FLOAT] or not is_finite(float(value)) or float(value) < limits[0] or float(value) > limits[1]:
			errors.append("shot_profile.%s must be a finite number from %s to %s" % [key, limits[0], limits[1]])
	if not errors.is_empty(): return {"ok":false, "errors":errors}
	var profile := GSWeaponShotProfile.new()
	for key in data: profile.set(key, float(data[key]))
	return {"ok":true, "profile":profile, "errors":errors}
