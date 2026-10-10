# character-vrm: licence notes

## Code

- `character.js`, `loader.js`, `index.js`, `models.js`, `fetch_model.mjs`, `sync_vrm.mjs`: GameSystems code (MIT, as the rest of GameSystems).
- Runtime dependency **@pixiv/three-vrm 3.5.5** (npm, MIT, (c) pixiv Inc.), installed in `webxr-demo` and `apps/grasp-studio`
  (`"@pixiv/three-vrm": "3.5.5"`, pinned exactly). Tarball integrity
  `sha512-RPXy7jYAXs704NIpZlosB0U2ENu21G9DrqGWdQgRe8dShaCo1ugpj+6BVPRCy91nt+MPMA96j5rbsSzEl0HlQA==`.
  Only `loader.js` imports it, so apps load it as a separate chunk only when `?character=vrm` is used.

## Test model: "Jimmy" (100Avatars R1, Polygonal Mind), CC0 1.0

The binary is **not committed**. `node extensions/character-vrm/fetch_model.mjs` downloads it to the gitignored
`assets/` folder and checks size and sha256; `--check` only verifies. The apps' sync scripts copy only verified files
to `public/vrm-assets/` (gitignored).

| | |
|---|---|
| File | `assets/100avatars-r1-jimmy/03_Jimmy_Avatar.vrm` |
| Source URL (pinned commit) | https://raw.githubusercontent.com/PolygonalMind/initiative-opensource-release/3f04639098df37342e2d6fa8a7193a7acfcbe73b/PolygonalMind_OpenSource/2003_100AvatarsR1AssetPack/03_Jimmy/03_Jimmy_Avatar.vrm |
| Licence page | https://github.com/PolygonalMind/initiative-opensource-release/blob/3f04639098df37342e2d6fa8a7193a7acfcbe73b/License.md |
| Licence | CC0 1.0 Universal (SPDX `CC0-1.0`) |
| Size | 1,599,132 bytes |
| sha256 | `aca7f1d2b4a3637c79cc543e978087b73af294e86d2c79787a2e8d0771ccb6be` |
| Downloaded | 2026-10-10 (download approved by the user on 2026-10-10) |

Licence evidence, checked before the download:
- The repository's `License.md` is the CC0 1.0 Universal text, and GitHub reports the licence as `CC0-1.0`.
- The repository README says the released content falls under the CC0 licence.
- The VRM file's own meta says `licenseName: CC0`, author "Polygonal Mind", title "Jimmy" (exported with UniVRM 0.62.0).

CC0 requires no attribution, but we keep it anyway: **"Jimmy" by Polygonal Mind (100Avatars), CC0 1.0.**

Rejected candidates (not CC0, or a login was needed): the VRoid AvatarSample_A–C models (VRoid licence; VRoid Hub needs a login),
the vrm-c samples Seed-san and VRM1_Constraint_Twist_Sample (VRM Public License), and the
`PolygonalMind/100Avatars` repository (CC-BY 4.0).

The downloaded file is treated as untrusted data. It is only parsed by GLTFLoader/three-vrm and never executed.
