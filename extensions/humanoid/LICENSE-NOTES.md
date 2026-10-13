# humanoid: licence and origin

- `canonical.js`, `qmath.js`, `rig.js` and `humanoid.js` come from **CharacterCreator** (`web/animation/*.js`, `web/humanoid.js`)
  at commit `dc664c07` (synced 2026-10-01 into the Contracts character plugin's `vendor/cc`). That commit was released under
  the **MIT licence**, Copyright (c) 2026 Kasper Olesen. Only headers and import paths were changed here.
  `bone_maps.data.json`'s `jointNames` comes from `canonical.js`, while `maps.mpfb` and `rootMotionBone` preserve the
  matching static data from `rig.js`.
  CharacterCreator was relicensed to GPL-3.0-or-later on 2026-10-03; later CharacterCreator code is **not** copied here.
- `bone_maps.js`, the VRM/Mixamo maps in `bone_maps.data.json`, `skeleton_check.js`, `layers.js` and `index.js`:
  GameSystems, MIT (see `GameSystems/LICENSE`).
  `layers.js` keeps the CharacterCreatorXR layer convention (MIT, Copyright (c) 2026 Kasper Olesen).
