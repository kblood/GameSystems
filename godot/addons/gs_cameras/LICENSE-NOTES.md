# gs_cameras licence and origin

- Licence: MIT, copyright (c) 2026 Kasper Olesen. Full text: the GameSystems
  repository root `LICENSE`; `godot/tools/sync_addons.py` copies it into this addon
  when generating a game copy.
- Origin: original GDScript port of `GameSystems/extensions/cameras/index.js`
  and its `docs/camera_system.md` contract, by the same author under MIT.
  No third-party source, CharacterCreator code, or GPL code.
- Source of truth: `GameSystems/godot/addons/gs_cameras`. The normal `gs_*`
  discovery in `godot/tools/sync_addons.py` includes this addon automatically.
  Generated game copies receive `SOURCE.json`; change this source and re-sync.
- The addon uses Godot engine APIs only. `gs_host` integration is optional;
  neither the standalone WebXR extension nor a browser runtime is required.
