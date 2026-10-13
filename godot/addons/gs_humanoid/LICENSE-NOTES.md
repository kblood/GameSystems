# gs_humanoid: licence and origin

- `gs_humanoid_bone_maps.gd`, the addon README, and its tests are original GameSystems
  work, released under the repository's MIT licence.
- `data/bone_maps.data.json` is generated from `extensions/humanoid/bone_maps.data.json`.
  The canonical `jointNames`, MPFB map and root-motion bone preserve data from
  CharacterCreator commit `dc664c07` (MIT, Copyright (c) 2026 Kasper Olesen); the VRM
  1.0, VRM 0.x and Mixamo maps are GameSystems-owned MIT data.
- `data/bone_maps.golden.json` is generated from the JS humanoid public exports and
  records source hashes for reproducible cross-runtime comparison.
