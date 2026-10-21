# ai: licence and origin

- All files (`*.js`): GameSystems, MIT (see `GameSystems/LICENSE`).
- `guard.js` (and the squad parts of `coordinator.js`, the suspicion model in `perception.js`) are a JavaScript port of
  the guard AI in **NightfallContractsGodot**: `core/guard_brain.gd`, `core/guard_tuning.gd`, `runtime/guard_tactics.gd`,
  `runtime/guard_squad.gd` and the per-guard runtime parts of `runtime/guard.gd`. That repository is MIT,
  Copyright (c) 2026 Kasper Olesen, the same author; the port keeps its tuning values, fairness rules and state names.
  The Godot code was read only; nothing in that repository was changed.
- `zombie.js`, `nav.js` (grid navmesh and A*), `steering.js`, `world.js`, `utility.js`, `math.js` and
  `three-adapters.js`: written for this extension. No third-party code, navmesh library or asset is used.
- No assets from Gunman Contracts or any other game are used.
