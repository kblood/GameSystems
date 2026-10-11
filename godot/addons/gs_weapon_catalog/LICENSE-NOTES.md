# gs_weapon_catalog licence and origin

- Licence: MIT, copyright (c) 2026 Kasper Olesen. Full text: `LICENSE` copied from the GameSystems repository root.
- Origin: original GDScript data definitions, catalogue validation and glTF model-marker binding. It uses Godot's built-in JSON/glTF importer and does not include third-party assets.
- Source of truth: `GameSystems/godot/addons/gs_weapon_catalog`. Games receive generated copies with `godot/tools/sync_addons.py`; do not edit generated copies.
- Scope: validates five-style weapon definitions and resolves authored attachment/moving-part nodes. It does not implement firing, reloads, ammunition state, melee contact, player input or haptics.
