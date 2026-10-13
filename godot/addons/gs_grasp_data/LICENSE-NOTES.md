# gs_grasp_data: licence and origin

- The reader and tests are original GameSystems work, released under the repository's MIT licence.
- `data/validator.data.json` is generated from `extensions/grasp/data/validator.data.json`.
  It preserves the `HARD`, `COMFORT` and `GATES` values previously defined in the MIT
  GameSystems `extensions/grasp/grasp_validator.js`. The validator originated in
  Nightfall Contracts; its hard ranges follow the CharacterCreatorXR hand limits
  (MIT, Copyright (c) 2026 Kasper Olesen), as documented in that source module.
- `data/validator.golden.json` is generated from the JS validator's public exports
  and records source hashes. This is a G3 data contract, not the G4 grasp algorithm port.
- `data/closure.data.json` is generated from `extensions/grasp/data/closure.data.json`,
  preserving the MIT GameSystems closure defaults, pad fractions and reference-hand
  measurements. Their original CharacterCreator-hand grasp-lab provenance remains
  documented in `extensions/grasp/closure.js`; no CharacterCreator runtime code is copied.
- `data/closure.golden.json` derives from those public JS exports and records hashes
  for the closure module and its local dependencies. Its reader validates data only.
- `data/held_drive.data.json` preserves the six scalar defaults from the MIT
  GameSystems held-drive JS module, originally a port of the Godot held-drive code.
  `data/held_drive.golden.json` derives from the JS exports and hashes the data,
  module and math dependency. The reader/tests are original GameSystems MIT work;
  no drive or sampling algorithm is ported here.
- `data/catalog.data.json` preserves the MIT GameSystems `DEFAULT_MASS` and prop
  records. Its beer/wine profiles retain their provenance as offline measurements
  of GameSystems bottle glass silhouettes (MIT, Kasper Olesen), documented in
  `extensions/grasp/catalog.js`. `data/catalog.golden.json` derives from the JS
  exports and records data/module hashes. The reader adds structural validation,
  with no SDF or collision algorithm port.
