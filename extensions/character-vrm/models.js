// GameSystems character-vrm extension: the test VRM models this extension knows (pure data, no imports). The files are
// NOT in git: fetch_model.mjs downloads them from the official source into ./assets/<id>/ (gitignored) and checks the
// sha256 below; the apps' sync scripts copy ./assets/ to public/vrm-assets/. Licence notes: LICENSE-NOTES.md.
export const MODELS = Object.freeze({
  jimmy: Object.freeze({
    id: 'jimmy',
    title: 'Jimmy (100Avatars R1 #03, Polygonal Mind)',
    file: '100avatars-r1-jimmy/03_Jimmy_Avatar.vrm',
    // Polygonal Mind's official CC0 release repository, pinned to a commit.
    url: 'https://raw.githubusercontent.com/PolygonalMind/initiative-opensource-release/3f04639098df37342e2d6fa8a7193a7acfcbe73b/PolygonalMind_OpenSource/2003_100AvatarsR1AssetPack/03_Jimmy/03_Jimmy_Avatar.vrm',
    licence: 'CC0-1.0',
    licencePage: 'https://github.com/PolygonalMind/initiative-opensource-release/blob/3f04639098df37342e2d6fa8a7193a7acfcbe73b/License.md',
    size: 1599132,
    sha256: 'aca7f1d2b4a3637c79cc543e978087b73af294e86d2c79787a2e8d0771ccb6be',
    vrm: '0.x (UniVRM 0.62.0), Mixamo rig, 52 humanoid bones incl. all 30 finger joints, meta licenseName CC0',
    // Hand-profile override (avatar handprofile.js format, rig metres) from the grasp lab's calibrate on this model
    // (GameSystems/extensions/grasp/tools/lab/closure_lab.mjs, CHARACTER=vrm ALL=1 KINDS=bottle_beer,bottle_wine,can):
    // the contact radius its low-poly skin has when the fingers curl (smaller than the rest-pose reach the avatar measures)
    // and the posed palm-skin offset. vrmCharacters() applies it under the caller's handProfile.
    handProfile: Object.freeze({
      left: { pad: { Thumb: [0.0073, 0.0036, 0.0032], Index: [0.0058, 0.0053, 0.0024], Middle: [0.0079, 0.0053, 0.0087], Ring: [0.0024, 0.0024, 0.003], Little: [0.0024, 0.0032, 0.0024] }, palmOffset: -0.0029 },
      right: { pad: { Thumb: [0.0053, 0.0061, 0.0024], Index: [0.0058, 0.0053, 0.0042], Middle: [0.0084, 0.0052, 0.0077], Ring: [0.008, 0.0024, 0.0055], Little: [0.0073, 0.0035, 0.0039] }, palmOffset: -0.0035 },
    }),
  }),
});
export const DEFAULT_MODEL = 'jimmy';
