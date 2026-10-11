# gs_weapon_loadout licence and origin

- Licence: MIT, copyright (c) 2026 Kasper Olesen. Full text: `LICENSE` copied from the GameSystems repository root.
- Origin: original host-agnostic GDScript registry that retains opaque per-weapon state and presentation references and commits an active selection only after a host callback succeeds.
- Source of truth: `GameSystems/godot/addons/gs_weapon_loadout`. Games receive generated copies with `godot/tools/sync_addons.py`; do not edit generated game copies.
- Scope: does not create weapon state, scenes, ammo rules, inventory ownership, input, or haptics. The game host owns validation and atomic physical/model binding.
