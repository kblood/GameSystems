# gs_grasp_data: licence and origin

- The reader and tests are original GameSystems work, released under the repository's MIT licence.
- `data/validator.data.json` is generated from `extensions/grasp/data/validator.data.json`.
  It preserves the `HARD`, `COMFORT` and `GATES` values previously defined in the MIT
  GameSystems `extensions/grasp/grasp_validator.js`. The validator originated in
  Nightfall Contracts; its hard ranges follow the CharacterCreatorXR hand limits
  (MIT, Copyright (c) 2026 Kasper Olesen), as documented in that source module.
- `data/validator.golden.json` is generated from the JS validator's public exports
  and records source hashes. This is a G3 data contract, not the G4 grasp algorithm port.
