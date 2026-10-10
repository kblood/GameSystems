// GameSystems character-cc extension: public API. The CharacterCreator character (body, hair, clothing, cloth, eyes,
// morphs) behind the character contract the avatar extension poses (docs/extensions_plan.md "Karakter-kontrakt"):
//   character = { root, meshes, humanoid, restHeads(), applyPose(pose), resetPose(), headBone,
//                 capabilities: { fingers, eyes, cloth, morphs }, quality: ['low', 'high'], dispose(),
//                 + optional: ready, eyeOffset(), bodyShape, onRestChange(cb), setFirstPerson(on), tick(dt, physics, opts),
//                   resetSecondary() }
// Files:
//   avatar.js     createAvatar(): loads and binds the CharacterCreator body, hair, outfit; returns the character
//   clothing.js   headless clothing (catalog rules, coverage, tint masks); materials.js per-character shader uniforms
//   lifecycle.js  lifetime + resource ownership (late loads released, imported resources disposed once)
//   sync_cc.mjs   node only: generates ./vendor/cc (CharacterCreator web modules) and ./assets (GLBs, manifests) from the
//                 CharacterCreator repo. Both folders are generated: never edit them, re-run the game's sync instead.
// Depends on: humanoid (public API). Source of truth: GameSystems/extensions/character-cc; games get synced copies of the
// top-level files (never edit them) and generate vendor/ + assets/ next to them.
import * as THREE from 'three';
import { createAvatar, assetBaseURL, DEFAULT_ASSETS_URL, CHARACTER_QUALITY, LAYERS } from './avatar.js';

export { createAvatar, assetBaseURL, DEFAULT_ASSETS_URL, CHARACTER_QUALITY, LAYERS };
export { createLifetime, createResourceOwner, frameDelta } from './lifecycle.js';
export { cloneUniforms, upgradeSkin, upgradeHair, upgradeCornea, setSkinParams, createHairCollider } from './materials.js';

const isPlainObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);
/**
 * Rendering features per kind ('player' | 'npc') from a quality preset: 'low' | 'high' (= defaults) | { ...features,
 * player: {...}, npc: {...} }, plus per-character overrides. Features: cloth, skinUpgrade, hairUpgrade, shadows, hairCollision.
 */
export function qualityFor(quality, kind, overrides) {
  const defaults = kind === 'npc'
    ? { cloth: false, skinUpgrade: false, shadows: false, hairCollision: false }
    : { cloth: false, skinUpgrade: true, shadows: true, hairCollision: true };
  const common = isPlainObject(quality) ? quality : {};
  const low = quality === 'low' ? { cloth: false, skinUpgrade: false, hairUpgrade: false, shadows: false, hairCollision: false } : {};
  return { ...defaults, ...low, ...common, ...common[kind], ...overrides };
}

/**
 * Character provider for the avatar extension (createCharacterPlugin({ character })): create({ kind, options, signal,
 * physicsScene }) resolves to a complete character (body, hair and outfit ready) in a detached scene.
 * assetsURL: folder with base_body.glb etc. (default ./assets/ next to this module); quality: see qualityFor().
 * Character options: outfit (['shirt', 'jeans', 'shoes']), hair ('short02'; null/'none' = none), skin, hairColor, eyeColor,
 * body ({ sliderId: -1..1 }), sex ('male' | 'female'), colors ({ itemId: { primary, secondary } }), wind, quality (overrides).
 * handProfile: hand-profile override for this character (avatar handprofile.js format: fields, `size`, `girth`; flat or
 * { left, right }), applied on top of the profile the avatar measures from the mesh; per create: options.handProfile.
 */
export function ccCharacters({ assetsURL, quality = {}, handProfile = null } = {}) {
  const base = assetBaseURL(assetsURL);
  return {
    id: 'cc',
    quality: CHARACTER_QUALITY,
    async create({ kind = 'player', options = {}, signal, physicsScene, scene } = {}) {
      // A temporary Scene keeps CC.applySkeleton's first rest snapshot in the MODEL frame, even when the game scene
      // already has locomotion/placement transforms.
      const character = await createAvatar({ scene: scene ?? new THREE.Scene(), physicsScene, assetsURL: base,
        quality: qualityFor(quality, kind, options.quality), signal,
        settings: { values: { ...options, outfit: options.outfit ?? ['shirt', 'jeans', 'shoes'], hair: options.hair === undefined ? 'short02' : options.hair, sex: options.sex ?? 'male' } } });
      await character.ready;
      if (handProfile) character.handProfile = handProfile;
      return character;
    },
  };
}
