# Godot addon contracts

Run the source-of-truth addon tests from the GameSystems Godot project with Godot 4.7+:

```powershell
godot --headless --path godot --script res://addons/gs_host/tests/gs_host_tests.gd
godot --headless --path godot --script res://tests/gs_gear_inventory_tests.gd
godot --headless --path godot --script res://tests/gs_gear_inventory_scene_adapter_tests.gd
godot --headless --path godot --script res://tests/gs_resource_adapters_tests.gd
godot --headless --path godot --script res://tests/gs_weapon_catalog_tests.gd
godot --headless --path godot --script res://addons/gs_backpack/tests/gs_backpack_tests.gd
```

Run these source contracts before syncing addons to a game. A game's native suite should
then cover its integration paths, since it exercises player input, physical ownership,
weapons and scene lifecycle beyond the reusable addon API.
