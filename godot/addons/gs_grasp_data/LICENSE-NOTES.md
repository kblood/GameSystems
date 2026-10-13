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
- `data/reference_hand.data.json` is a generated copy of the existing canonical
  `extensions/grasp/reference_hand.json`. Its source field and
  `extensions/grasp/tools/make_reference_hand.mjs` document the CharacterCreator male
  rest-pose fixture from the MIT Contracts character plugin / CharacterCreatorXR
  fork, prepared offline through `rigdata.prepareRig`. Attribution: Copyright (c)
  2026 Kasper Olesen. This addon copies the numerical fixture, not CharacterCreator
  runtime code. The original source metadata remains intact in the generated copy.
- `data/reference_hand.golden.json` records the raw contract and six outputs of the
  MIT JS `referenceHand` API, together with its local dependency hashes. Its G3
  tests cover raw structure and direct field correspondences; derived geometry is
  recorded for later algorithm conformance work. The reader/tests are original
  GameSystems work under the repository's MIT licence.
- `data/recorded_grasps.data.json` copies the existing canonical
  `extensions/grasp/recorded_grasps.json`, whose note and per-pose metadata identify
  GameSystems Grasp Studio recordings saved by its dev-server endpoint, including
  explicitly marked mirrored variants. These records are GameSystems MIT data;
  they are not attributed to CharacterCreator's reference-hand fixture.
- `data/recorded_grasps.golden.json` records the raw document separately from the
  public JS `RECORDED` array, which filters invalid geometry through `isPose`.
  Accepted/rejected raw indices and dependency hashes preserve that distinction.
  The reader and tests are original GameSystems MIT work, with no capture, mirror,
  recording, closure or SDF algorithm port.
- `data/baked_grasps.data.json` copies the existing MIT GameSystems
  `extensions/grasp/baked_grasps.data.json`. As documented in `baked_grasps.js`,
  these Godot bake rows were converted by Contracts' `convert_baked_grasps.mjs`
  to plugin wrist/quaternion/finger conventions and refitted by the grasp tools.
  Source schema/digests, `night-watch.glb` path/hash, operator scale, limits and fit
  metadata are preserved verbatim as data. No avatar asset or baking tool is copied.
- `data/baked_grasps.golden.json` contains the complete public JS `BAKED`, pose IDs,
  per-kind counts and kinds without a generic catalog entry, with dependency hashes.
  The source metadata is historical provenance, not verification of current assets,
  license status of external assets, or reproduction of the original bake.
