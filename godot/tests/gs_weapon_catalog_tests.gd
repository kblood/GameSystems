extends SceneTree
## Parser tests for firearm runtime limits and fire-mode enums.
## Run: godot --headless --path GameSystems/godot --script res://tests/gs_weapon_catalog_tests.gd

const Catalog = preload("res://addons/gs_weapon_catalog/gs_weapon_catalog.gd")
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
	print("GS_WEAPON_CATALOG passed=%d failed=%d" % [passed,failed])
	quit(1 if failed else 0)

func parse_profile(overrides: Dictionary) -> Dictionary:
	var profile := {"id":"test","name":"Test","kind":"rifle","source_kind":"blender_glb",
		"scene":"res://test.glb","capacity":5,"fire_modes":["semi"],"attachments":[],"moving_parts":[]}
	for key in overrides: profile[key] = overrides[key]
	return Catalog.parse_text(JSON.stringify({"schema":"nightfall.weapon-catalog.v1","units":"metres",
		"up":"+Y","forward":"-Z","weapons":[profile]}))

func case_result(ok: bool, label: String) -> void:
	if ok: passed += 1
	else:
		failed += 1
		push_error("GS_WEAPON_CATALOG: " + label)
