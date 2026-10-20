// The character contract: what the avatar extension needs from a character, so any character system (character-cc,
// character-vrm, a new provider) can stand behind it. Lives in humanoid because both sides already depend on it: a
// provider checks itself against validateCharacter() without importing avatar, and avatar checks what a provider gave it
// without importing any provider. Pure, duck-typed (no three.js import).
//
//   required  root (Object3D: the character frame, +X left, +Y up, +Z forward), humanoid ({ bones } from createHumanoid),
//             restHeads() -> { joint: [x, y, z] } (canonical joint heads, character frame), applyPose(pose), dispose()
//   optional  meshes (skinned meshes; first person hides HEAD ones), headBone, capabilities { fingers, eyes, cloth, morphs }
//             (booleans), quality, bodyShape { male, bust } (0..1, the IK's body shape), handProfile (one hand-profile
//             override or a list), eyeOffset() -> [x, y, z] | null, resetPose(), onRestChange(cb) -> unsubscribe,
//             setFirstPerson(on), tick(dt, physics, { gaze, frozen }), resetSecondary(), setQuality(tier)
import { checkSkeleton } from './skeleton_check.js';

export const CHARACTER_REQUIRED = Object.freeze(['root', 'humanoid', 'restHeads', 'applyPose', 'dispose']);
export const CHARACTER_OPTIONAL_METHODS = Object.freeze(['eyeOffset', 'resetPose', 'onRestChange', 'setFirstPerson', 'tick', 'resetSecondary', 'setQuality']);
export const CAPABILITIES = Object.freeze(['fingers', 'eyes', 'cloth', 'morphs']);

const isFn = v => typeof v === 'function';
const isObj = v => v !== null && typeof v === 'object';
const unit = v => Number.isFinite(v) && v >= 0 && v <= 1;

/**
 * Checks a character against the contract. { skeleton: true } also calls restHeads() and runs checkSkeleton() on it
 * (an unusable skeleton is an error, its warnings are warnings). Returns { ok, errors: [string], warnings: [string] }.
 */
export function validateCharacter(character, { skeleton = false } = {}) {
  const errors = [], warnings = [];
  if (!isObj(character)) return { ok: false, errors: ['character is not an object'], warnings };
  const c = character;
  if (!isObj(c.root) || !isFn(c.root.updateMatrixWorld) || !isFn(c.root.add)) errors.push('root must be an Object3D (the character frame)');
  if (!isObj(c.humanoid) || !isObj(c.humanoid.bones)) errors.push('humanoid must have bones (createHumanoid)');
  for (const name of ['restHeads', 'applyPose', 'dispose']) if (!isFn(c[name])) errors.push(`${name} must be a function`);
  for (const name of CHARACTER_OPTIONAL_METHODS) if (c[name] != null && !isFn(c[name])) errors.push(`${name} must be a function when present`);
  if (c.meshes != null && !Array.isArray(c.meshes)) errors.push('meshes must be an array when present');
  if (c.capabilities != null) {
    if (!isObj(c.capabilities)) errors.push('capabilities must be an object when present');
    else for (const k of CAPABILITIES) if (c.capabilities[k] != null && typeof c.capabilities[k] !== 'boolean') errors.push(`capabilities.${k} must be a boolean`);
  }
  if (c.bodyShape != null && !(isObj(c.bodyShape) && unit(c.bodyShape.male) && unit(c.bodyShape.bust))) errors.push('bodyShape must be { male, bust } in 0..1 when present');
  if (c.handProfile != null && !isObj(c.handProfile)) errors.push('handProfile must be an object or a list when present');
  if (skeleton && isFn(c.restHeads)) {
    let heads = null;
    try { heads = c.restHeads(); } catch (error) { errors.push(`restHeads() threw: ${error.message}`); }
    if (heads) {
      const report = checkSkeleton(heads);
      if (!report.ok) errors.push(`skeleton unusable: ${report.warnings[0]}`);
      else warnings.push(...report.warnings);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** validateCharacter() that throws a TypeError naming every problem; returns the character. */
export function assertCharacter(character, { skeleton = false, label = 'character' } = {}) {
  const { ok, errors } = validateCharacter(character, { skeleton });
  if (!ok) throw new TypeError(`${label} does not implement the character contract: ${errors.join('; ')}`);
  return character;
}
