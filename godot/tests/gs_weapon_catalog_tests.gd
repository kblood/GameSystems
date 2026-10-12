extends SceneTree
## Parser tests for firearm runtime limits and fire-mode enums.
## Run: godot --headless --path GameSystems/godot --script res://tests/gs_weapon_catalog_tests.gd

const Catalog = preload("res://addons/gs_weapon_catalog/gs_weapon_catalog.gd")
const ShotProfile = preload("res://addons/gs_weapon_catalog/gs_weapon_shot_profile.gd")
var passed := 0
var failed := 0

func _initialize() -> void:
	case_result(parse_profile({"capacity":128}).ok, "128-round runtime capacity is accepted")
	case_result(not parse_profile({"capacity":129}).ok, "capacity beyond the WeaponState bound is rejected")
	case_result(parse_profile({"shot_interval_s":0.03}).ok, "minimum firing interval is accepted")
	case_result(parse_profile({"shot_interval_s":2.0}).ok, "maximum firing interval is accepted")
	for invalid_interval in [0,-0.1,0.0299,2.0001,"0.12",null]:
		case_result(not parse_profile({"shot_interval_s":invalid_interval}).ok,
			"invalid firing interval is rejected: %s" % str(invalid_interval))
	for invalid_modes in [["burst"],[null],[{}],["semi","semi"],[]]:
		case_result(not parse_profile({"fire_modes":invalid_modes}).ok,
			"invalid firing mode list is rejected: %s" % str(invalid_modes))
	case_result(not parse_profile({"fire_modes":["auto"]}).ok,
		"implicit semi default must exist in the supported mode list")
	case_result(parse_profile({"fire_modes":["auto"],"default_fire_mode":"auto"}).ok,
		"automatic-only profile is valid with an explicit automatic default")
	case_result(not parse_profile({"default_fire_mode":"burst"}).ok,
		"unknown default firing mode is rejected")
	case_result(not parse_profile({"default_fire_mode":"auto"}).ok,
		"default firing mode must be present in the mode list")
	var default_shot := ShotProfile.parse({})
	case_result(default_shot.ok and is_equal_approx(default_shot.profile.range_m, 70.0)
		and is_equal_approx(default_shot.profile.recoil_rad, 0.016),
		"omitted shot-profile fields retain Kestrel-compatible defaults")
	var valid_shot := ShotProfile.parse({"range_m":42.0,"recoil_rad":0.025})
	case_result(valid_shot.ok and is_equal_approx(valid_shot.profile.range_m, 42.0)
		and is_equal_approx(valid_shot.profile.recoil_rad, 0.025), "valid shot-profile values parse as typed data")
	case_result(not parse_profile({"shot_profile":{"range_m":0.5}}).ok,
		"shot-profile range below its supported limit is rejected")
	case_result(not parse_profile({"shot_profile":{"haptic_amplitude":"strong"}}).ok,
		"non-numeric shot-profile fields are rejected")
	case_result(not parse_profile({"shot_profile":{"unknown_knob":1.0}}).ok,
		"unknown shot-profile fields are rejected")
	var non_finite_shot := ShotProfile.parse({"range_m":INF})
	case_result(not non_finite_shot.ok, "non-finite shot-profile values are rejected")
	case_result(not parse_melee_with_shot_profile({}).ok,
		"melee entries reject even an empty optional shot profile")
	print("GS_WEAPON_CATALOG passed=%d failed=%d" % [passed,failed])
	quit(1 if failed else 0)

func parse_profile(overrides: Dictionary) -> Dictionary:
	var profile := {"id":"test","name":"Test","kind":"rifle","source_kind":"blender_glb",
		"scene":"res://test.glb","capacity":5,"fire_modes":["semi"],"attachments":[],"moving_parts":[]}
	for key in overrides: profile[key] = overrides[key]
	return Catalog.parse_text(JSON.stringify({"schema":"nightfall.weapon-catalog.v1","units":"metres",
		"up":"+Y","forward":"-Z","weapons":[profile]}))

func parse_melee_with_shot_profile(shot_profile: Dictionary) -> Dictionary:
	var profile := {"id":"test","name":"Test Knife","kind":"melee","source_kind":"blender_glb",
		"scene":"res://test.glb","fire_modes":[],"attachments":[],"moving_parts":[],"shot_profile":shot_profile}
	return Catalog.parse_text(JSON.stringify({"schema":"nightfall.weapon-catalog.v1","units":"metres",
		"up":"+Y","forward":"-Z","weapons":[profile]}))

func case_result(ok: bool, label: String) -> void:
	if ok: passed += 1
	else:
		failed += 1
		push_error("GS_WEAPON_CATALOG: " + label)
