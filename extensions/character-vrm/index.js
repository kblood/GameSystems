// GameSystems character-vrm extension: public API. A VRM character (three-vrm) behind the character contract the avatar
// extension poses (docs/extensions_plan.md "Karakter-kontrakt", step 6: proof that the contract is generic):
//   character = { root, meshes, humanoid, restHeads(), applyPose(pose), resetPose(), headBone,
//                 capabilities: { fingers, eyes, cloth, morphs }, quality: ['low', 'high'], dispose(),
//                 + optional: eyeOffset(), setFirstPerson(on), tick(dt, physics, opts), resetSecondary(), setQuality(tier) }
// Files:
//   character.js     createVRMCharacter(vrm): the contract around a loaded VRM (no three-vrm import; humanoid public API)
//   loader.js        loadVRM(url): GLTFLoader + three-vrm VRMLoaderPlugin (the only three-vrm import)
//   models.js        MODELS: the known CC0 test models (URL, licence, size, sha256)
//   fetch_model.mjs  node only: downloads MODELS into ./assets/<id>/ (gitignored) and checks the sha256
// Depends on: humanoid (public API), three, three/addons GLTFLoader, @pixiv/three-vrm (the app pins it).
// Source of truth: GameSystems/extensions/character-vrm; games get synced copies of the top-level files (never edit them)
// and copy ./assets to their public folder.
import { createVRMCharacter, VRM_QUALITY, vrmVersion } from './character.js';
import { MODELS, DEFAULT_MODEL } from './models.js';

export { createVRMCharacter, VRM_QUALITY, vrmVersion, MODELS, DEFAULT_MODEL };
export const loadVRM = (...args) => import('./loader.js').then(m => m.loadVRM(...args));

/** URL of a known model (MODELS id) below an assets folder, e.g. modelURL('vrm-assets/'). */
export function modelURL(assetsURL, id = DEFAULT_MODEL) {
  const model = MODELS[id];
  if (!model) throw new Error(`Unknown VRM model: ${id}`);
  const base = String(assetsURL);
  return (base.endsWith('/') ? base : `${base}/`) + model.file;
}

/**
 * Character provider for the avatar extension (createCharacterPlugin({ character })), same shape as character-cc's
 * ccCharacters(). url: the .vrm to load (default: modelURL(assetsURL, model)); quality: 'low' | 'high' or
 * { player, npc } per kind (default player 'high', npc 'low'). Every create() loads its own copy of the model.
 * handProfile: hand-profile override for this character (avatar handprofile.js format: fields, `size`, `girth`; flat or
 * { left, right }), applied on top of the profile the avatar measures from the mesh and, for a known model loaded from
 * its own file, the model's lab-calibrated MODELS[model].handProfile; per create: options.handProfile.
 */
export function vrmCharacters({ url, assetsURL = new URL('./assets/', import.meta.url), model = DEFAULT_MODEL, quality = {}, load = loadVRM, handProfile = null } = {}) {
  const source = url ?? modelURL(assetsURL, model);
  const tierFor = kind => (typeof quality === 'string' ? quality : quality?.[kind] ?? (kind === 'npc' ? 'low' : 'high'));
  return {
    id: 'vrm',
    quality: VRM_QUALITY,
    async create({ kind = 'player', options = {}, signal } = {}) {
      const vrm = await load(options.url ?? source, { signal });
      const character = createVRMCharacter(vrm, { quality: options.characterQuality ?? tierFor(kind), signal });
      const own = url || options.url ? null : MODELS[model]?.handProfile, profiles = [own, handProfile].filter(Boolean);
      if (profiles.length) character.handProfile = profiles.length === 1 ? profiles[0] : profiles;
      return character;
    },
  };
}
