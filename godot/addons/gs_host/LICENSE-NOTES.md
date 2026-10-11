# gs_host licence and origin

- Licence: MIT, copyright (c) 2026 Kasper Olesen. Full text: `LICENSE` in this addon (copied from the GameSystems repository root by the sync).
- Origin: original GDScript, a port of `GameSystems/extensions/host` (`host.js`, `events.js`, `quality.js`, `physics.js`, same author, MIT).
  No third-party code, no CharacterCreator code, no GPL code.
- Source of truth: `GameSystems/godot/addons/gs_host`. Games receive generated copies through `GameSystems/godot/tools/sync_addons.py`;
  `SOURCE.json` in a game copy records the source commit and per-file sha256. Do not edit the copies; change GameSystems and re-sync.
- `data/tier_for.golden.json` is generated from `extensions/host/quality.js` by `GameSystems/godot/tools/gen_golden.mjs`.
